import { NextResponse } from "next/server";
import { exigirPermissao } from "@/app/(app)/_dados";
import { prisma } from "@/lib/prisma";
import { dataReferenciaPadrao } from "@/lib/controladoria/ciclo";
import { baseVigente } from "@/lib/simulador/baseDeCustos";
import { carregarDreDosMeses } from "@/lib/simulador/custosReais";
import { planilhaDosIndiretos } from "@/lib/simulador/exportarIndiretos";
import { baseComIndiretosDoDre, folhaDaOficina, fornecedorDaContabilidade, indiretosDoDre, pagamentosDoFornecedor } from "@/lib/simulador/indiretosDoDre";
import { premissasDaBase } from "@/lib/simulador/premissas";

// A COMPOSIÇÃO DA ADMINISTRAÇÃO CENTRAL em Excel: os mesmos números com que o
// estudo novo abre (DRE dos doze meses fechados, pagamentos à contabilidade,
// folha da oficina), por categoria e mês. Só leitura.

export const runtime = "nodejs";

export async function GET() {
  const session = await exigirPermissao("simulador");
  const referencia = dataReferenciaPadrao();
  const [base, dre, conexoes] = await Promise.all([
    baseVigente(session.companyId),
    carregarDreDosMeses(session.companyId, null, referencia),
    prisma.omieConexao.findMany({ where: { companyId: session.companyId, ativa: true }, orderBy: { ordem: "asc" }, select: { apelido: true } }),
  ]);
  const [fornecedor, oficina] = await Promise.all([
    pagamentosDoFornecedor(session.companyId, fornecedorDaContabilidade(base), referencia, dre.meses),
    folhaDaOficina(session.companyId, referencia, dre),
  ]);
  const doDre = indiretosDoDre(dre, fornecedor, oficina);
  const { premissas } = premissasDaBase(baseComIndiretosDoDre(base, doDre), { clientePublico: false, escolar: false, baseLocal: false });
  const conteudo = await planilhaDosIndiretos({ dre, fornecedor, oficina, doDre, base, premissas, empresa: conexoes.length ? `Grupo ${conexoes.map((c) => c.apelido).join(" + ")}` : "Grupo", geradoEm: new Date() });
  return new NextResponse(new Uint8Array(conteudo), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="Composicao_administracao_central.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
