import type { ConformidadeArea } from "@prisma/client";

// FUNDAMENTAÇÃO TÉCNICA E LEGAL DO MÓDULO DE CONFORMIDADE.
//
// Catálogo das obrigações que uma operação de fretamento e transporte de
// passageiros no Lucro Presumido precisa cumprir todo mês, com a norma que as
// cria, o prazo, a evidência que prova o cumprimento e o que acontece quando
// não se cumpre.
//
// Serve a três usos, e é por isso que vive em CÓDIGO e não no banco:
//
//   1. FUNDAMENTA a leitura automática. O modelo recebe este catálogo junto do
//      documento: é o que faz "registro C110 inexistente" ser classificado como
//      EFD ICMS/IPI e não como "outro", e é o que permite preencher a base
//      legal do apontamento sem inventá-la.
//   2. FUNDAMENTA a tela. Quem abre um apontamento vê a norma, o prazo e a
//      consequência — sem depender de a consultoria ter escrito isso no PDF.
//   3. FICA VERSIONADO. Prazo de obrigação acessória muda, e quando mudar o
//      diff mostra o que mudou, quando e por quê. Numa tabela editável do banco
//      isso vira alteração silenciosa numa terça-feira qualquer.
//
// O catálogo foi montado a partir dos relatórios de conformidade fiscal que o
// grupo recebe (TrustTax / SM Advogados) e da legislação que eles citam. Não
// substitui a assessoria: é o mapa que permite ao sistema conversar com ela na
// mesma língua. Prazos de obrigação acessória mudam com frequência — a data
// aqui é referência para alerta, nunca para decisão final.

export type Periodicidade = "MENSAL" | "TRIMESTRAL" | "ANUAL" | "CONTINUA";

export type Obrigacao = {
  codigo: string;
  nome: string;
  area: ConformidadeArea;
  periodicidade: Periodicidade;
  // Norma que cria a obrigação. Citada como a consultoria cita, para o texto do
  // sistema e o do relatório dela poderem ser confrontados linha a linha.
  baseLegal: string;
  // Prazo em linguagem de quem opera, não em linguagem de norma.
  prazo: string;
  // O que, no arquivo, prova que foi cumprida. É a lista que a consultoria pede
  // todo mês — e a que este grupo vem atrasando desde dez/2025.
  evidencia: string[];
  // O que se perde quando não se cumpre. Escrito em consequência concreta:
  // "multa de X" e "bloqueia a CND" movem uma decisão; "descumprimento da
  // obrigação acessória" não move nada.
  risco: string;
};

