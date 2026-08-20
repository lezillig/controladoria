import { redirect } from "next/navigation";
import { Bus } from "lucide-react";
import { getSession } from "@/lib/auth";
import LoginForm from "./LoginForm";

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/");

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-xl bg-blue-700 text-white">
            <Bus className="h-7 w-7" />
          </div>
          <h1 className="text-lg font-semibold text-slate-900">Gestão de Motoristas</h1>
          <p className="mt-1 text-sm text-slate-500">Controle operacional de fretamento</p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
