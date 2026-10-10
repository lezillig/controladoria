import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

// OS ARQUIVOS DO ESTUDO — o edital e os anexos enviados na importação, e o que
// vier depois (ata da sessão, contrato, recurso), guardados no banco para a
// consulta no histórico. Como na Conformidade: poucos por estudo, e o arquivo
// é a evidência. O conteúdo só sai pela rota de download.
//
// Na importação o estudo ainda não existe: o arquivo é guardado sem estudo e
// preso a ele no "Criar". O que não virou estudo some depois de dois dias.

export const TIPOS_ARQUIVO = ["EDITAL", "ATA", "CONTRATO", "PROPOSTA", "OUTRO"] as const;
export type TipoArquivo = (typeof TIPOS_ARQUIVO)[number];
// Uma parte de PDF (até 3,5 MB) ou um arquivo inteiro abaixo do limite de
// envio da hospedagem; e um teto por estudo, para o banco não virar depósito.
export const TAMANHO_MAXIMO_ARQUIVO = 4_400_000;
export const TAMANHO_MAXIMO_POR_ESTUDO = 80_000_000;
const DIAS_DO_ORFAO = 2;

export async function guardarArquivo(d: {
  companyId: string;
  estudoId: string | null;
  tipo: TipoArquivo;
  nome: string;
  mimeType: string;
  conteudo: Buffer;
  autor: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; erro: string }> {
  if (d.conteudo.byteLength === 0) return { ok: false, erro: `${d.nome}: arquivo vazio.` };
  if (d.conteudo.byteLength > TAMANHO_MAXIMO_ARQUIVO) return { ok: false, erro: `${d.nome}: acima de ${(TAMANHO_MAXIMO_ARQUIVO / 1e6).toFixed(1)} MB.` };
  const sha256 = createHash("sha256").update(d.conteudo).digest("hex");
  const onde = { companyId: d.companyId, estudoId: d.estudoId };
  // O mesmo arquivo de novo no mesmo estudo (ou na mesma importação) não duplica.
  const igual = await prisma.simArquivo.findFirst({ where: { ...onde, sha256 }, select: { id: true } });
  if (igual) return { ok: true, id: igual.id };
  if (d.estudoId) {
    const usado = await prisma.simArquivo.aggregate({ where: onde, _sum: { tamanhoBytes: true } });
    if ((usado._sum.tamanhoBytes ?? 0) + d.conteudo.byteLength > TAMANHO_MAXIMO_POR_ESTUDO)
      return { ok: false, erro: `O estudo já guarda ${((usado._sum.tamanhoBytes ?? 0) / 1e6).toFixed(0)} MB de arquivos (limite ${TAMANHO_MAXIMO_POR_ESTUDO / 1e6} MB).` };
  } else await limparOrfaos(d.companyId);
  const a = await prisma.simArquivo.create({
    data: { ...onde, tipo: d.tipo, nome: d.nome.slice(0, 200), mimeType: (d.mimeType || "application/octet-stream").slice(0, 120), tamanhoBytes: d.conteudo.byteLength, sha256, conteudo: new Uint8Array(d.conteudo), enviadoPorNome: d.autor },
    select: { id: true },
  });
  return { ok: true, id: a.id };
}

// Os arquivos enviados na importação passam a ser do estudo criado. Só os da
// mesma empresa e ainda sem estudo: id de outra empresa ou de outro estudo é
// ignorado em silêncio.
export async function prenderAoEstudo(companyId: string, estudoId: string, ids: string[]): Promise<number> {
  const validos = ids.filter((x) => typeof x === "string" && /^[a-z0-9]{20,40}$/.test(x)).slice(0, 200);
  if (validos.length === 0) return 0;
  const r = await prisma.simArquivo.updateMany({ where: { id: { in: validos }, companyId, estudoId: null }, data: { estudoId } });
  return r.count;
}

async function limparOrfaos(companyId: string) {
  const limite = new Date(Date.now() - DIAS_DO_ORFAO * 86_400_000);
  await prisma.simArquivo.deleteMany({ where: { companyId, estudoId: null, criadoEm: { lt: limite } } });
}
