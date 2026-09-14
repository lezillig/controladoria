import type { AbastecimentoGestao, PrecoAnpGestao } from "@/lib/gestao/leitura";
import type { AuditSeveridade } from "@prisma/client";
import { fmtBRL, fmtData, fmtNumero, fmtPercent } from "../format";
import { inicioDoDia, somarDias } from "../periodos";
import type { AchadoNovo, Agente, ContextoAuditoria } from "../types";
import { agrupar, chaveAchado, chaveMes, materialidadeCents, mediana, severidadePorValor, somar } from "./comum";

// AGENTE DE FROTA E COMBUSTÍVEL
//
// Combustível é, em transportadora de passageiros, a segunda maior despesa
// depois da folha — e a que mais vaza. O vazamento raramente é um roubo
// grande: é o cartão de frota abastecendo o carro de alguém, o posto que
// "arredonda" o litro, o tanque que enche duas vezes no mesmo dia, o
// hodômetro que anda para trás. Nenhum desses aparece na Omie, onde chega só
// a fatura mensal do cartão. Aparece no EXTRATO DO CARTÃO, transação por
// transação, que o sistema de gestão importa (FuelTransaction) e este agente
// cruza com o que a operação registra: escala, uso real do veículo, cadastro
// da frota e o preço de referência da ANP.
//
// Mesma regra de ouro do antifraude: nada aqui acusa. Cada achado diz qual
// verificação fazer (a nota do posto, o hodômetro no painel, a escala do
// dia) e o que a evidência mostra. E cada regra fica CALADA quando o dado
// que a sustenta não está mantido — abastecimento sem escala só é indício
// numa empresa que registra escala.

// A JANELA É A DO CONTEXTO. O ciclo diário carrega 400 dias de abastecimento
// e a auditoria retroativa carrega o período pedido — e tudo o que foi
// carregado é auditado, mês a mês. Não há "só os últimos N dias" aqui de
// propósito: o pedido é olhar para trás e achar o que já aconteceu, não só o
// que vai acontecer. Cada achado é agregado por veículo e mês, então o volume
// é limitado pelo número de meses com anomalia, não pelo número de transações.

// Volume plausível de um abastecimento: 1,5x o percentil 90 do próprio
// veículo (ou do modelo, quando o veículo tem pouca história). Um tanque não
// muda de tamanho; o que passa disso não coube nele.
const MINIMO_DE_ABASTECIMENTOS_DO_VEICULO = 8;
const MINIMO_DE_ABASTECIMENTOS_DO_MODELO = 15;
const FATOR_DO_TANQUE = 1.5;
// Abaixo disso de excedente é arredondamento de bomba, não indício.
const EXCEDENTE_MINIMO_LITROS = 20;
// Dois abastecimentos do mesmo veículo em menos de 12 horas somando mais que
// o tanque: o segundo não foi para o mesmo tanque.
const JANELA_DO_TANQUE_HORAS = 12;

// Consumo: km rodados entre dois abastecimentos consecutivos divididos pelos
// litros do segundo. Precisa de hodômetro nos dois. Abaixo da metade do
// consumo típico do veículo, os litros não viraram quilômetro.
const MINIMO_DE_INTERVALOS_COM_HODOMETRO = 6;
const FATOR_DE_CONSUMO_BAIXO = 0.5;
const INTERVALO_KM_MINIMO = 5;
const INTERVALO_KM_MAXIMO = 3_000;

// Abastecimento sem escala nem uso: só quando a empresa registra escala/uso
// para a grande maioria dos abastecimentos — do contrário, o dado é que não
// está mantido, e a regra apontaria a empresa inteira.
const COBERTURA_MINIMA_DE_OPERACAO = 0.7;
// Placa fora da frota: só quando o vínculo placa→veículo está feito para a
// grande maioria das transações (a gestão já avisa que o cadastro pode estar
// incompleto frente à frota real).
const COBERTURA_MINIMA_DE_VINCULO = 0.8;

// Preço: um posto 8% acima da mediana da frota para o mesmo produto no mesmo
// mês, com pelo menos 3 abastecimentos — e a frota com base suficiente para
// a mediana significar algo (10 abastecimentos em 3 postos).
const SOBREPRECO_MINIMO = 0.08;
const TOLERANCIA_SOBRE_ANP = 0.1;
const MINIMO_NO_POSTO = 3;
const MINIMO_DA_FROTA_NO_MES = 10;
const MINIMO_DE_POSTOS_NO_MES = 3;

// Produto: um veículo que abastece diesel em 80% de pelo menos 6 registros
// não passou a beber gasolina.
const MINIMO_PARA_PRODUTO_DOMINANTE = 6;
const DOMINANCIA_DE_PRODUTO = 0.8;

// Um motorista abastecendo 3 veículos diferentes no mesmo dia está com o
// cartão de mais gente do que devia — ou é o manobrista, o que a
// recorrência mostra.
const VEICULOS_POR_DIA_PARA_APONTAR = 3;

export const agenteFrota: Agente = {
  id: "frota",
  nome: "Frota e combustível",
  area: "Operações",
  descricao:
    "Cruza o extrato do cartão de frota com a operação registrada na gestão para achar combustível que não foi para o tanque da empresa: abastecimento maior que o tanque ou repetido no mesmo dia, consumo que despenca ou hodômetro que anda para trás, abastecimento em dia sem escala nem uso do veículo, placa fora da frota ou veículo inativo, produto que o veículo não usa, posto cobrando acima da frota e da ANP, e motorista abastecendo vários veículos no mesmo dia.",
  executar: auditarFrota,
};

