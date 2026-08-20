import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { classificarArquivo, extrairTexto, mimeParaModelo, type FormatoDocumento } from "./extracao";
import { rotuloCompetencia } from "./tipos";

// LEITURA AUTOMÁTICA DO RELATÓRIO DA CONSULTORIA.
//
// Recebe o arquivo como ele chegou e devolve uma lista de apontamentos
// estruturados. É a única parte do módulo que usa IA, e a fronteira é a mesma
// do analista do relatório diário (src/lib/controladoria/aiAnalyst.ts): a
// máquina TRANSCREVE e ORGANIZA o que a consultoria escreveu — nunca julga,
// nunca completa, nunca conclui.
//
// Três garantias que sustentam isso:
//   1. Todo apontamento carrega o TRECHO LITERAL do documento que o originou.
//      Sem citação verificável, um resumo automático de documento de risco vale
//      menos que nada: parece informação e não dá para conferir.
//   2. Tudo que sai daqui nasce marcado como PROPOSTA (propostoPorIa, validado
//      = false) e só entra no relatório da diretoria depois que uma pessoa
//      confirmou.
//   3. Sem ANTHROPIC_API_KEY o módulo continua inteiro: o arquivo é guardado
//      como evidência e os apontamentos são cadastrados à mão. A IA acelera a
//      digitação; ela não é o produto.

