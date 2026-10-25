import { prisma } from "@/lib/prisma";
import { lerMotoristas } from "@/lib/gestao/leitura";
import { auditarConta, normalizarNome, type Funcionario, type MovimentoDaConta } from "./auditoriaDeConta";

// A COLHEITA DA AUDITORIA DE UMA CONTA: o extrato da conta (OmieMovimento) e
// os pagamentos e recebimentos de títulos baixados nela (OmieBaixa), sem
// contar duas vezes o mesmo dinheiro — a baixa que gerou a linha do extrato
// (lancamentoCCCodigo) enriquece a linha, não vira outra.

export async function contasCorrentes(companyId: string) {
  const [contas, conexoes] = await Promise.all([
    prisma.omieContaCorrente.findMany({ where: { companyId }, select: { conexaoId: true, codigo: true, descricao: true, banco: true, inativa: true, conexaoApelido: true }, orderBy: [{ conexaoApelido: "asc" }, { descricao: "asc" }] }),
    prisma.omieConexao.findMany({ where: { companyId }, select: { id: true, apelido: true, papelNoGrupo: true } }),
  ]);
  const corporativas = new Set(conexoes.filter((c) => c.papelNoGrupo === "CORPORATIVO").map((c) => c.id));
  // A conta padrão: a Omie.CASH da empresa corporativa (MCZ), senão qualquer Omie.CASH.
  const ehCash = (c: (typeof contas)[number]) => /cash/i.test(`${c.descricao} ${c.banco ?? ""}`);
  const padrao = contas.find((c) => ehCash(c) && corporativas.has(c.conexaoId)) ?? contas.find(ehCash) ?? contas[0] ?? null;
  return { contas, padrao };
}

