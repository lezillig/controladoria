import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { temColuna } from "./esquema";
import type { Periodo } from "./periodos";

// COMPOSIÇÃO DO MÊS — de onde vem cada real da receita e da despesa.
//
// Nasceu de uma pergunta que o painel não sabia responder: "quais categorias e
// valores estão sendo considerados para a receita do mês?". Um número de nove
// milhões sem composição não é informação — é uma afirmação que a pessoa
// precisa aceitar ou rejeitar em bloco. E quando ele não bate com o que o
// contador diz, não havia por onde começar a investigar.
//
// O que o painel chama de receita é a soma dos títulos A RECEBER com
// vencimento no mês, pelo valor do documento. Isso NÃO é faturamento: título a
// receber também carrega aporte de sócio, empréstimo, reembolso, estorno e
// transferência entre contas. Abrir por categoria, tipo de documento e conta é
// justamente o que torna isso visível — se metade da "receita" está numa
// categoria de empréstimo, a tela passa a dizer isso em vez de esconder no
// total.
//
// Somado no banco: uma linha por combinação, não 46 mil títulos na memória.

export type LinhaComposicao = {
  categoria: string;
  tipo: string;
  conta: string;
  valorCents: number;
  quantidade: number;
  participacaoPercent: number;
};

export type ComposicaoDoPeriodo = {
  totalCents: number;
  quantidade: number;
  linhas: LinhaComposicao[];
};

type LinhaBruta = {
  categoria: string | null;
  tipo: string | null;
  conta: string | null;
  valor: bigint;
  quantidade: bigint;
};

// Campo em branco vira rótulo próprio e VISÍVEL, nunca é diluído nas outras
// linhas. Dinheiro sem classificação tem que incomodar: é ele que esconde
// tanto o erro de lançamento quanto o que não deveria estar ali.
function rotulo(valor: string | null | undefined, vazio: string): string {
  const limpo = valor?.trim();
  return limpo && limpo.length > 0 ? limpo : vazio;
}

