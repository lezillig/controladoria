"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { credencialConfigurada, normalizarCredencialRef } from "@/lib/omie/client";
import { diagnosticarConexao, type ResultadoDiagnostico } from "@/lib/omie/diagnostico";
import { registrarEvento } from "../auditoria/actions";
import { exigirPermissao } from "../_dados";

// Cadastro das conexões Omie — uma por CNPJ do grupo.
//
// O que NÃO fica aqui: a credencial. O cadastro guarda apenas o NOME das
// variáveis de ambiente que a contêm (`credencialRef`). Guardar app_key e
// app_secret no banco significaria que um vazamento de banco — backup, dump,
// acesso de leitura de um terceiro — entregaria acesso ao ERP financeiro do
// grupo. Um formulário que pedisse a chave também a colocaria no log da
// requisição, no histórico do navegador e no corpo do POST.

export type ResultadoConexao = { erro?: string; ok?: boolean; aviso?: string };

export async function salvarConexao(formData: FormData): Promise<ResultadoConexao> {
  const session = await exigirPermissao("gerir-conexoes");

  const id = String(formData.get("id") ?? "").trim();
  const nome = String(formData.get("nome") ?? "").trim();
  const apelido = String(formData.get("apelido") ?? "").trim().toUpperCase();
  const cnpjBruto = String(formData.get("cnpj") ?? "").replace(/\D/g, "");
  const credencialRef = normalizarCredencialRef(String(formData.get("credencialRef") ?? ""));

  if (!nome) return { erro: "Informe o nome da empresa." };
  if (!apelido) return { erro: "Informe um apelido curto (ex.: AZUL, MCZ)." };
  if (!/^[A-Z0-9]{2,12}$/.test(apelido)) {
    return { erro: "O apelido deve ter de 2 a 12 letras ou números, sem espaço nem acento." };
  }
  if (!credencialRef) return { erro: "Informe a referência de credencial (ex.: AZUL)." };
  if (cnpjBruto && cnpjBruto.length !== 14) return { erro: "CNPJ deve ter 14 dígitos." };

  // Apelido duplicado quebraria a chave de achado (que o inclui) e faria dois
  // achados de empresas diferentes colidirem na deduplicação.
  const conflitoApelido = await prisma.omieConexao.findFirst({
    where: { companyId: session.companyId, apelido, ...(id ? { NOT: { id } } : {}) },
    select: { id: true },
  });
  if (conflitoApelido) return { erro: `Já existe uma conexão com o apelido ${apelido}.` };

  const conflitoRef = await prisma.omieConexao.findFirst({
    where: { companyId: session.companyId, credencialRef, ...(id ? { NOT: { id } } : {}) },
    select: { id: true, apelido: true },
  });
  if (conflitoRef) {
    return {
      erro: `A referência de credencial ${credencialRef} já é usada pela conexão ${conflitoRef.apelido}. Duas empresas apontando para a mesma chave sincronizariam a mesma conta duas vezes.`,
    };
  }

  const dados = { nome, apelido, cnpj: cnpjBruto || null, credencialRef };

  const conexao = id
    ? await prisma.omieConexao.update({ where: { id }, data: dados })
    : await prisma.omieConexao.create({
        data: { companyId: session.companyId, ...dados, ordem: await proximaOrdem(session.companyId) },
      });

  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: id ? "CONEXAO_ALTERADA" : "CONEXAO_CADASTRADA",
    entidadeTipo: "OmieConexao",
    entidadeId: conexao.id,
    descricao: `Conexão ${apelido} (${nome}) ${id ? "alterada" : "cadastrada"}, credencial ${credencialRef}.`,
    depois: dados,
  });

  revalidatePath("/conexoes");
  revalidatePath("/sincronizacao");

  // Aviso, não erro: a conexão pode ser cadastrada antes de as variáveis
  // existirem no ambiente — é comum configurar o sistema e a hospedagem em
  // momentos diferentes. O que não pode é a pessoa descobrir isso só no
  // primeiro sync que falha.
  if (!credencialConfigurada(credencialRef)) {
    return {
      ok: true,
      aviso: `Conexão salva, mas as variáveis OMIE_APP_KEY_${credencialRef} e OMIE_APP_SECRET_${credencialRef} ainda não existem no ambiente. Enquanto não existirem, esta conexão fica fora do ciclo diário.`,
    };
  }

  return { ok: true };
}

