import type { OmieContrato, OmieTitulo } from "@prisma/client";
import type { ContextoAuditoria } from "./types";
import type { Periodo } from "./periodos";
import { dentro } from "./periodos";
import { dataDeCompetencia } from "./competencia";
import { agrupar, somar } from "./agents/comum";
import { contratoAtivo, contratoMensal, PERIODICIDADE_CONTRATO } from "@/lib/omie/mapping";

// MARGEM QUE A OMIE JÁ SABE SOZINHA.
//
// O rateio de unitEconomics.ts precisa de um de-para confirmado por uma
// pessoa para ligar custo a contrato — e enquanto a cobertura é baixa, o
// ranking não é publicado. Há porém duas ligações que a própria Omie já
// carrega no título, sem nenhum vínculo:
//
// - o PROJETO, que neste grupo é a ordem de serviço: a viagem tem um código
//   e é nele que o motorista, o combustível, o pedágio e o terceiro são
//   lançados, e é nele que a cobrança sai. Receita menos custo do mesmo
//   projeto é a margem da OS.
// - o CONTRATO de serviço (`contratoCodigo`), que liga a cobrança recorrente
//   ao valor mensal contratado (`OmieContrato.valorMensalCents`).
//
// A margem por OS agregada pelo cliente que foi cobrado dá a margem por
// cliente Omie sem passar pelo cadastro da gestão. Nada aqui é rateio:
// só entra o que já veio classificado da origem, e o que não veio fica
// contado à parte ("fora das OS") para a leitura não parecer completa.
//
// O extrato do cartão de frota NÃO entra: ele não tem projeto, e o título de
// combustível da Omie, quando lançado na OS, já é o custo dela.

export type MargemOs = {
  chave: string;
  conexaoApelido: string;
  projeto: string;
  nome: string;
  receitaCents: number;
  custoCents: number;
  margemCents: number;
  margemPercent: number | null;
  titulosDeCusto: number;
  titulosDeReceita: number;
  // Competência do último título (custo ou receita) da OS.
  ultimoMovimento: Date;
  // Cliente cobrado na OS: o parceiro dos títulos a receber. Quando há mais
  // de um, o de maior receita, e `clientesDistintos` diz quantos eram.
  clienteCodigo: string | null;
  clienteNome: string | null;
  clientesDistintos: number;
};

export type ResumoPorOs = {
  os: MargemOs[];
  // Somas do que está nas OS listadas.
  receitaCents: number;
  custoCents: number;
  // O que ficou fora por não ter projeto: a parcela do período que esta
  // leitura NÃO explica.
  custoForaDeOsCents: number;
  receitaForaDeOsCents: number;
  semFaturamento: number;
  semCusto: number;
};

// Um título pertence à leitura quando sua competência cai no período. Sem
// período, entra tudo o que o contexto carregou — a leitura "desde o início
// da janela", útil porque uma OS pode custar num mês e faturar no seguinte.
function titulosDaLeitura(ctx: ContextoAuditoria, periodo: Periodo | null): OmieTitulo[] {
  return ctx.titulos.filter((t) => !t.cancelado && (periodo === null || dentro(dataDeCompetencia(t), periodo)));
}

