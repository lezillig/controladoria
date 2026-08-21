import { prisma } from "@/lib/prisma";
import { fmtBRL } from "./format";

// SAÚDE DA BASE, MEDIDA NO BANCO.
//
// Mesma informação que `volumeEspelhado` e `coberturaDeCampos` produzem a
// partir do contexto de auditoria — mas contada com COUNT e SUM, sem trazer as
// linhas para a memória da função.
//
// A diferença não é de estilo. O contexto de auditoria carrega todos os
// títulos, baixas, notas, parceiros, categorias e contas correntes, com as
// linhas inteiras, porque os agentes precisam mesmo cruzar registro a registro.
// A tela de sincronização não precisa: ela só mostra contagens e percentuais.
//
// Montar aquele contexto para exibir contagem custava cerca de vinte megabytes
// por carregamento de página — e a tela se atualiza sozinha a cada quinze
// segundos enquanto a carga anda. Oitenta megabytes por minuto, quase cinco
// gigabytes por hora: foi isso, e não a carga da Omie, que esgotou a franquia
// de transferência do banco e derrubou junto o sistema de gestão que divide o
// mesmo Postgres.
//
// Aqui a mesma tela custa alguns kilobytes: o que trafega é o resultado da
// contagem, não os registros contados.

export type VolumeEspelhado = {
  titulosPagar: number;
  titulosReceber: number;
  valorPagar: string;
  valorReceber: string;
  baixas: number;
  movimentos: number;
  notas: number;
  parceiros: number;
};

export async function volumeEspelhadoNoBanco(companyId: string): Promise<VolumeEspelhado> {
  const [pagar, receber, baixas, movimentos, notas, parceiros] = await Promise.all([
    prisma.omieTitulo.aggregate({
      where: { companyId, natureza: "PAGAR" },
      _count: { _all: true },
      _sum: { valorDocumentoCents: true },
    }),
    prisma.omieTitulo.aggregate({
      where: { companyId, natureza: "RECEBER" },
      _count: { _all: true },
      _sum: { valorDocumentoCents: true },
    }),
    prisma.omieBaixa.count({ where: { companyId } }),
    prisma.omieMovimento.count({ where: { companyId } }),
    prisma.omieNota.count({ where: { companyId } }),
    prisma.omieParceiro.count({ where: { companyId } }),
  ]);

  return {
    titulosPagar: pagar._count._all,
    titulosReceber: receber._count._all,
    valorPagar: fmtBRL(pagar._sum.valorDocumentoCents ?? 0),
    valorReceber: fmtBRL(receber._sum.valorDocumentoCents ?? 0),
    baixas,
    movimentos,
    notas,
    parceiros,
  };
}

export type CoberturaEntidade = {
  entidade: string;
  total: number;
  campos: { nome: string; preenchidoPercent: number }[];
};

// Cada campo vira um COUNT com filtro de "não nulo".
//
// São poucas consultas e todas resolvidas por índice ou varredura de contagem,
// que devolve um número — nunca o conteúdo das linhas.
export async function coberturaDeCamposNoBanco(companyId: string): Promise<CoberturaEntidade[]> {
  const pct = (quantos: number, total: number) => (total > 0 ? (quantos / total) * 100 : 0);

  const [
    titulos,
    tCategoria,
    tCentro,
    tDocumento,
    tParceiro,
    tEmissao,
    movimentos,
    mCategoria,
    mConciliado,
    mTitulo,
    parceiros,
    pDocumento,
    pEmail,
    notas,
    nImpostos,
    nParceiro,
  ] = await Promise.all([
    prisma.omieTitulo.count({ where: { companyId } }),
    prisma.omieTitulo.count({ where: { companyId, categoriaCodigo: { not: null } } }),
    prisma.omieTitulo.count({
      where: { companyId, OR: [{ departamentoCodigo: { not: null } }, { projetoCodigo: { not: null } }] },
    }),
    prisma.omieTitulo.count({ where: { companyId, numeroDocumento: { not: null } } }),
    prisma.omieTitulo.count({ where: { companyId, parceiroCodigo: { not: null } } }),
    prisma.omieTitulo.count({ where: { companyId, dataEmissao: { not: null } } }),

    prisma.omieMovimento.count({ where: { companyId } }),
    prisma.omieMovimento.count({ where: { companyId, categoriaCodigo: { not: null } } }),
    prisma.omieMovimento.count({ where: { companyId, conciliado: true } }),
    prisma.omieMovimento.count({ where: { companyId, tituloCodigo: { not: null } } }),

    prisma.omieParceiro.count({ where: { companyId } }),
    prisma.omieParceiro.count({ where: { companyId, documento: { not: null } } }),
    prisma.omieParceiro.count({ where: { companyId, email: { not: null } } }),

    prisma.omieNota.count({ where: { companyId } }),
    prisma.omieNota.count({
      where: { companyId, OR: [{ valorIssCents: { not: null } }, { valorPisCents: { not: null } }] },
    }),
    prisma.omieNota.count({ where: { companyId, parceiroCodigo: { not: null } } }),
  ]);

  return [
    {
      entidade: "Títulos",
      total: titulos,
      campos: [
        { nome: "categoria", preenchidoPercent: pct(tCategoria, titulos) },
        { nome: "centro de custo", preenchidoPercent: pct(tCentro, titulos) },
        { nome: "documento", preenchidoPercent: pct(tDocumento, titulos) },
        { nome: "fornecedor/cliente", preenchidoPercent: pct(tParceiro, titulos) },
        { nome: "data de emissão", preenchidoPercent: pct(tEmissao, titulos) },
      ],
    },
    {
      entidade: "Movimentos bancários",
      total: movimentos,
      campos: [
        { nome: "categoria", preenchidoPercent: pct(mCategoria, movimentos) },
        { nome: "conciliado", preenchidoPercent: pct(mConciliado, movimentos) },
        { nome: "título de origem", preenchidoPercent: pct(mTitulo, movimentos) },
      ],
    },
    {
      entidade: "Parceiros",
      total: parceiros,
      campos: [
        { nome: "documento", preenchidoPercent: pct(pDocumento, parceiros) },
        { nome: "e-mail", preenchidoPercent: pct(pEmail, parceiros) },
      ],
    },
    {
      entidade: "Notas fiscais",
      total: notas,
      campos: [
        { nome: "impostos destacados", preenchidoPercent: pct(nImpostos, notas) },
        { nome: "parceiro", preenchidoPercent: pct(nParceiro, notas) },
      ],
    },
  ];
}