export function auditarFrota(ctx: ContextoAuditoria): AchadoNovo[] {
  const abastecimentos = (ctx.abastecimentos ?? []).filter((a) => a.volumeLitros > 0 || a.valorCents > 0);
  if (abastecimentos.length === 0) return [];
  const materialidade = materialidadeCents(ctx);
  const recentes = abastecimentos;
  const frota = montarFrota(ctx, abastecimentos);

  return [
    ...volumeAcimaDoTanque(frota, recentes, materialidade),
    ...consumoImplausivel(frota, recentes, materialidade),
    ...abastecimentoSemOperacao(ctx, frota, recentes, materialidade),
    ...placaForaDaFrota(ctx, frota, abastecimentos, recentes, materialidade),
    ...produtoIncompativel(frota, recentes, materialidade),
    ...postoAcimaDaFrota(ctx, recentes, materialidade),
    ...motoristaComVariosVeiculos(frota, recentes),
  ];
}

// ---------------------------------------------------------------------------
// Base comum: como cada abastecimento é identificado e nomeado.
// ---------------------------------------------------------------------------

type Frota = {
  chaveVeiculo: (a: AbastecimentoGestao) => string;
  placa: (a: AbastecimentoGestao) => string;
  modelo: (a: AbastecimentoGestao) => string | null;
  motorista: (a: AbastecimentoGestao) => string;
  porVeiculo: Map<string, AbastecimentoGestao[]>;
};

function montarFrota(ctx: ContextoAuditoria, abastecimentos: AbastecimentoGestao[]): Frota {
  const veiculos = new Map(ctx.veiculos.map((v) => [v.id, v]));
  const motoristas = new Map(ctx.motoristas.map((m) => [m.id, m.name]));
  const chaveVeiculo = (a: AbastecimentoGestao) => a.vehicleId ?? `placa:${normalizarPlaca(a.placaOriginal)}`;
  const porVeiculo = agrupar(
    [...abastecimentos].sort((x, y) => x.dataHora.getTime() - y.dataHora.getTime()),
    chaveVeiculo
  );
  return {
    chaveVeiculo,
    placa: (a) => (a.vehicleId && veiculos.get(a.vehicleId)?.plate) || normalizarPlaca(a.placaOriginal) || "(sem placa)",
    modelo: (a) => (a.vehicleId && veiculos.get(a.vehicleId)?.model) || a.modeloOriginal || null,
    motorista: (a) =>
      (a.driverId && motoristas.get(a.driverId)) || a.motoristaOriginal || "(motorista não identificado)",
    porVeiculo,
  };
}

function normalizarPlaca(placa: string): string {
  return placa.replace(/[^A-Z0-9]/gi, "").toUpperCase();
}

// Percentil por interpolação simples — p entre 0 e 1.
export function percentil(valores: number[], p: number): number {
  if (valores.length === 0) return 0;
  const ordenado = [...valores].sort((a, b) => a - b);
  const posicao = (ordenado.length - 1) * p;
  const i = Math.floor(posicao);
  const fracao = posicao - i;
  return i + 1 < ordenado.length ? ordenado[i] + (ordenado[i + 1] - ordenado[i]) * fracao : ordenado[i];
}

function precoPorLitro(a: AbastecimentoGestao): number | null {
  return a.volumeLitros > 0 ? a.valorCents / a.volumeLitros : null;
}

function fmtLitros(litros: number): string {
  return `${fmtNumero(litros, 1)} L`;
}

const fmtPrecoLitro = (cents: number) => `${fmtBRL(Math.round(cents))}/L`;

// Severidade de indício de frota: o dinheiro de UM abastecimento é sempre
// pequeno perto da materialidade da empresa, então só o valor rebaixaria tudo
// a BAIXA. Recorrência no mês é o que sobe: três casos no mesmo veículo não
// são coincidência.
function severidadeDeFrota(valorCents: number, casos: number, materialidade: number): AuditSeveridade {
  const porValor = severidadePorValor(valorCents, materialidade);
  const porRecorrencia: AuditSeveridade = casos >= 3 ? "MEDIA" : "BAIXA";
  const escala: AuditSeveridade[] = ["INFO", "BAIXA", "MEDIA", "ALTA", "CRITICA"];
  return escala[Math.max(escala.indexOf(porValor), escala.indexOf(porRecorrencia))];
}

