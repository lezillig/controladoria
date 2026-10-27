import { FERIADOS_FIXOS } from "./periodos";

// O FECHAMENTO DA FOLHA — o calendário do fluxograma validado pelo RH e pela
// Contabilidade (Azul Mob, v4, out/2026), virado checklist mensal.
//
// Uma COMPETÊNCIA é a folha de um mês (outubro = "2026-10"). Os itens dela
// começam no mês e terminam no seguinte:
//
//   dia 5 ............. planos de saúde                       (fluxograma)
//   dias 10 a 19 ...... ponto eletrônico                      (fluxograma)
//   dia 20 ............ eventos na planilha da Contabilidade   (fluxograma)
//   dia 22 ............ VT/VA/VR do mês seguinte              (fluxograma)
//   último dia útil ... crédito do VT/VA/VR do mês seguinte   (fluxograma)
//   5º dia útil (M+1) . salário pago                          (CLT art. 459)
//   dia 15 (M+1) ...... eSocial fechado                       (legislação)
//   dia 20 (M+1) ...... DCTFWeb/INSS, FGTS Digital e IRRF     (legislação)
//
// O fluxograma não dá data às etapas 3 (conferência), 4 (processamento) e 6;
// a conferência é cobrada antes do pagamento, e o que não tem prazo nenhum
// fica sem alerta — inventar prazo seria pior que não ter.
//
// Os itens com pagamento conferem-se SOZINHOS pela Omie: o título a pagar da
// categoria (VT/VA/VR, plano de saúde, salários, INSS, FGTS, IRRF) pago até o
// prazo. Sem banco: a colheita está em fechamentoFolhaNoBanco.ts.
//
// Dias úteis: fim de semana e feriado nacional fixo (os móveis ficam de fora,
// como em periodos.ts). Para o salário, sábado CONTA como dia útil — é a
// leitura do Ministério do Trabalho para o 5º dia útil.

export type Competencia = { ano: number; mes: number };
export type Responsavel = "RH" | "RH · Financeiro" | "Financeiro" | "Contabilidade";
export type Prazo = { inicio: Date | null; ate: Date | null; texto: string };
export type ConferenciaOmie = { categoria: RegExp; exceto?: RegExp; janela: (c: Competencia) => { de: Date; ate: Date }; oQue: string };

export type ItemFolha = {
  chave: string;
  etapa: 1 | 2 | 3 | 4 | 5 | 6;
  titulo: (c: Competencia) => string;
  descricao: string;
  responsavel: Responsavel;
  fonte: "fluxograma" | "legislação" | "sistema";
  prazo: (c: Competencia) => Prazo;
  omie?: ConferenciaOmie;
  // Tela do sistema que ajuda a cumprir o item.
  link?: { href: string; rotulo: string };
};

export const ETAPAS: Record<ItemFolha["etapa"], { nome: string; pratica: string }> = {
  1: { nome: "Preparação", pratica: "Reunir tudo o que muda a folha no mês antes de calcular qualquer valor." },
  2: { nome: "Lançamentos", pratica: "Transformar as informações em valores: proventos, descontos, benefícios, rescisões e férias." },
  3: { nome: "Conferência", pratica: "Checar dados, bases e totais antes de fechar a folha." },
  4: { nome: "Fechamento", pratica: "Folha fechada, pagamento enviado ao banco e benefícios creditados." },
  5: { nome: "Encargos e obrigações", pratica: "Recolher tributos e enviar as declarações (Contabilidade)." },
  6: { nome: "Finalização", pratica: "Entregar holerites, arquivar e gerar relatórios." },
};

const NOME_MES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const rotuloCompetencia = (c: Competencia) => `${NOME_MES[c.mes - 1]}/${c.ano}`;
export const chaveCompetencia = (c: Competencia) => `${c.ano}-${String(c.mes).padStart(2, "0")}`;
export function lerCompetencia(texto: string | undefined | null): Competencia | null {
  const m = /^(\d{4})-(\d{2})$/.exec(texto ?? "");
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  return { ano: Number(m[1]), mes: Number(m[2]) };
}
export const somarMeses = (c: Competencia, n: number): Competencia => {
  const t = c.ano * 12 + (c.mes - 1) + n;
  return { ano: Math.floor(t / 12), mes: (t % 12) + 1 };
};

