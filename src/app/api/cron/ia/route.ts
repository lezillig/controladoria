import { NextRequest, NextResponse } from "next/server";
import { autorizado } from "@/lib/controladoria/autorizacaoDoCiclo";
import { redigir } from "@/lib/controladoria/falhas";
import { listarEmpresasAtivas } from "@/lib/gestao/leitura";
import { coletarLotes } from "@/lib/ia/lote";
import { pedirParecerDoMesSeCouber } from "@/lib/controladoria/parecerMensal";
import { abrirTriagens, avancarUmaTriagem, avisarTriagens } from "@/lib/controladoria/triagem";
import { prisma } from "@/lib/prisma";

// O QUE A IA FAZ SOZINHA, fora do ciclo de sincronização.
//
// Três trabalhos, todos pagos e nenhum com alguém esperando na tela:
//   1. recolher os pedidos em lote que terminaram (parecer mensal, conferência
//      da leitura de conformidade);
//   2. a triagem dos achados críticos de antifraude — abrir as do dia, avançar
//      uma rodada de uma delas, e mandar o e-mail quando todas fecharem;
//   3. pedir o parecer mensal quando o mês vira.
//
// ROTA PRÓPRIA, e não mais um passo do ciclo, por causa do tempo: o ciclo
// trabalha em rodadas de 40 segundos (teto de 60), e uma única chamada do
// modelo maior passa disso. Aqui o teto é de 300 segundos, o mesmo da tela de
// investigar.
//
// QUEM CHAMA é o condutor do GitHub Actions, depois de conduzir o ciclo e a
// cada meia hora (ver .github/workflows/carga-controladoria.yml), em laço
// enquanto `continua` vier verdadeiro. Sem o condutor, o agendamento da Vercel
// chama uma vez por dia.
//
// A RESPOSTA SÓ TRAZ CONTAGENS. O log do condutor é público (o repositório
// é): nome de fornecedor, valor e texto de achado não saem daqui.
export const maxDuration = 300;

// Uma rodada de triagem de especialista fecha em até ~260 s (ver
// configuracaoDaChamada em investigador.ts). Só começa uma se ainda couber.
const LIMITE_PARA_COMECAR_TRIAGEM_MS = 20_000;

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const iniciado = Date.now();
  const empresas = await listarEmpresasAtivas();
  let continua = false;
  let triagemFeita = false;
  const resumo = { lotesColetados: 0, lotesNaFila: 0, triagensAbertas: 0, triagensEmAndamento: 0, triagensAvisadas: 0, pareceresPedidos: 0, avisos: [] as string[] };

  for (const empresa of empresas) {
    try {
      const lotes = await coletarLotes({ companyId: empresa.id });
      resumo.lotesColetados += lotes.coletados;
      resumo.lotesNaFila += lotes.pendentes;

      const parecer = await pedirParecerDoMesSeCouber(empresa.id);
      if (parecer.pedido) resumo.pareceresPedidos++;
      else if (parecer.aviso) resumo.avisos.push(`parecer mensal: ${parecer.aviso}`);

      const abertas = await abrirTriagens(empresa.id);
      resumo.triagensAbertas += abertas.abertas;
      if (abertas.motivo) resumo.avisos.push(`triagem: ${abertas.motivo}`);

      // UMA rodada de UMA triagem por invocação: é o que cabe no teto com
      // folga. Havendo mais, o condutor chama de novo.
      if (!triagemFeita && Date.now() - iniciado < LIMITE_PARA_COMECAR_TRIAGEM_MS) {
        triagemFeita = await avancarUmaTriagem(empresa.id);
      }
      const emAndamento = await prisma.investigacao.count({ where: { companyId: empresa.id, origem: "TRIAGEM", status: "EXECUTANDO" } });
      resumo.triagensEmAndamento += emAndamento;
      if (emAndamento > 0) continua = true;
      else resumo.triagensAvisadas += await avisarTriagens(empresa.id);
    } catch (e) {
      // Uma empresa que falha não impede as outras; o motivo sai redigido.
      resumo.avisos.push(`erro: ${redigir(e instanceof Error ? e.message : "erro desconhecido").slice(0, 200)}`);
    }
  }

  return NextResponse.json({ continua, duracaoMs: Date.now() - iniciado, ...resumo, avisos: [...new Set(resumo.avisos)] });
}
