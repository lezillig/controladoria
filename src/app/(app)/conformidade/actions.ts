"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { AuditSeveridade, ConformidadeArea, ConformidadeOrigem, ConformidadeStatus } from "@prisma/client";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buscarEmpresa } from "@/lib/gestao/leitura";
import { lerDocumento, type ApontamentoExtraido } from "@/lib/conformidade/analise";
import { conciliarConformidade } from "@/lib/conformidade/conciliacao";
import { chaveRecorrencia, competenciaDeTexto, escolherChaveRecorrencia, rotuloCompetencia } from "@/lib/conformidade/tipos";
import { parseLocalDate } from "@/lib/date";
import { registrarEvento } from "../auditoria/actions";

// Ações da tela de Conformidade.
//
// Duas regras atravessam todas elas:
//
//   1. O ARQUIVO É A EVIDÊNCIA. Ele é guardado antes de qualquer tentativa de
//      leitura automática, e uma falha de leitura nunca desfaz o upload. Vale
//      para o relatório da consultoria o mesmo que vale para o relatório diário
//      (ver relatorio.ts): o documento é o produto, o processamento é o canal.
//
//   2. MÁQUINA PROPÕE, PESSOA CONFIRMA. Tudo que sai da leitura automática
//      nasce como proposta não validada e é assim que aparece na tela. Só o que
//      uma pessoa conferiu conta como apontamento da empresa.

// 8 MB. O limite de corpo de Server Action está em 10 MB (next.config.ts); a
// folga cobre o restante do formulário e o overhead do multipart. Relatório de
// consultoria raramente passa de 3 MB — o que estoura isso costuma ser PDF com
// digitalização em alta resolução, e aí a saída é reexportar, não aumentar o
// teto e arriscar o erro genérico de plataforma no meio do upload.
const LIMITE_ARQUIVO_BYTES = 8 * 1024 * 1024;

const AREAS_VALIDAS: ConformidadeArea[] = [
  "FISCAL", "TRABALHISTA", "PREVIDENCIARIO", "CONTABIL", "FINANCEIRO",
  "SOCIETARIO", "REGULATORIO", "CONTRATUAL", "LGPD", "OUTRO",
];
const ORIGENS_VALIDAS: ConformidadeOrigem[] = [
  "CONSULTORIA", "CONTABILIDADE", "AUDITORIA_EXTERNA", "FISCALIZACAO", "JURIDICO", "INTERNO",
];
const STATUS_VALIDOS: ConformidadeStatus[] = [
  "ABERTO", "EM_TRATATIVA", "RESOLVIDO", "ACEITO_COM_RISCO", "NAO_SE_APLICA",
];
const SEVERIDADES_VALIDAS: AuditSeveridade[] = ["CRITICA", "ALTA", "MEDIA", "BAIXA", "INFO"];

