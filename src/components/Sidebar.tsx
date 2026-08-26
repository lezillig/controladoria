"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Banknote,
  Building2,
  CalendarRange,
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
};

// Ordem por fluxo de trabalho, não alfabética: quem abre o sistema de manhã vai
// primeiro ao painel, depois ao que exige decisão, e só no fim às telas de
// configuração.
const NAV: NavItem[] = [
  { href: "/", label: "Painel financeiro", icon: LayoutDashboard, permissao: "painel" },
  { href: "/auditoria", label: "Auditoria e achados", icon: ShieldCheck, permissao: "auditoria" },
  // Logo depois da auditoria de propósito: são as duas leituras do mesmo risco
  // — a que o sistema faz nos dados e a que a consultoria faz na empresa — e
  // quem abre uma quase sempre quer conferir a outra.
  { href: "/conformidade", label: "Conformidade", icon: ScrollText, permissao: "conformidade" },
  // Entre o painel e as contas: o painel responde "como está hoje", esta
  // responde "como viemos até aqui". É a pergunta que se faz logo depois de
  // olhar o mês, e antes de descer ao título individual.
  { href: "/resultados", label: "Resultado mês a mês", icon: CalendarRange, permissao: "resultados" },
  { href: "/titulos", label: "Contas a pagar e receber", icon: Receipt, permissao: "titulos" },
  // Colada nos títulos de propósito: é a mesma pergunta vista do outro lado —
  // ali estão as cobranças, aqui está se cada uma tem documento fiscal que a
  // justifique. A Omie não expõe CT-e pela API, então esta é a única tela do
  // sistema que depende de alguém colar uma lista.
  { href: "/cte", label: "Conferência de CT-e", icon: FileCheck, permissao: "cte" },
  { href: "/fluxo-caixa", label: "Fluxo de caixa", icon: Banknote, permissao: "fluxo-caixa" },
  { href: "/conciliacao", label: "Conciliação bancária", icon: Landmark, permissao: "conciliacao" },
  { href: "/custos", label: "Custos e DRE", icon: TrendingUp, permissao: "custos" },
  { href: "/rentabilidade", label: "Rentabilidade por contrato", icon: PiggyBank, permissao: "rentabilidade" },
  { href: "/bsc", label: "Balanced Scorecard", icon: Target, permissao: "bsc" },
  { href: "/relatorios", label: "Relatórios diários", icon: Mail, permissao: "relatorios" },
  { href: "/sincronizacao", label: "Sincronização", icon: RefreshCw, permissao: "sincronizacao" },
  { href: "/conexoes", label: "Conexões Omie", icon: Building2, permissao: "conexoes" },
  { href: "/configuracao", label: "Modelo de gestão", icon: SlidersHorizontal, permissao: "gerir-modelo" },
  // Por último, e junto com o modelo de gestão: as duas telas que mudam como o
  // sistema se comporta para os outros, e não o que ele mostra sobre a empresa.
  { href: "/usuarios", label: "Usuários e acessos", icon: UsersRound, permissao: "gerir-usuarios" },
];

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
  const itens = NAV.filter((i) => permitidas.has(i.permissao));

  return (
    <nav className="flex h-full flex-col gap-1 p-3">
      {itens.map((item) => {
        const Icon = item.icon;
        const ativo = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            prefetch={false}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              ativo ? "bg-blue-700 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