// ---------------------------------------------------------------------------
// FR-COMBUSTIVEL-VOLUME — mais litros do que o tanque comporta
// ---------------------------------------------------------------------------
// Dois modos, mesma pergunta: (a) um abastecimento acima de 1,5x o percentil
// 90 do veículo; (b) dois abastecimentos do mesmo veículo em 12 horas cuja
// soma passa disso. Um achado por veículo e mês, com a lista.
function volumeAcimaDoTanque(frota: Frota, recentes: AbastecimentoGestao[], materialidade: number): AchadoNovo[] {
  const achados: AchadoNovo[] = [];
  const tanquePorModelo = tanquesPorModelo(frota);

  for (const [chave, historico] of frota.porVeiculo) {
    const tanque = tanquePlausivel(historico, frota.modelo(historico[0]), tanquePorModelo);
    if (!tanque) continue;
    const doVeiculo = recentes.filter((a) => frota.chaveVeiculo(a) === chave);
    if (doVeiculo.length === 0) continue;

    type Caso = { data: string; motorista: string; litros: number; litrosDoTanque: number; excedenteLitros: number; valor: number; posto: string; modo: string };
    const casos: Caso[] = [];
    for (const a of doVeiculo) {
      const excedente = a.volumeLitros - tanque.litros;
      if (excedente >= EXCEDENTE_MINIMO_LITROS) {
        casos.push(caso(a, excedente, "acima do tanque"));
        continue;
      }
      // Modo (b): junto com o anterior do mesmo veículo em 12 horas.
      const anterior = anteriorEmHoras(historico, a, JANELA_DO_TANQUE_HORAS);
      if (!anterior) continue;
      const soma = a.volumeLitros + anterior.volumeLitros;
      if (soma - tanque.litros >= EXCEDENTE_MINIMO_LITROS) {
        casos.push(caso(a, soma - tanque.litros, `soma de ${fmtLitros(soma)} com o abastecimento anterior em menos de ${JANELA_DO_TANQUE_HORAS} h`));
      }
    }
    function caso(a: AbastecimentoGestao, excedente: number, modo: string): Caso {
      const preco = precoPorLitro(a) ?? 0;
      return {
        data: fmtData(a.dataHora),
        motorista: frota.motorista(a),
        litros: Math.round(a.volumeLitros * 10) / 10,
        litrosDoTanque: Math.round(tanque!.litros),
        excedenteLitros: Math.round(excedente * 10) / 10,
        valor: Math.round(excedente * preco),
        posto: a.posto ?? "—",
        modo,
      };
    }
    if (casos.length === 0) continue;

    for (const [mes, doMes] of agrupar(casos, (c) => c.data.slice(3))) {
      const valor = somar(doMes, (c) => c.valor);
      const placa = frota.placa(doVeiculo[0]);
      achados.push({
        regra: "FR-COMBUSTIVEL-VOLUME",
        tipo: "EVENTO",
        severidade: severidadeDeFrota(valor, doMes.length, materialidade),
        categoria: "FRAUDE",
        titulo: `${placa}: ${doMes.length} abastecimento(s) acima do que o tanque comporta em ${mes}`,
        descricao:
          `O volume típico de um abastecimento deste veículo é ${fmtLitros(tanque.tipico)} (${tanque.base}); ` +
          `o tanque plausível é ${fmtLitros(tanque.litros)}. ${doMes.length} abastecimento(s) passaram disso, ` +
          `somando ${fmtLitros(somar(doMes, (c) => c.excedenteLitros))} a mais — ${fmtBRL(valor)} de combustível ` +
          `que não coube neste tanque.`,
        recomendacao:
          "Pedir ao posto o cupom de cada abastecimento listado e conferir a placa e o hodômetro. Litros que não " +
          "cabem no tanque foram para outro veículo, para um galão ou nunca existiram (o posto registrou a mais).",
        valorCents: valor,
        impactoCents: valor,
        entidadeTipo: "Veiculo",
        entidadeId: chave,
        entidadeRef: placa,
        evidencia: { placa, litrosDoTanque: Math.round(tanque.litros), baseDoTanque: tanque.base, casos: doMes },
        chave: chaveAchado("FR-COMBUSTIVEL-VOLUME", chave, mes),
      });
    }
  }
  return achados;
}

type Tanque = { litros: number; tipico: number; base: string };

function tanquesPorModelo(frota: Frota): Map<string, number> {
  const porModelo = new Map<string, number[]>();
  for (const historico of frota.porVeiculo.values()) {
    const modelo = frota.modelo(historico[0]);
    if (!modelo) continue;
    const lista = porModelo.get(modelo.toUpperCase()) ?? [];
    lista.push(...historico.map((a) => a.volumeLitros).filter((l) => l > 0));
    porModelo.set(modelo.toUpperCase(), lista);
  }
  const resultado = new Map<string, number>();
  for (const [modelo, litros] of porModelo) {
    if (litros.length >= MINIMO_DE_ABASTECIMENTOS_DO_MODELO) resultado.set(modelo, percentil(litros, 0.9));
  }
  return resultado;
}

function tanquePlausivel(historico: AbastecimentoGestao[], modelo: string | null, porModelo: Map<string, number>): Tanque | null {
  const litros = historico.map((a) => a.volumeLitros).filter((l) => l > 0);
  if (litros.length >= MINIMO_DE_ABASTECIMENTOS_DO_VEICULO) {
    const tipico = percentil(litros, 0.9);
    return { litros: tipico * FATOR_DO_TANQUE, tipico, base: `percentil 90 de ${litros.length} abastecimentos do veículo` };
  }
  const doModelo = modelo ? porModelo.get(modelo.toUpperCase()) : undefined;
  if (doModelo) return { litros: doModelo * FATOR_DO_TANQUE, tipico: doModelo, base: `percentil 90 do modelo ${modelo}` };
  return null;
}

function anteriorEmHoras(historico: AbastecimentoGestao[], a: AbastecimentoGestao, horas: number): AbastecimentoGestao | null {
  const i = historico.indexOf(a);
  if (i <= 0) return null;
  const anterior = historico[i - 1];
  const diferencaHoras = (a.dataHora.getTime() - anterior.dataHora.getTime()) / 3_600_000;
  return diferencaHoras >= 0 && diferencaHoras < horas ? anterior : null;
}

