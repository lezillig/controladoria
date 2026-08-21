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
import { inicioDoAno, inicioDoDia, inicioDoMes, somarDias } from "./periodos";

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
  conexaoId?: string,
  // JANELA DE LEITURA. Sem ela, tudo desde o início da base — que é o
  // comportamento histórico e continua sendo o padrão.
  //
  // Existe porque carregar a base inteira deixou de caber: com 46 mil títulos
  // e 45 mil baixas, a fase de auditoria do ciclo diário passou a estourar os
  // 60 segundos da função, e o ciclo parou de fechar. Quem chama informa o
  // recorte de que precisa (ver `janelaDeAuditoria`), em vez de esta função
  // adivinhar.
  opcoes?: { desde?: Date }
): Promise<ContextoAuditoria> {
  const config = await garantirConfig(companyId);
  const inicioDaBase = inicioDoDia(config.dataInicioBase);
  const pedida = opcoes?.desde ? inicioDoDia(opcoes.desde) : null;
  // Nunca antes do início da base: pedir mais história do que existe só
  // produziria varredura sem retorno.
  const desde = pedida && pedida > inicioDaBase ? pedida : inicioDaBase;
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
    // Título EM ABERTO entra sempre, por mais velho que seja.
    //
    // A janela recorta o que já se encerrou; o que ainda deve não pode ficar
    // de fora dela. Um título vencido há dois anos é o registro mais grave da
    // base — e some da tela de atrasos justamente por ser antigo, que é o
    // oposto do que uma auditoria deve fazer.
    prisma.omieTitulo.findMany({
      where: {
        ...escopo,
        OR: [
          { dataVencimento: { gte: desde } },
          { dataEmissao: { gte: desde } },
          { liquidado: false, cancelado: false },
        ],
      },
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
    conexaoId: conexaoId ?? null,
    janelaDesde: desde,
  };
}

// A janela que a AUDITORIA e as TELAS precisam — e não mais que isso.
//
// O limite não foi escolhido por conforto: nenhum agente olha além do início
// do ano corrente (`inicioDoAno(ctx.dataReferencia)` é o ponto mais antigo que
// qualquer um deles alcança), e a única coisa que ia mais longe eram as
// comparações com o ano anterior do comparativo — que agora vêm de soma
// agregada, sem passar pelas linhas.
//
// O mês anterior é somado à conta por causa de janeiro: em 05/01, "mês
// anterior" é dezembro, que está fora do ano corrente. Sem essa margem, a
// primeira semana de cada ano mostraria dezembro zerado.
//
// Títulos em aberto continuam vindo inteiros, por mais antigos que sejam — a
// janela recorta o que já se encerrou, não o que ainda deve.
export function janelaDeAuditoria(dataReferencia: Date): Date {
  const inicioDoAnoCorrente = inicioDoAno(dataReferencia);
  const mesAnterior = inicioDoMes(new Date(dataReferencia.getFullYear(), dataReferencia.getMonth() - 1, 1));
  return mesAnterior < inicioDoAnoCorrente ? mesAnterior : inicioDoAnoCorrente;
}

// Apelido da conexão, para rótulo de tela e chave de achado. Conexão removida
// (ou registro de uma conexão desativada) devolve o próprio id: o dado
// histórico continua legível, em vez de virar "undefined" no relatório.
export function apelidoConexao(ctx: ContextoAuditoria, conexaoId: string | null | undefined): string {
  if (!conexaoId) return "GRUPO";
  return ctx.conexoes.find((c) => c.id === conexaoId)?.apelido ?? conexaoId;
}
