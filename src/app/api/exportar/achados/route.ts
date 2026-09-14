import { NextRequest, NextResponse } from "next/server";
import type { AuditCategoria, AuditSeveridade, AuditStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { cabecalhoDeContexto, montarCsv, nomeDoArquivo } from "@/lib/controladoria/exportarCsv";
import { exigirPermissao } from "@/app/(app)/_dados";

// A LISTA DE TRIAGEM, PARA QUEM NÃO FAZ LOGIN.
//
// O RH recebe os pagamentos por fora, o jurídico recebe o acordo do motorista
// ativo, o financeiro recebe as retenções a registrar. Nenhum deles vai abrir
// o sistema; todos abrem planilha. Exporta exatamente o recorte que está na
// tela (mesmos filtros da URL), com responsável e prazo, para virar a lista
// de trabalho de cada área — e voltar preenchida.
//
// A evidência NÃO vai: é JSON livre, com nomes e valores de terceiros, e a
// planilha circula por e-mail. Quem precisa da evidência abre o achado.

const SEVERIDADES: AuditSeveridade[] = ["CRITICA", "ALTA", "MEDIA", "BAIXA", "INFO"];
const CATEGORIAS: AuditCategoria[] = ["FRAUDE", "ERRO_PROCESSO", "PERDA_FINANCEIRA", "RISCO_FINANCEIRO", "CONFORMIDADE", "OPORTUNIDADE"];
const STATUS: AuditStatus[] = ["ABERTO", "EM_ANALISE", "RESOLVIDO", "IGNORADO", "OBSOLETO"];
const LIMITE = 5000;

export async function GET(req: NextRequest) {
  const session = await exigirPermissao("auditoria");
  const q = req.nextUrl.searchParams;

  const statusParam = q.get("status") ?? "ABERTOS";
  const severidade = q.get("severidade");
  const categoria = q.get("categoria");
  const regra = q.get("regra");
  const agente = q.get("agente");

  const where: Prisma.AuditFindingWhereInput = {
    companyId: session.companyId,
    ...(statusParam === "ABERTOS"
      ? { status: { in: ["ABERTO", "EM_ANALISE"] } }
      : statusParam === "TODOS"
        ? {}
        : STATUS.includes(statusParam as AuditStatus)
          ? { status: statusParam as AuditStatus }
          : { status: { in: ["ABERTO", "EM_ANALISE"] } }),
    ...(SEVERIDADES.includes(severidade as AuditSeveridade) ? { severidade: severidade as AuditSeveridade } : {}),
    ...(CATEGORIAS.includes(categoria as AuditCategoria) ? { categoria: categoria as AuditCategoria } : {}),
    ...(regra ? { regra } : {}),
    ...(agente ? { agente } : {}),
  };

  const achados = await prisma.auditFinding.findMany({
    where,
    orderBy: [{ severidade: "asc" }, { impactoCents: "desc" }, { detectadoEm: "desc" }],
    take: LIMITE,
    select: {
      id: true,
      conexaoApelido: true,
      severidade: true,
      categoria: true,
      regra: true,
      agente: true,
      status: true,
      titulo: true,
      descricao: true,
      recomendacao: true,
      valorCents: true,
      impactoCents: true,
      entidadeRef: true,
      detectadoEm: true,
      ocorrencias: true,
      confianca: true,
      responsavel: true,
      prazo: true,
      observacaoTratativa: true,
    },
  });

  const dataBr = (d: Date | null) =>
    d ? `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}` : null;

  const recorte = [
    statusParam === "ABERTOS" ? "em aberto" : statusParam.toLowerCase(),
    regra ? `regra ${regra}` : null,
    categoria ?? null,
    severidade ?? null,
  ]
    .filter(Boolean)
    .join(", ");

  const linhas: (string | number | null)[][] = [
    ...cabecalhoDeContexto({
      titulo: "Achados da auditoria — lista de triagem",
      empresa: "Grupo",
      competencia: recorte || "todos",
      criterio:
        "Mesmo recorte da tela de auditoria. Sem a evidência (abrir o achado no sistema). Preencher Responsável, Prazo e Tratativa e devolver.",
      geradoEm: new Date(),
    }),
    [
      "Id",
      "Empresa",
      "Severidade",
      "Categoria",
      "Regra",
      "Situação",
      "Título",
      "Descrição",
      "O que fazer",
      "Valor (R$)",
      "Impacto (R$)",
      "Entidade",
      "Detectado em",
      "Execuções",
      "Confiança (%)",
      "Responsável",
      "Prazo",
      "Tratativa",
    ],
  ];

  for (const a of achados) {
    linhas.push([
      a.id,
      a.conexaoApelido,
      a.severidade,
      a.categoria,
      a.regra,
      a.status,
      a.titulo,
      a.descricao,
      a.recomendacao,
      a.valorCents === null ? null : a.valorCents / 100,
      a.impactoCents === null ? null : a.impactoCents / 100,
      a.entidadeRef,
      dataBr(a.detectadoEm),
      a.ocorrencias,
      a.confianca,
      a.responsavel,
      dataBr(a.prazo),
      a.observacaoTratativa,
    ]);
  }

  if (achados.length === LIMITE) {
    linhas.push([]);
    linhas.push(["", `ATENÇÃO: lista cortada em ${LIMITE} linhas. Filtre por regra ou categoria para exportar o restante.`]);
  }

  return new NextResponse(montarCsv(linhas), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nomeDoArquivo("achados", regra ?? categoria ?? "todos", statusParam)}"`,
      "Cache-Control": "no-store",
    },
  });
}
