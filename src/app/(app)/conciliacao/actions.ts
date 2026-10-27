"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { lerReaisEmCents } from "@/lib/controladoria/format";
import { registrarEvento } from "@/lib/controladoria/trilha";
import { exigirPermissao, podeAcao } from "../_dados";

// SALDO INFORMADO DO BANCO — o que o extrato do banco mostra numa data, para
// a conta da Omie ou para uma conta que só existe no banco (aplicação).


export async function informarSaldo(formData: FormData): Promise<void> {
  const session = await exigirPermissao("informar-saldo");
  const conta = String(formData.get("conta") ?? "");
  const [conexaoId, codigo] = conta.split(":");
  const descricaoLivre = String(formData.get("descricao") ?? "").trim().slice(0, 120);
  const dataTexto = String(formData.get("data") ?? "");
  const negativo = /^\s*[-−]/.test(String(formData.get("valor") ?? ""));
  const cents = lerReaisEmCents(String(formData.get("valor") ?? "").replace(/[-−]/g, ""));
  const aplicacao = formData.get("aplicacao") === "1";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataTexto) || cents === null || cents === "invalido") return;

  const conexao = await prisma.omieConexao.findFirst({ where: { id: conexaoId, companyId: session.companyId }, select: { id: true, apelido: true } });
  if (!conexao) return;
  let descricao = descricaoLivre;
  let contaCodigo: string | null = null;
  if (codigo && codigo !== "fora") {
    const c = await prisma.omieContaCorrente.findFirst({ where: { conexaoId, codigo }, select: { descricao: true } });
    if (!c) return;
    contaCodigo = codigo;
    descricao = c.descricao;
  } else if (!descricao) {
    return;
  }

  const valorCents = BigInt(negativo ? -cents : cents);
  await prisma.saldoBancarioInformado.create({
    data: { companyId: session.companyId, conexaoId, contaCodigo, descricao, aplicacao, data: new Date(`${dataTexto}T00:00:00.000Z`), valorCents, autorNome: session.name },
  });
  try {
    await registrarEvento({
      companyId: session.companyId,
      userId: session.userId,
      userNome: session.name,
      userEmail: session.email,
      acao: "SALDO_INFORMADO",
      entidadeTipo: "SaldoBancarioInformado",
      descricao: `Saldo do banco informado: ${conexao.apelido} · ${descricao} em ${dataTexto.split("-").reverse().join("/")} = ${(Number(valorCents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`,
    });
  } catch {
    // o saldo já está gravado
  }
  revalidatePath("/conciliacao");
}

export async function excluirSaldoInformado(formData: FormData): Promise<void> {
  const session = await exigirPermissao("informar-saldo");
  const id = String(formData.get("id") ?? "");
  const s = await prisma.saldoBancarioInformado.findFirst({ where: { id, companyId: session.companyId } });
  if (!s) return;
  await prisma.saldoBancarioInformado.delete({ where: { id } });
  try {
    await registrarEvento({
      companyId: session.companyId,
      userId: session.userId,
      userNome: session.name,
      userEmail: session.email,
      acao: "SALDO_INFORMADO_EXCLUIDO",
      entidadeTipo: "SaldoBancarioInformado",
      descricao: `Saldo informado excluído: ${s.descricao} em ${s.data.toISOString().slice(0, 10)}`,
    });
  } catch {
    // segue
  }
  revalidatePath("/conciliacao");
}

// CONFERÊNCIA DE OFX — o extrato do banco contra o extrato da Omie da mesma
// conta. Só lê e compara; grava apenas se pedido (e permitido) o saldo do
// arquivo como saldo do banco.
export type ResultadoOfx = {
  erro?: string;
  arquivo?: { banco: string | null; conta: string | null; de: string | null; ate: string | null; lancamentos: number; saldoCents: number | null };
  conta?: { chave: string; descricao: string; empresa: string; saldoOmieCents: number | null; saldoOmieEm: string | null } | null;
  contas?: { chave: string; rotulo: string }[];
  casados?: number;
  casadosCents?: number;
  comDiferencaDeData?: number;
  soNoBanco?: { data: string; valorCents: number; memo: string }[];
  soNaOmie?: { data: string; valorCents: number; descricao: string; conciliado: boolean }[];
  agendados?: { data: string; valorCents: number; memo: string }[];
  saldoGravado?: boolean;
};