// ---- Dias úteis (UTC, meia-noite) ----
const dia = (c: Competencia, d: number) => new Date(Date.UTC(c.ano, c.mes - 1, d));
const ultimoDia = (c: Competencia) => new Date(Date.UTC(c.ano, c.mes, 0)).getUTCDate();
const feriado = (d: Date) => FERIADOS_FIXOS.includes(`${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`);
export const naoUtil = (d: Date, sabadoConta = false) => d.getUTCDay() === 0 || (!sabadoConta && d.getUTCDay() === 6) || feriado(d);

export function ultimoDiaUtil(c: Competencia): Date {
  let d = dia(c, ultimoDia(c));
  while (naoUtil(d)) d = new Date(d.getTime() - 86_400_000);
  return d;
}
export function enesimoDiaUtil(c: Competencia, n: number, sabadoConta = false): Date {
  let d = dia(c, 1);
  let conta = naoUtil(d, sabadoConta) ? 0 : 1;
  while (conta < n) {
    d = new Date(d.getTime() + 86_400_000);
    if (!naoUtil(d, sabadoConta)) conta++;
  }
  return d;
}
// Vencimento que cai em dia não útil é antecipado (DCTFWeb, FGTS, DARF, eSocial).
export function antecipar(d: Date): Date {
  let x = d;
  while (naoUtil(x)) x = new Date(x.getTime() - 86_400_000);
  return x;
}

const fmt = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const fixo = (d: Date, texto: string): Prazo => ({ inicio: null, ate: d, texto });
const seguinte = (c: Competencia) => somarMeses(c, 1);

const BENEFICIOS = /vale.?(transporte|refei|alimenta)|\bv\.?\s?[tra]\b|benef[ií]cio|ticket|alelo|sodexo|pluxee|vr\s?benef/i;
const PLANO = /plano|sa[uú]de|odonto|m[eé]dic|unimed|amil|bradesco sa|sulam|notredame|hapvida/i;
const SALARIO = /sal[aá]ri|ordenado|folha de pagamento|l[ií]quido da folha/i;
const NAO_SALARIO = /adiantamento|rescis|f[eé]rias|13|d[eé]cimo|pr[oó].?labore|fam[ií]lia/i;

