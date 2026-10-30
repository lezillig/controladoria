import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { larguraPainel } from "@/lib/ui";
import { exigirPermissao, podeAcao } from "../../_dados";
import { Secao } from "../../_componentes";
import FormAcao from "../FormAcao";
import CamposVeiculo from "../CamposVeiculo";
import { salvarVeiculo } from "../actions";

// NOVO VEÍCULO — o cadastro na entrada da frota. Depois de gravar, a ficha
// abre para completar documentos, apólice e financiamento.

export default async function NovoVeiculoPage() {
  const session = await exigirPermissao("gerir-frota");
  const veValores = await podeAcao(session, "frota-valores");
  const apolices = await prisma.frotaApolice.findMany({ where: { companyId: session.companyId, ativo: true }, select: { id: true, descricao: true }, orderBy: { descricao: "asc" } });
  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div>
        <Link href="/frota" className="text-xs text-slate-500 hover:text-slate-800">← Frota</Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Novo veículo</h1>
        <p className="mt-1 text-sm text-slate-500">Placa ou, no veículo ainda não emplacado, o chassi. Depois de gravar, a ficha abre para lançar documentos, apólice e financiamento.</p>
      </div>
      <Secao titulo="Ficha do veículo">
        <FormAcao acao={salvarVeiculo} rotulo="Cadastrar veículo" irPara="/frota/{id}">
          <CamposVeiculo v={{ tipo: "van", vidaUtilMeses: 60 }} apolices={apolices} comValores={veValores} />
        </FormAcao>
      </Secao>
    </div>
  );
}
