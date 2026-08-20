import type { ConformidadeArea } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizarTexto, STATUS_EM_ABERTO } from "./tipos";

// CONCILIAÇÃO ENTRE O QUE A CONSULTORIA APONTA E O QUE OS AGENTES VEEM.
//
// É a razão de o módulo existir. Separadas, as duas leituras são um relatório
// mensal em PDF e uma lista diária de achados. Cruzadas, viram três respostas
// que nenhuma das duas dá sozinha:
//
//   CONFIRMADO — a consultoria apontou e os dados confirmam. Deixa de ser
//   opinião de terceiro: é fato com evidência interna, e sobe de prioridade.
//
//   PONTO CEGO DO SISTEMA — a consultoria apontou e nenhum agente vê nada
//   parecido. Ou o risco está fora do alcance dos dados da Omie (trabalhista,
//   contratual, societário — e aí a consultoria é insubstituível), ou falta uma
//   regra aqui. As duas conclusões são acionáveis.
//
//   PONTO CEGO DA CONSULTORIA — achado relevante que nenhum apontamento cobre.
//   Vale a pergunta no próximo trabalho dela.
//
// O pareamento é DETERMINÍSTICO, por sobreposição de vocabulário e afinidade de
// área. Não usa IA de propósito: é uma decisão que precisa ser explicável ("estes
// dois textos têm estas 5 palavras em comum e a área bate com a família da
// regra"), reprodutível e revisável — e o resultado nasce como SUGESTÃO, que só
// vira confirmação quando uma pessoa concorda.

// Famílias de regra que costumam corresponder a cada área. Não é para o
// pareamento depender disso — a sobreposição de texto é o critério principal —
// mas para desempatar: "juros" num apontamento fiscal e "juros" num achado de
// contas a pagar podem ser o mesmo assunto ou dois completamente diferentes.
const AFINIDADE_POR_AREA: Record<ConformidadeArea, string[]> = {
  FISCAL: ["FI-"],
  CONTABIL: ["CB-", "CP-SEM-CATEGORIA", "AD-", "FI-"],
  FINANCEIRO: ["CP-", "CR-", "CB-", "FC-", "OP-", "FR-"],
  CONTRATUAL: ["CR-", "RE-", "CU-CONCENTRACAO-FORNECEDOR"],
  // Estas quatro não têm família correspondente: este sistema lê o financeiro
  // da Omie, não a folha, o contrato social nem o inventário de dados pessoais.
  // A lista vazia é o desenho, não um esquecimento — é ela que faz o
  // apontamento cair corretamente em "ponto cego do sistema".
  TRABALHISTA: [],
  PREVIDENCIARIO: [],
  SOCIETARIO: [],
  LGPD: [],
  REGULATORIO: [],
  OUTRO: [],
};

// Abaixo disso a semelhança é coincidência de vocabulário. Calibrado para errar
// para o lado de sugerir de menos: uma sugestão falsa custa a atenção de quem
// revisa, e é assim que uma lista de sugestões deixa de ser lida.
const PONTUACAO_MINIMA = 45;
const PALAVRAS_COMUNS_MINIMAS = 3;
const MAXIMO_SUGESTOES_POR_APONTAMENTO = 3;

// Palavras que aparecem em quase todo texto financeiro e por isso não provam
// semelhança nenhuma entre dois deles.
const VOCABULARIO_VAZIO = new Set([
  "empresa", "valor", "valores", "total", "mes", "meses", "ano", "periodo", "data", "conforme", "sobre",
  "para", "pela", "pelo", "sendo", "deve", "devem", "pode", "podem", "risco", "riscos", "processo",
  "processos", "sistema", "referente", "relativo", "identificado", "identificados", "verificado",
  "verificamos", "observado", "constatado", "recomenda", "recomendamos", "necessario", "necessaria",
  "titulo", "titulos", "controladoria", "auditoria", "financeiro", "financeira",
]);

function vocabulario(...textos: (string | null | undefined)[]): Set<string> {
  const palavras = normalizarTexto(textos.filter(Boolean).join(" "))
    .split(" ")
    .filter((p) => p.length >= 4 && !VOCABULARIO_VAZIO.has(p) && !/^\d+$/.test(p));
  return new Set(palavras);
}

