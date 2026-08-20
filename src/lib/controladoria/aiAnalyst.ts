import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { fmtBRL, fmtPercent, fmtVariacao } from "./format";
import type { PanoramaFinanceiro } from "./analytics";
import type { IndicadorMedido } from "./bsc";

// ANALISTA (camada 3) — escreve a leitura executiva do relatorio diario.
//
// Fronteira deliberada e nao negociavel: a IA recebe apenas NUMEROS JA
// CALCULADOS e ACHADOS JA VALIDADOS pelo supervisor. Ela nao consulta o banco,
// nao recalcula nada, nao cria achado e nao apaga achado. O que ela faz e o
// que um analista humano faria com o relatorio pronto na mao: dizer o que
// importa primeiro, ligar um numero ao outro e apontar a decisao.
//
// Isso existe por um motivo especifico: se a narrativa pudesse produzir os
// proprios "fatos", o relatorio deixaria de ser auditavel — nao daria para
// rastrear um numero ate a regra que o gerou. Com a fronteira, toda afirmacao
// do texto tem origem verificavel, e uma alucinacao eventual fica restrita a
// interpretacao (visivel e contestavel), nunca ao dado.
//
// Sem ANTHROPIC_API_KEY o relatorio sai completo do mesmo jeito, apenas sem a
// secao de leitura executiva — mesma filosofia da extracao de CCT deste
// projeto (src/lib/cctExtraction.ts).

