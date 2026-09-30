import { Prisma } from "@prisma/client";
import { PREMIO_EVENTUAL_FIM_DE_SEMANA } from "./convencoes";
import { horarioValido, jornadaDoHorario } from "./horario";
import { prisma } from "@/lib/prisma";
import { simular, VERSAO_MOTOR } from "./motor";
import { precoDoConjunto } from "./decisao";
import { baseVigente, paraNumero, type BaseVigente } from "./baseDeCustos";
import { PERFIS_PADRAO, perfisDaBase, premissasDaBase, problemasNasPremissas, regrasDeCapitalNosPerfis, type MapaOrigem } from "./premissas";
import { simulacoesHistoricas, FONTE_HISTORICO } from "./historico";
import type { CriterioJulgamento, EntradaSimulacao, Item, PerfilVeiculo, Premissas, ResultadoSimulacao, Rota, TipoVeiculo, UnidadePreco } from "./tipos";
import type { RealizadoMes } from "./calibracao";

// OS ESTUDOS DE CUSTO — a persistência do simulador.
//
// Um estudo guarda a DEFINIÇÃO corrente da operação (itens e rotas, editáveis)
// e as VERSÕES de simulação, cada uma com o snapshot completo da entrada do
// motor. Salvar uma versão grava as duas coisas: a definição passa a ser a
// da versão, e a versão fica congelada. Reexecutar é chamar simular() com o
// snapshot — o resultado tem de ser o gravado, e `reexecutar` confere.

export const TIPOS_ESTUDO = ["LICITACAO", "CONTRATACAO_DIRETA", "CONTRATO_PRIVADO", "RENOVACAO", "ORCAMENTO_INTERNO", "OUTRO"] as const;
export const ROTULO_TIPO_ESTUDO: Record<(typeof TIPOS_ESTUDO)[number], string> = {
  LICITACAO: "Licitação",
  CONTRATACAO_DIRETA: "Contratação direta (dispensa / inexigibilidade)",
  CONTRATO_PRIVADO: "Contrato privado",
  RENOVACAO: "Renovação de contrato",
  ORCAMENTO_INTERNO: "Orçamento interno",
  OUTRO: "Outro",
};
export const TIPOS_SERVICO = ["FRETAMENTO", "FRETAMENTO_EVENTUAL", "ESCOLAR", "SAUDE", "LOCACAO_CM", "LOCACAO_SM", "OUTRO"] as const;
export const ROTULO_TIPO_SERVICO: Record<(typeof TIPOS_SERVICO)[number], string> = {
  FRETAMENTO: "Fretamento contínuo",
  FRETAMENTO_EVENTUAL: "Fretamento eventual (viagens, eventos, turismo)",
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
  // Na ordem escolhida; o primeiro é o tipo das rotas novas.
  tiposVeiculo?: TipoVeiculo[];
  esfera?: "PUBLICO" | "PRIVADO";
  clienteDocumento?: string | null;
  contatoCliente?: string | null;
  validadeProposta?: Date | null;
  inicioPrevisto?: Date | null;
  indiceReajuste?: string | null;
  formaFaturamento?: string | null;
  avisoRescisaoDias?: number | null;
  // Os itens já conhecidos ao criar (lotes do edital, linhas da proposta).
  // Com km informado, o item nasce com uma rota do tipo de veículo dele.
  itens?: ItemNovo[];
};

export type ItemNovo = {
  descricao: string;
  tipoVeiculo?: TipoVeiculo | null;
  veiculos?: number | null;
  km?: number | null;
  precoMaximoKm?: number | null;
  // Proposta privada: como o veículo roda no dia (ver horario.ts).
  administrativo?: boolean;
  turnos?: number | null;
  diasMes?: number | null;
  horarioInicio?: string | null;
  horarioFim?: string | null;
};

