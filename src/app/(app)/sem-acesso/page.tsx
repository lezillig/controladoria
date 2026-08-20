import { ShieldOff } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { cardClass } from "@/lib/ui";

export default async function SemAcessoPage() {
  await requireSession();

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <div className={`${cardClass} flex flex-col items-center gap-3`}>
        <ShieldOff className="h-8 w-8 text-slate-400" />
        <p className="font-medium text-slate-800">Sem área liberada</p>
        <p className="text-sm text-slate-500">
          Seu tipo de conta ainda não tem acesso a nenhuma área deste sistema. Fale com o administrador.
        </p>
      </div>
    </div>
  );
}
