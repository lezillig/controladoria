import { createHmac, timingSafeEqual } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { classificarArquivo, extrairTexto, mimeParaModelo } from "@/lib/conformidade/extracao";
import { EditalSchema, type EditalLido } from "./editalParaEstudo";
import { LIMITE_PARTE } from "./dividirPdf";

// LEITURA AUTOMÁTICA DO EDITAL — o botão "Importar edital" de Novo estudo.
//
// Um edital chega em vários arquivos: o edital, o termo de referência, a
// planilha de itinerários, a planilha de formação de custo, a convenção
// coletiva, formulários. PDF, Word, Excel e imagem. O fluxo tem dois passos,
// e o motivo é o tamanho:
//
//   1. CADA ARQUIVO (ou cada parte de um PDF grande, dividido no navegador)
//      sobe sozinho e vai para a Files API da Anthropic. A hospedagem recusa
//      corpo de requisição acima de ~4,5 MB, e edital digitalizado passa de
//      10 MB. Word, Excel e texto viram texto aqui e sobem como .txt; PDF e
//      imagem sobem inteiros — o modelo lê tabela, carimbo e página
//      digitalizada muito melhor do que qualquer extração de texto.
//   2. A LEITURA recebe só os identificadores e lê tudo de uma vez, como um
//      conjunto: o item do edital, a quantidade do termo de referência e o km
//      da planilha de itinerários se completam. Depois os arquivos são
//      apagados da Files API.
//
// A mesma fronteira da leitura de conformidade (conformidade/analise.ts): a
// máquina TRANSCREVE o edital no formato do estudo; não precifica, não
// completa número que falta. O que ela deduziu vai em `suposicoes`, e tudo
// nasce como formulário para a pessoa conferir antes de criar o estudo.

// MODELO E ESFORÇO. Ler edital é transcrever com algum julgamento: casar o
// item do edital com a rota da planilha, deduzir o tipo de veículo pela
// lotação, separar o que pesa no custo do que é forma. Esforço médio cabe no
// teto de 300 s da função com documentos de 100+ páginas.
//
// DOIS MODELOS, AUTOMÁTICO. A leitura começa no modelo padrão (Sonnet 5.5,
// metade do preço do Opus) e é conferida (problemasDaLeitura): sem item, item
// sem quantidade, rotas sem km, edital público sem habilitação. Se a conferência
// falha — ou a leitura é recusada, cortada ou sai fora do formato — ela é
// refeita no modelo forte (Opus 5.5), se ainda couber no tempo da função.
// Processo com muitos arquivos já começa no forte. A planilha do órgão é
// mapeada pelo modelo barato (Haiku 5.5), com o padrão de reserva. Os três se
// trocam por variável de ambiente, sem mexer no código.
export const MODELO_EDITAL = process.env.ANTHROPIC_MODELO_EDITAL || "claude-sonnet-5-5";
export const MODELO_EDITAL_FORTE = process.env.ANTHROPIC_MODELO_EDITAL_FORTE || "claude-opus-5-5";
export const MODELO_PLANILHA = process.env.ANTHROPIC_MODELO_PLANILHA || "claude-haiku-5-5";
export const ESFORCO_EDITAL = "medium" as const;
// Processo com tantos arquivos (ou partes de PDF) já vai direto ao forte.
const ARQUIVOS_PARA_O_FORTE = 10;
// O teto da função é 300 s: a primeira leitura tem até 150 s, e a segunda só
// começa se sobrarem 130 s.
const TEMPO_PRIMEIRA_MS = 150_000;
const TEMPO_TOTAL_MS = 285_000;
const TEMPO_MINIMO_SEGUNDA_MS = 130_000;

// Nome curto do modelo, para a tela.
export const nomeDoModelo = (m: string) =>
  m
    .replace(/^claude-/, "")
    .replace(/-(\d+)-(\d+)$/, " $1.$2")
    .replace(/-(\d+)$/, " $1")
    .replace(/^./, (c) => c.toUpperCase());
// O fallback do servidor (outro modelo quando um classificador recusa) não
// existe no Haiku.
export const comFallback = (m: string) => (/haiku/i.test(m) ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const });

// Abaixo do limite de corpo da hospedagem (~4,5 MB), com folga para o
// envelope do formulário. O navegador divide PDFs maiores em partes deste
// tamanho (ImportarEdital.tsx).
export const TAMANHO_MAXIMO_PARTE = LIMITE_PARTE;
export const ARQUIVOS_MAXIMOS = 40;

