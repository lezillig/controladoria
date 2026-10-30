"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CadeiaFipe, ItemFipe, PrecoFipe, TipoFipe } from "@/lib/frota/fipe";
import { fipeOpcoes, fipePrevia, gravarFipe } from "../../fipe/actions";

// A ESCOLHA PASSO A PASSO: tabela → marca → modelo → ano → preço. A tela abre
// com a sugestão tirada do cadastro (marca, modelo e ano-modelo) já
// consultada; cada troca refaz os passos seguintes, sugerindo de novo.

const ent = "w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm";
const fmt = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function EscolherFipe({
  veiculoId,
  tipoInicial,
  inicial,
  rotulosTipo,
  iguais,
  aplicarIguaisInicial,
  voltarPara,
}: {
  veiculoId: string;
  tipoInicial: TipoFipe;
  inicial: CadeiaFipe;
  rotulosTipo: Record<TipoFipe, string>;
  iguais: number;
  aplicarIguaisInicial: boolean;
  voltarPara: string;
}) {
  const router = useRouter();
  const [tipo, setTipo] = useState<TipoFipe>(tipoInicial);
  const [marcas, setMarcas] = useState<ItemFipe[]>(inicial.marcas);
  const [marca, setMarca] = useState(inicial.marca);
  const [modelos, setModelos] = useState<ItemFipe[]>(inicial.modelos);
  const [modelo, setModelo] = useState(inicial.modelo);
  const [filtro, setFiltro] = useState("");
  const [anos, setAnos] = useState<ItemFipe[]>(inicial.anos);
  const [ano, setAno] = useState(inicial.ano);
  const [preco, setPreco] = useState<PrecoFipe | null>(inicial.preco);
  const [aplicarIguais, setAplicarIguais] = useState(aplicarIguaisInicial && iguais > 0);
  const [erro, setErro] = useState<string | null>(inicial.erro ?? null);
  const [carregando, setCarregando] = useState<string | null>(null);
  const [gravando, iniciar] = useTransition();
  // Cada troca vale a partir dela: resposta de uma troca anterior é ignorada.
  const vez = useRef(0);

  const pronto = (n: number, r: { erro?: string }) => {
    if (n !== vez.current) return false;
    setCarregando(null);
    if (r.erro) setErro(r.erro);
    return !r.erro;
  };

  async function aoEscolherAno(n: number, t: TipoFipe, mc: string, md: string, a: string) {
    setAno(a);
    setPreco(null);
    if (!a) return;
    setCarregando("preço");
    const r = await fipePrevia({ tipo: t, marca: mc, modelo: md, ano: a });
    if (pronto(n, r)) setPreco(r.preco ?? null);
  }
  async function aoEscolherModelo(n: number, t: TipoFipe, mc: string, md: string) {
    setModelo(md);
    setAnos([]); setAno(""); setPreco(null);
    if (!md) return;
    setCarregando("anos");
    const r = await fipeOpcoes({ veiculoId, tipo: t, marca: mc, modelo: md });
    if (!pronto(n, r)) return;
    setAnos(r.itens ?? []);
    if (r.sugerido) await aoEscolherAno(n, t, mc, md, r.sugerido);
  }
  async function aoEscolherMarca(n: number, t: TipoFipe, mc: string) {
    setMarca(mc);
    setModelos([]); setModelo(""); setFiltro(""); setAnos([]); setAno(""); setPreco(null);
    if (!mc) return;
    setCarregando("modelos");
    const r = await fipeOpcoes({ veiculoId, tipo: t, marca: mc });
    if (!pronto(n, r)) return;
    setModelos(r.itens ?? []);
    if (r.sugerido) await aoEscolherModelo(n, t, mc, r.sugerido);
  }
  async function aoEscolherTipo(n: number, t: TipoFipe) {
    setTipo(t);
    setMarcas([]); setMarca(""); setModelos([]); setModelo(""); setFiltro(""); setAnos([]); setAno(""); setPreco(null);
    setCarregando("marcas");
    const r = await fipeOpcoes({ veiculoId, tipo: t });
    if (!pronto(n, r)) return;
    setMarcas(r.itens ?? []);
    if (r.sugerido) await aoEscolherMarca(n, t, r.sugerido);
  }
  const nova = () => {
    setErro(null);
    return ++vez.current;
  };

  const visiveis = useMemo(() => {
    const f = filtro.trim().toUpperCase();
    return f ? modelos.filter((m) => f.split(/\s+/).every((p) => m.nome.toUpperCase().includes(p))) : modelos;
  }, [filtro, modelos]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block text-xs font-semibold text-slate-600">
          1. Tabela
          <select value={tipo} onChange={(e) => aoEscolherTipo(nova(), e.target.value as TipoFipe)} className={`${ent} mt-1`}>
            {(Object.keys(rotulosTipo) as TipoFipe[]).map((t) => (
              <option key={t} value={t}>{rotulosTipo[t]}</option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          2. Marca {carregando === "marcas" && <span className="font-normal text-slate-400">carregando…</span>}
          <select value={marca} onChange={(e) => aoEscolherMarca(nova(), tipo, e.target.value)} disabled={!marcas.length} className={`${ent} mt-1`}>
            <option value="">— escolha —</option>
            {marcas.map((m) => (
              <option key={m.codigo} value={m.codigo}>{m.nome}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="block text-xs font-semibold text-slate-600">
        3. Modelo {carregando === "modelos" && <span className="font-normal text-slate-400">carregando…</span>}
        {modelos.length > 0 && <span className="ml-1 font-normal text-slate-400">({visiveis.length} de {modelos.length}; os mais parecidos com o cadastro primeiro)</span>}
        <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Filtrar (ex.: 416 VAN, ATTACK 9 ESCOLAR)" disabled={!modelos.length} className={`${ent} mt-1`} />
        <select value={modelo} onChange={(e) => aoEscolherModelo(nova(), tipo, marca, e.target.value)} size={8} disabled={!modelos.length} className={`${ent} mt-1 font-normal`}>
          {visiveis.map((m) => (
            <option key={m.codigo} value={m.codigo}>{m.nome}</option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block text-xs font-semibold text-slate-600">
          4. Ano-modelo {carregando === "anos" && <span className="font-normal text-slate-400">carregando…</span>}
          <select value={ano} onChange={(e) => aoEscolherAno(nova(), tipo, marca, modelo, e.target.value)} disabled={!anos.length} className={`${ent} mt-1`}>
            <option value="">— escolha —</option>
            {anos.map((a) => (
              <option key={a.codigo} value={a.codigo}>{a.nome.replace(/^32000/, "Zero KM")}</option>
            ))}
          </select>
        </label>
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
          {carregando === "preço" ? (
            <span className="text-slate-400">consultando o preço…</span>
          ) : preco ? (
            <>
              <p className="text-lg font-semibold text-slate-900">{fmt(preco.valorCents)}</p>
              <p className="text-xs text-slate-600">
                {preco.marca} {preco.modelo} · {preco.anoModelo === 32000 ? "Zero KM" : preco.anoModelo} {preco.combustivel}
              </p>
              <p className="text-xs text-slate-500">código FIPE {preco.codigoFipe} · referência {preco.referencia}</p>
            </>
          ) : (
            <span className="text-xs text-slate-400">O preço aparece aqui ao escolher o ano.</span>
          )}
        </div>
      </div>

      {erro && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{erro}</p>}

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
        {iguais > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-slate-700">
            <input type="checkbox" checked={aplicarIguais} onChange={(e) => setAplicarIguais(e.target.checked)} />
            Aplicar também aos {iguais} veículo(s) iguais (mesma marca, modelo e ano-modelo no cadastro) que ainda não têm FIPE
          </label>
        )}
        <button
          type="button"
          disabled={!preco || gravando || carregando !== null}
          onClick={() =>
            iniciar(async () => {
              setErro(null);
              const r = await gravarFipe({ veiculoId, tipo, marca, modelo, ano, aplicarIguais });
              if (r.erro) return setErro(r.erro);
              router.push(voltarPara);
              router.refresh();
            })
          }
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {gravando ? "Gravando…" : "Gravar este modelo"}
        </button>
      </div>
    </div>
  );
}
