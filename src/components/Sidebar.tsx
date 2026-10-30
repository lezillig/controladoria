"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowRightLeft,
  Banknote,
  Briefcase,
  Building2,
  Calculator,
  CalendarRange,
  ChartPie,
  ChevronDown,
  CircleDollarSign,
  ClipboardCheck,
  Compass,
  Contact,
  Database,
  FileCheck,
  Gauge,
  HandCoins,
  History,
  Inbox,
  Landmark,
  LayoutDashboard,
  ListChecks,
  Mail,
  Network,
  Percent,
  PiggyBank,
  Radar,
  Receipt,
  RefreshCw,
  Scale,
  ScrollText,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  TrendingUp,
  Users,
  UsersRound,
  Wallet,
} from "lucide-react";
import type { Permissao } from "@/lib/acessos";

type Tela = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  // A PERMISSÃO QUE ABRE ESTA TELA. Obrigatória: tela sem regra aparecia para
  // todo mundo que conseguisse entrar, e "todo mundo que consegue entrar"
  // deixou de ser um grupo só no dia em que passou a existir perfil. Esquecer
  // a regra numa tela nova é erro de compilação, não uma tela vazando.
  permissao: Permissao;
};

// Tema: não é tela, não leva a lugar nenhum — só abre e fecha as telas dele.
type Tema = { label: string; icon: React.ComponentType<{ className?: string }>; children: Tela[] };
type NavItem = Tela | Tema;
const ehTema = (i: NavItem): i is Tema => "children" in i;

