"use server";

import { investigar, type ResultadoInvestigacao } from "@/lib/controladoria/investigador";
import { exigirPermissao, resolverEscopo } from "../../_dados";
import { registrarEvento } from "../actions";

const TAMANHO_MAXIMO_DA_PERGUNTA = 2000;

// A pergunta vai para a IA e a resposta volta para a tela. Nada é gravado
// além da trilha: quem perguntou, o quê, e o que a IA consultou para
// responder. É a mesma razão da conferência de CT-e — a tela é de leitura, e
// o que ela produz é uma resposta para ler ao lado da Omie, não um registro.
export async function perguntarAoInvestigador(formData: FormData): Promise<ResultadoInvestigacao> {
  const session = await exigirPermissao("investigar");

  const pergunta = String(formData.get("pergunta") ?? "").trim();
  if (pergunta.length < 8) return { ok: false, erro: "Escreva a pergunta com um pouco mais de contexto.", consultas: [] };
  if (pergunta.length > TAMANHO_MAXIMO_DA_PERGUNTA) {
    return { ok: false, erro: `A pergunta passou de ${TAMANHO_MAXIMO_DA_PERGUNTA} caracteres.`, consultas: [] };
  }

  const escopo = await resolverEscopo(session.companyId, String(formData.get("empresa") ?? "") || undefined);

  let resultado: ResultadoInvestigacao;
  try {
    resultado = await investigar({
      companyId: session.companyId,
      conexaoId: escopo.conexaoId,
      empresa: escopo.apelido ?? "grupo (as duas empresas)",
      pergunta,
    });
  } catch (e) {
    // Erro vira resposta, nunca exceção — a action que lança some no cliente
    // sem mensagem (ver a conferência de CT-e).
    const texto = e instanceof Error ? e.message : String(e);
    const digest = (e as { digest?: string })?.digest;
    return { ok: false, erro: `A investigação não completou: ${texto.slice(0, 300)}${digest ? ` (identificador ${digest})` : ""}`, consultas: [] };
  }

  try {
    await registrarEvento({
      companyId: session.companyId,
      userId: session.userId,
      userNome: session.name,
      userEmail: session.email,
      acao: "INVESTIGACAO_IA",
      descricao:
        `Pergunta ao investigador${escopo.apelido ? ` (${escopo.apelido})` : ""}: "${pergunta.slice(0, 200)}"` +
        ` — ${resultado.consultas.length} consulta(s)${resultado.ok ? "" : `; falhou: ${resultado.erro.slice(0, 120)}`}`,
      depois: { consultas: resultado.consultas.map((c) => ({ ferramenta: c.ferramenta, resumo: c.resumo })) },
    });
  } catch {
    // A trilha não pode custar a resposta.
  }

  return resultado;
}