// ---------------------------------------------------------------------------
// FR-COMBUSTIVEL-CONSUMO — os litros não viraram quilômetro
// ---------------------------------------------------------------------------
// Entre dois abastecimentos consecutivos com hodômetro, km rodados / litros
// do segundo é o consumo do intervalo. Comparado com a mediana do próprio
// veículo, um intervalo abaixo da metade diz que parte dos litros não rodou.
// Hodômetro que anda para trás entra no mesmo achado: é a forma mais simples
// de esconder exatamente isso.
function consumoImplausivel(frota: Frota, recentes: AbastecimentoGestao[], materialidade: number): AchadoNovo[] {
  const achados: AchadoNovo[] = [];
  const recentesIds = new Set(recentes.map((a) => a.id));

  for (const [chave, historico] of frota.porVeiculo) {
    const comHodometro = historico.filter((a) => a.hodometro !== null && a.hodometro > 0);
    if (comHodometro.length < MINIMO_DE_INTERVALOS_COM_HODOMETRO + 1) continue;

    type Intervalo = { a: AbastecimentoGestao; km: number; kmPorLitro: number | null };
    const intervalos: Intervalo[] = [];
    for (let i = 1; i < comHodometro.length; i++) {
      const anterior = comHodometro[i - 1];
      const atual = comHodometro[i];
      const km = (atual.hodometro as number) - (anterior.hodometro as number);
      const valido = km >= INTERVALO_KM_MINIMO && km <= INTERVALO_KM_MAXIMO && atual.volumeLitros > 0;
      intervalos.push({ a: atual, km, kmPorLitro: valido ? km / atual.volumeLitros : null });
    }
    const consumos = intervalos.map((i) => i.kmPorLitro).filter((k): k is number => k !== null);
    if (consumos.length < MINIMO_DE_INTERVALOS_COM_HODOMETRO) continue;
    // Mediana sobre décimos para não perder a fração (mediana() arredonda).
    const tipico = mediana(consumos.map((k) => Math.round(k * 100))) / 100;
    if (tipico <= 0) continue;

    const casos = intervalos
      .filter((i) => recentesIds.has(i.a.id))
      .flatMap((i) => {
        const preco = precoPorLitro(i.a) ?? 0;
        if (i.km < 0) {
          return [{
            data: fmtData(i.a.dataHora),
            motorista: frota.motorista(i.a),
            kmNoIntervalo: i.km,
            litros: Math.round(i.a.volumeLitros * 10) / 10,
            kmPorLitro: null as number | null,
            litrosSemRodar: Math.round(i.a.volumeLitros * 10) / 10,
            valor: Math.round(i.a.volumeLitros * preco),
            leitura: "hodômetro andou para trás (menor que o do abastecimento anterior)",
          }];
        }
        if (i.kmPorLitro === null || i.kmPorLitro >= tipico * FATOR_DE_CONSUMO_BAIXO) return [];
        const litrosQueRodaram = i.km / tipico;
        const semRodar = Math.max(0, i.a.volumeLitros - litrosQueRodaram);
        return [{
          data: fmtData(i.a.dataHora),
          motorista: frota.motorista(i.a),
          kmNoIntervalo: i.km,
          litros: Math.round(i.a.volumeLitros * 10) / 10,
          kmPorLitro: Math.round(i.kmPorLitro * 100) / 100,
          litrosSemRodar: Math.round(semRodar * 10) / 10,
          valor: Math.round(semRodar * preco),
          leitura: `consumo de ${fmtNumero(i.kmPorLitro, 2)} km/L contra ${fmtNumero(tipico, 2)} típicos`,
        }];
      });
    if (casos.length === 0) continue;

    for (const [mes, doMes] of agrupar(casos, (c) => c.data.slice(3))) {
      const valor = somar(doMes, (c) => c.valor);
      const placa = frota.placa(historico[0]);
      const regressoes = doMes.filter((c) => c.kmNoIntervalo < 0).length;
      achados.push({
        regra: "FR-COMBUSTIVEL-CONSUMO",
        tipo: "EVENTO",
        severidade: severidadeDeFrota(valor, doMes.length, materialidade),
        categoria: "FRAUDE",
        titulo: `${placa}: ${fmtLitros(somar(doMes, (c) => c.litrosSemRodar))} abastecidos sem quilômetro correspondente em ${mes}`,
        descricao:
          `O consumo típico deste veículo é ${fmtNumero(tipico, 2)} km/L, medido em ${consumos.length} intervalos ` +
          `entre abastecimentos com hodômetro. Em ${doMes.length} intervalo(s) do mês o consumo ficou abaixo da metade ` +
          `disso${regressoes > 0 ? ` (${regressoes} com hodômetro andando para trás)` : ""}: ` +
          `${fmtBRL(valor)} de combustível que não aparece em quilômetro rodado.`,
        recomendacao:
          "Conferir o hodômetro no painel contra o informado no cupom dos abastecimentos listados. Se o hodômetro " +
          "do cupom está certo, os litros saíram do tanque por outro caminho; se está errado, o frentista digita " +
          "qualquer número e o controle de consumo da frota não vale nada — exigir a leitura correta é o conserto.",
        valorCents: valor,
        impactoCents: valor,
        entidadeTipo: "Veiculo",
        entidadeId: chave,
        entidadeRef: placa,
        evidencia: { placa, kmPorLitroTipico: tipico, intervalosMedidos: consumos.length, casos: doMes },
        chave: chaveAchado("FR-COMBUSTIVEL-CONSUMO", chave, mes),
      });
    }
  }
  return achados;
}

