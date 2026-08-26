"use server";

import {
  conferirCte,
  lerListaDeCte,
  DIAS_DE_TOLERANCIA,
  type ResultadoConferencia,
} from "@/lib/controladoria/cte";
import { fimDoDia, inicioDoDia } from "@/lib/controladoria/periodos";
import { fmtData } from "@/lib/controladoria/format";
import { exigirPermissao, resolverEscopo } from "../_dados";
import { registrarEvento } from "../auditoria/actions";

export type EstadoConferencia = {
  resultado?: ResultadoConferencia;
  ignoradas?: string[];
  periodo?: { inicio: string; fim: string };
  erro?: string;
};

// A lista COLADA, e não arquivo enviado.
//
// É como a pessoa já trabalha: abre a tela da Omie, seleciona, copia. Exigir
// um arquivo acrescentaria um passo — salvar, achar, enviar — para um dado que
// ela já tem na área de transferência. E o leitor tolera tabulação, ponto e
// vírgula e vírgula justamente porque colar de uma tela dá tabulação e exportar
// dá ponto e vírgula.
//
// Nada é gravado. A conferência é uma leitura: cruza o que foi colado com o que
// está espelhado e devolve as diferenças. O conserto é na Omie, e é de gente.
export async function conferirListaDeCte(formData: FormData): Promise<EstadoConferencia> {
  const session = await exigirPermissao("conferir-cte");

  const texto = String(formData.get("lista") ?? "");
  if (texto.trim() === "") return { erro: "Cole a relação de CT-e da Omie." };

  const { itens, ignoradas } = lerListaDeCte(texto);
  if (itens.length === 0) {
    return {
      erro:
        "Não consegui ler nenhuma linha. A relação precisa vir com o cabeçalho das colunas — " +
        "número do CT-e, data, valor e status.",
      ignoradas,
    };
  }

  const escopo = await resolverEscopo(session.companyId, String(formData.get("empresa") ?? "") || undefined);

  // O PERÍODO VEM DA LISTA, não do filtro da tela.
  //
  // Quem cola cinco meses espera conferir cinco meses. Recortar em silêncio no
  // mês do filtro faria a tela acusar como "sem título" tudo que caiu fora — um
  // falso alarme por linha, que é o jeito mais rápido de fazer alguém parar de
  // usar uma conferência.
  //
  // A folga dos dois lados é a mesma tolerância do casamento por valor+data:
  // sem ela, um título emitido três dias depois do último CT-e da lista ficaria
  // fora da consulta e o CT-e apareceria como não cobrado.
  const datas = itens.map((i) => i.data.getTime());
  const folga = DIAS_DE_TOLERANCIA * 86_400_000;
  const inicio = inicioDoDia(new Date(Math.min(...datas) - folga));
  const fim = fimDoDia(new Date(Math.max(...datas) + folga));

  const resultado = await conferirCte({
    companyId: session.companyId,
    conexaoId: escopo.conexaoId,
    periodo: { inicio, fim, rotulo: "período da lista" },
    lista: itens,
  });

  const conta = (tipo: string) => resultado.linhas.filter((l) => l.tipo === tipo).length;
  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "CTE_CONFERIDO",
    descricao:
      `Conferência de ${itens.length} CT-e (${fmtData(inicio)} a ${fmtData(fim)}` +
      `${escopo.apelido ? `, ${escopo.apelido}` : ""}): ${resultado.casados} casados, ` +
      `${conta("cancelado_com_titulo")} cancelados com título vivo, ` +
      `${conta("valor_divergente")} com valor divergente, ` +
      `${conta("autorizado_sem_titulo")} sem título, ` +
      `${conta("titulo_sem_cte")} títulos sem CT-e na lista.`,
  });

  return {
    resultado,
    ignoradas,
    periodo: { inicio: fmtData(inicio), fim: fmtData(fim) },
  };
}
