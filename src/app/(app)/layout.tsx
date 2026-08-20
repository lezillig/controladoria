import { requireSession } from "@/lib/auth";
import { buscarEmpresa } from "@/lib/gestao/leitura";
import AppShell from "@/components/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  // O nome da empresa vem do cadastro da gestão. Indisponível, o sistema
  // continua funcionando com o nome genérico — nome no cabeçalho não é motivo
  // para derrubar a tela inteira.
  const empresa = await buscarEmpresa(session.companyId);

  return (
    <AppShell name={session.name} role={session.role} orgName={empresa?.name ?? "Controladoria"}>
      {children}
    </AppShell>
  );
}