export const ITENS_FOLHA: ItemFolha[] = [
  // 1 · PREPARAÇÃO (RH)
  {
    chave: "PLANO_SAUDE",
    etapa: 1,
    titulo: () => "Fechamento dos planos de saúde e odonto",
    descricao: "Confirmar adesões, cancelamentos e o valor da mensalidade do mês.",
    responsavel: "RH",
    fonte: "fluxograma",
    prazo: (c) => fixo(dia(c, 5), "dia 5"),
    omie: { categoria: PLANO, oQue: "título do plano de saúde/odonto com vencimento no mês", janela: (c) => ({ de: dia(c, 1), ate: dia(c, ultimoDia(c)) }) },
  },
  {
    chave: "PONTO",
    etapa: 1,
    titulo: () => "Fechamento do ponto eletrônico",
    descricao: "Atestados, folgas, faltas, ajustes e compensações aos domingos. O ponto fechado alimenta horas extras, DSR, faltas, atrasos e banco de horas.",
    responsavel: "RH",
    fonte: "fluxograma",
    prazo: (c) => ({ inicio: dia(c, 10), ate: dia(c, 19), texto: "dias 10 a 19" }),
  },
  {
    chave: "INFORMACOES",
    etapa: 1,
    titulo: () => "Informações do mês reunidas",
    descricao: "Admissões e desligamentos, alterações contratuais (salário, cargo, jornada), férias, afastamentos e atestados, pensão alimentícia, dependentes (IRRF e salário-família), adesões e cancelamentos de benefícios.",
    responsavel: "RH",
    fonte: "fluxograma",
    prazo: (c) => fixo(dia(c, 19), "antes do fechamento da folha, dia 19"),
  },
  // 2 · LANÇAMENTOS
  {
    chave: "PLANILHA",
    etapa: 2,
    titulo: () => "Eventos lançados na planilha da Contabilidade",
    descricao: "Proventos (salário, horas extras, adicional noturno, DSR, prêmio, acúmulo de função, pró-labore, bonificação, reembolso, PLR), descontos (INSS, IRRF, faltas, atrasos, VT até 6%, contribuição assistencial autorizada, pensão, plano de saúde, consignados, adiantamentos, multas e avarias conforme o contrato), benefícios, rescisões e férias — com o ponto já fechado.",
    responsavel: "RH · Financeiro",
    fonte: "fluxograma",
    prazo: (c) => ({ inicio: dia(c, 20), ate: ultimoDiaUtil(c), texto: `a partir do dia 20; o fluxograma não fixa o fim — cobrado até o último dia útil (${fmt(ultimoDiaUtil(c))})` }),
  },
  {
    chave: "BENEFICIOS_FECHAMENTO",
    etapa: 2,
    titulo: (c) => `Fechamento do VT, VA e VR de ${rotuloCompetencia(seguinte(c))}`,
    descricao: "Fechar os valores dos benefícios do mês seguinte para o crédito no último dia útil.",
    responsavel: "RH · Financeiro",
    fonte: "fluxograma",
    prazo: (c) => fixo(dia(c, 22), "dia 22"),
  },
  // 3 · CONFERÊNCIA (sem data no fluxograma: antes do pagamento)
  ...(
    [
      ["CONF_CADASTRO", "Dados cadastrais conferidos", "Nome, CPF, cargo, conta bancária e dependentes de cada colaborador."],
      ["CONF_BASES", "Cálculos e bases conferidos", "Cada evento gerou o valor esperado; base do INSS e do IRRF pela tabela vigente, com dependentes e deduções."],
      ["CONF_ENCARGOS", "Encargos e limites conferidos", "FGTS de 8% (da empresa, não descontado), horas extras e DSR batendo com o ponto, salário-família (dependentes e limite de renda), teto do INSS e máximos de desconto."],
      ["CONF_TOTAIS", "Totais e banco de horas conferidos", "Proventos, descontos e líquido fecham; saldo do banco de horas atualizado."],
    ] as const
  ).map(
    ([chave, titulo, descricao]): ItemFolha => ({
      chave,
      etapa: 3,
      titulo: () => titulo,
      descricao,
      responsavel: "RH · Financeiro",
      fonte: "sistema",
      prazo: (c) => fixo(enesimoDiaUtil(seguinte(c), 3), "antes do pagamento: 3º dia útil do mês seguinte"),
    })
  ),
  // 4 · FECHAMENTO
  {
    chave: "BENEFICIOS_CREDITO",
    etapa: 4,
    titulo: (c) => `Crédito do VT, VA e VR de ${rotuloCompetencia(seguinte(c))}`,
    descricao: "Compensação dos benefícios fechados desde o dia 22.",
    responsavel: "Financeiro",
    fonte: "fluxograma",
    prazo: (c) => fixo(ultimoDiaUtil(c), "último dia útil"),
    omie: { categoria: BENEFICIOS, oQue: "título de VT/VA/VR pago entre o dia 22 e o início do mês seguinte", janela: (c) => ({ de: dia(c, 22), ate: dia(seguinte(c), 5) }) },
  },
  {
    chave: "PROCESSAMENTO",
    etapa: 4,
    titulo: () => "Folha processada e competência travada",
    descricao: "Cálculo final e trava da competência; arquivo de pagamento (CNAB) gerado e enviado ao banco.",
    responsavel: "RH · Financeiro",
    fonte: "fluxograma",
    prazo: (c) => fixo(enesimoDiaUtil(seguinte(c), 4, true), "antes do pagamento: 4º dia útil do mês seguinte"),
  },
  {
    chave: "SALARIO",
    etapa: 4,
    titulo: () => "Salários creditados",
    descricao: "Salário na conta de cada pessoa. Limite legal: 5º dia útil do mês seguinte (sábado conta como dia útil).",
    responsavel: "Financeiro",
    fonte: "legislação",
    prazo: (c) => fixo(enesimoDiaUtil(seguinte(c), 5, true), "5º dia útil do mês seguinte"),
    omie: { categoria: SALARIO, exceto: NAO_SALARIO, oQue: "título de salários pago no início do mês seguinte", janela: (c) => ({ de: dia(c, 25), ate: dia(seguinte(c), 15) }) },
  },
  // 5 · ENCARGOS E OBRIGAÇÕES (Contabilidade)
  {
    chave: "ESOCIAL",
    etapa: 5,
    titulo: () => "eSocial fechado (S-1200, S-1210, S-1299)",
    descricao: "Remunerações, pagamentos e fechamento dos eventos periódicos. Divergência com a DCTFWeb trava a apuração.",
    responsavel: "Contabilidade",
    fonte: "legislação",
    prazo: (c) => fixo(antecipar(dia(seguinte(c), 15)), "dia 15 do mês seguinte"),
  },
  {
    chave: "INSS",
    etapa: 5,
    titulo: () => "DCTFWeb transmitida e INSS pago (DARF)",
    descricao: "Contribuição previdenciária do colaborador e da empresa. A antiga GPS foi substituída pelo DARF gerado na DCTFWeb.",
    responsavel: "Contabilidade",
    fonte: "legislação",
    prazo: (c) => fixo(antecipar(dia(seguinte(c), 20)), "dia 20 do mês seguinte"),
    omie: { categoria: /inss|previd|dctf|gps\b/i, oQue: "título de INSS/DCTFWeb", janela: (c) => ({ de: dia(seguinte(c), 1), ate: dia(seguinte(c), ultimoDia(seguinte(c))) }) },
  },
  {
    chave: "FGTS",
    etapa: 5,
    titulo: () => "FGTS Digital pago (guia GFD)",
    descricao: "8% sobre a remuneração. A GRF/SEFIP deixou de existir em março/2024.",
    responsavel: "Contabilidade",
    fonte: "legislação",
    prazo: (c) => fixo(antecipar(dia(seguinte(c), 20)), "dia 20 do mês seguinte"),
    omie: { categoria: /fgts/i, oQue: "título de FGTS", janela: (c) => ({ de: dia(seguinte(c), 1), ate: dia(seguinte(c), ultimoDia(seguinte(c))) }) },
  },
  {
    chave: "IRRF",
    etapa: 5,
    titulo: () => "IRRF da folha pago (DARF)",
    descricao: "Imposto de renda retido dos salários.",
    responsavel: "Contabilidade",
    fonte: "legislação",
    prazo: (c) => fixo(antecipar(dia(seguinte(c), 20)), "dia 20 do mês seguinte"),
    omie: { categoria: /irrf|i\.?r\.?r\.?f|imposto de renda/i, oQue: "título de IRRF", janela: (c) => ({ de: dia(seguinte(c), 1), ate: dia(seguinte(c), ultimoDia(seguinte(c))) }) },
  },
  {
    chave: "SINDICAL",
    etapa: 5,
    titulo: () => "Contribuição assistencial repassada ao sindicato",
    descricao: "Só de quem autorizou o desconto, no prazo da convenção coletiva.",
    responsavel: "Contabilidade",
    fonte: "fluxograma",
    prazo: () => ({ inicio: null, ate: null, texto: "prazo da convenção coletiva" }),
  },
  {
    chave: "PROVISAO",
    etapa: 5,
    titulo: () => "Provisão de férias e 13º lançada",
    descricao: "Reserva contábil mensal de férias e 13º.",
    responsavel: "Contabilidade",
    fonte: "fluxograma",
    prazo: () => ({ inicio: null, ate: null, texto: "no balancete do mês" }),
  },
  // 6 · FINALIZAÇÃO
  {
    chave: "HOLERITES",
    etapa: 6,
    titulo: () => "Holerites distribuídos",
    descricao: "Demonstrativo entregue a cada colaborador, junto com o pagamento.",
    responsavel: "RH",
    fonte: "fluxograma",
    prazo: (c) => fixo(enesimoDiaUtil(seguinte(c), 5, true), "com o pagamento"),
  },
  {
    chave: "ARQUIVO",
    etapa: 6,
    titulo: () => "Documentação arquivada",
    descricao: "Guarda para consultas e fiscalizações.",
    responsavel: "RH",
    fonte: "fluxograma",
    prazo: () => ({ inicio: null, ate: null, texto: "sem prazo" }),
  },
  {
    chave: "RELATORIOS",
    etapa: 6,
    titulo: () => "Quadro de pessoal importado e custos por centro",
    descricao: "Relatórios gerenciais: importar o quadro do mês na tela DRE por centro de custo.",
    responsavel: "RH",
    fonte: "fluxograma",
    prazo: () => ({ inicio: null, ate: null, texto: "sem prazo" }),
    link: { href: "/dre-centro-custo", rotulo: "DRE por centro de custo" },
  },
];

