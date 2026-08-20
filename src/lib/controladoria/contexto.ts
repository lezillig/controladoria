import type { ControladoriaConfig } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseLocalDate } from "@/lib/date";
import {
  disponibilidadeGestao,
  lerAbastecimentos,
  lerClientes,
  lerMotoristas,
  lerVeiculos,
} from "@/lib/gestao/leitura";
import { carregarConformidade } from "@/lib/conformidade/panorama";
import type { ContextoAuditoria } from "./types";
import { inicioDoDia, somarDias } from "./periodos";

// Data a partir da qual a base histórica é carregada.
//
// O pedido original era 01/01/2026, mas sem o ano anterior na base TODA
// comparação ano-contra-ano do relatório sai como "sem base comparativa" — e
// comparativo anual foi um pedido explícito. Com 2025 carregado, o primeiro
// relatório já nasce com comparação real. O ciclo diário continua sendo D-1;
// os anos anteriores entram uma única vez pelo backfill encadeado, em segundo
// plano.
const DATA_INICIO_PADRAO = process.env.OMIE_DATA_INICIO_BASE ?? "2025-01-01";

// Destinatário padrão do relatório. Fica como padrão do cadastro, não como
// destino fixo no código: quem recebe relatório gerencial muda (entra o
// contador, sai um sócio) e isso não pode exigir deploy.
const EMAILS_PADRAO = process.env.RELATORIO_EMAILS ?? "leandro.zillig@azulmob.com.br";

export async function garantirConfig(companyId: string): Promise<ControladoriaConfig> {
  const existente = await prisma.controladoriaConfig.findUnique({ where: { companyId } });
  if (existente) return existente;

  return prisma.controladoriaConfig.create({
    data: {
      companyId,
      emailsRelatorio: EMAILS_PADRAO,
      dataInicioBase: parseLocalDate(DATA_INICIO_PADRAO),
    },
  });
}

export function destinatarios(config: ControladoriaConfig): string[] {
  return config.emailsRelatorio
    .split(/[,;\s]+/)
    .map((e) => e.trim())
    .filter((e) => e.includes("@"));
}

// Carrega tudo que os agentes precisam numa leitura só — o espelho da Omie
// (CONSOLIDADO entre as conexões do grupo) mais os dados da operação lidos do
// sistema de gestão.
//
// O recorte é sempre >= config.dataInicioBase: além de limitar o volume, é o
// que garante que nenhum agente compare "ano atual" contra um ano anterior
// parcialmente carregado e conclua uma queda que só existe na base.
export async function carregarContexto(
  companyId: string,
  dataReferencia: Date,
  // Filtro opcional por conexão. Sem ele, o contexto é do grupo inteiro — que
  // é o padrão, porque é assim que a diretoria decide. Com ele, o mesmo motor
  // roda para uma empresa só (usado pelo relatório por conexão e pelo filtro
  // de empresa nas telas).
  conexaoId?: string
): Promise<ContextoAuditoria> {
  const config = await garantirConfig(companyId);
  const desde = inicioDoDia(config.dataInicioBase);
  // Movimento e abastecimento só interessam em janelas recentes (conciliação,
  // custo do mês, comparativo com o mês anterior). Carregá-los desde o início
  // da base seria peso morto no maior volume da tabela.
  const desdeRecente = somarDias(inicioDoDia(dataReferencia), -400);
  const corteRecente = desdeRecente > desde ? desdeRecente : desde;

  const escopo = conexaoId ? { companyId, conexaoId } : { companyId };

  const [
    conexoes,
    titulos,
    baixas,
    movimentos,
    notas,
    parceiros,
    categorias,
    departamentos,
    contasCorrentes,
    vinculos,
    ultimoSyncConcluido,
    motoristas,
    clientes,
    veiculos,
    abastecimentos,
    conformidade,
  ] = await Promise.all([
    prisma.omieConexao.findMany({ where: { companyId, ativa: true }, orderBy: { ordem: "asc" } }),
    prisma.omieTitulo.findMany({
      where: { ...escopo, OR: [{ dataVencimento: { gte: desde } }, { dataEmissao: { gte: desde } }] },
      orderBy: { dataVencimento: "asc" },
    }),
    prisma.omieBaixa.findMany({ where: { ...escopo, dataBaixa: { gte: desde } }, orderBy: { dataBaixa: "asc" } }),
    prisma.omieMovimento.findMany({ where: { ...escopo, data: { gte: corteRecente } }, orderBy: { data: "asc" } }),
    prisma.omieNota.findMany({ where: { ...escopo, dataEmissao: { gte: desde } }, orderBy: { dataEmissao: "asc" } }),
    prisma.omieParceiro.findMany({ where: escopo }),
    prisma.omieCategoria.findMany({ where: escopo }),
    prisma.omieDepartamento.findMany({ where: escopo }),
    prisma.omieContaCorrente.findMany({ where: escopo }),
    prisma.omieVinculoCentroCusto.findMany({ where: { companyId } }),
    prisma.omieSyncRun.findFirst({
      where: { companyId, status: "CONCLUIDO", backfill: false },
      orderBy: { finalizadoEm: "desc" },
    }),
    lerMotoristas(companyId),
    lerClientes(companyId),
    lerVeiculos(companyId),
    lerAbastecimentos(companyId, corteRecente),
    carregarConformidade(companyId, conexaoId),
  ]);

  return {
    companyId,
    agora: new Date(),
    dataReferencia: inicioDoDia(dataReferencia),
    config,
    conexoes,
    titulos,
    baixas,
    movimentos,
    notas,
    parceiros,
    categorias,
    departamentos,
    contasCorrentes,
    vinculos,
    motoristas,
    clientes,
    veiculos,
    abastecimentos,
    conformidade,
    // Lido DEPOIS das consultas: a disponibilidade é registrada pela própria
    // leitura (ver src/lib/gestao/leitura.ts), então só faz sentido consultá-la
    // quando as quatro já rodaram.
    gestao: disponibilidadeGestao(),
    ultimoSyncConcluido,
  };
}

// Apelido da conexão, para rótulo de tela e chave de achado. Conexão removida
// (ou registro de uma conexão desativada) devolve o próprio id: o dado
// histórico continua legível, em vez de virar "undefined" no relatório.
export function apelidoConexao(ctx: ContextoAuditoria, conexaoId: string | null | undefined): string {
  if (!conexaoId) return "GRUPO";
  return ctx.conexoes.find((c) => c.id === conexaoId)?.apelido ?? conexaoId;
}