// Dias de referência para o km por dia da rota inicial: 22 no mês, 200 no
// ano letivo (escolar, contrato por período). A pessoa ajusta na Operação.
const DIAS_ROTA_INICIAL = { MENSAL: 22, PERIODO: 200 } as const;

// Itens e rotas com que o estudo nasce. Sem itens informados, um item com o
// nome do estudo. A rota guarda o TIPO em perfilVeiculo; ao abrir, vira o
// código do perfil daquele tipo (ver perfilDasRotasNovas).
export function itensIniciais(dados: Pick<DadosEstudo, "nome" | "tipoServico" | "itens" | "tiposVeiculo">) {
  const comMotorista = dados.tipoServico !== "LOCACAO_SM";
  const periodo = dados.tipoServico === "ESCOLAR";
  const lista = (dados.itens ?? []).filter((i) => i.descricao.trim() !== "" || (i.km ?? 0) > 0 || i.administrativo === true).slice(0, 100);
  if (lista.length === 0) return { itens: [{ codigo: "1", descricao: dados.nome, ordem: 0, comMotorista }], rotas: [] };
  const itens = lista.map((i, k) => ({
    codigo: String(k + 1),
    descricao: i.descricao.trim().slice(0, 200) || (lista.length === 1 ? dados.nome : `Item ${k + 1}`),
    ordem: k,
    comMotorista,
    precoMaximoKm: i.precoMaximoKm && i.precoMaximoKm > 0 ? i.precoMaximoKm : null,
  }));
  // A rota nasce com o km, ou com o veículo à disposição (ADM), ou com o
  // horário da operação — o resto se ajusta na aba Operação.
  const rotas = lista.flatMap((i, k) => {
    const jornada = jornadaDoHorario(i.horarioInicio, i.horarioFim);
    const km = i.km && i.km > 0 ? i.km : 0;
    if (km === 0 && i.administrativo !== true && !jornada) return [];
    const tipo = i.tipoVeiculo ?? dados.tiposVeiculo?.[0] ?? null;
    const veiculos = i.veiculos && i.veiculos > 0 ? i.veiculos : 1;
    const turnos = i.turnos && Number.isInteger(i.turnos) && i.turnos >= 1 && i.turnos <= 4 ? i.turnos : 1;
    const fu = PERFIS_PADRAO.find((p) => p.tipo === tipo)?.motorista.motoristasPorVeiculo ?? 1.2;
    const diasMes = i.diasMes && Number.isInteger(i.diasMes) && i.diasMes >= 1 && i.diasMes <= 31 ? i.diasMes : 22;
    const dias = periodo ? DIAS_ROTA_INICIAL.PERIODO : diasMes;
    return [
      {
        itemCodigo: String(k + 1),
        ordem: k,
        nome: itens[k].descricao,
        kmReferencia: km,
        kmDia: Math.round((km / dias) * 10) / 10,
        diasMes,
        veiculos,
        // Cada turno tem a sua equipe: motoristas = veículos × fator do tipo × turnos.
        motoristas: comMotorista ? Math.round(veiculos * fu * turnos * 100) / 100 : 0,
        perfilVeiculo: tipo,
        horasDia: jornada?.horas ?? null,
        noturno: jornada?.noturno ?? false,
        horarioInicio: jornada ? i.horarioInicio!.trim() : null,
        horarioFim: jornada ? i.horarioFim!.trim() : null,
        turnos,
        administrativo: i.administrativo === true,
      },
    ];
  });
  return { itens, rotas };
}