export const OBRIGACOES: Obrigacao[] = [
  {
    codigo: "ISS",
    nome: "ISS sobre serviços de transporte municipal",
    area: "FISCAL",
    periodicidade: "MENSAL",
    baseLegal: "LC 116/2003; no município de São Paulo, Lei 13.701/2003 (item 16 da lista de serviços)",
    prazo: "Recolhimento até o dia 10 do mês seguinte ao da prestação (São Paulo)",
    evidencia: ["Registro de NF/Fatura (acompanhamento de serviços)", "Guia de ISS", "Comprovante de pagamento"],
    risco:
      "Multa e juros sobre o principal, e divergência entre o ISS retido pelo tomador e o recolhido pela empresa vira autuação municipal. Transporte estritamente municipal tributado como intermunicipal é glosa dos dois lados.",
  },
  {
    codigo: "ICMS-TRANSPORTE",
    nome: "ICMS sobre transporte intermunicipal e interestadual",
    area: "FISCAL",
    periodicidade: "MENSAL",
    baseLegal: "LC 87/1996; RICMS-SP (Decreto 45.490/2000)",
    prazo: "Apuração mensal; recolhimento conforme o CPR do contribuinte",
    evidencia: ["Acompanhamento de saídas", "Guia (GARE-ICMS)", "Comprovante de pagamento"],
    risco:
      "Transporte de passageiros só é isento nas hipóteses do art. 78 do Anexo I do RICMS-SP. Isenção aplicada fora dela é ICMS não recolhido, com multa e juros — e a descrição da nota é a primeira coisa que o fisco lê.",
  },
  {
    codigo: "EFD-ICMS-IPI",
    nome: "EFD ICMS/IPI (SPED Fiscal)",
    area: "FISCAL",
    periodicidade: "MENSAL",
    baseLegal: "Ajuste SINIEF 2/2009; Portaria CAT 147/2009 (SP)",
    prazo: "Transmissão até o dia 20 do mês subsequente (SP)",
    evidencia: ["Recibo de entrega da EFD"],
    risco:
      "Entrega em atraso ou com registro faltando (C110, C113, C114) sujeita a multa por obrigação acessória e é o que alimenta malha fiscal: o cruzamento é automático, e divergência de CST, CFOP ou valor total do documento aparece sozinha.",
  },
  {
    codigo: "EFD-CONTRIBUICOES",
    nome: "EFD-Contribuições (PIS/COFINS)",
    area: "FISCAL",
    periodicidade: "MENSAL",
    baseLegal: "Lei 9.718/1998 (regime cumulativo); IN RFB 1.252/2012; IN RFB 2.121/2022",
    prazo: "Transmissão até o 10º dia útil do 2º mês subsequente",
    evidencia: ["Recibo da EFD-Contribuições", "DARF de PIS e de COFINS", "Conciliação com a DCTFWeb e o e-CAC"],
    risco:
      "Multa mínima de R$ 500,00 por mês de atraso no Lucro Presumido (art. 57 da MP 2.158-35/2001). Ajuste lançado nos registros M220/M620 sem processo administrativo que o lastreie é glosa provável do crédito.",
  },
  {
    codigo: "DCTFWEB",
    nome: "DCTFWeb",
    area: "PREVIDENCIARIO",
    periodicidade: "MENSAL",
    baseLegal: "IN RFB 2.005/2021",
    prazo: "Transmissão até o dia 15 do mês seguinte ao da competência",
    evidencia: ["Recibo da DCTFWeb", "DARF ou PER/DCOMP correspondente"],
    risco:
      "É a declaração que constitui o crédito tributário previdenciário: o que está nela e não foi pago vira débito em aberto e bloqueia a CND federal.",
  },
  {
    codigo: "ESOCIAL",
    nome: "eSocial — folha e eventos periódicos",
    area: "TRABALHISTA",
    periodicidade: "MENSAL",
    baseLegal: "Decreto 8.373/2014; IN RFB 2.005/2021",
    prazo: "Fechamento da folha até o dia 15 do mês seguinte",
    evidencia: ["Recibo de fechamento do período", "Conciliação da apuração eSocial × DCTFWeb"],
    risco:
      "Divergência entre a apuração do eSocial e a da DCTFWeb é inconsistência que a Receita enxerga sozinha, e atrasa o fechamento previdenciário do mês inteiro.",
  },
  {
    codigo: "CP-PATRONAL",
    nome: "Contribuição previdenciária patronal, terceiros e GILRAT",
    area: "PREVIDENCIARIO",
    periodicidade: "MENSAL",
    baseLegal: "Lei 8.212/1991, arts. 22 e 30",
    prazo: "Recolhimento até o dia 20 do mês seguinte",
    evidencia: ["DARF", "PER/DCOMP quando houver compensação", "Comprovante das retenções sofridas"],
    risco:
      "Numa empresa que sofre retenção de 11% dos tomadores, o valor a pagar é o líquido — pagar sobre o bruto é caixa parado na Receita, e pagar a menos é débito com multa de mora.",
  },
  {
    codigo: "RETENCAO-CESSAO",
    nome: "Retenção de 11% na cessão de mão de obra",
    area: "PREVIDENCIARIO",
    periodicidade: "CONTINUA",
    baseLegal: "Lei 8.212/1991, art. 31; IN RFB 2.110/2022",
    prazo: "Retenção no ato do pagamento; recolhimento até o dia 20 do mês seguinte",
    evidencia: ["Contrato com o tomador", "Notas com a retenção destacada", "Comprovantes de retenção"],
    risco:
      "Locação de veículo COM motorista costuma ser lida como cessão de mão de obra, e aí a retenção é obrigatória. Contrato mal redigido é o que decide essa leitura — e a responsabilidade pelo não recolhimento é solidária.",
  },
  {
    codigo: "IRPJ-CSLL",
    nome: "IRPJ e CSLL — Lucro Presumido",
    area: "FISCAL",
    periodicidade: "TRIMESTRAL",
    baseLegal: "Lei 9.430/1996, arts. 1º e 5º; RIR/2018",
    prazo: "Quota única ou 1ª quota até o último dia útil do mês seguinte ao encerramento do trimestre",
    evidencia: ["Apuração trimestral", "Balancete", "DARF"],
    risco:
      "Sem a apuração e o balancete não há como conferir o que a DCTFWeb declarou, a ECF do ano fica sem lastro e a defesa em eventual fiscalização começa sem documento.",
  },
  {
    codigo: "ECD",
    nome: "ECD — Escrituração Contábil Digital",
    area: "CONTABIL",
    periodicidade: "ANUAL",
    baseLegal: "IN RFB 2.003/2021",
    prazo: "Último dia útil de maio do ano seguinte",
    evidencia: ["Recibo de transmissão"],
    risco: "Multa por atraso e perda da prova contábil — a ECD é o que dá fé aos números usados em qualquer discussão fiscal.",
  },
  {
    codigo: "ECF",
    nome: "ECF — Escrituração Contábil Fiscal",
    area: "FISCAL",
    periodicidade: "ANUAL",
    baseLegal: "IN RFB 2.004/2021",
    prazo: "Último dia útil de julho do ano seguinte",
    evidencia: ["Recibo de transmissão"],
    risco:
      "Depende da apuração trimestral de IRPJ/CSLL estar pronta. Trimestre não apurado no ano anterior vira ECF em risco no ano seguinte — o atraso não fica onde nasceu.",
  },
  {
    codigo: "FGTS",
    nome: "FGTS Digital",
    area: "TRABALHISTA",
    periodicidade: "MENSAL",
    baseLegal: "Lei 8.036/1990; Lei 14.438/2022",
    prazo: "Recolhimento até o dia 20 do mês seguinte",
    evidencia: ["Guia FGTS Digital", "Comprovante", "CRF válido"],
    risco: "Sem CRF a empresa não contrata com o poder público nem participa de licitação — e boa parte do fretamento é contrato público.",
  },
  {
    codigo: "CND-FEDERAL",
    nome: "CND federal conjunta (RFB/PGFN)",
    area: "FISCAL",
    periodicidade: "CONTINUA",
    baseLegal: "CTN, arts. 205 e 206; Portaria Conjunta RFB/PGFN 1.751/2014",
    prazo: "Validade de 180 dias — renovar antes do vencimento",
    evidencia: ["Certidão emitida", "Relatório de situação fiscal sem pendências"],
    risco:
      "Certidão vencida ou positiva trava contrato público, financiamento e venda de ativo. Débito NÃO TRIBUTÁRIO inscrito em dívida ativa — multa do Ministério do Trabalho, por exemplo — bloqueia a certidão do mesmo jeito que débito de tributo.",
  },
  {
    codigo: "CND-ESTADUAL",
    nome: "Certidão negativa estadual (SP)",
    area: "FISCAL",
    periodicidade: "CONTINUA",
    baseLegal: "Legislação estadual de SP; CTN, art. 205",
    prazo: "Validade de 180 dias — renovar antes do vencimento",
    evidencia: ["Certidão emitida", "Relatório de pendências fiscais limpo"],
    risco:
      "Impossibilidade de emitir a certidão é sinal de pendência aberta e precisa ser tratada como apontamento, não como problema de sistema do portal.",
  },
  {
    codigo: "CND-MUNICIPAL",
    nome: "Certidão negativa municipal (sede e filiais)",
    area: "FISCAL",
    periodicidade: "CONTINUA",
    baseLegal: "Legislação municipal; CTN, art. 205",
    prazo: "Validade conforme o município — em geral 60 a 180 dias",
    evidencia: ["Certidão de cada inscrição municipal"],
    risco: "Cada filial tem inscrição própria: certidão da sede não cobre a filial, e é sempre a filial esquecida que trava o contrato.",
  },
  {
    codigo: "CTE",
    nome: "CT-e — Conhecimento de Transporte Eletrônico",
    area: "REGULATORIO",
    periodicidade: "CONTINUA",
    baseLegal: "Ajuste SINIEF 9/2007; RICMS-SP",
    prazo: "Emissão a cada prestação de serviço de transporte",
    evidencia: ["XML autorizado", "Descrição compatível com a natureza do serviço"],
    risco:
      "CT-e é documento de transporte intermunicipal/interestadual. Emitir CT-e para serviço que é de ISS (transporte municipal ou individual) é documento irregular, e a descrição errada arrasta o tratamento tributário junto.",
  },
];