export function isLeituraDisponivel(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const AREAS_VALIDAS = [
  "FISCAL",
  "TRABALHISTA",
  "PREVIDENCIARIO",
  "CONTABIL",
  "FINANCEIRO",
  "SOCIETARIO",
  "REGULATORIO",
  "CONTRATUAL",
  "LGPD",
  "OUTRO",
] as const;

const ApontamentoSchema = z.object({
  titulo: z.string().describe("Uma linha, específica. Não use 'Risco fiscal' — diga qual risco fiscal."),
  descricao: z.string().describe("O que o documento afirma, em 2 a 4 frases, sem opinião própria."),
  area: z.enum(AREAS_VALIDAS),
  severidade: z
    .enum(["CRITICA", "ALTA", "MEDIA", "BAIXA", "INFO"])
    .describe("A gravidade que O DOCUMENTO atribui. Se ele não graduar, use MEDIA."),
  assuntoCanonico: z
    .string()
    .describe(
      "Assunto em 3 a 6 palavras, sem datas, valores ou nomes próprios. Deve ser IGUAL se o mesmo assunto reaparecer em outro mês."
    ),
  recomendacao: z.string().nullable().describe("A providência que o documento recomenda. Nulo se ele não recomendar nada."),
  trechoOrigem: z.string().nullable().describe("Citação literal do documento, até 300 caracteres. Nunca parafraseie aqui."),
  paginaOrigem: z.string().nullable().describe("Página, seção ou aba onde o trecho aparece."),
  valorEnvolvidoReais: z.number().nullable().describe("Valor em reais SOMENTE se o documento informar um. Nunca estime."),
  prazoSugeridoDias: z.number().int().nullable().describe("Prazo em dias se o documento indicar um. Nulo caso contrário."),
});

const LeituraSchema = z.object({
  resumo: z.string().describe("2 a 4 frases sobre o que é o documento e o que ele conclui no conjunto."),
  apontamentos: z.array(ApontamentoSchema).max(40),
});

export type ApontamentoExtraido = z.infer<typeof ApontamentoSchema>;
export type LeituraDocumento = z.infer<typeof LeituraSchema>;

const SYSTEM_PROMPT = `Você organiza, para o sistema de controladoria de um grupo brasileiro de fretamento e transporte de passageiros, os relatórios de risco que a empresa recebe de consultorias, da contabilidade e de auditorias.

Sua tarefa é TRANSCREVER E ESTRUTURAR os apontamentos que o documento faz. Não é analisar a empresa, não é opinar sobre os riscos e não é complementar o que o documento deixou de dizer.

Regras invioláveis:
- Só existe apontamento se o documento apontar. Texto descritivo, metodologia, sumário, capa, glossário e elogio não viram apontamento.
- Cada apontamento precisa do trecho LITERAL do documento em trechoOrigem. Se você não conseguir citar, não emita o apontamento.
- Nunca invente valor, prazo, competência ou norma. Se o documento não traz, o campo é nulo.
- Não junte dois assuntos diferentes num apontamento só, e não repita o mesmo assunto em dois apontamentos.
- A severidade é a que o documento atribui. Você não reclassifica o risco.
- assuntoCanonico é o que permite reconhecer o mesmo problema no mês seguinte: use o assunto em si ("credito de pis cofins sobre combustivel"), sem mês, valor ou nome de empresa.
- Se o documento não contiver nenhum apontamento, devolva a lista vazia e explique isso no resumo. Lista vazia é uma resposta correta e esperada.

Escreva em português do Brasil.`;

export type ResultadoLeitura =
  | { ok: true; leitura: LeituraDocumento; textoExtraido: string | null }
  | { ok: false; erro: string; textoExtraido: string | null };

export async function lerDocumento(params: {
  conteudo: Buffer;
  arquivoNome: string;
  mimeType: string;
  titulo: string;
  emissor: string | null;
  competencia: Date;
  empresa: string;
}): Promise<ResultadoLeitura> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const formato = classificarArquivo(params.arquivoNome, params.mimeType);

  const extracao = extrairTexto(formato, params.conteudo, params.arquivoNome);
  const textoExtraido = extracao.texto;

  if (!apiKey) {
    return { ok: false, erro: "Leitura automática indisponível (ANTHROPIC_API_KEY não configurada).", textoExtraido };
  }
  if (formato === "NAO_SUPORTADO") {
    return {
      ok: false,
      erro: "Formato não suportado pela leitura automática. Envie PDF, imagem, planilha (.xlsx), Word (.docx) ou texto.",
      textoExtraido,
    };
  }
  if (extracao.erro) {
    return { ok: false, erro: `Não foi possível ler o arquivo: ${extracao.erro}`, textoExtraido };
  }
  if (formato !== "PDF" && formato !== "IMAGEM" && !textoExtraido?.trim()) {
    return { ok: false, erro: "O arquivo não tem texto legível — cadastre os apontamentos manualmente.", textoExtraido };
  }

  const instrucao = [
    `Documento: ${params.titulo}`,
    `Empresa: ${params.empresa}`,
    params.emissor ? `Emitido por: ${params.emissor}` : null,
    `Competência: ${rotuloCompetencia(params.competencia)}`,
    "",
    "Extraia os apontamentos de risco, não conformidade ou recomendação contidos neste documento.",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.beta.messages.parse({
      model: "claude-opus-5",
      max_tokens: 16000,
      // Esforço alto, diferente do relatório diário: esta leitura acontece uma
      // vez por documento, fora da janela do cron, e o custo de errar é alto —
      // um apontamento perdido aqui é um risco que ninguém mais vai ver.
      output_config: { effort: "high" },
      system: SYSTEM_PROMPT,
      output_format: betaZodOutputFormat(LeituraSchema),
      messages: [{ role: "user", content: [...blocosDoDocumento(formato, params, textoExtraido), { type: "text", text: instrucao }] }],
    });

    const leitura = message.parsed_output;
    if (!leitura) return { ok: false, erro: "A leitura automática não devolveu um resultado utilizável.", textoExtraido };
    return { ok: true, leitura, textoExtraido };
  } catch (e) {
    // A falha é registrada no documento e mostrada na tela com o botão de
    // tentar de novo. O upload em si nunca é desfeito por causa dela: o
    // arquivo é a evidência, e ela já está guardada.
    return { ok: false, erro: mensagemDeErro(e), textoExtraido };
  }
}

// PDF e imagem vão inteiros para o modelo (ele lê tabela, carimbo e layout
// muito melhor do que qualquer extração de texto faria); os demais vão como
// texto já extraído.
function blocosDoDocumento(
  formato: FormatoDocumento,
  params: { conteudo: Buffer; arquivoNome: string },
  texto: string | null
): Anthropic.Beta.BetaContentBlockParam[] {
  if (formato === "PDF") {
    return [
      {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: params.conteudo.toString("base64") },
      },
    ];
  }
  if (formato === "IMAGEM") {
    return [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: mimeParaModelo(formato, params.arquivoNome) as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
          data: params.conteudo.toString("base64"),
        },
      },
    ];
  }
  return [{ type: "text", text: `<documento nome="${params.arquivoNome}">\n${texto ?? ""}\n</documento>` }];
}

function mensagemDeErro(e: unknown): string {
  if (e instanceof Anthropic.APIError) {
    // A mensagem da API é útil e específica (PDF acima de 100 páginas, arquivo
    // acima do limite, formato de imagem recusado) — vale mais na tela do que
    // um "erro ao processar" genérico.
    return `${e.status ?? "erro"}: ${e.message}`.slice(0, 500);
  }
  return e instanceof Error ? e.message.slice(0, 500) : "erro desconhecido na leitura automática";
}
