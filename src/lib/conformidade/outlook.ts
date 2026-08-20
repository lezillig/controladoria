// LEITOR DE .MSG (mensagem do Outlook).
//
// Existe porque é assim que o documento chega de verdade: ninguém salva o PDF
// da consultoria e sobe o arquivo — encaminha o e-mail. Sem ler .msg, o módulo
// exigiria um passo manual (abrir o e-mail, salvar o anexo, subir) justamente
// na hora em que a pessoa está com pressa, e o passo manual é onde o processo
// morre.
//
// O .msg é um Compound File Binary (o formato OLE2 da Microsoft): um
// mini-sistema de arquivos dentro de um arquivo. O leitor abaixo faz só o que
// este caso exige — cabeçalho, FAT, diretório, mini-stream — e nada de escrita,
// macro ou OLE de verdade. Zero dependência de terceiros, pela mesma razão do
// leitor de ZIP em extracao.ts: o arquivo vem de fora e é processado no
// servidor, e parser de documento é superfície de ataque.

const ASSINATURA_CFB = "d0cf11e0a1b11ae1";

// Marcadores de fim de cadeia na FAT.
const FIM_DA_CADEIA = 0xfffffffe;
const SETOR_LIVRE = 0xffffffff;
const MAXIMO_SETORES = 1_000_000;

type EntradaDiretorio = {
  nome: string;
  tipo: number; // 1 = storage (pasta), 2 = stream (arquivo), 5 = raiz
  filho: number;
  irmaoEsquerda: number;
  irmaoDireita: number;
  setorInicial: number;
  tamanho: number;
};

type Cfb = {
  buffer: Buffer;
  tamanhoSetor: number;
  tamanhoMiniSetor: number;
  fat: number[];
  miniFat: number[];
  miniStream: Buffer;
  corteMiniStream: number;
  diretorio: EntradaDiretorio[];
};

export function pareceMsg(conteudo: Buffer): boolean {
  return conteudo.length > 512 && conteudo.subarray(0, 8).toString("hex") === ASSINATURA_CFB;
}

