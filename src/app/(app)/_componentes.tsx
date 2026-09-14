import Link from "next/link";
import type { ReactNode } from "react";
import { badgeClass, cardClass } from "@/lib/ui";
import { fmtBRL, fmtBRLCompacto, fmtData, fmtDocumento, fmtNumero, fmtPercent } from "@/lib/controladoria/format";

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

// KPI QUE ABRE. O número em cima é o resumo; o detalhe embaixo é a composição
// que o sustenta — e fica escondido até um clique, para a primeira leitura do
// painel continuar sendo quatro números e não quatro tabelas. É um <details>
// nativo: abre sem JavaScript, e o estado de aberto/fechado é do navegador.
export function KpiExpansivel({
  rotulo,
  valor,
  apoio,
  tom = "neutro",
  icone,
  children,
}: {
  rotulo: string;
  valor: string;
  apoio?: string;
  tom?: "neutro" | "bom" | "atencao" | "ruim";
  icone?: ReactNode;
  children: ReactNode;
}) {
  const cor = {
    neutro: "text-slate-900",
    bom: "text-emerald-700",
    atencao: "text-amber-700",
    ruim: "text-red-700",
  }[tom];

  return (
    <details className={`${cardClass} group`}>
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium text-slate-500">{rotulo}</p>
          <span className="flex items-center gap-1 text-slate-400">
            {icone}
            <span className="text-[10px] transition-transform group-open:rotate-180" aria-hidden>
              ▼
            </span>
          </span>
        </div>
        <p className={`mt-2 text-2xl font-semibold break-words ${cor}`}>{valor}</p>
        {apoio && <p className="mt-1 text-xs text-slate-500">{apoio}</p>}
      </summary>
      <div className="mt-3 border-t border-slate-100 pt-3">{children}</div>
    </details>
  );
}