export type ResultadoDocumento = {
  erro?: string;
  ok?: boolean;
  documentoId?: string;
  apontamentosCriados?: number;
  apontamentosIgnorados?: number;
  avisoLeitura?: string;
};

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export async function enviarDocumento(formData: FormData): Promise<ResultadoDocumento> {
  const session = await requireRole("ADMIN", "CONTROLADORIA");

  const arquivo = formData.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return { erro: "Selecione o arquivo recebido da consultoria." };
  }
  if (arquivo.size > LIMITE_ARQUIVO_BYTES) {
    return {
      erro: `Arquivo de ${(arquivo.size / 1024 / 1024).toFixed(1)} MB — o limite é 8 MB. Reexporte o PDF em resolução menor ou divida o documento.`,
    };
  }

  const competencia = competenciaDeTexto(String(formData.get("competencia") ?? ""));
  if (!competencia) return { erro: "Informe a competência (mês a que o documento se refere)." };

  const titulo = String(formData.get("titulo") ?? "").trim() || arquivo.name;
  const emissor = String(formData.get("emissor") ?? "").trim() || null;
  const origemBruta = String(formData.get("origem") ?? "CONSULTORIA") as ConformidadeOrigem;
  const origem = ORIGENS_VALIDAS.includes(origemBruta) ? origemBruta : "CONSULTORIA";

  const dataDocumentoTexto = String(formData.get("dataDocumento") ?? "").trim();
  const dataDocumento = dataDocumentoTexto ? parseLocalDate(dataDocumentoTexto) : null;

  const conexao = await resolverConexao(session.companyId, formData.get("conexaoId"));

  const conteudo = Buffer.from(await arquivo.arrayBuffer());
  const sha256 = createHash("sha256").update(conteudo).digest("hex");

  // O mesmo arquivo enviado duas vezes duplicaria todos os apontamentos dele —
  // e a duplicata inflaria a contagem de reincidência, que é justamente o
  // número que este módulo existe para dar certo.
  const jaExiste = await prisma.conformidadeDocumento.findFirst({
    where: { companyId: session.companyId, sha256 },
    select: { id: true, titulo: true, competencia: true },
  });
  if (jaExiste) {
    return {
      erro: `Este arquivo já foi enviado: "${jaExiste.titulo}" (${rotuloCompetencia(jaExiste.competencia)}). Nada foi duplicado.`,
    };
  }

  const documento = await prisma.conformidadeDocumento.create({
    data: {
      companyId: session.companyId,
      conexaoId: conexao?.id ?? null,
      conexaoApelido: conexao?.apelido ?? null,
      titulo,
      origem,
      emissor,
      competencia,
      dataDocumento,
      arquivoNome: arquivo.name,
      mimeType: arquivo.type || "application/octet-stream",
      tamanhoBytes: conteudo.byteLength,
      sha256,
      conteudo,
      enviadoPorUserId: session.userId,
      enviadoPorNome: session.name,
    },
    select: { id: true },
  });

  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "CONFORMIDADE_DOCUMENTO_ENVIADO",
    entidadeTipo: "ConformidadeDocumento",
    entidadeId: documento.id,
    descricao: `Documento "${titulo}" (${rotuloCompetencia(competencia)}) recebido de ${emissor ?? origem}.`,
    depois: { arquivo: arquivo.name, sha256, tamanhoBytes: conteudo.byteLength },
  });

  const leitura = await processarDocumento(session.companyId, documento.id);
  revalidarConformidade();

  return { ok: true, documentoId: documento.id, ...leitura };
}

export async function reprocessarDocumento(formData: FormData): Promise<ResultadoDocumento> {
  const session = await requireRole("ADMIN", "CONTROLADORIA");
  const id = String(formData.get("id") ?? "");

  const documento = await prisma.conformidadeDocumento.findFirst({
    where: { id, companyId: session.companyId },
    select: { id: true, titulo: true },
  });
  if (!documento) return { erro: "Documento não encontrado." };

  // Propostas não conferidas da execução anterior são descartadas: reprocessar
  // sem limpar deixaria duas leituras do mesmo documento convivendo na tela, e
  // ninguém saberia qual está valendo. O que uma pessoa já validou fica.
  const removidos = await prisma.conformidadeApontamento.deleteMany({
    where: { companyId: session.companyId, documentoId: documento.id, propostoPorIa: true, validado: false },
  });

  const resultado = await processarDocumento(session.companyId, documento.id);

  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "CONFORMIDADE_DOCUMENTO_REPROCESSADO",
    entidadeTipo: "ConformidadeDocumento",
    entidadeId: documento.id,
    descricao: `Leitura automática do documento "${documento.titulo}" refeita; ${removidos.count} proposta(s) anterior(es) descartada(s).`,
  });

  revalidarConformidade();
  return { ok: true, documentoId: documento.id, ...resultado };
}

