// MÃO DE OBRA — as duas contas que definem o custo do motorista além do
// salário: o percentual de encargos e quantos motoristas cada veículo pede.
//
// São calculadoras, não parte do motor: o motor recebe um `encargosPct` e um
// `motoristasPorVeiculo` e não sabe de onde vieram. Aqui eles deixam de ser
// um número digitado e passam a ser uma conta que se mostra, grupo por grupo
// (encargos) e hora por hora (fator de utilização). Referências em
// docs/simulador_custos/PESQUISA.md, seções 3.4, 3.5 e 9.5.
//
// A REGRA QUE NÃO SE QUEBRA: férias e folgas entram OU no fator de utilização
// (há mais motoristas para cobrir quem está de férias) OU nos encargos (o
// salário de férias é provisionado), nunca nos dois. As duas calculadoras
// sabem disso: o modo `FU_com_reserva` tira as férias do Grupo B e o fator de
// utilização só soma os acréscimos quando pedido.

export type ModoEncargos = "FU_COM_RESERVA" | "POSTO";

export type ParametrosEncargos = {
  // Grupo A — contribuições sobre a folha.
  inssPct: number; // 20% no regime normal; 0 no Simples; parcela da reoneração na CPRB
  ratPct: number; // RAT/SAT (1, 2 ou 3%)
  fap: number; // Fator Acidentário de Prevenção (0,5 a 2,0)
  terceirosPct: number; // SEST 1,5 + SENAT 1,0 + SEBRAE 0,6 + INCRA 0,2 + salário-educação 2,5 = 5,8%
  fgtsPct: number; // 8%
  // Grupo B — o que se paga sem trabalho correspondente.
  decimoTerceiroPct: number; // 1/12 = 8,33%
  tercoFeriasPct: number; // 1/3 de 1/12 = 2,78%
  feriasPct: number; // 1/12 = 8,33% (só no modo POSTO)
  licencasFaltasPct: number; // licenças, faltas legais, auxílio-doença (15 dias)
  // Grupo C — rescisão.
  rotatividadeMensal: number; // fração dos empregados desligados por mês
  fracaoAvisoIndenizado: number; // dos desligados, quantos com aviso indenizado
  diasAvisoPrevio: number; // 30 a 90, pelo tempo médio de casa
  // Multa do FGTS provisionada sobre o depósito mensal. 40% da multa ao
  // empregado; a contribuição adicional de 10% da LC 110 foi extinta a partir
  // de 2020 (Lei 13.932/2019). Convenção das planilhas de referência: provisiona
  // como se todos saíssem sem justa causa — conservador.
  multaFgtsPct: number;
  modo: ModoEncargos;
};

export type GrupoEncargos = { grupo: "A" | "B" | "C" | "D"; rotulo: string; itens: { rotulo: string; pct: number }[]; total: number };
export type CalculoEncargos = { grupos: GrupoEncargos[]; total: number; resumo: string };

export const PRESETS_ENCARGOS: Record<string, { rotulo: string; ajuda: string; valores: Partial<ParametrosEncargos> }> = {
  NORMAL: {
    rotulo: "Presumido ou Real",
    ajuda: "INSS patronal de 20% sobre a folha, RAT, terceiros do transporte (SEST/SENAT) e FGTS.",
    valores: { inssPct: 0.2, ratPct: 0.03, fap: 1, terceirosPct: 0.058 },
  },
  CPRB: {
    rotulo: "CPRB (só CNAE 4921/4922)",
    ajuda: "Desoneração da folha na transição: INSS patronal reduzido, com contribuição sobre a receita à parte. Vale só para transporte coletivo regular (4921/4922), não para fretamento (4929). Confira a alíquota do ano com a contabilidade.",
    valores: { inssPct: 0.1, ratPct: 0.03, fap: 1, terceirosPct: 0.058 },
  },
  SIMPLES: {
    rotulo: "Simples Nacional",
    ajuda: "No Simples, INSS patronal e terceiros são recolhidos na guia única; na folha fica o FGTS.",
    valores: { inssPct: 0, ratPct: 0, fap: 1, terceirosPct: 0 },
  },
};

export const ENCARGOS_PADRAO: ParametrosEncargos = {
  inssPct: 0.2,
  ratPct: 0.03,
  fap: 1,
  terceirosPct: 0.058,
  fgtsPct: 0.08,
  decimoTerceiroPct: 1 / 12,
  tercoFeriasPct: 1 / 36,
  feriasPct: 1 / 12,
  licencasFaltasPct: 0.0186,
  rotatividadeMensal: 0.04,
  fracaoAvisoIndenizado: 0.9,
  diasAvisoPrevio: 33,
  multaFgtsPct: 0.4,
  modo: "FU_COM_RESERVA",
};

