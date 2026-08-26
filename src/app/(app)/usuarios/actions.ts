"use server";

import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { prismaGestao } from "@/lib/gestao/cliente";
import { PERMISSOES } from "@/lib/acessos";
import { registrarEvento } from "../auditoria/actions";
import { exigirPermissao } from "../_dados";

// USUÁRIOS E PERFIS.
//
// Duas operações que parecem uma só e não são, e a distinção é o desenho
// inteiro desta tela:
//
//   CRIAR USUÁRIO escreve no cadastro do SISTEMA DE GESTÃO — o mesmo de onde
//   vem o login da frota. Não se cria um cadastro paralelo aqui, e a razão é
//   de segurança: com dois cadastros, desligar alguém passaria a depender de
//   alguém lembrar de repetir a operação nos dois lugares, e o dia do
//   esquecimento é o dia em que um ex-funcionário continua enxergando o caixa
//   do grupo. Um cadastro só, com esta tela escrevendo nele, mantém a
//   propriedade que importa: desativar lá tira o acesso aqui no mesmo ato.
//
//   ATRIBUIR PERFIL escreve AQUI. É autorização, assunto da Controladoria, e
//   não tem por que morar no sistema de frota.
//
// A consequência operacional está dita na tela: a conexão com o banco da gestão
// pode ser somente leitura (é o desenho recomendado em
// docs/papel-leitura-gestao.sql). Nesse caso a criação falha, e falha dizendo
// exatamente o que fazer — não com "erro interno".

export type ResultadoUsuario = { erro?: string; ok?: boolean; aviso?: string };

const EMAIL_VALIDO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const TAMANHO_MINIMO_SENHA = 8;

// Os papéis que a gestão reconhece. Fechada de propósito: aceitar texto livre
// gravaria um papel que nenhum dos dois sistemas sabe interpretar, e o usuário
// ficaria criado sem conseguir entrar em lugar nenhum.
const PAPEIS_VALIDOS = ["ADMIN", "GESTOR", "CONTROLADORIA", "FOLHA", "MOTORISTA"];

export async function criarUsuario(formData: FormData): Promise<ResultadoUsuario> {
  const session = await exigirPermissao("gerir-usuarios");

  const nome = String(formData.get("nome") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const senha = String(formData.get("senha") ?? "");
  const role = String(formData.get("role") ?? "").trim().toUpperCase();
  const perfilId = String(formData.get("perfilId") ?? "").trim();

  if (nome.length < 2) return { erro: "Informe o nome da pessoa." };
  if (!EMAIL_VALIDO.test(email)) return { erro: "E-mail inválido." };
  if (senha.length < TAMANHO_MINIMO_SENHA) {
    return { erro: `A senha precisa ter ao menos ${TAMANHO_MINIMO_SENHA} caracteres.` };
  }
  if (!PAPEIS_VALIDOS.includes(role)) return { erro: "Papel inválido." };

  // Conferir ANTES de tentar gravar. O banco tem índice único no e-mail e
  // recusaria de qualquer forma, mas a mensagem dele fala de constraint; esta
  // fala de gente.
  const existentes = await prismaGestao.$queryRaw<{ id: string }[]>`
    SELECT id FROM public."User" WHERE lower(email) = ${email} LIMIT 1
  `;
  if (existentes.length > 0) {
    return { erro: "Já existe um usuário com este e-mail. Para dar acesso, atribua um perfil a ele na lista abaixo." };
  }

  const id = randomUUID();
  const hash = await bcrypt.hash(senha, 10);

  try {
    await prismaGestao.$executeRaw`
      INSERT INTO public."User" (id, "companyId", name, email, "passwordHash", role, active, "createdAt", "updatedAt")
      VALUES (${id}, ${session.companyId}, ${nome}, ${email}, ${hash}, ${role}::"Role", true, NOW(), NOW())
    `;
  } catch (e) {
    const texto = e instanceof Error ? e.message : "";
    // A falha ESPERADA aqui é de permissão, e ela merece a resposta que
    // resolve. "Erro ao criar usuário" mandaria a pessoa abrir chamado sobre
    // um sistema que está funcionando exatamente como foi desenhado.
    if (/permission denied|must be owner|read-only|somente leitura/i.test(texto)) {
      return {
        erro:
          "A conexão com o banco da gestão é somente leitura, e criar usuário exige escrita. " +
          "Duas saídas: cadastrar a pessoa no próprio sistema de gestão (e ela aparece aqui na hora), " +
          "ou conceder INSERT e UPDATE em public.\"User\" ao papel da Controladoria — o comando está em " +
          "docs/papel-leitura-gestao.sql, na seção de escrita.",
      };
    }
    return { erro: `Não consegui criar o usuário: ${texto.slice(0, 200)}` };
  }

  if (perfilId) {
    await prisma.usuarioPerfil.upsert({
      where: { companyId_userId: { companyId: session.companyId, userId: id } },
      create: {
        companyId: session.companyId,
        userId: id,
        perfilId,
        userNome: nome,
        atribuidoPor: session.name,
      },
      update: { perfilId, userNome: nome, atribuidoPor: session.name },
    });
  }

  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "USUARIO_CRIADO",
    entidadeTipo: "User",
    entidadeId: id,
    // A SENHA NÃO ENTRA NA TRILHA, nem o hash. O log de auditoria é lido por
    // gente e exportado; hash de senha ali é credencial circulando.
    descricao: `Usuário "${nome}" (${email}) criado no cadastro da gestão com papel ${role}.`,
  });

  revalidatePath("/usuarios");
  return {
    ok: true,
    aviso:
      "O usuário foi criado no cadastro da GESTÃO — é o mesmo login da frota. " +
      "Desligar essa pessoa lá tira o acesso ao financeiro no mesmo ato.",
  };
}

