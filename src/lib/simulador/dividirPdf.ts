// DIVIDIR UM PDF GRANDE EM PARTES — para o envio do edital (ImportarEdital).
//
// A hospedagem recusa requisição acima de ~4,5 MB; edital digitalizado passa
// de 10 MB. Divide por intervalos de páginas: estima as páginas por parte pelo
// tamanho médio e, se uma parte salva ainda passa do limite, divide aquele
// intervalo ao meio. Roda no navegador (e nos testes, no Node): pdf-lib só.

export const LIMITE_PARTE = 3_500_000;

export type ParteDoPdf = { de: number; ate: number; total: number; bytes: Uint8Array };

export async function dividirPdf(conteudo: ArrayBuffer | Uint8Array, nome: string, limite = LIMITE_PARTE): Promise<ParteDoPdf[]> {
  const { PDFDocument } = await import("pdf-lib");
  const original = await PDFDocument.load(conteudo, { ignoreEncryption: true });
  const total = original.getPageCount();
  const tamanho = conteudo.byteLength;
  const porParte = Math.max(1, Math.floor((total * limite * 0.8) / Math.max(1, tamanho)));
  const intervalos: [number, number][] = [];
  for (let i = 0; i < total; i += porParte) intervalos.push([i, Math.min(total, i + porParte)]);
  const partes: ParteDoPdf[] = [];
  while (intervalos.length > 0) {
    const [de, ate] = intervalos.shift()!;
    const doc = await PDFDocument.create();
    const paginas = await doc.copyPages(original, Array.from({ length: ate - de }, (_, k) => de + k));
    for (const p of paginas) doc.addPage(p);
    const bytes = await doc.save();
    if (bytes.byteLength > limite) {
      if (ate - de === 1) throw new Error(`${nome}: a página ${de + 1} sozinha passa de ${(limite / 1_000_000).toLocaleString("pt-BR")} MB — reduza a resolução do PDF.`);
      const meio = de + Math.floor((ate - de) / 2);
      intervalos.unshift([de, meio], [meio, ate]);
      continue;
    }
    partes.push({ de, ate, total, bytes });
  }
  return partes.sort((a, b) => a.de - b.de);
}