export function calcularEncargos(p: ParametrosEncargos): CalculoEncargos {
  const a = [
    { rotulo: "INSS patronal", pct: p.inssPct },
    { rotulo: "RAT × FAP", pct: p.ratPct * p.fap },
    { rotulo: "Terceiros (SEST, SENAT, SEBRAE, INCRA, salário-educação)", pct: p.terceirosPct },
    { rotulo: "FGTS", pct: p.fgtsPct },
  ];
  const totalA = a.reduce((s, i) => s + i.pct, 0);
  const b = [
    { rotulo: "13º salário", pct: p.decimoTerceiroPct },
    { rotulo: "1/3 constitucional de férias", pct: p.tercoFeriasPct },
    ...(p.modo === "POSTO" ? [{ rotulo: "Férias (substituto pago pelo posto)", pct: p.feriasPct }] : []),
    { rotulo: "Licenças, faltas legais e auxílio-doença", pct: p.licencasFaltasPct },
  ];
  const totalB = b.reduce((s, i) => s + i.pct, 0);
  // Grupo C (GEIPOT, Anexo III): aviso indenizado = dias/30 × rotatividade ×
  // fração indenizada; depósito rescisório = FGTS × (1 + B) × multa;
  // indenização adicional (art. 9º da Lei 7.238) ≈ rotatividade/12.
  const avisoIndenizado = (p.diasAvisoPrevio / 30) * p.rotatividadeMensal * p.fracaoAvisoIndenizado;
  const depositoRescisorio = p.fgtsPct * (1 + totalB) * p.multaFgtsPct;
  const c = [
    { rotulo: "Aviso prévio indenizado", pct: avisoIndenizado },
    { rotulo: "Multa do FGTS na rescisão", pct: depositoRescisorio },
    { rotulo: "Indenização adicional", pct: p.rotatividadeMensal / 12 },
  ];
  const totalC = c.reduce((s, i) => s + i.pct, 0);
  // Grupo D: o Grupo A incide sobre o Grupo B (13º e férias também recolhem
  // INSS e FGTS).
  const d = [{ rotulo: "Incidência do Grupo A sobre o Grupo B", pct: totalA * totalB }];
  const totalD = d[0].pct;
  const grupos: GrupoEncargos[] = [
    { grupo: "A", rotulo: "Contribuições sobre a folha", itens: a, total: totalA },
    { grupo: "B", rotulo: p.modo === "POSTO" ? "Tempo não trabalhado (com férias)" : "Tempo não trabalhado (férias no fator de utilização)", itens: b, total: totalB },
    { grupo: "C", rotulo: "Rescisão", itens: c, total: totalC },
    { grupo: "D", rotulo: "Reincidências", itens: d, total: totalD },
  ];
  const total = totalA + totalB + totalC + totalD;
  const pctTxt = (v: number) => `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
  return { grupos, total, resumo: `A ${pctTxt(totalA)} + B ${pctTxt(totalB)} + C ${pctTxt(totalC)} + D ${pctTxt(totalD)} = ${pctTxt(total)}` };
}

// ---------------------------------------------------------------------------
// FATOR DE UTILIZAÇÃO — motoristas por veículo pela jornada
// ---------------------------------------------------------------------------

export type Jornada = "44H_5X2" | "44H_6X1" | "12X36";

export const JORNADAS: Record<Jornada, { rotulo: string; horasMes: number; ajuda: string }> = {
  "44H_5X2": { rotulo: "44 h semanais (5x2)", horasMes: 220, ajuda: "Jornada padrão: 220 h por mês." },
  "44H_6X1": { rotulo: "44 h semanais (6x1)", horasMes: 220, ajuda: "Mesma carga mensal, distribuída em seis dias." },
  "12X36": { rotulo: "12x36", horasMes: 182.5, ajuda: "Permitida ao motorista por convenção coletiva: ~15,2 plantões de 12 h por mês." },
};

export type ParametrosFU = {
  // Horas em que o veículo precisa de motorista por dia, contando garagem ↔
  // primeiro ponto e o tempo de espera (que é jornada desde a ADI 5322).
  horasPorDia: number;
  diasPorMes: number;
  jornada: Jornada;
  // Acréscimos para quem cobre folgas, férias e faltas. Só some quando os
  // encargos NÃO provisionam as férias (modo FU_COM_RESERVA).
  somarAcrescimos: boolean;
  folgasPct: number; // folgas e feriados trabalhados por substituto
  feriasPct: number; // 1/11 = 9,09%: o substituto também tira férias
  reservaPct: number; // doença (15 dias pagos) e faltas
};

export const FU_PADRAO: ParametrosFU = {
  horasPorDia: 10,
  diasPorMes: 22,
  jornada: "44H_5X2",
  somarAcrescimos: true,
  folgasPct: 0.0449,
  feriasPct: 1 / 11,
  reservaPct: 0.0186,
};

export type CalculoFU = {
  horasPostoMes: number;
  horasContrato: number;
  // Motoristas sem hora extra (fracionário: um motorista pode dividir-se
  // entre veículos).
  fuSemHoraExtra: number;
  // Alternativa: motoristas inteiros e o restante em hora extra (por motorista).
  motoristasInteiros: number;
  horasExtrasPorMotorista: number;
  acrescimoPct: number;
  fuFinal: number;
};

export function fatorDeUtilizacao(p: ParametrosFU): CalculoFU {
  const horasPostoMes = Math.max(0, p.horasPorDia) * Math.max(0, p.diasPorMes);
  const horasContrato = JORNADAS[p.jornada].horasMes;
  const fuSemHoraExtra = horasContrato > 0 ? horasPostoMes / horasContrato : 0;
  const motoristasInteiros = Math.max(1, Math.floor(fuSemHoraExtra + 1e-9));
  const horasExtrasPorMotorista = Math.max(0, horasPostoMes - motoristasInteiros * horasContrato) / motoristasInteiros;
  const acrescimoPct = p.somarAcrescimos ? p.folgasPct + p.feriasPct + p.reservaPct : 0;
  return { horasPostoMes, horasContrato, fuSemHoraExtra, motoristasInteiros, horasExtrasPorMotorista, acrescimoPct, fuFinal: fuSemHoraExtra * (1 + acrescimoPct) };
}