// Sobreposição sobre o MENOR dos dois conjuntos, e não sobre a união (Jaccard).
// O achado tem descrição curta e o apontamento da consultoria costuma ter três
// parágrafos: com Jaccard, o texto mais longo puxaria toda pontuação para baixo
// e o par correto nunca apareceria.
export function pontuarSemelhanca(
  apontamento: { titulo: string; descricao: string; area: ConformidadeArea },
  achado: { titulo: string; descricao: string; regra: string }
): number {
  const a = vocabulario(apontamento.titulo, apontamento.descricao);
  const b = vocabulario(achado.titulo, achado.descricao);
  if (a.size === 0 || b.size === 0) return 0;

  const comuns = [...a].filter((p) => b.has(p)).length;
  if (comuns < PALAVRAS_COMUNS_MINIMAS) return 0;

  const base = (comuns / Math.min(a.size, b.size)) * 100;
  const afim = AFINIDADE_POR_AREA[apontamento.area].some((prefixo) => achado.regra.startsWith(prefixo));
  return Math.round(Math.min(100, afim ? base + 15 : base));
}

export type ResultadoConciliacao = {
  sugeridos: number;
  removidos: number;
  apontamentosComVinculo: number;
  apontamentosSemVinculo: number;
};

// Roda depois da auditoria do dia (e sob demanda, quando um documento novo é
// processado). Reavalia as sugestões automáticas inteiras a cada execução: um
// achado fechado ontem não pode continuar "confirmando" um apontamento hoje.
export async function conciliarConformidade(companyId: string): Promise<ResultadoConciliacao> {
  const [apontamentos, achados, vinculos] = await Promise.all([
    prisma.conformidadeApontamento.findMany({
      where: { companyId, status: { in: STATUS_EM_ABERTO } },
      select: { id: true, titulo: true, descricao: true, area: true },
    }),
    prisma.auditFinding.findMany({
      where: { companyId, status: { in: ["ABERTO", "EM_ANALISE"] } },
      select: { id: true, chave: true, titulo: true, descricao: true, regra: true },
    }),
    prisma.conformidadeVinculo.findMany({ where: { companyId } }),
  ]);

  const confirmados = new Set(vinculos.filter((v) => !v.automatico).map((v) => `${v.apontamentoId}|${v.achadoId}`));
  const automaticos = new Map(vinculos.filter((v) => v.automatico).map((v) => [`${v.apontamentoId}|${v.achadoId}`, v]));

  const desejados = new Map<string, { apontamentoId: string; achadoId: string; achadoChave: string; pontuacao: number }>();

  for (const apontamento of apontamentos) {
    const candidatos = achados
      .map((achado) => ({ achado, pontuacao: pontuarSemelhanca(apontamento, achado) }))
      .filter((c) => c.pontuacao >= PONTUACAO_MINIMA)
      .sort((x, y) => y.pontuacao - x.pontuacao)
      .slice(0, MAXIMO_SUGESTOES_POR_APONTAMENTO);

    for (const { achado, pontuacao } of candidatos) {
      const chave = `${apontamento.id}|${achado.id}`;
      // Par já confirmado por uma pessoa não é recalculado: a confirmação é
      // julgamento humano registrado, e sobrescrevê-la a cada madrugada
      // apagaria trabalho de revisão.
      if (confirmados.has(chave)) continue;
      desejados.set(chave, {
        apontamentoId: apontamento.id,
        achadoId: achado.id,
        achadoChave: achado.chave,
        pontuacao,
      });
    }
  }

  let sugeridos = 0;
  for (const [chave, dados] of desejados) {
    const existente = automaticos.get(chave);
    if (existente) {
      if (existente.pontuacao !== dados.pontuacao) {
        await prisma.conformidadeVinculo.update({ where: { id: existente.id }, data: { pontuacao: dados.pontuacao } });
      }
      continue;
    }
    await prisma.conformidadeVinculo.create({
      data: {
        companyId,
        apontamentoId: dados.apontamentoId,
        achadoId: dados.achadoId,
        achadoChave: dados.achadoChave,
        tipo: "CONFIRMA",
        automatico: true,
        pontuacao: dados.pontuacao,
      },
    });
    sugeridos++;
  }

  const obsoletos = [...automaticos.entries()].filter(([chave]) => !desejados.has(chave)).map(([, v]) => v.id);
  let removidos = 0;
  if (obsoletos.length > 0) {
    const resultado = await prisma.conformidadeVinculo.deleteMany({ where: { id: { in: obsoletos } } });
    removidos = resultado.count;
  }

  const comVinculo = new Set([...desejados.values()].map((d) => d.apontamentoId));
  for (const chave of confirmados) comVinculo.add(chave.split("|")[0]);

  return {
    sugeridos,
    removidos,
    apontamentosComVinculo: apontamentos.filter((a) => comVinculo.has(a.id)).length,
    apontamentosSemVinculo: apontamentos.filter((a) => !comVinculo.has(a.id)).length,
  };
}
