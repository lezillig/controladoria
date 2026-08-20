import { prisma } from "@/lib/prisma";

// LEITURA DO SISTEMA DE GESTÃO (schema `public`) — SOMENTE LEITURA.
//
// Este sistema mora no schema `controladoria` do mesmo banco Postgres que o
// sistema de gestão de motoristas. As tabelas da operação continuam sendo
// dele: motoristas, veículos, clientes/contratos, abastecimentos do cartão de
// frota, ponto.
//
// Por que ler por SQL explícito e não por modelo do Prisma:
//   1. Modelar aqui uma tabela de que este sistema não é dono é convite para o
//      dia em que uma migração daqui tentar alterá-la. Com consulta crua, a
//      fronteira fica escrita no código: este arquivo é a ÚNICA porta de
//      entrada, e ela só lê.
//   2. O contrato fica visível. Se a gestão renomear uma coluna, quebra aqui,
//      num arquivo só, com erro claro — em vez de espalhar por dez lugares.
//   3. Nenhuma escrita é possível por acidente: não há `create`, `update` nem
//      `delete` para essas entidades em lugar nenhum deste sistema.
//
// Quando o sistema de gestão não estiver disponível (banco sem o schema
// `public`, ambiente isolado, permissão negada), cada função devolve lista
// vazia em vez de derrubar a página: o módulo financeiro continua funcionando
// e apenas os CRUZAMENTOS com a operação ficam suspensos — o supervisor
// registra isso como limitação da base, e os agentes que dependem deles não
// emitem achado (ver src/lib/controladoria/supervisor.ts).

export type MotoristaGestao = {
  id: string;
  name: string;
  cpf: string;
  active: boolean;
  valorHoraCents: number | null;
  clienteId: string | null;
  departamento: string | null;
};

export type VeiculoGestao = {
  id: string;
  plate: string;
  status: string;
  currentMileage: number;
};

export type ClienteGestao = {
  id: string;
  nome: string;
  active: boolean;
};

export type AbastecimentoGestao = {
  id: string;
  vehicleId: string | null;
  driverId: string | null;
  dataHora: Date;
  valorCents: number;
  volumeLitros: number;
  kmRodados: number | null;
  placaOriginal: string;
};

// Marca se a última leitura encontrou o schema da gestão. Consultado pela tela
// de sincronização e pelo supervisor para explicar, em português, por que os
// cruzamentos não rodaram — em vez de simplesmente não apontar nada.
export type DisponibilidadeGestao = { disponivel: boolean; erro: string | null };

let ultimaDisponibilidade: DisponibilidadeGestao = { disponivel: true, erro: null };

export function disponibilidadeGestao(): DisponibilidadeGestao {
  return ultimaDisponibilidade;
}

async function ler<T>(consulta: () => Promise<T[]>, rotulo: string): Promise<T[]> {
  try {
    const linhas = await consulta();
    ultimaDisponibilidade = { disponivel: true, erro: null };
    return linhas;
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : "erro desconhecido";
    ultimaDisponibilidade = {
      disponivel: false,
      erro: `Não foi possível ler ${rotulo} do sistema de gestão: ${mensagem.slice(0, 200)}`,
    };
    return [];
  }
}

export async function lerMotoristas(companyId: string): Promise<MotoristaGestao[]> {
  return ler(
    () => prisma.$queryRaw<MotoristaGestao[]>`
      SELECT id, name, cpf, active, "valorHoraCents", "clienteId", departamento
      FROM public."Driver"
      WHERE "companyId" = ${companyId}
    `,
    "os motoristas"
  );
}

export async function lerVeiculos(companyId: string): Promise<VeiculoGestao[]> {
  return ler(
    () => prisma.$queryRaw<VeiculoGestao[]>`
      SELECT id, plate, status::text AS status, "currentMileage"
      FROM public."Vehicle"
      WHERE "companyId" = ${companyId}
    `,
    "os veículos"
  );
}

export async function lerClientes(companyId: string): Promise<ClienteGestao[]> {
  return ler(
    () => prisma.$queryRaw<ClienteGestao[]>`
      SELECT id, nome, active
      FROM public."Cliente"
      WHERE "companyId" = ${companyId}
    `,
    "os contratos"
  );
}

// Abastecimentos do cartão de frota. Recortado por data porque é a maior
// tabela da operação e só as janelas recentes interessam à auditoria (custo do
// mês, comparativo com o mês anterior, divergência contra a Omie).
export async function lerAbastecimentos(companyId: string, desde: Date): Promise<AbastecimentoGestao[]> {
  return ler(
    () => prisma.$queryRaw<AbastecimentoGestao[]>`
      SELECT id, "vehicleId", "driverId", "dataHora", "valorCents", "volumeLitros",
             "kmRodados", "placaOriginal"
      FROM public."FuelTransaction"
      WHERE "companyId" = ${companyId} AND "dataHora" >= ${desde}
    `,
    "os abastecimentos"
  );
}

// Usuário para autenticação. Este sistema NÃO tem cadastro próprio de
// usuários: reaproveita o do sistema de gestão, no mesmo banco. Ganha-se
// credencial única (uma senha para as duas aplicações) e, principalmente,
// desligamento único — quando alguém sai da empresa e é desativado na gestão,
// perde o acesso ao financeiro no mesmo ato. Cadastro separado significaria,
// mais cedo ou mais tarde, um ex-funcionário com acesso ao módulo que mostra o
// caixa da empresa.
export type UsuarioGestao = {
  id: string;
  companyId: string;
  name: string;
  email: string;
  passwordHash: string;
  role: string;
  active: boolean;
};

export async function buscarUsuarioPorEmail(email: string): Promise<UsuarioGestao | null> {
  try {
    const linhas = await prisma.$queryRaw<UsuarioGestao[]>`
      SELECT id, "companyId", name, email, "passwordHash", role::text AS role, active
      FROM public."User"
      WHERE lower(email) = lower(${email})
      LIMIT 1
    `;
    return linhas[0] ?? null;
  } catch {
    // Falha de leitura aqui é falha de login — e login que "falha aberto"
    // seria a pior falha possível neste sistema. Devolve null (nega o acesso)
    // em vez de qualquer tratamento tolerante.
    return null;
  }
}

export async function buscarEmpresa(companyId: string): Promise<{ id: string; name: string } | null> {
  try {
    const linhas = await prisma.$queryRaw<{ id: string; name: string }[]>`
      SELECT id, name FROM public."Company" WHERE id = ${companyId} LIMIT 1
    `;
    return linhas[0] ?? null;
  } catch {
    return null;
  }
}

// Primeira empresa ativa — usada quando o sistema precisa de um companyId e
// ainda não há sessão (ex.: o cron diário, que roda sem usuário).
export async function listarEmpresasAtivas(): Promise<{ id: string; name: string }[]> {
  return ler(
    () => prisma.$queryRaw<{ id: string; name: string }[]>`
      SELECT id, name FROM public."Company" WHERE active = true ORDER BY id ASC
    `,
    "as empresas"
  );
}