export async function conferirOfx(_anterior: ResultadoOfx | null, formData: FormData): Promise<ResultadoOfx> {
  const session = await exigirPermissao("conciliacao");
  const arquivo = formData.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) return { erro: "Escolha o arquivo OFX do banco." };
  if (arquivo.size > 5_000_000) return { erro: "Arquivo grande demais (máximo 5 MB)." };
  const { lerOfx, contaDoOfx, cruzarOfx } = await import("@/lib/controladoria/ofx");
  const texto = Buffer.from(await arquivo.arrayBuffer()).toString("latin1");
  const ofx = lerOfx(texto);
  if (ofx.lancamentos.length === 0 && ofx.saldoCents === null) return { erro: "Não encontrei lançamentos nem saldo no arquivo. É um OFX?" };

  const contas = await prisma.omieContaCorrente.findMany({
    where: { companyId: session.companyId },
    orderBy: [{ conexaoApelido: "asc" }, { descricao: "asc" }],
    select: { conexaoId: true, conexaoApelido: true, codigo: true, descricao: true, banco: true, numeroConta: true, saldoOmieCents: true, saldoOmieEm: true },
  });
  const escolhida = String(formData.get("conta") ?? "");
  const conta = (escolhida ? contas.find((c) => `${c.conexaoId}:${c.codigo}` === escolhida) : null) ?? contaDoOfx(ofx, contas);
  const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  const datas = ofx.lancamentos.map((l) => l.data.getTime());
  const hoje = new Date();
  const ate = ofx.fim ?? new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate()));
  const base: ResultadoOfx = {
    arquivo: { banco: ofx.banco, conta: ofx.conta, de: datas.length ? iso(new Date(Math.min(...datas))) : null, ate: iso(ate), lancamentos: ofx.lancamentos.length, saldoCents: ofx.saldoCents },
    contas: contas.map((c) => ({ chave: `${c.conexaoId}:${c.codigo}`, rotulo: `${c.conexaoApelido} · ${c.descricao}${c.numeroConta ? ` (${c.banco ?? "?"} / ${c.numeroConta})` : ""}` })),
    conta: conta
      ? { chave: `${conta.conexaoId}:${conta.codigo}`, descricao: conta.descricao, empresa: conta.conexaoApelido, saldoOmieCents: conta.saldoOmieCents, saldoOmieEm: iso(conta.saldoOmieEm) }
      : null,
  };
  if (!conta) return { ...base, erro: `Não achei na Omie a conta ${ofx.banco ?? "?"} / ${ofx.conta ?? "?"}. Escolha a conta abaixo e confira de novo.` };

  const de = new Date(Math.min(...datas, ate.getTime()) - 3 * 86_400_000);
  const omie = await prisma.omieMovimento.findMany({
    where: { conexaoId: conta.conexaoId, contaCorrenteCodigo: conta.codigo, data: { gte: de, lte: new Date(ate.getTime() + 86_399_999) } },
    select: { id: true, data: true, valorCents: true, parceiroNome: true, observacao: true, documento: true, conciliado: true },
  });
  // Só o que está dentro do período do arquivo entra como "só na Omie".
  const inicioArquivo = datas.length ? Math.min(...datas) : ate.getTime();
  const r = cruzarOfx({
    banco: ofx.lancamentos,
    omie: omie.map((o) => ({ id: o.id, data: o.data, valorCents: o.valorCents, descricao: [o.parceiroNome, o.observacao, o.documento].filter(Boolean).join(" · ") || "—", conciliado: o.conciliado })),
    ate,
  });

  let saldoGravado = false;
  if (formData.get("gravarSaldo") === "1" && ofx.saldoCents !== null && (await podeAcao(session, "informar-saldo"))) {
    await prisma.saldoBancarioInformado.create({
      data: { companyId: session.companyId, conexaoId: conta.conexaoId, contaCodigo: conta.codigo, descricao: conta.descricao, data: ofx.saldoEm ?? ate, valorCents: BigInt(ofx.saldoCents), autorNome: `${session.name} (OFX)` },
    });
    saldoGravado = true;
    revalidatePath("/conciliacao");
  }

  return {
    ...base,
    casados: r.casados.length,
    casadosCents: r.casados.reduce((s, c) => s + c.banco.valorCents, 0),
    comDiferencaDeData: r.casados.filter((c) => c.dias !== 0).length,
    soNoBanco: r.soNoBanco.map((l) => ({ data: iso(l.data)!, valorCents: l.valorCents, memo: l.memo })),
    soNaOmie: r.soNaOmie.filter((o) => o.data.getTime() >= inicioArquivo).map((o) => ({ data: iso(o.data)!, valorCents: o.valorCents, descricao: o.descricao, conciliado: o.conciliado })),
    agendados: r.agendados.map((l) => ({ data: iso(l.data)!, valorCents: l.valorCents, memo: l.memo })),
    saldoGravado,
  };
}