export function margemPorOs(ctx: ContextoAuditoria, periodo: Periodo | null = null): ResumoPorOs {
  const titulos = titulosDaLeitura(ctx, periodo);
  const nomeProjeto = new Map(ctx.projetos.map((p) => [`${p.conexaoId}|${p.codigo}`, p.nome]));

  let custoForaDeOs = 0;
  let receitaForaDeOs = 0;
  const comProjeto: OmieTitulo[] = [];
  for (const t of titulos) {
    if (t.projetoCodigo) comProjeto.push(t);
    else if (t.natureza === "PAGAR") custoForaDeOs += t.valorDocumentoCents;
    else receitaForaDeOs += t.valorDocumentoCents;
  }

  const os: MargemOs[] = [];
  for (const [chave, lista] of agrupar(comProjeto, (t) => `${t.conexaoId}|${t.projetoCodigo}`)) {
    const custos = lista.filter((t) => t.natureza === "PAGAR");
    const receitas = lista.filter((t) => t.natureza === "RECEBER");
    const receita = somar(receitas, (t) => t.valorDocumentoCents);
    const custo = somar(custos, (t) => t.valorDocumentoCents);
    const margem = receita - custo;

    const porCliente = agrupar(
      receitas.filter((t) => t.parceiroCodigo),
      (t) => t.parceiroCodigo as string
    );
    let cliente: OmieTitulo | null = null;
    let maior = -1;
    for (const lista of porCliente.values()) {
      const total = somar(lista, (t) => t.valorDocumentoCents);
      if (total > maior) {
        maior = total;
        cliente = lista[0];
      }
    }

    os.push({
      chave,
      conexaoApelido: lista[0].conexaoApelido,
      projeto: lista[0].projetoCodigo as string,
      nome: nomeProjeto.get(chave) ?? (lista[0].projetoCodigo as string),
      receitaCents: receita,
      custoCents: custo,
      margemCents: margem,
      margemPercent: receita > 0 ? (margem / receita) * 100 : null,
      titulosDeCusto: custos.length,
      titulosDeReceita: receitas.length,
      ultimoMovimento: lista.reduce((maior, t) => {
        const d = dataDeCompetencia(t);
        return d > maior ? d : maior;
      }, new Date(0)),
      clienteCodigo: cliente?.parceiroCodigo ?? null,
      clienteNome: cliente?.parceiroNome ?? null,
      clientesDistintos: porCliente.size,
    });
  }

  // DO MAIS RECENTE PARA O MAIS ANTIGO; entre iguais, a maior receita.
  os.sort((a, b) => b.ultimoMovimento.getTime() - a.ultimoMovimento.getTime() || b.receitaCents - a.receitaCents);

  return {
    os,
    receitaCents: somar(os, (o) => o.receitaCents),
    custoCents: somar(os, (o) => o.custoCents),
    custoForaDeOsCents: custoForaDeOs,
    receitaForaDeOsCents: receitaForaDeOs,
    semFaturamento: os.filter((o) => o.receitaCents === 0).length,
    semCusto: os.filter((o) => o.custoCents === 0).length,
  };
}

// MARGEM POR CLIENTE OMIE — as OS somadas pelo cliente cobrado. OS sem
// cobrança não tem cliente; fica num grupo próprio, porque é custo real que
// alguém precisa faturar ou reclassificar (é o que CR-OS-NAO-FATURADA aponta).
export type MargemCliente = {
  clienteCodigo: string | null;
  clienteNome: string;
  ordens: number;
  receitaCents: number;
  custoCents: number;
  margemCents: number;
  margemPercent: number | null;
};

export function margemPorClienteOmie(resumo: ResumoPorOs): MargemCliente[] {
  const grupos = agrupar(resumo.os, (o) => (o.clienteCodigo ? `${o.conexaoApelido}|${o.clienteCodigo}` : "|sem cobrança"));
  const linhas: MargemCliente[] = [];
  for (const lista of grupos.values()) {
    const receita = somar(lista, (o) => o.receitaCents);
    const custo = somar(lista, (o) => o.custoCents);
    const primeiro = lista[0];
    linhas.push({
      clienteCodigo: primeiro.clienteCodigo,
      clienteNome: primeiro.clienteCodigo
        ? `${primeiro.clienteNome ?? primeiro.clienteCodigo} (${primeiro.conexaoApelido})`
        : "OS sem cobrança",
      ordens: lista.length,
      receitaCents: receita,
      custoCents: custo,
      margemCents: receita - custo,
      margemPercent: receita > 0 ? ((receita - custo) / receita) * 100 : null,
    });
  }
  // Maior receita primeiro; o grupo sem cobrança, que não tem receita, vai
  // para o fim por construção.
  return linhas.sort((a, b) => b.receitaCents - a.receitaCents || b.custoCents - a.custoCents);
}