function abrirCfb(buffer: Buffer): Cfb {
  if (!pareceMsg(buffer)) throw new Error("arquivo não é uma mensagem do Outlook (.msg)");

  const tamanhoSetor = 1 << buffer.readUInt16LE(0x1e);
  const tamanhoMiniSetor = 1 << buffer.readUInt16LE(0x20);
  const corteMiniStream = buffer.readUInt32LE(0x38);
  const primeiroDiretorio = buffer.readUInt32LE(0x30);
  const primeiroMiniFat = buffer.readUInt32LE(0x3c);
  const quantidadeMiniFat = buffer.readUInt32LE(0x40);
  const primeiroDifat = buffer.readUInt32LE(0x44);
  const quantidadeDifat = buffer.readUInt32LE(0x48);

  const inicioDoSetor = (setor: number) => 512 + setor * tamanhoSetor;
  const lerSetor = (setor: number): Buffer => buffer.subarray(inicioDoSetor(setor), inicioDoSetor(setor) + tamanhoSetor);

  // ---- DIFAT: a lista de quais setores guardam a FAT ----
  // Os 109 primeiros ficam no próprio cabeçalho; acima disso a lista continua
  // em setores encadeados. Arquivo de 6 MB com anexo já passa dos 109.
  const setoresDaFat: number[] = [];
  for (let i = 0; i < 109; i++) {
    const setor = buffer.readUInt32LE(0x4c + i * 4);
    if (setor === SETOR_LIVRE) break;
    setoresDaFat.push(setor);
  }
  let difat = primeiroDifat;
  for (let i = 0; i < quantidadeDifat && difat !== FIM_DA_CADEIA && difat !== SETOR_LIVRE; i++) {
    const bloco = lerSetor(difat);
    const porBloco = tamanhoSetor / 4 - 1;
    for (let j = 0; j < porBloco; j++) {
      const setor = bloco.readUInt32LE(j * 4);
      if (setor === SETOR_LIVRE) break;
      setoresDaFat.push(setor);
    }
    difat = bloco.readUInt32LE(tamanhoSetor - 4);
  }

  const fat: number[] = [];
  for (const setor of setoresDaFat) {
    const bloco = lerSetor(setor);
    for (let i = 0; i < tamanhoSetor / 4; i++) fat.push(bloco.readUInt32LE(i * 4));
  }

  // Percorre uma cadeia de setores. O teto de iterações é proteção contra
  // arquivo malformado (ou malicioso) com FAT circular — sem ele, um .msg
  // corrompido travaria o processo do servidor num laço infinito.
  const seguirCadeia = (inicio: number, limiteBytes?: number): Buffer => {
    const partes: Buffer[] = [];
    let setor = inicio;
    let lidos = 0;
    for (let i = 0; setor !== FIM_DA_CADEIA && setor !== SETOR_LIVRE && i < MAXIMO_SETORES; i++) {
      partes.push(lerSetor(setor));
      lidos += tamanhoSetor;
      if (limiteBytes !== undefined && lidos >= limiteBytes) break;
      setor = fat[setor] ?? FIM_DA_CADEIA;
    }
    const inteiro = Buffer.concat(partes);
    return limiteBytes === undefined ? inteiro : inteiro.subarray(0, limiteBytes);
  };

  const miniFat: number[] = [];
  let setorMiniFat = primeiroMiniFat;
  for (let i = 0; i < quantidadeMiniFat && setorMiniFat !== FIM_DA_CADEIA && setorMiniFat !== SETOR_LIVRE; i++) {
    const bloco = lerSetor(setorMiniFat);
    for (let j = 0; j < tamanhoSetor / 4; j++) miniFat.push(bloco.readUInt32LE(j * 4));
    setorMiniFat = fat[setorMiniFat] ?? FIM_DA_CADEIA;
  }

  // ---- Diretório ----
  const bytesDiretorio = seguirCadeia(primeiroDiretorio);
  const diretorio: EntradaDiretorio[] = [];
  for (let offset = 0; offset + 128 <= bytesDiretorio.length; offset += 128) {
    const tamanhoNome = bytesDiretorio.readUInt16LE(offset + 64);
    const nome =
      tamanhoNome > 2 ? bytesDiretorio.toString("utf16le", offset, offset + tamanhoNome - 2) : "";
    diretorio.push({
      nome,
      tipo: bytesDiretorio.readUInt8(offset + 66),
      irmaoEsquerda: bytesDiretorio.readUInt32LE(offset + 68),
      irmaoDireita: bytesDiretorio.readUInt32LE(offset + 72),
      filho: bytesDiretorio.readUInt32LE(offset + 76),
      setorInicial: bytesDiretorio.readUInt32LE(offset + 116),
      // O tamanho é um uint64; ler só os 32 bits baixos basta e evita BigInt —
      // stream de .msg acima de 4 GB não existe neste mundo.
      tamanho: bytesDiretorio.readUInt32LE(offset + 120),
    });
  }

  // Streams pequenos (abaixo do corte, normalmente 4096 bytes) não ficam nos
  // setores normais: moram todos concatenados dentro de um stream único,
  // apontado pela entrada raiz, e são endereçados pela miniFAT.
  const raiz = diretorio[0];
  const miniStream = raiz ? seguirCadeia(raiz.setorInicial, raiz.tamanho) : Buffer.alloc(0);

  return { buffer, tamanhoSetor, tamanhoMiniSetor, fat, miniFat, miniStream, corteMiniStream, diretorio };
}

