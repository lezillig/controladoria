import Link from "next/link";
import { exigirPermissao } from "../../_dados";
import { larguraPainel } from "@/lib/ui";
import NovoEstudoForm from "./NovoEstudoForm";

export default async function NovoEstudoPage() {
  await exigirPermissao("gerir-simulador");
  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div>
        <Link href="/simulador" className="text-xs font-medium text-blue-700 hover:underline">
          ← Simulador
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-slate-900">Novo estudo de custo</h1>
        <p className="mt-1 text-sm text-slate-500">
          O essencial para começar. Rotas, veículos e premissas vêm no passo seguinte, na tabela do estudo — que já abre com os custos da
          base da Azul Mob.
        </p>
      </div>
      <NovoEstudoForm />
    </div>
  );
}
