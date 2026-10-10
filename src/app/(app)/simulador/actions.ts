"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { registrarEvento } from "@/lib/controladoria/trilha";
import { lerGabarito } from "@/lib/simulador/gabarito";
import { gravarLeitura } from "@/lib/simulador/baseDeCustos";
import {
  atualizarEstudo as atualizarEstudoNoBanco,
  criarEstudo as criarEstudoNoBanco,
  gravarRealizado,
  registrarLance as registrarLanceNoBanco,
  registrarResultado as registrarResultadoNoBanco,
  salvarVersao as salvarVersaoNoBanco,
  STATUS_ESTUDO,
  STATUS_VERSAO,
  TIPOS_ESTUDO,
  TIPOS_SERVICO,
  type DadosEstudo,
  type ItemNovo,
} from "@/lib/simulador/estudos";
import type { MapaOrigem } from "@/lib/simulador/premissas";
import { lerDataHoraDeBrasilia, lerInteiro, lerNumero } from "@/lib/simulador/numeros";
import { lerHabilitacaoDoEdital, lerItensNovos, lerPremissasDoEdital, lerRegrasDoEdital } from "@/lib/simulador/formularioDoEstudo";
import { SITUACOES_PARTICIPANTE } from "@/lib/simulador/disputa";
import { catalogoDoEstudo, inventariarPlanilha, mapearPlanilha, preencherPlanilha } from "@/lib/simulador/planilhaDoEdital";
import { carregarEstudo, entradaInicial } from "@/lib/simulador/estudos";
import { simular } from "@/lib/simulador/motor";
import { guardarArquivo, prenderAoEstudo, TIPOS_ARQUIVO, type TipoArquivo } from "@/lib/simulador/arquivosDoEstudo";
import { ajustarParametro, encerrarRegistro, salvarRegistro, TABELAS, voltarAoPadrao, type TipoTabela } from "@/lib/simulador/edicaoBase";
import { ROTULO_UNIDADE, TIPOS_VEICULO, type EntradaSimulacao, type TipoVeiculo, type UnidadePreco } from "@/lib/simulador/tipos";
import { exigirPermissao } from "../_dados";
import { apagarArquivos, arquivosAssinadosValidos, assinarArquivo, enviarArquivo, lerEdital, nomeDoModelo, testarConexao, type ArquivoAssinado } from "@/lib/simulador/importarEdital";
import { editalParaEstudo, GRUPOS_HABILITACAO, SITUACOES_DOCUMENTO, type EstudoImportado } from "@/lib/simulador/editalParaEstudo";

// AÇÕES DO SIMULADOR. Toda gravação exige "gerir-simulador" e deixa rastro na
// trilha; a leitura (tela) exige "simulador". A empresa vem sempre da sessão —
// nenhum formulário escolhe de que empresa grava.

export type Resultado = { erro?: string; ok?: boolean; id?: string; mensagem?: string; versao?: number };

const texto = (f: FormData, k: string, max = 300) => {
  const v = String(f.get(k) ?? "").trim();
  return v === "" ? null : v.slice(0, max);
};
const numero = (f: FormData, k: string) => {
  const v = texto(f, k);
  return v === null ? null : lerNumero(v);
};
const inteiro = (f: FormData, k: string) => {
  const v = texto(f, k);
  return v === null ? null : lerInteiro(v);
};
const UNIDADES: UnidadePreco[] = ["KM", "VEICULO_MES", "DIARIA", "HORA", "BINOMIA"];

// Abrangência do transporte: municipal (ISS), intermunicipal (ICMS) ou misto
// (o % intermunicipal fica por item, na aba Operação).
const ABRANGENCIAS = { MUNICIPAL: 0, INTERMUNICIPAL: 1, MISTO: null } as const;