// ---------------------------------------------------------------------------
// FR-COMBUSTIVEL-SEM-OPERACAO — abasteceu num dia em que não rodou
// ---------------------------------------------------------------------------
function abastecimentoSemOperacao(
  ctx: ContextoAuditoria,
  frota: Frota,
  recentes: AbastecimentoGestao[],
  materialidade: number
): AchadoNovo[] {
  const usos = ctx.usosDeVeiculo ?? [];
  const escalas = ctx.escalas ?? [];
  if (usos.length === 0 && escalas.length === 0) return [];

  const diasComEscala = new Set(escalas.map((e) => `${e.vehicleId}|${chaveDia(e.date)}`));
  const usosPorVeiculo = agrupar(usos, (u) => u.vehicleId);
  const teveOperacao = (a: AbastecimentoGestao): boolean => {
    if (!a.vehicleId) return true; // sem vínculo não dá para saber: não aponta
    if (diasComEscala.has(`${a.vehicleId}|${chaveDia(a.dataHora)}`)) return true;
    const inicio = inicioDoDia(a.dataHora).getTime();
    const fim = inicio + 86_400_000 - 1;
    return (usosPorVeiculo.get(a.vehicleId) ?? []).some(
      (u) => u.checkInAt.getTime() <= fim && (u.checkOutAt === null || u.checkOutAt.getTime() >= inicio)
    );
  };

  const vinculados = recentes.filter((a) => a.vehicleId);
  if (vinculados.length === 0) return [];

  // A cobertura é medida MÊS A MÊS: a empresa pode ter começado a registrar
  // escala em março, e o que importa é se naquele mês a ausência de registro
  // significa alguma coisa. Um mês em que quase nada tem escala é um mês sem
  // registro, não um mês de fraude. Mês com poucos abastecimentos oscila
  // (dois em três já são 67%), então a cobertura do período inteiro serve de
  // segunda referência: se a empresa registra bem no geral, basta que o mês
  // tenha pelo menos metade registrada.
  const coberturaGeral = vinculados.filter(teveOperacao).length / vinculados.length;
  const coberturaPorMes = new Map<string, number>();
  for (const [mes, doMes] of agrupar(vinculados, (a) => chaveMes(a.dataHora))) {
    coberturaPorMes.set(mes, doMes.filter(teveOperacao).length / doMes.length);
  }
  const mesRegistrado = (mes: string) => {
    const doMes = coberturaPorMes.get(mes) ?? 0;
    return doMes >= COBERTURA_MINIMA_DE_OPERACAO || (coberturaGeral >= COBERTURA_MINIMA_DE_OPERACAO && doMes >= 0.5);
  };

  const achados: AchadoNovo[] = [];
  const semOperacao = vinculados.filter((a) => !teveOperacao(a) && mesRegistrado(chaveMes(a.dataHora)));
  for (const [chave, lista] of agrupar(semOperacao, (a) => `${frota.chaveVeiculo(a)}|${chaveMes(a.dataHora)}`)) {
    const [veiculo, mes] = [chave.slice(0, chave.lastIndexOf("|")), chave.slice(chave.lastIndexOf("|") + 1)];
    const cobertura = coberturaPorMes.get(mes) ?? 0;
    const valor = somar(lista, (a) => a.valorCents);
    const placa = frota.placa(lista[0]);
    achados.push({
      regra: "FR-COMBUSTIVEL-SEM-OPERACAO",
      tipo: "EVENTO",
      severidade: severidadeDeFrota(valor, lista.length, materialidade),
      categoria: "FRAUDE",
      titulo: `${placa}: ${lista.length} abastecimento(s) em dia sem escala nem uso registrado (${mes})`,
      descricao:
        `A operação registra escala ou uso de veículo para ${fmtPercent(cobertura * 100, 0)} dos abastecimentos ` +
        `de ${mes} — e para estes ${lista.length}, somando ${fmtBRL(valor)}, não há nem escala nem check-in do ` +
        `veículo no dia. Combustível comprado para um veículo que não tinha o que fazer.`,
      recomendacao:
        "Confirmar com a operação o que o veículo fez nesses dias. Se rodou sem escala, o problema é de registro; " +
        "se ficou parado, o cartão dele abasteceu outro tanque — conferir a placa no cupom do posto.",
      valorCents: valor,
      impactoCents: valor,
      entidadeTipo: "Veiculo",
      entidadeId: veiculo,
      entidadeRef: placa,
      evidencia: {
        placa,
        coberturaDaOperacao: fmtPercent(cobertura * 100, 0),
        casos: lista.map((a) => ({
          data: fmtData(a.dataHora),
          motorista: frota.motorista(a),
          litros: Math.round(a.volumeLitros * 10) / 10,
          valor: a.valorCents,
          posto: a.posto ?? "—",
        })),
      },
      chave: chaveAchado("FR-COMBUSTIVEL-SEM-OPERACAO", veiculo, mes),
    });
  }
  return achados;
}

function chaveDia(d: Date): string {
  const x = inicioDoDia(d);
  return `${x.getFullYear()}-${x.getMonth() + 1}-${x.getDate()}`;
}

