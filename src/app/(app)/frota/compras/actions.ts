"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { redigir } from "@/lib/controladoria/falhas";
import { lerReaisEmCents } from "@/lib/controladoria/format";
import { lerData, lerInteiro } from "@/lib/cadastro/fichaVeiculo";
import { normalizarChassi, normalizarPlaca } from "@/lib/cadastro/normalizacao";
import { registrarAlteracao } from "@/lib/auditoria/trilha";
import { criarPendencia } from "@/lib/auditoria/pendencias";
import { documentosExigidosDoVeiculo, TIPO_DOCUMENTO } from "@/lib/frota/documentos";
import { lerPedido, notasDoFornecedor, ROTULO_FORMA } from "@/lib/frota/compras";
import { exigirPermissao, podeAcao } from "../../_dados";

// AS AÇÕES DO FLUXO DE COMPRA. Pedir e receber exigem "gerir-frota"; quem
// aprova é a Diretoria, pela pendência (e quem pediu não aprova).

type Resposta = { erro?: string; id?: string; ok?: boolean };
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].map(([k, v]) => [k, typeof v === "string" ? v : ""]));
const falha = (e: unknown): Resposta => ({ erro: redigir(e instanceof Error ? e.message : "erro").slice(0, 300) });
const br = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join("/");