// OS DADOS DO ESTUDO, lidos do formulário — o mesmo para criar e para editar.
// Número digitado por extenso ("doze") ou fora de faixa não vira padrão
// calado: volta como erro para a pessoa corrigir. Vigência, prazo e aviso são
// colunas Int: fracionário é recusado, e não truncado calado pelo Prisma.
function lerDadosDoEstudo(formData: FormData): { dados: Omit<DadosEstudo, "itens">; shareIntermunicipal: number | null } | { erro: string } {
  const nome = texto(formData, "nome", 120);
  if (!nome) return { erro: "Dê um nome ao estudo." };
  const tipo = texto(formData, "tipo") ?? "LICITACAO";
  const tipoServico = texto(formData, "tipoServico") ?? "FRETAMENTO";
  if (!(TIPOS_ESTUDO as readonly string[]).includes(tipo)) return { erro: "Tipo de estudo inválido." };
  if (!(TIPOS_SERVICO as readonly string[]).includes(tipoServico)) return { erro: "Tipo de serviço inválido." };
  const unidade = (texto(formData, "unidadePreco") ?? "KM") as UnidadePreco;
  if (!UNIDADES.includes(unidade)) return { erro: "Unidade de preço inválida." };
  const abrangencia = texto(formData, "abrangencia") ?? "MUNICIPAL";
  if (!(abrangencia in ABRANGENCIAS)) return { erro: "Abrangência inválida." };
  const dataSessao = texto(formData, "dataSessao");
  const publico = texto(formData, "esfera") === "PUBLICO";
  const validade = texto(formData, "validadeProposta");
  const inicio = texto(formData, "inicioPrevisto");
  const tiposVeiculo = [...new Set(formData.getAll("tiposVeiculo").map(String))].filter((t): t is TipoVeiculo => (TIPOS_VEICULO as string[]).includes(t));
  for (const [campo, rotulo, max, soInteiro] of [["vigenciaMeses", "Vigência", 240, true], ["prazoPagamentoDias", "Prazo de pagamento", 365, true], ["valorTotalMaximo", "Valor total máximo", 1e12, false], ["avisoRescisaoDias", "Aviso para rescisão", 365, true]] as const) {
    const bruto = texto(formData, campo);
    const n = soInteiro ? inteiro(formData, campo) : numero(formData, campo);
    if (bruto !== null && (n === null || n < 0 || n > max)) return { erro: `${rotulo}: informe um número ${soInteiro ? "inteiro " : ""}válido.` };
  }
  return {
    shareIntermunicipal: ABRANGENCIAS[abrangencia as keyof typeof ABRANGENCIAS],
    dados: {
      tipo,
      nome,
      cliente: texto(formData, "cliente", 160),
      tipoServico,
      uf: texto(formData, "uf", 2)?.toUpperCase() ?? null,
      municipio: texto(formData, "municipio", 120),
      descricao: texto(formData, "descricao", 2000),
      criterioJulgamento: texto(formData, "criterio") === "LOTE" ? "LOTE" : "ITEM",
      unidadePreco: unidade,
      vigenciaMeses: numero(formData, "vigenciaMeses"),
      prazoPagamentoDias: numero(formData, "prazoPagamentoDias"),
      orgao: publico ? (texto(formData, "orgao", 200) ?? texto(formData, "cliente", 200)) : null,
      numeroEdital: publico ? texto(formData, "numeroEdital", 80) : null,
      modalidade: publico ? texto(formData, "modalidade", 80) : null,
      plataforma: publico ? texto(formData, "plataforma", 120) : null,
      dataSessao: publico && dataSessao ? new Date(`${dataSessao}T12:00:00`) : null,
      srp: publico && formData.get("srp") === "on",
      valorTotalMaximo: publico ? numero(formData, "valorTotalMaximo") : null,
      tiposVeiculo,
      esfera: publico ? "PUBLICO" : "PRIVADO",
      clienteDocumento: publico ? null : (texto(formData, "clienteDocumento", 20)?.replace(/[^\d./-]/g, "") || null),
      contatoCliente: publico ? null : texto(formData, "contatoCliente", 160),
      validadeProposta: !publico && validade ? new Date(`${validade}T12:00:00`) : null,
      inicioPrevisto: inicio ? new Date(`${inicio}T12:00:00`) : null,
      indiceReajuste: texto(formData, "indiceReajuste", 80),
      formaFaturamento: publico ? null : texto(formData, "formaFaturamento", 40),
      avisoRescisaoDias: publico ? null : numero(formData, "avisoRescisaoDias"),
    },
  };
}

export async function criarEstudo(formData: FormData): Promise<Resultado> {
  const session = await exigirPermissao("gerir-simulador");
  const lido = lerDadosDoEstudo(formData);
  if ("erro" in lido) return { erro: lido.erro };
  const itens = lerItensNovos(texto(formData, "itens", 100_000));
  if (typeof itens === "string") return { erro: itens };
  const regras = lerRegrasDoEdital(texto(formData, "regrasDoEdital", 200_000));
  const habilitacao = lerHabilitacaoDoEdital(texto(formData, "habilitacaoDoEdital", 200_000));
  const id = await criarEstudoNoBanco(session.companyId, { ...lido.dados, itens, shareIntermunicipal: lido.shareIntermunicipal ?? 0 }, session.name);
  // As exigências e suposições do edital importado ficam no estudo, para a
  // conferência antes de lançar preço.
  if (regras.length > 0)
    await prisma.simRegra.createMany({ data: regras.map((r, ordem) => ({ estudoId: id, ordem, tema: r.tema, texto: r.texto, fonte: r.fonte })) });
  // As premissas que o edital fixa: aplicadas quando o estudo abrir.
  const premissasDoEdital = (() => {
    try {
      return lerPremissasDoEdital(JSON.parse(texto(formData, "premissasDoEdital", 5_000) ?? "null"));
    } catch {
      return null;
    }
  })();
  if (premissasDoEdital) await prisma.simEstudo.update({ where: { id }, data: { premissasDoEdital } });
  // Os arquivos do edital enviados na importação passam a ser do estudo.
  const guardados = (() => {
    try {
      const l = JSON.parse(texto(formData, "arquivosGuardados", 20_000) ?? "[]");
      return Array.isArray(l) ? l.map(String) : [];
    } catch {
      return [];
    }
  })();
  if (guardados.length > 0) await prenderAoEstudo(session.companyId, id, guardados);
  // E os documentos de habilitação, para a aba Habilitação.
  if (habilitacao.length > 0)
    await prisma.simDocumentoHabilitacao.createMany({ data: habilitacao.map((d, ordem) => ({ estudoId: id, ordem, ...d, atualizadoPor: session.name })) });
  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "SIMULADOR_ESTUDO_CRIADO",
    entidadeTipo: "SimEstudo",
    entidadeId: id,
    descricao: `Estudo de custo "${lido.dados.nome}" criado.`,
  });
  revalidatePath("/simulador");
  return { ok: true, id };
}

