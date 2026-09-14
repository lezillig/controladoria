"use server";

import { revalidatePath } from "next/cache";
import type { AuditCategoria, AuditSeveridade, AuditStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "../_dados";
import { registrarEvento } from "@/lib/controladoria/trilha";

// Tratativa de achado — a única ação humana do módulo que muda o estado de um
// alerta. Por isso ela, e não a leitura, é o que exige a permissão mais
// restrita (ver canManageControladoria) e o que sempre grava trilha.

const STATUS_PERMITIDOS: AuditStatus[] = ["ABERTO", "EM_ANALISE", "RESOLVIDO", "IGNORADO"];

export type ResultadoTratativa = { erro?: string; ok?: boolean };

export async function tratarAchado(formData: FormData): Promise<ResultadoTratativa> {
  // ADMIN e CONTROLADORIA tratam; GESTOR lê mas não desliga alerta —
  // separar "ver" de "poder encerrar" é o mínimo de segregação de função num
  // módulo cujo produto é apontar o erro de alguém.
  const session = await exigirPermissao("tratar-achado");

  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "") as AuditStatus;
  const observacao = String(formData.get("observacao") ?? "").trim();
  const responsavel = String(formData.get("responsavel") ?? "").trim().slice(0, 120);
  const prazo = lerPrazo(formData.get("prazo"));

  if (!id) return { erro: "Achado não informado." };
  if (!STATUS_PERMITIDOS.includes(status)) return { erro: "Situação inválida." };
  if (prazo === "invalido") return { erro: "Prazo inválido (use o seletor de data)." };

  // IGNORADO sem justificativa é como o controle interno morre: em três meses
  // ninguém lembra por que aquele alerta foi desligado, e a lista inteira
  // perde credibilidade. RESOLVIDO também exige, pelo mesmo motivo — é a
  // única evidência de que houve tratativa de verdade.
  if ((status === "IGNORADO" || status === "RESOLVIDO") && observacao.length < 10) {
    return { erro: "Descreva em poucas palavras o que foi verificado ou por que o achado não se aplica (mínimo 10 caracteres)." };
  }

  const achado = await prisma.auditFinding.findFirst({
    where: { id, companyId: session.companyId },
  });
  if (!achado) return { erro: "Achado não encontrado." };

  const atualizado = await prisma.auditFinding.update({
    where: { id: achado.id },
    data: {
      status,
      observacaoTratativa: observacao || null,
      tratadoPorUserId: session.userId,
      resolvidoEm: status === "RESOLVIDO" || status === "IGNORADO" ? new Date() : null,
      responsavel: responsavel || null,
      prazo,
    },
  });

  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "ACHADO_TRATADO",
    entidadeTipo: "AuditFinding",
    entidadeId: achado.id,
    descricao: `Achado "${achado.titulo}" passou de ${achado.status} para ${status}.`,
    antes: { status: achado.status, observacao: achado.observacaoTratativa, responsavel: achado.responsavel, prazo: achado.prazo },
    depois: { status: atualizado.status, observacao: atualizado.observacaoTratativa, responsavel: atualizado.responsavel, prazo: atualizado.prazo },
  });

  revalidatePath("/auditoria");
  revalidatePath("/");
  return { ok: true };
}

// Prazo vem do <input type="date"> como AAAA-MM-DD. Meia-noite local do
// servidor, que é como as demais datas do módulo são gravadas.
function lerPrazo(bruto: FormDataEntryValue | null): Date | null | "invalido" {
  const texto = String(bruto ?? "").trim();
  if (!texto) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return "invalido";
  const [a, m, d] = texto.split("-").map(Number);
  const data = new Date(a, m - 1, d);
  return Number.isNaN(data.getTime()) ? "invalido" : data;
}

