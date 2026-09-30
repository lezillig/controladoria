import Link from "next/link";
import { ShieldOff } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { rotaInicial } from "@/lib/acessos";
import { cardClass, primaryButtonClass } from "@/lib/ui";
import { acessoDaSessao } from "../_dados";

export default async function SemAcessoPage() {
  const session = await requireSession();

  // DUAS SITUAÇÕES DIFERENTES chegam aqui, e a tela dizia a mesma coisa para
  // as duas. Quem não alcança tela nenhuma lia "sem área liberada" — certo.
  // Mas quem tem perfil sem o Painel também cai aqui LOGO APÓS O LOGIN (o
  // login sempre abre "/"), e lia que não tinha acesso a nada enquanto o menu
  // ao lado mostrava as telas que ele alcança. Agora a tela diz qual das duas
  // é e leva à primeira tela liberada.
  const destino = rotaInicial((await acessoDaSessao(session)).permissoes);

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <div className={`${cardClass} flex flex-col items-center gap-3`}>
        <ShieldOff className="h-8 w-8 text-slate-400" />
        {destino ? (
          <>
            <p className="font-medium text-slate-800">Esta tela não está no seu perfil</p>
            <p className="text-sm text-slate-500">
              As telas que você alcança estão no menu. Se precisar desta, fale com quem administra os acessos.
            </p>
            <Link href={destino.href} className={primaryButtonClass}>
              Ir para {destino.rotulo}
            </Link>
          </>
        ) : (
          <>
            <p className="font-medium text-slate-800">Sem área liberada</p>
            <p className="text-sm text-slate-500">
              Seu tipo de conta ainda não tem acesso a nenhuma área deste sistema. Fale com o administrador.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
