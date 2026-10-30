import Link from "next/link";
import { larguraPainel } from "@/lib/ui";
import { exigirPermissao } from "../../../_dados";
import { Secao } from "../../../_componentes";
import FormAcao from "../../FormAcao";
import CamposFinanciamento from "../CamposFinanciamento";
import { salvarFinanciamento } from "../actions";

// NOVO CONTRATO OU COTA. Os veículos se ligam no detalhe, depois de gravar.

export default async function NovoFinanciamentoPage() {
  await exigirPermissao("gerir-financiamentos");
  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div>
        <Link href="/frota/financiamentos" className="text-xs text-slate-500 hover:text-slate-800">← Financiamentos e consórcios</Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Novo contrato ou cota</h1>
        <p className="mt-1 text-sm text-slate-500">Depois de gravar, ligue os veículos (com a parcela de cada um) no detalhe do contrato. As parcelas pagas passam a vir da Omie.</p>
      </div>
      <Secao titulo="Dados do contrato">
        <FormAcao acao={salvarFinanciamento} rotulo="Cadastrar" irPara="/frota/financiamentos/{id}">
          <CamposFinanciamento v={{ produto: "financiamento_bens" }} />
        </FormAcao>
      </Secao>
    </div>
  );
}
