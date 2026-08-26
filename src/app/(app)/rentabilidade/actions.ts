"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { lerClientes, lerMotoristas, lerVeiculos } from "@/lib/gestao/leitura";
import { registrarEvento } from "../auditoria/actions";
import { exigirPermissao } from "../_dados";

// De-para entre a dimensão de custo da Omie (departamento, projeto, categoria,
// fornecedor, texto no documento) e os cadastros de contrato/frota/pessoas
// deste sistema. É o que transforma "R$ 380 mil de custo" em "quanto custa o
// contrato da FEMSA".
//
// Um vínculo criado aqui nasce CONFIRMADO (foi uma pessoa que o criou) — ao
// contrário das sugestões automáticas, que entram como `sugerido: true` e não
// entram em nenhum cálculo até alguém confirmar. Ver o comentário em
// OmieVinculoCentroCusto no schema sobre por que a máquina não decide sozinha
// para onde o dinheiro vai.

export type ResultadoVinculo = { erro?: string; ok?: boolean };

const TIPOS_ORIGEM = ["DEPARTAMENTO", "PROJETO", "CATEGORIA", "PARCEIRO", "TEXTO"];

export async function salvarVinculo(formData: FormData): Promise<ResultadoVinculo> {
  const session = await exigirPermissao("gerir-rentabilidade");

  const tipoOrigem = String(formData.get("tipoOrigem") ?? "");
  const valorOrigem = String(formData.get("valorOrigem") ?? "").trim();
  const rotuloOrigem = String(formData.get("rotuloOrigem") ?? "").trim() || null;
  const destino = String(formData.get("destino") ?? "");
  const percentualBruto = Number(formData.get("percentual") ?? 100);

  if (!TIPOS_ORIGEM.includes(tipoOrigem)) return { erro: "Origem inválida." };
  if (!valorOrigem) return { erro: "Informe o código (ou texto) do lado da Omie." };
  if (!destino) return { erro: "Escolha o contrato, veículo ou funcionário de destino." };
  if (!Number.isFinite(percentualBruto) || percentualBruto <= 0 || percentualBruto > 100) {
    return { erro: "O percentual precisa estar entre 1 e 100." };
  }

  // O destino chega como "tipo:id" num campo só para o formulário caber numa
  // linha — a alternativa (três selects, dois sempre vazios) é pior de usar.
  const [tipoDestino, idDestino] = destino.split(":");
  if (!idDestino) return { erro: "Destino inválido." };
  const dados = {
    clienteId: tipoDestino === "cliente" ? idDestino : null,
    vehicleId: tipoDestino === "veiculo" ? idDestino : null,
    driverId: tipoDestino === "motorista" ? idDestino : null,
  };
  if (!dados.clienteId && !dados.vehicleId && !dados.driverId) return { erro: "Destino inválido." };

  // Confere que o destino pertence a esta empresa, lendo o cadastro no sistema
  // de gestão. Sem essa checagem, um id colado no formulário criaria vínculo
  // apontando para o cadastro de outra empresa — e o custo dela apareceria no
  // relatório desta.
  const pertence = dados.clienteId
    ? (await lerClientes(session.companyId)).some((c) => c.id === dados.clienteId)
    : dados.vehicleId
      ? (await lerVeiculos(session.companyId)).some((v) => v.id === dados.vehicleId)
      : (await lerMotoristas(session.companyId)).some((m) => m.id === dados.driverId);
  if (!pertence) return { erro: "Destino não encontrado no cadastro desta empresa." };

  // Sem upsert por chave composta: a constraint única inclui colunas
  // opcionais (clienteId/vehicleId/driverId são nulos conforme o destino), e
  // o Prisma não aceita nulo dentro de uma chave composta de `where`.
  // findFirst + create/update expressa a mesma intenção sem contornar o tipo.
  const existente = await prisma.omieVinculoCentroCusto.findFirst({
    where: {
      companyId: session.companyId,
      tipoOrigem,
      valorOrigem,
      clienteId: dados.clienteId,
      vehicleId: dados.vehicleId,
      driverId: dados.driverId,
    },
    select: { id: true },
  });

  if (existente) {
    await prisma.omieVinculoCentroCusto.update({
      where: { id: existente.id },
      data: {
        rotuloOrigem,
        percentual: percentualBruto,
        sugerido: false,
        confirmadoPorUserId: session.userId,
        confirmadoEm: new Date(),
      },
    });
  } else {
    await prisma.omieVinculoCentroCusto.create({
      data: {
        companyId: session.companyId,
        tipoOrigem,
        valorOrigem,
        rotuloOrigem,
        ...dados,
        percentual: percentualBruto,
        sugerido: false,
        confirmadoPorUserId: session.userId,
        confirmadoEm: new Date(),
      },
    });
  }

  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "VINCULO_CENTRO_CUSTO",
    entidadeTipo: "OmieVinculoCentroCusto",
    entidadeId: `${tipoOrigem}:${valorOrigem}`,
    descricao: `Vínculo ${tipoOrigem} ${valorOrigem} → ${tipoDestino} (${percentualBruto}%).`,
    depois: { tipoOrigem, valorOrigem, ...dados, percentual: percentualBruto },
  });

  revalidatePath("/rentabilidade");
  return { ok: true };
}

// Devolve void: é usada diretamente como `action` de um <form>, e o React
// exige essa assinatura ali. Um vínculo inexistente simplesmente não faz nada
// — não há o que explicar ao usuário sobre um botão de uma linha que sumiu.
export async function removerVinculo(formData: FormData): Promise<void> {
  const session = await exigirPermissao("gerir-rentabilidade");
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const vinculo = await prisma.omieVinculoCentroCusto.findFirst({
    where: { id, companyId: session.companyId },
  });
  if (!vinculo) return;

  await prisma.omieVinculoCentroCusto.delete({ where: { id } });

  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "VINCULO_CENTRO_CUSTO_REMOVIDO",
    entidadeTipo: "OmieVinculoCentroCusto",
    entidadeId: vinculo.id,
    descricao: `Vínculo ${vinculo.tipoOrigem} ${vinculo.valorOrigem} removido.`,
    antes: { tipoOrigem: vinculo.tipoOrigem, valorOrigem: vinculo.valorOrigem, percentual: vinculo.percentual },
  });

  revalidatePath("/rentabilidade");
}