// Leitura automática de um documento já gravado. Separada do upload porque é
// exatamente a parte que pode falhar por motivo externo (IA indisponível, PDF
// grande demais, formato inesperado) — e que precisa poder ser repetida sem
// pedir o arquivo de novo.
async function processarDocumento(
  companyId: string,
  documentoId: string
): Promise<{ apontamentosCriados?: number; apontamentosIgnorados?: number; avisoLeitura?: string }> {
  const documento = await prisma.conformidadeDocumento.findFirst({
    where: { id: documentoId, companyId },
  });
  if (!documento) return { avisoLeitura: "Documento não encontrado para leitura." };

  const empresa = documento.conexaoApelido ?? (await buscarEmpresa(companyId))?.name ?? "Empresa";

  const resultado = await lerDocumento({
    conteudo: Buffer.from(documento.conteudo),
    arquivoNome: documento.arquivoNome,
    mimeType: documento.mimeType,
    titulo: documento.titulo,
    emissor: documento.emissor,
    competencia: documento.competencia,
    empresa,
  });

  if (!resultado.ok) {
    await prisma.conformidadeDocumento.update({
      where: { id: documento.id },
      data: {
        // MANUAL, e não ERRO, quando a leitura automática simplesmente não está
        // habilitada: a diferença importa na tela, porque uma é uma escolha de
        // configuração e a outra é um problema para investigar.
        extracao: resultado.erro.includes("ANTHROPIC_API_KEY") ? "MANUAL" : "ERRO",
        extracaoErro: resultado.erro,
        textoExtraido: resultado.textoExtraido,
        extraidoEm: new Date(),
      },
    });
    return { avisoLeitura: resultado.erro };
  }

  const criados = await criarApontamentos(companyId, documento, resultado.leitura.apontamentos);

  await prisma.conformidadeDocumento.update({
    where: { id: documento.id },
    data: {
      extracao: "EXTRAIDO",
      extracaoErro: null,
      extraidoEm: new Date(),
      textoExtraido: resultado.textoExtraido,
      resumo: resultado.leitura.resumo,
    },
  });

  await conciliarConformidade(companyId);
  return criados;
}

type DocumentoBase = {
  id: string;
  companyId: string;
  conexaoId: string | null;
  conexaoApelido: string | null;
  competencia: Date;
};

async function criarApontamentos(
  companyId: string,
  documento: DocumentoBase,
  extraidos: ApontamentoExtraido[]
): Promise<{ apontamentosCriados: number; apontamentosIgnorados: number }> {
  let criados = 0;
  let ignorados = 0;

  for (const item of extraidos) {
    const area = AREAS_VALIDAS.includes(item.area as ConformidadeArea) ? (item.area as ConformidadeArea) : "OUTRO";
    const severidade = SEVERIDADES_VALIDAS.includes(item.severidade as AuditSeveridade)
      ? (item.severidade as AuditSeveridade)
      : "MEDIA";
    const chave = await resolverChave(companyId, area, item.assuntoCanonico || item.titulo);

    const duplicado = await prisma.conformidadeApontamento.findFirst({
      where: { companyId, chaveRecorrencia: chave, competencia: documento.competencia },
      select: { id: true },
    });
    if (duplicado) {
      ignorados++;
      continue;
    }

    await inserirApontamento({
      companyId,
      conexaoId: documento.conexaoId,
      conexaoApelido: documento.conexaoApelido,
      documentoId: documento.id,
      competencia: documento.competencia,
      area,
      severidade,
      titulo: item.titulo.slice(0, 300),
      descricao: item.descricao,
      recomendacao: item.recomendacao,
      trechoOrigem: item.trechoOrigem?.slice(0, 1000) ?? null,
      paginaOrigem: item.paginaOrigem?.slice(0, 80) ?? null,
      valorEnvolvidoCents:
        item.valorEnvolvidoReais !== null && Number.isFinite(item.valorEnvolvidoReais)
          ? Math.round(item.valorEnvolvidoReais * 100)
          : null,
      prazo:
        item.prazoSugeridoDias !== null && item.prazoSugeridoDias > 0
          ? new Date(Date.now() + item.prazoSugeridoDias * 86_400_000)
          : null,
      chaveRecorrencia: chave,
      propostoPorIa: true,
    });
    criados++;
  }

  return { apontamentosCriados: criados, apontamentosIgnorados: ignorados };
}

