import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { cnpjValido } from "@/lib/controladoria/documento";
import { somarDias } from "@/lib/controladoria/periodos";
import { consultarCnpj } from "./cliente";

// ENRIQUECIMENTO CADASTRAL PELA RECEITA — incremental, no orçamento que houver.
//
// Cada fornecedor PJ que recebeu do grupo nos últimos 400 dias ganha uma
// linha em ParceiroReceita: situação, abertura, CNAE, porte, capital, sócios.
// A consulta é pública e gratuita, mas pede ritmo (400 ms entre chamadas), e
// a base tem centenas de CNPJs — não cabe numa invocação. Então a função faz
// o que couber no orçamento que recebeu e devolve quantos faltam:
//
//   - no ciclo diário, ~15 s antes da auditoria (dezenas de CNPJs por dia);
//   - no botão "Consultar Receita agora", até 60 s por clique, em laço.
//
// EM ORDEM DE MAIOR VALOR PAGO. O fornecedor que mais recebe é o que mais
// importa conferir; com a fila assim, o primeiro ciclo já cobre quem carrega
// o dinheiro, e a cauda longa de fornecedores de R$ 200 vem depois.
//
// O que é "pendente":
//   - CNPJ sem linha;
//   - consulta com sucesso há mais de 30 dias (situação cadastral muda —
//     baixa, inaptidão — e trinta dias é o intervalo em que a Receita
//     republica a base pública);
//   - consulta com erro há mais de 1 dia (rede, 429, 5xx: tenta de novo
//     amanhã, sem martelar hoje).

const DIAS_DE_TITULO = 400;
const DIAS_PARA_RECONSULTAR = 30;
const DIAS_PARA_RETENTAR_ERRO = 1;
// Duas falhas seguidas de rede/servidor encerram a rodada: a terceira não
// vai ser diferente, e cada uma custa dez segundos do orçamento.
const FALHAS_SEGUIDAS_PARA_PARAR = 2;

export type ResultadoEnriquecimento = {
  // Consultas feitas nesta rodada (com ou sem sucesso).
  consultados: number;
  // Das consultadas, quantas gravaram dado da Receita.
  atualizados: number;
  // "Não encontrado" e erros gravados.
  naoEncontrados: number;
  falhas: number;
  // Quantos CNPJs ainda estão pendentes depois desta rodada.
  pendentes: number;
  // Por que a rodada parou antes de zerar, quando parou: orçamento ou API.
  parouPor: "orcamento" | "api" | null;
  // Fila total considerada (pendentes antes da rodada).
  fila: number;
};

// Os CNPJs que interessam, do maior para o menor valor pago. Fica separado
// para a tela poder mostrar "N de M consultados" sem fazer consulta nenhuma.
export async function filaDeConsulta(companyId: string, agora = new Date()): Promise<{ cnpj: string; valorCents: number }[]> {
  const desde = somarDias(agora, -DIAS_DE_TITULO);
  // Um grupo por documento, com o total pago. Emissão OU baixa na janela:
  // título emitido há 13 meses e pago há 11 continua sendo relação viva.
  const grupos = await prisma.omieTitulo.groupBy({
    by: ["parceiroDocumento"],
    where: {
      companyId,
      natureza: "PAGAR",
      cancelado: false,
      parceiroDocumento: { not: null },
      OR: [{ dataEmissao: { gte: desde } }, { dataUltimaBaixa: { gte: desde } }, { dataVencimento: { gte: desde } }],
    },
    _sum: { valorPagoCents: true },
  });

  const candidatos = new Map<string, number>();
  for (const g of grupos) {
    const doc = g.parceiroDocumento ?? "";
    // PJ com dígito verificador válido. CNPJ inválido é achado de outra regra
    // (FR-DOCUMENTO-INVALIDO), e consultá-lo só renderia um 404.
    if (doc.length !== 14 || !cnpjValido(doc)) continue;
    candidatos.set(doc, (candidatos.get(doc) ?? 0) + (g._sum.valorPagoCents ?? 0));
  }
  if (candidatos.size === 0) return [];

  // Só parceiros ATIVOS no cadastro. Fornecedor inativado na Omie já foi
  // resolvido por alguém; gastar consulta com ele atrasa quem ainda recebe.
  const ativos = await prisma.omieParceiro.findMany({
    where: { companyId, inativo: false, documento: { in: [...candidatos.keys()] } },
    select: { documento: true },
  });
  const docsAtivos = new Set(ativos.map((p) => p.documento as string));

  return [...candidatos]
    .filter(([cnpj]) => docsAtivos.has(cnpj))
    .map(([cnpj, valorCents]) => ({ cnpj, valorCents }))
    .sort((a, b) => b.valorCents - a.valorCents);
}

export async function pendentesDeConsulta(companyId: string, agora = new Date()): Promise<{ fila: { cnpj: string; valorCents: number }[]; pendentes: { cnpj: string; valorCents: number }[] }> {
  const fila = await filaDeConsulta(companyId, agora);
  if (fila.length === 0) return { fila, pendentes: [] };

  const existentes = await prisma.parceiroReceita.findMany({
    where: { cnpj: { in: fila.map((f) => f.cnpj) } },
    select: { cnpj: true, consultadoEm: true, erro: true },
  });
  const porCnpj = new Map(existentes.map((e) => [e.cnpj, e]));
  const limiteOk = somarDias(agora, -DIAS_PARA_RECONSULTAR);
  const limiteErro = somarDias(agora, -DIAS_PARA_RETENTAR_ERRO);

  const pendentes = fila.filter((f) => {
    const linha = porCnpj.get(f.cnpj);
    if (!linha) return true;
    return linha.erro ? linha.consultadoEm < limiteErro : linha.consultadoEm < limiteOk;
  });
  return { fila, pendentes };
}