export type ResultadoTeste = { erro?: string; diagnostico?: ResultadoDiagnostico };

// Testa a conexão contra a Omie de verdade, endpoint por endpoint, sem gravar
// nada. É o primeiro passo da integração: descobrir que a credencial não vale
// ou que um endpoint não está liberado leva trinta segundos aqui e levaria uma
// madrugada inteira se ficasse para o primeiro ciclo automático.
export async function testarConexao(formData: FormData): Promise<ResultadoTeste> {
  const session = await exigirPermissao("gerir-conexoes");
  const id = String(formData.get("id") ?? "");
  if (!id) return { erro: "Conexão não informada." };

  const conexao = await prisma.omieConexao.findFirst({
    where: { id, companyId: session.companyId },
    select: { apelido: true, credencialRef: true },
  });
  if (!conexao) return { erro: "Conexão não encontrada." };

  if (!credencialConfigurada(conexao.credencialRef)) {
    return {
      erro: `As variáveis OMIE_APP_KEY_${conexao.credencialRef} e OMIE_APP_SECRET_${conexao.credencialRef} não existem neste ambiente. Cadastre-as na hospedagem e faça um novo deploy antes de testar.`,
    };
  }

  try {
    const diagnostico = await diagnosticarConexao(id, session.companyId);

    await registrarEvento({
      companyId: session.companyId,
      userId: session.userId,
      userNome: session.name,
      userEmail: session.email,
      acao: "CONEXAO_TESTADA",
      entidadeTipo: "OmieConexao",
      entidadeId: id,
      descricao: `Diagnóstico da conexão ${conexao.apelido}: ${diagnostico.ok} endpoint(s) com dado, ${diagnostico.vazios} sem registro no período, ${diagnostico.erros} com erro.`,
      depois: {
        erros: diagnostico.endpoints.filter((e) => e.estado === "ERRO").map((e) => ({ endpoint: e.chave, erro: e.erro })),
      },
    });

    return { diagnostico };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Falha ao testar a conexão." };
  }
}

async function proximaOrdem(companyId: string): Promise<number> {
  const ultima = await prisma.omieConexao.findFirst({
    where: { companyId },
    orderBy: { ordem: "desc" },
    select: { ordem: true },
  });
  return (ultima?.ordem ?? 0) + 1;
}

// Desativa em vez de apagar. Apagar levaria junto, por cascata, todo o espelho
// daquela empresa — títulos, baixas, extrato, notas — e com ele o histórico
// que sustenta os achados já emitidos. Desativada, a conexão sai do ciclo
// diário e o histórico continua consultável.
export async function alternarConexao(formData: FormData): Promise<void> {
  const session = await exigirPermissao("gerir-conexoes");
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const conexao = await prisma.omieConexao.findFirst({ where: { id, companyId: session.companyId } });
  if (!conexao) return;

  await prisma.omieConexao.update({ where: { id }, data: { ativa: !conexao.ativa } });

  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: conexao.ativa ? "CONEXAO_DESATIVADA" : "CONEXAO_REATIVADA",
    entidadeTipo: "OmieConexao",
    entidadeId: conexao.id,
    descricao: `Conexão ${conexao.apelido} ${conexao.ativa ? "desativada" : "reativada"}.`,
    antes: { ativa: conexao.ativa },
    depois: { ativa: !conexao.ativa },
  });

  revalidatePath("/conexoes");
}
