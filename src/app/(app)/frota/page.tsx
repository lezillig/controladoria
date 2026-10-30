import Link from "next/link";
import { listarFrota } from "@/lib/frota/frotaNoBanco";
import { EM_OPERACAO } from "@/lib/frota/controles";
import { ROTULO_STATUS_VEICULO, ROTULO_TIPO_VEICULO, ROTULO_USO } from "@/lib/cadastro/fichaVeiculo";
import { fmtBRL, fmtNumero } from "@/lib/controladoria/format";
import { larguraPainel } from "@/lib/ui";
import { exigirPermissao, podeAcao } from "../_dados";
import { Kpi, Secao, Tabela } from "../_componentes";
import { NomeVeiculo, SeloAlerta, SeloCobertura, SeloStatus } from "./_frota";

// FROTA — a lista dos veículos com o que pede atenção primeiro (documento
// vencido, sem apólice), e a porta para a ficha de cada um. Substitui a aba
// FROTA ATIVA da planilha CONTROLE INFORMAÇÕES GERAIS.

export const maxDuration = 60;

const FILTROS = [
  { chave: "operacao", rotulo: "Em operação" },
  { chave: "atencao", rotulo: "Pedem atenção" },
  { chave: "vendidos", rotulo: "Vendidos e baixados" },
  { chave: "todos", rotulo: "Todos" },
] as const;