function lerStream(cfb: Cfb, entrada: EntradaDiretorio): Buffer {
  if (entrada.tamanho === 0) return Buffer.alloc(0);

  if (entrada.tamanho < cfb.corteMiniStream) {
    const partes: Buffer[] = [];
    let setor = entrada.setorInicial;
    let restante = entrada.tamanho;
    for (let i = 0; setor !== FIM_DA_CADEIA && setor !== SETOR_LIVRE && restante > 0 && i < MAXIMO_SETORES; i++) {
      const inicio = setor * cfb.tamanhoMiniSetor;
      partes.push(cfb.miniStream.subarray(inicio, inicio + Math.min(cfb.tamanhoMiniSetor, restante)));
      restante -= cfb.tamanhoMiniSetor;
      setor = cfb.miniFat[setor] ?? FIM_DA_CADEIA;
    }
    return Buffer.concat(partes);
  }

  const partes: Buffer[] = [];
  let setor = entrada.setorInicial;
  let restante = entrada.tamanho;
  for (let i = 0; setor !== FIM_DA_CADEIA && setor !== SETOR_LIVRE && restante > 0 && i < MAXIMO_SETORES; i++) {
    const inicio = 512 + setor * cfb.tamanhoSetor;
    partes.push(cfb.buffer.subarray(inicio, inicio + Math.min(cfb.tamanhoSetor, restante)));
    restante -= cfb.tamanhoSetor;
    setor = cfb.fat[setor] ?? FIM_DA_CADEIA;
  }
  return Buffer.concat(partes);
}

// Filhos diretos de um storage. O diretório do CFB é uma árvore rubro-negra;
// aqui só interessa visitar todos os nós, então uma travessia simples com
// controle de visitados resolve — e o controle é o que impede um arquivo com
// ponteiros circulares de virar recursão infinita.
function filhosDe(cfb: Cfb, indice: number): EntradaDiretorio[] {
  const raiz = cfb.diretorio[indice];
  if (!raiz || raiz.filho === SETOR_LIVRE) return [];

  const encontrados: EntradaDiretorio[] = [];
  const visitados = new Set<number>();
  const pilha = [raiz.filho];

  while (pilha.length > 0) {
    const atual = pilha.pop()!;
    if (atual === SETOR_LIVRE || visitados.has(atual)) continue;
    visitados.add(atual);
    const entrada = cfb.diretorio[atual];
    if (!entrada) continue;
    encontrados.push(entrada);
    pilha.push(entrada.irmaoEsquerda, entrada.irmaoDireita);
  }

  return encontrados;
}

function indiceDe(cfb: Cfb, entrada: EntradaDiretorio): number {
  return cfb.diretorio.indexOf(entrada);
}

// As propriedades de uma mensagem MAPI são streams com nome
// `__substg1.0_<ID><TIPO>`: 0037 é o assunto, 1000 o corpo, 3701 o conteúdo do
// anexo. O tipo diz como decodificar — 001F é UTF-16, 001E é ASCII, 0102 é
// binário puro.
function propriedade(cfb: Cfb, filhos: EntradaDiretorio[], id: string): string | null {
  for (const tipo of ["001F", "001E"]) {
    const entrada = filhos.find((f) => f.nome.toUpperCase() === `__SUBSTG1.0_${id}${tipo}`);
    if (!entrada) continue;
    const bruto = lerStream(cfb, entrada);
    return tipo === "001F" ? bruto.toString("utf16le") : bruto.toString("latin1");
  }
  return null;
}

function propriedadeBinaria(cfb: Cfb, filhos: EntradaDiretorio[], id: string): Buffer | null {
  const entrada = filhos.find((f) => f.nome.toUpperCase() === `__SUBSTG1.0_${id}0102`);
  return entrada ? lerStream(cfb, entrada) : null;
}

export type AnexoMsg = { nome: string; conteudo: Buffer; mimeType: string | null };

export type MensagemMsg = {
  assunto: string | null;
  remetenteNome: string | null;
  remetenteEmail: string | null;
  destinatarios: string | null;
  data: Date | null;
  corpo: string | null;
  anexos: AnexoMsg[];
};

