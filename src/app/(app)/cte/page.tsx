import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "../_dados";
import ConferenciaForm from "./ConferenciaForm";
import { larguraPainel } from "@/lib/ui";

// CONFERÊNCIA DE CT-e — a única entrada de dado desta tela é a lista colada.
//
// A Omie não expõe listagem de CT-e emitido pela API. Enquanto não expuser, o
// documento fiscal do frete é o único que o espelho não alcança sozinho: os
// títulos vêm, o CT-e que os justifica não. É por isso que a conferência
// depende de alguém colar a relação — e é exatamente por isso que ela precisa
// existir como tela, e não como favor pontual.
//
// O que ela achou na primeira rodada, em cem CT-e de abril a agosto de 2026:
// cinco cancelados com título vivo (R$ 164.661,33), quatro emitidos e nunca
// cobrados (R$ 11.950,00) e uma cobrança R$ 7.617,65 acima do documento
// reemitido. Nada disso aparecia em nenhum relatório.

export default async function CtePage() {
  const session = await exigirPermissao("cte");

  const conexoes = await prisma.omieConexao.findMany({
    where: { companyId: session.companyId, ativa: true },
    orderBy: { ordem: "asc" },
    select: { id: true, apelido: true, nome: true },
  });

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Conferência de CT-e</h1>
        <p className="mt-1 text-sm text-slate-500">
          Cruza a relação de CT-e emitidos na Omie com os títulos espelhados aqui, e aponta os dois lados: documento
          cancelado que continuou sendo cobrado, frete emitido que nunca virou fatura e valor cobrado diferente do
          documento.
        </p>
      </div>

      <ConferenciaForm conexoes={conexoes} />

      <p className="text-xs text-slate-500">
        &quot;Título sem CT-e na lista&quot; só faz sentido se a relação colada estiver completa para o período. Se você
        colou apenas parte do mês, os títulos do resto do mês aparecem aqui — e não são erro.
      </p>
    </div>
  );
}
