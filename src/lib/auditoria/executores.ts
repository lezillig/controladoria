import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { registrarAlteracao } from "./trilha";
import { criarPendencia } from "./pendencias";

// O QUE ACONTECE QUANDO UMA PENDÊNCIA É APROVADA (ADR-005): a ação proposta
// executa só depois da aprovação, e o resultado (executada ou erro) fica na
// própria pendência. Tipos sem executor são só registro de decisão.

type Pendencia = { id: string; companyId: string; tipo: string; acaoProposta: Prisma.JsonValue; decididaPor: string | null };

const EXECUTORES: Record<string, (p: Pendencia) => Promise<string>> = {
  "saida-veiculo": async (p) => {
    const a = p.acaoProposta as { veiculoId: string; status: "vendido" | "baixado"; dataVenda?: string; valorVendaCents?: string | null; compradorNome?: string | null; transferenciaSituacao?: string | null; dataBaixa?: string; motivoBaixa?: string; contratos?: string | null };
    const v = await prisma.cadVeiculo.findFirst({ where: { id: a.veiculoId, companyId: p.companyId } });
    if (!v) throw new Error("veículo não encontrado");
    const depois =
      a.status === "vendido"
        ? { status: "vendido", dataVenda: a.dataVenda ? new Date(a.dataVenda) : null, valorVendaCents: a.valorVendaCents ? BigInt(a.valorVendaCents) : null, compradorNome: a.compradorNome ?? null, transferenciaSituacao: a.transferenciaSituacao ?? null }
        : { status: "baixado", dataBaixa: a.dataBaixa ? new Date(a.dataBaixa) : null, motivoBaixa: a.motivoBaixa ?? null };
    await prisma.cadVeiculo.update({ where: { id: v.id }, data: depois });
    await registrarAlteracao(prisma, { companyId: p.companyId, usuario: p.decididaPor, agente: "pendencia", tabela: "CadVeiculo", registroId: v.id, operacao: "desativar", antes: { status: v.status }, depois });
    const vinculos = await prisma.frotaFinanciamentoVeiculo.findMany({ where: { veiculoId: v.id, alienado: true, financiamento: { ativo: true } }, select: { id: true, financiamentoId: true } });
    for (const vin of vinculos) {
      if (a.contratos === "quitar") {
        await prisma.frotaFinanciamento.update({ where: { id: vin.financiamentoId }, data: { ativo: false, dataQuitacao: depois.status === "vendido" ? (depois as { dataVenda: Date | null }).dataVenda : new Date(), motivoEncerramento: "quitado na saída do veículo" } });
      }
      await prisma.frotaFinanciamentoVeiculo.update({ where: { id: vin.id }, data: { alienado: false } });
    }
    await prisma.cadCentroCusto.updateMany({ where: { companyId: p.companyId, veiculoId: v.id }, data: { ativo: false } });
    const nome = v.placa ?? v.chassi ?? v.id;
    await criarPendencia({
      companyId: p.companyId,
      agente: "saida-veiculo",
      tipo: "checklist-saida",
      titulo: `Checklist de saída do veículo ${nome}`,
      descricao: "Confirme cada item antes de aprovar: excluir da apólice; cancelar a tag de pedágio; retirar o rastreador; comunicação de venda/ATPV no Detran; baixa da alienação (se quitado); tirar da escala e do rateio de custos.",
      severidade: "media",
      evidencias: { veiculoId: v.id, placa: v.placa, apoliceId: v.apoliceId, tagPedagio: v.tagPedagio, contratos: vinculos.length },
      perfilAprovador: "operacao",
      chaveExcecao: `checklist-saida:${v.id}`,
    });
    return `veículo ${nome} fora da frota; ${vinculos.length} contrato(s) ${a.contratos === "quitar" ? "quitado(s)" : "desalienado(s)"}; checklist de saída aberto`;
  },
};

// CONTRATO QUITADO (aberto pelo agente da frota quando a última parcela
// aparece paga na Omie): encerra, desaliena e pede a baixa do gravame.
EXECUTORES["contrato-quitado"] = async (p) => {
  const a = p.acaoProposta as { financiamentoId: string; dataQuitacao?: string };
  const c = await prisma.frotaFinanciamento.findFirst({ where: { id: a.financiamentoId, companyId: p.companyId }, include: { veiculos: { include: { veiculo: { select: { id: true, placa: true, chassi: true } } } } } });
  if (!c) throw new Error("contrato não encontrado");
  if (!c.ativo) return "o contrato já estava encerrado";
  const depois = { ativo: false, dataQuitacao: a.dataQuitacao ? new Date(a.dataQuitacao) : new Date(), motivoEncerramento: "quitado (última parcela paga na Omie)" };
  await prisma.frotaFinanciamento.update({ where: { id: c.id }, data: depois });
  await registrarAlteracao(prisma, { companyId: p.companyId, usuario: p.decididaPor, agente: "pendencia", tabela: "FrotaFinanciamento", registroId: c.id, operacao: "update", antes: { ativo: true }, depois });
  const alienados = c.veiculos.filter((v) => v.alienado);
  if (alienados.length) {
    await prisma.frotaFinanciamentoVeiculo.updateMany({ where: { id: { in: alienados.map((v) => v.id) } }, data: { alienado: false } });
    const placas = alienados.map((v) => v.veiculo.placa ?? v.veiculo.chassi ?? v.veiculoId);
    await criarPendencia({
      companyId: p.companyId,
      agente: "contrato-quitado",
      tipo: "baixa-gravame",
      titulo: `Baixa do gravame: ${placas.join(", ")}`,
      descricao: `Contrato ${c.instituicao} ${c.contratoNumero ?? `${c.grupo}/${c.cota}`} quitado. Pedir ao banco/administradora a baixa da alienação no Detran e conferir o CRLV sem o gravame. Aprovar = baixa feita.`,
      severidade: "media",
      evidencias: { financiamentoId: c.id, veiculos: alienados.map((v) => ({ id: v.veiculoId, placa: v.veiculo.placa })) },
      perfilAprovador: "operacao",
      chaveExcecao: `baixa-gravame:${c.id}`,
    });
  }
  return `contrato encerrado como quitado; ${alienados.length} veículo(s) desalienado(s)${alienados.length ? "; baixa do gravame aberta" : ""}`;
};

export async function executarPendencia(id: string): Promise<void> {
  const p = await prisma.audPendencia.findUnique({ where: { id } });
  if (!p || p.status !== "aprovada") return;
  const executor = EXECUTORES[p.tipo];
  if (!executor) return;
  try {
    const resumo = await executor(p);
    await prisma.audPendencia.update({ where: { id }, data: { status: "executada", executadaEm: new Date(), erro: null, comentario: [p.comentario, `Executada: ${resumo}`].filter(Boolean).join(" — ") } });
  } catch (e) {
    await prisma.audPendencia.update({ where: { id }, data: { status: "erro", erro: (e instanceof Error ? e.message : String(e)).slice(0, 500) } });
  }
}
