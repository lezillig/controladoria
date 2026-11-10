import { prisma } from "@/lib/prisma";
import { buscarEmpresa } from "@/lib/gestao/leitura";
import { enviarLote, isLoteDisponivel, type DesfechoDoLote } from "@/lib/ia/lote";
import { MODELO_ESPECIALISTA } from "@/lib/controladoria/especialistas";
import { interpretarLeitura, montarPedidoDeLeitura, type ApontamentoExtraido } from "./analise";
import { areaValida, criarApontamentos, resolverChave } from "./apontamentos";
import { conciliarConformidade } from "./conciliacao";

// CONFERÊNCIA DA LEITURA — o mesmo documento lido de novo, pelo modelo maior,
// e as duas listas comparadas.
//
// A leitura do dia a dia roda num modelo barato porque a tarefa é transcrever.
// O risco conhecido dessa escolha está escrito em analise.ts: apontamento que
// só existe em página de imagem (carimbo, print, tabela escaneada) e que o
// modelo menor não enxerga. A conferência é a forma de saber se isso
// aconteceu SEM reler o relatório inteiro à mão:
//
//   - o que as duas leituras acharam fica CONFIRMADO;
//   - o que só a primeira achou fica NAO_CONFIRMADO — não é apagado: pode ser
//     apontamento legítimo que a segunda agrupou de outro jeito, e quem decide
//     é quem valida;
//   - o que só a segunda achou entra como proposta nova, marcada
//     SO_NA_SEGUNDA, para uma pessoa validar como qualquer outra.
//
// Vai em LOTE (metade do preço): ninguém espera na tela, o resultado aparece
// no documento quando o ciclo recolhe — em geral em menos de uma hora.
//
// "O mesmo assunto" é decidido pela chave de recorrência, a mesma que
// reconhece o apontamento de um mês no mês seguinte (tipos.ts): duas leituras
// escrevem o título de formas diferentes, e comparar título daria tudo como
// divergente.

export const MODELO_DA_CONFERENCIA = MODELO_ESPECIALISTA;

export type ComparacaoDeLeituras = {
  // Ids dos apontamentos existentes que a segunda leitura também achou.
  confirmados: string[];
  // Ids dos que só a primeira leitura achou.
  naoConfirmados: string[];
  // Os da segunda leitura que não existiam.
  novos: ApontamentoExtraido[];
};

/** Compara as chaves do que já existe com as do que a segunda leitura trouxe. */
export function compararLeituras(
  existentes: { id: string; chaveRecorrencia: string }[],
  segunda: { chave: string; apontamento: ApontamentoExtraido }[],
): ComparacaoDeLeituras {
  const chavesDaSegunda = new Set(segunda.map((s) => s.chave));
  const chavesExistentes = new Set(existentes.map((e) => e.chaveRecorrencia));
  // A segunda leitura pode trazer dois apontamentos que caem na mesma chave;
  // como novo, entra um só (o primeiro), pelo mesmo motivo de criarApontamentos.
  const vistos = new Set<string>();
  const novos: ApontamentoExtraido[] = [];
  for (const s of segunda) {
    if (chavesExistentes.has(s.chave) || vistos.has(s.chave)) continue;
    vistos.add(s.chave);
    novos.push(s.apontamento);
  }
  return {
    confirmados: existentes.filter((e) => chavesDaSegunda.has(e.chaveRecorrencia)).map((e) => e.id),
    naoConfirmados: existentes.filter((e) => !chavesDaSegunda.has(e.chaveRecorrencia)).map((e) => e.id),
    novos,
  };
}