export const OBRIGACAO_POR_CODIGO = new Map(OBRIGACOES.map((o) => [o.codigo, o]));

// Pontos de atenção específicos desta operação — transporte de passageiros por
// fretamento, no Lucro Presumido, em São Paulo. Não são obrigações: são as
// teses e enquadramentos em que este setor erra, e que aparecem repetidamente
// nos relatórios de conformidade recebidos pelo grupo.
export type TeseFiscal = {
  codigo: string;
  titulo: string;
  area: ConformidadeArea;
  baseLegal: string;
  oQueObservar: string;
};

export const TESES: TeseFiscal[] = [
  {
    codigo: "ICMS-ISENCAO-PASSAGEIROS",
    titulo: "Isenção de ICMS no transporte de passageiros",
    area: "FISCAL",
    baseLegal: "Art. 78 do Anexo I do RICMS-SP (Decreto 45.490/2000)",
    oQueObservar:
      "A isenção alcança o transporte de trabalhadores e estudantes. Nota cuja descrição diz 'funcionários e terceiros', ou cujo tomador é pessoa física sem contrato de fretamento contínuo, está fora da hipótese — e a própria descrição da nota é a prova contra a empresa. Transporte individual privado é serviço de ISS: emitir CT-e nele é irregular.",
  },
  {
    codigo: "ICMS-CREDITO-OUTORGADO",
    titulo: "Crédito outorgado do transporte",
    area: "FISCAL",
    baseLegal: "Art. 11 do Anexo III do RICMS-SP",
    oQueObservar:
      "É opção do contribuinte, e substitui o aproveitamento dos créditos normais. A opção precisa estar formalizada e valer para todos os estabelecimentos — filial nova aberta sem a opção registrada é divergência de apuração.",
  },
  {
    codigo: "COMPENSACAO-SEM-LASTRO",
    titulo: "Compensação (PER/DCOMP) sem processo que a sustente",
    area: "FISCAL",
    baseLegal: "Lei 9.430/1996, art. 74, §§ 12 e 17",
    oQueObservar:
      "Crédito usado em compensação precisa de origem demonstrável. Quando decorre de discussão judicial, exige decisão transitada em julgado (art. 170-A do CTN) — mandado de segurança suspenso, sem liminar, não é lastro. A não homologação restabelece o débito com multa e juros e ainda sujeita a multa isolada de 50% sobre o valor compensado.",
  },
  {
    codigo: "AJUSTE-M220-M620",
    titulo: "Ajustes M220/M620 na EFD-Contribuições",
    area: "FISCAL",
    baseLegal: "IN RFB 1.252/2012; leiaute da EFD-Contribuições",
    oQueObservar:
      "O código de ajuste que aponta processo administrativo exige que o processo exista e esteja ativo no e-Processo. Sem isso, o ajuste reduz o débito declarado sem amparo — e a divergência aparece no cruzamento com a DCTFWeb.",
  },
  {
    codigo: "DIVIDA-ATIVA-NAO-TRIBUTARIA",
    titulo: "Inscrição em dívida ativa não tributária",
    area: "TRABALHISTA",
    baseLegal: "Lei 6.830/1980; Lei 4.320/1964, art. 39",
    oQueObservar:
      "Multa administrativa do Ministério do Trabalho inscrita na dívida ativa da União bloqueia a certidão conjunta igual a débito de tributo, permite protesto e execução fiscal. Costuma passar despercebida porque não aparece nos controles fiscais — só no Regularize.",
  },
  {
    codigo: "LOCACAO-COM-MOTORISTA",
    titulo: "Locação de veículo com motorista × cessão de mão de obra",
    area: "PREVIDENCIARIO",
    baseLegal: "Lei 8.212/1991, art. 31; IN RFB 2.110/2022",
    oQueObservar:
      "Contrato que coloca o motorista à disposição do tomador tende a ser cessão de mão de obra, com retenção de 11%. A redação do contrato é o que decide, e o custo do erro é solidário: a empresa responde pelo que o tomador deixou de reter.",
  },
];

// Texto compacto do catálogo, para ir junto do documento na leitura automática.
// Formatado como referência legível — e não como JSON — pela mesma razão do
// briefing do analista (ver aiAnalyst.ts): o modelo interpreta melhor, e fica
// fácil auditar depois o que ele tinha em mãos ao classificar cada apontamento.
export function fundamentacaoParaLeitura(): string {
  const linhas: string[] = [];

  linhas.push("## Obrigações que esta operação precisa cumprir");
  for (const o of OBRIGACOES) {
    linhas.push(`- [${o.codigo}] ${o.nome} (${o.area}, ${o.periodicidade.toLowerCase()}) — ${o.baseLegal}. Prazo: ${o.prazo}. Prova: ${o.evidencia.join(", ")}.`);
  }

  linhas.push("");
  linhas.push("## Teses e enquadramentos em que este setor costuma errar");
  for (const t of TESES) {
    linhas.push(`- [${t.codigo}] ${t.titulo} — ${t.baseLegal}. ${t.oQueObservar}`);
  }

  return linhas.join("\n");
}