export function lerMsg(conteudo: Buffer): MensagemMsg {
  const cfb = abrirCfb(conteudo);
  const filhosRaiz = filhosDe(cfb, 0);

  const corpoTexto = propriedade(cfb, filhosRaiz, "1000");
  const corpoHtml = corpoTexto ? null : propriedadeBinaria(cfb, filhosRaiz, "1013");

  const anexos: AnexoMsg[] = [];
  for (const storage of filhosRaiz) {
    if (storage.tipo !== 1 || !storage.nome.toUpperCase().startsWith("__ATTACH_VERSION1.0")) continue;
    const filhosAnexo = filhosDe(cfb, indiceDe(cfb, storage));
    const dados = propriedadeBinaria(cfb, filhosAnexo, "3701");
    if (!dados || dados.length === 0) continue;
    const nome =
      propriedade(cfb, filhosAnexo, "3707") ?? propriedade(cfb, filhosAnexo, "3704") ?? "anexo";
    anexos.push({
      nome: nome.replace(/\0/g, "").trim(),
      conteudo: dados,
      mimeType: propriedade(cfb, filhosAnexo, "370E")?.replace(/\0/g, "").trim() ?? null,
    });
  }

  const limpar = (t: string | null) => t?.replace(/\0/g, "").trim() || null;

  return {
    assunto: limpar(propriedade(cfb, filhosRaiz, "0037")),
    remetenteNome: limpar(propriedade(cfb, filhosRaiz, "0C1A")),
    remetenteEmail: limpar(propriedade(cfb, filhosRaiz, "0C1F") ?? propriedade(cfb, filhosRaiz, "5D01")),
    destinatarios: limpar(propriedade(cfb, filhosRaiz, "0E04")),
    data: dataDaMensagem(cfb, filhosRaiz),
    corpo: limpar(corpoTexto ?? (corpoHtml ? htmlParaTexto(corpoHtml.toString("utf8")) : null)),
    anexos,
  };
}

// Data de envio/recebimento. Diferente do assunto e do corpo, ela não é um
// stream próprio: mora no bloco de propriedades de tamanho fixo, em FILETIME
// (100 nanossegundos desde 1601). Vale o trabalho porque é ela que diz a
// competência provável do documento sem ninguém digitar nada.
const PROPRIEDADES_DE_DATA = ["0E060040", "00390040"]; // entrega, envio

function dataDaMensagem(cfb: Cfb, filhos: EntradaDiretorio[]): Date | null {
  const entrada = filhos.find((f) => f.nome.toUpperCase() === "__PROPERTIES_VERSION1.0");
  if (!entrada) return null;
  const bloco = lerStream(cfb, entrada);

  // 32 bytes de cabeçalho na mensagem de topo, depois entradas de 16 bytes:
  // 4 de tag (tipo nos 16 bits baixos, id nos altos), 4 de flags, 8 de valor.
  for (let offset = 32; offset + 16 <= bloco.length; offset += 16) {
    const tag = bloco.readUInt32LE(offset).toString(16).padStart(8, "0");
    if (!PROPRIEDADES_DE_DATA.includes(tag)) continue;
    const baixo = bloco.readUInt32LE(offset + 8);
    const alto = bloco.readUInt32LE(offset + 12);
    if (alto === 0 && baixo === 0) continue;
    // FILETIME conta unidades de 100 ns desde 1601-01-01; a diferença para a
    // época Unix é 11.644.473.600 segundos.
    //
    // A conversão divide a parte alta ANTES de somar. Um FILETIME de hoje passa
    // de 2^53 e não caberia exato num double se fosse montado inteiro primeiro;
    // dividindo antes, o número fica na casa de 10^13 e a precisão sobra —
    // sobra tanto que o erro residual é de microssegundos, num campo que só
    // precisa da data.
    const ms = alto * 429496.7296 + baixo / 10000 - 11644473600000;
    const data = new Date(ms);
    if (!Number.isNaN(data.getTime()) && data.getFullYear() > 1990) return data;
  }
  return null;
}

function htmlParaTexto(html: string): string {
  return html
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|tr|li|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
