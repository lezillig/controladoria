import { prisma } from "@/lib/prisma";
import { fmtData } from "@/lib/controladoria/format";
import { larguraPainel } from "@/lib/ui";
import { exigirPermissao } from "../../_dados";
import { Secao } from "../../_componentes";
import Migracao from "./Migracao";
import MigrarMultas from "./MigrarMultas";

// MIGRAÇÃO ÚNICA DAS PLANILHAS de frota e financiamentos
// (src/lib/frota/migracaoPlanilhas.ts e migracaoNoBanco.ts).

export const maxDuration = 60;

export default async function MigracaoPage() {
  const session = await exigirPermissao("migrar-planilhas");
  const ultimas = await prisma.audLog.findMany({ where: { companyId: session.companyId, tabela: "Migracao" }, orderBy: { dataHora: "desc" }, take: 4 });
  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Migração das planilhas</h1>
        <p className="mt-1 max-w-4xl text-sm text-slate-500">
          Traz, uma única vez, o que hoje está nas planilhas CONTROLE INFORMAÇÕES GERAIS, Consórcios e Financiamentos e CONTROLE MULTAS: a frota, os vendidos, os documentos com validade, as apólices, as consultas de
          placa, os contratos de financiamento e giro e as cotas de consórcio. Depois disso o sistema é a fonte e as planilhas se aposentam. Os arquivos não ficam guardados; rodar de novo não duplica
          nada.
        </p>
      </div>
      {ultimas.length > 0 && (
        <p className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">
          Já migrado: {ultimas.map((u) => `${u.registroId} em ${fmtData(u.dataHora)} por ${u.usuario ?? "—"}`).join(" · ")}.
        </p>
      )}
      <Secao titulo="Enviar as planilhas">
        <Migracao />
      </Secao>
      <Secao titulo="A planilha de multas" descricao="Depois da frota, para as placas casarem com os veículos. Traz o processo de cada multa (condutor, termo, indicação, desconto), os pontos e as NIC.">
        <MigrarMultas />
      </Secao>
    </div>
  );
}