// Rotas criadas com o formulário guardam o TIPO de veículo; o estudo abre
// com os perfis da base (código BASE-n) ou os padrões (código = tipo). A rota
// passa a apontar o primeiro perfil daquele tipo, com os motoristas dele.
export function perfilDasRotasNovas(rotas: Rota[], perfis: PerfilVeiculo[]): Rota[] {
  return rotas.map((r) => {
    if (!r.perfilVeiculo || perfis.some((p) => p.codigo === r.perfilVeiculo)) return r;
    const doTipo = perfis.find((p) => p.tipo === r.perfilVeiculo) ?? perfis[0];
    if (!doTipo) return { ...r, perfilVeiculo: null };
    const motoristas = r.motoristas > 0 ? Math.round(r.veiculos * doTipo.motorista.motoristasPorVeiculo * (r.turnos ?? 1) * 100) / 100 : 0;
    return { ...r, perfilVeiculo: doTipo.codigo, motoristas };
  });
}

export async function criarEstudo(companyId: string, dados: DadosEstudo, autor: string | null): Promise<string> {
  const iniciais = itensIniciais(dados);
  const estudo = await prisma.simEstudo.create({
    data: {
      companyId,
      tipo: dados.tipo,
      nome: dados.nome,
      cliente: dados.cliente ?? null,
      tipoServico: dados.tipoServico,
      tiposVeiculo: dados.tiposVeiculo ?? [],
      esfera: dados.esfera ?? (dados.tipo === "LICITACAO" || dados.tipo === "CONTRATACAO_DIRETA" ? "PUBLICO" : "PRIVADO"),
      clienteDocumento: dados.clienteDocumento ?? null,
      contatoCliente: dados.contatoCliente ?? null,
      validadeProposta: dados.validadeProposta ?? null,
      inicioPrevisto: dados.inicioPrevisto ?? null,
      indiceReajuste: dados.indiceReajuste ?? null,
      formaFaturamento: dados.formaFaturamento ?? null,
      avisoRescisaoDias: dados.avisoRescisaoDias ?? null,
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
      // Ao menos um item: o estudo nasce pronto para receber rotas.
      itens: { create: iniciais.itens },
      rotas: { create: iniciais.rotas },
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
    pracaPedagio: r.pracaPedagio,
    horarioInicio: r.horarioInicio,
    horarioFim: r.horarioFim,
    turnos: r.turnos,
    administrativo: r.administrativo,
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
    clientePublico: estudo.esfera === "PUBLICO",
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
  // Fretamento eventual: o km orçado é o da viagem, e é o que se roda e se
  // cobra — não há demanda que possa cair. O custo fixo do veículo se paga
  // pelos dias vendidos no mês (os dias/mês da rota), por isso a diária é a
  // unidade natural.
  if (estudo.tipoServico === "FRETAMENTO_EVENTUAL") {
    premissas.contrato.utilizacao = 1;
    // PRÊMIO DO MOTORISTA (CCT TRANSFRETUR, cláusula 9ª): 8% da nota sem os
    // tributos em fim de semana, feriado ou viagem longa (5% em dia útil
    // fora do expediente), no lugar das horas extras e do adicional noturno.
    // Entra como despesa sobre o preço; a hora extra sai.
    const pr = premissas.preco;
    const tributosDaNota = pr.pis + pr.cofins + Math.max(pr.iss, pr.icms);
    const premio = PREMIO_EVENTUAL_FIM_DE_SEMANA * (1 - tributosDaNota);
    pr.despesasSobrePrecoPct = Number((pr.despesasSobrePrecoPct + premio).toFixed(6));
    origem["preco.despesasSobrePrecoPct"] = {
      origem: "PADRAO",
      fonte: "CCT TRANSFRETUR × SINDIFRETUR 2026/2028, cláusula 9ª",
      detalhe: `prêmio do motorista no fretamento eventual: 8% da nota sem tributos = ${(premio * 100).toFixed(2)}% do preço (5% em dia útil fora do expediente)`,
    };
    premissas.pessoal.horaExtraPct = 0;
    origem["pessoal.horaExtraPct"] = { origem: "PADRAO", fonte: "CCT TRANSFRETUR × SINDIFRETUR 2026/2028, cláusula 9ª", detalhe: "o prêmio da viagem compensa horas extras e adicional noturno" };
  }
  if (estudo.vigenciaMeses) premissas.contrato.vigenciaMeses = estudo.vigenciaMeses;
  if (estudo.prazoPagamentoDias) premissas.preco.prazoRecebimentoDias = estudo.prazoPagamentoDias;
  premissas.perfis = perfisDoEstudo(perfisDaBase(vazia ? null : baseCarregada), estudo.tiposVeiculo as TipoVeiculo[]);
  regrasDeCapitalNosPerfis(premissas, origem);
  return {
    entrada: {
      premissas,
      itens,
      rotas: perfilDasRotasNovas(rotas, premissas.perfis),
      criterio: estudo.criterioJulgamento === "LOTE" ? "LOTE" : "ITEM",
      unidadePreco: (estudo.unidadePreco as UnidadePreco) ?? "KM",
    },
    origem,
    versaoBase: null,
    baseEm: vazia ? null : (baseCarregada?.em ?? null),
  };
}

// OS TIPOS DE VEÍCULO DO ESTUDO: os escolhidos ao criar, na ordem escolhida.
// Da base vêm os modelos daquele tipo (com os custos da Azul); tipo escolhido
// sem modelo na base entra pelo padrão do simulador. Nada escolhido = todos.
export function perfisDoEstudo(daBase: PerfilVeiculo[], tipos: TipoVeiculo[] | null | undefined): PerfilVeiculo[] {
  if (!tipos || tipos.length === 0) return daBase;
  return tipos.flatMap((t) => {
    const achados = daBase.filter((p) => p.tipo === t);
    if (achados.length > 0) return achados;
    const padrao = PERFIS_PADRAO.find((p) => p.tipo === t);
    return padrao ? [structuredClone(padrao)] : [];
  });
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

// Campos numéricos da rota: obrigatórios (número ≥ 0) e opcionais (nulo ou
// número ≥ 0). `numerosFinitos` só olha o que já é número — um texto no lugar
// de um número passava por ele e virava NaN no motor e erro do Prisma ao
// gravar a definição corrente.
const CAMPOS_ROTA_OBRIGATORIOS = ["kmReferencia", "kmDia", "kmTerraDia", "veiculos", "motoristas", "monitoras", "passagensPedagioMes", "tarifaPedagio"] as const;
const CAMPOS_ROTA_OPCIONAIS = ["diasMes", "horasDia", "viagensDia"] as const;
const UNIDADES_PRECO: UnidadePreco[] = ["KM", "VEICULO_MES", "DIARIA", "HORA", "BINOMIA"];
const numeroValido = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;
const opcionalValido = (v: unknown) => v === null || v === undefined || numeroValido(v);

export function validarEntrada(entrada: EntradaSimulacao): string | null {
  if (!entrada || !Array.isArray(entrada.itens) || !Array.isArray(entrada.rotas) || !entrada.premissas) return "Simulação incompleta.";
  if (entrada.itens.length > 100 || entrada.rotas.length > 1000 || (entrada.premissas.perfis?.length ?? 0) > 40) return "Simulação grande demais (máx. 100 itens, 1.000 rotas, 40 perfis).";
  if (!numerosFinitos(entrada)) return "Há um número inválido nas premissas, itens ou rotas.";
  // Critério e unidade vão direto para o motor e para SimEstudo: uma unidade
  // desconhecida fazia o faturamento sair NaN e a gravação estourar no banco.
  if (entrada.criterio !== "ITEM" && entrada.criterio !== "LOTE") return "Critério de julgamento inválido (ITEM ou LOTE).";
  if (entrada.unidadePreco !== undefined && entrada.unidadePreco !== null && !UNIDADES_PRECO.includes(entrada.unidadePreco)) return "Unidade de preço inválida.";
  const itemRuim = entrada.itens.find(
    (i) => !i || typeof i.codigo !== "string" || i.codigo.trim() === "" || typeof i.descricao !== "string" || !numeroValido(i.shareIntermunicipal) || i.shareIntermunicipal > 1 || !opcionalValido(i.precoMaximoKm) || !opcionalValido(i.precoReferenciaKm)
  );
  if (itemRuim) return `O item "${String(itemRuim?.codigo ?? "")}" tem código, descrição, parcela intermunicipal ou preço inválidos.`;
  const rotaRuim = entrada.rotas.find(
    (r) =>
      !r ||
      typeof r.item !== "string" ||
      typeof r.nome !== "string" ||
      typeof r.noturno !== "boolean" ||
      (r.periodos !== null && r.periodos !== undefined && typeof r.periodos !== "string") ||
      !horarioValido(r.horarioInicio) ||
      !horarioValido(r.horarioFim) ||
      (r.turnos !== null && r.turnos !== undefined && !(Number.isInteger(r.turnos) && r.turnos >= 1 && r.turnos <= 4)) ||
      (r.administrativo !== undefined && typeof r.administrativo !== "boolean") ||
      CAMPOS_ROTA_OBRIGATORIOS.some((k) => !numeroValido(r[k])) ||
      CAMPOS_ROTA_OPCIONAIS.some((k) => !opcionalValido(r[k]))
  );
  if (rotaRuim) return `A rota "${String(rotaRuim?.nome ?? "")}" tem um campo inválido (km, veículos, equipe, dias, horas, horário, turnos, pedágio, noturno ou períodos).`;
  // SimRota.diasMes é inteiro no banco: 21,5 era truncado para 21 na definição
  // corrente enquanto o snapshot da versão guardava 21,5 — reabrir o estudo
  // dava outra conta que a da versão salva.
  const diasRuins = entrada.rotas.find((r) => r.diasMes !== null && r.diasMes !== undefined && (!Number.isInteger(r.diasMes) || r.diasMes > 31));
  if (diasRuins) return `A rota "${diasRuins.nome}" tem ${diasRuins.diasMes} dias por mês: informe um número inteiro de 0 a 31.`;
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
  // O preço do resumo é o mesmo do topo do editor e do painel de decisão
  // (precoDoConjunto): a média de precoUnidade ponderada pela quantidade. A
  // conta antiga (faturamento ÷ quantidade) dava, na binômia, o faturamento
  // inteiro por km (R$ 9,31) onde a tela mostrava a parcela por km (R$ 2,38);
  // e o Math.max(1, …) dividia por 1 quando a quantidade era menor que 1.
  const quantidade = resultado.itens.reduce((a, i) => a + i.quantidadeUnidade, 0);
  const principal = resultado.lote
    ? { preco: resultado.lote.precoPropostaUnidade, margem: resultado.lote.margemAoPrecoProposta, lucro: resultado.lote.lucroAoPrecoProposta, fat: resultado.lote.faturamentoAoPrecoProposta }
    : {
        preco: quantidade > 0 ? precoDoConjunto(resultado) : null,
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
          pracaPedagio: r.pracaPedagio ?? null,
          horarioInicio: r.horarioInicio || null,
          horarioFim: r.horarioFim || null,
          turnos: r.turnos ?? null,
          administrativo: r.administrativo === true,
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
        esfera: "PUBLICO",
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
  if (Number.isNaN(dados.dataHora.getTime())) return { erro: "Data e hora do lance inválidas." };
  // A versão vem do formulário: tem de ser uma versão DESTE estudo. Sem a
  // conferência, um id qualquer estourava a chave estrangeira (erro cru na
  // tela) e o id de uma versão de outra empresa era aceito e ligado ao lance.
  if (dados.simulacaoId) {
    const versao = await prisma.simSimulacao.findFirst({ where: { id: dados.simulacaoId, estudoId }, select: { id: true } });
    if (!versao) return { erro: "Versão da simulação não encontrada neste estudo." };
  }
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
