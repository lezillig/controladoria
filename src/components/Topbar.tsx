"use client";

import { useRouter } from "next/navigation";
import { Bus, LogOut, Menu } from "lucide-react";
import { ROLE_LABELS } from "@/lib/permissions";

export default function Topbar({
  name,
  role,
  orgName,
  onMenuClick,
}: {
  name: string;
  role: string;
  orgName: string;
  onMenuClick?: () => void;
}) {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden"
          aria-label="Abrir menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-700 text-white">
          <Bus className="h-4 w-4" />
        </div>
        <span className="hidden text-sm font-semibold text-slate-700 sm:inline">
          {orgName} · Gestão de Motoristas
        </span>
      </div>

      <div className="flex items-center gap-4">
        <div className="hidden text-right sm:block">
          <p className="text-sm font-medium text-slate-800">{name}</p>
          <p className="text-xs text-slate-500">{ROLE_LABELS[role] ?? role}</p>
        </div>
        <button
          onClick={handleLogout}
          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
          aria-label="Sair"
          title="Sair"
        >
          <LogOut className="h-5 w-5" />
        </button>
      </div>
    </header>
  );
}