// ---- Status ----
export type TituloDaFolha = { categoria: string | null; parceiro: string | null; valorCents: number; vencimento: Date; liquidado: boolean; pagoEm: Date | null };
export type Evidencia = { titulos: TituloDaFolha[]; valorCents: number; pagos: number; emAberto: number; ultimoPagamento: Date | null };
export type Marca = { feitoEm: Date; feitoPor: string | null; observacao: string | null };
export type Status = "feito" | "omie-ok" | "omie-atraso" | "atrasado" | "vence-logo" | "pendente" | "futuro" | "sem-prazo";

export const ROTULO_STATUS: Record<Status, string> = {
  feito: "Feito",
  "omie-ok": "Pago no prazo (Omie)",
  "omie-atraso": "Pago com atraso (Omie)",
  atrasado: "Atrasado",
  "vence-logo": "Vence em até 2 dias",
  pendente: "Pendente",
  futuro: "Ainda não começou",
  "sem-prazo": "Sem prazo",
};

// Os títulos da Omie que comprovam o item.
export function evidenciaDoItem(item: ItemFolha, c: Competencia, titulos: TituloDaFolha[]): Evidencia | null {
  if (!item.omie) return null;
  const { de, ate } = item.omie.janela(c);
  const fim = new Date(ate.getTime() + 86_399_999);
  const dentro = (d: Date | null) => !!d && d >= de && d <= fim;
  const lista = titulos.filter(
    (t) => item.omie!.categoria.test(t.categoria ?? "") && !(item.omie!.exceto?.test(t.categoria ?? "") ?? false) && (dentro(t.pagoEm) || dentro(t.vencimento))
  );
  const pagos = lista.filter((t) => t.liquidado);
  return {
    titulos: lista,
    valorCents: lista.reduce((s, t) => s + t.valorCents, 0),
    pagos: pagos.length,
    emAberto: lista.length - pagos.length,
    ultimoPagamento: pagos.reduce<Date | null>((m, t) => (t.pagoEm && (!m || t.pagoEm > m) ? t.pagoEm : m), null),
  };
}