// TRATATIVA EM LOTE — a mesma decisão para todos os achados de uma regra.
//
// Depois da calibragem sobram grupos que se julgam de uma vez: as 104
// parcelas idênticas de banco e consórcio (informativas), as 53 categorias
// de rotina de motorista, uma regra inteira que a pessoa já conferiu por
// amostra. Julgar um a um é o que faz a triagem parar no terceiro dia.
//
// O que NÃO muda em lote: a exigência de justificativa (a mesma frase vale
// para todos, e fica gravada em cada um) e a trilha (um evento com a
// contagem e os filtros, e não um por achado — o evento diz "quem, quando e
// qual recorte", que é o que uma auditoria da auditoria pergunta).
//
// O recorte exige ao menos a REGRA: encerrar "tudo em aberto" com um clique
// é a única operação que este módulo não deve oferecer.
export async function tratarEmLote(formData: FormData): Promise<ResultadoTratativa & { quantidade?: number }> {
  const session = await exigirPermissao("tratar-achado");

  const regra = String(formData.get("regra") ?? "").trim();
  const categoria = String(formData.get("categoria") ?? "").trim();
  const severidade = String(formData.get("severidade") ?? "").trim();
  const apenasInformativos = formData.get("apenasInformativos") === "on";
  const status = String(formData.get("status") ?? "") as AuditStatus;
  const observacao = String(formData.get("observacao") ?? "").trim();
  const responsavel = String(formData.get("responsavel") ?? "").trim().slice(0, 120);
  const prazo = lerPrazo(formData.get("prazo"));

  if (!regra) return { erro: "Tratativa em lote exige uma regra selecionada." };
  if (!STATUS_PERMITIDOS.includes(status) || status === "ABERTO") return { erro: "Situação inválida para lote." };
  if (prazo === "invalido") return { erro: "Prazo inválido (use o seletor de data)." };
  if ((status === "IGNORADO" || status === "RESOLVIDO") && observacao.length < 10) {
    return { erro: "Descreva em poucas palavras o que foi verificado no lote (mínimo 10 caracteres)." };
  }
  // Filtros de enum validados antes de virar consulta: valor inventado no
  // formulário não pode derrubar a ação nem alargar o recorte.
  if (categoria && !CATEGORIAS.includes(categoria as AuditCategoria)) return { erro: "Categoria inválida." };
  if (severidade && !SEVERIDADES.includes(severidade as AuditSeveridade)) return { erro: "Severidade inválida." };

  const where: Prisma.AuditFindingWhereInput = {
    companyId: session.companyId,
    regra,
    status: { in: ["ABERTO", "EM_ANALISE"] },
    ...(categoria ? { categoria: categoria as AuditCategoria } : {}),
    ...(apenasInformativos ? { severidade: "INFO" } : severidade ? { severidade: severidade as AuditSeveridade } : {}),
  };

  const resultado = await prisma.auditFinding.updateMany({
    where,
    data: {
      status,
      observacaoTratativa: observacao || null,
      tratadoPorUserId: session.userId,
      resolvidoEm: status === "RESOLVIDO" || status === "IGNORADO" ? new Date() : null,
      ...(responsavel ? { responsavel } : {}),
      ...(prazo ? { prazo } : {}),
    },
  });

  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "ACHADOS_TRATADOS_EM_LOTE",
    entidadeTipo: "AuditFinding",
    descricao: `${resultado.count} achado(s) da regra ${regra} passaram para ${status} em lote.`,
    antes: { regra, categoria: categoria || null, severidade: severidade || null, apenasInformativos },
    depois: { status, observacao, responsavel: responsavel || null, prazo, quantidade: resultado.count },
  });

  revalidatePath("/auditoria");
  revalidatePath("/");
  return { ok: true, quantidade: resultado.count };
}

const SEVERIDADES: AuditSeveridade[] = ["CRITICA", "ALTA", "MEDIA", "BAIXA", "INFO"];
const CATEGORIAS: AuditCategoria[] = ["FRAUDE", "ERRO_PROCESSO", "PERDA_FINANCEIRA", "RISCO_FINANCEIRO", "CONFORMIDADE", "OPORTUNIDADE"];

// A trilha (registrarEvento) mora em src/lib/controladoria/trilha.ts: este
// arquivo é "use server", e tudo que ele exporta vira uma ação chamável pelo
// cliente — uma função que grava trilha para qualquer empresa sem sessão não
// pode ser uma delas.
