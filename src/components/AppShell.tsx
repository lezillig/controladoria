"use client";

import { useState } from "react";
import Sidebar from "@/components/Sidebar";
import Topbar from "@/components/Topbar";

export default function AppShell({
  name,
  role,
  orgName,
  children,
}: {
  name: string;
  role: string;
  orgName: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex h-dvh flex-col">
      <Topbar
        name={name}
        role={role}
        orgName={orgName}
        onMenuClick={() => setOpen((v) => !v)}
      />
      <div className="flex flex-1 overflow-hidden">
        <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white lg:block">
          <Sidebar role={role} />
        </aside>
        {open && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div
              className="absolute inset-0 bg-black/30"
              onClick={() => setOpen(false)}
            />
            <aside className="absolute left-0 top-0 h-full w-64 bg-white shadow-xl">
              <Sidebar role={role} />
            </aside>
          </div>
        )}
        <main className="flex-1 overflow-y-auto bg-slate-50 p-4 sm:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
