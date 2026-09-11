import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { fmtBRL, fmtPercent, fmtVariacao } from "./format";
import type { PanoramaFinanceiro } from "./analytics";
import type { IndicadorMedido } from "./bsc";
import type { PanoramaConformidade } from "@/lib/conformidade/panorama";
import { ROTULO_AREA, rotuloCompetencia } from "@/lib/conformidade/tipos";

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
        // Códigos das regras (CP-VENCIDO, CR-OS-NAO-FATURADA, ...) dos achados
        // que sustentam o ponto. É o que torna a leitura CONFERÍVEL: cada
        // afirmação da IA aponta para a lista de achados que a originou, e a
        // tela de auditoria abre filtrada naquela regra. Ponto sem regra é
        // interpretação dos números, e a lista vazia diz isso.
        regras: z.array(z.string()).max(6),
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
- Risco apontado por revisão externa que os dados desta auditoria CONFIRMAM tem prioridade sobre indício isolado: são duas fontes independentes. Diga isso quando acontecer.
- Apontamento externo que se repete há três meses ou mais é falha de processo, não incidente do mês. Trate-o assim.
- Nada de linguagem motivacional, superlativos ou jargão de consultoria.

Como auditar, e não só resumir:
- Puxe o fio. Quando dois ou mais achados de regras diferentes apontam para o mesmo fornecedor, cliente, ordem de serviço ou período, diga isso e diga o que a coincidência sugere. Um fornecedor novo, com valor alto, fora do padrão histórico e sem nota fiscal é um caso, não quatro.
- Separe o que é dinheiro parado (vencido, não faturado, não cobrado) do que é dinheiro perdido (juros, multa, desconto) e do que é indício de fraude ou erro de processo. São três conversas diferentes com pessoas diferentes.
- Em cada ponto de atenção, liste em "regras" os códigos das regras dos achados que o sustentam, copiados exatamente como aparecem entre colchetes na lista. Ponto que nasce só dos números (sem achado) leva lista vazia.
- Se os achados não sustentam uma conclusão, não a tire. Silêncio é uma resposta válida; conclusão sem base não é.

Estilo: comece pelo que aconteceu, não pelo contexto. Frases completas, sem abreviações inventadas, sem cadeias de setas. Ser legível importa mais que ser curto; para encurtar, escolha melhor o que entra, não comprima a escrita.

Escreva em português do Brasil.`;

type EntradaAnalista = {
  dataReferencia: Date;
  panorama: PanoramaFinanceiro;
  achados: {
    regra: string;
    severidade: string;
    categoria: string;
    titulo: string;
    // Quem é o outro lado (fornecedor, cliente, OS). É o que permite à IA
    // cruzar achados de regras diferentes sobre a mesma entidade.
    entidadeRef: string | null;
    valorCents: number | null;
    impactoCents: number | null;
    recomendacao: string | null;
  }[];
  bsc: IndicadorMedido[];
  limitacoesDaBase: string[];
  conformidade: PanoramaConformidade;
};

// Os achados vão ordenados por severidade e impacto (é assim que o relatório os
// carrega); a IA vê os primeiros. Mais que isso vira lista que ninguém cruza.
const LIMITE_DE_ACHADOS = 40;

// Monta o texto que vai para a IA. Formatado como relatorio legivel, e nao
// como JSON cru, de proposito: o modelo interpreta melhor "Receita do mês: R$
// 412.300,00 (+12,4% vs. mês anterior)" do que um objeto aninhado — e, como o
// que entra e exatamente o que uma pessoa leria, fica facil auditar depois o
// que a IA tinha em maos quando escreveu cada frase.
function montarBriefing(entrada: EntradaAnalista): string {
  const { panorama, achados, bsc, limitacoesDaBase, conformidade } = entrada;
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
  linhas.push(`## Achados de auditoria validados (${achados.length}${achados.length > LIMITE_DE_ACHADOS ? `, os ${LIMITE_DE_ACHADOS} mais graves abaixo` : ""})`);
  for (const a of achados.slice(0, LIMITE_DE_ACHADOS)) {
    linhas.push(
      `- [${a.regra}] (${a.severidade}/${a.categoria}) ${a.titulo}` +
        (a.entidadeRef ? ` — ${a.entidadeRef}` : "") +
        (a.valorCents ? ` — valor ${fmtBRL(a.valorCents)}` : "") +
        (a.impactoCents ? `, impacto estimado ${fmtBRL(a.impactoCents)}` : "")
    );
  }

  if (conformidade.temModulo) {
    linhas.push("");
    linhas.push("## Riscos apontados por revisão externa (consultoria/contabilidade/auditoria)");
    linhas.push(
      `- ${conformidade.abertos} em aberto, sendo ${conformidade.criticos} grave(s); ` +
        `${conformidade.vencidos} com prazo vencido; ${conformidade.reincidentes} repetido(s) em 3 ou mais competências`
    );
    linhas.push(
      `- ${conformidade.confirmadosPeloSistema} confirmado(s) pelos achados desta auditoria; ` +
        `${conformidade.semCobertura} que nenhum agente daqui consegue ver`
    );
    if (!conformidade.documentoEsperadoRecebido && conformidade.competenciaEsperada) {
      linhas.push(`- ATENÇÃO: o documento de ${rotuloCompetencia(conformidade.competenciaEsperada)} não foi recebido.`);
    }
    for (const a of conformidade.prioritarios) {
      linhas.push(
        `- [${a.severidade}] ${a.titulo} (${ROTULO_AREA[a.area] ?? a.area}, ${rotuloCompetencia(a.competencia)}` +
          `${a.ocorrencias >= 3 ? `, ${a.ocorrencias}ª competência seguida` : ""})`
      );
    }
  }

  if (limitacoesDaBase.length > 0) {
    linhas.push("");
    linhas.push("## Limitações da base nesta execução");
    for (const l of limitacoesDaBase) linhas.push(`- ${l}`);
  }

  return linhas.join("\n");
}

