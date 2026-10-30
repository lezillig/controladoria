"use server";

import { conferirTitulosNaOmie, TITULOS_POR_LEVA, type TituloConferido } from "@/lib/controladoria/conferenciaOsOmie";
import { redigir } from "@/lib/controladoria/falhas";
import { exigirPermissao } from "../_dados";

// UMA LEVA DE TÍTULOS DA OS CONFERIDA NA OMIE por chamada: a tela manda as
// levas em sequência e mostra o progresso, em vez de uma página que espera.
export async function conferirLevaNaOmie(ids: string[]): Promise<{ titulos: TituloConferido[]; erro?: string }> {
  const session = await exigirPermissao("titulos");
  try {
    return { titulos: await conferirTitulosNaOmie({ companyId: session.companyId, ids: ids.slice(0, TITULOS_POR_LEVA), prazo: Date.now() + 45_000 }) };
  } catch (e) {
    return { titulos: [], erro: redigir(e instanceof Error ? e.message : "erro").slice(0, 200) };
  }
}
