import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { EM_OPERACAO } from "@/lib/frota/controles";
import { chaveDoGrupoFipe, listarFrota } from "@/lib/frota/frotaNoBanco";
import { ROTULO_TIPO_VEICULO } from "@/lib/cadastro/fichaVeiculo";
import { fmtBRL, fmtNumero } from "@/lib/controladoria/format";
import { larguraPainel } from "@/lib/ui";
import { exigirPermissao, podeAcao } from "../../_dados";
import { Kpi, Secao, Tabela } from "../../_componentes";
import { NomeVeiculo } from "../_frota";

// VALOR DE MERCADO DA FROTA — quanto a frota em operação vale (preço ajustado
// ou FIPE) contra o que ainda se deve nela. A FIPE se escolhe por grupo de
// veículos iguais (mesmo tipo, marca, modelo e ano-modelo): uma escolha vale
// para o grupo inteiro.

export const maxDuration = 60;

export default async function ValorDeMercadoPage() {
  const session = await exigirPermissao("frota-valores");
  const podeEditar = await podeAcao(session, "gerir-frota");
  const hoje = new Date();
  const [{ linhas }, fipes] = await Promise.all([
    listarFrota(session.companyId, hoje),
    prisma.cadVeiculo.findMany({ where: { companyId: session.companyId, status: { in: EM_OPERACAO } }, select: { id: true, fipeCodigo: true, fipeValorCents: true, fipeReferencia: true, valorAjustadoCents: true } }),
  ]);
  const fipePorId = new Map(fipes.map((f) => [f.id, f]));
  const frota = linhas.filter((l) => EM_OPERACAO.includes(l.status));
  const comValor = frota.filter((l) => l.mercadoCents !== null);
  const mercado = comValor.reduce((s, l) => s + (l.mercadoCents ?? 0), 0);
  const saldoTotal = frota.reduce((s, l) => s + (l.saldo?.saldoCents ?? 0), 0);
  const saldoComValor = comValor.reduce((s, l) => s + (l.saldo?.saldoCents ?? 0), 0);
  const referencias = new Map<string, number>();
  for (const f of fipes) if (f.fipeReferencia) referencias.set(f.fipeReferencia, (referencias.get(f.fipeReferencia) ?? 0) + 1);
  const referencia = [...referencias.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  type Grupo = { chave: string; rotulo: string; veiculos: typeof frota };
  const grupos = new Map<string, Grupo>();
  for (const l of frota) {
    const completo = l.marca && l.modelo && l.anoMod;
    const chave = completo ? chaveDoGrupoFipe(l) : `so:${l.id}`;
    const g = grupos.get(chave) ?? { chave, rotulo: `${ROTULO_TIPO_VEICULO[l.tipo] ?? l.tipo} ${[l.marca, l.modelo].filter(Boolean).join(" ") || "sem marca/modelo"}${l.anoMod ? ` ${l.anoMod}` : ""}`, veiculos: [] };
    g.veiculos.push(l);
    grupos.set(chave, g);
  }
  const linhasGrupo = [...grupos.values()]
    .map((g) => {
      const semFipe = g.veiculos.filter((v) => !fipePorId.get(v.id)?.fipeCodigo);
      const ajustados = g.veiculos.filter((v) => fipePorId.get(v.id)?.valorAjustadoCents !== null && fipePorId.get(v.id)?.valorAjustadoCents !== undefined);
      const valores = [...new Set(g.veiculos.map((v) => fipePorId.get(v.id)?.fipeValorCents).filter((x): x is bigint => x !== null && x !== undefined).map(Number))];
      return { ...g, semFipe, ajustados, valores, saldo: g.veiculos.reduce((s, v) => s + (v.saldo?.saldoCents ?? 0), 0) };
    })
    .sort((a, b) => Number(b.semFipe.length > 0) - Number(a.semFipe.length > 0) || b.veiculos.length - a.veiculos.length || a.rotulo.localeCompare(b.rotulo, "pt-BR"));
  const semValor = frota.length - comValor.length;
  const pendentesFipe = linhasGrupo.filter((g) => g.semFipe.length > 0 && g.ajustados.length < g.veiculos.length);
  const afundados = comValor.filter((l) => (l.saldo?.saldoCents ?? 0) > (l.mercadoCents ?? 0)).sort((a, b) => (b.saldo?.saldoCents ?? 0) - (b.mercadoCents ?? 0) - ((a.saldo?.saldoCents ?? 0) - (a.mercadoCents ?? 0)));

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div>
        <Link href="/frota" className="text-xs text-slate-500 hover:text-slate-800">← Frota</Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Valor de mercado</h1>
        <p className="mt-1 max-w-4xl text-sm text-slate-500">
          Quanto vale a frota em operação (o preço ajustado, quando há, ou a Tabela FIPE) contra o saldo devedor dos financiamentos e consórcios. A FIPE é relida todo mês pelo agente da frota.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi rotulo="Valor de mercado" valor={fmtBRL(mercado)} apoio={`${fmtNumero(comValor.length)} de ${fmtNumero(frota.length)} veículos com valor`} />
        <Kpi rotulo="Saldo devedor da frota" valor={fmtBRL(saldoTotal)} apoio="para quitação, hoje" />
        <Kpi rotulo="Valor líquido" valor={fmtBRL(mercado - saldoComValor)} apoio="mercado − saldo, dos veículos com valor" tom={mercado - saldoComValor < 0 ? "ruim" : "neutro"} />
        <Kpi rotulo="Sem valor de mercado" valor={fmtNumero(semValor)} apoio={`${fmtNumero(pendentesFipe.length)} grupo(s) para escolher na FIPE`} tom={semValor ? "atencao" : "bom"} />
        <Kpi rotulo="Saldo acima do valor" valor={fmtNumero(afundados.length)} apoio={afundados.length ? `diferença ${fmtBRL(afundados.reduce((s, l) => s + (l.saldo?.saldoCents ?? 0) - (l.mercadoCents ?? 0), 0))}` : "nenhum veículo"} tom={afundados.length ? "atencao" : "bom"} />
      </div>

      <Secao titulo="Grupos de veículos iguais" descricao={`Mesmo tipo, marca, modelo e ano-modelo no cadastro. Escolha o modelo da FIPE uma vez e ele vale para o grupo.${referencia ? ` Referência FIPE gravada: ${referencia}.` : ""}`}>
        <Tabela
          colunas={["Grupo", "Veículos", "Sem FIPE", "Com preço ajustado", "FIPE (unitário)", "Saldo devedor do grupo", ""]}
          alinharDireita={[1, 2, 3, 4, 5]}
          linhas={linhasGrupo.map((g) => [
            g.veiculos.length === 1 ? (
              <span key="r" className="flex items-center gap-2">
                <NomeVeiculo v={g.veiculos[0]} /> <span className="text-slate-600">{g.rotulo}</span>
              </span>
            ) : (
              g.rotulo
            ),
            fmtNumero(g.veiculos.length),
            g.semFipe.length ? <span key="s" className="font-semibold text-amber-700">{fmtNumero(g.semFipe.length)}</span> : "—",
            g.ajustados.length ? fmtNumero(g.ajustados.length) : "—",
            g.valores.length === 0 ? "—" : g.valores.length === 1 ? fmtBRL(g.valores[0]) : `${fmtBRL(Math.min(...g.valores))} a ${fmtBRL(Math.max(...g.valores))}`,
            g.saldo ? fmtBRL(g.saldo) : "—",
            podeEditar ? (
              <Link key="e" href={`/frota/${(g.semFipe[0] ?? g.veiculos[0]).id}/fipe?iguais=1&voltar=fipe`} className={g.semFipe.length ? "inline-block whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs font-semibold text-white hover:bg-slate-700" : "whitespace-nowrap text-xs text-blue-800 hover:underline"}>
                {g.semFipe.length ? "Escolher na FIPE" : "Conferir"}
              </Link>
            ) : null,
          ])}
          vazio="Nenhum veículo em operação."
        />
      </Secao>

      <Secao titulo="Saldo devedor acima do valor de mercado" descricao="Veículos que, vendidos hoje, não quitariam o próprio financiamento — atenção antes de vender ou dar baixa.">
        <Tabela
          colunas={["Placa", "Veículo", "Valor de mercado", "Saldo devedor", "Diferença", "Contratos"]}
          alinharDireita={[2, 3, 4]}
          linhas={afundados.map((l) => [
            <NomeVeiculo key="p" v={l} />,
            [l.marca, l.modelo, l.anoMod].filter(Boolean).join(" ") || "—",
            fmtBRL(l.mercadoCents ?? 0),
            fmtBRL(l.saldo?.saldoCents ?? 0),
            <span key="d" className="font-semibold text-red-700">{fmtBRL((l.saldo?.saldoCents ?? 0) - (l.mercadoCents ?? 0))}</span>,
            l.saldo?.instituicoes.join(", ") ?? "—",
          ])}
          vazio="Nenhum veículo com saldo acima do valor (dos que têm valor de mercado)."
        />
      </Secao>
    </div>
  );
}