export function isAnalistaDisponivel(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const NarrativaSchema = z.object({
  // 2 a 4 frases. E o texto que uma pessoa le no celular antes de decidir se
  // abre o resto.
  resumoExecutivo: z.string(),
  pontosDeAtencao: z
    .array(
      z.object({
        titulo: z.string(),
        porQueImporta: z.string(),
      })
    )
    .max(5),
  acoesRecomendadas: z
    .array(
      z.object({
        acao: z.string(),
        prazo: z.enum(["HOJE", "ESTA_SEMANA", "ESTE_MES"]),
        responsavelSugerido: z.string(),
      })
    )
    .max(5),
  leituraEstrategica: z.string(),
});

export type Narrativa = z.infer<typeof NarrativaSchema>;

const SYSTEM_PROMPT = `Você é o controller de uma empresa brasileira de fretamento e transporte de passageiros, escrevendo o relatório diário para o diretor.

Seu texto será lido no celular, cedo, antes da primeira reunião. Escreva como quem conhece a operação: direto, específico e sem enrolação.

Regras invioláveis:
- Use SOMENTE os números fornecidos. Nunca invente, estime ou arredonde para um número diferente do informado.
- Se um dado estiver ausente ou marcado como sem base comparativa, diga isso explicitamente em vez de preencher a lacuna.
- Não repita a lista de achados: eles já vão no relatório. Seu papel é dizer o que eles significam juntos.
- Toda ação recomendada precisa ser executável por uma pessoa específica em um prazo específico.
- Nada de linguagem motivacional, superlativos ou jargão de consultoria.

Escreva em português do Brasil.`;

type EntradaAnalista = {
  dataReferencia: Date;
  panorama: PanoramaFinanceiro;
  achados: {
    severidade: string;
    categoria: string;
    titulo: string;
    valorCents: number | null;
    impactoCents: number | null;
    recomendacao: string | null;
  }[];
  bsc: IndicadorMedido[];
  limitacoesDaBase: string[];
};

// Monta o texto que vai para a IA. Formatado como relatorio legivel, e nao
// como JSON cru, de proposito: o modelo interpreta melhor "Receita do mês: R$
// 412.300,00 (+12,4% vs. mês anterior)" do que um objeto aninhado — e, como o
// que entra e exatamente o que uma pessoa leria, fica facil auditar depois o
// que a IA tinha em maos quando escreveu cada frase.
function montarBriefing(entrada: EntradaAnalista): string {
  const { panorama, achados, bsc, limitacoesDaBase } = entrada;
  const c = panorama.comparativo;

  const linhas: string[] = [];
  linhas.push(`RELATÓRIO DE ${entrada.dataReferencia.toLocaleDateString("pt-BR")} (dados de D-1)`);
  linhas.push("");
  linhas.push("## Resultado por competência");
  linhas.push(`- Dia: receita ${fmtBRL(c.dia.receitaCents)}, despesa ${fmtBRL(c.dia.despesaCents)}, resultado ${fmtBRL(c.dia.resultadoCents)}`);
  linhas.push(
    `- Mês atual: receita ${fmtBRL(c.mesAtual.receitaCents)} (${fmtVariacao(c.variacoes.receitaMesVsAnterior)} vs. mês anterior), ` +
      `despesa ${fmtBRL(c.mesAtual.despesaCents)} (${fmtVariacao(c.variacoes.despesaMesVsAnterior)}), ` +
      `resultado ${fmtBRL(c.mesAtual.resultadoCents)}, margem ${fmtPercent(c.mesAtual.margemPercent)}`
  );
  linhas.push(`- Mês anterior fechado: receita ${fmtBRL(c.mesAnterior.receitaCents)}, resultado ${fmtBRL(c.mesAnterior.resultadoCents)}`);
  linhas.push(
    `- Acumulado do ano: receita ${fmtBRL(c.ano.receitaCents)} (${fmtVariacao(c.variacoes.receitaAnoVsAnterior)} vs. mesmo período do ano anterior), ` +
      `resultado ${fmtBRL(c.ano.resultadoCents)} (${fmtVariacao(c.variacoes.resultadoAnoVsAnterior)})`
  );
  if (c.semBaseAnoAnterior) {
    linhas.push("- ATENÇÃO: a base não cobre o ano anterior inteiro; comparações anuais não têm base confiável.");
  }

  linhas.push("");
  linhas.push("## Caixa e prazos");
  linhas.push(`- Saldo atual: ${fmtBRL(panorama.saldoAtualCents)}`);
  linhas.push(`- A pagar em aberto: ${fmtBRL(panorama.aPagarEmAbertoCents)} (vencido: ${fmtBRL(panorama.vencidoPagarCents)})`);
  linhas.push(`- A receber em aberto: ${fmtBRL(panorama.aReceberEmAbertoCents)} (vencido: ${fmtBRL(panorama.vencidoReceberCents)})`);
  linhas.push(
    `- Ciclo financeiro: ${panorama.ciclo.cicloFinanceiroDias ?? "sem dado"} dias ` +
      `(PMR ${panorama.ciclo.pmrDias ?? "—"}, PMP ${panorama.ciclo.pmpDias ?? "—"})`
  );
  for (const p of panorama.projecao) {
    linhas.push(`- Projeção ${p.dias} dias: saldo ${fmtBRL(p.saldoProjetadoCents)}`);
  }

  linhas.push("");
  linhas.push("## Perdas financeiras do mês");
  linhas.push(
    `- Juros ${fmtBRL(c.mesAtual.jurosCents)}, multa ${fmtBRL(c.mesAtual.multaCents)}, ` +
      `tarifa ${fmtBRL(c.mesAtual.tarifaCents)}, desconto concedido ${fmtBRL(c.mesAtual.descontoCents)} ` +
      `— total ${fmtBRL(c.mesAtual.perdaTotalCents)}`
  );

  linhas.push("");
  linhas.push("## Maiores despesas do mês (por fornecedor)");
  for (const f of panorama.topFornecedores.slice(0, 5)) {
    linhas.push(`- ${f.nome}: ${fmtBRL(f.valorCents)} em ${f.quantidade} título(s)`);
  }

  linhas.push("");
  linhas.push("## Indicadores do BSC");
  for (const i of bsc) {
    const valor =
      i.valor === null
        ? "sem dado"
        : i.indicador.unidade === "PERCENTUAL"
          ? fmtPercent(i.valor)
          : i.indicador.unidade === "REAIS"
            ? fmtBRL(Math.round(i.valor * 100))
            : String(Math.round(i.valor));
    linhas.push(`- [${i.farol}] ${i.indicador.nome}: ${valor}${i.meta !== null ? ` (meta ${i.meta})` : ""}`);
  }

  linhas.push("");
  linhas.push(`## Achados de auditoria validados (${achados.length})`);
  for (const a of achados.slice(0, 25)) {
    linhas.push(
      `- [${a.severidade}/${a.categoria}] ${a.titulo}` +
        (a.valorCents ? ` — valor ${fmtBRL(a.valorCents)}` : "") +
        (a.impactoCents ? `, impacto estimado ${fmtBRL(a.impactoCents)}` : "")
    );
  }

  if (limitacoesDaBase.length > 0) {
    linhas.push("");
    linhas.push("## Limitações da base nesta execução");
    for (const l of limitacoesDaBase) linhas.push(`- ${l}`);
  }

  return linhas.join("\n");
}

export async function gerarNarrativa(entrada: EntradaAnalista): Promise<Narrativa | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const client = new Anthropic({ apiKey });

  try {
    const message = await client.beta.messages.parse({
      model: "claude-opus-5",
      max_tokens: 8000,
      // O relatorio diario e uma tarefa de sintese com prazo (roda dentro do
      // teto de execucao do cron): esforco medio da a leitura sem gastar o
      // orcamento de tempo do restante da rotina.
      output_config: { effort: "medium" },
      system: SYSTEM_PROMPT,
      output_format: betaZodOutputFormat(NarrativaSchema),
      messages: [
        {
          role: "user",
          content: `${montarBriefing(entrada)}

Escreva a leitura executiva deste relatório.`,
        },
      ],
    });

    return message.parsed_output ?? null;
  } catch {
    // Falha da IA nunca impede o relatorio: ele sai com todos os numeros e
    // achados, apenas sem a secao de narrativa. O e-mail diario e o
    // compromisso; a leitura executiva e o complemento.
    return null;
  }
}
