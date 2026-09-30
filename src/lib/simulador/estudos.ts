import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { simular, VERSAO_MOTOR } from "./motor";
import { baseVigente, paraNumero, type BaseVigente } from "./baseDeCustos";
import { perfisDaBase, premissasDaBase, problemasNasPremissas, type MapaOrigem } from "./premissas";
import { simulacoesHistoricas, FONTE_HISTORICO } from "./historico";
import type { CriterioJulgamento, EntradaSimulacao, Item, Premissas, ResultadoSimulacao, Rota, UnidadePreco } from "./tipos";
import type { RealizadoMes } from "./calibracao";

// OS ESTUDOS DE CUSTO — a persistência do simulador.
//
// Um estudo guarda a DEFINIÇÃO corrente da operação (itens e rotas, editáveis)
// e as VERSÕES de simulação, cada uma com o snapshot completo da entrada do
// motor. Salvar uma versão grava as duas coisas: a definição passa a ser a
// da versão, e a versão fica congelada. Reexecutar é chamar simular() com o
// snapshot — o resultado tem de ser o gravado, e `reexecutar` confere.

export const TIPOS_ESTUDO = ["LICITACAO", "CONTRATO_PRIVADO", "RENOVACAO", "ORCAMENTO_INTERNO", "OUTRO"] as const;
export const ROTULO_TIPO_ESTUDO: Record<(typeof TIPOS_ESTUDO)[number], string> = {
  LICITACAO: "Licitação",
  CONTRATO_PRIVADO: "Contrato privado",
  RENOVACAO: "Renovação de contrato",
  ORCAMENTO_INTERNO: "Orçamento interno",
  OUTRO: "Outro",
};
export const TIPOS_SERVICO = ["FRETAMENTO", "ESCOLAR", "SAUDE", "LOCACAO_CM", "LOCACAO_SM", "OUTRO"] as const;
export const ROTULO_TIPO_SERVICO: Record<(typeof TIPOS_SERVICO)[number], string> = {
  FRETAMENTO: "Fretamento contínuo",
  ESCOLAR: "Transporte escolar",
  SAUDE: "Transporte de pacientes / saúde",
  LOCACAO_CM: "Locação com motorista",
  LOCACAO_SM: "Locação sem motorista",
  OUTRO: "Outro",
};
export const STATUS_ESTUDO = ["EM_ESTUDO", "PROPOSTA_ENVIADA", "GANHO", "PERDIDO", "DESISTENCIA", "EM_EXECUCAO", "ENCERRADO"] as const;
export const ROTULO_STATUS_ESTUDO: Record<(typeof STATUS_ESTUDO)[number], string> = {
  EM_ESTUDO: "Em estudo",
  PROPOSTA_ENVIADA: "Proposta enviada",
  GANHO: "Ganho",
  PERDIDO: "Perdido",
  DESISTENCIA: "Desistência",
  EM_EXECUCAO: "Em execução",
  ENCERRADO: "Encerrado",
};
export const STATUS_VERSAO = ["RASCUNHO", "APROVADA", "LANCADA"] as const;

const n = (v: unknown): number => paraNumero(v) ?? 0;

export type DadosEstudo = {
  tipo: string;
  nome: string;
  cliente?: string | null;
  tipoServico: string;
  uf?: string | null;
  municipio?: string | null;
  descricao?: string | null;
  criterioJulgamento: CriterioJulgamento;
  unidadePreco: UnidadePreco;
  vigenciaMeses?: number | null;
  prazoPagamentoDias?: number | null;
  orgao?: string | null;
  numeroEdital?: string | null;
  modalidade?: string | null;
  plataforma?: string | null;
  dataSessao?: Date | null;
  srp?: boolean;
  valorTotalMaximo?: number | null;
};

