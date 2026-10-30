"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ListChecks,
  Network,
  Banknote,
  Building2,
  Calculator,
  CalendarRange,
  Compass,
  FileCheck,
  Gauge,
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
  Radar,
  Wallet,
  ClipboardCheck,
  Contact,
  Inbox,
  HandCoins,
  History,
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
//   Início               como estamos hoje, e o que espera uma decisão minha
//   Pessoas              quem trabalha e o fechamento da folha
//   Financeiro           o dia a dia do dinheiro: títulos, extrato, caixa,
//                        e as dívidas da frota conferidas na Omie
//
// Veículos, motoristas e multas são da gestão (a operação); aqui fica o lado
// financeiro deles.
//   Resultado            quanto ganhamos e onde: DRE, série do ano, margem
//   Comercial            preço de contrato novo e licitações
//   Controle e auditoria o que precisa de atenção e as conferências
//   Planejamento         metas e cenários
//   Configurações        o que muda o sistema para os outros, por último
//
// A seção é dita pelo título, não só pela ordem: com 30 itens, sem rótulo o
// menu vira uma lista para ler inteira toda vez. Cada pessoa vê só as seções
// que o perfil dela alcança.
const NAV: NavItem[] = [
  { secao: "Início", href: "/", label: "Painel financeiro", icon: LayoutDashboard, permissao: "painel" },
  // A fila de decisões: o que agentes e cargas propõem e uma pessoa aprova.
  { href: "/pendencias", label: "Pendências", icon: Inbox, permissao: "pendencias" },

  { secao: "Pessoas", href: "/cadastro/pessoas", label: "Pessoas", icon: Contact, permissao: "cadastro-pessoas" },
  // O checklist mensal do fluxograma da folha validado pelo RH e pela Contabilidade.
  { href: "/folha", label: "Fechamento da folha", icon: ClipboardCheck, permissao: "folha" },

  { secao: "Financeiro", href: "/titulos", label: "Contas a pagar e receber", icon: Receipt, permissao: "titulos" },
  { href: "/conciliacao", label: "Conciliação bancária", icon: Landmark, permissao: "conciliacao" },
  { href: "/fluxo-caixa", label: "Fluxo de caixa", icon: Banknote, permissao: "fluxo-caixa" },
  // O caixa que já passou, mês a mês, e a auditoria de uma conta (a Omie.CASH).
  { href: "/caixa-mensal", label: "Caixa mês a mês", icon: Wallet, permissao: "fluxo-caixa" },
  // As dívidas da frota: os contratos são da gestão; aqui, conferidos na Omie.
  { href: "/frota/financiamentos", label: "Financiamentos e consórcios", icon: HandCoins, permissao: "financiamentos" },

  { secao: "Resultado", href: "/custos", label: "Custos e DRE", icon: TrendingUp, permissao: "custos" },
  // O mesmo DRE aberto pelos centros de custo da folha — logo abaixo do DRE.
  { href: "/dre-centro-custo", label: "DRE por centro de custo", icon: Network, permissao: "custos" },
  { href: "/resultados", label: "Resultado mês a mês", icon: CalendarRange, permissao: "resultados" },
  { href: "/rentabilidade", label: "Rentabilidade por contrato", icon: PiggyBank, permissao: "rentabilidade" },
  // O retorno sobre o capital fecha a seção.
  { href: "/indicadores", label: "Indicadores", icon: Gauge, permissao: "indicadores" },

  // O simulador custeia a operação que ainda não existe (licitação, contrato
  // novo, renovação) a partir dos custos que a controladoria mede.
  { secao: "Comercial", href: "/simulador", label: "Simulador de custos", icon: Calculator, permissao: "simulador" },
  { href: "/simulador/base", label: "Custos base", icon: Database, permissao: "simulador", sub: true },
  { href: "/simulador/radar", label: "Radar de licitações", icon: Radar, permissao: "simulador", sub: true },

  // O risco lido nos dados (auditoria), na empresa (conformidade) e as
  // conferências de documento contra pagamento.
  { secao: "Controle e auditoria", href: "/auditoria", label: "Auditoria e achados", icon: ShieldCheck, permissao: "auditoria" },
  // Quem mudou o quê e quando (cadastro, pendências, ligação com a Omie).
  { href: "/auditoria/trilha", label: "Trilha de alterações", icon: History, permissao: "auditoria" },
  { href: "/conformidade", label: "Conformidade", icon: ScrollText, permissao: "conformidade" },
  // O projeto (OS) do custo contra o da cobrança: serviço pago e não faturado.
  { href: "/conferencia-os", label: "Conferência de OS", icon: ListChecks, permissao: "titulos" },
  // Cada cobrança tem o documento fiscal que a justifica? A Omie não expõe CT-e
  // pela API: é a única tela que depende de alguém colar uma lista.
  { href: "/cte", label: "Conferência de CT-e", icon: FileCheck, permissao: "cte" },

  { secao: "Planejamento", href: "/bsc", label: "Balanced Scorecard", icon: Target, permissao: "bsc" },
  { href: "/cenarios", label: "Cenários e orçamento", icon: Compass, permissao: "cenarios" },

  // Por último: o que muda como o sistema se comporta, e não o que ele mostra
  // sobre a empresa.
  { secao: "Configurações", href: "/cadastro", label: "Cadastro mestre", icon: Database, permissao: "cadastro" },
  { href: "/usuarios", label: "Usuários e acessos", icon: UsersRound, permissao: "gerir-usuarios" },
  { href: "/conexoes", label: "Conexões Omie", icon: Building2, permissao: "conexoes" },
  { href: "/sincronizacao", label: "Sincronização", icon: RefreshCw, permissao: "sincronizacao" },
  { href: "/relatorios", label: "Relatórios diários", icon: Mail, permissao: "relatorios" },
  { href: "/configuracao", label: "Modelo de gestão", icon: SlidersHorizontal, permissao: "gerir-modelo" },
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
