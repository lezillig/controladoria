import { inflateRawSync } from "node:zlib";

// LEITURA DOS ARQUIVOS RECEBIDOS DA CONSULTORIA.
//
// O que chega de uma consultoria de risco, na prática: PDF (a maioria),
// planilha, às vezes um .docx e, com alguma frequência, o print de uma tela.
// Este arquivo resolve o primeiro problema — transformar cada um deles em algo
// que a leitura automática consiga interpretar — e apenas isso: quem decide o
// que é apontamento é `analise.ts`.
//
// Nenhuma biblioteca de terceiros para abrir arquivo, de propósito. Parser de
// documento é historicamente uma das maiores superfícies de ataque que existe
// (o arquivo vem de fora e é processado no servidor), e num sistema que guarda
// o financeiro de duas empresas não vale a pena adicionar essa dependência para
// ler doze documentos por ano. PDF e imagem vão direto para o modelo, que os lê
// nativamente; .docx e .xlsx são ZIP com XML dentro, e o leitor abaixo faz
// exatamente o mínimo para tirar o texto deles.

export type FormatoDocumento = "PDF" | "IMAGEM" | "TEXTO" | "OOXML" | "NAO_SUPORTADO";

// Teto do texto que segue para a leitura automática. Relatório de consultoria
// raramente passa disso; planilha de 50 mil linhas passa fácil, e mandá-la
// inteira só gastaria orçamento sem melhorar a leitura — os apontamentos estão
// nas primeiras páginas, não na milésima linha de um anexo de dados.
const LIMITE_TEXTO = 200_000;

const EXTENSOES_IMAGEM = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
const EXTENSOES_TEXTO = new Set(["txt", "md", "csv", "tsv", "json", "xml", "html", "htm"]);
const EXTENSOES_OOXML = new Set(["docx", "xlsx", "pptx"]);

export function extensaoDe(nomeArquivo: string): string {
  const parte = nomeArquivo.toLowerCase().split(".").pop();
  return parte && parte !== nomeArquivo.toLowerCase() ? parte : "";
}

// A classificação usa a EXTENSÃO como fonte primária e o mime-type só como
// reforço. O mime-type vem do navegador do usuário e é notoriamente impreciso
// (o Windows manda `application/octet-stream` para .xlsx com frequência); a
// extensão é o que a pessoa de fato escolheu ao salvar o arquivo.
export function classificarArquivo(nomeArquivo: string, mimeType: string): FormatoDocumento {
  const ext = extensaoDe(nomeArquivo);
  const mime = (mimeType || "").toLowerCase();

  if (ext === "pdf" || mime === "application/pdf") return "PDF";
  if (EXTENSOES_IMAGEM.has(ext) || mime.startsWith("image/")) return "IMAGEM";
  if (EXTENSOES_OOXML.has(ext) || mime.includes("openxmlformats")) return "OOXML";
  if (EXTENSOES_TEXTO.has(ext) || mime.startsWith("text/") || mime === "application/json") return "TEXTO";
  return "NAO_SUPORTADO";
}

// Mime-type que vai para a API do modelo. Não reaproveita o que o navegador
// mandou: um `application/octet-stream` no bloco de documento faz a chamada
// falhar inteira, e a extensão já nos disse o que o arquivo é.
export function mimeParaModelo(formato: FormatoDocumento, nomeArquivo: string): string {
  if (formato === "PDF") return "application/pdf";
  const ext = extensaoDe(nomeArquivo);
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/jpeg";
}

export type ResultadoExtracao = { texto: string | null; erro: string | null };

export function extrairTexto(formato: FormatoDocumento, conteudo: Buffer, nomeArquivo: string): ResultadoExtracao {
  try {
    if (formato === "TEXTO") {
      return { texto: limitar(conteudo.toString("utf8")), erro: null };
    }
    if (formato === "OOXML") {
      const ext = extensaoDe(nomeArquivo);
      if (ext === "xlsx") return { texto: limitar(textoDePlanilha(conteudo)), erro: null };
      if (ext === "docx") return { texto: limitar(textoDeDocumentoWord(conteudo)), erro: null };
      return { texto: null, erro: "Formato Office não suportado para leitura automática (use PDF)." };
    }
    // PDF e imagem não viram texto aqui: vão inteiros para o modelo, que lê
    // tabela e layout muito melhor do que qualquer extração de texto cru faria.
    return { texto: null, erro: null };
  } catch (e) {
    return { texto: null, erro: e instanceof Error ? e.message : "falha ao ler o arquivo" };
  }
}