// O MENU EM TEMAS QUE ABREM E FECHAM, o mesmo modelo da gestão. Com mais de
// trinta telas, a lista inteira aberta era para ler de cima a baixo toda vez;
// fechado, cada tema responde a uma pergunta e mostra as telas dela:
//
//   Painel e Pendências   soltos no topo: como estamos e o que espera decisão
//   Financeiro            o dia a dia do dinheiro: títulos, extrato, caixa e
//                         as dívidas da frota conferidas na Omie
//   Resultado             quanto ganhamos e onde: DRE, série, margem, retorno
//   Pessoas e folha       quem trabalha e o fechamento da folha
//   Comercial             preço de contrato novo e licitações
//   Auditoria             o que precisa de atenção e as conferências de
//                         documento contra pagamento
//   Fiscal e conformidade obrigações, a transição para o Lucro Real e a
//                         apuração dele — separado da auditoria porque é
//                         assunto da contabilidade e da assessoria tributária
//   Planejamento          metas e cenários
//   Administração         o que muda o sistema para os outros, por último
//
// Veículos, motoristas e multas são da gestão (a operação); aqui fica o lado
// financeiro deles. Cada pessoa vê só os temas que o perfil dela alcança.
const NAV: NavItem[] = [
  { href: "/", label: "Painel financeiro", icon: LayoutDashboard, permissao: "painel" },
  // A fila de decisões: o que agentes e cargas propõem e uma pessoa aprova.
  { href: "/pendencias", label: "Pendências", icon: Inbox, permissao: "pendencias" },
  {
    label: "Financeiro",
    icon: CircleDollarSign,
    children: [
      { href: "/titulos", label: "Contas a pagar e receber", icon: Receipt, permissao: "titulos" },
      { href: "/conciliacao", label: "Conciliação bancária", icon: Landmark, permissao: "conciliacao" },
      { href: "/fluxo-caixa", label: "Fluxo de caixa", icon: Banknote, permissao: "fluxo-caixa" },
      // O caixa que já passou, mês a mês, e a auditoria de uma conta (a Omie.CASH).
      { href: "/caixa-mensal", label: "Caixa mês a mês", icon: Wallet, permissao: "fluxo-caixa" },
      // As dívidas da frota: os contratos são da gestão; aqui, conferidos na Omie.
      { href: "/frota/financiamentos", label: "Financiamentos e consórcios", icon: HandCoins, permissao: "financiamentos" },
    ],
  },
  {
    label: "Resultado",
    icon: ChartPie,
    children: [
      { href: "/custos", label: "Custos e DRE", icon: TrendingUp, permissao: "custos" },
      // O mesmo DRE aberto pelos centros de custo da folha — logo abaixo do DRE.
      { href: "/dre-centro-custo", label: "DRE por centro de custo", icon: Network, permissao: "custos" },
      { href: "/resultados", label: "Resultado mês a mês", icon: CalendarRange, permissao: "resultados" },
      { href: "/rentabilidade", label: "Rentabilidade por contrato", icon: PiggyBank, permissao: "rentabilidade" },
      // O retorno sobre o capital fecha o tema.
      { href: "/indicadores", label: "Indicadores", icon: Gauge, permissao: "indicadores" },
    ],
  },
  {
    label: "Pessoas e folha",
    icon: Users,
    children: [
      { href: "/cadastro/pessoas", label: "Pessoas", icon: Contact, permissao: "cadastro-pessoas" },
      // O checklist mensal do fluxograma da folha validado pelo RH e pela Contabilidade.
      { href: "/folha", label: "Fechamento da folha", icon: ClipboardCheck, permissao: "folha" },
    ],
  },
  {
    // O simulador custeia a operação que ainda não existe (licitação, contrato
    // novo, renovação) a partir dos custos que a controladoria mede.
    label: "Comercial",
    icon: Briefcase,
    children: [
      { href: "/simulador", label: "Simulador de custos", icon: Calculator, permissao: "simulador" },
      { href: "/simulador/base", label: "Custos base", icon: Database, permissao: "simulador" },
      { href: "/simulador/radar", label: "Radar de licitações", icon: Radar, permissao: "simulador" },
    ],
  },
  {
    label: "Auditoria",
    icon: ShieldCheck,
    children: [
      { href: "/auditoria", label: "Auditoria e achados", icon: ShieldCheck, permissao: "auditoria" },
      // O projeto (OS) do custo contra o da cobrança: serviço pago e não faturado.
      { href: "/conferencia-os", label: "Conferência de OS", icon: ListChecks, permissao: "titulos" },
      // Cada cobrança tem o documento fiscal que a justifica? A Omie não expõe
      // CT-e pela API: é a única tela que depende de alguém colar uma lista.
      { href: "/cte", label: "Conferência de CT-e", icon: FileCheck, permissao: "cte" },
      // Quem mudou o quê e quando (cadastro, pendências, ligação com a Omie).
      { href: "/auditoria/trilha", label: "Trilha de alterações", icon: History, permissao: "auditoria" },
    ],
  },
  {
    label: "Fiscal e conformidade",
    icon: Scale,
    children: [
      { href: "/conformidade", label: "Conformidade", icon: ScrollText, permissao: "conformidade" },
      // O projeto da mudança de regime em jan/2027 — antes só achável por
      // dentro de Conformidade.
      { href: "/conformidade/transicao", label: "Transição para o Lucro Real", icon: ArrowRightLeft, permissao: "conformidade" },
      // O Lucro Real da Azul: o que é dedutível, o que falta de documento, e
      // as formas lícitas de pagar menos.
      { href: "/lucro-real", label: "Auditoria de lucro real", icon: Percent, permissao: "conformidade" },
    ],
  },
  {
    label: "Planejamento",
    icon: Target,
    children: [
      { href: "/bsc", label: "Balanced Scorecard", icon: Target, permissao: "bsc" },
      { href: "/cenarios", label: "Cenários e orçamento", icon: Compass, permissao: "cenarios" },
    ],
  },
  {
    // Por último: o que muda como o sistema se comporta, e não o que ele
    // mostra sobre a empresa.
    label: "Administração",
    icon: Settings,
    children: [
      { href: "/cadastro", label: "Cadastro mestre", icon: Database, permissao: "cadastro" },
      { href: "/usuarios", label: "Usuários e acessos", icon: UsersRound, permissao: "gerir-usuarios" },
      { href: "/conexoes", label: "Conexões Omie", icon: Building2, permissao: "conexoes" },
      { href: "/sincronizacao", label: "Sincronização", icon: RefreshCw, permissao: "sincronizacao" },
      { href: "/relatorios", label: "Relatórios diários", icon: Mail, permissao: "relatorios" },
      { href: "/configuracao", label: "Modelo de gestão", icon: SlidersHorizontal, permissao: "gerir-modelo" },
    ],
  },
];