// Insere o apontamento já com a contagem de recorrência acertada — e acerta a
// dos irmãos dele. A contagem fica materializada em cada linha (em vez de ser
// calculada na leitura) porque o agente de conformidade é uma função pura sobre
// o contexto e o relatório precisa do número pronto; recalcular por agrupamento
// em toda tela e em todo e-mail seria o mesmo trabalho feito cinco vezes.
async function inserirApontamento(dados: {
  companyId: string;
  conexaoId: string | null;
  conexaoApelido: string | null;
  documentoId: string | null;
  competencia: Date;
  area: ConformidadeArea;
  severidade: AuditSeveridade;
  titulo: string;
  descricao: string;
  recomendacao: string | null;
  trechoOrigem: string | null;
  paginaOrigem: string | null;
  valorEnvolvidoCents: number | null;
  prazo: Date | null;
  responsavel?: string | null;
  chaveRecorrencia: string;
  propostoPorIa: boolean;
  validadoPorUserId?: string | null;
}): Promise<string> {
  const irmaos = await prisma.conformidadeApontamento.findMany({
    where: { companyId: dados.companyId, chaveRecorrencia: dados.chaveRecorrencia },
    select: { id: true, competencia: true },
  });

  const competencias = new Set([...irmaos.map((i) => i.competencia.getTime()), dados.competencia.getTime()]);
  const ocorrencias = competencias.size;
  const primeira = new Date(Math.min(...competencias));

  const criado = await prisma.conformidadeApontamento.create({
    data: {
      ...dados,
      propostoPorIa: dados.propostoPorIa,
      validado: !dados.propostoPorIa,
      validadoPorUserId: dados.validadoPorUserId ?? null,
      validadoEm: dados.propostoPorIa ? null : new Date(),
      primeiraCompetencia: primeira,
      ocorrencias,
    },
    select: { id: true },
  });

  if (irmaos.length > 0) {
    await prisma.conformidadeApontamento.updateMany({
      where: { id: { in: irmaos.map((i) => i.id) } },
      data: { ocorrencias, primeiraCompetencia: primeira },
    });
  }

  return criado.id;
}

export async function excluirDocumento(formData: FormData): Promise<void> {
  const session = await requireRole("ADMIN", "CONTROLADORIA");
  const id = String(formData.get("id") ?? "");

  const documento = await prisma.conformidadeDocumento.findFirst({
    where: { id, companyId: session.companyId },
    select: { id: true, titulo: true, competencia: true, sha256: true },
  });
  if (!documento) return;

  // Propostas não conferidas somem junto; apontamentos validados por uma pessoa
  // sobrevivem e ficam sem documento de origem (SetNull no schema). É a escolha
  // certa: o trabalho de análise humana vale mais que o vínculo com o anexo, e
  // apagá-lo por tabela seria destruir tratativa registrada.
  await prisma.conformidadeApontamento.deleteMany({
    where: { companyId: session.companyId, documentoId: documento.id, propostoPorIa: true, validado: false },
  });
  await prisma.conformidadeDocumento.delete({ where: { id: documento.id } });

  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "CONFORMIDADE_DOCUMENTO_EXCLUIDO",
    entidadeTipo: "ConformidadeDocumento",
    entidadeId: documento.id,
    descricao: `Documento "${documento.titulo}" (${rotuloCompetencia(documento.competencia)}) excluído.`,
    antes: { sha256: documento.sha256 },
  });

  revalidarConformidade();
}

// ---------------------------------------------------------------------------
// Apontamentos
// ---------------------------------------------------------------------------

export type ResultadoApontamento = { erro?: string; ok?: boolean };