export async function pedirConferencia(params: {
  documentoId: string;
  companyId: string;
  userId: string | null;
  userNome: string | null;
}): Promise<{ ok: true; jaPedida: boolean } | { ok: false; erro: string }> {
  if (!isLoteDisponivel()) return { ok: false, erro: "Leitura automática indisponível (ANTHROPIC_API_KEY não configurada)." };
  const documento = await prisma.conformidadeDocumento.findFirst({ where: { id: params.documentoId, companyId: params.companyId } });
  if (!documento) return { ok: false, erro: "Documento não encontrado." };
  if (documento.extracao !== "EXTRAIDO") return { ok: false, erro: "Este documento ainda não tem uma primeira leitura para conferir." };

  const naFila = await prisma.iaLote.findFirst({
    where: { companyId: params.companyId, tipo: "conformidade_conferencia", referenciaId: documento.id, status: "ENVIADO" },
    select: { id: true },
  });
  if (naFila) return { ok: true, jaPedida: true };

  const empresa = documento.conexaoApelido ?? (await buscarEmpresa(params.companyId))?.name ?? "Empresa";
  const pedido = montarPedidoDeLeitura(
    {
      conteudo: Buffer.from(documento.conteudo),
      arquivoNome: documento.arquivoNome,
      mimeType: documento.mimeType,
      titulo: documento.titulo,
      emissor: documento.emissor,
      competencia: documento.competencia,
      empresa,
    },
    // Esforço alto: aqui o que se quer é justamente o que a leitura rápida
    // pode ter deixado passar.
    { modelo: MODELO_DA_CONFERENCIA, esforco: "high" },
  );
  if (!pedido.ok) return { ok: false, erro: pedido.erro };

  const envio = await enviarLote({
    companyId: params.companyId,
    tipo: "conformidade_conferencia",
    referenciaId: documento.id,
    userId: params.userId,
    userNome: params.userNome,
    params: pedido.corpo,
  });
  return envio.ok ? { ok: true, jaPedida: false } : { ok: false, erro: envio.erro };
}

/** Chamado pela coleta de lotes quando a segunda leitura voltou (ou falhou). */
export async function receberConferencia(lote: { companyId: string; referenciaId: string }, desfecho: DesfechoDoLote): Promise<void> {
  const documento = await prisma.conformidadeDocumento.findFirst({
    where: { id: lote.referenciaId, companyId: lote.companyId },
    select: { id: true, companyId: true, conexaoId: true, conexaoApelido: true, competencia: true },
  });
  // Documento apagado enquanto o lote corria: nada a fazer.
  if (!documento) return;

  const marcar = (resumo: string, modelo: string | null) =>
    prisma.conformidadeDocumento.update({ where: { id: documento.id }, data: { conferidoEm: new Date(), conferenciaModelo: modelo, conferenciaResumo: resumo } });

  if (!desfecho.ok) return void (await marcar(`A conferência não completou: ${desfecho.erro}`, null));
  const resultado = interpretarLeitura(desfecho.message, null);
  if (!resultado.ok) return void (await marcar(`A conferência não completou: ${resultado.erro}`, desfecho.message.model));

  const existentes = await prisma.conformidadeApontamento.findMany({
    where: { companyId: lote.companyId, documentoId: documento.id },
    select: { id: true, chaveRecorrencia: true },
  });
  const segunda: { chave: string; apontamento: ApontamentoExtraido }[] = [];
  for (const a of resultado.leitura.apontamentos) {
    segunda.push({ chave: await resolverChave(lote.companyId, areaValida(a.area), a.assuntoCanonico || a.titulo), apontamento: a });
  }
  const comparacao = compararLeituras(existentes, segunda);

  if (comparacao.confirmados.length > 0) {
    await prisma.conformidadeApontamento.updateMany({ where: { id: { in: comparacao.confirmados } }, data: { conferencia: "CONFIRMADO" } });
  }
  if (comparacao.naoConfirmados.length > 0) {
    await prisma.conformidadeApontamento.updateMany({ where: { id: { in: comparacao.naoConfirmados } }, data: { conferencia: "NAO_CONFIRMADO" } });
  }
  const criados = await criarApontamentos(lote.companyId, documento, comparacao.novos, { conferencia: "SO_NA_SEGUNDA" });

  await marcar(
    `${comparacao.confirmados.length} confirmado(s) pelas duas leituras, ${comparacao.naoConfirmados.length} só na primeira, ${criados.apontamentosCriados} só na segunda (entraram como proposta).`,
    desfecho.message.model,
  );
  if (criados.apontamentosCriados > 0) await conciliarConformidade(lote.companyId);
}
