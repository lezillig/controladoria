"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Banknote,
  Building2,
  Calculator,
  CalendarRange,
  Compass,
  FileCheck,
  Landmark,
  LayoutDashboard,
  Mail,
  PiggyBank,
  Receipt,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  TrendingUp,
  UsersRound,
  Database,
} from "lucide-react";
import type { Permissao } from "@/lib/acessos";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  // A PERMISSÃO QUE ABRE ESTE ITEM. Obrigatória, e não opcional como era a
  // marca anterior: item sem regra aparecia para todo mundo que conseguisse
  // entrar, e "todo mundo que consegue entrar" deixou de ser um grupo só no
  // dia em que passou a existir perfil. Esquecer a regra num item novo agora é
  // erro de compilação, não uma tela vazando em silêncio.
  permissao: Permissao;
  // Subitem: aparece recuado, logo abaixo do item de que faz parte.
  sub?: boolean;
  // Abre uma seção do menu com este título (ver NAV).
  secao?: string;
};

// O MENU EM SEÇÕES, cada uma respondendo a uma pergunta de quem usa — e,
// dentro dela, na ordem em que as telas costumam ser abertas:
//
//   Painel             como estamos hoje? (a primeira tela da manhã)
//   Resultado          quanto ganhamos e para onde foi o dinheiro — DRE e
//                      fluxo de caixa lado a lado, depois a série do ano e a
//                      margem por contrato
//   Rotina financeira  o dia a dia: títulos, extrato, documento fiscal
//   Controle e riscos  o que precisa de atenção: auditoria e conformidade
//   Planejamento       para onde vamos: metas, cenários, preço de contrato
//                      novo (o simulador e a sua base)
//   Configurações      o que muda o sistema para os outros, por último
//
// A seção é dita pelo título, não só pela ordem: com 20 itens, sem rótulo o
// menu vira uma lista para ler inteira toda vez.
const NAV: NavItem[] = [
  { href: "/", label: "Painel financeiro", icon: LayoutDashboard, permissao: "painel" },

  { secao: "Resultado", href: "/custos", label: "Custos e DRE", icon: TrendingUp, permissao: "custos" },
  { href: "/fluxo-caixa", label: "Fluxo de caixa", icon: Banknote, permissao: "fluxo-caixa" },
  { href: "/resultados", label: "Resultado mês a mês", icon: CalendarRange, permissao: "resultados" },
  { href: "/rentabilidade", label: "Rentabilidade por contrato", icon: PiggyBank, permissao: "rentabilidade" },

  { secao: "Rotina financeira", href: "/titulos", label: "Contas a pagar e receber", icon: Receipt, permissao: "titulos" },
  { href: "/conciliacao", label: "Conciliação bancária", icon: Landmark, permissao: "conciliacao" },
  // A mesma pergunta dos títulos vista do outro lado: cada cobrança tem o
  // documento fiscal que a justifica? A Omie não expõe CT-e pela API, então é
  // a única tela que depende de alguém colar uma lista.
  { href: "/cte", label: "Conferência de CT-e", icon: FileCheck, permissao: "cte" },

  // As duas leituras do mesmo risco — a que o sistema faz nos dados e a que a
  // consultoria faz na empresa.
  { secao: "Controle e riscos", href: "/auditoria", label: "Auditoria e achados", icon: ShieldCheck, permissao: "auditoria" },
  { href: "/conformidade", label: "Conformidade", icon: ScrollText, permissao: "conformidade" },

  // As metas medem o presente; os cenários dizem para onde a empresa vai; o
  // simulador custeia a operação que ainda não existe (licitação, contrato
  // novo, renovação) a partir dos custos que a controladoria mede.
  { secao: "Planejamento", href: "/bsc", label: "Balanced Scorecard", icon: Target, permissao: "bsc" },
  { href: "/cenarios", label: "Cenários e orçamento", icon: Compass, permissao: "cenarios" },
  { href: "/simulador", label: "Simulador de custos", icon: Calculator, permissao: "simulador" },
  { href: "/simulador/base", label: "Custos base", icon: Database, permissao: "simulador", sub: true },

  // Por último: o que muda como o sistema se comporta, e não o que ele mostra
  // sobre a empresa.
  { secao: "Configurações", href: "/relatorios", label: "Relatórios diários", icon: Mail, permissao: "relatorios" },
  { href: "/sincronizacao", label: "Sincronização", icon: RefreshCw, permissao: "sincronizacao" },
  { href: "/conexoes", label: "Conexões Omie", icon: Building2, permissao: "conexoes" },
  { href: "/configuracao", label: "Modelo de gestão", icon: SlidersHorizontal, permissao: "gerir-modelo" },
  { href: "/usuarios", label: "Usuários e acessos", icon: UsersRound, permissao: "gerir-usuarios" },
];

// A seção de cada item: a do próprio item ou a do último que abriu uma.
const COM_SECAO = NAV.reduce<(NavItem & { secaoDoItem: string | null })[]>((lista, item) => {
  lista.push({ ...item, secaoDoItem: item.secao ?? lista.at(-1)?.secaoDoItem ?? null });
  return lista;
}, []);

function isActive(pathname: string, href: string) {
  // O painel fica em "/" — sem match exato, ele apareceria ativo em toda rota
  // do sistema, já que todas começam com "/".
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export default function Sidebar({ permissoes }: { permissoes: string[] }) {
  const pathname = usePathname() ?? "";
  // O menu mostra o que a pessoa alcança — nem um item a mais. Item visível e
  // clicável que devolve "sem acesso" ensina a ignorar o menu, e num sistema
  // financeiro ainda anuncia a existência de telas a quem não deveria saber
  // que existem.
  const permitidas = new Set(permissoes);
  // O título da seção vai no primeiro item VISÍVEL dela: sem acesso ao
  // primeiro, a seção não some nem fica sem título.
  const itens = COM_SECAO.filter((i) => permitidas.has(i.permissao)).map((i, k, lista) => ({
    ...i,
    titulo: i.secaoDoItem !== null && i.secaoDoItem !== lista[k - 1]?.secaoDoItem ? i.secaoDoItem : null,
  }));
  // Só o item MAIS específico que casa com a rota fica aceso: em
  // /simulador/base acende "Custos base", não também "Simulador de custos".
  const ativoHref = itens
    .filter((i) => isActive(pathname, i.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <nav className="flex h-full flex-col gap-1 overflow-y-auto p-3">
      {itens.map((item) => {
        const Icon = item.icon;
        const ativo = item.href === ativoHref;
        return (
          <Fragment key={item.href}>
            {item.titulo && <p className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{item.titulo}</p>}
            <Link
              href={item.href}
              prefetch={false}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${item.sub ? "ml-6 py-1.5 text-[13px]" : ""} ${
                ativo ? "bg-blue-700 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          </Fragment>
        );
      })}
    </nav>
  );
}