// EDITAR OS DADOS DO ESTUDO depois de criado: identificação, cliente, dados do
// edital ou da proposta, abrangência. Unidade de preço, julgamento, tipos de
// veículo e itens ficam nas abas do estudo, que é onde a versão os guarda.
export async function atualizarEstudo(estudoId: string, formData: FormData): Promise<Resultado> {
  const session = await exigirPermissao("gerir-simulador");
  const lido = lerDadosDoEstudo(formData);
  if ("erro" in lido) return { erro: lido.erro };
  const r = await atualizarEstudoNoBanco(session.companyId, estudoId, lido.dados, lido.shareIntermunicipal);
  if (r.erro) return r;
  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "SIMULADOR_ESTUDO_ALTERADO",
    entidadeTipo: "SimEstudo",
    entidadeId: estudoId,
    descricao: `Dados do estudo "${lido.dados.nome}" alterados.`,
  });
  revalidatePath("/simulador");
  revalidatePath(`/simulador/${estudoId}`);
  return { ok: true, id: estudoId };
}

export async function salvarVersao(estudoId: string, entrada: EntradaSimulacao, origem: MapaOrigem, status: string, observacoes: string | null, baseEm: string | null): Promise<Resultado> {
  const session = await exigirPermissao("gerir-simulador");
  if (!(STATUS_VERSAO as readonly string[]).includes(status)) return { erro: "Status inválido." };
  const r = await salvarVersaoNoBanco(
    session.companyId,
    estudoId,
    { entrada, origem, status, observacoes: observacoes?.slice(0, 1000) ?? null, baseEm: baseEm ? new Date(baseEm) : null },
    session.name
  );
  if (r.erro) return { erro: r.erro };
  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "SIMULADOR_VERSAO_SALVA",
    entidadeTipo: "SimSimulacao",
    entidadeId: r.id,
    descricao: `Versão ${r.versao} do estudo salva como ${status.toLowerCase()}.`,
  });
  revalidatePath(`/simulador/${estudoId}`);
  revalidatePath("/simulador");
  return { ok: true, id: r.id, versao: r.versao, mensagem: `Versão ${r.versao} salva.` };
}

export async function registrarLance(estudoId: string, formData: FormData): Promise<Resultado> {
  const session = await exigirPermissao("gerir-simulador");
  const fase = texto(formData, "fase") ?? "LANCE";
  const preco = numero(formData, "preco");
  if (preco === null || preco <= 0) return { erro: "Informe o preço lançado." };
  const itens = String(formData.get("itens") ?? "").split(",").filter(Boolean);
  const quando = texto(formData, "dataHora");
  // O campo datetime-local chega sem fuso: é hora de Brasília (lerDataHoraDeBrasilia).
  const dataHora = quando ? lerDataHoraDeBrasilia(quando) : new Date();
  if (!dataHora) return { erro: "Data e hora do lance inválidas." };
  const r = await registrarLanceNoBanco(
    session.companyId,
    estudoId,
    {
      fase,
      dataHora,
      precos: (itens.length > 0 ? itens : ["lote"]).map((item) => ({ item, preco })),
      valorTotal: numero(formData, "valorTotal"),
      observacao: texto(formData, "observacao", 500),
      simulacaoId: texto(formData, "simulacaoId"),
    },
    session.name
  );
  if (r.erro) return r;
  revalidatePath(`/simulador/${estudoId}`);
  return { ok: true };
}

