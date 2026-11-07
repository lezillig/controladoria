"use server";

import { conferirTitulosNaOmie, TITULOS_POR_LEVA, type TituloConferido } from "@/lib/controladoria/conferenciaOsOmie";
import { redigir } from "@/lib/controladoria/falhas";
import { registrarEvento } from "@/lib/controladoria/trilha";
import { exigirPermissao } from "../_dados";

// UMA LEVA DE TÍTULOS DA OS CONFERIDA NA OMIE por chamada: a tela manda as
// levas em sequência e mostra o progresso, em vez de uma página que espera.
//
// É AÇÃO, não leitura: consome a cota da Omie e GRAVA no espelho (corrige
// valor, projeto e vencimento; marca o que foi excluído lá). Por isso pede a
// permissão de sincronizar — a tela sozinha ("titulos") é de quem só lê — e o
// que mudou vai para a trilha com quem pediu.
export async function conferirLevaNaOmie(ids: string[]): Promise<{ titulos: TituloConferido[]; erro?: string }> {
  const session = await exigirPermissao("sincronizar");
  try {
    const titulos = await conferirTitulosNaOmie({ companyId: session.companyId, ids: ids.slice(0, TITULOS_POR_LEVA), prazo: Date.now() + 45_000 });
    const mudaram = titulos.filter((t) => t.situacao === "corrigido" || t.situacao === "excluido");
    if (mudaram.length > 0) {
      await registrarEvento({
        companyId: session.companyId,
        userId: session.userId,
        userNome: session.name,
        userEmail: session.email,
        acao: "TITULO_CONFERIDO_NA_OMIE",
        entidadeTipo: "OmieTitulo",
        descricao: `Conferência de OS na Omie: ${mudaram.filter((t) => t.situacao === "corrigido").length} título(s) corrigido(s) e ${mudaram.filter((t) => t.situacao === "excluido").length} marcado(s) como excluído(s) na Omie`,
        depois: mudaram.map((t) => ({ id: t.id, situacao: t.situacao, mudancas: t.mudancas })),
      }).catch(() => {
        // a correção já está gravada; a trilha não pode desfazê-la
      });
    }
    return { titulos };
  } catch (e) {
    return { titulos: [], erro: redigir(e instanceof Error ? e.message : "erro").slice(0, 200) };
  }
}
