import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { montarCsv, nomeDoArquivo } from "@/lib/controladoria/exportarCsv";
import { fmtDocumento } from "@/lib/controladoria/format";
import { exigirPermissao, resolverEscopo } from "@/app/(app)/_dados";

// CONTRATOS DA OMIE PARA O CADASTRO DA GESTÃO.
//
// O contrato operacional (número, cliente, vigência, data-base de reajuste)
// tem dono único: a gestão (ADR-009 do plano azul-gestao). A Omie já tem os
// contratos de venda, e cadastrar tudo de novo à mão é o tipo de retrabalho
// que faz o cadastro nunca ficar pronto. Esta planilha é a ponte: sai daqui
// com o CNPJ do cliente já resolvido pelo cadastro de parceiros, e entra pelo
// importador da gestão (Cadastros › Contratos › Importar). Nenhum sistema
// escreve no banco do outro.
//
// Formato fixo, uma linha de cabeçalho e nada antes dela: é lido por máquina.

const CABECALHO_CONTRATOS_OMIE = [
  "Empresa",
  "Código Omie",
  "Número",
  "Cliente",
  "CNPJ/CPF do cliente",
  "Situação",
  "Início",
  "Fim",
  "Valor mensal (R$)",
  "Periodicidade",
  "Dia de faturamento",
] as const;

export async function GET(req: NextRequest) {
  const session = await exigirPermissao("rentabilidade");
  const escopo = await resolverEscopo(session.companyId, req.nextUrl.searchParams.get("empresa") ?? undefined);
  const contratos = await prisma.omieContrato.findMany({
    where: { companyId: session.companyId, ...(escopo.conexaoId ? { conexaoId: escopo.conexaoId } : {}) },
    orderBy: [{ conexaoApelido: "asc" }, { numero: "asc" }],
  });
  const parceiros = await prisma.omieParceiro.findMany({
    where: { companyId: session.companyId, codigoOmie: { in: contratos.flatMap((c) => (c.parceiroCodigo ? [c.parceiroCodigo] : [])) } },
    select: { conexaoId: true, codigoOmie: true, documento: true, nome: true },
  });
  const parceiro = new Map(parceiros.map((p) => [`${p.conexaoId}|${p.codigoOmie}`, p]));
  const data = (d: Date | null) => (d ? `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}` : "");

  const linhas: (string | number | null)[][] = [
    [...CABECALHO_CONTRATOS_OMIE],
    ...contratos.map((c) => {
      const p = c.parceiroCodigo ? parceiro.get(`${c.conexaoId}|${c.parceiroCodigo}`) : undefined;
      return [
        c.conexaoApelido,
        c.codigoOmie,
        c.numero ?? "",
        p?.nome ?? c.parceiroNome ?? "",
        // CNPJ vai inteiro: é a chave que casa o cliente na gestão. CPF de
        // contratante pessoa física sai mascarado, como em toda a controladoria;
        // a gestão casa esse cliente pelo nome.
        p?.documento ? fmtDocumento(p.documento) : "",
        c.situacaoDescricao ?? c.situacao ?? "",
        data(c.vigenciaInicio),
        data(c.vigenciaFim),
        c.valorMensalCents / 100,
        c.periodicidade ?? "",
        c.diaFaturamento ?? "",
      ];
    }),
  ];

  return new NextResponse(montarCsv(linhas), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nomeDoArquivo("contratos-omie", escopo.apelido ?? "grupo", new Date().toISOString().slice(0, 10))}"`,
      "Cache-Control": "no-store",
    },
  });
}