export async function criarEstudo(companyId: string, dados: DadosEstudo, autor: string | null): Promise<string> {
  const estudo = await prisma.simEstudo.create({
    data: {
      companyId,
      tipo: dados.tipo,
      nome: dados.nome,
      cliente: dados.cliente ?? null,
      tipoServico: dados.tipoServico,
      uf: dados.uf ?? null,
      municipio: dados.municipio ?? null,
      descricao: dados.descricao ?? null,
      criterioJulgamento: dados.criterioJulgamento,
      unidadePreco: dados.unidadePreco,
      vigenciaMeses: dados.vigenciaMeses ?? null,
      prazoPagamentoDias: dados.prazoPagamentoDias ?? null,
      orgao: dados.orgao ?? null,
      numeroEdital: dados.numeroEdital ?? null,
      modalidade: dados.modalidade ?? null,
      plataforma: dados.plataforma ?? null,
      dataSessao: dados.dataSessao ?? null,
      srp: dados.srp ?? false,
      valorTotalMaximo: dados.valorTotalMaximo ?? null,
      criadoPorNome: autor,
      // Um item para começar: o estudo nasce pronto para receber rotas.
      itens: { create: [{ codigo: "1", descricao: dados.nome, ordem: 0, comMotorista: dados.tipoServico !== "LOCACAO_SM" }] },
    },
    select: { id: true },
  });
  return estudo.id;
}

export function itemDoBanco(i: {
  codigo: string;
  descricao: string;
  shareIntermunicipal: unknown;
  precoMaximoKm: unknown;
  precoReferenciaKm: unknown;
  comMotorista: boolean;
  combustivelPorContaDoCliente: boolean;
}): Item {
  return {
    codigo: i.codigo,
    descricao: i.descricao,
    shareIntermunicipal: n(i.shareIntermunicipal),
    precoMaximoKm: paraNumero(i.precoMaximoKm),
    precoReferenciaKm: paraNumero(i.precoReferenciaKm),
    comMotorista: i.comMotorista,
    combustivelPorContaDoCliente: i.combustivelPorContaDoCliente,
  };
}

export function rotaDoBanco(r: Prisma.SimRotaGetPayload<object>): Rota {
  return {
    item: r.itemCodigo,
    nome: r.nome,
    kmReferencia: n(r.kmReferencia),
    kmDia: n(r.kmDia),
    kmTerraDia: n(r.kmTerraDia),
    diasMes: r.diasMes,
    veiculos: n(r.veiculos),
    motoristas: n(r.motoristas),
    monitoras: n(r.monitoras),
    noturno: r.noturno,
    passagensPedagioMes: n(r.passagensPedagioMes),
    tarifaPedagio: n(r.tarifaPedagio),
    viagensDia: paraNumero(r.viagensDia),
    periodos: r.periodos,
    horasDia: paraNumero(r.horasDia),
    perfilVeiculo: r.perfilVeiculo,
  };
}

export type ResumoVersao = {
  id: string;
  versao: number;
  status: string;
  criadoEm: Date;
  autorNome: string | null;
  precoKm: number | null;
  margem: number | null;
  lucro: number;
  faturamento: number;
  unidade: string | null;
  observacoes: string | null;
};

export async function carregarEstudo(companyId: string, id: string) {
  const estudo = await prisma.simEstudo.findFirst({
    where: { id, companyId },
    include: {
      itens: { orderBy: [{ ordem: "asc" }, { codigo: "asc" }] },
      rotas: { orderBy: [{ ordem: "asc" }] },
      regras: { orderBy: [{ ordem: "asc" }] },
      simulacoes: { orderBy: { versao: "desc" } },
      lances: { orderBy: { dataHora: "desc" } },
      realizados: { orderBy: { competencia: "desc" } },
    },
  });
  if (!estudo) return null;
  const versoes: ResumoVersao[] = estudo.simulacoes.map((s) => ({
    id: s.id,
    versao: s.versao,
    status: s.status,
    criadoEm: s.criadoEm,
    autorNome: s.autorNome,
    precoKm: paraNumero(s.precoKm),
    margem: paraNumero(s.margem),
    lucro: n(s.lucro),
    faturamento: n(s.faturamento),
    unidade: (s.entrada as { unidadePreco?: string } | null)?.unidadePreco ?? "KM",
    observacoes: s.observacoes,
  }));
  return {
    estudo,
    itens: estudo.itens.map(itemDoBanco),
    rotas: estudo.rotas.map(rotaDoBanco),
    versoes,
  };
}

export type EntradaInicial = {
  entrada: EntradaSimulacao;
  origem: MapaOrigem;
  versaoBase: number | null;
  baseEm: Date | null;
};