function limitar(texto: string): string {
  const limpo = texto.replace(/\r\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
  if (limpo.length <= LIMITE_TEXTO) return limpo;
  return `${limpo.slice(0, LIMITE_TEXTO)}\n\n[...] Documento truncado em ${LIMITE_TEXTO.toLocaleString("pt-BR")} caracteres para a leitura automática. O arquivo original está guardado inteiro.`;
}

// ---------------------------------------------------------------------------
// Leitor de ZIP mínimo
// ---------------------------------------------------------------------------
// .docx e .xlsx são arquivos ZIP contendo XML. O leitor abaixo faz só o que
// esses dois casos exigem: localizar o diretório central, achar as entradas
// pedidas e descomprimir (deflate ou armazenado). Não trata ZIP64, não trata
// criptografia e não escreve nada em disco — as três coisas que costumam
// transformar leitor de arquivo em vulnerabilidade.

const ASSINATURA_FIM_DIRETORIO = 0x06054b50;
const ASSINATURA_ENTRADA = 0x02014b50;

type EntradaZip = { nome: string; dados: Buffer };

function lerZip(buffer: Buffer, interessa: (nome: string) => boolean): EntradaZip[] {
  const fim = localizarFimDoDiretorio(buffer);
  if (fim < 0) throw new Error("arquivo não é um ZIP válido (Office corrompido?)");

  const quantidade = buffer.readUInt16LE(fim + 10);
  let posicao = buffer.readUInt32LE(fim + 16);
  const entradas: EntradaZip[] = [];

  for (let i = 0; i < quantidade; i++) {
    if (posicao + 46 > buffer.length || buffer.readUInt32LE(posicao) !== ASSINATURA_ENTRADA) break;

    const metodo = buffer.readUInt16LE(posicao + 10);
    const tamanhoComprimido = buffer.readUInt32LE(posicao + 20);
    const tamanhoNome = buffer.readUInt16LE(posicao + 28);
    const tamanhoExtra = buffer.readUInt16LE(posicao + 30);
    const tamanhoComentario = buffer.readUInt16LE(posicao + 32);
    const offsetLocal = buffer.readUInt32LE(posicao + 42);
    const nome = buffer.toString("utf8", posicao + 46, posicao + 46 + tamanhoNome);

    posicao += 46 + tamanhoNome + tamanhoExtra + tamanhoComentario;

    if (!interessa(nome)) continue;

    // O cabeçalho LOCAL tem o próprio tamanho de campo extra, que pode ser
    // diferente do que consta no diretório central — usar o do diretório aqui é
    // o erro clássico que faz o leitor cair no meio dos dados.
    const nomeLocal = buffer.readUInt16LE(offsetLocal + 26);
    const extraLocal = buffer.readUInt16LE(offsetLocal + 28);
    const inicio = offsetLocal + 30 + nomeLocal + extraLocal;
    const bruto = buffer.subarray(inicio, inicio + tamanhoComprimido);

    entradas.push({ nome, dados: metodo === 8 ? inflateRawSync(bruto) : Buffer.from(bruto) });
  }

  return entradas;
}

// O fim do diretório central fica no final do arquivo, mas depois dele pode
// haver um comentário de até 64 KB — daí a varredura de trás para a frente em
// vez de uma leitura em posição fixa.
function localizarFimDoDiretorio(buffer: Buffer): number {
  const minimo = Math.max(0, buffer.length - 22 - 0xffff);
  for (let i = buffer.length - 22; i >= minimo; i--) {
    if (buffer.readUInt32LE(i) === ASSINATURA_FIM_DIRETORIO) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// XML para texto
// ---------------------------------------------------------------------------

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodificarEntidades(texto: string): string {
  return texto.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (inteiro, corpo: string) => {
    if (corpo.startsWith("#x") || corpo.startsWith("#X")) {
      return String.fromCodePoint(parseInt(corpo.slice(2), 16));
    }
    if (corpo.startsWith("#")) return String.fromCodePoint(Number(corpo.slice(1)));
    return ENTIDADES[corpo] ?? inteiro;
  });
}

function removerTags(xml: string): string {
  return decodificarEntidades(xml.replace(/<[^>]*>/g, ""));
}

function textoDeDocumentoWord(conteudo: Buffer): string {
  const [documento] = lerZip(conteudo, (n) => n === "word/document.xml");
  if (!documento) throw new Error("documento Word sem word/document.xml");

  const xml = documento.dados
    .toString("utf8")
    // Quebras estruturais viram quebras de linha ANTES de as tags sumirem —
    // sem isso o documento inteiro vira um parágrafo só e a leitura perde a
    // estrutura de tópicos, que é justamente onde ficam os apontamentos.
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<w:tab[^>]*\/>/g, "\t");

  return removerTags(xml);
}

function textoDePlanilha(conteudo: Buffer): string {
  const entradas = lerZip(
    conteudo,
    (n) => n === "xl/sharedStrings.xml" || n === "xl/workbook.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(n)
  );

  const compartilhadas = tabelaDeStringsCompartilhadas(entradas.find((e) => e.nome === "xl/sharedStrings.xml")?.dados);
  const nomesDasAbas = nomesDeAbas(entradas.find((e) => e.nome === "xl/workbook.xml")?.dados);

  const abas = entradas
    .filter((e) => e.nome.startsWith("xl/worksheets/"))
    // Ordenação numérica: sem ela "sheet10" vem antes de "sheet2" e as abas
    // saem fora da ordem em que a pessoa as vê no Excel.
    .sort((a, b) => numeroDaAba(a.nome) - numeroDaAba(b.nome));

  const partes: string[] = [];
  for (const aba of abas) {
    const indice = numeroDaAba(aba.nome);
    partes.push(`## ${nomesDasAbas[indice - 1] ?? `Planilha ${indice}`}`);
    partes.push(linhasDaAba(aba.dados.toString("utf8"), compartilhadas));
  }
  return partes.join("\n\n");
}

function numeroDaAba(nome: string): number {
  return Number(nome.match(/sheet(\d+)\.xml$/)?.[1] ?? 0);
}

function nomesDeAbas(xml: Buffer | undefined): string[] {
  if (!xml) return [];
  return [...xml.toString("utf8").matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((m) => decodificarEntidades(m[1]));
}

// No formato do Excel a célula de texto não guarda o texto: guarda o índice de
// uma tabela única de strings, compartilhada pela planilha inteira. Sem
// resolver essa tabela, toda coluna de texto sairia como uma sequência de
// números — e a leitura automática interpretaria a planilha ao contrário.
function tabelaDeStringsCompartilhadas(xml: Buffer | undefined): string[] {
  if (!xml) return [];
  const conteudo = xml.toString("utf8");
  return [...conteudo.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodificarEntidades(t[1])).join("")
  );
}

function linhasDaAba(xml: string, compartilhadas: string[]): string {
  const linhas: string[] = [];

  for (const linha of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const celulas: string[] = [];
    for (const celula of linha[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const tipo = celula[1].match(/\bt="([^"]*)"/)?.[1];
      const corpo = celula[2];

      if (tipo === "s") {
        const indice = Number(corpo.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? -1);
        celulas.push(compartilhadas[indice] ?? "");
        continue;
      }
      if (tipo === "inlineStr") {
        celulas.push(removerTags(corpo));
        continue;
      }
      celulas.push(decodificarEntidades(corpo.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? ""));
    }

    // Linha totalmente vazia não vira linha: planilha de consultoria costuma
    // ter dezenas delas entre blocos, e elas só ocupariam espaço na leitura.
    if (celulas.some((c) => c.trim() !== "")) linhas.push(celulas.join(" | "));
  }

  return linhas.join("\n");
}