// ---------------------------------------------------------------------------
// FR-COMBUSTIVEL-FORA-DA-FROTA — placa que não é da empresa, veículo inativo
// ---------------------------------------------------------------------------
// ESTADO por placa: enquanto a placa continuar abastecendo sem estar na frota,
// o achado fica; quando o cadastro for corrigido (ou a placa parar), some.
function placaForaDaFrota(
  ctx: ContextoAuditoria,
  frota: Frota,
  todos: AbastecimentoGestao[],
  recentes: AbastecimentoGestao[],
  materialidade: number
): AchadoNovo[] {
  if (ctx.veiculos.length === 0 || recentes.length === 0) return [];
  const vinculados = todos.filter((a) => a.vehicleId).length / todos.length;
  const achados: AchadoNovo[] = [];

  if (vinculados >= COBERTURA_MINIMA_DE_VINCULO) {
    for (const [placa, lista] of agrupar(recentes.filter((a) => !a.vehicleId), (a) => normalizarPlaca(a.placaOriginal) || "(sem placa)")) {
      const valor = somar(lista, (a) => a.valorCents);
      achados.push({
        regra: "FR-COMBUSTIVEL-FORA-DA-FROTA",
        tipo: "ESTADO",
        severidade: severidadeDeFrota(valor, lista.length, materialidade),
        categoria: "FRAUDE",
        titulo: `Placa ${placa} abastece pelo cartão da empresa e não está na frota`,
        descricao:
          `${fmtPercent(vinculados * 100, 0)} dos abastecimentos do extrato casam com um veículo cadastrado; ` +
          `esta placa não casa com nenhum e abasteceu ${lista.length} vez(es) no período auditado, ` +
          `${fmtBRL(valor)} (o último em ${fmtData(lista[lista.length - 1].dataHora)}). Ou é veículo da empresa ` +
          `fora do cadastro, ou é veículo de alguém.`,
        recomendacao:
          "Confirmar de quem é a placa. Se é da empresa, cadastrar o veículo na gestão (o achado fecha sozinho). " +
          "Se não é, bloquear o cartão e levantar todo o histórico dessa placa no extrato.",
        valorCents: valor,
        impactoCents: valor,
        entidadeTipo: "Veiculo",
        entidadeId: `placa:${placa}`,
        entidadeRef: placa,
        evidencia: {
          placa,
          quantidade: lista.length,
          valor,
          motoristas: [...new Set(lista.map((a) => frota.motorista(a)))].slice(0, 10),
          ultimo: fmtData(lista[lista.length - 1].dataHora),
        },
        chave: chaveAchado("FR-COMBUSTIVEL-FORA-DA-FROTA", placa),
      });
    }
  }

  // Veículo cadastrado como INATIVO que continua abastecendo. O status é o de
  // hoje (a gestão não guarda histórico de status), então só os últimos 30
  // dias entram: um abastecimento de três meses atrás pode ser de quando o
  // veículo ainda rodava.
  const corte = somarDias(inicioDoDia(ctx.dataReferencia), -30);
  const inativos = new Map(ctx.veiculos.filter((v) => v.status === "INATIVO").map((v) => [v.id, v]));
  for (const [vehicleId, lista] of agrupar(recentes.filter((a) => a.vehicleId && inativos.has(a.vehicleId) && a.dataHora >= corte), (a) => a.vehicleId as string)) {
    const valor = somar(lista, (a) => a.valorCents);
    const placa = inativos.get(vehicleId)!.plate;
    achados.push({
      regra: "FR-COMBUSTIVEL-FORA-DA-FROTA",
      tipo: "ESTADO",
      severidade: severidadeDeFrota(valor, lista.length, materialidade),
      categoria: "FRAUDE",
      titulo: `${placa} está inativo no cadastro e abasteceu ${lista.length} vez(es) nos últimos 30 dias`,
      descricao:
        `O veículo consta como INATIVO na gestão, mas o cartão de frota registra ${fmtBRL(valor)} em combustível ` +
        `para ele no último mês. Veículo parado não abastece.`,
      recomendacao:
        "Se o veículo voltou a rodar, atualizar o status na gestão. Se continua parado, bloquear o cartão vinculado " +
        "a ele e conferir para onde foi o combustível.",
      valorCents: valor,
      impactoCents: valor,
      entidadeTipo: "Veiculo",
      entidadeId: vehicleId,
      entidadeRef: placa,
      evidencia: {
        placa,
        quantidade: lista.length,
        valor,
        motoristas: [...new Set(lista.map((a) => frota.motorista(a)))].slice(0, 10),
        ultimo: fmtData(lista[lista.length - 1].dataHora),
      },
      chave: chaveAchado("FR-COMBUSTIVEL-FORA-DA-FROTA", vehicleId, "inativo"),
    });
  }
  return achados;
}

// ---------------------------------------------------------------------------
// FR-COMBUSTIVEL-PRODUTO — o veículo não usa esse combustível
// ---------------------------------------------------------------------------
export type FamiliaDeCombustivel = "DIESEL" | "OTTO" | "ARLA" | null;

// Diesel e Arla convivem no mesmo veículo; gasolina, etanol e GNV são de
// motor Otto. Um veículo a diesel abastecendo gasolina não é erro de
// digitação do frentista — é outro veículo.
export function familiaDoCombustivel(texto: string | null): FamiliaDeCombustivel {
  if (!texto) return null;
  const t = texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (t.includes("arla")) return "ARLA";
  if (t.includes("diesel") || t.includes("s10") || t.includes("s500")) return "DIESEL";
  if (t.includes("gasolina") || t.includes("etanol") || t.includes("alcool") || t.includes("gnv") || t.includes("gas natural")) return "OTTO";
  return null;
}

