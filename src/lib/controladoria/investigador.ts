import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { AuditSeveridade, AuditStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { fmtBRL, fmtData } from "./format";
import { AGENTES } from "./registry";

// O investigador roda num modelo mais barato que o analista do relatório
// diário, de propósito. O relatório é uma chamada por dia e é onde o
// cruzamento fino entre achados vale mais; a investigação é interativa, pode
// ser feita dezenas de vezes por semana, e o que decide a qualidade dela é a
// consulta certa — que o Sonnet 5 faz tão bem quanto os maiores, a um quinto
// do preço por token (US$ 2/10 contra US$ 10/50 por milhão).
export const MODELO_INVESTIGADOR = "claude-sonnet-5";

// INVESTIGADOR — a IA que CONSULTA a base para responder uma pergunta de
// auditoria, com a trilha do que consultou.
//
// É a segunda forma de IA no módulo, e tem fronteira diferente da do analista
// do relatório diário. O analista recebe o relatório pronto e escreve a
// leitura; não consulta nada. O investigador recebe uma PERGUNTA de uma
// pessoa ("por que a Cajamar está com 137 mil vencidos?", "que fornecedores
// novos apareceram este trimestre com valor alto?") e vai buscar a resposta
// nos dados — através de um conjunto FECHADO de consultas, todas de leitura,
// todas restritas à empresa da sessão.
//
// Três garantias que não se negociam:
//   1. Só leitura. Nenhuma ferramenta escreve: não cria achado, não trata
//      achado, não altera título, não chama a Omie. Uma resposta errada aqui
//      custa o tempo de quem leu; uma escrita errada custaria a integridade
//      da trilha de auditoria.
//   2. Toda consulta feita fica registrada e é mostrada junto da resposta. A
//      pessoa vê o que a IA olhou — e o que ela NÃO olhou. É o que separa
//      uma investigação de uma opinião.
//   3. A resposta cita o dado (número do título, código da regra, nome do
//      parceiro) e diz quando a base não cobre a pergunta. O sistema já
//      aprendeu, do jeito caro, o que acontece quando uma análise feita fora
//      dele vira afirmação: quatro CT-e "não cobrados" que estavam na Omie.

export type ConsultaFeita = {
  ferramenta: string;
  entrada: Record<string, unknown>;
  // Uma linha sobre o que voltou ("12 títulos, R$ 137.117,70 em aberto").
  resumo: string;
};

export type StatusInvestigacao = "EXECUTANDO" | "CONCLUIDA" | "ERRO";

// O retrato de uma investigação, do jeito que a tela mostra — em andamento,
// concluída ou com erro. É o que cada rodada devolve e o que o histórico lista.
export type EstadoInvestigacao = {
  id: string;
  status: StatusInvestigacao;
  pergunta: string;
  empresa: string;
  resposta: string | null;
  erro: string | null;
  consultas: ConsultaFeita[];
  iteracoes: number;
  modelo: string | null;
  criadoEm: Date;
  userNome: string | null;
};

export function isInvestigadorDisponivel(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// Teto de idas e vindas entre o modelo e as consultas. Doze respondem qualquer
// pergunta que caiba numa tela; acima disso é o modelo vagando, e cada volta
// custa tempo da pessoa que espera e dinheiro.
const MAXIMO_DE_CONSULTAS = 12;
const LIMITE_DE_LINHAS = 50;

const SEVERIDADES: AuditSeveridade[] = ["CRITICA", "ALTA", "MEDIA", "BAIXA", "INFO"];
const STATUS: AuditStatus[] = ["ABERTO", "EM_ANALISE", "RESOLVIDO", "IGNORADO", "OBSOLETO"];

function catalogoDeAgentes(): string {
  return AGENTES.map((a) => `- ${a.id} (${a.area}): ${a.descricao}`).join("\n");
}

const SYSTEM_PROMPT = `Você é o auditor investigador da controladoria de um grupo brasileiro de fretamento e transporte de passageiros (duas empresas, Azul Mob e MCZ, ambas com contabilidade na Omie). Uma pessoa da controladoria faz uma pergunta; você a responde consultando o espelho da Omie e a base de achados da auditoria, através das ferramentas disponíveis.

O que você tem:
- Os achados dos agentes de auditoria (regras determinísticas, revisadas por um supervisor). Cada achado tem regra, severidade, status, entidade, valor, evidência e, quando houve, a tratativa humana.
- Os títulos a pagar e a receber espelhados da Omie, com baixas.
- O resumo mensal por fornecedor/cliente e por categoria (histórico de até vários anos), que é a base de comparação dos padrões.
- Os agentes existentes e o que cada um vigia:
${catalogoDeAgentes()}

Como trabalhar:
- Comece pela consulta mais específica que a pergunta permite. Não varra a base inteira quando um nome, um número ou uma regra já foi dado.
- Cruze fontes. Se um achado fala de um fornecedor, olhe os títulos dele e a série mensal dele antes de concluir. O que vale é a coincidência entre fontes independentes.
- Cite o dado. Número do título, código da regra, nome do parceiro, competência, valor exato. Uma afirmação sem dado citável não entra na resposta.
- Algumas regras emitem UM achado para o conjunto, sem entidade (ex.: FR-BAIXA-*, CP-SEM-CATEGORIA, FI-RECEITA-SEM-NOTA, OP-JUROS-ANO). O parceiro só aparece na evidência desses achados: antes de dizer que "não há achado sobre X", liste os achados da regra relevante e abra a evidência com detalhar_achado.
- Diferencie "não encontrei" de "não existe". Se a sua busca pode ter deixado algo de fora, diga isso e diga o que faltou buscar.
- Diga o que NÃO dá para saber com esta base. O espelho não tem extrato bancário, não tem CT-e emitido, e a janela dos agentes é o ano corrente mais os títulos em aberto. Se a resposta depende de algo fora disso, diga que depende e do quê.
- Nunca conclua fraude. Aponte o indício, a hipótese e o que uma pessoa precisa verificar para confirmar ou descartar. Indício não é conclusão.
- Você não altera nada: não trata achado, não corrige título, não fala com a Omie. O que você pode fazer é PROPOR a tratativa de um achado com a ferramenta propor_tratativa (resolvido, não se aplica ou em análise, com a justificativa que a evidência sustenta). A proposta só vale depois que a pessoa clicar em aplicar na tela — diga isso na resposta. Proponha apenas quando a evidência consultada sustentar a decisão; na dúvida, diga o que falta verificar.

Resposta: comece pelo que encontrou, em uma ou duas frases. Depois a evidência, na ordem em que sustenta a conclusão. Depois o que falta verificar, se faltar. Frases completas, sem abreviações inventadas, sem cadeias de setas. Ser legível importa mais que ser curto. Em português do Brasil.`;

// Cada ferramenta recebe o escopo (empresa e, opcionalmente, conexão) POR
// FECHAMENTO, e nunca por parâmetro do modelo: o modelo não escolhe de que
// empresa lê. É a mesma regra das actions — o escopo vem da sessão.
function ferramentas(escopo: { companyId: string; conexaoId: string | null }, consultas: ConsultaFeita[]) {
  const base = { companyId: escopo.companyId, ...(escopo.conexaoId ? { conexaoId: escopo.conexaoId } : {}) };
  const registrar = (ferramenta: string, entrada: Record<string, unknown>, resumo: string) => {
    consultas.push({ ferramenta, entrada, resumo });
  };

  const listarAchados = betaZodTool({
    name: "listar_achados",
    description:
      "Lista achados da auditoria com filtros. Use para descobrir o que os agentes já apontaram sobre uma regra, um parceiro ou uma severidade. Devolve no máximo 50, ordenados por severidade e impacto.",
    inputSchema: z.object({
      regra: z.string().optional().describe("Código exato da regra, ex.: CR-OS-NAO-FATURADA, CP-VENCIDO, HI-FORA-DO-PADRAO."),
      agente: z.string().optional().describe("Id do agente (contasPagar, contasReceber, antifraude, padroes, ...)."),
      entidade: z.string().optional().describe("Trecho do nome do parceiro, do projeto/OS ou da referência da entidade."),
      status: z.enum(["ABERTO", "EM_ANALISE", "RESOLVIDO", "IGNORADO", "OBSOLETO", "EM_ABERTO_QUALQUER"]).optional()
        .describe("EM_ABERTO_QUALQUER = ABERTO ou EM_ANALISE (padrão)."),
      severidade: z.enum(["CRITICA", "ALTA", "MEDIA", "BAIXA", "INFO"]).optional(),
      limite: z.number().int().min(1).max(LIMITE_DE_LINHAS).optional(),
    }),
    run: async (input) => {
      const status = input.status ?? "EM_ABERTO_QUALQUER";
      const where: Prisma.AuditFindingWhereInput = {
        ...base,
        ...(status === "EM_ABERTO_QUALQUER" ? { status: { in: ["ABERTO", "EM_ANALISE"] } } : STATUS.includes(status) ? { status } : {}),
        ...(input.regra ? { regra: input.regra } : {}),
        ...(input.agente ? { agente: input.agente } : {}),
        ...(input.severidade && SEVERIDADES.includes(input.severidade) ? { severidade: input.severidade } : {}),
        // O nome pode estar na entidade OU no texto: achado agregado (um por
        // regra, falando do conjunto) não tem entidade, e o cliente aparece só
        // na descrição ou na evidência. Buscar nos dois lugares é o que evita
        // concluir "não há achado sobre X" quando há — dentro de um agregado.
        ...(input.entidade
          ? {
              OR: [
                { entidadeRef: { contains: input.entidade, mode: "insensitive" } },
                { titulo: { contains: input.entidade, mode: "insensitive" } },
                { descricao: { contains: input.entidade, mode: "insensitive" } },
              ],
            }
          : {}),
      };
      // Achado do grupo (conexão nula) entra em qualquer recorte de empresa:
      // ele fala das duas, e omiti-lo faria a empresa parecer mais tranquila.
      if (escopo.conexaoId) {
        delete (where as { conexaoId?: unknown }).conexaoId;
        const porTexto = where.OR;
        where.OR = undefined;
        where.AND = [
          { OR: [{ conexaoId: escopo.conexaoId }, { conexaoId: null }] },
          ...(porTexto ? [{ OR: porTexto }] : []),
        ];
      }
      const [linhas, total] = await Promise.all([
        prisma.auditFinding.findMany({
          where,
          orderBy: [{ severidade: "asc" }, { impactoCents: "desc" }, { detectadoEm: "desc" }],
          take: input.limite ?? 25,
          select: {
            id: true, regra: true, agente: true, severidade: true, status: true, categoria: true, titulo: true,
            entidadeTipo: true, entidadeRef: true, valorCents: true, impactoCents: true, confianca: true,
            detectadoEm: true, ocorrencias: true, notaSupervisor: true, observacaoTratativa: true, conexaoApelido: true,
          },
        }),
        prisma.auditFinding.count({ where }),
      ]);
      registrar("listar_achados", input, `${total} achado(s) no filtro; ${linhas.length} devolvido(s)`);
      return JSON.stringify({
        total,
        achados: linhas.map((a) => ({
          ...a,
          valor: fmtBRL(a.valorCents), impacto: a.impactoCents ? fmtBRL(a.impactoCents) : null,
          detectadoEm: fmtData(a.detectadoEm),
        })),
      });
    },
  });

  const detalharAchado = betaZodTool({
    name: "detalhar_achado",
    description: "Traz um achado completo: descrição, recomendação, evidência anexada pelo agente e tratativa humana.",
    inputSchema: z.object({ id: z.string() }),
    run: async (input) => {
      const a = await prisma.auditFinding.findFirst({ where: { ...base, id: input.id } });
      registrar("detalhar_achado", input, a ? `${a.regra} — ${a.titulo}` : "não encontrado");
      if (!a) return JSON.stringify({ erro: "achado não encontrado nesta empresa" });
      return JSON.stringify({
        ...a,
        // A evidência é JSON livre dos agentes e pode trazer CPF cru (a regra
        // de funcionário-fornecedor traz por construção). Mascarado aqui, como
        // na tela e na ferramenta de parceiro: o modelo não precisa do número.
        evidencia: mascararDocumentos(a.evidencia),
        valor: fmtBRL(a.valorCents), impacto: a.impactoCents ? fmtBRL(a.impactoCents) : null,
        detectadoEm: fmtData(a.detectadoEm), resolvidoEm: a.resolvidoEm ? fmtData(a.resolvidoEm) : null,
      });
    },
  });

  const titulosDoParceiro = betaZodTool({
    name: "titulos_do_parceiro",
    description:
      "Títulos a pagar ou a receber de um parceiro (fornecedor ou cliente), pelo nome ou pelo CNPJ/CPF, com totais. Use para ver o que está em aberto, vencido e pago de alguém.",
    inputSchema: z.object({
      parceiro: z.string().describe("Trecho do nome, ou o documento (só dígitos)."),
      natureza: z.enum(["PAGAR", "RECEBER"]).optional(),
      somenteEmAberto: z.boolean().optional().describe("Padrão: false (traz também liquidados)."),
      projeto: z.string().optional().describe("Código do projeto/OS, quando a pergunta é sobre uma OS."),
      limite: z.number().int().min(1).max(LIMITE_DE_LINHAS).optional(),
    }),
    run: async (input) => {
      const digitos = input.parceiro.replace(/\D/g, "");
      const where: Prisma.OmieTituloWhereInput = {
        ...base,
        ...(input.natureza ? { natureza: input.natureza } : {}),
        ...(input.somenteEmAberto ? { liquidado: false, cancelado: false } : {}),
        ...(input.projeto ? { projetoCodigo: input.projeto } : {}),
        ...(digitos.length >= 11 && digitos === input.parceiro.replace(/[.\-/\s]/g, "")
          ? { parceiroDocumento: digitos }
          : { parceiroNome: { contains: input.parceiro, mode: "insensitive" } }),
      };
      const [linhas, agregados, emAberto] = await Promise.all([
        prisma.omieTitulo.findMany({
          where,
          orderBy: [{ dataVencimento: "desc" }],
          take: input.limite ?? 30,
          select: {
            id: true, conexaoApelido: true, natureza: true, numeroDocumento: true, numeroParcela: true, tipoDocumento: true,
            parceiroNome: true, categoriaDescricao: true, projetoCodigo: true, dataEmissao: true, dataVencimento: true,
            valorDocumentoCents: true, valorPagoCents: true, saldoCents: true, jurosCents: true, multaCents: true,
            descontoCents: true, liquidado: true, cancelado: true,
          },
        }),
        prisma.omieTitulo.aggregate({ where, _count: true, _sum: { valorDocumentoCents: true, valorPagoCents: true } }),
        prisma.omieTitulo.aggregate({
          where: { ...where, liquidado: false, cancelado: false },
          _count: true,
          _sum: { valorDocumentoCents: true },
        }),
      ]);
      registrar(
        "titulos_do_parceiro",
        input,
        `${agregados._count} título(s), ${fmtBRL(agregados._sum.valorDocumentoCents ?? 0)}; em aberto ${emAberto._count} (${fmtBRL(emAberto._sum.valorDocumentoCents ?? 0)})`
      );
      return JSON.stringify({
        total: agregados._count,
        valorTotal: fmtBRL(agregados._sum.valorDocumentoCents ?? 0),
        valorPago: fmtBRL(agregados._sum.valorPagoCents ?? 0),
        emAberto: { titulos: emAberto._count, valor: fmtBRL(emAberto._sum.valorDocumentoCents ?? 0) },
        titulos: linhas.map(formatarTitulo),
      });
    },
  });

  const titulo = betaZodTool({
    name: "titulo",
    description: "Um título pelo número do documento (ou pelo id interno), com as baixas dele. Use para conferir um caso específico.",
    inputSchema: z.object({
      numeroDocumento: z.string().optional(),
      id: z.string().optional(),
      natureza: z.enum(["PAGAR", "RECEBER"]).optional(),
    }),
    run: async (input) => {
      if (!input.numeroDocumento && !input.id) return JSON.stringify({ erro: "informe numeroDocumento ou id" });
      const linhas = await prisma.omieTitulo.findMany({
        where: {
          ...base,
          ...(input.id ? { id: input.id } : { numeroDocumento: input.numeroDocumento }),
          ...(input.natureza ? { natureza: input.natureza } : {}),
        },
        take: 10,
        include: { baixas: { orderBy: { dataBaixa: "asc" } } },
      });
      registrar("titulo", input, `${linhas.length} título(s) com esse número`);
      return JSON.stringify(
        linhas.map((t) => ({
          ...formatarTitulo(t),
          observacao: t.observacao,
          baixas: t.baixas.map((b) => ({
            data: fmtData(b.dataBaixa), valor: fmtBRL(b.valorCents), juros: fmtBRL(b.jurosCents), multa: fmtBRL(b.multaCents),
            desconto: fmtBRL(b.descontoCents), conta: b.contaCorrenteCodigo, liquidaTitulo: b.liquidaTitulo, observacao: b.observacao,
          })),
        }))
      );
    },
  });

  const serieMensal = betaZodTool({
    name: "serie_mensal",
    description:
      "Resumo mensal (títulos, valor, pago, prazo médio) de um parceiro ou de uma categoria ao longo dos meses. É a base de comparação dos agentes de padrão: use para ver se um valor é normal para aquele fornecedor.",
    inputSchema: z.object({
      dimensao: z.enum(["PARCEIRO", "CATEGORIA"]),
      natureza: z.enum(["PAGAR", "RECEBER"]),
      rotulo: z.string().describe("Trecho do nome do parceiro ou da descrição da categoria."),
      meses: z.number().int().min(3).max(36).optional().describe("Quantos meses para trás (padrão 24)."),
    }),
    run: async (input) => {
      const meses = input.meses ?? 24;
      const inicio = new Date();
      inicio.setMonth(inicio.getMonth() - meses);
      const de = `${inicio.getFullYear()}-${String(inicio.getMonth() + 1).padStart(2, "0")}`;
      const linhas = await prisma.historicoMensal.findMany({
        where: {
          ...base,
          dimensao: input.dimensao,
          natureza: input.natureza,
          competencia: { gte: de },
          rotulo: { contains: input.rotulo, mode: "insensitive" },
        },
        orderBy: [{ chave: "asc" }, { competencia: "asc" }],
        take: 200,
        select: {
          chave: true, rotulo: true, competencia: true, titulos: true, valorCents: true, valorMaximoCents: true,
          baixas: true, valorBaixadoCents: true, diasPagamentoSoma: true, conexaoId: true,
        },
      });
      const apelidos = new Map(
        (await prisma.omieConexao.findMany({ where: { companyId: escopo.companyId }, select: { id: true, apelido: true } })).map(
          (c) => [c.id, c.apelido]
        )
      );
      const chaves = new Set(linhas.map((l) => l.chave));
      registrar("serie_mensal", input, `${chaves.size} série(s), ${linhas.length} mês(es) desde ${de}`);
      return JSON.stringify(
        linhas.map((l) => ({
          empresa: apelidos.get(l.conexaoId) ?? l.conexaoId, rotulo: l.rotulo, competencia: l.competencia, titulos: l.titulos,
          valor: fmtBRL(l.valorCents), maiorTitulo: fmtBRL(l.valorMaximoCents), baixas: l.baixas,
          pago: fmtBRL(l.valorBaixadoCents), prazoMedioDias: l.baixas > 0 ? Math.round(l.diasPagamentoSoma / l.baixas) : null,
        }))
      );
    },
  });

  const parceiro = betaZodTool({
    name: "parceiro",
    description: "Cadastro do fornecedor/cliente na Omie: desde quando existe, documento (mascarado), cidade, situação, se mudou conta bancária.",
    inputSchema: z.object({ nome: z.string().describe("Trecho do nome ou documento (só dígitos).") }),
    run: async (input) => {
      const digitos = input.nome.replace(/\D/g, "");
      const linhas = await prisma.omieParceiro.findMany({
        where: {
          ...base,
          ...(digitos.length >= 11 ? { documento: digitos } : { nome: { contains: input.nome, mode: "insensitive" } }),
        },
        take: 10,
        select: {
          conexaoApelido: true, codigoOmie: true, nome: true, nomeFantasia: true, documento: true, ehCliente: true,
          ehFornecedor: true, cidade: true, estado: true, inativo: true, bloqueado: true, dataCadastroOmie: true,
          primeiraVezEm: true, contaBancariaAlteradaEm: true,
        },
      });
      registrar("parceiro", input, `${linhas.length} cadastro(s)`);
      return JSON.stringify(
        linhas.map((p) => ({
          ...p,
          // CPF de pessoa física nunca sai inteiro daqui: mesma regra das telas.
          documento: mascarar(p.documento),
          cadastradoNaOmieEm: p.dataCadastroOmie ? fmtData(p.dataCadastroOmie) : null,
          vistoAquiPelaPrimeiraVezEm: p.primeiraVezEm ? fmtData(p.primeiraVezEm) : null,
          contaBancariaAlteradaEm: p.contaBancariaAlteradaEm ? fmtData(p.contaBancariaAlteradaEm) : null,
          dataCadastroOmie: undefined, primeiraVezEm: undefined,
        }))
      );
    },
  });

  const projetoOs = betaZodTool({
    name: "ordem_de_servico",
    description:
      "Tudo de uma ordem de serviço (projeto da Omie): custos lançados nela e o que foi faturado contra ela. Use para a pergunta 'esta OS foi paga e não faturada?'.",
    inputSchema: z.object({ codigo: z.string().describe("Código do projeto/OS, ex.: 14516.") }),
    run: async (input) => {
      const [projeto, titulos] = await Promise.all([
        prisma.omieProjeto.findFirst({ where: { ...base, codigo: input.codigo }, select: { nome: true, inativo: true, conexaoApelido: true } }),
        prisma.omieTitulo.findMany({
          where: { ...base, projetoCodigo: input.codigo },
          orderBy: [{ natureza: "asc" }, { dataVencimento: "asc" }],
          take: LIMITE_DE_LINHAS,
          select: {
            id: true, conexaoApelido: true, natureza: true, numeroDocumento: true, numeroParcela: true, tipoDocumento: true,
            parceiroNome: true, categoriaDescricao: true, projetoCodigo: true, dataEmissao: true, dataVencimento: true,
            valorDocumentoCents: true, valorPagoCents: true, saldoCents: true, jurosCents: true, multaCents: true,
            descontoCents: true, liquidado: true, cancelado: true,
          },
        }),
      ]);
      const soma = (n: "PAGAR" | "RECEBER") =>
        titulos.filter((t) => t.natureza === n && !t.cancelado).reduce((acc, t) => acc + t.valorDocumentoCents, 0);
      registrar("ordem_de_servico", input, `custo ${fmtBRL(soma("PAGAR"))}, faturado ${fmtBRL(soma("RECEBER"))}, ${titulos.length} título(s)`);
      return JSON.stringify({
        projeto: projeto ?? { aviso: "projeto não encontrado no espelho; os títulos abaixo são os que citam este código" },
        custoLancado: fmtBRL(soma("PAGAR")),
        faturado: fmtBRL(soma("RECEBER")),
        titulos: titulos.map(formatarTitulo),
      });
    },
  });

  // PROPOR, NÃO GRAVAR. A única ferramenta que fala de escrita, e ela não
  // escreve: registra a proposta na lista de consultas da investigação, e a
  // tela mostra um botão "Aplicar" que chama a MESMA ação de tratativa que
  // uma pessoa usaria — com a sessão dela, a permissão dela e a trilha com o
  // nome dela. O modelo sugere; quem decide continua sendo quem clica.
  const proporTratativa = betaZodTool({
    name: "propor_tratativa",
    description:
      "Propõe a tratativa de UM achado (resolvido, não se aplica ou em análise) com a justificativa que a evidência sustenta. Não grava nada: a pessoa vê a proposta na tela e decide aplicar. Use só depois de ter consultado a evidência do achado.",
    inputSchema: z.object({
      achadoId: z.string().describe("Id do achado (o campo id de listar_achados/detalhar_achado)."),
      status: z.enum(["RESOLVIDO", "IGNORADO", "EM_ANALISE"]).describe("IGNORADO = não se aplica."),
      justificativa: z.string().min(10).max(600).describe("O que foi verificado e por quê a decisão se sustenta. Fica gravada no achado."),
      responsavel: z.string().max(120).optional().describe("Área ou pessoa que deve tratar, quando for EM_ANALISE."),
    }),
    run: async (input) => {
      const a = await prisma.auditFinding.findFirst({
        where: { ...base, id: input.achadoId },
        select: { id: true, regra: true, titulo: true, status: true },
      });
      if (!a) {
        registrar("propor_tratativa", input, "achado não encontrado");
        return JSON.stringify({ erro: "achado não encontrado nesta empresa" });
      }
      if (a.status === "RESOLVIDO" || a.status === "IGNORADO") {
        registrar("propor_tratativa", input, `já tratado (${a.status})`);
        return JSON.stringify({ aviso: `o achado já está ${a.status}; nada a propor` });
      }
      registrar("propor_tratativa", input, `proposta: ${input.status} para ${a.regra} — ${a.titulo}`);
      return JSON.stringify({
        ok: true,
        aviso: "Proposta registrada. Ela aparece na tela com um botão para a pessoa aplicar; até lá, nada mudou. Diga isso na resposta.",
      });
    },
  });

  return [listarAchados, detalharAchado, titulosDoParceiro, titulo, serieMensal, parceiro, projetoOs, proporTratativa];
}

function formatarTitulo(t: {
  id: string; conexaoApelido: string; natureza: string; numeroDocumento: string | null; numeroParcela: string | null;
  tipoDocumento: string | null; parceiroNome: string | null; categoriaDescricao: string | null; projetoCodigo: string | null;
  dataEmissao: Date | null; dataVencimento: Date; valorDocumentoCents: number; valorPagoCents: number; saldoCents: number | null;
  jurosCents: number; multaCents: number; descontoCents: number; liquidado: boolean; cancelado: boolean;
}) {
  return {
    id: t.id, empresa: t.conexaoApelido, natureza: t.natureza, documento: t.numeroDocumento, parcela: t.numeroParcela,
    tipo: t.tipoDocumento, parceiro: t.parceiroNome, categoria: t.categoriaDescricao, projeto: t.projetoCodigo,
    emissao: t.dataEmissao ? fmtData(t.dataEmissao) : null, vencimento: fmtData(t.dataVencimento),
    valor: fmtBRL(t.valorDocumentoCents), pago: fmtBRL(t.valorPagoCents), saldo: t.saldoCents === null ? null : fmtBRL(t.saldoCents),
    juros: t.jurosCents ? fmtBRL(t.jurosCents) : null, multa: t.multaCents ? fmtBRL(t.multaCents) : null,
    desconto: t.descontoCents ? fmtBRL(t.descontoCents) : null,
    situacao: t.cancelado ? "cancelado" : t.liquidado ? "liquidado" : "em aberto",
  };
}

function mascarar(documento: string | null): string | null {
  if (!documento) return null;
  const d = documento.replace(/\D/g, "");
  if (d.length === 11) return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return documento;
}

// Percorre um JSON livre (a evidência) e mascara qualquer string de 11
// dígitos sob chave que fale em documento/CPF/CNPJ, em qualquer nível.
function mascararDocumentos(valor: unknown, chave = ""): unknown {
  if (Array.isArray(valor)) return valor.map((v) => mascararDocumentos(v, chave));
  if (valor && typeof valor === "object") {
    return Object.fromEntries(Object.entries(valor as Record<string, unknown>).map(([k, v]) => [k, mascararDocumentos(v, k)]));
  }
  if (typeof valor === "string" && /documento|cpf|cnpj/i.test(chave) && /^\d{11}$/.test(valor.trim())) return mascarar(valor);
  return valor;
}

// RODADAS. Uma investigação são várias chamadas ao modelo, cada uma de dezenas
// de segundos, e a hospedagem corta a requisição num teto (300 segundos na
// tela de investigar, com Fluid Compute ligado). Então nenhuma requisição
// tenta fazer a investigação inteira: cada uma avança as chamadas que cabem no
// orçamento, grava a conversa e as consultas, e a próxima continua de onde
// parou. Quem encadeia as rodadas é o navegador de quem perguntou, como na
// sincronização.
//
// Uma chamada nova só começa se ainda houver folga para ela terminar dentro do
// teto. O orçamento fica bem abaixo dele de propósito: estourar o teto no meio
// de uma chamada perde a rodada inteira, e o modelo com ferramentas costuma
// levar de dez a sessenta segundos por resposta. Com 90 segundos de orçamento
// e uma chamada de até um minuto em curso, a rodada fecha em menos de três.
const ORCAMENTO_DA_RODADA_MS = 90_000;

function mensagemInicial(params: { empresa: string; pergunta: string }): Anthropic.Beta.BetaMessageParam {
  return {
    role: "user",
    content: `Recorte: ${params.empresa}. Hoje é ${fmtData(new Date())}.

Pergunta da controladoria:
${params.pergunta.trim()}`,
  };
}

function estadoDe(row: {
  id: string; status: string; pergunta: string; empresa: string; resposta: string | null; erro: string | null;
  consultas: unknown; iteracoes: number; modelo: string | null; criadoEm: Date; userNome: string | null;
}): EstadoInvestigacao {
  return {
    id: row.id,
    status: row.status as StatusInvestigacao,
    pergunta: row.pergunta,
    empresa: row.empresa,
    resposta: row.resposta,
    erro: row.erro,
    consultas: Array.isArray(row.consultas) ? (row.consultas as ConsultaFeita[]) : [],
    iteracoes: row.iteracoes,
    modelo: row.modelo,
    criadoEm: row.criadoEm,
    userNome: row.userNome,
  };
}

export async function iniciarInvestigacao(params: {
  companyId: string;
  conexaoId: string | null;
  empresa: string;
  pergunta: string;
  userId: string | null;
  userNome: string | null;
}): Promise<EstadoInvestigacao> {
  const row = await prisma.investigacao.create({
    data: {
      companyId: params.companyId,
      conexaoId: params.conexaoId,
      empresa: params.empresa,
      pergunta: params.pergunta.trim(),
      userId: params.userId,
      userNome: params.userNome,
      mensagens: [mensagemInicial(params)] as unknown as Prisma.InputJsonValue,
      consultas: [],
    },
  });
  return estadoDe(row);
}

export async function lerInvestigacao(id: string, companyId: string): Promise<EstadoInvestigacao | null> {
  const row = await prisma.investigacao.findFirst({ where: { id, companyId } });
  return row ? estadoDe(row) : null;
}

export async function listarInvestigacoes(companyId: string, limite = 10): Promise<EstadoInvestigacao[]> {
  const rows = await prisma.investigacao.findMany({
    where: { companyId },
    orderBy: { criadoEm: "desc" },
    take: limite,
  });
  return rows.map(estadoDe);
}

// Avança uma investigação em andamento pelo que couber no orçamento da rodada.
// Idempotente por construção: se duas rodadas disputarem a mesma investigação,
// a segunda lê o estado gravado pela primeira e continua dali.
export async function avancarInvestigacao(id: string, companyId: string): Promise<EstadoInvestigacao> {
  const row = await prisma.investigacao.findFirst({ where: { id, companyId } });
  if (!row) throw new Error("investigação não encontrada");
  if (row.status !== "EXECUTANDO") return estadoDe(row);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return encerrar(row.id, { erro: "Investigação indisponível: ANTHROPIC_API_KEY não configurada." });

  const client = new Anthropic({ apiKey });
  const consultas: ConsultaFeita[] = Array.isArray(row.consultas) ? (row.consultas as ConsultaFeita[]) : [];
  let mensagens = row.mensagens as unknown as Anthropic.Beta.BetaMessageParam[];
  let iteracoes = row.iteracoes;
  const inicio = Date.now();

  try {
    while (true) {
      const runner = client.beta.messages.toolRunner({
        model: MODELO_INVESTIGADOR,
        max_tokens: 16000,
        // Esforço alto, e não médio como no modelo maior: o Sonnet respeita o
        // nível à risca e em esforço baixo tende a responder menos do que a
        // pergunta pede. Se uma resposta parecer rasa, o ajuste é subir para
        // xhigh — não trocar de modelo.
        output_config: { effort: "high" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: SYSTEM_PROMPT,
        tools: ferramentas({ companyId: row.companyId, conexaoId: row.conexaoId }, consultas),
        messages: mensagens,
      });

      // UMA chamada ao modelo por volta do laço. O runner faria o ciclo inteiro
      // sozinho; aqui ele é interrompido depois da primeira resposta, e as
      // ferramentas que ela pediu são executadas explicitamente, para que a
      // conversa possa ser gravada entre uma chamada e outra.
      let message: Anthropic.Beta.BetaMessage | null = null;
      for await (const m of runner) {
        message = m;
        break;
      }
      if (!message) throw new Error("o modelo não devolveu resposta");
      iteracoes++;

      if (message.stop_reason === "refusal") {
        return encerrar(row.id, {
          erro: `O modelo recusou esta investigação (categoria ${message.stop_details?.category ?? "não informada"}). Reformule a pergunta ou faça a consulta pelas telas.`,
          mensagens, consultas, iteracoes,
        });
      }

      if (message.stop_reason === "tool_use") {
        const respostaDasFerramentas = await runner.generateToolResponse();
        mensagens = [
          ...mensagens,
          { role: "assistant", content: message.content },
          ...(respostaDasFerramentas ? [respostaDasFerramentas] : []),
        ];

        if (iteracoes >= MAXIMO_DE_CONSULTAS) {
          return encerrar(row.id, {
            erro: `A investigação atingiu o limite de ${MAXIMO_DE_CONSULTAS} consultas sem fechar uma resposta. Faça uma pergunta mais específica.`,
            mensagens, consultas, iteracoes,
          });
        }

        const parcial = await prisma.investigacao.update({
          where: { id: row.id },
          data: {
            mensagens: mensagens as unknown as Prisma.InputJsonValue,
            consultas: consultas as unknown as Prisma.InputJsonValue,
            iteracoes,
          },
        });
        if (Date.now() - inicio > ORCAMENTO_DA_RODADA_MS) return estadoDe(parcial);
        continue;
      }

      // end_turn (ou max_tokens): o modelo fechou a resposta.
      const texto = message.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      mensagens = [...mensagens, { role: "assistant", content: message.content }];

      if (!texto) {
        return encerrar(row.id, { erro: "O modelo não devolveu texto.", mensagens, consultas, iteracoes });
      }
      return encerrar(row.id, { resposta: texto, modelo: message.model, mensagens, consultas, iteracoes });
    }
  } catch (e) {
    const erro =
      e instanceof Anthropic.APIError
        ? `A API respondeu ${e.status ?? "sem status"}: ${e.message.slice(0, 300)}`
        : e instanceof Error
          ? e.message.slice(0, 300)
          : "erro desconhecido";
    return encerrar(row.id, { erro: `A investigação não completou: ${erro}`, mensagens, consultas, iteracoes });
  }
}

async function encerrar(
  id: string,
  fim: {
    resposta?: string;
    modelo?: string;
    erro?: string;
    mensagens?: Anthropic.Beta.BetaMessageParam[];
    consultas?: ConsultaFeita[];
    iteracoes?: number;
  }
): Promise<EstadoInvestigacao> {
  const row = await prisma.investigacao.update({
    where: { id },
    data: {
      status: fim.erro ? "ERRO" : "CONCLUIDA",
      resposta: fim.resposta ?? null,
      modelo: fim.modelo ?? null,
      erro: fim.erro ?? null,
      ...(fim.mensagens ? { mensagens: fim.mensagens as unknown as Prisma.InputJsonValue } : {}),
      ...(fim.consultas ? { consultas: fim.consultas as unknown as Prisma.InputJsonValue } : {}),
      ...(fim.iteracoes !== undefined ? { iteracoes: fim.iteracoes } : {}),
      concluidaEm: new Date(),
    },
  });
  return estadoDe(row);
}
