// A RÉGUA DA IA — `npm run regua:ia` (gasta API de verdade; ver o teto abaixo).
//
// Trocar de modelo sem medir é palpite. Esta régua roda os MESMOS pedidos de
// produção (os mesmos prompts e formatos, montados pelas mesmas funções) em
// mais de um modelo e nível de esforço, sobre casos SINTÉTICOS com resposta
// conhecida, e mede três coisas: acerto, tempo e custo.
//
//   - Leitura do relatório diário: tem teto de 50 s em produção. A pergunta é
//     qual nível de esforço do Fable 5.2 cabe nele sem perder acerto.
//   - Parecer mensal: o nível médio entrega o mesmo que o alto?
//   - Leitura de conformidade: o modelo barato acha o que o maior acha?
//
// Nenhum dado real entra aqui: os casos são inventados, com os fatos que a
// resposta tem de trazer e os números que ela pode citar. O que se mede é o
// comportamento do modelo, não a base.
//
// USO
//   Pelo botão: Actions → Régua da IA → Run workflow (.github/workflows/regua-ia.yml).
//   ANTHROPIC_API_KEY=... npm run regua:ia              (tudo)
//   ... npm run regua:ia -- --familia narrativa         (uma família)
//   ... npm run regua:ia -- --teto-usd 8 --saida /caminho/regua.md
//
// O TETO (padrão US$ 15) interrompe a régua quando o custo acumulado passa
// dele: as chamadas já feitas entram no relatório, as demais ficam marcadas.
import { writeFileSync } from "node:fs";
import type Anthropic from "@anthropic-ai/sdk";
import { clienteDaIa } from "../src/lib/ia/cliente";
import { custoMicroUsd, fmtUsd } from "../src/lib/ia/precos";
import { NarrativaSchema, pedidoDaNarrativa } from "../src/lib/controladoria/aiAnalyst";
import { ParecerSchema, pedidoDoParecer } from "../src/lib/controladoria/parecerMensal";
import { interpretarLeitura, montarPedidoDeLeitura } from "../src/lib/conformidade/analise";

type Esforco = "low" | "medium" | "high";
type Config = { nome: string; modelo: string; esforco: Esforco };
type Conferencia = { nome: string; ok: boolean };
type Pedido = Parameters<Anthropic["beta"]["messages"]["create"]>[0];
type Caso = {
  nome: string;
  pedido: (c: Config) => Pedido;
  conferir: (message: Anthropic.Beta.BetaMessage) => Conferencia[];
};
type Familia = { id: string; titulo: string; tetoMs: number | null; configs: Config[]; casos: Caso[] };

const ATUAL_51: Config = { nome: "Fable 5.1 · alto (o de antes)", modelo: "claude-fable-5-1", esforco: "high" };
const F52 = (esforco: Esforco): Config => ({ nome: `Fable 5.2 · ${{ low: "baixo", medium: "médio", high: "alto" }[esforco]}`, modelo: "claude-fable-5-2", esforco });
const SONNET: Config = { nome: "Sonnet 5 · médio (o de hoje)", modelo: "claude-sonnet-5", esforco: "medium" };

const texto = (m: Anthropic.Beta.BetaMessage) => m.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("");
const semEspacos = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

// Todo valor em reais citado na resposta tem de existir, igual, no que foi
// entregue ao modelo. É a regra número um dos três prompts.
function numerosSaemDoBriefing(resposta: string, briefing: string): Conferencia {
  const citados = [...resposta.matchAll(/R\$\s?-?[\d.]+,\d{2}/g)].map((m) => m[0].replace(/\s/g, ""));
  const fonte = briefing.replace(/R\$\s/g, "R$");
  const inventados = citados.filter((n) => !fonte.includes(n));
  return { nome: `só números do briefing${inventados.length ? ` (inventou ${inventados.slice(0, 3).join(", ")})` : ""}`, ok: inventados.length === 0 };
}
const menciona = (nome: string, resposta: string, ...padroes: RegExp[]): Conferencia => ({ nome, ok: padroes.every((p) => p.test(resposta)) });