// O modelo do analista. Fable 5.1 é o mais capaz para cruzar fatos e sustentar
// uma conclusão com evidência — que é exatamente o que se pede aqui. Custa
// mais por chamada; são uma ou duas chamadas por dia.
export const MODELO_ANALISTA = "claude-fable-5-1";

export async function gerarNarrativa(entrada: EntradaAnalista): Promise<Narrativa | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const client = new Anthropic({ apiKey });

  try {
    const message = await client.beta.messages.parse({
      model: MODELO_ANALISTA,
      max_tokens: 16000,
      // Esforço alto: a leitura roda uma vez por dia e o que se quer dela é
      // justamente o cruzamento entre achados, que esforço baixo não faz. O
      // raciocínio fica por conta do modelo (sempre ligado neste modelo; não
      // há parâmetro de thinking a passar).
      output_config: { effort: "high", format: betaZodOutputFormat(NarrativaSchema) },
      // Recusa por classificador de segurança é rara neste domínio, mas não é
      // impossível (texto de fraude, vazamento, senha em título de fornecedor).
      // Com o fallback, a API refaz a mesma chamada num modelo de cobertura
      // mais ampla em vez de deixar o relatório sem leitura.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `${montarBriefing(entrada)}

Escreva a leitura executiva deste relatório.`,
        },
      ],
    });

    // A recusa chega como resposta bem-sucedida (HTTP 200) com stop_reason
    // próprio — e conteúdo possivelmente vazio. Tem de ser verificada ANTES
    // de ler o resultado, ou o relatório sairia com uma narrativa cortada no
    // meio parecendo completa.
    if (message.stop_reason === "refusal") {
      console.warn(
        `[analista] leitura recusada pelo modelo (categoria ${message.stop_details?.category ?? "não informada"}); relatório sai sem narrativa.`
      );
      return null;
    }
    if (message.stop_reason === "max_tokens") {
      console.warn("[analista] resposta cortada por tamanho; relatório sai sem narrativa.");
      return null;
    }

    const narrativa = message.parsed_output ?? null;
    if (!narrativa) console.warn("[analista] o modelo respondeu, mas o resultado não passou no esquema; relatório sai sem narrativa.");
    return narrativa;
  } catch (e) {
    // Falha da IA nunca impede o relatorio: ele sai com todos os numeros e
    // achados, apenas sem a secao de narrativa. O e-mail diario e o
    // compromisso; a leitura executiva e o complemento.
    //
    // Mas a falha fica registrada, com o status da API quando houver: "sem
    // narrativa há três dias" precisa ter uma causa consultável, e engolir o
    // erro em silêncio foi o que escondeu, por semanas, que nenhum achado
    // fechava sozinho.
    if (e instanceof Anthropic.APIError) {
      console.warn(`[analista] API respondeu ${e.status ?? "sem status"}: ${e.message.slice(0, 300)}`);
    } else {
      console.warn(`[analista] falha ao gerar a leitura: ${e instanceof Error ? e.message.slice(0, 300) : String(e)}`);
    }
    return null;
  }
}