export default async function FrotaPage({ searchParams }: { searchParams: Promise<{ ver?: string; q?: string; uso?: string; tipo?: string }> }) {
  const params = await searchParams;
  const session = await exigirPermissao("frota");
  const [podeEditar, veValores, podeMigrar] = await Promise.all([podeAcao(session, "gerir-frota"), podeAcao(session, "frota-valores"), podeAcao(session, "migrar-planilhas")]);
  const hoje = new Date();
  const { linhas } = await listarFrota(session.companyId, hoje);
  const ver = FILTROS.find((f) => f.chave === params.ver)?.chave ?? "operacao";
  const q = (params.q ?? "").trim().toUpperCase();
  const emOperacao = linhas.filter((v) => EM_OPERACAO.includes(v.status));
  const atencao = (v: (typeof linhas)[number]) => v.vencidos > 0 || ["sem_apolice", "vencida", "segmento_incompativel", "sem_vencimento"].includes(v.cobertura);
  const lista = linhas
    .filter((v) => (ver === "operacao" ? EM_OPERACAO.includes(v.status) : ver === "atencao" ? EM_OPERACAO.includes(v.status) && atencao(v) : ver === "vendidos" ? !EM_OPERACAO.includes(v.status) : true))
    .filter((v) => !params.uso || v.categoriaUso === params.uso)
    .filter((v) => !params.tipo || v.tipo === params.tipo)
    .filter((v) => !q || [v.placa, v.chassi, v.prefixo, v.modelo, v.marca, v.alocacao].some((x) => (x ?? "").toUpperCase().includes(q)));
  const saldoTotal = emOperacao.reduce((s, v) => s + (v.saldo?.saldoCents ?? 0), 0);
  const mercado = emOperacao.reduce((s, v) => s + (v.mercadoCents ?? 0), 0);
  const href = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const todos = { ver, q: params.q, uso: params.uso, tipo: params.tipo, ...extra };
    for (const [k, v] of Object.entries(todos)) if (v) p.set(k, v);
    return `/frota?${p}`;
  };

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Frota</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">Os veículos, o que vence e o que está sem cobertura. Clique na placa para abrir a ficha completa.</p>
        </div>
        <div className="flex gap-2">
          {podeEditar && (
            <Link href="/frota/novo" className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700">
              Novo veículo
            </Link>
          )}
          <Link href="/frota/vencimentos" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            Vencimentos e apólices
          </Link>
        </div>
      </div>

      {linhas.length === 0 ? (
        <Secao titulo="Nenhum veículo ainda">
          <p className="text-sm text-slate-600">
            {podeMigrar ? (
              <>
                Comece pela <Link href="/frota/migracao" className="font-semibold text-blue-800 underline">migração das planilhas</Link>: ela traz a frota, os documentos, as apólices e os financiamentos de uma vez.
              </>
            ) : (
              "A frota ainda não foi carregada. Peça a quem administra o sistema para fazer a migração das planilhas."
            )}
          </p>
        </Secao>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi rotulo="Em operação" valor={fmtNumero(emOperacao.length)} apoio={`${fmtNumero(linhas.length - emOperacao.length)} vendido(s) ou baixado(s)`} />
            <Kpi rotulo="Com documento vencido" valor={fmtNumero(emOperacao.filter((v) => v.vencidos > 0).length)} tom={emOperacao.some((v) => v.vencidos > 0) ? "ruim" : "bom"} apoio={`${fmtNumero(emOperacao.filter((v) => v.aVencer30 > 0).length)} com vencimento em 30 dias`} />
            <Kpi rotulo="Sem apólice ativa" valor={fmtNumero(emOperacao.filter((v) => ["sem_apolice", "vencida"].includes(v.cobertura)).length)} tom={emOperacao.some((v) => ["sem_apolice", "vencida"].includes(v.cobertura)) ? "ruim" : "bom"} apoio={`${fmtNumero(emOperacao.filter((v) => v.cobertura === "vence_em_breve").length)} vencendo em 45 dias`} />
            <Kpi rotulo="Alienados" valor={fmtNumero(emOperacao.filter((v) => v.alienado).length)} apoio="em garantia de financiamento" />
            {veValores && <Kpi rotulo="Saldo devedor da frota" valor={fmtBRL(saldoTotal)} apoio="atualizado pelos pagamentos na Omie" />}
            {veValores && <Kpi rotulo="Valor de mercado" valor={mercado ? fmtBRL(mercado) : "—"} apoio={mercado ? "FIPE ou preço ajustado" : "FIPE ainda não consultada"} />}
          </div>

          <Secao
            titulo={`${fmtNumero(lista.length)} veículo(s)`}
            acao={
              <form action="/frota" className="flex flex-wrap gap-2 text-xs">
                <input type="hidden" name="ver" value={ver} />
                <input name="q" defaultValue={params.q ?? ""} placeholder="Placa, modelo, contrato…" className="rounded-md border border-slate-300 px-2 py-1" />
                <select name="uso" defaultValue={params.uso ?? ""} className="rounded-md border border-slate-300 px-2 py-1">
                  <option value="">todos os usos</option>
                  {Object.entries(ROTULO_USO).map(([k, r]) => <option key={k} value={k}>{r}</option>)}
                </select>
                <select name="tipo" defaultValue={params.tipo ?? ""} className="rounded-md border border-slate-300 px-2 py-1">
                  <option value="">todos os tipos</option>
                  {Object.entries(ROTULO_TIPO_VEICULO).map(([k, r]) => <option key={k} value={k}>{r}</option>)}
                </select>
                <button className="rounded-md bg-slate-900 px-2 py-1 font-semibold text-white">Filtrar</button>
              </form>
            }
          >
            <div className="mb-3 flex flex-wrap gap-1.5">
              {FILTROS.map((f) => (
                <Link key={f.chave} href={href({ ver: f.chave })} className={`rounded-full px-3 py-1 text-xs font-medium ${f.chave === ver ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                  {f.rotulo}
                </Link>
              ))}
            </div>
            <Tabela
              colunas={["Placa", "Prefixo", "Veículo", "Tipo", "Uso", "Contrato / alocação", "Documentos", "Apólice", ...(veValores ? ["Saldo devedor"] : ["Alienado"]), "Situação"]}
              alinharDireita={veValores ? [8] : []}
              linhas={lista.map((v) => [
                <NomeVeiculo key="p" v={v} />,
                v.prefixo ?? "—",
                <span key="m">{[v.marca, v.modelo].filter(Boolean).join(" ") || "—"}{v.anoFab ? <span className="text-slate-400"> {v.anoFab}{v.anoMod && v.anoMod !== v.anoFab ? `/${v.anoMod}` : ""}</span> : null}</span>,
                `${ROTULO_TIPO_VEICULO[v.tipo] ?? v.tipo}${v.capacidade ? ` · ${v.capacidade} lug.` : ""}`,
                v.categoriaUso ? ROTULO_USO[v.categoriaUso] ?? v.categoriaUso : "—",
                v.alocacao ?? "—",
                <SeloAlerta key="d" alerta={v.pior} texto={v.vencidos > 1 ? `${v.vencidos} vencidos` : undefined} />,
                <SeloCobertura key="a" cobertura={v.cobertura} />,
                veValores ? (v.saldo ? fmtBRL(v.saldo.saldoCents) : "—") : v.alienado ? "sim" : "—",
                <SeloStatus key="s" status={v.status} rotulo={ROTULO_STATUS_VEICULO[v.status] ?? v.status} />,
              ])}
              vazio="Nenhum veículo com esses filtros."
            />
          </Secao>
        </>
      )}
    </div>
  );
}