export async function registrarApontamento(formData: FormData): Promise<ResultadoApontamento> {
  const session = await requireRole("ADMIN", "CONTROLADORIA");

  const titulo = String(formData.get("titulo") ?? "").trim();
  const descricao = String(formData.get("descricao") ?? "").trim();
  if (titulo.length < 5) return { erro: "Descreva o apontamento em um título de pelo menos 5 caracteres." };
  if (descricao.length < 10) return { erro: "Escreva o que o documento aponta (mínimo 10 caracteres)." };

  const competencia = competenciaDeTexto(String(formData.get("competencia") ?? ""));
  if (!competencia) return { erro: "Informe a competência." };

  const areaBruta = String(formData.get("area") ?? "OUTRO") as ConformidadeArea;
  const area = AREAS_VALIDAS.includes(areaBruta) ? areaBruta : "OUTRO";
  const severidadeBruta = String(formData.get("severidade") ?? "MEDIA") as AuditSeveridade;
  const severidade = SEVERIDADES_VALIDAS.includes(severidadeBruta) ? severidadeBruta : "MEDIA";

  const documentoId = String(formData.get("documentoId") ?? "").trim() || null;
  const documento = documentoId
    ? await prisma.conformidadeDocumento.findFirst({
        where: { id: documentoId, companyId: session.companyId },
        select: { id: true, conexaoId: true, conexaoApelido: true },
      })
    : null;

  // Apontamento ligado a um documento herda a empresa dele: dizer que o ponto é
  // da MCZ quando o relatório é da Azul seria uma contradição que ninguém
  // consegue explicar depois.
  const conexaoAvulsa = documento ? null : await resolverConexao(session.companyId, formData.get("conexaoId"));
  const conexao = documento
    ? { id: documento.conexaoId, apelido: documento.conexaoApelido }
    : { id: conexaoAvulsa?.id ?? null, apelido: conexaoAvulsa?.apelido ?? null };

  const prazoTexto = String(formData.get("prazo") ?? "").trim();
  const valorTexto = String(formData.get("valor") ?? "").trim();

  const id = await inserirApontamento({
    companyId: session.companyId,
    conexaoId: conexao.id,
    conexaoApelido: conexao.apelido,
    documentoId: documento?.id ?? null,
    competencia,
    area,
    severidade,
    titulo: titulo.slice(0, 300),
    descricao,
    recomendacao: String(formData.get("recomendacao") ?? "").trim() || null,
    trechoOrigem: String(formData.get("trechoOrigem") ?? "").trim() || null,
    paginaOrigem: String(formData.get("paginaOrigem") ?? "").trim() || null,
    valorEnvolvidoCents: valorTexto ? centavosDeTexto(valorTexto) : null,
    prazo: prazoTexto ? parseLocalDate(prazoTexto) : null,
    responsavel: String(formData.get("responsavel") ?? "").trim() || null,
    chaveRecorrencia: await resolverChave(session.companyId, area, String(formData.get("assunto") ?? "").trim() || titulo),
    // Cadastro manual já nasce validado: quem digitou é a pessoa que confere.
    propostoPorIa: false,
    validadoPorUserId: session.userId,
  });

  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "CONFORMIDADE_APONTAMENTO_CRIADO",
    entidadeTipo: "ConformidadeApontamento",
    entidadeId: id,
    descricao: `Apontamento "${titulo}" cadastrado manualmente (${rotuloCompetencia(competencia)}).`,
    depois: { area, severidade },
  });

  await conciliarConformidade(session.companyId);
  revalidarConformidade();
  return { ok: true };
}