export async function composicaoDoPeriodo(params: {
  companyId: string;
  conexaoId?: string | null;
  periodo: Periodo;
  natureza: "PAGAR" | "RECEBER";
}): Promise<ComposicaoDoPeriodo> {
  const { companyId, conexaoId, periodo, natureza } = params;

  // Fragmento parametrizado, nunca interpolação: o id vem da querystring.
  const filtro = conexaoId ? Prisma.sql`AND t."conexaoId" = ${conexaoId}` : Prisma.empty;

  // A descrição da categoria vem do PLANO DE CATEGORIAS quando o título não a
  // traz — e ele nunca traz: a Omie devolve só `cCodCateg` em
  // `PesquisarLancamentos`, confirmado no diagnóstico das duas contas.
  //
  // A gravação passou a resolver isso, mas só para registro novo. Sem este
  // join, os 46 mil títulos já espelhados continuariam aparecendo como
  // "1.01.03" até alguém recarregar a base inteira — e "1.01.03" não responde
  // à pergunta que esta tela existe para responder.
  //
  // O JOIN É CONDICIONAL, e a condição não é sobre o dado: é sobre o BANCO ter
  // a coluna. O banco de produção estava com `OmieCategoria` numa versão
  // anterior à das conexões, sem `conexaoId`, e esta consulta morria com
  // `column cat.conexaoId does not exist` — derrubando a tela inteira por causa
  // de um nome de categoria. Uma tela que existe para investigar não pode
  // deixar de abrir por causa de um enfeite.
  //
  // Isto NÃO é o conserto do banco. A diferença entre o schema do repositório e
  // o banco que está atendendo aparece por extenso na tela de sincronização
  // (ver esquema.ts); corrige-se com migração, não escondendo.
  const podeJuntarCategoria = await temColuna("OmieCategoria", "conexaoId");
  const juncaoCategoria = podeJuntarCategoria
    ? Prisma.sql`
      LEFT JOIN "OmieCategoria" cat
        ON cat."companyId" = t."companyId"
       AND cat."conexaoId" = t."conexaoId"
       AND cat.codigo = t."categoriaCodigo"`
    : Prisma.empty;
  const descricaoDaCategoria = podeJuntarCategoria ? Prisma.sql`NULLIF(TRIM(cat.descricao), ''),` : Prisma.empty;

  const linhas = await prisma.$queryRaw<LinhaBruta[]>`
    SELECT COALESCE(
             NULLIF(TRIM(t."categoriaDescricao"), ''),
             ${descricaoDaCategoria}
             t."categoriaCodigo"
           ) AS categoria,
           t."tipoDocumento" AS tipo,
           COALESCE(NULLIF(TRIM(cc.descricao), ''), cc."numeroConta", t."contaCorrenteCodigo") AS conta,
           SUM(t."valorDocumentoCents")::bigint AS valor,
           COUNT(*)::bigint AS quantidade
      FROM "OmieTitulo" t
      ${juncaoCategoria}
      LEFT JOIN "OmieContaCorrente" cc
        ON cc."companyId" = t."companyId"
       AND cc."conexaoId" = t."conexaoId"
       AND cc.codigo = t."contaCorrenteCodigo"
     WHERE t."companyId" = ${companyId}
       AND t.cancelado = false
       AND t.natureza::text = ${natureza}
       AND t."dataVencimento" >= ${periodo.inicio}
       AND t."dataVencimento" <= ${periodo.fim}
       ${filtro}
     GROUP BY 1, 2, 3
     ORDER BY SUM(t."valorDocumentoCents") DESC
  `;

  const totalCents = linhas.reduce((acc, l) => acc + Number(l.valor), 0);
  const quantidade = linhas.reduce((acc, l) => acc + Number(l.quantidade), 0);

  return {
    totalCents,
    quantidade,
    linhas: linhas.map((l) => ({
      categoria: rotulo(l.categoria, "Sem categoria"),
      tipo: rotulo(l.tipo, "Sem tipo"),
      conta: rotulo(l.conta, "Sem conta"),
      valorCents: Number(l.valor),
      quantidade: Number(l.quantidade),
      participacaoPercent: totalCents !== 0 ? (Number(l.valor) / totalCents) * 100 : 0,
    })),
  };
}

// Os maiores títulos do período, para descer do total à linha concreta.
//
// A composição diz "de onde vem"; estes dizem "qual documento é". Sem eles a
// investigação para no meio: descobre-se que 60% da receita está em "Prestação
// de serviços" e continua sem saber que quatro milhões são um único título que
// não deveria estar ali.
export type TituloDoPeriodo = {
  id: string;
  conexaoApelido: string;
  numeroDocumento: string | null;
  parceiroNome: string | null;
  categoriaDescricao: string | null;
  tipoDocumento: string | null;
  dataVencimento: Date;
  valorDocumentoCents: number;
  liquidado: boolean;
};

export async function maioresTitulosDoPeriodo(params: {
  companyId: string;
  conexaoId?: string | null;
  periodo: Periodo;
  natureza: "PAGAR" | "RECEBER";
  limite?: number;
}): Promise<TituloDoPeriodo[]> {
  const { companyId, conexaoId, periodo, natureza, limite = 15 } = params;

  return prisma.omieTitulo.findMany({
    where: {
      companyId,
      ...(conexaoId ? { conexaoId } : {}),
      cancelado: false,
      natureza,
      dataVencimento: { gte: periodo.inicio, lte: periodo.fim },
    },
    orderBy: { valorDocumentoCents: "desc" },
    take: limite,
    // `select` explícito: esta consulta existe para caber numa tela, e trazer
    // as 38 colunas do título para exibir sete seria repetir em pequeno o
    // problema que derrubou o banco em grande.
    select: {
      id: true,
      conexaoApelido: true,
      numeroDocumento: true,
      parceiroNome: true,
      categoriaDescricao: true,
      tipoDocumento: true,
      dataVencimento: true,
      valorDocumentoCents: true,
      liquidado: true,
    },
  });
}