export async function registrarResultado(estudoId: string, formData: FormData): Promise<Resultado> {
  const session = await exigirPermissao("gerir-simulador");
  const status = texto(formData, "status") ?? "EM_ESTUDO";
  if (!(STATUS_ESTUDO as readonly string[]).includes(status)) return { erro: "Situação inválida." };
  const data = texto(formData, "data");
  // Posição é Int no banco: "1,5" era gravada como 1 sem aviso.
  const posicao = inteiro(formData, "posicao");
  if (texto(formData, "posicao") !== null && (posicao === null || posicao < 1 || posicao > 10_000)) return { erro: "Posição: informe um número inteiro (1, 2, 3…)." };
  const r = await registrarResultadoNoBanco(session.companyId, estudoId, {
    status,
    posicao,
    vencedor: texto(formData, "vencedor", 200),
    precoKm: numero(formData, "precoVencedor"),
    valorTotal: numero(formData, "valorTotal"),
    data: data ? new Date(`${data}T12:00:00`) : null,
    observacao: texto(formData, "observacao", 1000),
  });
  if (r.erro) return r;
  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "SIMULADOR_RESULTADO",
    entidadeTipo: "SimEstudo",
    entidadeId: estudoId,
    descricao: `Situação do estudo: ${status.toLowerCase()}.`,
  });
  revalidatePath(`/simulador/${estudoId}`);
  revalidatePath("/simulador");
  return { ok: true };
}

export async function lancarRealizado(estudoId: string, formData: FormData): Promise<Resultado> {
  const session = await exigirPermissao("gerir-simulador");
  const competencia = texto(formData, "competencia");
  if (!competencia) return { erro: "Informe a competência." };
  const r = await gravarRealizado(
    session.companyId,
    estudoId,
    {
      competencia,
      kmRealizado: numero(formData, "kmRealizado") ?? undefined,
      faturamento: numero(formData, "faturamento") ?? undefined,
      custoFolha: numero(formData, "custoFolha") ?? undefined,
      custoCombustivel: numero(formData, "custoCombustivel") ?? undefined,
      custoManutencao: numero(formData, "custoManutencao") ?? undefined,
      custoVeiculo: numero(formData, "custoVeiculo") ?? undefined,
      custoPedagio: numero(formData, "custoPedagio") ?? undefined,
      custoIndiretos: numero(formData, "custoIndiretos") ?? undefined,
      custoOutros: numero(formData, "custoOutros") ?? undefined,
    },
    "lançamento manual",
    session.name
  );
  if (r.erro) return r;
  revalidatePath(`/simulador/${estudoId}`);
  return { ok: true };
}

export async function excluirEstudo(estudoId: string): Promise<Resultado> {
  const session = await exigirPermissao("gerir-simulador");
  const estudo = await prisma.simEstudo.findFirst({ where: { id: estudoId, companyId: session.companyId }, select: { nome: true, _count: { select: { simulacoes: true } } } });
  if (!estudo) return { erro: "Estudo não encontrado." };
  await prisma.simEstudo.delete({ where: { id: estudoId } });
  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "SIMULADOR_ESTUDO_EXCLUIDO",
    entidadeTipo: "SimEstudo",
    entidadeId: estudoId,
    descricao: `Estudo "${estudo.nome}" excluído, com ${estudo._count.simulacoes} versão(ões).`,
  });
  revalidatePath("/simulador");
  return { ok: true };
}

// HABILITAÇÃO: a situação de cada documento (pendente, providenciando, pronto,
// não se aplica), a validade da certidão e uma observação; ou um documento
// novo que a leitura não pegou. O documento é sempre de um estudo da empresa.
// Sem revalidatePath: a aba guarda o estado na tela, e recarregar a página do
// estudo releria os custos reais a cada clique.
export async function salvarDocumentoHabilitacao(
  estudoId: string,
  id: string | null,
  dados: { grupo?: string; documento?: string; exigencia?: string | null; situacao?: string; validade?: string | null; observacao?: string | null }
): Promise<Resultado> {
  const session = await exigirPermissao("gerir-simulador");
  const estudo = await prisma.simEstudo.findFirst({ where: { id: estudoId, companyId: session.companyId }, select: { id: true } });
  if (!estudo) return { erro: "Estudo não encontrado." };
  if (dados.situacao !== undefined && !(SITUACOES_DOCUMENTO as readonly string[]).includes(dados.situacao)) return { erro: "Situação inválida." };
  if (dados.grupo !== undefined && !(GRUPOS_HABILITACAO as readonly string[]).includes(dados.grupo)) return { erro: "Grupo inválido." };
  if (dados.validade && !/^\d{4}-\d{2}-\d{2}$/.test(dados.validade)) return { erro: "Validade inválida." };
  const campos = {
    ...(dados.grupo !== undefined && { grupo: dados.grupo }),
    ...(dados.documento !== undefined && { documento: dados.documento.trim().slice(0, 500) }),
    ...(dados.exigencia !== undefined && { exigencia: dados.exigencia?.trim().slice(0, 1000) || null }),
    ...(dados.situacao !== undefined && { situacao: dados.situacao }),
    ...(dados.validade !== undefined && { validade: dados.validade ? new Date(`${dados.validade}T00:00:00Z`) : null }),
    ...(dados.observacao !== undefined && { observacao: dados.observacao?.trim().slice(0, 1000) || null }),
    atualizadoPor: session.name,
  };
  if (campos.documento === "") return { erro: "Diga qual é o documento." };
  if (id) {
    const r = await prisma.simDocumentoHabilitacao.updateMany({ where: { id, estudoId }, data: campos });
    if (r.count === 0) return { erro: "Documento não encontrado." };
  } else {
    if (!campos.documento || !campos.grupo) return { erro: "Diga o documento e o grupo." };
    const ultimo = await prisma.simDocumentoHabilitacao.findFirst({ where: { estudoId }, orderBy: { ordem: "desc" }, select: { ordem: true } });
    const novo = await prisma.simDocumentoHabilitacao.create({ data: { estudoId, ordem: (ultimo?.ordem ?? -1) + 1, grupo: campos.grupo, documento: campos.documento, exigencia: campos.exigencia ?? null, atualizadoPor: session.name } });
    id = novo.id;
  }
  return { ok: true, id };
}