// FATURADO VERSUS CONTRATADO, por contrato de serviço, no período.
//
// O contrato diz quanto deveria entrar por mês; os títulos a receber ligados
// a ele dizem quanto entrou. A diferença é a linha que o gestor de contrato
// precisa ver: contrato ativo faturado a menor (ou não faturado) e contrato
// que faturou sem estar ativo. A regra CR-CONTRATO-* abre achado nos casos
// graves; aqui é a tabela inteira, sem juízo.
export type FaturamentoContrato = {
  id: string;
  rotulo: string;
  conexaoApelido: string;
  clienteNome: string | null;
  situacao: string;
  ativo: boolean;
  periodicidade: string;
  // Só contrato MENSAL tem "contratado no mês" comparável ao faturado do
  // mês; nos demais, o valor fica como referência e a diferença é nula.
  contratadoCents: number;
  faturadoCents: number;
  diferencaCents: number | null;
  faturadoPercent: number | null;
  titulos: number;
};

export function faturadoVersusContratado(ctx: ContextoAuditoria, periodo: Periodo): FaturamentoContrato[] {
  const contratos = ctx.contratos ?? [];
  if (contratos.length === 0) return [];

  const porChave = new Map<string, OmieContrato>();
  for (const c of contratos) {
    porChave.set(`${c.conexaoId}|${c.codigoOmie}`, c);
    if (c.numero) porChave.set(`${c.conexaoId}|${c.numero}`, c);
  }

  const faturado = new Map<string, { cents: number; titulos: number }>();
  for (const t of titulosDaLeitura(ctx, periodo)) {
    if (t.natureza !== "RECEBER" || !t.contratoCodigo) continue;
    const c = porChave.get(`${t.conexaoId}|${t.contratoCodigo}`);
    if (!c) continue;
    const atual = faturado.get(c.id) ?? { cents: 0, titulos: 0 };
    atual.cents += t.valorDocumentoCents;
    atual.titulos += 1;
    faturado.set(c.id, atual);
  }

  const linhas: FaturamentoContrato[] = contratos.map((c) => {
    const f = faturado.get(c.id) ?? { cents: 0, titulos: 0 };
    const mensal = contratoMensal(c.periodicidade);
    const ativo = contratoAtivo(c.situacao);
    // Contrato inativo sem faturamento não tem diferença a mostrar: o
    // esperado é zero, e é zero.
    const comparavel = mensal && (ativo || f.cents > 0);
    return {
      id: c.id,
      rotulo: `${c.numero ?? c.codigoOmie}`,
      conexaoApelido: c.conexaoApelido,
      clienteNome: c.parceiroNome,
      situacao: c.situacaoDescricao ?? c.situacao ?? "—",
      ativo,
      periodicidade: c.periodicidade ? PERIODICIDADE_CONTRATO[c.periodicidade] ?? c.periodicidade : "mensal",
      contratadoCents: c.valorMensalCents,
      faturadoCents: f.cents,
      diferencaCents: comparavel ? f.cents - (ativo ? c.valorMensalCents : 0) : null,
      faturadoPercent: comparavel && ativo && c.valorMensalCents > 0 ? (f.cents / c.valorMensalCents) * 100 : null,
      titulos: f.titulos,
    };
  });

  // Ativos primeiro, e dentro deles quem mais falta faturar no topo; depois
  // os inativos que faturaram; por fim os inativos parados, pelo valor.
  const falta = (l: FaturamentoContrato) => l.diferencaCents ?? Number.POSITIVE_INFINITY;
  return linhas
    .filter((l) => l.ativo || l.faturadoCents > 0)
    .sort((a, b) => {
      if (a.ativo !== b.ativo) return a.ativo ? -1 : 1;
      if (falta(a) !== falta(b)) return falta(a) < falta(b) ? -1 : 1;
      return b.contratadoCents - a.contratadoCents;
    });
}