export function isLeituraDeEditalDisponivel(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export type ArquivoEnviado = { fileId: string; nome: string; bloco: "documento" | "imagem" };
// O identificador volta ao navegador ASSINADO pela empresa: a leitura só
// aceita arquivo que esta empresa enviou, e não um identificador qualquer da
// conta da Anthropic.
export type ArquivoAssinado = ArquivoEnviado & { assinatura: string };

function assinar(companyId: string, a: ArquivoEnviado): string {
  const segredo = process.env.JWT_SECRET;
  if (!segredo) throw new Error("JWT_SECRET não configurado.");
  return createHmac("sha256", segredo).update(`edital:${companyId}:${a.fileId}:${a.bloco}`).digest("base64url");
}
export function assinarArquivo(companyId: string, a: ArquivoEnviado): ArquivoAssinado {
  return { ...a, assinatura: assinar(companyId, a) };
}
export function arquivosAssinadosValidos(companyId: string, bruto: unknown): ArquivoEnviado[] | null {
  if (!Array.isArray(bruto) || bruto.length === 0 || bruto.length > ARQUIVOS_MAXIMOS * 4) return null;
  const lista: ArquivoEnviado[] = [];
  for (const x of bruto) {
    const o = (x ?? {}) as Record<string, unknown>;
    if (typeof o.fileId !== "string" || !/^file_[A-Za-z0-9_-]{8,}$/.test(o.fileId)) return null;
    if (o.bloco !== "documento" && o.bloco !== "imagem") return null;
    const a: ArquivoEnviado = { fileId: o.fileId, nome: String(o.nome ?? "arquivo").slice(0, 200), bloco: o.bloco };
    const esperado = Buffer.from(assinar(companyId, a));
    const recebido = Buffer.from(String(o.assinatura ?? ""));
    if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) return null;
    lista.push(a);
  }
  return lista;
}