export async function excluirDocumentoHabilitacao(estudoId: string, id: string): Promise<Resultado> {
  const session = await exigirPermissao("gerir-simulador");
  const r = await prisma.simDocumentoHabilitacao.deleteMany({ where: { id, estudoId, estudo: { companyId: session.companyId } } });
  if (r.count === 0) return { erro: "Documento não encontrado." };
  return { ok: true };
}

// A DISPUTA: os participantes da sessão (a ata), empresa a empresa. A lista
// inteira é regravada a cada "Salvar". A vencedora e a posição da Azul também
// vão ao resultado do estudo, para a lista e o histórico.
export async function salvarParticipantes(
  estudoId: string,
  lista: { empresa: string; cnpj?: string | null; posicao?: string | number | null; preco?: string | number | null; valorTotal?: string | number | null; situacao?: string; ehNossa?: boolean; observacao?: string | null }[]
): Promise<Resultado> {
  const session = await exigirPermissao("gerir-simulador");
  const estudo = await prisma.simEstudo.findFirst({ where: { id: estudoId, companyId: session.companyId }, select: { id: true, nome: true } });
  if (!estudo) return { erro: "Estudo não encontrado." };
  if (!Array.isArray(lista) || lista.length > 80) return { erro: "Lista de participantes inválida (até 80)." };
  const n = (v: unknown) => (v === null || v === undefined || String(v).trim() === "" ? null : lerNumero(String(v)));
  const linhas = [];
  for (const [k, x] of lista.entries()) {
    const empresa = String(x.empresa ?? "").trim().slice(0, 160);
    if (!empresa) continue;
    const [posicao, preco, valorTotal] = [n(x.posicao), n(x.preco), n(x.valorTotal)];
    if (posicao !== null && !(Number.isInteger(posicao) && posicao >= 1 && posicao <= 200)) return { erro: `${empresa}: posição inteira de 1 a 200.` };
    for (const [v, rotulo] of [[preco, "preço"], [valorTotal, "valor total"]] as const)
      if (v !== null && (!Number.isFinite(v) || v < 0 || v > 1e12)) return { erro: `${empresa}: ${rotulo} inválido.` };
    const situacao = (SITUACOES_PARTICIPANTE as readonly string[]).includes(String(x.situacao)) ? String(x.situacao) : "CLASSIFICADA";
    linhas.push({ estudoId, ordem: k, empresa, cnpj: String(x.cnpj ?? "").replace(/[^\d./-]/g, "").slice(0, 20) || null, posicao, preco, valorTotal, situacao, ehNossa: x.ehNossa === true, observacao: String(x.observacao ?? "").trim().slice(0, 500) || null });
  }
  if (linhas.filter((l) => l.ehNossa).length > 1) return { erro: "Só uma linha pode ser a Azul." };
  if (linhas.filter((l) => l.situacao === "VENCEDORA").length > 1) return { erro: "Só uma vencedora por disputa (no lote por item, use um estudo por item ou a observação)." };
  const vencedora = linhas.find((l) => l.situacao === "VENCEDORA") ?? null;
  const nossa = linhas.find((l) => l.ehNossa) ?? null;
  await prisma.$transaction([
    prisma.simParticipante.deleteMany({ where: { estudoId } }),
    prisma.simParticipante.createMany({ data: linhas }),
    prisma.simEstudo.update({
      where: { id: estudoId },
      data: {
        ...(vencedora && { resultadoVencedor: vencedora.empresa, ...(vencedora.preco !== null && { resultadoPrecoKm: vencedora.preco }), ...(vencedora.valorTotal !== null && { resultadoValorTotal: vencedora.valorTotal }) }),
        ...(nossa?.posicao && { resultadoPosicao: nossa.posicao }),
      },
    }),
  ]);
  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "SIMULADOR_DISPUTA_REGISTRADA",
    entidadeTipo: "SimEstudo",
    entidadeId: estudoId,
    descricao: `Disputa do estudo "${estudo.nome}": ${linhas.length} participante(s)${vencedora ? `, vencedora ${vencedora.empresa}` : ""}.`,
  });
  revalidatePath(`/simulador/${estudoId}`);
  revalidatePath("/simulador/editais");
  return { ok: true };
}

