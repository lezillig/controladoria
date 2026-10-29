"use server";

import { conferirComOmie, type Criterio, type Diferenca, type Natureza } from "@/lib/controladoria/conferenciaOmie";
import { redigir } from "@/lib/controladoria/falhas";
import { exigirPermissao } from "../../_dados";

// UMA LEITURA DA CONFERÊNCIA COM A OMIE (uma empresa, uma natureza, um
// critério) por chamada: a tela chama as oito em sequência e mostra cada uma
// ao terminar, em vez de esperar minutos por uma página só.
export type LeituraOmie = {
  empresa: string;
  natureza: Natureza;
  criterio: Criterio;
  totalOmieCents: number;
  totalSistemaCents: number;
  titulosOmie: number;
  titulosSistema: number;
  incompleto: boolean;
  divergencias: number;
  diferencas: Diferenca[];
  erro?: string;
};

export async function conferirLeitura(p: { conexaoId: string; natureza: Natureza; criterio: Criterio; ano: number; mes: number }): Promise<LeituraOmie> {
  const session = await exigirPermissao("custos");
  try {
    const r = await conferirComOmie({ companyId: session.companyId, ...p, prazo: Date.now() + 50_000 });
    return {
      empresa: r.empresa,
      natureza: p.natureza,
      criterio: p.criterio,
      totalOmieCents: r.totalOmieCents,
      totalSistemaCents: r.totalSistemaCents,
      titulosOmie: r.titulosOmie,
      titulosSistema: r.titulosSistema,
      incompleto: r.incompleto,
      divergencias: r.diferencas.length,
      diferencas: r.diferencas.slice(0, 200),
    };
  } catch (e) {
    return { empresa: "?", natureza: p.natureza, criterio: p.criterio, totalOmieCents: 0, totalSistemaCents: 0, titulosOmie: 0, titulosSistema: 0, incompleto: true, divergencias: 0, diferencas: [], erro: redigir(e instanceof Error ? e.message : "erro").slice(0, 200) };
  }
}