export async function auditoriaDeContaNoBanco(params: { companyId: string; conexaoId: string; contaCodigo: string; desde: Date; ate: Date }) {
  const { companyId, conexaoId, contaCodigo, desde, ate } = params;
  const [extrato, baixas, conta, conexoes, quadros, motoristas] = await Promise.all([
    prisma.omieMovimento.findMany({ where: { conexaoId, contaCorrenteCodigo: contaCodigo, data: { gte: desde, lte: ate } } }),
    prisma.omieBaixa.findMany({
      where: { conexaoId, contaCorrenteCodigo: contaCodigo, dataBaixa: { gte: desde, lte: ate }, titulo: { cancelado: false } },
      select: {
        id: true, dataBaixa: true, valorCents: true, observacao: true, lancamentoCCCodigo: true,
        titulo: { select: { id: true, natureza: true, codigoLancamento: true, numeroDocumento: true, parceiroNome: true, parceiroDocumento: true, parceiroCodigo: true, categoriaCodigo: true, categoriaDescricao: true, usuarioInclusao: true, usuarioAlteracao: true } },
      },
    }),
    prisma.omieContaCorrente.findFirst({ where: { conexaoId, codigo: contaCodigo }, select: { descricao: true, saldoInicialCents: true } }),
    prisma.omieConexao.findMany({ where: { companyId }, select: { id: true, apelido: true, cnpj: true } }),
    prisma.folhaQuadro.findMany({ where: { companyId }, orderBy: { competencia: "desc" }, select: { id: true, conexaoId: true } }),
    lerMotoristas(companyId).catch(() => []),
  ]);
  const apelido = new Map(conexoes.map((c) => [c.id, c.apelido]));

  // Os parceiros e as categorias citados.
  const codigos = [...new Set([...extrato.map((m) => m.parceiroCodigo), ...baixas.map((b) => b.titulo.parceiroCodigo)].filter((c): c is string => !!c))];
  const [parceiros, categorias, titulosDoExtrato] = await Promise.all([
    prisma.omieParceiro.findMany({ where: { conexaoId, codigoOmie: { in: codigos } }, select: { codigoOmie: true, nome: true, documento: true, primeiraVezEm: true, contaBancariaAlteradaEm: true } }),
    prisma.omieCategoria.findMany({ where: { conexaoId }, select: { codigo: true, descricao: true } }),
    prisma.omieTitulo.findMany({
      where: { conexaoId, codigoLancamento: { in: extrato.map((m) => m.tituloCodigo).filter((c): c is string => !!c) } },
      select: { id: true, codigoLancamento: true, numeroDocumento: true, parceiroNome: true, parceiroDocumento: true, categoriaCodigo: true, categoriaDescricao: true, usuarioInclusao: true, usuarioAlteracao: true },
    }),
  ]);
  const parceiro = new Map(parceiros.map((p) => [p.codigoOmie, p]));
  const categoria = new Map(categorias.map((c) => [c.codigo, c.descricao]));
  const tituloDoExtrato = new Map(titulosDoExtrato.map((t) => [t.codigoLancamento, t]));

  // As alterações dos títulos pagos, para "alterado depois de pago".
  const tituloIds = [...new Set([...baixas.map((b) => b.titulo.id), ...titulosDoExtrato.map((t) => t.id)])];
  const versoes = tituloIds.length ? await prisma.omieTituloVersao.findMany({ where: { tituloId: { in: tituloIds } }, select: { tituloId: true, campo: true, de: true, para: true, vistoEm: true } }) : [];
  const versoesDe = new Map<string, typeof versoes>();
  for (const v of versoes) versoesDe.set(v.tituloId, [...(versoesDe.get(v.tituloId) ?? []), v]);

  const baixaDoLancamento = new Map(baixas.filter((b) => b.lancamentoCCCodigo).map((b) => [b.lancamentoCCCodigo!, b]));
  const usadas = new Set<string>();
  const movimentos: MovimentoDaConta[] = [];
  for (const m of extrato) {
    const b = baixaDoLancamento.get(m.codigoLancamento);
    if (b) usadas.add(b.id);
    const t = b?.titulo ?? (m.tituloCodigo ? tituloDoExtrato.get(m.tituloCodigo) : undefined);
    const p = parceiro.get(m.parceiroCodigo ?? b?.titulo.parceiroCodigo ?? "");
    movimentos.push({
      id: m.id,
      origem: "extrato",
      data: m.data,
      valorCents: m.valorCents,
      beneficiario: m.parceiroNome ?? p?.nome ?? t?.parceiroNome ?? null,
      documento: p?.documento ?? t?.parceiroDocumento ?? null,
      categoria: (m.categoriaCodigo ? categoria.get(m.categoriaCodigo) : null) ?? t?.categoriaDescricao ?? (t?.categoriaCodigo ? categoria.get(t.categoriaCodigo) : null) ?? null,
      observacao: m.observacao ?? b?.observacao ?? null,
      tituloId: t?.id ?? null,
      tituloNumero: t?.numeroDocumento ?? m.documento ?? null,
      usuario: t?.usuarioAlteracao ?? t?.usuarioInclusao ?? null,
      parceiroPrimeiraVez: p?.primeiraVezEm ?? null,
      parceiroContaAlteradaEm: p?.contaBancariaAlteradaEm ?? null,
      alteracoesDepois: t ? (versoesDe.get(t.id) ?? []).filter((v) => v.vistoEm > m.data).map((v) => ({ campo: v.campo, de: v.de, para: v.para, em: v.vistoEm })) : [],
    });
  }
  // As baixas que não aparecem no extrato (a conta não importa extrato, ou a
  // linha não veio): entram pelo título.
  for (const b of baixas) {
    if (usadas.has(b.id)) continue;
    const t = b.titulo;
    const p = parceiro.get(t.parceiroCodigo ?? "");
    const sinal = t.natureza === "PAGAR" ? -1 : 1;
    movimentos.push({
      id: b.id,
      origem: "baixa",
      data: b.dataBaixa,
      valorCents: sinal * Math.abs(b.valorCents),
      beneficiario: t.parceiroNome ?? p?.nome ?? null,
      documento: t.parceiroDocumento ?? p?.documento ?? null,
      categoria: t.categoriaDescricao ?? (t.categoriaCodigo ? categoria.get(t.categoriaCodigo) : null) ?? null,
      observacao: b.observacao,
      tituloId: t.id,
      tituloNumero: t.numeroDocumento,
      usuario: t.usuarioAlteracao ?? t.usuarioInclusao,
      parceiroPrimeiraVez: p?.primeiraVezEm ?? null,
      parceiroContaAlteradaEm: p?.contaBancariaAlteradaEm ?? null,
      alteracoesDepois: (versoesDe.get(t.id) ?? []).filter((v) => v.vistoEm > b.dataBaixa).map((v) => ({ campo: v.campo, de: v.de, para: v.para, em: v.vistoEm })),
    });
  }

  // OS FUNCIONÁRIOS DA AZUL E DA MCZ: o cadastro da gestão (CPF e nome) e o
  // último quadro de pessoal importado de cada empresa (nome).
  const ultimoQuadro = new Map<string, string>();
  for (const q of quadros) if (!ultimoQuadro.has(q.conexaoId)) ultimoQuadro.set(q.conexaoId, q.id);
  const pessoas = ultimoQuadro.size ? await prisma.folhaPessoa.findMany({ where: { quadroId: { in: [...ultimoQuadro.values()] } }, select: { nome: true, quadroId: true } }) : [];
  const empresaDoQuadro = new Map([...ultimoQuadro.entries()].map(([cx, q]) => [q, apelido.get(cx) ?? null]));
  const funcionarios: Funcionario[] = [
    ...motoristas.map((m) => ({ nome: m.name, cpf: m.cpf ?? null, empresa: (m as { empregador?: string | null }).empregador ?? "cadastro da gestão" })),
    ...pessoas.map((p) => ({ nome: p.nome, cpf: null, empresa: empresaDoQuadro.get(p.quadroId) ?? "quadro de pessoal" })),
  ];
  const raizesDoGrupo = conexoes.map((c) => (c.cnpj ?? "").replace(/\D/g, "")).filter((d) => d.length === 14).map((d) => d.slice(0, 8));

  // O saldo no início do período: o inicial da conta mais o extrato antes dele.
  const antes = await prisma.omieMovimento.aggregate({ where: { conexaoId, contaCorrenteCodigo: contaCodigo, data: { lt: desde } }, _sum: { valorCents: true } });
  const saldoInicialCents = (conta?.saldoInicialCents ?? 0) + (antes._sum.valorCents ?? 0);

  const resultado = auditarConta({ movimentos, funcionarios, raizesDoGrupo });
  return {
    ...resultado,
    conta: conta?.descricao ?? contaCodigo,
    empresa: apelido.get(conexaoId) ?? "?",
    saldoInicialCents,
    temExtrato: extrato.length > 0,
    funcionariosConhecidos: { cadastro: motoristas.length, quadro: pessoas.length },
  };
}