export async function atribuirPerfil(formData: FormData): Promise<ResultadoUsuario> {
  const session = await exigirPermissao("gerir-usuarios");

  const userId = String(formData.get("userId") ?? "").trim();
  const userNome = String(formData.get("userNome") ?? "").trim() || null;
  const perfilId = String(formData.get("perfilId") ?? "").trim();
  if (!userId) return { erro: "Usuário não informado." };

  const anterior = await prisma.usuarioPerfil.findUnique({
    where: { companyId_userId: { companyId: session.companyId, userId } },
    select: { perfil: { select: { nome: true } } },
  });

  if (perfilId === "") {
    // Remover o perfil devolve a pessoa às regras de PAPEL — não a deixa sem
    // acesso. Sem esta escolha, a única forma de desfazer uma atribuição
    // errada seria criar um perfil que imitasse o papel.
    await prisma.usuarioPerfil.deleteMany({ where: { companyId: session.companyId, userId } });
  } else {
    await prisma.usuarioPerfil.upsert({
      where: { companyId_userId: { companyId: session.companyId, userId } },
      create: { companyId: session.companyId, userId, perfilId, userNome, atribuidoPor: session.name },
      update: { perfilId, userNome, atribuidoPor: session.name },
    });
  }

  const novo = perfilId
    ? await prisma.perfilAcesso.findUnique({ where: { id: perfilId }, select: { nome: true } })
    : null;

  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "PERFIL_ATRIBUIDO",
    entidadeTipo: "UsuarioPerfil",
    entidadeId: userId,
    descricao: `${userNome ?? userId}: perfil ${novo?.nome ?? "removido (volta às regras de papel)"}.`,
    antes: { perfil: anterior?.perfil?.nome ?? null },
    depois: { perfil: novo?.nome ?? null },
  });

  revalidatePath("/usuarios");
  return { ok: true };
}

export async function salvarPerfil(formData: FormData): Promise<ResultadoUsuario> {
  const session = await exigirPermissao("gerir-usuarios");

  const id = String(formData.get("id") ?? "").trim();
  const nome = String(formData.get("nome") ?? "").trim();
  const descricao = String(formData.get("descricao") ?? "").trim() || null;
  const padrao = formData.get("padrao") === "1";

  if (nome.length < 2) return { erro: "Dê um nome ao perfil." };

  const validas = new Set(PERMISSOES.map((p) => p.chave as string));
  const permissoes = formData
    .getAll("permissoes")
    .map(String)
    // Descarta o que não está no catálogo: chave inventada gravada aqui viraria
    // uma permissão que nenhuma tela consulta — invisível e para sempre.
    .filter((p) => validas.has(p));

  const anterior = id
    ? await prisma.perfilAcesso.findFirst({
        where: { id, companyId: session.companyId },
        select: { nome: true, permissoes: true, padrao: true },
      })
    : null;
  if (id && !anterior) return { erro: "Perfil não encontrado." };

  const dados = { nome, descricao, permissoes, padrao };
  const salvo = id
    ? await prisma.perfilAcesso.update({ where: { id }, data: dados })
    : await prisma.perfilAcesso.create({ data: { companyId: session.companyId, ...dados } });

  // Um padrão por empresa. Dois perfis marcados fariam a resolução depender da
  // ordem que o banco devolvesse — acesso decidido por sorte.
  if (padrao) {
    await prisma.perfilAcesso.updateMany({
      where: { companyId: session.companyId, padrao: true, id: { not: salvo.id } },
      data: { padrao: false },
    });
  }

  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: id ? "PERFIL_ALTERADO" : "PERFIL_CRIADO",
    entidadeTipo: "PerfilAcesso",
    entidadeId: salvo.id,
    descricao: `Perfil "${nome}" com ${permissoes.length} permissão(ões)${padrao ? ", marcado como padrão" : ""}.`,
    antes: anterior ?? undefined,
    depois: dados,
  });

  revalidatePath("/usuarios");
  return { ok: true };
}

export async function excluirPerfil(formData: FormData): Promise<ResultadoUsuario> {
  const session = await exigirPermissao("gerir-usuarios");
  const id = String(formData.get("id") ?? "").trim();

  const perfil = await prisma.perfilAcesso.findFirst({
    where: { id, companyId: session.companyId },
    select: { nome: true, _count: { select: { usuarios: true } } },
  });
  if (!perfil) return { erro: "Perfil não encontrado." };

  // Excluir com gente dentro devolveria essas pessoas às regras de papel sem
  // aviso — mudança de acesso em silêncio, que é o que esta tela existe para
  // evitar.
  if (perfil._count.usuarios > 0) {
    return {
      erro:
        `Este perfil está atribuído a ${perfil._count.usuarios} pessoa(s). ` +
        "Mude o perfil delas antes de excluir — excluir agora devolveria todas às regras de papel sem aviso.",
    };
  }

  await prisma.perfilAcesso.delete({ where: { id } });
  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "PERFIL_EXCLUIDO",
    entidadeTipo: "PerfilAcesso",
    entidadeId: id,
    descricao: `Perfil "${perfil.nome}" excluído.`,
  });

  revalidatePath("/usuarios");
  return { ok: true };
}
