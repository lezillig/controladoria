import type { ControladoriaConfig } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseLocalDate } from "@/lib/date";
import {
  disponibilidadeGestao,
  lerAbastecimentos,
  lerClientes,
  lerEscalas,
  lerMotoristas,
  lerPrecosAnp,
  lerUsosDeVeiculo,
  lerVeiculos,
} from "@/lib/gestao/leitura";
import { carregarConformidade } from "@/lib/conformidade/panorama";
import type { ContextoAuditoria } from "./types";
import { fimDoDia, inicioDoAno, inicioDoDia, inicioDoMes, somarDias } from "./periodos";

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
  //
  // `ate` fecha a janela pelo outro lado (auditoria retroativa de um ano):
  // títulos com vencimento ou emissão dentro de [desde, ate], mais todo título
  // em aberto. `operacaoCompleta` faz movimentos e abastecimentos acompanharem
  // a janela em vez do corte de 400 dias — é o que a varredura do passado
  // precisa para olhar o cartão de frota de 2024.
  opcoes?: { desde?: Date; ate?: Date; operacaoCompleta?: boolean }
): Promise<ContextoAuditoria> {
  const config = await garantirConfig(companyId);
  const inicioDaBase = inicioDoDia(config.dataInicioBase);
  const pedida = opcoes?.desde ? inicioDoDia(opcoes.desde) : null;
  // Nunca antes do início da base: pedir mais história do que existe só
  // produziria varredura sem retorno.
  const desde = pedida && pedida > inicioDaBase ? pedida : inicioDaBase;
  const ate = opcoes?.ate ? fimDoDia(opcoes.ate) : null;
  // Movimento e abastecimento só interessam em janelas recentes (conciliação,
  // custo do mês, comparativo com o mês anterior). Carregá-los desde o início
  // da base seria peso morto no maior volume da tabela.
  const desdeRecente = somarDias(inicioDoDia(dataReferencia), -400);
  const corteRecente = opcoes?.operacaoCompleta ? desde : desdeRecente > desde ? desdeRecente : desde;
  const recorteDeData = ate ? { gte: desde, lte: ate } : { gte: desde };
  const recorteDeMovimento = ate ? { gte: corteRecente, lte: ate } : { gte: corteRecente };

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
    projetos,
    contasCorrentes,
    vinculos,
    ultimoSyncConcluido,
    execucoesRecentes,
    baixadoEm12Meses,
    motoristas,
    clientes,
    veiculos,
    abastecimentos,
    conformidade,
    usosDeVeiculo,
    escalas,
    precosAnp,
    contaHistorico,
    versoesDeTitulo,
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
          { dataVencimento: recorteDeData },
          { dataEmissao: recorteDeData },
          { liquidado: false, cancelado: false },
        ],
      },
      orderBy: { dataVencimento: "asc" },
    }),
    // AS BAIXAS DOS TÍTULOS CARREGADOS, e não "as baixas desde a janela". Um
    // título de fevereiro pago em parte em dezembro tinha só a baixa de
    // janeiro aqui, e a regra de divergência lia "falta baixa no espelho". A
    // baixa acompanha o título: se ele entrou no contexto, todas as baixas
    // dele entram junto — inclusive as de título antigo ainda em aberto.
    prisma.omieBaixa.findMany({
      where: {
        ...escopo,
        titulo: {
          OR: [
            { dataVencimento: recorteDeData },
            { dataEmissao: recorteDeData },
            { liquidado: false, cancelado: false },
          ],
        },
      },
      orderBy: { dataBaixa: "asc" },
    }),
    prisma.omieMovimento.findMany({ where: { ...escopo, data: recorteDeMovimento }, orderBy: { data: "asc" } }),
    prisma.omieNota.findMany({ where: { ...escopo, dataEmissao: recorteDeData }, orderBy: { dataEmissao: "asc" } }),
    prisma.omieParceiro.findMany({ where: escopo }),
    prisma.omieCategoria.findMany({ where: escopo }),
    prisma.omieDepartamento.findMany({ where: escopo }),
    // Projeto é a ordem de serviço deste grupo. São poucos por mês e a tabela
    // é pequena — o custo de carregá-los é irrelevante perto de a regra de OS
    // não faturada poder dizer o NOME da OS em vez do código.
    prisma.omieProjeto.findMany({ where: escopo }),
    prisma.omieContaCorrente.findMany({ where: escopo }),
    prisma.omieVinculoCentroCusto.findMany({ where: { companyId } }),
    prisma.omieSyncRun.findFirst({
      where: { companyId, status: "CONCLUIDO", backfill: false },
      orderBy: { finalizadoEm: "desc" },
    }),
    // A ÚLTIMA EXECUÇÃO DE CADA CONEXÃO, com qualquer status. A regra de
    // saúde da sincronização olhava uma execução só — a última concluída de
    // qualquer conexão —, e uma conexão falhando todo dia enquanto a outra
    // concluía ficava invisível: a consolidação rodava sobre um espelho velho
    // e nenhum achado dizia isso. Cinquenta linhas cobrem semanas das duas.
    prisma.omieSyncRun.findMany({
      where: { companyId, backfill: false, conexaoId: { not: null } },
      orderBy: { iniciadoEm: "desc" },
      take: 50,
    }),
    // Base da materialidade: o baixado nos últimos 12 meses pelo resumo
    // mensal. Sem ela, em janeiro a materialidade caía ao piso de R$ 500 e
    // um título de R$ 5 mil virava crítico.
    baseDeMaterialidade(companyId, conexaoId ?? null, dataReferencia),
    lerMotoristas(companyId),
    lerClientes(companyId),
    lerVeiculos(companyId),
    // A leitura da gestão só recorta por início; o fim da janela é aplicado
    // aqui, para a varredura de 2024 não auditar o cartão de 2026 de novo.
    lerAbastecimentos(companyId, corteRecente).then((lista) => (ate ? lista.filter((a) => a.dataHora <= ate) : lista)),
    carregarConformidade(companyId, conexaoId),
    lerUsosDeVeiculo(companyId, corteRecente),
    lerEscalas(companyId, corteRecente),
    lerPrecosAnp(corteRecente),
    prisma.omieParceiroContaHistorico.findMany({
      where: { companyId, ...(conexaoId ? { conexaoId } : {}), detectadoEm: { gte: somarDias(inicioDoDia(dataReferencia), -365) } },
      orderBy: { detectadoEm: "asc" },
    }),
    prisma.omieTituloVersao.findMany({
      where: { companyId, vistoEm: ate ? { gte: desde, lte: ate } : { gte: desde } },
      orderBy: { vistoEm: "asc" },
    }),
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
    projetos,
    contasCorrentes,
    vinculos,
    motoristas,
    clientes,
    veiculos,
    abastecimentos,
    conformidade,
    usosDeVeiculo,
    escalas,
    precosAnp,
    contaHistorico,
    versoesDeTitulo,
    // Lido DEPOIS das consultas: a disponibilidade é registrada pela própria
    // leitura (ver src/lib/gestao/leitura.ts), então só faz sentido consultá-la
    // quando as quatro já rodaram.
    gestao: disponibilidadeGestao(),
    ultimoSyncConcluido,
    // Uma por conexão ativa: a mais recente, seja qual for o status.
    ultimaExecucaoPorConexao: conexoes.map((c) => execucoesRecentes.find((r) => r.conexaoId === c.id) ?? null),
    baixadoEm12MesesCents: baixadoEm12Meses,
    conexaoId: conexaoId ?? null,
    janelaDesde: desde,
    janelaAte: ate,
  };
}

// Soma do baixado (pago e recebido) nos últimos 12 meses fechados, pelo
// resumo mensal na dimensão PARCEIRO — cada título conta uma vez. É a base
// que segura a materialidade em janeiro. Nulo quando o resumo ainda não
// existe (carga histórica não rodou): aí vale só o ano corrente, como antes.
async function baseDeMaterialidade(companyId: string, conexaoId: string | null, referencia: Date): Promise<number | null> {
  const ate = `${referencia.getFullYear()}-${String(referencia.getMonth() + 1).padStart(2, "0")}`;
  const inicio = new Date(referencia.getFullYear(), referencia.getMonth() - 12, 1);
  const de = `${inicio.getFullYear()}-${String(inicio.getMonth() + 1).padStart(2, "0")}`;
  const linhas = await prisma.historicoMensal.aggregate({
    _sum: { valorBaixadoCents: true },
    _count: true,
    where: { companyId, dimensao: "PARCEIRO", competencia: { gte: de, lt: ate }, ...(conexaoId ? { conexaoId } : {}) },
  });
  return linhas._count > 0 ? (linhas._sum.valorBaixadoCents ?? 0) : null;
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