// A ENTRADA COM QUE O EDITOR ABRE: a da versão pedida (ou da última), com a
// definição corrente de itens e rotas; sem versão, as premissas da base
// vigente e os perfis de veículo da base.
export async function entradaInicial(
  companyId: string,
  carregado: NonNullable<Awaited<ReturnType<typeof carregarEstudo>>>,
  versaoId?: string | null,
  base?: BaseVigente | null
): Promise<EntradaInicial> {
  const { estudo, itens, rotas } = carregado;
  const versao = versaoId ? estudo.simulacoes.find((s) => s.id === versaoId) : estudo.simulacoes[0];
  if (versao) {
    const snapshot = versao.entrada as unknown as EntradaSimulacao;
    // Abrir uma versão antiga mostra a conta como ela foi: snapshot inteiro.
    // Abrir a última continua a partir da definição corrente.
    const usarSnapshot = Boolean(versaoId);
    return {
      entrada: usarSnapshot ? snapshot : { ...snapshot, itens: itens.length > 0 ? itens : snapshot.itens, rotas: rotas.length > 0 ? rotas : snapshot.rotas },
      origem: (versao.origem as MapaOrigem | null) ?? {},
      versaoBase: versao.versao,
      baseEm: versao.baseEm,
    };
  }
  const baseCarregada = base === undefined ? await baseVigente(companyId) : base;
  const vazia = baseCarregada && baseCarregada.parametros.size === 0 && baseCarregada.veiculos.length === 0 && baseCarregada.funcoes.length === 0;
  const { premissas, origem } = premissasDaBase(vazia ? null : baseCarregada, {
    clientePublico: estudo.tipo === "LICITACAO",
    escolar: estudo.tipoServico === "ESCOLAR",
    baseLocal: false,
    veiculoId: baseCarregada?.veiculos[0]?.id ?? null,
    motoristaId: baseCarregada?.funcoes.find((f) => /motorista/i.test(String(f.funcao ?? "")))?.id ?? null,
    monitoraId: baseCarregada?.funcoes.find((f) => /monitor/i.test(String(f.funcao ?? "")))?.id ?? null,
  });
  if (estudo.tipoServico === "ESCOLAR") {
    premissas.contrato.modo = "PERIODO";
    premissas.contrato.utilizacao = 1;
    if (origem["contrato.mesesCustoFixo"]?.origem !== "BASE") premissas.contrato.mesesCustoFixo = 12;
  }
  if (estudo.vigenciaMeses) premissas.contrato.vigenciaMeses = estudo.vigenciaMeses;
  if (estudo.prazoPagamentoDias) premissas.preco.prazoRecebimentoDias = estudo.prazoPagamentoDias;
  premissas.perfis = perfisDaBase(vazia ? null : baseCarregada);
  return {
    entrada: {
      premissas,
      itens,
      rotas,
      criterio: estudo.criterioJulgamento === "LOTE" ? "LOTE" : "ITEM",
      unidadePreco: (estudo.unidadePreco as UnidadePreco) ?? "KM",
    },
    origem,
    versaoBase: null,
    baseEm: vazia ? null : (baseCarregada?.em ?? null),
  };
}

// Regras de margem da base (aba 8): mínima e alvo, quando cadastradas.
export function regrasDeMargem(base: BaseVigente | null): { margemMinima: number | null; margemAlvo: number | null } {
  return {
    margemMinima: base?.parametros.get("margem_minima")?.valor ?? null,
    margemAlvo: base?.parametros.get("margem_alvo")?.valor ?? null,
  };
}

// A entrada chega do navegador: tudo que vai para o motor é conferido aqui —
// tamanho, números finitos, referências entre itens, rotas e perfis.
function numerosFinitos(obj: unknown): boolean {
  if (typeof obj === "number") return Number.isFinite(obj);
  if (obj === null || typeof obj !== "object") return true;
  return Object.values(obj as Record<string, unknown>).every(numerosFinitos);
}

