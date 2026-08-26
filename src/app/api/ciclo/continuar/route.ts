import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { acessoDaSessao } from "@/app/(app)/_dados";
import { dispararProximaInvocacao } from "@/lib/controladoria/encadear";

// Passa a carga da aba para o ciclo em segundo plano.
//
// Enquanto a aba está aberta, é ela que conduz: chama a sincronização em
// corrente, uma rodada após a outra. Ela não encadeia o ciclo do servidor de
// propósito — dois motores sobre a mesma execução gastam invocação e
// embaralham o diagnóstico.
//
// O problema é o momento em que a aba se fecha. Sem ninguém para chamar a
// rodada seguinte, a carga simplesmente para, e a próxima retomada só viria no
// ciclo da madrugada. Esta rota existe para o último ato da aba: avisar o
// servidor de que ele assume daqui.
//
// É chamada por `sendBeacon`, que é a única forma de a página enviar algo
// durante o descarregamento com alguma garantia de entrega — um fetch comum
// nesse momento costuma ser cancelado junto com a página.
export async function POST() {
  // Sessão, não CRON_SECRET: quem chama é o navegador de uma pessoa logada, e
  // o segredo do cron não pode circular no cliente.
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // A MESMA regra da tela, e não o papel cru: um perfil que não dá acesso à
  // tela não pode dar acesso ao conteúdo dela por uma rota direta.
  const acesso = await acessoDaSessao(session);
  if (!acesso.permissoes.has("sincronizar")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const resultado = dispararProximaInvocacao({ companyId: session.companyId });

  // 202: o trabalho foi aceito, não concluído. A resposta não é lida por
  // ninguém — `sendBeacon` não entrega retorno — mas o código certo mantém o
  // log da hospedagem legível.
  return NextResponse.json({ disparado: resultado.disparado, motivo: resultado.motivo ?? null }, { status: 202 });
}