export async function tratarApontamento(formData: FormData): Promise<ResultadoApontamento> {
  const session = await requireRole("ADMIN", "CONTROLADORIA");

  const id = String(formData.get("id") ?? "");
  const statusBruto = String(formData.get("status") ?? "") as ConformidadeStatus;
  if (!STATUS_VALIDOS.includes(statusBruto)) return { erro: "Situação inválida." };

  const observacao = String(formData.get("observacao") ?? "").trim();
  // Mesma regra da tratativa de achado: encerrar sem justificativa é como o
  // controle interno morre — em três meses ninguém lembra por que aquele risco
  // saiu da lista. "Aceito com risco" exige ainda mais, porque é a única
  // situação em que a empresa decide conviver com ele.
  if (["RESOLVIDO", "NAO_SE_APLICA", "ACEITO_COM_RISCO"].includes(statusBruto) && observacao.length < 10) {
    return { erro: "Descreva o que foi feito, ou por que o apontamento não se aplica (mínimo 10 caracteres)." };
  }

  const atual = await prisma.conformidadeApontamento.findFirst({
    where: { id, companyId: session.companyId },
  });
  if (!atual) return { erro: "Apontamento não encontrado." };

  const prazoTexto = String(formData.get("prazo") ?? "").trim();
  const encerrado = ["RESOLVIDO", "NAO_SE_APLICA", "ACEITO_COM_RISCO"].includes(statusBruto);

  const atualizado = await prisma.conformidadeApontamento.update({
    where: { id: atual.id },
    data: {
      status: statusBruto,
      responsavel: String(formData.get("responsavel") ?? "").trim() || null,
      prazo: prazoTexto ? parseLocalDate(prazoTexto) : null,
      observacaoTratativa: observacao || null,
      tratadoPorUserId: session.userId,
      resolvidoEm: encerrado ? new Date() : null,
      // Tratar é conferir: quem assume o apontamento está confirmando que ele
      // procede, então a proposta deixa de estar pendente de validação.
      validado: true,
      validadoPorUserId: atual.validado ? atual.validadoPorUserId : session.userId,
      validadoEm: atual.validado ? atual.validadoEm : new Date(),
    },
  });

  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "CONFORMIDADE_APONTAMENTO_TRATADO",
    entidadeTipo: "ConformidadeApontamento",
    entidadeId: atual.id,
    descricao: `Apontamento "${atual.titulo}" passou de ${atual.status} para ${statusBruto}.`,
    antes: { status: atual.status, responsavel: atual.responsavel, prazo: atual.prazo, observacao: atual.observacaoTratativa },
    depois: { status: atualizado.status, responsavel: atualizado.responsavel, prazo: atualizado.prazo, observacao: atualizado.observacaoTratativa },
  });

  revalidarConformidade();
  return { ok: true };
}

export async function validarApontamento(formData: FormData): Promise<void> {
  const session = await requireRole("ADMIN", "CONTROLADORIA");
  const id = String(formData.get("id") ?? "");

  const atual = await prisma.conformidadeApontamento.findFirst({
    where: { id, companyId: session.companyId, validado: false },
    select: { id: true, titulo: true },
  });
  if (!atual) return;

  await prisma.conformidadeApontamento.update({
    where: { id: atual.id },
    data: { validado: true, validadoPorUserId: session.userId, validadoEm: new Date() },
  });

  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "CONFORMIDADE_APONTAMENTO_VALIDADO",
    entidadeTipo: "ConformidadeApontamento",
    entidadeId: atual.id,
    descricao: `Proposta de leitura automática "${atual.titulo}" conferida e validada.`,
  });

  revalidarConformidade();
}

export async function descartarApontamento(formData: FormData): Promise<void> {
  const session = await requireRole("ADMIN", "CONTROLADORIA");
  const id = String(formData.get("id") ?? "");

  // Só proposta não validada pode ser descartada. Apontamento que uma pessoa já
  // assumiu se encerra por tratativa ("não se aplica", com justificativa), nunca
  // por exclusão — a diferença é o que sobra no histórico.
  const atual = await prisma.conformidadeApontamento.findFirst({
    where: { id, companyId: session.companyId, propostoPorIa: true, validado: false },
    select: { id: true, titulo: true },
  });
  if (!atual) return;

  await prisma.conformidadeApontamento.delete({ where: { id: atual.id } });

  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "CONFORMIDADE_APONTAMENTO_DESCARTADO",
    entidadeTipo: "ConformidadeApontamento",
    entidadeId: atual.id,
    descricao: `Proposta de leitura automática "${atual.titulo}" descartada sem virar apontamento.`,
  });

  revalidarConformidade();
}

