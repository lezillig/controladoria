"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Banknote,
  Building2,
  Landmark,
  LayoutDashboard,
  Mail,
  PiggyBank,
  Receipt,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  TrendingUp,
} from "lucide-react";
import { canManageControladoria } from "@/lib/permissions";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  // Sem esta marca, o item aparece para todo mundo que consegue entrar — a
  // permissão de entrada já foi filtrada no login.
  somenteGestao?: boolean;
};

// Ordem por fluxo de trabalho, não alfabética: quem abre o sistema de manhã vai
// primeiro ao painel, depois ao que exige decisão, e só no fim às telas de
// configuração.
const NAV: NavItem[] = [
  { href: "/", label: "Painel financeiro", icon: LayoutDashboard },
  { href: "/auditoria", label: "Auditoria e achados", icon: ShieldCheck },
  { href: "/titulos", label: "Contas a pagar e receber", icon: Receipt },
  { href: "/fluxo-caixa", label: "Fluxo de caixa", icon: Banknote },
  { href: "/conciliacao", label: "Conciliação bancária", icon: Landmark },
  { href: "/custos", label: "Custos e DRE", icon: TrendingUp },
  { href: "/rentabilidade", label: "Rentabilidade por contrato", icon: PiggyBank },
  { href: "/bsc", label: "Balanced Scorecard", icon: Target },
  { href: "/relatorios", label: "Relatórios diários", icon: Mail },
  { href: "/sincronizacao", label: "Sincronização", icon: RefreshCw },
  { href: "/conexoes", label: "Conexões Omie", icon: Building2 },
  { href: "/configuracao", label: "Modelo de gestão", icon: SlidersHorizontal, somenteGestao: true },
];

function isActive(pathname: string, href: string) {
  // O painel fica em "/" — sem match exato, ele apareceria ativo em toda rota
  // do sistema, já que todas começam com "/".
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export default function Sidebar({ role }: { role: string }) {
  const pathname = usePathname() ?? "";
  const podeGerir = canManageControladoria(role);
  const itens = NAV.filter((i) => !i.somenteGestao || podeGerir);

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