function produtoIncompativel(frota: Frota, recentes: AbastecimentoGestao[], materialidade: number): AchadoNovo[] {
  const achados: AchadoNovo[] = [];
  const recentesIds = new Set(recentes.map((a) => a.id));

  for (const [chave, historico] of frota.porVeiculo) {
    const classificados = historico
      .map((a) => ({ a, familia: familiaDoCombustivel(a.combustivel) }))
      .filter((x): x is { a: AbastecimentoGestao; familia: "DIESEL" | "OTTO" } => x.familia === "DIESEL" || x.familia === "OTTO");
    if (classificados.length < MINIMO_PARA_PRODUTO_DOMINANTE) continue;
    const diesel = classificados.filter((x) => x.familia === "DIESEL").length;
    const dominante: "DIESEL" | "OTTO" | null =
      diesel / classificados.length >= DOMINANCIA_DE_PRODUTO
        ? "DIESEL"
        : (classificados.length - diesel) / classificados.length >= DOMINANCIA_DE_PRODUTO
          ? "OTTO"
          : null;
    if (!dominante) continue;

    const fora = classificados.filter((x) => x.familia !== dominante && recentesIds.has(x.a.id));
    if (fora.length === 0) continue;

    for (const [mes, doMes] of agrupar(fora, (x) => chaveMes(x.a.dataHora))) {
      const valor = somar(doMes, (x) => x.a.valorCents);
      const placa = frota.placa(historico[0]);
      achados.push({
        regra: "FR-COMBUSTIVEL-PRODUTO",
        tipo: "EVENTO",
        severidade: severidadeDeFrota(valor, doMes.length, materialidade),
        categoria: "FRAUDE",
        titulo: `${placa} abastece ${dominante === "DIESEL" ? "diesel" : "gasolina/etanol"} e registrou ${doMes.length} abastecimento(s) de ${dominante === "DIESEL" ? "gasolina/etanol" : "diesel"} em ${mes}`,
        descricao:
          `Em ${classificados.length} abastecimentos deste veículo, ${fmtPercent((dominante === "DIESEL" ? diesel : classificados.length - diesel) / classificados.length * 100, 0)} ` +
          `são ${dominante === "DIESEL" ? "diesel" : "gasolina/etanol"}. ${doMes.length} registro(s) do mês, ${fmtBRL(valor)}, ` +
          `são do outro tipo de combustível — que este motor não usa.`,
        recomendacao:
          "Pedir o cupom ao posto e conferir a placa. Combustível que o motor não aceita foi para outro veículo; " +
          "se o posto errou o produto no registro, exigir a correção para o controle de consumo não ficar contaminado.",
        valorCents: valor,
        impactoCents: valor,
        entidadeTipo: "Veiculo",
        entidadeId: chave,
        entidadeRef: placa,
        evidencia: {
          placa,
          produtoDoVeiculo: dominante === "DIESEL" ? "diesel" : "gasolina/etanol",
          casos: doMes.map((x) => ({
            data: fmtData(x.a.dataHora),
            motorista: frota.motorista(x.a),
            produto: x.a.combustivel,
            litros: Math.round(x.a.volumeLitros * 10) / 10,
            valor: x.a.valorCents,
            posto: x.a.posto ?? "—",
          })),
        },
        chave: chaveAchado("FR-COMBUSTIVEL-PRODUTO", chave, mes),
      });
    }
  }
  return achados;
}

// ---------------------------------------------------------------------------
// FR-COMBUSTIVEL-PRECO — o posto que cobra acima da frota (e da ANP)
// ---------------------------------------------------------------------------
// Sobrepreço recorrente num posto é o desenho clássico do acerto entre posto
// e quem abastece: o litro sai mais caro e a diferença volta por fora. A
// referência primeira é a própria frota (mesmo produto, mesmo mês, outros
// postos); a ANP entra como segunda referência, quando existe para a UF e a
// semana — um posto acima da frota mas dentro da ANP é caro, não suspeito.
function produtoParaPreco(texto: string | null): string | null {
  if (!texto) return null;
  const t = texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (t.includes("arla")) return "ARLA";
  if (t.includes("diesel") && t.includes("s10")) return "OLEO DIESEL S10";
  if (t.includes("diesel")) return "OLEO DIESEL";
  if (t.includes("gasolina") && t.includes("aditiv")) return "GASOLINA ADITIVADA";
  if (t.includes("gasolina")) return "GASOLINA COMUM";
  if (t.includes("etanol") || t.includes("alcool")) return "ETANOL HIDRATADO";
  if (t.includes("gnv") || t.includes("gas natural")) return "GNV";
  return null;
}

function referenciaAnp(precos: PrecoAnpGestao[], a: AbastecimentoGestao, produto: string): number | null {
  if (!a.uf) return null;
  const ref = precos.find(
    (p) => p.uf === a.uf && p.produto === produto && a.dataHora >= p.semanaInicio && a.dataHora <= p.semanaFim
  );
  return ref?.precoMedioCents ?? null;
}