// ---------------------------------------------------------------------------
// Vínculos com os achados
// ---------------------------------------------------------------------------

export async function confirmarVinculo(formData: FormData): Promise<void> {
  const session = await requireRole("ADMIN", "CONTROLADORIA");
  const id = String(formData.get("id") ?? "");

  const vinculo = await prisma.conformidadeVinculo.findFirst({
    where: { id, companyId: session.companyId },
    select: { id: true, achadoChave: true, apontamentoId: true },
  });
  if (!vinculo) return;

  await prisma.conformidadeVinculo.update({
    where: { id: vinculo.id },
    data: { automatico: false, confirmadoPorUserId: session.userId, confirmadoEm: new Date() },
  });

  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "CONFORMIDADE_VINCULO_CONFIRMADO",
    entidadeTipo: "ConformidadeApontamento",
    entidadeId: vinculo.apontamentoId,
    descricao: `Confirmado que o achado ${vinculo.achadoChave} trata do mesmo fato deste apontamento.`,
  });

  revalidarConformidade();
}

export async function removerVinculo(formData: FormData): Promise<void> {
  const session = await requireRole("ADMIN", "CONTROLADORIA");
  const id = String(formData.get("id") ?? "");

  const vinculo = await prisma.conformidadeVinculo.findFirst({
    where: { id, companyId: session.companyId },
    select: { id: true, achadoChave: true, apontamentoId: true },
  });
  if (!vinculo) return;

  await prisma.conformidadeVinculo.delete({ where: { id: vinculo.id } });

  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "CONFORMIDADE_VINCULO_REMOVIDO",
    entidadeTipo: "ConformidadeApontamento",
    entidadeId: vinculo.apontamentoId,
    descricao: `Sugestão de ligação com o achado ${vinculo.achadoChave} recusada.`,
  });

  revalidarConformidade();
}

// ---------------------------------------------------------------------------
// Apoio
// ---------------------------------------------------------------------------

// Chave de recorrência do assunto, já reaproveitando a de um ponto equivalente
// que a empresa recebeu antes. É o passo que faz "juros por atraso a
// fornecedores" de agosto reconhecer o "atraso a fornecedores gerando juros" de
// julho como o MESMO problema — sem isso, cada reescrita da consultoria zeraria
// a contagem de reincidência, que é o número mais valioso deste módulo.
async function resolverChave(companyId: string, area: ConformidadeArea, assunto: string): Promise<string> {
  const candidata = chaveRecorrencia(area, assunto);
  const existentes = await prisma.conformidadeApontamento.findMany({
    where: { companyId, area },
    select: { chaveRecorrencia: true },
    distinct: ["chaveRecorrencia"],
  });
  return escolherChaveRecorrencia(candidata, existentes.map((e) => e.chaveRecorrencia));
}

async function resolverConexao(companyId: string, valor: FormDataEntryValue | null) {
  const id = String(valor ?? "").trim();
  if (!id) return null;
  return prisma.omieConexao.findFirst({ where: { id, companyId }, select: { id: true, apelido: true } });
}

// Aceita "12.345,67", "12345.67" e "12345". Escrito à mão porque o campo é
// digitado por pessoa: um parseFloat direto leria "12.345,67" como 12,345.
function centavosDeTexto(texto: string): number | null {
  const limpo = texto.replace(/[^\d,.-]/g, "");
  if (!limpo) return null;
  const normalizado = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const numero = Number(normalizado);
  return Number.isFinite(numero) ? Math.round(numero * 100) : null;
}

function revalidarConformidade(): void {
  revalidatePath("/conformidade");
  // O painel e a lista de achados mostram números de conformidade; sem
  // revalidá-los, a tela de origem atualiza e as outras seguem mostrando o
  // estado anterior — o tipo de divergência que faz o usuário duvidar do
  // sistema inteiro.
  revalidatePath("/");
  revalidatePath("/auditoria");
}
