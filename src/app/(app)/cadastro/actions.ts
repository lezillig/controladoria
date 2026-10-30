"use server";

import { revalidatePath } from "next/cache";
import { carregarParceiros, carregarPessoas, carregarVeiculos, pendenciaDeCentrosNaOmie, type ResultadoCarga } from "@/lib/cadastro/carga";
import { redigir } from "@/lib/controladoria/falhas";
import { disponibilidadeGestao } from "@/lib/gestao/leitura";
import { exigirPermissao } from "../_dados";

// ATUALIZAR O CADASTRO MESTRE A PARTIR DAS FONTES — uma fonte por chamada, para
// a tela mostrar o progresso (src/lib/cadastro/carga.ts).

export type Fonte = "parceiros" | "pessoas" | "veiculos" | "centros";
export type RespostaCarga = { resultados: ResultadoCarga[]; aviso?: string; erro?: string };

export async function carregarFonte(fonte: Fonte): Promise<RespostaCarga> {
  const session = await exigirPermissao("gerir-cadastro");
  try {
    if (fonte === "parceiros") return { resultados: await carregarParceiros(session.companyId, session.name) };
    if (fonte === "pessoas" || fonte === "veiculos") {
      const r = fonte === "pessoas" ? await carregarPessoas(session.companyId, session.name) : await carregarVeiculos(session.companyId, session.name);
      // Leitura vazia porque a gestão não respondeu não é "nada a carregar".
      const g = disponibilidadeGestao();
      return { resultados: [r], ...(r.lidos === 0 && !g.disponivel ? { erro: redigir(g.erro ?? "Sistema de gestão indisponível.").slice(0, 300) } : {}) };
    }
    const p = await pendenciaDeCentrosNaOmie(session.companyId);
    revalidatePath("/cadastro");
    revalidatePath("/pendencias");
    return { resultados: [], aviso: p ? `${p.quantos} centro(s) de custo ainda sem código da Omie — ${p.nova ? "pendência aberta" : "pendência atualizada"} para o financeiro.` : "Todos os centros de custo já têm código da Omie." };
  } catch (e) {
    return { resultados: [], erro: redigir(e instanceof Error ? e.message : "erro").slice(0, 300) };
  }
}
