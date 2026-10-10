import type { MapaOrigem } from "./premissas";
import type { Premissas } from "./tipos";

// AS PREMISSAS QUE O EDITAL FIXA — e como elas entram no estudo.
//
// Alguns editais dizem o número que a proposta tem de usar: a reserva técnica
// (TCB: 3 ônibus para 52), o km improdutivo que já vem pago no km (5%), os
// encargos sociais fixados pelo órgão (70,64%), o piso da convenção coletiva,
// o vale-refeição, a idade máxima do veículo, o consumo de referência. A
// leitura do edital os transcreve; aqui eles viram premissas do estudo novo,
// com a origem "do edital" à vista (e o "Voltar à base" do estudo volta a
// eles). Sem banco: vai para a tela e para os testes.

export type PremissasDoEdital = {
  // Fração da frota operacional (0,0577 = 3 de 52).
  reservaTecnicaPct: number | null;
  // % de km improdutivo que o edital já soma ao km pago (0,05).
  kmImprodutivoPagoPct: number | null;
  // Encargos sociais fixados pelo órgão (0,7064).
  encargosSociaisPct: number | null;
  // Pisos da convenção coletiva aplicável (R$/mês).
  salarioMotorista: number | null;
  salarioMonitor: number | null;
  // Vale-refeição por dia trabalhado (R$).
  valeRefeicaoDia: number | null;
  // O edital exige veículo zero km na proposta / idade máxima na entrada.
  exigeVeiculoNovo: boolean;
  idadeMaximaVeiculoAnos: number | null;
  // Consumo de referência de diesel (km por litro).
  consumoKmPorLitro: number | null;
};

export const PREMISSAS_DO_EDITAL_VAZIAS: PremissasDoEdital = {
  reservaTecnicaPct: null,
  kmImprodutivoPagoPct: null,
  encargosSociaisPct: null,
  salarioMotorista: null,
  salarioMonitor: null,
  valeRefeicaoDia: null,
  exigeVeiculoNovo: false,
  idadeMaximaVeiculoAnos: null,
  consumoKmPorLitro: null,
};

// Faixas aceitas: o que vem fora delas é erro de leitura, e fica de fora.
const faixa = (v: unknown, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null);

// Do JSON (formulário, banco) para o tipo, conferindo cada número.
export function lerPremissasDoEdital(bruto: unknown): PremissasDoEdital | null {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return null;
  const o = bruto as Record<string, unknown>;
  const p: PremissasDoEdital = {
    reservaTecnicaPct: faixa(o.reservaTecnicaPct, 0, 0.5),
    kmImprodutivoPagoPct: faixa(o.kmImprodutivoPagoPct, 0, 0.5),
    encargosSociaisPct: faixa(o.encargosSociaisPct, 0.2, 1.5),
    salarioMotorista: faixa(o.salarioMotorista, 500, 50_000),
    salarioMonitor: faixa(o.salarioMonitor, 500, 50_000),
    valeRefeicaoDia: faixa(o.valeRefeicaoDia, 1, 500),
    exigeVeiculoNovo: o.exigeVeiculoNovo === true,
    idadeMaximaVeiculoAnos: faixa(o.idadeMaximaVeiculoAnos, 0, 30),
    consumoKmPorLitro: faixa(o.consumoKmPorLitro, 0.5, 20),
  };
  const algo = Object.entries(p).some(([k, v]) => (k === "exigeVeiculoNovo" ? v === true : v !== null));
  return algo ? p : null;
}

