import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { AuditSeveridade, AuditStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { fmtBRL, fmtData } from "./format";
import { AGENTES } from "./registry";
import { MODELO_ANALISTA } from "./aiAnalyst";

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

export type ResultadoInvestigacao =
  | { ok: true; resposta: string; consultas: ConsultaFeita[]; modelo: string; iteracoes: number }
  | { ok: false; erro: string; consultas: ConsultaFeita[] };

export function isInvestigadorDisponivel(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// Teto de idas e vindas entre o modelo e as consultas. Oito cabem no teto de
// sessenta segundos da tela (ver maxDuration em auditoria/investigar/page.tsx)
// e respondem qualquer pergunta específica; acima disso é o modelo vagando,
// e cada volta custa tempo da pessoa que espera e dinheiro.
const MAXIMO_DE_CONSULTAS = 8;
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
- Diga o que NÃO dá para saber com esta base. O espelho não tem extrato bancário, não tem CT-e emitido, e a janela dos agentes é o ano corrente mais os títulos em aberto. Se a resposta depende de algo fora disso, diga que depende e do quê.
- Nunca conclua fraude. Aponte o indício, a hipótese e o que uma pessoa precisa verificar para confirmar ou descartar. Indício não é conclusão.
- Você não altera nada e não deve prometer alteração: não trata achado, não corrige título, não fala com a Omie. Se a pessoa pedir isso, diga onde ela faz.

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
        ...(input.entidade ? { entidadeRef: { contains: input.entidade, mode: "insensitive" } } : {}),
      };
      // Achado do grupo (conexão nula) entra em qualquer recorte de empresa:
      // ele fala das duas, e omiti-lo faria a empresa parecer mais tranquila.
      if (escopo.conexaoId) {
        delete (where as { conexaoId?: unknown }).conexaoId;
        where.OR = [{ conexaoId: escopo.conexaoId }, { conexaoId: null }];
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

  return [listarAchados, detalharAchado, titulosDoParceiro, titulo, serieMensal, parceiro, projetoOs];
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

export async function investigar(params: {
  companyId: string;
  conexaoId: string | null;
  pergunta: string;
  // Rótulo da empresa para o modelo saber que recorte está vendo.
  empresa: string;
}): Promise<ResultadoInvestigacao> {
  const consultas: ConsultaFeita[] = [];
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, erro: "Investigação indisponível: ANTHROPIC_API_KEY não configurada.", consultas };

  const client = new Anthropic({ apiKey });
  const hoje = new Date();

  try {
    const runner = client.beta.messages.toolRunner({
      model: MODELO_ANALISTA,
      max_tokens: 16000,
      // Esforço médio: é uma conversa com alguém esperando na tela, dentro do
      // teto de execução da hospedagem. O que decide a qualidade aqui é a
      // consulta certa, não a deliberação longa — e o modelo faz isso bem
      // mesmo em esforço médio.
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      max_iterations: MAXIMO_DE_CONSULTAS,
      system: SYSTEM_PROMPT,
      tools: ferramentas({ companyId: params.companyId, conexaoId: params.conexaoId }, consultas),
      messages: [
        {
          role: "user",
          content: `Recorte: ${params.empresa}. Hoje é ${fmtData(hoje)}.

Pergunta da controladoria:
${params.pergunta.trim()}`,
        },
      ],
    });

    const final = await runner.runUntilDone();

    if (final.stop_reason === "refusal") {
      return {
        ok: false,
        erro: `O modelo recusou esta investigação (categoria ${final.stop_details?.category ?? "não informada"}). Reformule a pergunta ou faça a consulta pelas telas.`,
        consultas,
      };
    }

    const texto = final.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    if (!texto) {
      return {
        ok: false,
        erro:
          final.stop_reason === "tool_use"
            ? `A investigação atingiu o limite de ${MAXIMO_DE_CONSULTAS} consultas sem fechar uma resposta. Faça uma pergunta mais específica.`
            : "O modelo não devolveu texto.",
        consultas,
      };
    }

    return { ok: true, resposta: texto, consultas, modelo: final.model, iteracoes: consultas.length };
  } catch (e) {
    const erro =
      e instanceof Anthropic.APIError
        ? `A API respondeu ${e.status ?? "sem status"}: ${e.message.slice(0, 300)}`
        : e instanceof Error
          ? e.message.slice(0, 300)
          : "erro desconhecido";
    return { ok: false, erro: `A investigação não completou: ${erro}`, consultas };
  }
}