export function validarEntrada(entrada: EntradaSimulacao): string | null {
  if (!entrada || !Array.isArray(entrada.itens) || !Array.isArray(entrada.rotas) || !entrada.premissas) return "Simulação incompleta.";
  if (entrada.itens.length > 100 || entrada.rotas.length > 1000 || (entrada.premissas.perfis?.length ?? 0) > 40) return "Simulação grande demais (máx. 100 itens, 1.000 rotas, 40 perfis).";
  if (!numerosFinitos(entrada)) return "Há um número inválido nas premissas, itens ou rotas.";
  const problemas = problemasNasPremissas(entrada.premissas);
  if (problemas.length > 0) return problemas[0];
  if (entrada.itens.length === 0) return "O estudo precisa de ao menos um item.";
  if (entrada.rotas.length === 0) return "O estudo precisa de ao menos uma rota: sem km, veículo e motorista não há custo a salvar.";
  const codigos = new Set(entrada.itens.map((i) => i.codigo));
  if (codigos.size !== entrada.itens.length) return "Há itens com o mesmo código.";
  const semItem = entrada.rotas.find((r) => !codigos.has(r.item));
  if (semItem) return `A rota "${semItem.nome}" aponta um item que não existe (${semItem.item}).`;
  const perfis = new Set((entrada.premissas.perfis ?? []).map((p) => p.codigo));
  const semPerfil = entrada.rotas.find((r) => r.perfilVeiculo && !perfis.has(r.perfilVeiculo));
  if (semPerfil) return `A rota "${semPerfil.nome}" aponta um perfil de veículo que não existe (${semPerfil.perfilVeiculo}).`;
  const numerosRuins = entrada.rotas.find((r) => [r.kmReferencia, r.veiculos, r.motoristas].some((x) => !Number.isFinite(x) || x < 0));
  if (numerosRuins) return `A rota "${numerosRuins.nome}" tem km, veículos ou motoristas inválidos.`;
  return null;
}

export async function salvarVersao(
  companyId: string,
  estudoId: string,
  dados: { entrada: EntradaSimulacao; origem: MapaOrigem; status: string; observacoes: string | null; baseEm: Date | null },
  autor: string | null
): Promise<{ erro?: string; id?: string; versao?: number; resultado?: ResultadoSimulacao }> {
  const estudo = await prisma.simEstudo.findFirst({ where: { id: estudoId, companyId }, select: { id: true } });
  if (!estudo) return { erro: "Estudo não encontrado." };
  const problema = validarEntrada(dados.entrada);
  if (problema) return { erro: problema };
  const resultado = simular(dados.entrada);
  const { entrada } = dados;
  const principal = resultado.lote
    ? { preco: resultado.lote.precoPropostaUnidade, margem: resultado.lote.margemAoPrecoProposta, lucro: resultado.lote.lucroAoPrecoProposta, fat: resultado.lote.faturamentoAoPrecoProposta }
    : {
        preco: resultado.totais.kmUtil > 0 ? resultado.totais.faturamento / Math.max(1, resultado.itens.reduce((a, i) => a + i.quantidadeUnidade, 0)) : null,
        margem: resultado.totais.margem,
        lucro: resultado.totais.lucro,
        fat: resultado.totais.faturamento,
      };

  return prisma.$transaction(async (tx) => {
    const ultima = await tx.simSimulacao.findFirst({ where: { estudoId }, orderBy: { versao: "desc" }, select: { versao: true } });
    const versao = (ultima?.versao ?? 0) + 1;
    // A definição corrente passa a ser a da versão salva.
    await tx.simItem.deleteMany({ where: { estudoId } });
    await tx.simRota.deleteMany({ where: { estudoId } });
    await tx.simItem.createMany({
      data: entrada.itens.map((i, ordem) => ({
        estudoId,
        ordem,
        codigo: i.codigo,
        descricao: i.descricao,
        shareIntermunicipal: i.shareIntermunicipal,
        precoMaximoKm: i.precoMaximoKm ?? null,
        precoReferenciaKm: i.precoReferenciaKm ?? null,
        comMotorista: i.comMotorista !== false,
        combustivelPorContaDoCliente: i.combustivelPorContaDoCliente === true,
      })),
    });
    if (entrada.rotas.length > 0)
      await tx.simRota.createMany({
        data: entrada.rotas.map((r, ordem) => ({
          estudoId,
          ordem,
          itemCodigo: r.item,
          nome: r.nome,
          kmReferencia: r.kmReferencia,
          kmDia: r.kmDia,
          kmTerraDia: r.kmTerraDia,
          diasMes: r.diasMes ?? null,
          veiculos: r.veiculos,
          motoristas: r.motoristas,
          monitoras: r.monitoras,
          noturno: r.noturno,
          passagensPedagioMes: r.passagensPedagioMes,
          tarifaPedagio: r.tarifaPedagio,
          viagensDia: r.viagensDia ?? null,
          periodos: r.periodos ?? null,
          horasDia: r.horasDia ?? null,
          perfilVeiculo: r.perfilVeiculo ?? null,
        })),
      });
    await tx.simEstudo.update({
      where: { id: estudoId },
      data: { criterioJulgamento: entrada.criterio, unidadePreco: entrada.unidadePreco ?? "KM" },
    });
    const criada = await tx.simSimulacao.create({
      data: {
        estudoId,
        versao,
        status: dados.status,
        entrada: entrada as unknown as Prisma.InputJsonValue,
        origem: dados.origem as unknown as Prisma.InputJsonValue,
        resultado: resultado as unknown as Prisma.InputJsonValue,
        utilizacao: entrada.premissas.contrato.utilizacao,
        precoKm: principal.preco,
        custoTotal: resultado.totais.custoTotal,
        faturamento: principal.fat,
        lucro: principal.lucro,
        margem: principal.margem,
        baseEm: dados.baseEm,
        motorVersao: VERSAO_MOTOR,
        autorNome: autor,
        observacoes: dados.observacoes,
      },
      select: { id: true },
    });
    return { id: criada.id, versao, resultado };
  });
}

