"use server";

import {
  avancarInvestigacao,
  iniciarInvestigacao,
  type EstadoInvestigacao,
} from "@/lib/controladoria/investigador";
import { exigirPermissao, resolverEscopo } from "../../_dados";
import { registrarEvento } from "@/lib/controladoria/trilha";

const TAMANHO_MAXIMO_DA_PERGUNTA = 2000;

export type RespostaDaAction = { estado?: EstadoInvestigacao; erro?: string };

// Cria a investigação e devolve o id. Não chama o modelo: a primeira rodada é
// pedida em seguida pelo navegador, como todas as outras. Assim a criação é
// instantânea e a pergunta fica gravada antes de qualquer custo.
export async function iniciar(formData: FormData): Promise<RespostaDaAction> {
  const session = await exigirPermissao("investigar");

  const pergunta = String(formData.get("pergunta") ?? "").trim();
  if (pergunta.length < 8) return { erro: "Escreva a pergunta com um pouco mais de contexto." };
  if (pergunta.length > TAMANHO_MAXIMO_DA_PERGUNTA) {
    return { erro: `A pergunta passou de ${TAMANHO_MAXIMO_DA_PERGUNTA} caracteres.` };
  }

  try {
    const escopo = await resolverEscopo(session.companyId, String(formData.get("empresa") ?? "") || undefined);
    const estado = await iniciarInvestigacao({
      companyId: session.companyId,
      conexaoId: escopo.conexaoId,
      empresa: escopo.apelido ?? "grupo (as duas empresas)",
      pergunta,
      userId: session.userId,
      userNome: session.name,
    });

    // A trilha registra a pergunta no ato. O que a IA consultou fica na
    // própria investigação, que é consultável pela tela.
    try {
      await registrarEvento({
        companyId: session.companyId,
        userId: session.userId,
        userNome: session.name,
        userEmail: session.email,
        acao: "INVESTIGACAO_IA",
        entidadeTipo: "Investigacao",
        entidadeId: estado.id,
        descricao: `Pergunta ao investigador${escopo.apelido ? ` (${escopo.apelido})` : ""}: "${pergunta.slice(0, 200)}"`,
      });
    } catch {
      // A trilha não pode custar a pergunta.
    }

    return { estado };
  } catch (e) {
    return { erro: `Não consegui registrar a pergunta: ${mensagem(e)}` };
  }
}

// Uma rodada. O navegador chama de novo enquanto o status for EXECUTANDO.
export async function avancar(id: string): Promise<RespostaDaAction> {
  const session = await exigirPermissao("investigar");
  try {
    return { estado: await avancarInvestigacao(id, session.companyId) };
  } catch (e) {
    // ERRO VIRA RESPOSTA, NUNCA EXCEÇÃO — a action que lança some no cliente.
    return { erro: `A rodada não completou: ${mensagem(e)}` };
  }
}

function mensagem(e: unknown): string {
  const texto = e instanceof Error ? e.message : String(e);
  const digest = (e as { digest?: string })?.digest;
  return `${texto.slice(0, 300)}${digest ? ` (identificador ${digest})` : ""}`;
}