// ---------------------------------------------------------------------------
// Família 1 — leitura do relatório diário
// ---------------------------------------------------------------------------
const BRIEFING_FRAUDE = `RELATÓRIO DE 12/10/2026 (dados de D-1)

## DRE gerencial (estrutura do art. 187, competência por emissão)
- setembro de 2026 (último mês fechado): receita líquida R$ 1.842.300,00, EBIT R$ 212.450,00, resultado antes dos investimentos R$ 187.900,00, resultado líquido R$ 141.200,00, margem líquida 7,7%; em categoria não confirmada R$ 18.400,00, sem categoria R$ 0,00
- Os números abaixo, de títulos, são volume de títulos a receber e a pagar — não são o resultado.

## Títulos por competência
- Dia: receita R$ 61.200,00, despesa R$ 88.730,00, resultado R$ -27.530,00
- Mês atual: receita R$ 702.900,00 (+3,1% vs. mesmo período do mês anterior), despesa R$ 655.400,00 (+9,8%), resultado R$ 47.500,00, margem 6,8%
- Mês anterior fechado: receita R$ 1.901.000,00, resultado R$ 152.300,00

## Caixa e prazos
- Saldo atual: R$ 318.700,00
- A pagar em aberto: R$ 912.400,00 (vencido: R$ 44.100,00)
- A receber em aberto: R$ 1.205.800,00 (vencido: R$ 286.300,00)
- Ciclo financeiro: 21 dias (PMR 38, PMP 17)
- Projeção 7 dias: saldo R$ 141.900,00
- Projeção 30 dias: saldo R$ -62.400,00

## Perdas financeiras do mês
- Juros R$ 3.210,00, multa R$ 1.140,00, tarifa R$ 890,00, desconto concedido R$ 0,00 — total R$ 5.240,00

## Maiores despesas do mês (por fornecedor)
- Posto Rota Sul Ltda: R$ 184.300,00 em 22 título(s)
- Viação Peças e Serviços Ltda: R$ 96.750,00 em 9 título(s)
- Seguradora Horizonte S.A.: R$ 71.200,00 em 2 título(s)

## Indicadores do BSC
- [VERMELHO] Inadimplência acima de 30 dias: 9,4% (meta 5)
- [VERDE] Margem líquida do mês fechado: 7,7% (meta 6)

## Achados de auditoria validados (4)
- [FR-BOLETO-TROCADO] (CRITICA/FRAUDE) Boleto com linha digitável diferente da registrada na Omie — Viação Peças e Serviços Ltda — valor R$ 48.900,00
- [FR-CONTA-ALTERADA] (ALTA/FRAUDE) Conta bancária do fornecedor alterada 3 dias antes do vencimento — Viação Peças e Serviços Ltda — valor R$ 48.900,00
- [CR-VENCIDO] (ALTA/RISCO_FINANCEIRO) Cliente com títulos vencidos há mais de 60 dias — Prefeitura de Vale Verde — valor R$ 198.400,00, impacto estimado R$ 198.400,00
- [CP-JUROS] (MEDIA/PERDA_FINANCEIRA) Juros pagos por atraso no mês — valor R$ 3.210,00, impacto estimado R$ 3.210,00`;