// REEXECUTAR a partir do snapshot e conferir com o gravado.
export function reexecutar(snapshot: { entrada: unknown; resultado: unknown }): { resultado: ResultadoSimulacao; confere: boolean } {
  const resultado = simular(snapshot.entrada as EntradaSimulacao);
  const gravado = snapshot.resultado as ResultadoSimulacao;
  const confere =
    Math.abs(resultado.totais.custoTotal - gravado.totais.custoTotal) < 0.01 &&
    Math.abs(resultado.totais.faturamento - gravado.totais.faturamento) < 0.01 &&
    resultado.itens.every((i, k) => Math.abs(i.precoUnidade - gravado.itens[k]?.precoUnidade) < 1e-9);
  return { resultado, confere };
}

// O HISTÓRICO DO PACOTE DE MIGRAÇÃO — Holambra e São José dos Pinhais — como
// estudos com versão 1. Idempotente: o que já existe (por edital e órgão) é
// mantido como está.
export async function importarHistorico(companyId: string, autor: string | null): Promise<{ criados: string[]; existentes: string[] }> {
  const criados: string[] = [];
  const existentes: string[] = [];
  for (const h of simulacoesHistoricas()) {
    const ja = await prisma.simEstudo.findFirst({ where: { companyId, numeroEdital: h.edital.numero, orgao: h.edital.orgao }, select: { id: true } });
    if (ja) {
      existentes.push(h.edital.numero);
      continue;
    }
    const id = await criarEstudo(
      companyId,
      {
        tipo: "LICITACAO",
        nome: `${h.edital.municipio}/${h.edital.uf} — ${h.edital.numero}`,
        cliente: h.edital.orgao,
        tipoServico: h.edital.tipoServico,
        uf: h.edital.uf,
        municipio: h.edital.municipio,
        descricao: h.edital.objeto,
        criterioJulgamento: h.entrada.criterio,
        unidadePreco: "KM",
        vigenciaMeses: h.edital.vigenciaMeses,
        prazoPagamentoDias: h.edital.prazoPagamentoDias,
        orgao: h.edital.orgao,
        numeroEdital: h.edital.numero,
        modalidade: h.edital.modalidade,
        plataforma: h.edital.plataforma,
        dataSessao: new Date(`${h.edital.dataSessao}T12:00:00`),
        srp: h.edital.srp,
        valorTotalMaximo: h.edital.valorTotalMaximo,
      },
      autor
    );
    await prisma.simEstudo.update({
      where: { id },
      data: {
        status: "PROPOSTA_ENVIADA",
        fonte: FONTE_HISTORICO,
        observacoes: h.observacoes,
        dataOrcamento: h.edital.dataOrcamento ? new Date(`${h.edital.dataOrcamento}T12:00:00`) : null,
        indiceReajuste: h.edital.indiceReajuste,
        regras: { create: h.regras.map((r, ordem) => ({ ordem, tema: r.tema, texto: r.texto, impacto: r.impacto, campoAfetado: r.campo })) },
      },
    });
    const origem: MapaOrigem = {};
    for (const grupo of Object.keys(h.entrada.premissas) as (keyof Premissas)[]) {
      if (grupo === "perfis") continue;
      for (const campo of Object.keys(h.entrada.premissas[grupo] as object)) origem[`${grupo}.${campo}`] = { origem: "HISTORICO", fonte: FONTE_HISTORICO };
    }
    await salvarVersao(companyId, id, { entrada: h.entrada, origem, status: "LANCADA", observacoes: h.observacoes, baseEm: null }, autor);
    criados.push(h.edital.numero);
  }
  return { criados, existentes };
}