function isActive(pathname: string, href: string) {
  // O painel fica em "/" — sem match exato, ele apareceria ativo em toda rota
  // do sistema, já que todas começam com "/".
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

// O menu mostra o que a pessoa alcança — nem uma tela a mais. Tela visível que
// devolve "sem acesso" ensina a ignorar o menu, e num sistema financeiro ainda
// anuncia a existência de telas a quem não deveria saber que existem. Tema sem
// nenhuma tela visível some: aberto e vazio, ninguém sabe se é falta de
// permissão ou defeito.
function visiveis(permitidas: Set<string>): NavItem[] {
  return NAV.map((i) => (ehTema(i) ? { ...i, children: i.children.filter((c) => permitidas.has(c.permissao)) } : i)).filter((i) =>
    ehTema(i) ? i.children.length > 0 : permitidas.has(i.permissao)
  );
}

export default function Sidebar({ permissoes }: { permissoes: string[] }) {
  const pathname = usePathname() ?? "";
  const itens = visiveis(new Set(permissoes));

  // Só a tela MAIS específica que casa com a rota fica acesa: em
  // /simulador/base acende "Custos base", não também "Simulador de custos".
  const telas = itens.flatMap((i) => (ehTema(i) ? i.children : [i]));
  const ativoHref = telas.filter((t) => isActive(pathname, t.href)).sort((a, b) => b.href.length - a.href.length)[0]?.href;

  // Menu curto nasce aberto: agrupar ajuda quem tem trinta telas; para quem
  // tem quatro, só acrescenta um clique antes de cada uma. O tema da tela
  // aberta fica sempre aberto (abaixo), sem precisar estar aqui.
  const [abertos, setAbertos] = useState<Set<string>>(() =>
    telas.length <= 8 ? new Set(itens.filter(ehTema).map((t) => t.label)) : new Set()
  );
  const alternar = (chave: string) =>
    setAbertos((antes) => {
      const depois = new Set(antes);
      if (depois.has(chave)) depois.delete(chave);
      else depois.add(chave);
      return depois;
    });

  const classeDaTela = (ativa: boolean) => (ativa ? "bg-blue-700 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900");

  return (
    <nav className="flex h-full flex-col gap-1 overflow-y-auto p-3">
      {itens.map((item) => {
        const Icon = item.icon;
        if (!ehTema(item)) {
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${classeDaTela(item.href === ativoHref)}`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        }
        const temaAtivo = item.children.some((c) => c.href === ativoHref);
        const aberto = temaAtivo || abertos.has(item.label);
        return (
          <div key={item.label}>
            {/* A linha inteira abre e fecha: clicar no rótulo é o gesto
                natural; obrigar a acertar a seta seria um alvo pequeno à toa.
                Tema com a tela aberta dentro não fica azul (isso é da tela),
                mas escurece o texto: diz onde você está. */}
            <button
              type="button"
              onClick={() => alternar(item.label)}
              aria-expanded={aberto}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-slate-100 hover:text-slate-900 ${
                temaAtivo ? "text-slate-900" : "text-slate-600"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex-1">{item.label}</span>
              <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${aberto ? "rotate-180" : ""}`} />
            </button>
            {aberto && (
              <div className="ml-4 mt-1 flex flex-col gap-1 border-l border-slate-200 pl-3">
                {item.children.map((tela) => {
                  const TelaIcon = tela.icon;
                  return (
                    <Link
                      key={tela.href}
                      href={tela.href}
                      prefetch={false}
                      className={`flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${classeDaTela(tela.href === ativoHref)}`}
                    >
                      <TelaIcon className="h-3.5 w-3.5 shrink-0" />
                      {tela.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
