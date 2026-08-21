import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// CONEXÃO COM O BANCO DA GESTÃO — separada, e somente leitura.
//
// A Controladoria lê seis tabelas do sistema de gestão: `User` e `Company`
// (que sustentam o login e a reconferência de sessão a cada requisição) e
// `Driver`, `Vehicle`, `Cliente` e `FuelTransaction` (que sustentam os
// cruzamentos que dão valor à auditoria — fornecedor cujo CPF é de motorista
// da folha, custo por veículo, combustível do cartão contra o título do posto).
//
// Durante um tempo os dois sistemas dividiram o mesmo Postgres, em schemas
// diferentes, e essas leituras iam pela mesma conexão. Bancos separados são
// mais limpos: cada sistema é dono do seu, nenhuma tabela de um aparece ao
// lado das do outro, e uma migração de um lado não tem como tocar no outro.
//
// POR QUE NÃO CRIAR UM CADASTRO DE USUÁRIOS PRÓPRIO AQUI, que seria o jeito
// óbvio de eliminar o acoplamento: porque isso troca um acoplamento por uma
// falha de segurança. Hoje, desativar alguém na gestão tira o acesso ao
// financeiro no mesmo ato — inclusive de uma sessão já aberta. Com dois
// cadastros, esse desligamento passa a depender de alguém lembrar de repetir a
// operação nos dois lugares, e o dia em que esquecerem é o dia em que um
// ex-funcionário continua enxergando o caixa do grupo. Um cadastro só, com
// leitura de fora, é a opção mais segura das duas.
//
// A conexão daqui deve usar um PAPEL SOMENTE LEITURA, com permissão apenas
// nessas seis tabelas (ver docs/papel-leitura-gestao.sql). Assim a separação
// não depende de disciplina de quem escreve o código: a Controladoria
// fisicamente não consegue escrever no banco da gestão, nem ler o que não lhe
// diz respeito.

const globalParaGestao = globalThis as unknown as { prismaGestao: PrismaClient | undefined };

function criar(url: string): PrismaClient {
  return new PrismaClient({ datasources: { db: { url } } });
}

const urlDaGestao = process.env.GESTAO_DATABASE_URL?.trim();

// Sem `GESTAO_DATABASE_URL`, cai na conexão principal — que é o comportamento
// correto enquanto os dois sistemas dividem o mesmo banco. Não é fallback
// silencioso: `modoDaConexaoGestao()` diz qual dos dois está valendo, e a tela
// de sincronização mostra isso. Fallback que ninguém enxerga é como se
// descobre tarde que o sistema vinha lendo o banco errado.
export const prismaGestao: PrismaClient =
  urlDaGestao && urlDaGestao.length > 0
    ? (globalParaGestao.prismaGestao ?? criar(urlDaGestao))
    : prisma;

if (process.env.NODE_ENV !== "production" && urlDaGestao) {
  globalParaGestao.prismaGestao = prismaGestao;
}

export type ModoConexaoGestao = "separado" | "mesmo-banco";

export function modoDaConexaoGestao(): ModoConexaoGestao {
  return urlDaGestao && urlDaGestao.length > 0 ? "separado" : "mesmo-banco";
}