// IMPORTAR O GABARITO: lê, grava com vigência e devolve o resumo e os avisos.
const LIMITE_ARQUIVO = 5 * 1024 * 1024;

export async function importarGabarito(formData: FormData): Promise<Resultado & { avisos?: string[]; resumo?: Record<string, { novos: number; alterados: number; inalterados: number }> }> {
  const session = await exigirPermissao("gerir-simulador");
  const arquivo = formData.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) return { erro: "Escolha o arquivo do Gabarito (.xlsx)." };
  if (arquivo.size > LIMITE_ARQUIVO) return { erro: "Arquivo acima de 5 MB — o Gabarito tem menos de 100 KB." };
  if (!arquivo.name.toLowerCase().endsWith(".xlsx")) return { erro: "O Gabarito é um arquivo .xlsx." };
  let leitura;
  try {
    leitura = await lerGabarito(Buffer.from(await arquivo.arrayBuffer()));
  } catch {
    return { erro: "Não foi possível ler o arquivo como planilha do Excel." };
  }
  const total = leitura.parametros.length + leitura.veiculos.length + leitura.funcoes.length + leitura.pedagios.length + leitura.referencias.length;
  if (total === 0) return { erro: "Nenhum valor preenchido no Gabarito — nada a importar.", avisos: leitura.avisos.slice(0, 40) };
  const resumo = await gravarLeitura(session.companyId, leitura, { fonte: `Gabarito "${arquivo.name.slice(0, 80)}"`, autor: session.name });
  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "SIMULADOR_BASE_IMPORTADA",
    descricao: `Base de custos importada do Gabarito: ${Object.entries(resumo)
      .map(([k, v]) => `${k} ${v.novos} novo(s), ${v.alterados} alterado(s)`)
      .join("; ")}.`,
  });
  revalidatePath("/simulador/base");
  return { ok: true, resumo, avisos: leitura.avisos.slice(0, 40) };
}

// AJUSTES DA BASE DE CUSTOS PELA TELA — mesma regra de vigência do Gabarito.
async function registrarAjusteBase(session: Awaited<ReturnType<typeof exigirPermissao>>, descricao: string) {
  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "SIMULADOR_BASE_AJUSTADA",
    descricao: descricao.slice(0, 500),
  });
  revalidatePath("/simulador/base");
}

export async function ajustarParametroBase(chave: string, valor: number | null, texto: string | null): Promise<Resultado> {
  const session = await exigirPermissao("gerir-simulador");
  const r = await ajustarParametro(session.companyId, String(chave).slice(0, 60), { valor, texto }, session.name);
  if (r.erro) return { erro: r.erro };
  const mudou = r.resumo!.parametros.novos + r.resumo!.parametros.alterados > 0;
  if (mudou) await registrarAjusteBase(session, `Base de custos: parâmetro ${chave} ajustado na tela para ${texto ?? valor}.`);
  return { ok: true, mensagem: mudou ? "Salvo. Vale para os estudos novos a partir de agora." : "Sem mudança." };
}

export async function voltarParametroAoPadrao(chave: string): Promise<Resultado> {
  const session = await exigirPermissao("gerir-simulador");
  const r = await voltarAoPadrao(session.companyId, String(chave).slice(0, 60));
  if (r.erro) return { erro: r.erro };
  await registrarAjusteBase(session, `Base de custos: parâmetro ${chave} voltou ao padrão do simulador.`);
  return { ok: true, mensagem: "Voltou ao padrão do simulador." };
}

export async function salvarRegistroBase(tipo: TipoTabela, campos: Record<string, unknown>, idAnterior: string | null): Promise<Resultado> {
  const session = await exigirPermissao("gerir-simulador");
  if (!(tipo in TABELAS)) return { erro: "Tabela inválida." };
  const r = await salvarRegistro(session.companyId, tipo, campos ?? {}, idAnterior, session.name);
  if (r.erro) return { erro: r.erro };
  const total = r.resumo!;
  const grupo = tipo === "veiculo" ? total.veiculos : tipo === "funcao" ? total.funcoes : total.pedagios;
  const mudou = grupo.novos + grupo.alterados > 0;
  if (mudou) await registrarAjusteBase(session, `Base de custos: ${tipo === "veiculo" ? "modelo da frota" : tipo === "funcao" ? "função" : "praça de pedágio"} ${grupo.novos > 0 ? "incluído" : "ajustado"} na tela.`);
  return { ok: true, mensagem: mudou ? "Salvo." : "Sem mudança." };
}

