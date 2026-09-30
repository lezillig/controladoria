"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { registrarEvento } from "@/lib/controladoria/trilha";
import { lerGabarito } from "@/lib/simulador/gabarito";
import { gravarLeitura } from "@/lib/simulador/baseDeCustos";
import {
  criarEstudo as criarEstudoNoBanco,
  gravarRealizado,
  registrarLance as registrarLanceNoBanco,
  registrarResultado as registrarResultadoNoBanco,
  salvarVersao as salvarVersaoNoBanco,
  STATUS_ESTUDO,
  STATUS_VERSAO,
  TIPOS_ESTUDO,
  TIPOS_SERVICO,
} from "@/lib/simulador/estudos";
import type { MapaOrigem } from "@/lib/simulador/premissas";
import { lerNumero } from "@/lib/simulador/numeros";
import { ajustarParametro, encerrarRegistro, salvarRegistro, TABELAS, voltarAoPadrao, type TipoTabela } from "@/lib/simulador/edicaoBase";
import { TIPOS_VEICULO, type EntradaSimulacao, type TipoVeiculo, type UnidadePreco } from "@/lib/simulador/tipos";
import { exigirPermissao } from "../_dados";

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
const UNIDADES: UnidadePreco[] = ["KM", "VEICULO_MES", "DIARIA", "HORA", "BINOMIA"];

export async function criarEstudo(formData: FormData): Promise<Resultado> {
  const session = await exigirPermissao("gerir-simulador");
  const nome = texto(formData, "nome", 120);
  if (!nome) return { erro: "Dê um nome ao estudo." };
  const tipo = texto(formData, "tipo") ?? "LICITACAO";
  const tipoServico = texto(formData, "tipoServico") ?? "FRETAMENTO";
  if (!(TIPOS_ESTUDO as readonly string[]).includes(tipo)) return { erro: "Tipo de estudo inválido." };
  if (!(TIPOS_SERVICO as readonly string[]).includes(tipoServico)) return { erro: "Tipo de serviço inválido." };
  const unidade = (texto(formData, "unidadePreco") ?? "KM") as UnidadePreco;
  if (!UNIDADES.includes(unidade)) return { erro: "Unidade de preço inválida." };
  const dataSessao = texto(formData, "dataSessao");
  const publico = texto(formData, "esfera") === "PUBLICO";
  const validade = texto(formData, "validadeProposta");
  const inicio = texto(formData, "inicioPrevisto");
  const tiposVeiculo = [...new Set(formData.getAll("tiposVeiculo").map(String))].filter((t): t is TipoVeiculo => (TIPOS_VEICULO as string[]).includes(t));
  // Número digitado por extenso ("doze") ou fora de faixa não vira padrão
  // calado: volta como erro para a pessoa corrigir.
  for (const [campo, rotulo, max] of [["vigenciaMeses", "Vigência", 240], ["prazoPagamentoDias", "Prazo de pagamento", 365], ["valorTotalMaximo", "Valor total máximo", 1e12], ["avisoRescisaoDias", "Aviso para rescisão", 365]] as const) {
    const bruto = texto(formData, campo);
    const n = numero(formData, campo);
    if (bruto !== null && (n === null || n < 0 || n > max)) return { erro: `${rotulo}: informe um número válido.` };
  }
  const id = await criarEstudoNoBanco(
    session.companyId,
    {
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
    session.name
  );
  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "SIMULADOR_ESTUDO_CRIADO",
    entidadeTipo: "SimEstudo",
    entidadeId: id,
    descricao: `Estudo de custo "${nome}" criado.`,
  });
  revalidatePath("/simulador");
  return { ok: true, id };
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
  const r = await registrarLanceNoBanco(
    session.companyId,
    estudoId,
    {
      fase,
      dataHora: quando ? new Date(quando) : new Date(),
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
  const r = await registrarResultadoNoBanco(session.companyId, estudoId, {
    status,
    posicao: numero(formData, "posicao"),
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