const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Para a conferência no Novo estudo: o que o edital fixa, em texto.
export function descreverPremissasDoEdital(p: PremissasDoEdital | null): string[] {
  if (!p) return [];
  return [
    p.reservaTecnicaPct !== null && `Reserva técnica de ${pct(p.reservaTecnicaPct)} da frota.`,
    p.kmImprodutivoPagoPct && `Km improdutivo de ${pct(p.kmImprodutivoPagoPct)} já pago no km (a premissa fica só com o que passar disso).`,
    p.encargosSociaisPct !== null && `Encargos sociais fixados em ${pct(p.encargosSociaisPct)}.`,
    p.salarioMotorista !== null && `Piso do motorista: ${reais(p.salarioMotorista)} (mínimo).`,
    p.salarioMonitor !== null && `Piso do monitor: ${reais(p.salarioMonitor)} (mínimo).`,
    p.valeRefeicaoDia !== null && `Vale-refeição de ${reais(p.valeRefeicaoDia)} por dia (mínimo).`,
    p.exigeVeiculoNovo ? "Veículo zero km na proposta." : p.idadeMaximaVeiculoAnos !== null && `Veículo com no máximo ${p.idadeMaximaVeiculoAnos} anos na entrada.`,
    p.consumoKmPorLitro !== null && `Consumo de referência de ${p.consumoKmPorLitro.toLocaleString("pt-BR")} km/L.`,
  ].filter((x): x is string => typeof x === "string");
}