const BRIEFING_CALMO = `RELATÓRIO DE 20/10/2026 (dados de D-1)

## DRE gerencial (estrutura do art. 187, competência por emissão)
- setembro de 2026 (último mês fechado): receita líquida R$ 1.842.300,00, EBIT R$ 212.450,00, resultado antes dos investimentos R$ 187.900,00, resultado líquido R$ 141.200,00, margem líquida 7,7%; em categoria não confirmada R$ 0,00, sem categoria R$ 0,00
- Os números abaixo, de títulos, são volume de títulos a receber e a pagar — não são o resultado.

## Títulos por competência
- Dia: receita R$ 74.800,00, despesa R$ 52.100,00, resultado R$ 22.700,00
- Mês atual: receita R$ 1.214.500,00 (+1,2% vs. mesmo período do mês anterior), despesa R$ 1.098.300,00 (+0,9%), resultado R$ 116.200,00, margem 9,6%
- Mês anterior fechado: receita R$ 1.901.000,00, resultado R$ 152.300,00
- ATENÇÃO: a base não cobre o ano anterior inteiro; comparações anuais não têm base confiável.

## Caixa e prazos
- Saldo atual: R$ 402.900,00
- A pagar em aberto: R$ 730.100,00 (vencido: R$ 0,00)
- A receber em aberto: R$ 1.011.600,00 (vencido: R$ 31.400,00)
- Ciclo financeiro: 19 dias (PMR 35, PMP 16)
- Projeção 7 dias: saldo R$ 388.200,00
- Projeção 30 dias: saldo R$ 455.700,00

## Perdas financeiras do mês
- Juros R$ 0,00, multa R$ 0,00, tarifa R$ 910,00, desconto concedido R$ 0,00 — total R$ 910,00

## Indicadores do BSC
- [VERDE] Inadimplência acima de 30 dias: 2,6% (meta 5)
- [VERDE] Margem líquida do mês fechado: 7,7% (meta 6)

## Achados de auditoria validados (1)
- [CP-TARIFA] (BAIXA/PERDA_FINANCEIRA) Tarifas bancárias do mês — valor R$ 910,00

## Limitações da base nesta execução
- A conta corrente do Banco B não foi sincronizada hoje: o saldo atual pode estar desatualizado.`;

