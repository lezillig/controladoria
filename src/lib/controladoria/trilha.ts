// NÃO é "use server": nada aqui vira ação chamável pelo navegador. A trilha
// grava para a empresa que o CHAMADOR informa, e só pode ser chamada de código
// do servidor que já validou a sessão.
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";

// Registro append-only de ação humana no módulo. Fica em função separada e
// reutilizável porque toda ação de escrita da Controladoria passa por ela —
// esquecer a trilha numa delas deixaria um buraco justamente onde a pergunta
// "quem desligou este alerta?" precisa de resposta.
export async function registrarEvento(params: {
  companyId: string;
  userId?: string | null;
  userNome?: string | null;
  userEmail?: string | null;
  acao: string;
  entidadeTipo?: string;
  entidadeId?: string;
  descricao: string;
  antes?: unknown;
  depois?: unknown;
}): Promise<void> {
  // IP e user-agent vêm do cabeçalho da requisição: sem eles, "quem" fica
  // registrado mas "de onde" não — e é justamente o que importa quando a
  // credencial em si é o que está sob suspeita.
  const cabecalhos = await headers();
  const ip =
    cabecalhos.get("x-forwarded-for")?.split(",")[0]?.trim() ?? cabecalhos.get("x-real-ip") ?? null;

  await prisma.controladoriaEventLog.create({
    data: {
      companyId: params.companyId,
      userId: params.userId ?? null,
      userNome: params.userNome ?? null,
      userEmail: params.userEmail ?? null,
      acao: params.acao,
      entidadeTipo: params.entidadeTipo ?? null,
      entidadeId: params.entidadeId ?? null,
      descricao: params.descricao,
      antes: params.antes === undefined ? undefined : JSON.parse(JSON.stringify(params.antes)),
      depois: params.depois === undefined ? undefined : JSON.parse(JSON.stringify(params.depois)),
      ip,
      userAgent: cabecalhos.get("user-agent")?.slice(0, 300) ?? null,
    },
  });
}