export async function encerrarRegistroBase(tipo: TipoTabela, id: string): Promise<Resultado> {
  const session = await exigirPermissao("gerir-simulador");
  if (!(tipo in TABELAS)) return { erro: "Tabela inválida." };
  const r = await encerrarRegistro(session.companyId, tipo, String(id));
  if (r.erro) return { erro: r.erro };
  await registrarAjusteBase(session, `Base de custos: ${tipo === "veiculo" ? "modelo da frota" : tipo === "funcao" ? "função" : "praça de pedágio"} retirado da base.`);
  return { ok: true, mensagem: "Retirado da base (fica no histórico)." };
}

// IMPORTAR EDITAL (Novo estudo). Dois passos — cada arquivo sobe sozinho (a
// hospedagem limita o corpo da requisição) e depois a leitura lê o conjunto.
// Nada é gravado no estudo aqui: a leitura preenche o formulário, e a pessoa
// confere antes de criar. A trilha registra a leitura.
export async function enviarArquivoDoEdital(formData: FormData): Promise<{ erro?: string; arquivo?: ArquivoAssinado; guardado?: string }> {
  const session = await exigirPermissao("gerir-simulador");
  const f = formData.get("arquivo");
  if (!(f instanceof File)) return { erro: "Arquivo não recebido." };
  const nome = (texto(formData, "nome", 200) ?? f.name).slice(0, 200);
  const conteudo = Buffer.from(await f.arrayBuffer());
  const r = await enviarArquivo(conteudo, nome, f.type, f.name);
  if (!r.ok) return { erro: r.erro };
  // O original fica guardado (sem estudo até o "Criar") para a consulta no
  // histórico. Falha ao guardar não impede a leitura.
  const g = await guardarArquivo({ companyId: session.companyId, estudoId: null, tipo: "EDITAL", nome, mimeType: f.type, conteudo, autor: session.name }).catch(() => null);
  return { arquivo: assinarArquivo(session.companyId, r.arquivo), guardado: g?.ok ? g.id : undefined };
}

// Arquivo acrescentado depois, no estudo (ata da sessão, contrato, recurso).
export async function anexarArquivoAoEstudo(estudoId: string, formData: FormData): Promise<{ erro?: string; id?: string }> {
  const session = await exigirPermissao("gerir-simulador");
  const estudo = await prisma.simEstudo.findFirst({ where: { id: estudoId, companyId: session.companyId }, select: { id: true } });
  if (!estudo) return { erro: "Estudo não encontrado." };
  const f = formData.get("arquivo");
  if (!(f instanceof File)) return { erro: "Arquivo não recebido." };
  const tipo = (TIPOS_ARQUIVO as readonly string[]).includes(String(formData.get("tipo"))) ? (String(formData.get("tipo")) as TipoArquivo) : "OUTRO";
  const nome = (texto(formData, "nome", 200) ?? f.name).slice(0, 200);
  const r = await guardarArquivo({ companyId: session.companyId, estudoId, tipo, nome, mimeType: f.type, conteudo: Buffer.from(await f.arrayBuffer()), autor: session.name });
  if (!r.ok) return { erro: r.erro };
  revalidatePath(`/simulador/${estudoId}`);
  return { id: r.id };
}