export async function registrarLance(
  companyId: string,
  estudoId: string,
  dados: { fase: string; dataHora: Date; precos: { item: string; preco: number }[]; valorTotal: number | null; observacao: string | null; simulacaoId: string | null },
  autor: string | null
) {
  const estudo = await prisma.simEstudo.findFirst({ where: { id: estudoId, companyId }, select: { id: true } });
  if (!estudo) return { erro: "Estudo não encontrado." };
  await prisma.simLance.create({
    data: {
      estudoId,
      simulacaoId: dados.simulacaoId,
      fase: dados.fase,
      dataHora: dados.dataHora,
      precos: dados.precos as unknown as Prisma.InputJsonValue,
      valorTotal: dados.valorTotal,
      observacao: dados.observacao,
      registradoPorNome: autor,
    },
  });
  return { ok: true };
}

export async function registrarResultado(
  companyId: string,
  estudoId: string,
  dados: { status: string; posicao: number | null; vencedor: string | null; precoKm: number | null; valorTotal: number | null; data: Date | null; observacao: string | null }
) {
  const r = await prisma.simEstudo.updateMany({
    where: { id: estudoId, companyId },
    data: {
      status: dados.status,
      resultadoPosicao: dados.posicao,
      resultadoVencedor: dados.vencedor,
      resultadoPrecoKm: dados.precoKm,
      resultadoValorTotal: dados.valorTotal,
      resultadoData: dados.data,
      resultadoObservacao: dados.observacao,
    },
  });
  return r.count === 1 ? { ok: true } : { erro: "Estudo não encontrado." };
}

export type DadosRealizado = {
  competencia: string;
  kmPrevisto?: number | null;
  kmRealizado?: number | null;
  faturamento?: number | null;
  custoFolha?: number | null;
  custoCombustivel?: number | null;
  custoManutencao?: number | null;
  custoVeiculo?: number | null;
  custoPedagio?: number | null;
  custoIndiretos?: number | null;
  custoOutros?: number | null;
};

// O realizado de um mês chega por partes — o km da telemetria num dia, o
// custo da controladoria no fechamento. Por isso é upsert por competência, e
// um campo ausente não apaga o que já estava gravado.
export async function gravarRealizado(companyId: string, estudoId: string, dados: DadosRealizado, fonte: string, autor: string | null) {
  if (!/^\d{4}-\d{2}$/.test(dados.competencia)) return { erro: "Competência no formato AAAA-MM." };
  const estudo = await prisma.simEstudo.findFirst({ where: { id: estudoId, companyId }, select: { id: true } });
  if (!estudo) return { erro: "Estudo não encontrado." };
  const campos = Object.fromEntries(Object.entries(dados).filter(([k, v]) => k !== "competencia" && v !== undefined));
  await prisma.simContratoRealizado.upsert({
    where: { estudoId_competencia: { estudoId, competencia: dados.competencia } },
    create: { estudoId, competencia: dados.competencia, fonte, registradoPorNome: autor, ...campos },
    update: { fonte, registradoPorNome: autor, ...campos },
  });
  return { ok: true };
}

export function realizadosParaCalibracao(
  linhas: { competencia: string; kmRealizado: unknown; faturamento: unknown; custoFolha: unknown; custoCombustivel: unknown; custoManutencao: unknown; custoVeiculo: unknown; custoPedagio: unknown; custoIndiretos: unknown }[]
): RealizadoMes[] {
  return linhas.map((l) => ({
    competencia: l.competencia,
    kmRealizado: paraNumero(l.kmRealizado),
    faturamento: paraNumero(l.faturamento),
    custos: {
      folha: paraNumero(l.custoFolha),
      combustivel: paraNumero(l.custoCombustivel),
      manutencao: paraNumero(l.custoManutencao),
      veiculo: paraNumero(l.custoVeiculo),
      pedagio: paraNumero(l.custoPedagio),
      indiretos: paraNumero(l.custoIndiretos),
    },
  }));
}
