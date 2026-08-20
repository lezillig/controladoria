import Link from "next/link";
import type { ReactNode } from "react";
import { badgeClass, cardClass } from "@/lib/ui";
import { fmtPercent } from "@/lib/controladoria/format";

// Peças visuais compartilhadas pelas telas da Controladoria. São componentes
// de servidor (sem "use client"): nenhuma delas tem estado — o que mantém o
// JavaScript enviado ao navegador restrito às poucas telas que realmente
// precisam de interação (tratativa de achado, formulários).

export function Kpi({
  rotulo,
  valor,
  apoio,
  tom = "neutro",
  icone,
}: {
  rotulo: string;
  valor: string;
  apoio?: string;
  tom?: "neutro" | "bom" | "atencao" | "ruim";
  icone?: ReactNode;
}) {
  const cor = {
    neutro: "text-slate-900",
    bom: "text-emerald-700",
    atencao: "text-amber-700",
    ruim: "text-red-700",
  }[tom];

  return (
    <div className={cardClass}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-slate-500">{rotulo}</p>
        {icone && <span className="text-slate-400">{icone}</span>}
      </div>
      {/* break-words: valores em reais podem estourar a coluna no celular
          (R$ 1.234.567,89 não cabe em card de 160px) — quebrar é melhor que
          cortar ou empurrar o layout para o lado. */}
      <p className={`mt-2 text-2xl font-semibold break-words ${cor}`}>{valor}</p>
      {apoio && <p className="mt-1 text-xs text-slate-500">{apoio}</p>}
    </div>
  );
}

export function Secao({
  titulo,
  descricao,
  acao,
  children,
}: {
  titulo: string;
  descricao?: string;
  acao?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={cardClass}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{titulo}</h2>
          {descricao && <p className="mt-0.5 text-xs text-slate-500">{descricao}</p>}
        </div>
        {acao}
      </div>
      {children}
    </section>
  );
}