// A PLANILHA DE CUSTOS DO EDITAL PREENCHIDA (planilhaDoEdital.ts): o modelo
// do órgão (um .xlsx guardado no estudo) com os números da última versão
// salva — ou do estudo como abre, sem versão. Fica guardada no estudo como
// "Proposta enviada", com a aba Conferência dizendo o que falta.
export async function preencherPlanilhaDoEdital(estudoId: string, arquivoId: string): Promise<{ erro?: string; id?: string; preenchidas?: number; pendentes?: number }> {
  const session = await exigirPermissao("gerir-simulador");
  const arquivo = await prisma.simArquivo.findFirst({ where: { id: arquivoId, estudoId, companyId: session.companyId }, select: { nome: true, conteudo: true } });
  if (!arquivo) return { erro: "Arquivo não encontrado." };
  if (!/\.xlsx$/i.test(arquivo.nome)) return { erro: "Só o modelo em Excel (.xlsx) pode ser preenchido." };
  const carregado = await carregarEstudo(session.companyId, estudoId);
  if (!carregado) return { erro: "Estudo não encontrado." };
  const inicial = await entradaInicial(session.companyId, carregado);
  let resultado: ReturnType<typeof simular>;
  try {
    resultado = simular(inicial.entrada);
  } catch {
    return { erro: "O estudo ainda não tem conta (faltam rotas ou itens)." };
  }
  const conteudo = Buffer.from(arquivo.conteudo);
  let inventario: Awaited<ReturnType<typeof inventariarPlanilha>>;
  try {
    inventario = await inventariarPlanilha(conteudo);
  } catch {
    return { erro: "Não foi possível abrir a planilha (arquivo protegido ou corrompido)." };
  }
  const catalogo = catalogoDoEstudo(inicial.entrada, resultado);
  const m = await mapearPlanilha(inventario, catalogo, { estudo: carregado.estudo.nome, arquivo: arquivo.nome });
  if (!m.ok) return { erro: m.erro };
  const unidade = inicial.entrada.unidadePreco ?? "KM";
  const preco = resultado.lote ? resultado.lote.precoPropostaUnidade : (resultado.itens[0]?.precoUnidade ?? 0);
  const r = await preencherPlanilha(conteudo, inventario, m.mapa, catalogo, { estudo: carregado.estudo.nome, versao: inicial.versaoBase, unidade: ROTULO_UNIDADE[unidade], preco });
  const nome = `${arquivo.nome.replace(/\.xlsx$/i, "")} — preenchida${inicial.versaoBase ? ` v${inicial.versaoBase}` : ""}.xlsx`;
  const g = await guardarArquivo({ companyId: session.companyId, estudoId, tipo: "PROPOSTA", nome, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", conteudo: r.conteudo, autor: session.name });
  if (!g.ok) return { erro: g.erro };
  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "SIMULADOR_PLANILHA_EDITAL_PREENCHIDA",
    entidadeTipo: "SimEstudo",
    entidadeId: estudoId,
    descricao: `Planilha do edital "${arquivo.nome}" preenchida: ${r.preenchidas} célula(s), ${r.pendentes.length} pendente(s).`,
  });
  revalidatePath(`/simulador/${estudoId}`);
  return { id: g.id, preenchidas: r.preenchidas, pendentes: r.pendentes.length };
}

export async function excluirArquivoDoEstudo(estudoId: string, id: string): Promise<Resultado> {
  const session = await exigirPermissao("gerir-simulador");
  const r = await prisma.simArquivo.deleteMany({ where: { id, estudoId, companyId: session.companyId } });
  if (r.count === 0) return { erro: "Arquivo não encontrado." };
  revalidatePath(`/simulador/${estudoId}`);
  return { ok: true };
}

export async function lerEditalEnviado(arquivosJson: string): Promise<{ erro?: string; estudo?: EstudoImportado }> {
  const session = await exigirPermissao("gerir-simulador");
  let bruto: unknown;
  try {
    bruto = JSON.parse(arquivosJson);
  } catch {
    return { erro: "Lista de arquivos ilegível." };
  }
  const arquivos = arquivosAssinadosValidos(session.companyId, bruto);
  if (!arquivos) return { erro: "Arquivos do edital inválidos — envie de novo." };
  const r = await lerEdital(arquivos, { empresa: "Azul Mob (fretamento e transporte de passageiros, São Paulo)" });
  if (!r.ok) return { erro: r.erro };
  const estudo = editalParaEstudo(r.edital);
  estudo.leitura = { modelo: nomeDoModelo(r.leitura.modelo), refeitaPorque: r.leitura.refeitaPorque };
  // O que a conferência ainda acusa vai para as suposições, para conferir.
  for (const a of r.leitura.avisos) estudo.regras.unshift({ tema: "SUPOSICAO", texto: `Conferência da leitura: ${a}. Confira no edital.`, fonte: null });
  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "SIMULADOR_EDITAL_LIDO",
    entidadeTipo: "SimEstudo",
    entidadeId: "novo",
    descricao: `Edital lido pela IA (${nomeDoModelo(r.leitura.modelo)}${r.leitura.refeitaPorque ? `, refeito porque: ${r.leitura.refeitaPorque.slice(0, 120)}` : ""}; ${arquivos.length} arquivo(s): ${[...new Set(arquivos.map((a) => a.nome))].join(", ").slice(0, 400)}) — ${estudo.itens.length} item(ns), ${estudo.itens.reduce((a, i) => a + i.rotas.length, 0)} rota(s).`,
  });
  return { estudo };
}

// A pessoa desistiu no meio do envio: apaga o que já subiu.
export async function testarConexaoDaIA(): Promise<{ ok?: boolean; erro?: string }> {
  await exigirPermissao("gerir-simulador");
  const r = await testarConexao();
  return r.ok ? { ok: true } : { erro: r.erro };
}

export async function descartarArquivosDoEdital(arquivosJson: string): Promise<void> {
  const session = await exigirPermissao("gerir-simulador");
  let bruto: unknown;
  try {
    bruto = JSON.parse(arquivosJson);
  } catch {
    return;
  }
  const arquivos = arquivosAssinadosValidos(session.companyId, bruto);
  if (arquivos) await apagarArquivos(arquivos.map((a) => a.fileId));
}
