import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { cadeiaSugerida, ehTipoFipe, ROTULO_TIPO_FIPE, tipoFipeDoVeiculo } from "@/lib/frota/fipe";
import { veiculosIguais } from "@/lib/frota/frotaNoBanco";
import { ROTULO_TIPO_VEICULO } from "@/lib/cadastro/fichaVeiculo";
import { fmtBRL, fmtData } from "@/lib/controladoria/format";
import { larguraPainel } from "@/lib/ui";
import { exigirPermissao, podeAcao } from "../../../_dados";
import { Secao } from "../../../_componentes";
import EscolherFipe from "./EscolherFipe";
import TirarFipe from "./TirarFipe";

// ESCOLHER O MODELO NA FIPE — uma vez por veículo (ou por grupo de veículos
// iguais); daí em diante o agente relê o valor todo mês pelo código.

export const maxDuration = 60;

export default async function FipeDoVeiculoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ iguais?: string; voltar?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const session = await exigirPermissao("frota-valores");
  const podeEditar = await podeAcao(session, "gerir-frota");
  const v = await prisma.cadVeiculo.findFirst({ where: { id, companyId: session.companyId } });
  if (!v) notFound();
  const iguais = (await veiculosIguais(session.companyId, v)).filter((x) => x.fipeCodigo === null);
  const voltarPara = sp.voltar === "fipe" ? "/frota/fipe" : `/frota/${v.id}?aba=valor`;
  const nome = v.placa ?? `chassi …${(v.chassi ?? "").slice(-6)}`;
  const tipoInicial = ehTipoFipe(v.fipeTipo) ? v.fipeTipo : tipoFipeDoVeiculo(v.tipo);
  const inicial = podeEditar ? await cadeiaSugerida(tipoInicial, v) : null;

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div>
        <Link href={voltarPara} className="text-xs text-slate-500 hover:text-slate-800">
          ← {sp.voltar === "fipe" ? "Valor de mercado da frota" : `Ficha do ${nome}`}
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Tabela FIPE · {nome}</h1>
        <p className="mt-1 text-sm text-slate-500">
          No cadastro: {ROTULO_TIPO_VEICULO[v.tipo] ?? v.tipo} {[v.marca, v.modelo].filter(Boolean).join(" ") || "sem marca/modelo"}
          {v.anoFab || v.anoMod ? ` · ${v.anoFab ?? "?"}/${v.anoMod ?? "?"}` : ""}
          {v.adaptacao ? ` · ${v.adaptacao}` : ""}
        </p>
      </div>

      {v.fipeCodigo && (
        <Secao titulo="Modelo escolhido" descricao="O valor é relido todo mês pelo código, quando a FIPE publica a tabela nova.">
          <div className="flex flex-wrap items-end justify-between gap-3 text-sm">
            <div>
              <p className="text-lg font-semibold text-slate-900">{v.fipeValorCents !== null ? fmtBRL(Number(v.fipeValorCents)) : "—"}</p>
              <p className="text-slate-700">{v.fipeModelo}</p>
              <p className="text-xs text-slate-500">
                código {v.fipeCodigo} · referência {v.fipeReferencia ?? "—"} · consultado em {fmtData(v.fipeConsultadoEm)}
              </p>
            </div>
            {podeEditar && <TirarFipe veiculoId={v.id} />}
          </div>
        </Secao>
      )}

      {podeEditar && inicial ? (
        <Secao
          titulo={v.fipeCodigo ? "Trocar o modelo" : "Escolher o modelo"}
          descricao="A sugestão vem do cadastro; confira a versão (van/furgão, teto, executivo/escolar). Se a FIPE não tem o veículo como ele é (carroceria escolar adaptada, unidade móvel), use o preço ajustado na ficha — ele prevalece sobre a FIPE."
        >
          <EscolherFipe
            veiculoId={v.id}
            tipoInicial={tipoInicial}
            inicial={inicial}
            rotulosTipo={ROTULO_TIPO_FIPE}
            iguais={iguais.length}
            aplicarIguaisInicial={sp.iguais === "1" || !v.fipeCodigo}
            voltarPara={voltarPara}
          />
        </Secao>
      ) : (
        <p className="text-sm text-slate-500">Escolher o modelo exige a permissão de gerir a frota.</p>
      )}
    </div>
  );
}