// Tabela com rolagem horizontal própria. Tabela financeira tem muitas colunas
// e, sem o contêiner com overflow, a página inteira rola de lado no celular —
// o que quebra a leitura de tudo o mais.
export function Tabela({
  colunas,
  linhas,
  alinharDireita = [],
  vazio = "Nenhum registro.",
}: {
  colunas: string[];
  linhas: ReactNode[][];
  alinharDireita?: number[];
  vazio?: string;
}) {
  if (linhas.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-500">{vazio}</p>;
  }

  return (
    <div className="-mx-6 overflow-x-auto px-6">
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            {colunas.map((c, i) => (
              <th key={c} className={`px-3 py-2 ${alinharDireita.includes(i) ? "text-right" : ""}`}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha, i) => (
            <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
              {linha.map((celula, j) => (
                <td
                  key={j}
                  className={`px-3 py-2.5 text-slate-700 ${alinharDireita.includes(j) ? "text-right tabular-nums" : ""}`}
                >
                  {celula}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const CORES_SEVERIDADE: Record<string, { classe: string; rotulo: string }> = {
  CRITICA: { classe: "bg-red-100 text-red-700", rotulo: "Crítico" },
  ALTA: { classe: "bg-orange-100 text-orange-700", rotulo: "Alto" },
  MEDIA: { classe: "bg-amber-100 text-amber-700", rotulo: "Médio" },
  BAIXA: { classe: "bg-sky-100 text-sky-700", rotulo: "Baixo" },
  INFO: { classe: "bg-slate-100 text-slate-600", rotulo: "Informativo" },
};

export function BadgeSeveridade({ severidade }: { severidade: string }) {
  const cor = CORES_SEVERIDADE[severidade] ?? CORES_SEVERIDADE.INFO;
  return <span className={`${badgeClass} ${cor.classe}`}>{cor.rotulo}</span>;
}

const CORES_CATEGORIA: Record<string, { classe: string; rotulo: string }> = {
  FRAUDE: { classe: "bg-red-50 text-red-700 ring-1 ring-red-200", rotulo: "Indício de fraude" },
  ERRO_PROCESSO: { classe: "bg-slate-50 text-slate-700 ring-1 ring-slate-200", rotulo: "Erro de processo" },
  PERDA_FINANCEIRA: { classe: "bg-orange-50 text-orange-700 ring-1 ring-orange-200", rotulo: "Perda financeira" },
  RISCO_FINANCEIRO: { classe: "bg-amber-50 text-amber-700 ring-1 ring-amber-200", rotulo: "Risco financeiro" },
  CONFORMIDADE: { classe: "bg-violet-50 text-violet-700 ring-1 ring-violet-200", rotulo: "Conformidade" },
  OPORTUNIDADE: { classe: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200", rotulo: "Oportunidade" },
};

export function BadgeCategoria({ categoria }: { categoria: string }) {
  const cor = CORES_CATEGORIA[categoria] ?? CORES_CATEGORIA.ERRO_PROCESSO;
  return <span className={`${badgeClass} ${cor.classe}`}>{cor.rotulo}</span>;
}

const CORES_FAROL: Record<string, string> = {
  VERDE: "bg-emerald-500",
  AMARELO: "bg-amber-500",
  VERMELHO: "bg-red-500",
  SEM_META: "bg-slate-300",
  SEM_DADO: "bg-slate-200",
};

export function Farol({ farol, titulo }: { farol: string; titulo?: string }) {
  return (
    <span
      title={titulo ?? farol}
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${CORES_FAROL[farol] ?? CORES_FAROL.SEM_DADO}`}
    />
  );
}

export function Barra({ percentual, tom = "azul" }: { percentual: number; tom?: "azul" | "verde" | "vermelho" | "ambar" }) {
  const cor = { azul: "bg-blue-700", verde: "bg-emerald-600", vermelho: "bg-red-600", ambar: "bg-amber-500" }[tom];
  const largura = Math.max(0, Math.min(100, percentual));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full rounded-full ${cor}`} style={{ width: `${largura}%` }} />
    </div>
  );
}

// Variação percentual com cor por direção. `bomSeSobe` existe porque em
// controladoria a mesma seta significa coisas opostas: receita subindo é bom,
// despesa subindo não — pintar as duas de verde seria enganoso.
export function Variacao({ valor, bomSeSobe = true }: { valor: number | null; bomSeSobe?: boolean }) {
  if (valor === null) return <span className="text-xs text-slate-400">sem base comparativa</span>;
  const positivo = valor > 0;
  const bom = positivo === bomSeSobe;
  return (
    <span className={`text-xs font-medium ${Math.abs(valor) < 0.05 ? "text-slate-500" : bom ? "text-emerald-700" : "text-red-700"}`}>
      {positivo ? "+" : ""}
      {fmtPercent(valor)}
    </span>
  );
}

export function AvisoVazio({ titulo, descricao, acaoHref, acaoLabel }: { titulo: string; descricao: string; acaoHref?: string; acaoLabel?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <p className="text-sm font-medium text-slate-800">{titulo}</p>
      <p className="mx-auto mt-1 max-w-xl text-sm text-slate-500">{descricao}</p>
      {acaoHref && acaoLabel && (
        <Link
          href={acaoHref}
          className="mt-4 inline-block rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
        >
          {acaoLabel}
        </Link>
      )}
    </div>
  );
}

// Filtro de empresa do grupo. Só aparece quando há mais de uma conexão — com
// uma empresa só, um seletor de uma opção é ruído.
//
// Passa pela URL (e não por estado no cliente) de propósito: a tela filtrada
// vira um link compartilhável, e o servidor consegue montar o contexto já no
// escopo certo, sem uma segunda ida ao banco.
export function SeletorEmpresa({
  conexoes,
  ativa,
  rota,
}: {
  conexoes: { id: string; apelido: string; nome: string }[];
  ativa: string | null;
  rota: string;
}) {
  if (conexoes.length < 2) return null;

  const item = (href: string, rotulo: string, selecionado: boolean, titulo?: string) => (
    <Link
      key={href}
      href={href}
      title={titulo}
      className={`rounded-full px-3 py-1 text-xs font-medium ${
        selecionado ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
      }`}
    >
      {rotulo}
    </Link>
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs text-slate-500">Empresa:</span>
      {item(rota, "Grupo (todas)", ativa === null, "Consolidado das empresas do grupo")}
      {conexoes.map((c) =>
        item(`${rota}${rota.includes("?") ? "&" : "?"}empresa=${c.id}`, c.apelido, ativa === c.id, c.nome)
      )}
    </div>
  );
}