export function statusDoItem(params: { prazo: Prazo; marca: Marca | null; evidencia: Evidencia | null; hoje: Date }): Status {
  const { prazo, marca, evidencia, hoje } = params;
  if (marca) return "feito";
  if (evidencia && evidencia.pagos > 0 && evidencia.emAberto === 0 && evidencia.ultimoPagamento) {
    return prazo.ate && evidencia.ultimoPagamento.getTime() > prazo.ate.getTime() + 86_399_999 ? "omie-atraso" : "omie-ok";
  }
  if (!prazo.ate) return "sem-prazo";
  const hojeDia = Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate());
  if (hojeDia > prazo.ate.getTime()) return "atrasado";
  if (prazo.inicio && hojeDia < prazo.inicio.getTime()) return "futuro";
  if (prazo.ate.getTime() - hojeDia <= 2 * 86_400_000) return "vence-logo";
  return "pendente";
}

export type LinhaDoChecklist = { item: ItemFolha; titulo: string; prazo: Prazo; porEmpresa: { conexaoId: string; status: Status; marca: Marca | null; evidencia: Evidencia | null }[] };

export function montarChecklist(params: {
  competencia: Competencia;
  empresas: { conexaoId: string; titulos: TituloDaFolha[]; marcas: Map<string, Marca> }[];
  hoje: Date;
}): LinhaDoChecklist[] {
  const { competencia: c, hoje } = params;
  return ITENS_FOLHA.map((item) => {
    const prazo = item.prazo(c);
    return {
      item,
      titulo: item.titulo(c),
      prazo,
      porEmpresa: params.empresas.map((e) => {
        const marca = e.marcas.get(item.chave) ?? null;
        const evidencia = evidenciaDoItem(item, c, e.titulos);
        return { conexaoId: e.conexaoId, status: statusDoItem({ prazo, marca, evidencia, hoje }), marca, evidencia };
      }),
    };
  });
}