export async function enriquecerParceiros(
  companyId: string,
  opts: { orcamentoMs: number; agora?: Date }
): Promise<ResultadoEnriquecimento> {
  const agora = opts.agora ?? new Date();
  const fim = Date.now() + opts.orcamentoMs;
  const { fila, pendentes } = await pendentesDeConsulta(companyId, agora);

  const resultado: ResultadoEnriquecimento = {
    consultados: 0,
    atualizados: 0,
    naoEncontrados: 0,
    falhas: 0,
    pendentes: pendentes.length,
    parouPor: null,
    fila: fila.length,
  };

  let falhasSeguidas = 0;
  for (const { cnpj } of pendentes) {
    // Folga de uma chamada inteira (ritmo + tempo máximo de resposta): começar
    // uma consulta que não cabe é o que faria o passo estourar o orçamento.
    if (Date.now() + 10_400 > fim) {
      resultado.parouPor = "orcamento";
      break;
    }

    const r = await consultarCnpj(cnpj);
    resultado.consultados++;
    const consultadoEm = new Date();

    if (r.status === "ok") {
      const d = r.dados;
      const linha = {
        razaoSocial: d.razaoSocial,
        situacao: d.situacao,
        situacaoEm: d.situacaoEm,
        inicioAtividade: d.inicioAtividade,
        cnaeCodigo: d.cnaeCodigo,
        cnaeDescricao: d.cnaeDescricao,
        porte: d.porte,
        capitalSocialCents: d.capitalSocialCents,
        naturezaJuridica: d.naturezaJuridica,
        municipio: d.municipio,
        uf: d.uf,
        mei: d.mei,
        simples: d.simples,
        socios: d.socios as unknown as Prisma.InputJsonValue,
        consultadoEm,
        erro: null,
      };
      await prisma.parceiroReceita.upsert({
        where: { cnpj },
        create: { cnpj, ...linha },
        update: linha,
      });
      resultado.atualizados++;
      resultado.pendentes--;
      falhasSeguidas = 0;
      continue;
    }

    if (r.status === "nao-encontrado") {
      // Fato sobre o CNPJ, não sobre a rede: gravado como consulta feita,
      // com situação própria, e reconsultado em 30 dias como qualquer outro.
      // A base pública demora semanas para conhecer uma empresa recém-aberta,
      // e a regra que lê isto (FR-CNPJ-IRREGULAR) diz isso na descrição.
      await prisma.parceiroReceita.upsert({
        where: { cnpj },
        create: { cnpj, situacao: "NAO ENCONTRADA", socios: [], consultadoEm, erro: null },
        update: { situacao: "NAO ENCONTRADA", consultadoEm, erro: null },
      });
      resultado.naoEncontrados++;
      resultado.pendentes--;
      falhasSeguidas = 0;
      continue;
    }

    // Erro: fica registrado, curto, e os campos da última consulta boa (se
    // houve) continuam valendo — as regras leem o dado, não o erro.
    const motivo = r.motivo.slice(0, 300);
    await prisma.parceiroReceita.upsert({
      where: { cnpj },
      create: { cnpj, socios: [], consultadoEm, erro: motivo },
      update: { consultadoEm, erro: motivo },
    });
    resultado.falhas++;
    if (r.status === "tentar-depois") {
      falhasSeguidas++;
      if (falhasSeguidas >= FALHAS_SEGUIDAS_PARA_PARAR) {
        resultado.parouPor = "api";
        break;
      }
    } else {
      // Erro definitivo desta consulta (400, formato inesperado): conta como
      // resolvido por hoje; volta amanhã pela regra do erro.
      resultado.pendentes--;
      falhasSeguidas = 0;
    }
  }

  return resultado;
}

// Retrato para a tela de sincronização: quantos da fila já têm consulta,
// quantos faltam e quando foi a última — sem consultar nada.
export async function situacaoDoEnriquecimento(companyId: string): Promise<{
  fila: number;
  consultados: number;
  pendentes: number;
  comErro: number;
  ultimaConsulta: Date | null;
  // Os motivos das falhas, do mais frequente ao menos, com a contagem. É o
  // que diferencia "a BrasilAPI está limitando" (HTTP 429), "a rede da
  // hospedagem não chega lá" (falha de rede) e "demora demais" (sem resposta)
  // — três problemas com três soluções, e a contagem sozinha não separava
  // nenhum. O motivo é texto curto do cliente, sem corpo de resposta nem CNPJ.
  motivosDeFalha: { motivo: string; quantidade: number }[];
}> {
  const { fila, pendentes } = await pendentesDeConsulta(companyId);
  if (fila.length === 0) {
    return { fila: 0, consultados: 0, pendentes: 0, comErro: 0, ultimaConsulta: null, motivosDeFalha: [] };
  }
  const cnpjs = fila.map((f) => f.cnpj);
  const [comErro, ultima, motivos] = await Promise.all([
    prisma.parceiroReceita.count({ where: { cnpj: { in: cnpjs }, erro: { not: null } } }),
    prisma.parceiroReceita.findFirst({
      where: { cnpj: { in: cnpjs } },
      orderBy: { consultadoEm: "desc" },
      select: { consultadoEm: true },
    }),
    prisma.parceiroReceita.groupBy({
      by: ["erro"],
      where: { cnpj: { in: cnpjs }, erro: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { erro: "desc" } },
      take: 5,
    }),
  ]);
  return {
    fila: fila.length,
    consultados: fila.length - pendentes.length,
    pendentes: pendentes.length,
    comErro,
    ultimaConsulta: ultima?.consultadoEm ?? null,
    motivosDeFalha: motivos.map((m) => ({ motivo: m.erro ?? "sem motivo registrado", quantidade: m._count._all })),
  };
}