// Lista compacta de fatias (rótulo, valor, %) para dentro de um KPI aberto.
export function Fatias({
  fatias,
  vazio = "Nada no período.",
}: {
  fatias: { rotulo: string; valorCents: number; quantidade: number; participacaoPercent: number }[];
  vazio?: string;
}) {
  if (fatias.length === 0) return <p className="text-xs text-slate-500">{vazio}</p>;
  return (
    <ul className="space-y-1.5">
      {fatias.map((f) => (
        <li key={f.rotulo} className="text-xs">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-slate-700">{f.rotulo}</span>
            <span className="shrink-0 tabular-nums text-slate-900">
              {fmtBRLCompacto(f.valorCents)}
              <span className="ml-1 text-slate-400">{fmtPercent(f.participacaoPercent, 0)}</span>
            </span>
          </div>
          <div className="mt-0.5 h-1 rounded bg-slate-100">
            <div
              className="h-1 rounded bg-blue-600"
              style={{ width: `${Math.max(0, Math.min(100, f.participacaoPercent))}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

// EVIDÊNCIA DE UM ACHADO, legível.
//
// Cada agente anexa ao achado o que o originou — lista de títulos, de baixas,
// contagens, valores — num objeto livre, porque cada regra tem forma própria.
// Esta peça o mostra sem exigir que ninguém leia JSON: tabela quando é lista
// de registros, pares rótulo/valor quando é objeto, dinheiro em reais quando
// o nome do campo diz que é dinheiro. É o "de onde veio isso" que faz a
// diferença entre confiar num achado e aceitá-lo em bloco.
// A lista precisa cobrir o vocabulário que os agentes usam na evidência:
// "devido" e "documento" apareciam como 83.858.195 (centavos crus) ao lado
// de "recebido R$ 774.011,15", e quem lia não tinha como saber que os dois
// eram a mesma unidade. Contagens ("baixas", "titulos", "atraso") ficam de
// fora de propósito: são inteiros que NÃO são dinheiro.
const CHAVE_DE_DINHEIRO =
  /cents$|^(saldo|valor|impacto|total|juros|multa|desconto|tarifa|pago|recebido|retid|retenc|devido|documento|soma|excedente|exposicao|liquido|bruto|unitario|diferenca|falta|previst|projetad|entrada|saida|receita|despesa|custo|faturado|cobrado|concedido|pendente|aberto|vencido|volume|negociavel|media|maximo|minimo)/i;
const MAXIMO_DE_LINHAS = 50;
const MAXIMO_DE_COLUNAS = 12;

function rotuloDeChave(chave: string): string {
  return chave
    .replace(/Cents$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase();
}

function valorLegivel(chave: string, valor: unknown): string {
  if (valor === null || valor === undefined || valor === "") return "—";
  if (typeof valor === "boolean") return valor ? "sim" : "não";
  if (typeof valor === "number") {
    return CHAVE_DE_DINHEIRO.test(chave) && Number.isInteger(valor) ? fmtBRL(valor) : fmtNumero(valor, Number.isInteger(valor) ? 0 : 2);
  }
  if (typeof valor === "string") {
    if (/^\d{4}-\d{2}-\d{2}T/.test(valor)) {
      const d = new Date(valor);
      return Number.isNaN(d.getTime()) ? valor : fmtData(d);
    }
    // CPF na evidência sai mascarado, como em toda tela. A evidência é JSON
    // livre dos agentes e é o único caminho em que o documento chegava cru.
    if (/documento|cpf|cnpj/i.test(chave) && /^\d{11}$/.test(valor.trim())) return fmtDocumento(valor.trim());
    return valor;
  }
  if (Array.isArray(valor)) return valor.map((v) => valorLegivel(chave, v)).join(", ");
  return JSON.stringify(valor);
}

function ehListaDeRegistros(v: unknown): v is Record<string, unknown>[] {
  return Array.isArray(v) && v.length > 0 && v.every((x) => x && typeof x === "object" && !Array.isArray(x));
}

export function Evidencia({ dados }: { dados: unknown }) {
  if (!dados || typeof dados !== "object" || Array.isArray(dados)) {
    return <p className="text-xs text-slate-500">Sem evidência anexada.</p>;
  }
  const entradas = Object.entries(dados as Record<string, unknown>);
  const escalares = entradas.filter(([, v]) => !ehListaDeRegistros(v) && !(v && typeof v === "object" && !Array.isArray(v)));
  const listas = entradas.filter((e): e is [string, Record<string, unknown>[]] => ehListaDeRegistros(e[1]));
  const objetos = entradas.filter(([, v]) => v && typeof v === "object" && !Array.isArray(v));

  return (
    <div className="space-y-3">
      {escalares.length > 0 && (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
          {escalares.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 border-b border-slate-100 py-0.5">
              <dt className="text-slate-500">{rotuloDeChave(k)}</dt>
              <dd className="text-right tabular-nums text-slate-800">{valorLegivel(k, v)}</dd>
            </div>
          ))}
        </dl>
      )}
      {objetos.map(([k, v]) => (
        <div key={k}>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{rotuloDeChave(k)}</p>
          <Evidencia dados={v} />
        </div>
      ))}
      {listas.map(([k, lista]) => {
        const colunas = [...new Set(lista.flatMap((r) => Object.keys(r)))].slice(0, MAXIMO_DE_COLUNAS);
        const linhas = lista.slice(0, MAXIMO_DE_LINHAS);
        return (
          <div key={k}>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {rotuloDeChave(k)} ({fmtNumero(lista.length)}
              {lista.length > MAXIMO_DE_LINHAS ? `, ${MAXIMO_DE_LINHAS} exibidos` : ""})
            </p>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    {colunas.map((c) => (
                      <th key={c} className="py-1 pr-3 font-medium">
                        {rotuloDeChave(c)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((r, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      {colunas.map((c) => (
                        <td key={c} className="py-1 pr-3 tabular-nums text-slate-800">
                          {valorLegivel(c, r[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