export async function pedirCompra(fd: FormData): Promise<Resposta> {
  const session = await exigirPermissao("gerir-frota");
  try {
    const comValores = await podeAcao(session, "frota-valores");
    const lido = lerPedido(form(fd), comValores, new Date());
    if (!lido.ok) return { erro: lido.erro };
    const d = lido.dados;
    const compra = await prisma.frotaCompra.create({ data: { companyId: session.companyId, ...d, solicitadoPor: session.name } });
    await registrarAlteracao(prisma, { companyId: session.companyId, usuario: session.name, tabela: "FrotaCompra", registroId: compra.id, operacao: "insert", depois: { ...d, valorUnitarioCents: d.valorUnitarioCents?.toString() ?? null } });
    const descricao = [d.marca, d.modelo, d.anoMod].filter(Boolean).join(" ") || d.tipo;
    const valorTotal = d.valorUnitarioCents !== null ? Number(d.valorUnitarioCents) * d.quantidade : null;
    const p = await criarPendencia({
      companyId: session.companyId,
      agente: `usuario:${session.name}`,
      tipo: "compra-veiculo",
      titulo: `Compra de ${d.quantidade} ${descricao}${d.destino ? ` para ${d.destino}` : ""}`,
      descricao: `${d.justificativa} — ${ROTULO_FORMA[d.formaPagamento]}${d.instituicao ? ` (${d.instituicao})` : ""}${d.fornecedorNome ? `, fornecedor ${d.fornecedorNome}` : ""}${valorTotal !== null ? `, total estimado ${(valorTotal / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}` : ""}. Ao aprovar, o pedido fica aguardando os veículos (Frota › Compras).`,
      severidade: "alta",
      evidencias: { compraId: compra.id, solicitadoPor: session.name, quantidade: d.quantidade, veiculo: descricao, formaPagamento: d.formaPagamento },
      acaoProposta: { compraId: compra.id },
      perfilAprovador: "admin",
      chaveExcecao: `compra-veiculo:${compra.id}`,
    });
    await prisma.frotaCompra.update({ where: { id: compra.id }, data: { pendenciaId: p.id } });
    revalidatePath("/frota/compras");
    revalidatePath("/pendencias");
    return { id: compra.id };
  } catch (e) {
    return falha(e);
  }
}

export async function cancelarCompra(fd: FormData): Promise<Resposta> {
  const session = await exigirPermissao("gerir-frota");
  try {
    const id = String(fd.get("id") ?? "");
    const c = await prisma.frotaCompra.findFirst({ where: { id, companyId: session.companyId }, include: { _count: { select: { veiculos: true } } } });
    if (!c) return { erro: "Pedido não encontrado." };
    if (c.status === "concluida" || c.status === "cancelada") return { erro: `O pedido já está ${c.status}.` };
    const motivo = String(fd.get("motivo") ?? "").trim();
    if (!motivo) return { erro: "Diga o motivo do cancelamento." };
    await prisma.frotaCompra.update({ where: { id }, data: { status: c._count.veiculos > 0 ? "concluida" : "cancelada", justificativa: `${c.justificativa} [encerrado por ${session.name}: ${motivo.slice(0, 200)}]` } });
    await registrarAlteracao(prisma, { companyId: session.companyId, usuario: session.name, tabela: "FrotaCompra", registroId: id, operacao: "update", antes: { status: c.status }, depois: { status: c._count.veiculos > 0 ? "concluida" : "cancelada", motivo } });
    revalidatePath(`/frota/compras/${id}`);
    revalidatePath("/frota/compras");
    return { ok: true };
  } catch (e) {
    return falha(e);
  }
}

// O VEÍCULO CHEGOU: entra no cadastro em "reserva", com a NF da Omie, os
// documentos exigidos como pendentes e o checklist de inclusão.
export async function receberVeiculo(fd: FormData): Promise<Resposta> {
  const session = await exigirPermissao("gerir-frota");
  try {
    const companyId = session.companyId;
    const compra = await prisma.frotaCompra.findFirst({ where: { id: String(fd.get("compraId") ?? ""), companyId }, include: { _count: { select: { veiculos: true } } } });
    if (!compra) return { erro: "Pedido não encontrado." };
    if (compra.status !== "aprovada") return { erro: compra.status === "solicitada" ? "O pedido ainda não foi aprovado pela Diretoria." : `O pedido está ${compra.status}.` };
    if (compra._count.veiculos >= compra.quantidade) return { erro: "Todos os veículos do pedido já foram recebidos." };
    const chassiTxt = String(fd.get("chassi") ?? "").trim();
    const chassi = normalizarChassi(chassiTxt);
    if (!chassi) return { erro: "Chassi inválido (17 caracteres, sem I, O ou Q)." };
    const placaTxt = String(fd.get("placa") ?? "").trim();
    const placa = placaTxt ? normalizarPlaca(placaTxt) : null;
    if (placaTxt && !placa) return { erro: "Placa inválida (use ABC1234 ou ABC1D23)." };
    const anoFab = lerInteiro(fd.get("anoFab"), 2000, new Date().getUTCFullYear() + 1);
    if (anoFab === "invalido") return { erro: "Ano de fabricação inválido." };
    for (const [campo, valor] of [["chassi", chassi], ["placa", placa]] as const) {
      if (valor && (await prisma.cadVeiculo.findFirst({ where: { companyId, [campo]: valor }, select: { id: true } }))) return { erro: `Já existe um veículo com ${campo === "placa" ? "a placa" : "o chassi"} ${valor}.` };
    }
    // A NOTA: escolhida entre as do fornecedor na Omie, ou digitada.
    let nf: { numero: string | null; data: Date | null; valorCents: number | null; vendedor: string | null } = { numero: null, data: null, valorCents: null, vendedor: compra.fornecedorNome };
    const escolhida = String(fd.get("nota") ?? "");
    if (escolhida) {
      const nota = (await notasDoFornecedor(companyId, compra)).find((n) => n.chave === escolhida);
      if (!nota) return { erro: "Essa nota não está mais disponível — recarregue a tela." };
      nf = { numero: nota.numeroDocumento, data: nota.dataEmissao, valorCents: nota.valorCents, vendedor: nota.parceiroNome ?? compra.fornecedorNome };
    } else {
      const data = lerData(fd.get("nfData"));
      if (data === "invalida") return { erro: "Data da nota inválida." };
      const valor = (await podeAcao(session, "frota-valores")) ? lerReaisEmCents(String(fd.get("nfValor") ?? "")) : null;
      if (valor === "invalido") return { erro: "Valor da nota inválido." };
      nf = { numero: String(fd.get("nfNumero") ?? "").trim().slice(0, 30) || null, data, valorCents: valor, vendedor: compra.fornecedorNome };
    }
    const dados = {
      companyId,
      chassi,
      placa,
      cor: String(fd.get("cor") ?? "").trim().slice(0, 30) || null,
      tipo: compra.tipo,
      marca: compra.marca,
      modelo: compra.modelo,
      anoFab: anoFab ?? null,
      anoMod: compra.anoMod,
      capacidade: compra.capacidade,
      categoriaUso: compra.categoriaUso,
      status: "reserva",
      alocacao: compra.destino,
      dataCompra: nf.data ?? new Date(),
      valorCompraCents: nf.valorCents !== null ? BigInt(nf.valorCents) : compra.valorUnitarioCents,
      notaFiscalCompra: nf.numero,
      vendedorNome: nf.vendedor,
      compraId: compra.id,
      origens: { compra: compra.id, recebidoPor: session.name },
    };
    const v = await prisma.cadVeiculo.create({ data: dados as Prisma.CadVeiculoUncheckedCreateInput });
    await registrarAlteracao(prisma, { companyId, usuario: session.name, tabela: "CadVeiculo", registroId: v.id, operacao: "insert", depois: { ...dados, valorCompraCents: dados.valorCompraCents?.toString() ?? null } });
    if (placa) await prisma.cadCentroCusto.createMany({ data: [{ companyId, codigo: `V-${placa}`, tipo: "veiculo", veiculoId: v.id }], skipDuplicates: true });
    const exigidos = documentosExigidosDoVeiculo(v);
    if (exigidos.length) await prisma.frotaDocumento.createMany({ data: exigidos.map((tipo) => ({ companyId, veiculoId: v.id, tipo, situacao: "pendente", observacao: "veículo novo — lançar a validade", atualizadoPor: session.name })) });
    const nome = placa ?? `chassi …${chassi.slice(-6)}`;
    await criarPendencia({
      companyId,
      agente: `usuario:${session.name}`,
      tipo: "inclusao-veiculo",
      titulo: `Inclusão do veículo novo ${nome}`,
      descricao: [
        placa ? null : "emplacar e lançar a placa e o CRLV",
        "incluir na apólice do segmento" + (compra.categoriaUso ? ` (${compra.categoriaUso})` : ""),
        "tag de pedágio",
        "rastreador (Ituran)",
        exigidos.length ? `documentos exigidos: ${exigidos.map((t) => TIPO_DOCUMENTO.get(t)?.rotulo ?? t).join(", ")}` : null,
        "passar de reserva para ativo ao alocar",
      ]
        .filter(Boolean)
        .join("; ") + ". Aprovar = tudo feito.",
      severidade: "alta",
      evidencias: { veiculoId: v.id, compraId: compra.id, placa, chassi, exigidos },
      perfilAprovador: "operacao",
      chaveExcecao: `inclusao-veiculo:${v.id}`,
    });
    if (compra.formaPagamento !== "a_vista") {
      await criarPendencia({
        companyId,
        agente: `usuario:${session.name}`,
        tipo: "ligar-contrato",
        titulo: `Ligar ${nome} ao ${ROTULO_FORMA[compra.formaPagamento]} ${compra.instituicao ?? ""}`.trim(),
        descricao: `Veículo comprado por ${ROTULO_FORMA[compra.formaPagamento]}: cadastre o contrato (ou a cota) em Financiamentos e consórcios e ligue o veículo, alienado — é o que faz o saldo devedor por placa e a conferência das parcelas na Omie valerem para ele.`,
        severidade: "media",
        evidencias: { veiculoId: v.id, compraId: compra.id, instituicao: compra.instituicao, nf: nf.numero, data: nf.data ? br(nf.data) : null },
        perfilAprovador: "financeiro",
        chaveExcecao: `ligar-contrato:${v.id}`,
      });
    }
    if (compra._count.veiculos + 1 >= compra.quantidade) {
      await prisma.frotaCompra.update({ where: { id: compra.id }, data: { status: "concluida" } });
      await registrarAlteracao(prisma, { companyId, usuario: session.name, tabela: "FrotaCompra", registroId: compra.id, operacao: "update", antes: { status: "aprovada" }, depois: { status: "concluida" } });
    }
    revalidatePath(`/frota/compras/${compra.id}`);
    revalidatePath("/frota");
    return { id: v.id };
  } catch (e) {
    return falha(e);
  }
}
