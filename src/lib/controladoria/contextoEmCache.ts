import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tabela } from "@/lib/esquemaDoBanco";
import { carregarContexto } from "./contexto";
import type { ContextoAuditoria } from "./types";

// O CONTEXTO DAS TELAS, REAPROVEITADO ENTRE CLIQUES.
//
// Seis telas (painel, títulos, fluxo de caixa, conciliação, BSC,
// rentabilidade) montavam a cada clique o retrato inteiro: umas 35 consultas,
// todos os títulos do ano, 400 dias de extrato, a operação da gestão. Medido
// com 50 mil títulos e o banco na mesma máquina: 1 a 2,7 s por montagem e
// centenas de MB de memória — em produção, com a rede até o Neon, mais. E o
// dado é o espelho de D-1: entre uma sincronização e outra, ele não muda.
//
// Por isso a instância do servidor guarda o último retrato montado e o
// reaproveita enquanto a VERSÃO DOS DADOS for a mesma — uma consulta só, com
// o que muda o retrato: a sincronização (que grava a cada passo), a
// classificação do DRE, os vínculos de centro de custo, as conexões, a
// configuração e as correções feitas em título pela conferência de OS. O que
// vem da gestão (abastecimento, escala, ponto) muda ao longo do dia e não tem
// versão aqui: a validade de VALIDADE_MS limita o atraso.
//
// Só as TELAS usam este caminho. A auditoria, o relatório e a retroativa
// chamam `carregarContexto` direto: decidem sobre o dado do momento.
//
// O retrato é COMPARTILHADO entre requisições: quem o recebe não pode alterá-lo
// no lugar (ordenar uma lista do contexto, empurrar item). Copie antes.

const VALIDADE_MS = 10 * 60_000;
// Cada retrato com 50 mil títulos ocupa dezenas de MB: dois bastam para quem
// alterna entre o grupo e uma empresa.
const MAXIMO_DE_RETRATOS = 2;

type Entrada = { chave: string; versao: string; criadoEm: number; ctx: Promise<ContextoAuditoria> };
const retratos: Entrada[] = [];

async function versaoDosDados(companyId: string): Promise<string> {
  const [v] = await prisma.$queryRaw<{ v: string | null }[]>(Prisma.sql`
    SELECT CONCAT_WS('|',
      (SELECT MAX("atualizadoEm")::text FROM ${tabela("OmieSyncRun")} WHERE "companyId" = ${companyId}),
      (SELECT COUNT(*) || ':' || COALESCE(MAX("atualizadoEm")::text, '') FROM ${tabela("DreClassificacao")} WHERE "companyId" = ${companyId}),
      (SELECT COUNT(*) || ':' || COALESCE(MAX("atualizadoEm")::text, '') FROM ${tabela("OmieVinculoCentroCusto")} WHERE "companyId" = ${companyId}),
      (SELECT COUNT(*) || ':' || COALESCE(MAX("atualizadoEm")::text, '') FROM ${tabela("OmieConexao")} WHERE "companyId" = ${companyId}),
      (SELECT MAX("atualizadoEm")::text FROM ${tabela("ControladoriaConfig")} WHERE "companyId" = ${companyId}),
      (SELECT MAX("vistoEm")::text FROM ${tabela("OmieTituloVersao")} WHERE "companyId" = ${companyId})
    ) AS v`);
  return v?.v ?? "";
}

export async function contextoEmCache(
  companyId: string,
  dataReferencia: Date,
  conexaoId: string | undefined,
  opcoes: { desde: Date }
): Promise<ContextoAuditoria> {
  const chave = [companyId, conexaoId ?? "GRUPO", dataReferencia.toISOString(), opcoes.desde.toISOString()].join("|");
  const versao = await versaoDosDados(companyId);
  const agora = Date.now();
  const achada = retratos.find((e) => e.chave === chave);
  if (achada && achada.versao === versao && agora - achada.criadoEm < VALIDADE_MS) {
    // Mais recente no fim: o que sai primeiro é o usado há mais tempo.
    retratos.splice(retratos.indexOf(achada), 1);
    retratos.push(achada);
    return achada.ctx;
  }
  if (achada) retratos.splice(retratos.indexOf(achada), 1);

  // A promessa entra no cache antes de resolver: dois cliques ao mesmo tempo
  // esperam a mesma montagem, em vez de montar duas.
  // O tempo da montagem vai para o log da Vercel: é o número que diz se o
  // banco está longe (região) ou frio (Neon suspenso) quando a tela demora.
  const ctx = carregarContexto(companyId, dataReferencia, conexaoId, opcoes).then((c) => {
    console.info(`[contexto] montado em ${Date.now() - agora} ms (${c.titulos.length} títulos)`);
    return c;
  });
  const entrada: Entrada = { chave, versao, criadoEm: agora, ctx };
  retratos.push(entrada);
  while (retratos.length > MAXIMO_DE_RETRATOS) retratos.shift();
  entrada.ctx.catch(() => {
    const i = retratos.indexOf(entrada);
    if (i >= 0) retratos.splice(i, 1);
  });
  return entrada.ctx;
}

// Para quem altera, na mesma instância, algo que o retrato mostra e que a
// versão não pega (ou para a resposta da própria ação já sair atualizada).
export function invalidarContextoEmCache(companyId: string) {
  for (let i = retratos.length - 1; i >= 0; i--) if (retratos[i].chave.startsWith(`${companyId}|`)) retratos.splice(i, 1);
}