// O QUE CADA UMA FAZ NO ESTUDO. Os pisos e o vale-refeição são MÍNIMOS: só
// sobem o que a base tem abaixo deles (a empresa pode pagar mais). Os
// encargos e a reserva são o número da proposta e substituem o da base. O km
// improdutivo da premissa é o que roda SEM receber: o que passar do que o
// edital já paga — (1 + base) ÷ (1 + pago) − 1. Devolve o que mudou, em texto.
export function aplicarPremissasDoEdital(premissas: Premissas, origem: MapaOrigem, ped: PremissasDoEdital | null): string[] {
  if (!ped) return [];
  const feito: string[] = [];
  const marca = (caminho: string, detalhe: string) => (origem[caminho] = { origem: "EDITAL", fonte: "edital importado", detalhe });
  const perfis = premissas.perfis ?? [];

  if (ped.reservaTecnicaPct !== null) {
    const antes = premissas.contrato.reservaTecnicaPct;
    premissas.contrato.reservaTecnicaPct = ped.reservaTecnicaPct;
    marca("contrato.reservaTecnicaPct", `reserva do edital (a base tinha ${pct(antes)})`);
    feito.push(`Reserva técnica: ${pct(ped.reservaTecnicaPct)} da frota.`);
  }
  if (ped.kmImprodutivoPagoPct) {
    const antes = premissas.contrato.kmMortoPct;
    const fora = Math.max(0, Math.round(((1 + antes) / (1 + ped.kmImprodutivoPagoPct) - 1) * 10000) / 10000);
    premissas.contrato.kmMortoPct = fora;
    marca("contrato.kmMortoPct", `o edital já paga ${pct(ped.kmImprodutivoPagoPct)} de km improdutivo; fica só o que passa disso (a base tinha ${pct(antes)})`);
    feito.push(`Km improdutivo não pago: ${pct(fora)} (o edital já paga ${pct(ped.kmImprodutivoPagoPct)}).`);
  }
  if (ped.encargosSociaisPct !== null) {
    const antes = premissas.pessoal.encargosPct;
    premissas.pessoal.encargosPct = ped.encargosSociaisPct;
    marca("pessoal.encargosPct", `fixados pelo órgão (a base tinha ${pct(antes)})`);
    feito.push(`Encargos sociais: ${pct(ped.encargosSociaisPct)}, como o edital fixa.`);
  }
  if (ped.salarioMotorista !== null) {
    let subiu = false;
    if (premissas.pessoal.salarioMotorista < ped.salarioMotorista) {
      marca("pessoal.salarioMotorista", `piso da convenção no edital (a base tinha ${reais(premissas.pessoal.salarioMotorista)})`);
      premissas.pessoal.salarioMotorista = ped.salarioMotorista;
      subiu = true;
    }
    for (const p of perfis)
      if (p.motorista.salario < ped.salarioMotorista) {
        origem[`perfil:${p.codigo}:motorista.salario`] = { origem: "EDITAL", fonte: "edital importado", detalhe: `piso da convenção (a base tinha ${reais(p.motorista.salario)})` };
        p.motorista.salario = ped.salarioMotorista;
        subiu = true;
      }
    feito.push(subiu ? `Salário do motorista elevado ao piso do edital, ${reais(ped.salarioMotorista)}.` : `Salário do motorista da base já está acima do piso do edital (${reais(ped.salarioMotorista)}).`);
  }
  if (ped.salarioMonitor !== null) {
    if (premissas.pessoal.salarioMonitora < ped.salarioMonitor) {
      marca("pessoal.salarioMonitora", `piso da convenção no edital (a base tinha ${reais(premissas.pessoal.salarioMonitora)})`);
      premissas.pessoal.salarioMonitora = ped.salarioMonitor;
      feito.push(`Salário do monitor elevado ao piso do edital, ${reais(ped.salarioMonitor)}.`);
    } else feito.push(`Salário do monitor da base já está acima do piso do edital (${reais(ped.salarioMonitor)}).`);
  }
  if (ped.valeRefeicaoDia !== null) {
    const antes = premissas.pessoal.valeRefeicaoDia ?? 0;
    if (antes < ped.valeRefeicaoDia) {
      premissas.pessoal.valeRefeicaoDia = ped.valeRefeicaoDia;
      marca("pessoal.valeRefeicaoDia", `valor da convenção no edital (a base tinha ${reais(antes)})`);
      feito.push(`Vale-refeição: ${reais(ped.valeRefeicaoDia)} por dia trabalhado.`);
    }
  }
  // Idade do veículo: zero km quando o edital exige; senão, no máximo a de entrada.
  const idadeAlvo = ped.exigeVeiculoNovo ? 0 : ped.idadeMaximaVeiculoAnos;
  if (idadeAlvo !== null) {
    const veiculos: [string, { idadeInicialAnos: number }][] = [["veiculo.idadeInicialAnos", premissas.veiculo], ...perfis.map((p) => [`perfil:${p.codigo}:veiculo.idadeInicialAnos`, p.veiculo] as [string, { idadeInicialAnos: number }])];
    let mudou = false;
    for (const [caminho, v] of veiculos)
      if (v.idadeInicialAnos > idadeAlvo) {
        origem[caminho] = { origem: "EDITAL", fonte: "edital importado", detalhe: ped.exigeVeiculoNovo ? `veículo zero km na proposta (a base tinha ${v.idadeInicialAnos} anos)` : `idade máxima de entrada ${idadeAlvo} anos (a base tinha ${v.idadeInicialAnos})` };
        v.idadeInicialAnos = idadeAlvo;
        mudou = true;
      }
    if (mudou) feito.push(ped.exigeVeiculoNovo ? "Veículos zero km, como o edital exige." : `Veículos com no máximo ${idadeAlvo} anos na entrada.`);
  }
  if (ped.consumoKmPorLitro !== null) {
    for (const p of perfis.filter((x) => x.energia !== "ELETRICO")) {
      origem[`perfil:${p.codigo}:variaveis.consumoAsfaltoKmL`] = { origem: "EDITAL", fonte: "edital importado", detalhe: `consumo de referência do edital (a base tinha ${p.variaveis.consumoAsfaltoKmL} km/L)` };
      p.variaveis.consumoAsfaltoKmL = ped.consumoKmPorLitro;
    }
    if (perfis.length === 0) {
      marca("variaveis.consumoAsfaltoKmL", `consumo de referência do edital (a base tinha ${premissas.variaveis.consumoAsfaltoKmL} km/L)`);
      premissas.variaveis.consumoAsfaltoKmL = ped.consumoKmPorLitro;
    }
    feito.push(`Consumo de referência: ${ped.consumoKmPorLitro.toLocaleString("pt-BR")} km/L.`);
  }
  return feito;
}