// TODOS OS PAGAMENTOS A UM NOME, em todas as contas e nas duas empresas: os
// títulos a pagar do beneficiário (com as baixas: quando, quanto e de qual
// conta) e as linhas de extrato que citam o nome.
export async function pagamentosAoNome(params: { companyId: string; nome: string; desde: Date; ate: Date }) {
  const { companyId, desde, ate } = params;
  const termo = params.nome.trim();
  if (termo.length < 3) return { titulos: [], extrato: [], nomes: [] as string[] };
  const [titulos, extrato, contas] = await Promise.all([
    prisma.omieTitulo.findMany({
      where: { companyId, natureza: "PAGAR", cancelado: false, parceiroNome: { contains: termo, mode: "insensitive" }, OR: [{ dataVencimento: { gte: desde, lte: ate } }, { dataEmissao: { gte: desde, lte: ate } }] },
      orderBy: { dataVencimento: "desc" },
      take: 500,
      select: {
        id: true, conexaoApelido: true, parceiroNome: true, parceiroDocumento: true, numeroDocumento: true, categoriaDescricao: true, dataEmissao: true, dataVencimento: true,
        valorDocumentoCents: true, valorPagoCents: true, status: true, usuarioInclusao: true, observacao: true,
        baixas: { select: { dataBaixa: true, valorCents: true, contaCorrenteCodigo: true } },
      },
    }),
    prisma.omieMovimento.findMany({
      where: { companyId, parceiroNome: { contains: termo, mode: "insensitive" }, data: { gte: desde, lte: ate } },
      orderBy: { data: "desc" },
      take: 500,
      select: { id: true, conexaoApelido: true, conexaoId: true, contaCorrenteCodigo: true, data: true, valorCents: true, parceiroNome: true, documento: true, observacao: true },
    }),
    prisma.omieContaCorrente.findMany({ where: { companyId }, select: { conexaoId: true, codigo: true, descricao: true } }),
  ]);
  const nomeDaConta = new Map(contas.map((c) => [c.codigo, c.descricao]));
  return {
    titulos: titulos.map((t) => ({ ...t, contas: [...new Set(t.baixas.map((b) => nomeDaConta.get(b.contaCorrenteCodigo ?? "") ?? b.contaCorrenteCodigo ?? "?"))] })),
    extrato: extrato.map((m) => ({ ...m, conta: nomeDaConta.get(m.contaCorrenteCodigo) ?? m.contaCorrenteCodigo })),
    nomes: [...new Set([...titulos.map((t) => t.parceiroNome ?? ""), ...extrato.map((m) => m.parceiroNome ?? "")].filter(Boolean).map((n) => normalizarNome(n)))],
  };
}