export const limparSegredo = (v: string | undefined) => (v ?? "").trim().replace(/^["']|["']$/g, "").trim();

// Chave de usuário (não de espaço de trabalho): a API pede o espaço em cada
// requisição — ANTHROPIC_WORKSPACE_ID, o "wrkspc_…" do console.
export const cliente = () =>
  new Anthropic({
    // Sem espaço, quebra de linha ou aspas coladas junto na hospedagem — a
    // causa mais comum de "chave recusada".
    apiKey: limparSegredo(process.env.ANTHROPIC_API_KEY),
    ...(limparSegredo(process.env.ANTHROPIC_WORKSPACE_ID) && { defaultHeaders: { "anthropic-workspace-id": limparSegredo(process.env.ANTHROPIC_WORKSPACE_ID) } }),
  });

// PASSO 1 — um arquivo (ou uma parte de PDF) para a Files API.
// `nomeDoArquivo` decide o formato (pela extensão); `nome` é o rótulo que a
// leitura vê, com o intervalo de páginas quando é parte de um PDF dividido.
export async function enviarArquivo(conteudo: Buffer, nome: string, mimeType: string, nomeDoArquivo = nome): Promise<{ ok: true; arquivo: ArquivoEnviado } | { ok: false; erro: string }> {
  if (!isLeituraDeEditalDisponivel()) return { ok: false, erro: "Leitura automática indisponível (ANTHROPIC_API_KEY não configurada)." };
  if (conteudo.byteLength === 0) return { ok: false, erro: `${nome}: arquivo vazio.` };
  if (conteudo.byteLength > TAMANHO_MAXIMO_PARTE * 1.3) return { ok: false, erro: `${nome}: parte grande demais (divida o arquivo).` };
  const formato = classificarArquivo(nomeDoArquivo, mimeType);
  try {
    if (formato === "PDF" || formato === "IMAGEM") {
      const mime = formato === "PDF" ? "application/pdf" : mimeParaModelo(formato, nomeDoArquivo);
      const meta = await cliente().files.upload({ file: new File([new Uint8Array(conteudo)], nomeDoArquivo, { type: mime }) });
      return { ok: true, arquivo: { fileId: meta.id, nome, bloco: formato === "PDF" ? "documento" : "imagem" } };
    }
    if (formato === "OOXML" || formato === "TEXTO" || formato === "EMAIL") {
      const { texto, erro } = extrairTexto(formato, conteudo, nomeDoArquivo);
      if (erro || !texto?.trim()) return { ok: false, erro: `${nome}: ${erro ?? "sem texto legível"}.` };
      const meta = await cliente().files.upload({ file: new File([`Arquivo: ${nome}\n\n${texto}`], `${nome}.txt`, { type: "text/plain" }) });
      return { ok: true, arquivo: { fileId: meta.id, nome, bloco: "documento" } };
    }
    return { ok: false, erro: `${nome}: formato não suportado. Envie PDF, Word (.docx), Excel (.xlsx), imagem ou texto.` };
  } catch (e) {
    return { ok: false, erro: `${nome}: ${mensagemDeErro(e)}` };
  }
}

// DIAGNÓSTICO: envia e apaga um arquivo de texto mínimo — exercita a chave, o
// espaço de trabalho e a Files API sem gastar leitura de modelo.
export async function testarConexao(): Promise<{ ok: true } | { ok: false; erro: string }> {
  if (!isLeituraDeEditalDisponivel()) return { ok: false, erro: "ANTHROPIC_API_KEY não configurada na hospedagem." };
  try {
    const c = cliente();
    const meta = await c.files.upload({ file: new File(["teste de conexão da controladoria"], "teste-conexao.txt", { type: "text/plain" }) });
    await c.files.delete(meta.id).catch(() => undefined);
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: mensagemDeErro(e) };
  }
}

export async function apagarArquivos(ids: string[]): Promise<void> {
  if (!isLeituraDeEditalDisponivel() || ids.length === 0) return;
  const c = cliente();
  await Promise.allSettled(ids.map((id) => c.files.delete(id)));
}

const SYSTEM_PROMPT = `Você lê editais de licitação e pedidos de proposta de transporte de passageiros para o simulador de custos de uma empresa de fretamento de São Paulo (fretamento contínuo e eventual, transporte escolar, transporte de pacientes, locação com e sem motorista; vans, micro-ônibus, ônibus e carros, inclusive adaptados).

Sua tarefa é TRANSCREVER o que os documentos dizem no formato do estudo de custo. Você não precifica, não opina sobre a viabilidade e não completa número que os documentos não trazem.

## Os documentos

Você recebe vários arquivos do mesmo processo: o edital, o termo de referência (TR) e seus anexos — planilha de itinerários/rotas, planilha de formação de custo ou modelo de proposta, convenção coletiva, matriz de riscos, tabela de penalidades, formulários, manual de identidade visual. Leia-os como um CONJUNTO: o item vem do edital, a quantidade do TR, o km e o horário da planilha de itinerários. Logomarca e manual visual não trazem dados de custo — ignore-os, salvo exigência de adesivação/plotagem, que vai em exigências. Os modelos de declaração e de proposta não trazem custo, mas dizem o que a habilitação pede.

## Como preencher

- Itens: um por item ou lote de preço do edital. Quando a planilha de itinerários detalha as rotas, cada rota vai em "rotas" do item a que pertence, com o km por dia, o número de veículos, o horário e os turnos. Sem rotas detalhadas, use kmDia ou kmMes do item.
- Km: copie o que o documento traz. Se ele dá km por dia, use kmDia; se dá km por mês, kmMes. Se uma rota não tem km, deixe nulo e registre em suposições. Nunca estime km por distância de mapa.
- Escolar: o km é por dia letivo; informe diasLetivosAno se o documento disser. Um veículo que faz rota de manhã e à tarde com o mesmo motorista é 1 turno; com motoristas diferentes, 2.
- Tipo de veículo: use o que o documento pede. Se ele só dá a lotação: até 7 lugares CARRO; 8 a 20 VAN; 21 a 33 MICRO; 34 ou mais ONIBUS. Exigência de elevador/plataforma ou acessibilidade para cadeirante → a versão ADAPTADA. Registre em suposições quando deduzir pela lotação.
- Monitor: monitorasPorVeiculo só quando o documento exigir monitor/acompanhante.
- Preço máximo: só quando o documento publica o valor. Estimativa sigilosa → nulo, e diga isso em suposições.
- Esfera: órgão público, empresa pública, autarquia, Sistema S (SENAR, SESI, SENAC...) e entidade privada que contrata por edital com regulamento próprio de licitação (confederações, comitês) são PUBLICO.
- Unidade de preço: como a proposta é cotada (por km, por veículo-mês, diária, hora; fixo + variável = BINOMIA).
- Exigências: tudo o que muda o custo — idade máxima e características dos veículos, ar-condicionado, acessibilidade, rastreamento e câmeras, monitor, CNH e cursos exigidos, reserva técnica, garagem/base local, quilometragem improdutiva, garantia contratual (%), prazo de pagamento, reajuste, convenção coletiva aplicável e o piso salarial que ela fixa, penalidades com valor relevante. Uma frase por exigência, com o número que o documento traz e a fonte (arquivo e página).
- Premissas fixadas: em "premissas", só o que o edital FIXA para a proposta (a licitante não escolhe): reserva técnica, encargos sociais fixados pelo órgão, piso salarial e vale-refeição da convenção coletiva indicada (leia a CCT anexa), exigência de veículo zero km ou idade máxima de entrada, consumo de referência fixado. O que a licitante informa livremente fica nulo.
- Habilitação: liste TODOS os documentos de habilitação que o edital exige, um por linha e na ordem do edital, no grupo certo (jurídica; fiscal, social e trabalhista; econômico-financeira; técnica — atestados, registros, visita; declarações; o que vai junto com a proposta). Em "exigencia", o detalhe que decide se a empresa atende: índices mínimos (LG, SG, LC) e a fórmula, capital ou patrimônio líquido mínimo (% ou R$), quantitativo e período dos atestados (ex.: 50% da frota, 12 meses), prazo de validade aceito, se o SICAF/cadastro substitui. Não junte dois documentos numa linha; não invente documento que o edital não pede.
- Fonte: em cada item, rota, exigência e documento, diga o arquivo e a página ("Anexo 1 TR, p. 2").
- Frota compartilhada: quando o mesmo veículo faz rotas em períodos diferentes (manhã, tarde, noite), "veiculos" do item é a FROTA operante que o edital fixa (sem reserva), e cada rota mantém o seu veículo; diga em suposições como a frota se reparte.
- Km pago: se o edital soma km improdutivo ao km dos itinerários para chegar ao km pago (ex.: +5%), informe kmImprodutivoPagoPct e deixe o kmDia das rotas como está no itinerário. No escolar, diasLetivosAno são os dias de operação do ano que o edital usa na conta do km (20 dias × 11 meses = 220), não os 200 da LDB, se a conta dele for outra.
- Quantidade em diárias ou meses (eventual, locação): "veiculos" é a frota que opera AO MESMO TEMPO; se o documento só dá o total de diárias, deixe nulo, ponha o total de diárias na descrição do item e registre em suposições. Km dado por veículo e por diária vai em kmDia do item multiplicado pelos veículos, e diga a conta em suposições.
- Km que não fecha: confira o "total" de km contra as viagens e trechos do quadro; se não bater (ex.: o total é de um período só), transcreva o que está escrito e registre a dúvida em suposições.
- Contradições: quando o mesmo dado aparece diferente em partes dos documentos (idade do veículo, horário, número do item ou do pregão, preço), use o do documento mais específico (TR/anexo sobre edital) e registre a divergência em suposições.
- Escolar pago por mês: diga em exigências se as férias e o recesso são pagos ou suspensos.
- Páginas: na fonte, use a página impressa no documento quando ela diferir da posição no PDF.
- Suposições: tudo o que você deduziu ou que falta. Lista vazia é aceitável quando nada foi deduzido.

Escreva em português do Brasil.`;

// PASSO 2 — ler os arquivos enviados como um conjunto, com o modelo padrão e,
// se a conferência pedir, de novo com o forte. Apaga os arquivos no fim, com
// ou sem sucesso: a evidência é o edital guardado no estudo.
export type Leitura = { modelo: string; refeitaPorque: string | null; avisos: string[] };
export async function lerEdital(
  arquivos: ArquivoEnviado[],
  contexto: { empresa: string }
): Promise<{ ok: true; edital: EditalLido; leitura: Leitura } | { ok: false; erro: string }> {
  if (!isLeituraDeEditalDisponivel()) return { ok: false, erro: "Leitura automática indisponível (ANTHROPIC_API_KEY não configurada)." };
  if (arquivos.length === 0) return { ok: false, erro: "Nenhum arquivo enviado." };
  const inicio = Date.now();
  try {
    const direto = arquivos.length >= ARQUIVOS_PARA_O_FORTE || MODELO_EDITAL === MODELO_EDITAL_FORTE;
    const primeiro = direto ? MODELO_EDITAL_FORTE : MODELO_EDITAL;
    const r1 = await lerComModelo(primeiro, arquivos, contexto, direto ? TEMPO_TOTAL_MS : TEMPO_PRIMEIRA_MS);
    const problemas1 = r1.ok ? problemasDaLeitura(r1.edital) : [r1.erro];
    if (r1.ok && problemas1.length === 0) return { ok: true, edital: r1.edital, leitura: { modelo: primeiro, refeitaPorque: null, avisos: [] } };
    // Conta sem crédito ou chave recusada: o forte também não passaria.
    if (!r1.ok && r1.definitivo) return { ok: false, erro: r1.erro };
    const sobra = TEMPO_TOTAL_MS - (Date.now() - inicio);
    if (!direto && sobra >= TEMPO_MINIMO_SEGUNDA_MS) {
      const r2 = await lerComModelo(MODELO_EDITAL_FORTE, arquivos, contexto, sobra);
      if (r2.ok) return { ok: true, edital: r2.edital, leitura: { modelo: MODELO_EDITAL_FORTE, refeitaPorque: problemas1.join("; "), avisos: problemasDaLeitura(r2.edital) } };
      if (!r1.ok) return { ok: false, erro: r2.erro };
    }
    // Sem tempo (ou o forte falhou): a primeira leitura, com os problemas à vista.
    if (r1.ok) return { ok: true, edital: r1.edital, leitura: { modelo: primeiro, refeitaPorque: null, avisos: problemas1 } };
    return { ok: false, erro: r1.erro };
  } finally {
    await apagarArquivos(arquivos.map((a) => a.fileId));
  }
}

// A CONFERÊNCIA da leitura: o que indica que o modelo não deu conta do edital.
export function problemasDaLeitura(e: EditalLido): string[] {
  const p: string[] = [];
  if (e.itens.length === 0) p.push("nenhum item lido");
  const locacao = e.tipoServico === "LOCACAO_SM" || e.tipoServico === "LOCACAO_CM";
  const semQuantidade = e.itens.filter((i) => (i.rotas ?? []).length === 0 && !i.kmMes && !i.kmDia && !(locacao && i.veiculos));
  if (semQuantidade.length > 0 && !(e.unidadePreco === "DIARIA" || e.unidadePreco === "HORA"))
    p.push(`${semQuantidade.length} item(ns) sem km nem rotas`);
  const rotas = e.itens.flatMap((i) => i.rotas ?? []);
  const rotasSemKm = rotas.filter((r) => !r.kmDia).length;
  if (rotas.length >= 5 && rotasSemKm / rotas.length > 0.3) p.push(`${rotasSemKm} de ${rotas.length} rotas sem km`);
  if (e.esfera === "PUBLICO" && e.tipoEstudo === "LICITACAO" && (e.habilitacao ?? []).length === 0) p.push("nenhum documento de habilitação");
  return p;
}

type ResultadoDoModelo = { ok: true; edital: EditalLido } | { ok: false; erro: string; definitivo: boolean };

// O schema em texto, para a leitura sem saída estruturada (plano B).
const SCHEMA_EM_TEXTO = () => JSON.stringify((betaZodOutputFormat(EditalSchema) as { schema: unknown }).schema);
// O JSON de uma resposta em texto: sem cercas de markdown e sem texto em volta.
export function jsonDaResposta(texto: string): unknown {
  const limpo = texto.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const [a, b] = [limpo.indexOf("{"), limpo.lastIndexOf("}")];
  return JSON.parse(a >= 0 && b > a ? limpo.slice(a, b + 1) : limpo);
}

// `estruturada`: com a saída estruturada da API (o formato garantido). Se a
// API recusar o schema ("grammar too large"), a mesma leitura vai sem ela, com
// o schema no prompt e a validação aqui (zod).
async function lerComModelo(modelo: string, arquivos: ArquivoEnviado[], contexto: { empresa: string }, tempoMs: number, estruturada = true): Promise<ResultadoDoModelo> {
  const inicio = Date.now();
  try {
    const blocos: Anthropic.Beta.BetaContentBlockParam[] = arquivos.map((a) =>
      a.bloco === "imagem" ? { type: "image", source: { type: "file", file_id: a.fileId } } : { type: "document", source: { type: "file", file_id: a.fileId }, title: a.nome.slice(0, 200) }
    );
    const lista = arquivos.map((a, k) => `${k + 1}. ${a.nome}`).join("\n");
    // `create` cru com timeout explícito: o helper `parse` decodifica o JSON
    // antes de olhar o stop_reason e, com a saída cortada, o erro que sobe não
    // diz o motivo. Sem retentativa: o tempo é da segunda leitura.
    const message = await cliente().beta.messages.create(
      {
        model: modelo,
        // Teto para raciocínio + resposta: um edital com 100 rotas detalhadas
        // dá ~15 mil tokens de JSON. É anteparo, não controle de custo.
        max_tokens: 48000,
        output_config: estruturada ? { effort: ESFORCO_EDITAL, format: betaZodOutputFormat(EditalSchema) } : { effort: ESFORCO_EDITAL },
        // Edital com cláusula penal ou de segurança pode esbarrar num
        // classificador por engano; a API refaz a leitura em outro modelo.
        ...comFallback(modelo),
        system: estruturada
          ? SYSTEM_PROMPT
          : `${SYSTEM_PROMPT}\n\n## Formato da resposta\n\nResponda SOMENTE com um objeto JSON válido — sem texto antes ou depois, sem markdown — que siga este JSON Schema:\n${SCHEMA_EM_TEXTO()}`,
        messages: [
          {
            role: "user",
            content: [
              ...blocos,
              { type: "text", text: `Empresa que vai orçar: ${contexto.empresa}.\nArquivos do processo, nesta ordem:\n${lista}\n\nTranscreva o edital no formato do estudo de custo.` },
            ],
          },
        ],
      },
      { timeout: tempoMs, maxRetries: 0 }
    );
    if (message.stop_reason === "refusal")
      return { ok: false, definitivo: false, erro: `A leitura foi recusada pelo modelo (categoria ${message.stop_details?.category ?? "não informada"}). Preencha o estudo à mão.` };
    if (message.stop_reason === "max_tokens") return { ok: false, definitivo: false, erro: "O edital tem dados demais para uma leitura só: envie só o edital, o termo de referência e a planilha de itinerários." };
    const texto = message.content
      .filter((b): b is Extract<(typeof message.content)[number], { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("");
    try {
      return { ok: true, edital: EditalSchema.parse(estruturada ? JSON.parse(texto) : jsonDaResposta(texto)) };
    } catch (e) {
      return { ok: false, definitivo: false, erro: `A resposta não veio no formato esperado (${e instanceof Error ? e.message.slice(0, 160) : "erro"}).` };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Schema grande demais para a saída estruturada: a mesma leitura sem ela.
    const resta = tempoMs - (Date.now() - inicio);
    if (estruturada && /grammar/i.test(msg) && resta > 60_000) return lerComModelo(modelo, arquivos, contexto, resta, false);
    const definitivo = /credit balance|workspace/i.test(msg) || e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError;
    return { ok: false, definitivo, erro: mensagemDeErro(e) };
  }
}

export function mensagemDeErro(e: unknown): string {
  // Conta da API sem saldo ou chave recusada: não é o arquivo, é a conta — a
  // mensagem diz a quem resolver (a cobrança da API, não o sistema).
  if (/credit balance/i.test(e instanceof Error ? e.message : String(e)))
    return "A conta da API da Anthropic está sem crédito. Quem administra a conta precisa comprar créditos em console.anthropic.com (Plans & Billing) e tentar de novo — nada do edital foi perdido.";
  if (/workspace/i.test(e instanceof Error ? e.message : String(e)))
    return "A chave da IA não está ligada a um espaço de trabalho. Crie a chave dentro de um espaço de trabalho no console da Anthropic, ou informe o ID do espaço (wrkspc_…) na variável ANTHROPIC_WORKSPACE_ID da hospedagem.";
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    // O motivo que a API dá, sem o envelope JSON, para saber o que corrigir.
    const motivo = /"message"\s*:\s*"([^"]+)"/.exec(e.message)?.[1] ?? e.message;
    return `A chave da IA foi recusada (${e.status}: ${motivo.slice(0, 160)}). ${e.status === 401 ? "Confira o valor de ANTHROPIC_API_KEY na hospedagem (a chave inteira, sem espaços) e se a chave está ativa no console." : "A chave existe mas não tem acesso: confira o espaço de trabalho (ANTHROPIC_WORKSPACE_ID) e as permissões da chave."} Depois da troca, refaça o deploy.`;
  }
  if (e instanceof Anthropic.RateLimitError) return "Limite de uso da IA atingido; tente de novo em alguns minutos.";
  if (e instanceof Anthropic.APIConnectionTimeoutError) return "A leitura passou do tempo (edital muito longo). Envie só o edital, o termo de referência e a planilha de itinerários.";
  if (e instanceof Anthropic.BadRequestError) return `O arquivo não foi aceito pela leitura: ${e.message.slice(0, 200)}`;
  if (e instanceof Anthropic.APIError) return `Erro da IA (${e.status ?? "?"}): ${e.message.slice(0, 200)}`;
  return e instanceof Error ? e.message.slice(0, 200) : "falha na leitura";
}