function postoAcimaDaFrota(ctx: ContextoAuditoria, recentes: AbastecimentoGestao[], materialidade: number): AchadoNovo[] {
  const achados: AchadoNovo[] = [];
  const precosAnp = ctx.precosAnp ?? [];
  const comPreco = recentes
    .map((a) => ({ a, produto: produtoParaPreco(a.combustivel), preco: precoPorLitro(a), posto: (a.posto ?? "").trim() }))
    .filter((x): x is { a: AbastecimentoGestao; produto: string; preco: number; posto: string } => !!x.produto && x.preco !== null && x.preco > 0 && x.posto.length > 0);

  for (const [chaveMesProduto, doMes] of agrupar(comPreco, (x) => `${chaveMes(x.a.dataHora)}|${x.produto}`)) {
    const [mes, produto] = chaveMesProduto.split("|");
    const postos = agrupar(doMes, (x) => x.posto.toUpperCase());
    if (doMes.length < MINIMO_DA_FROTA_NO_MES || postos.size < MINIMO_DE_POSTOS_NO_MES) continue;

    for (const [posto, doPosto] of postos) {
      if (doPosto.length < MINIMO_NO_POSTO) continue;
      // A referência é a frota SEM este posto — senão um posto dominante
      // puxaria a própria mediana para cima e nunca apareceria.
      const outros = doMes.filter((x) => x.posto.toUpperCase() !== posto);
      if (outros.length < MINIMO_NO_POSTO) continue;
      const referencia = mediana(outros.map((x) => Math.round(x.preco)));
      const precoDoPosto = mediana(doPosto.map((x) => Math.round(x.preco)));
      if (referencia <= 0 || precoDoPosto < referencia * (1 + SOBREPRECO_MINIMO)) continue;

      const anp = doPosto.map((x) => referenciaAnp(precosAnp, x.a, produto)).filter((p): p is number => p !== null);
      const anpTipico = anp.length > 0 ? mediana(anp) : null;
      if (anpTipico !== null && precoDoPosto <= anpTipico * (1 + TOLERANCIA_SOBRE_ANP)) continue;

      const litros = somar(doPosto, (x) => x.a.volumeLitros);
      const sobrepreco = Math.round(somar(doPosto, (x) => Math.max(0, x.preco - referencia) * x.a.volumeLitros));
      if (sobrepreco <= 0) continue;
      const percentual = ((precoDoPosto - referencia) / referencia) * 100;
      const rotuloPosto = doPosto[0].posto;
      achados.push({
        regra: "FR-COMBUSTIVEL-PRECO",
        tipo: "EVENTO",
        severidade: severidadeDeFrota(sobrepreco, doPosto.length, materialidade),
        categoria: "PERDA_FINANCEIRA",
        titulo: `${rotuloPosto}: ${produto.toLowerCase()} ${fmtPercent(percentual)} acima do que a frota paga em ${mes}`,
        descricao:
          `Neste posto o litro de ${produto.toLowerCase()} saiu a ${fmtPrecoLitro(precoDoPosto)} em ${doPosto.length} ` +
          `abastecimentos; nos outros ${postos.size - 1} postos do mês a frota pagou ${fmtPrecoLitro(referencia)}` +
          `${anpTipico !== null ? `, e a média ANP da praça era ${fmtPrecoLitro(anpTipico)}` : ""}. ` +
          `A diferença custou ${fmtBRL(sobrepreco)} em ${fmtLitros(litros)}.`,
        recomendacao:
          "Perguntar por que os motoristas abastecem neste posto (rota, conveniência, indicação). Sobrepreço " +
          "recorrente no mesmo posto com os mesmos motoristas é o padrão a verificar de perto; se for só preço " +
          "de praça, orientar a frota para os postos de referência.",
        valorCents: sobrepreco,
        impactoCents: sobrepreco,
        entidadeTipo: "Posto",
        entidadeId: posto,
        entidadeRef: rotuloPosto,
        evidencia: {
          posto: rotuloPosto,
          produto,
          precoNoPosto: Math.round(precoDoPosto),
          precoNaFrota: Math.round(referencia),
          precoAnp: anpTipico !== null ? Math.round(anpTipico) : "sem referência",
          abastecimentos: doPosto.length,
          litros: Math.round(litros),
          motoristas: [...new Set(doPosto.map((x) => x.a.driverId ?? x.a.motoristaOriginal ?? "?"))].length,
          sobrepreco,
        },
        chave: chaveAchado("FR-COMBUSTIVEL-PRECO", posto, produto, mes),
      });
    }
  }
  return achados;
}

// ---------------------------------------------------------------------------
// FR-COMBUSTIVEL-MOTORISTA — um motorista, vários veículos no mesmo dia
// ---------------------------------------------------------------------------
// Informativo: quem abastece três veículos num dia ou é o responsável pelo
// pátio (padrão que se repete todo dia) ou está com cartão que não é dele.
function motoristaComVariosVeiculos(frota: Frota, recentes: AbastecimentoGestao[]): AchadoNovo[] {
  const achados: AchadoNovo[] = [];
  const comMotorista = recentes.filter((a) => a.driverId);
  for (const [driverId, lista] of agrupar(comMotorista, (a) => a.driverId as string)) {
    const porDia = agrupar(lista, (a) => chaveDia(a.dataHora));
    const diasComVarios = [...porDia.entries()]
      .map(([dia, doDia]) => ({ dia, veiculos: new Set(doDia.map(frota.chaveVeiculo)).size, valor: somar(doDia, (a) => a.valorCents), data: doDia[0].dataHora }))
      .filter((d) => d.veiculos >= VEICULOS_POR_DIA_PARA_APONTAR);
    if (diasComVarios.length === 0) continue;

    const nome = frota.motorista(lista[0]);
    const rotina = diasComVarios.length / porDia.size >= 0.5;
    for (const [mes, doMes] of agrupar(diasComVarios, (d) => chaveMes(d.data))) {
      achados.push({
        regra: "FR-COMBUSTIVEL-MOTORISTA",
        tipo: "EVENTO",
        severidade: rotina ? "INFO" : "BAIXA",
        categoria: "ERRO_PROCESSO",
        titulo: `${nome} abasteceu ${VEICULOS_POR_DIA_PARA_APONTAR}+ veículos no mesmo dia em ${doMes.length} dia(s) de ${mes}`,
        descricao: rotina
          ? `Acontece em ${diasComVarios.length} de ${porDia.size} dias em que a pessoa abastece: é rotina, provavelmente ` +
            `quem cuida do pátio. Registrado para a política de cartão refletir isso (cartão por veículo, não por pessoa).`
          : `Em ${doMes.length} dia(s) do mês a mesma pessoa abasteceu ${Math.max(...doMes.map((d) => d.veiculos))} veículos ` +
            `diferentes, ${fmtBRL(somar(doMes, (d) => d.valor))} no total — fora da rotina dela. Cartão compartilhado é o ` +
            `que se verifica primeiro.`,
        recomendacao:
          "Confirmar com a operação se a pessoa tem a função de abastecer a frota. Se não tem, apurar de quem eram " +
          "os cartões usados e desde quando.",
        valorCents: somar(doMes, (d) => d.valor),
        entidadeTipo: "Motorista",
        entidadeId: driverId,
        entidadeRef: nome,
        evidencia: {
          motorista: nome,
          diasNoMes: doMes.map((d) => ({ dia: fmtData(d.data), veiculos: d.veiculos, valor: d.valor })),
          diasEmQueAbastece: porDia.size,
        },
        chave: chaveAchado("FR-COMBUSTIVEL-MOTORISTA", driverId, mes),
      });
    }
  }
  return achados;
}