const narrativa: Familia = {
  id: "narrativa",
  titulo: "Leitura do relatório diário (teto de 50 s em produção)",
  tetoMs: 50_000,
  configs: [ATUAL_51, F52("low"), F52("medium"), F52("high")],
  casos: [
    {
      nome: "dia com indício de fraude e caixa apertando",
      pedido: (c) => pedidoDaNarrativa(BRIEFING_FRAUDE, { modelo: c.modelo, esforco: c.esforco }),
      conferir: (m) => {
        const t = texto(m);
        const lida = NarrativaSchema.safeParse((() => { try { return JSON.parse(t); } catch { return null; } })());
        return [
          { nome: "veio no formato", ok: lida.success },
          numerosSaemDoBriefing(t, BRIEFING_FRAUDE),
          menciona("liga os dois achados do mesmo fornecedor (boleto trocado + conta alterada)", t, /Viação Peças/i, /FR-BOLETO-TROCADO/, /FR-CONTA-ALTERADA/),
          menciona("aponta o caixa negativo em 30 dias", t, /62\.400,00/),
          menciona("traz uma ação para hoje", t, /"prazo"\s*:\s*"HOJE"/),
        ];
      },
    },
    {
      nome: "dia calmo, com limitação da base",
      pedido: (c) => pedidoDaNarrativa(BRIEFING_CALMO, { modelo: c.modelo, esforco: c.esforco }),
      conferir: (m) => {
        const t = texto(m);
        const lida = NarrativaSchema.safeParse((() => { try { return JSON.parse(t); } catch { return null; } })());
        return [
          { nome: "veio no formato", ok: lida.success },
          numerosSaemDoBriefing(t, BRIEFING_CALMO),
          menciona("diz que o saldo pode estar desatualizado (limitação da base)", t, /Banco B|não foi sincronizad|desatualizad/i),
          { nome: "não fabrica urgência: nenhuma ação para hoje", ok: !/"prazo"\s*:\s*"HOJE"/.test(t) },
          { nome: "não compara com o ano anterior (base não cobre)", ok: !/ano anterior|ano passado/i.test(t) || /não (cobre|têm|tem) base|sem base/i.test(t) },
        ];
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Família 2 — parecer mensal
// ---------------------------------------------------------------------------
const BRIEFING_MENSAL = `# Parecer mensal — setembro de 2026 — grupo (as duas empresas)

## Resultado do mês
{"mes":"setembro de 2026","receitaBruta":"R$ 2.104.800,00","deducoes":"R$ 262.500,00","receitaLiquida":"R$ 1.842.300,00","custoDosServicos":"R$ 1.371.900,00","despesasOperacionais":"R$ 257.950,00","ebit":"R$ 212.450,00","resultadoLiquido":"R$ 141.200,00","margemLiquida":"7,7%"}

## Comparativo (mês anterior e mesmo mês do ano passado)
{"mesAnterior":{"mes":"agosto de 2026","receitaLiquida":"R$ 1.901.000,00","resultadoLiquido":"R$ 152.300,00","margemLiquida":"8,0%"},"mesmoMesAnoAnterior":{"mes":"setembro de 2025","receitaLiquida":"R$ 1.610.700,00","resultadoLiquido":"R$ 88.600,00","margemLiquida":"5,5%"}}

## DRE do mês, com as principais categorias de cada linha
{"linhas":[{"linha":"DESPESA_VEICULOS","valor":"R$ 612.400,00","variacaoContraMesAnterior":"+11,8%","categorias":[{"nome":"Combustível","valor":"R$ 388.900,00","variacao":"+17,2%"},{"nome":"Manutenção","valor":"R$ 151.300,00","variacao":"+2,1%"}]},{"linha":"DESPESA_PESSOAL","valor":"R$ 604.700,00","variacaoContraMesAnterior":"+0,6%","categorias":[{"nome":"Salários de motoristas","valor":"R$ 421.000,00","variacao":"+0,4%"}]}]}

## Série de doze meses
{"meses":[{"mes":"2025-10","receitaLiquida":"R$ 1.655.200,00","margem":"5,9%"},{"mes":"2026-06","receitaLiquida":"R$ 1.812.900,00","margem":"7,1%"},{"mes":"2026-07","receitaLiquida":"R$ 1.866.400,00","margem":"7,6%"},{"mes":"2026-08","receitaLiquida":"R$ 1.901.000,00","margem":"8,0%"},{"mes":"2026-09","receitaLiquida":"R$ 1.842.300,00","margem":"7,7%"}],"observacao":"os meses de 2025-11 a 2026-05 não estão nesta amostra"}

## Em aberto por faixa de atraso
{"receber":{"aVencer":"R$ 919.500,00","ate30":"R$ 54.200,00","de31a60":"R$ 33.700,00","acimaDe60":"R$ 198.400,00"},"pagar":{"aVencer":"R$ 868.300,00","ate30":"R$ 44.100,00","de31a60":"R$ 0,00","acimaDe60":"R$ 0,00"}}

## Achados de auditoria
Abertos hoje, por severidade:
- CRITICA: 1 achado(s), valor R$ 48.900,00, impacto evitável sem valor
- ALTA: 3 achado(s), valor R$ 261.700,00, impacto evitável R$ 198.400,00

Surgiram no mês: 1 CRITICA, 2 ALTA. Resolvidos no mês: 4.

Críticos e altos abertos há mais de 30 dias (1 maiores):
- [ALTA] CR-VENCIDO — Cliente com títulos vencidos há mais de 60 dias (Prefeitura de Vale Verde) — valor R$ 198.400,00, impacto R$ 198.400,00 — aberto há 74 dias, 3 ocorrência(s), sem responsável`;

const parecer: Familia = {
  id: "parecer",
  titulo: "Parecer mensal do controller (em produção vai em lote, sem teto de tempo)",
  tetoMs: null,
  configs: [F52("medium"), F52("high")],
  casos: [
    {
      nome: "mês com combustível subindo e recebível parado",
      pedido: (c) => pedidoDoParecer(BRIEFING_MENSAL, { modelo: c.modelo, esforco: c.esforco }),
      conferir: (m) => {
        const t = texto(m);
        const lida = ParecerSchema.safeParse((() => { try { return JSON.parse(t); } catch { return null; } })());
        return [
          { nome: "veio no formato", ok: lida.success },
          numerosSaemDoBriefing(t, BRIEFING_MENSAL),
          menciona("identifica o combustível como o movimento de custo do mês", t, /combust[íi]vel/i, /17,2%|388\.900,00/),
          menciona("trata o recebível parado há 74 dias, sem responsável", t, /Vale Verde/i, /198\.400,00/),
          { nome: "no máximo três decisões", ok: lida.success ? lida.data.decisoes.length <= 3 && lida.data.decisoes.length >= 1 : false },
          menciona("declara que a série tem meses faltando", t, /amostra|não estão|faltam|incomplet/i),
        ];
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Família 3 — leitura de conformidade
// ---------------------------------------------------------------------------
const DOCUMENTO = `RELATÓRIO MENSAL DE CONFORMIDADE FISCAL — COMPETÊNCIA SETEMBRO/2026
Empresa: Transportes Exemplo Ltda (dados fictícios para teste)

1. GRADE DE ENTREGA — ISS
Acompanhamento de setembro/2026: recebido. Guia de recolhimento do ISS de setembro/2026: NÃO RECEBIDA.
Comprovante de pagamento do ISS de agosto/2026: recebido.

2. TABELA DE CONFORMIDADE — PIS/COFINS
Agosto/2026: apurado 41.280,00 | declarado na DCTFWeb 41.280,00 | pago 41.280,00 — conferido, sem divergência.
Setembro/2026: apurado 43.910,00 | declarado na DCTFWeb 39.400,00 | pago 39.400,00 — DIVERGÊNCIA de 4.510,00 entre o apurado e o declarado.
Comentário da consultoria: "A diferença de setembro decorre de receita financeira não incluída na base. Recomendamos retificar a DCTFWeb até 20/11/2026."

3. CERTIDÕES
Certidão federal: negativa, válida até 14/02/2027.
Certidão municipal (inscrição 4.112.337-9): não foi possível emitir a Certidão Negativa — consta débito de ISS em aberto.

4. DOCUMENTAÇÃO — PENDENTE
- Balancete do 3º trimestre de 2026.

5. HISTÓRICO
O gráfico de recolhimentos dos últimos doze meses segue anexo, sem observações.`;

const ESPERADOS: { nome: string; padrao: RegExp }[] = [
  { nome: "guia de ISS de setembro não recebida", padrao: /guia.*iss|iss.*guia/i },
  { nome: "divergência de PIS/COFINS em setembro", padrao: /pis|cofins|dctf/i },
  { nome: "certidão municipal não emitida", padrao: /certid[ãa]o.*municip|municip.*certid[ãa]o/i },
  { nome: "balancete do 3º trimestre pendente", padrao: /balancete/i },
];

const conformidade: Familia = {
  id: "conformidade",
  titulo: "Leitura do relatório de conformidade (em produção: Sonnet no dia a dia, Fable 5.2 alto na conferência)",
  tetoMs: null,
  configs: [SONNET, F52("low"), F52("high")],
  casos: [
    {
      nome: "relatório com quatro apontamentos e uma tabela que fecha certo",
      pedido: (c) => {
        const p = montarPedidoDeLeitura(
          { conteudo: Buffer.from(DOCUMENTO), arquivoNome: "relatorio-setembro.txt", mimeType: "text/plain", titulo: "Relatório mensal de conformidade fiscal", emissor: "Consultoria Exemplo", competencia: new Date(2026, 8, 1), empresa: "Transportes Exemplo" },
          { modelo: c.modelo, esforco: c.esforco },
        );
        if (!p.ok) throw new Error(p.erro);
        return p.corpo;
      },
      conferir: (m) => {
        const r = interpretarLeitura(m, null);
        if (!r.ok) return [{ nome: `veio no formato (${r.erro.slice(0, 80)})`, ok: false }];
        const lista = r.leitura.apontamentos;
        const alvo = (a: (typeof lista)[number]) => `${a.titulo} ${a.assuntoCanonico} ${a.descricao}`;
        const achados = ESPERADOS.map((e) => ({ nome: `achou: ${e.nome}`, ok: lista.some((a) => e.padrao.test(alvo(a))) }));
        const sobrando = lista.filter((a) => !ESPERADOS.some((e) => e.padrao.test(alvo(a))));
        const fonte = semEspacos(DOCUMENTO);
        const semCitacao = lista.filter((a) => !a.trechoOrigem || !fonte.includes(semEspacos(a.trechoOrigem).replace(/^["“]|["”]$/g, "")));
        return [
          { nome: "veio no formato", ok: true },
          ...achados,
          { nome: `nada além do que o documento aponta${sobrando.length ? ` (a mais: ${sobrando.map((a) => a.titulo).join(" | ").slice(0, 120)})` : ""}`, ok: sobrando.length === 0 },
          { nome: `todo apontamento com trecho literal do documento${semCitacao.length ? ` (${semCitacao.length} sem)` : ""}`, ok: semCitacao.length === 0 },
          { nome: "não inventou valor na divergência", ok: lista.every((a) => a.valorEnvolvidoReais === null || [4510, 43910, 39400].includes(a.valorEnvolvidoReais)) },
        ];
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------
type Linha = { familia: string; caso: string; config: string; ms: number | null; microUsd: number; acertos: number; total: number; falhou: string[]; erro: string | null; modeloQueRespondeu: string | null };

function argumento(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Defina ANTHROPIC_API_KEY. Esta régua chama a API de verdade.");
    process.exit(2);
  }
  const tetoMicroUsd = Number(argumento("teto-usd") ?? "15") * 1_000_000;
  const soFamilia = argumento("familia");
  const saida = argumento("saida") ?? "regua-ia.md";
  const familias = [narrativa, parecer, conformidade].filter((f) => !soFamilia || f.id === soFamilia);
  const chamadas = familias.reduce((s, f) => s + f.configs.length * f.casos.length, 0);
  console.log(`Régua da IA: ${chamadas} chamada(s) à API, teto de ${fmtUsd(tetoMicroUsd)}.\n`);

  const cliente = clienteDaIa({ timeout: 300_000, maxRetries: 1 });
  const linhas: Linha[] = [];
  let gasto = 0;

  for (const f of familias) {
    for (const caso of f.casos) {
      for (const config of f.configs) {
        const base = { familia: f.id, caso: caso.nome, config: config.nome };
        if (gasto >= tetoMicroUsd) {
          linhas.push({ ...base, ms: null, microUsd: 0, acertos: 0, total: 0, falhou: [], erro: "não rodou: teto de gasto atingido", modeloQueRespondeu: null });
          continue;
        }
        const inicio = Date.now();
        try {
          const message = (await cliente.beta.messages.create({ ...caso.pedido(config), stream: false })) as Anthropic.Beta.BetaMessage;
          const ms = Date.now() - inicio;
          const { microUsd } = custoMicroUsd(message.model, message.usage);
          gasto += microUsd;
          const conferencias = message.stop_reason === "refusal" || message.stop_reason === "max_tokens" ? [{ nome: `resposta completa (parou por ${message.stop_reason})`, ok: false }] : caso.conferir(message);
          const falhou = conferencias.filter((c) => !c.ok).map((c) => c.nome);
          linhas.push({ ...base, ms, microUsd, acertos: conferencias.length - falhou.length, total: conferencias.length, falhou, erro: null, modeloQueRespondeu: message.model });
          console.log(`${f.id} · ${config.nome} · ${caso.nome}: ${conferencias.length - falhou.length}/${conferencias.length} em ${(ms / 1000).toFixed(1)} s, ${fmtUsd(microUsd)}`);
        } catch (e) {
          const erro = e instanceof Error ? e.message.slice(0, 200) : "erro desconhecido";
          linhas.push({ ...base, ms: Date.now() - inicio, microUsd: 0, acertos: 0, total: 0, falhou: [], erro, modeloQueRespondeu: null });
          console.log(`${f.id} · ${config.nome} · ${caso.nome}: ERRO — ${erro}`);
        }
      }
    }
  }

  const md: string[] = [`# Régua da IA — controladoria — ${new Date().toLocaleString("pt-BR")}`, "", `Custo total desta execução: **${fmtUsd(gasto)}**. Casos sintéticos, com resposta conhecida.`, ""];
  for (const f of familias) {
    md.push(`## ${f.titulo}`, "", "| Modelo e esforço | Acerto | Tempo médio | Maior tempo | Custo médio | Observações |", "|---|---|---|---|---|---|");
    for (const config of f.configs) {
      const dele = linhas.filter((l) => l.familia === f.id && l.config === config.nome);
      const validas = dele.filter((l) => l.erro === null && l.ms !== null);
      const acertos = validas.reduce((s, l) => s + l.acertos, 0);
      const total = validas.reduce((s, l) => s + l.total, 0);
      const tempos = validas.map((l) => l.ms as number);
      const media = tempos.length ? tempos.reduce((s, t) => s + t, 0) / tempos.length : 0;
      const maior = tempos.length ? Math.max(...tempos) : 0;
      const custo = validas.length ? validas.reduce((s, l) => s + l.microUsd, 0) / validas.length : 0;
      const notas = [
        ...dele.filter((l) => l.erro).map((l) => `erro: ${l.erro}`),
        ...dele.flatMap((l) => l.falhou.map((x) => `falhou: ${x}`)),
        ...(f.tetoMs && maior > f.tetoMs ? [`**passou do teto de ${f.tetoMs / 1000} s**`] : []),
        ...new Set(validas.filter((l) => l.modeloQueRespondeu && !l.modeloQueRespondeu.startsWith(config.modelo)).map((l) => `respondeu ${l.modeloQueRespondeu}`)),
      ];
      md.push(`| ${config.nome} | ${total ? `${acertos}/${total}` : "—"} | ${tempos.length ? `${(media / 1000).toFixed(1)} s` : "—"} | ${tempos.length ? `${(maior / 1000).toFixed(1)} s` : "—"} | ${validas.length ? fmtUsd(custo) : "—"} | ${notas.join("; ") || "—"} |`);
    }
    md.push("");
  }
  md.push(
    "## Como ler",
    "",
    "- **Leitura diária**: o nível certo é o MAIOR que fica com folga abaixo de 50 s no maior tempo e não perde acerto. Em produção ele é a variável `NARRATIVA_ESFORCO` (padrão: médio).",
    "- **Parecer mensal**: se o médio acerta o mesmo que o alto, o alto é custo sem ganho.",
    "- **Conformidade**: o que o modelo barato não achou e o maior achou é exatamente o que o botão “conferir leitura” existe para pegar.",
    "- Uma execução é uma amostra: diferença de um acerto entre duas linhas não decide nada. Rode de novo antes de trocar uma configuração.",
    ""
  );
  writeFileSync(saida, md.join("\n"));
  console.log(`\n${md.join("\n")}\nRelatório gravado em ${saida}`);
  // Régua em que NENHUMA chamada respondeu não mediu nada (chave recusada, sem
  // crédito, teto zerado). Sair com erro é o que deixa a execução vermelha no
  // botão do Actions, em vez de um relatório vazio com cara de sucesso.
  if (linhas.every((l) => l.erro !== null)) process.exitCode = 3;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
