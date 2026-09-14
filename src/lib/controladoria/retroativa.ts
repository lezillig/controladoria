import { prisma } from "@/lib/prisma";
import { dataReferenciaPadrao } from "./ciclo";
import { carregarContexto, garantirConfig } from "./contexto";
import { executarAuditoria, type ResultadoAuditoria } from "./engine";
import { fimDoDia, inicioDoDia } from "./periodos";

// AUDITORIA RETROATIVA — olhar o passado com as regras de hoje.
//
// O ciclo diário protege o presente: audita o ano corrente, todo dia. Mas um
// desvio que começou em 2024 não aparece nele, e a pergunta "isso já vinha
// acontecendo?" é a primeira que se faz diante de um achado. Esta varredura
// responde: carrega um ano fechado inteiro (títulos, baixas, notas, extrato e
// cartão de frota daquele ano) e roda os mesmos agentes sobre ele, no modo
// retroativo do motor (ver engine.ts): só fatos datados (EVENTO) são gravados,
// nada do "agora" é sobrescrito nem fechado.
//
// Um ano por vez, de propósito. A base inteira não cabe numa invocação (foi
// isso que fez o ciclo parar de fechar antes da janela existir), e um ano é
// a unidade que uma pessoa consegue triar: a tela de auditoria filtra por
// período, e a Concentração por regra mostra onde 2024 foi diferente de 2025.
//
// Achados retroativos entram na mesma fila, com a mesma tratativa e a mesma
// trilha — um desvio antigo tratado agora é o que fecha a porta para o
// próximo igual.

export type ResultadoRetroativo = {
  ano: number;
  titulos: number;
  baixas: number;
  abastecimentos: number;
  resultado: ResultadoAuditoria;
  msContexto: number;
  msAuditoria: number;
};

export function anosAuditaveis(dataInicioBase: Date, agora = new Date()): number[] {
  const primeiro = dataInicioBase.getFullYear();
  const ultimo = dataReferenciaPadrao(agora).getFullYear();
  const anos: number[] = [];
  for (let a = primeiro; a <= ultimo; a++) anos.push(a);
  return anos;
}

export async function executarAuditoriaRetroativa(companyId: string, ano: number): Promise<ResultadoRetroativo> {
  const config = await garantirConfig(companyId);
  const anos = anosAuditaveis(config.dataInicioBase);
  if (!anos.includes(ano)) {
    throw new Error(`O ano ${ano} está fora da base carregada (${anos[0]}–${anos[anos.length - 1]}).`);
  }

  const inicioContexto = Date.now();
  // A data de referência continua sendo a de hoje: é ela que diz "vencido",
  // "há quanto tempo" — e é por isso que o motor descarta os achados de ESTADO
  // desta rodada, que descreveriam o hoje a partir de um recorte antigo.
  const ctx = await carregarContexto(companyId, dataReferenciaPadrao(), undefined, {
    desde: inicioDoDia(new Date(ano, 0, 1)),
    ate: fimDoDia(new Date(ano, 11, 31)),
    operacaoCompleta: true,
  });
  const msContexto = Date.now() - inicioContexto;

  const inicioAuditoria = Date.now();
  const resultado = await executarAuditoria(ctx, { retroativa: true });
  const msAuditoria = Date.now() - inicioAuditoria;

  console.log(
    `[auditoria retroativa] ${ano}: contexto ${msContexto}ms (${ctx.titulos.length} títulos, ${ctx.baixas.length} baixas, ` +
      `${ctx.abastecimentos.length} abastecimentos), agentes ${msAuditoria}ms — ${resultado.novos} novo(s), ` +
      `${resultado.reincidentes} reincidente(s), ${resultado.fechadosAutomaticamente} fechado(s)`
  );

  return {
    ano,
    titulos: ctx.titulos.length,
    baixas: ctx.baixas.length,
    abastecimentos: ctx.abastecimentos.length,
    resultado,
    msContexto,
    msAuditoria,
  };
}

// Quantos achados abertos têm fato datado em cada ano — é o que a tela mostra
// ao lado do seletor, para a pessoa saber o que a varredura já produziu.
export async function achadosAbertosPorAno(companyId: string): Promise<Map<number, number>> {
  const linhas = await prisma.auditFinding.findMany({
    where: { companyId, status: { in: ["ABERTO", "EM_ANALISE"] }, dataReferencia: { not: null } },
    select: { dataReferencia: true },
  });
  const porAno = new Map<number, number>();
  for (const l of linhas) {
    const ano = (l.dataReferencia as Date).getFullYear();
    porAno.set(ano, (porAno.get(ano) ?? 0) + 1);
  }
  return porAno;
}
