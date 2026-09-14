import { fmtBRL, fmtData, fmtPercent } from "../format";
import { diasEntre, inicioDoMes, somarDias } from "../periodos";
import type { AchadoNovo, Agente, ContextoAuditoria } from "../types";
import { agrupar, chaveAchado, chaveMes, materialidadeCents, severidadePorValor, somar } from "./comum";

// AGENTE DE CONCILIAÇÃO BANCÁRIA
// A conciliacao e o unico controle que fecha o circuito: titulo -> baixa ->
// dinheiro que realmente saiu ou entrou da conta. Sem ela, qualquer numero do
// sistema e uma declaracao de intencao. E e justamente onde uma fraude bem
// feita se esconde — o lancamento existe, a nota existe, mas o dinheiro foi
// para outro lugar (ou saiu duas vezes).

// Tolerancia para casar baixa com movimento bancario por valor+data quando
// a Omie nao informa o titulo de origem no extrato.
const TOLERANCIA_CENTAVOS = 100;
const JANELA_CASAMENTO_DIAS = 3;

export const agenteConciliacao: Agente = {
  id: "conciliacao-bancaria",
  nome: "Conciliação bancária",
  area: "Financeiro",
  descricao:
    "Confronta extrato bancário, baixas de títulos e saldos: movimentos não conciliados, saída sem título correspondente, baixa sem dinheiro no extrato, débitos duplicados e saldo abaixo do mínimo de segurança.",
  executar: auditarConciliacao,
};

function auditarConciliacao(ctx: ContextoAuditoria): AchadoNovo[] {
  const achados: AchadoNovo[] = [];
  const materialidade = materialidadeCents(ctx);

  achados.push(...movimentosNaoConciliados(ctx, materialidade));
  achados.push(...saidaSemTitulo(ctx, materialidade));
  achados.push(...entradaSemTitulo(ctx, materialidade));
  achados.push(...transferenciaEntreEmpresas(ctx, materialidade));
  achados.push(...baixaSemMovimento(ctx, materialidade));
  achados.push(...debitosDuplicados(ctx, materialidade));
  achados.push(...movimentoSemCategoria(ctx, materialidade));
  achados.push(...saldoAbaixoDoMinimo(ctx));

  return achados;
}

function movimentosDoPeriodo(ctx: ContextoAuditoria) {
  const inicio = inicioDoMes(new Date(ctx.dataReferencia.getFullYear(), ctx.dataReferencia.getMonth() - 1, 1));
  return ctx.movimentos.filter((m) => m.data >= inicio && m.data <= ctx.dataReferencia);
}

// CB-ENTRADA-SEM-TITULO — o espelho da saída sem título, do lado da receita.
//
// Crédito no extrato que não nasce de título a receber nem casa com baixa é
// receita que o sistema não conhece: um serviço eventual pago direto na
// conta, um estorno, um empréstimo de sócio — ou receita que alguém está
// recebendo por fora e só parte dela entra. Também é o lado que a ISA 240
// manda olhar para receita não registrada, e o único trecho do circuito
// título → baixa → banco que não tinha regra.
//
// Ficam de fora, por histórico: transferência entre contas do próprio grupo
// (o par débito/crédito de mesmo valor em ±1 dia entre contas ativas),
// rendimento de aplicação e estorno — que não são receita.
const NAO_E_RECEITA = /transfer|aplica[cç][aã]o|resgate|rendimento|estorno|devolu[cç][aã]o|tarifa|cdb|poupan|juros s\/|cr[eé]dito de juros|entre contas|ted mesma|mesma titularidade/i;

function entradaSemTitulo(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const movimentos = movimentosDoPeriodo(ctx);
  const creditos = movimentos.filter((m) => m.valorCents > 0);
  const debitos = movimentos.filter((m) => m.valorCents < 0);
  const baixas = ctx.baixas;

  const orfaos = creditos.filter((m) => {
    if (m.tituloCodigo) return false;
    if (NAO_E_RECEITA.test(`${m.observacao ?? ""} ${m.tipo ?? ""} ${m.parceiroNome ?? ""}`)) return false;
    // Transferência entre contas do grupo: um débito de mesmo valor em outra
    // conta, no mesmo dia ou no dia seguinte.
    const transferencia = debitos.some(
      (d) =>
        d.contaCorrenteCodigo !== m.contaCorrenteCodigo &&
        Math.abs(Math.abs(d.valorCents) - m.valorCents) <= TOLERANCIA_CENTAVOS &&
        Math.abs(diasEntre(d.data, m.data)) <= 1
    );
    if (transferencia) return false;
    return !baixas.some(
      (b) =>
        Math.abs(Math.abs(b.valorCents) - m.valorCents) <= TOLERANCIA_CENTAVOS &&
        Math.abs(diasEntre(b.dataBaixa, m.data)) <= JANELA_CASAMENTO_DIAS
    );
  });

  return orfaos
    .filter((m) => m.valorCents >= materialidade / 2)
    .map((m) => ({
      regra: "CB-ENTRADA-SEM-TITULO",
      tipo: "ESTADO" as const,
      severidade: severidadePorValor(m.valorCents, materialidade),
      categoria: "RISCO_FINANCEIRO" as const,
      titulo: `Entrada de ${fmtBRL(m.valorCents)} sem título a receber correspondente`,
      descricao:
        `Crédito de ${fmtBRL(m.valorCents)} em ${fmtData(m.data)}${m.parceiroNome ? ` de ${m.parceiroNome}` : ""} não tem ` +
        `título a receber vinculado nem baixa equivalente em valor e data. ${m.observacao ? `Histórico: "${m.observacao}". ` : ""}` +
        `Receita que entra sem título não é faturada, não é tributada e não aparece em nenhum relatório — e é assim que ` +
        `uma parte dela pode nunca chegar à conta.`,
      recomendacao:
        "Identificar a origem do crédito. Sendo receita, emitir a nota e o título correspondentes na Omie; sendo " +
        "aporte, empréstimo ou estorno, registrar a natureza correta para a conciliação fechar.",
      valorCents: m.valorCents,
      dataReferencia: m.data,
      entidadeTipo: "OmieMovimento",
      entidadeId: m.id,
      entidadeRef: m.documento ?? m.codigoLancamento,
      evidencia: {
        data: m.data.toISOString(),
        valor: m.valorCents,
        historico: m.observacao,
        parceiro: m.parceiroNome,
        conta: m.contaCorrenteCodigo,
      },
      chave: chaveAchado("CB-ENTRADA-SEM-TITULO", m.codigoLancamento),
    }));
}

// CB-NAO-CONCILIADO — agregado por conta corrente. O numero que importa e o
// PERCENTUAL nao conciliado: 3 lancamentos soltos numa conta com 900 e
// rotina; 40% pendentes significa que a conciliacao parou de ser feita.
function movimentosNaoConciliados(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const movimentos = movimentosDoPeriodo(ctx);
  const porConta = agrupar(movimentos, (m) => m.contaCorrenteCodigo);
  const achados: AchadoNovo[] = [];

  for (const [conta, lista] of porConta) {
    const pendentes = lista.filter((m) => !m.conciliado);
    if (pendentes.length === 0) continue;
    const percentual = (pendentes.length / lista.length) * 100;
    const valor = somar(pendentes, (m) => Math.abs(m.valorCents));
    if (percentual < 10 && valor < materialidade) continue;

    const nomeConta = ctx.contasCorrentes.find((c) => c.codigo === conta)?.descricao ?? `conta ${conta}`;

    achados.push({
      regra: "CB-NAO-CONCILIADO",
      tipo: "ESTADO",
      severidade: percentual >= 40 ? "ALTA" : severidadePorValor(valor, materialidade),
      categoria: "ERRO_PROCESSO",
      titulo: `${pendentes.length} movimentos não conciliados em ${nomeConta}`,
      descricao:
        `${fmtPercent(percentual)} dos lançamentos dos últimos dois meses nessa conta (${fmtBRL(valor)} em valor absoluto) ` +
        `não estão conciliados. Enquanto isso, nada garante que o que o sistema mostra é o que aconteceu no banco.`,
      recomendacao:
        "Conciliar os pendentes na Omie, dos maiores para os menores. Se o volume for grande, priorizar o mês corrente " +
        "e estabelecer a conciliação como rotina semanal fixa — atrasada, ela deixa de ser controle e vira arqueologia.",
      valorCents: valor,
      dataReferencia: ctx.dataReferencia,
      entidadeTipo: "OmieContaCorrente",
      entidadeRef: nomeConta,
      evidencia: { conta: nomeConta, pendentes: pendentes.length, quantidade: lista.length, percentual, valor },
      chave: chaveAchado("CB-NAO-CONCILIADO", conta, chaveMes(ctx.dataReferencia)),
    });
  }
  return achados;
}

// CB-SAIDA-SEM-TITULO — dinheiro saiu da conta sem titulo correspondente. E o
// achado mais serio deste agente: e assim que aparece um pagamento que nunca
// passou por aprovacao nenhuma.
function saidaSemTitulo(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const movimentos = movimentosDoPeriodo(ctx).filter((m) => m.valorCents < 0);
  const baixas = ctx.baixas;

  const orfaos = movimentos.filter((m) => {
    if (m.tituloCodigo) return false;
    // Sem vinculo explicito, tenta casar por valor e data com alguma baixa —
    // so entra como orfao quando nao ha nem casamento aproximado.
    return !baixas.some(
      (b) =>
        Math.abs(Math.abs(b.valorCents) - Math.abs(m.valorCents)) <= TOLERANCIA_CENTAVOS &&
        Math.abs(diasEntre(b.dataBaixa, m.data)) <= JANELA_CASAMENTO_DIAS
    );
  });

  if (orfaos.length === 0) return [];

  // Um achado por movimento relevante (aqui o detalhe importa: cada saida
  // dessas precisa de explicacao individual), limitado por materialidade
  // para o alerta nao virar lista de tarifa bancaria de R$ 2.
  return orfaos
    .filter((m) => Math.abs(m.valorCents) >= materialidade / 2)
    .map((m) => ({
      regra: "CB-SAIDA-SEM-TITULO",
      tipo: "ESTADO" as const,
      severidade: severidadePorValor(Math.abs(m.valorCents), materialidade),
      categoria: "FRAUDE" as const,
      titulo: `Saída de ${fmtBRL(Math.abs(m.valorCents))} sem título correspondente`,
      descricao:
        `Débito de ${fmtBRL(Math.abs(m.valorCents))} em ${fmtData(m.data)}${
          m.parceiroNome ? ` para ${m.parceiroNome}` : ""
        } não tem título a pagar vinculado nem baixa equivalente em valor e data. ` +
        `${m.observacao ? `Histórico: "${m.observacao}". ` : ""}Toda saída de caixa deveria nascer de um título aprovado.`,
      recomendacao:
        "Identificar o beneficiário e o autorizador dessa saída. Sendo despesa legítima, lançar o título correspondente na Omie " +
        "para restabelecer a trilha; não sendo, tratar como incidente de segurança e revisar quem tem acesso a pagamentos na conta.",
      valorCents: Math.abs(m.valorCents),
      dataReferencia: m.data,
      entidadeTipo: "OmieMovimento",
      entidadeId: m.id,
      entidadeRef: m.documento ?? m.codigoLancamento,
      evidencia: {
        data: m.data.toISOString(),
        valor: m.valorCents,
        historico: m.observacao,
        parceiro: m.parceiroNome,
        conta: m.contaCorrenteCodigo,
      },
      chave: chaveAchado("CB-SAIDA-SEM-TITULO", m.codigoLancamento),
    }));
}

// CB-BAIXA-SEM-MOVIMENTO — o inverso: o titulo consta como pago, mas nao ha
// dinheiro saindo do extrato. Ou a baixa foi lancada sem pagamento real
// (maquiando o contas a pagar), ou o extrato nao foi importado.
function baixaSemMovimento(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const inicio = inicioDoMes(new Date(ctx.dataReferencia.getFullYear(), ctx.dataReferencia.getMonth() - 1, 1));
  // A janela para de dois dias antes da data de referencia: uma baixa de
  // ontem pode legitimamente ainda nao ter extrato importado, e apontar isso
  // seria alarme falso diario.
  const limite = somarDias(ctx.dataReferencia, -2);
  const baixas = ctx.baixas.filter((b) => b.dataBaixa >= inicio && b.dataBaixa <= limite);
  const movimentos = ctx.movimentos;

  // Primeiro pelo código do lançamento na conta corrente (nIdLancCC da baixa
  // = nCodLancamento da linha do extrato): é o casamento exato. Só quem não
  // tem o código cai no casamento por valor e data.
  const codigosNoExtrato = new Set(movimentos.map((m) => m.codigoLancamento));
  const semMovimento = baixas.filter(
    (b) =>
      Math.abs(b.valorCents) >= materialidade &&
      !(b.lancamentoCCCodigo && codigosNoExtrato.has(b.lancamentoCCCodigo)) &&
      !movimentos.some(
        (m) =>
          Math.abs(Math.abs(m.valorCents) - Math.abs(b.valorCents)) <= TOLERANCIA_CENTAVOS &&
          Math.abs(diasEntre(m.data, b.dataBaixa)) <= JANELA_CASAMENTO_DIAS
      )
  );

  if (semMovimento.length === 0) return [];

  const valor = somar(semMovimento, (b) => Math.abs(b.valorCents));
  return [
    {
      regra: "CB-BAIXA-SEM-MOVIMENTO",
      tipo: "ESTADO",
      severidade: severidadePorValor(valor, materialidade),
      categoria: "ERRO_PROCESSO",
      titulo: `${semMovimento.length} baixas sem movimento bancário correspondente`,
      descricao:
        `${fmtBRL(valor)} em títulos aparecem como pagos/recebidos, mas não há lançamento equivalente no extrato ` +
        `(mesma faixa de valor, até ${JANELA_CASAMENTO_DIAS} dias de diferença). Ou o extrato dessas contas não foi importado, ` +
        `ou existem baixas lançadas sem pagamento real.`,
      recomendacao:
        "Primeiro confirmar se todas as contas correntes ativas estão sendo importadas. Persistindo a diferença, " +
        "auditar as baixas listadas uma a uma — baixa sem dinheiro é a forma mais simples de esconder um título não pago.",
      valorCents: valor,
      dataReferencia: ctx.dataReferencia,
      evidencia: {
        baixas: semMovimento.slice(0, 50).map((b) => ({
          chave: b.chave,
          data: b.dataBaixa.toISOString(),
          valor: b.valorCents,
        })),
        quantidade: semMovimento.length,
      },
      chave: chaveAchado("CB-BAIXA-SEM-MOVIMENTO", chaveMes(ctx.dataReferencia)),
    },
  ];
}

// CB-DEBITO-DUPLICADO — mesmo valor, mesma conta, mesmo dia, mais de uma vez.
// Cobra dupla de fornecedor, boleto pago duas vezes, ou debito automatico que
// rodou em duplicidade — todos recuperaveis, se alguem perceber a tempo.
function debitosDuplicados(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const movimentos = movimentosDoPeriodo(ctx).filter((m) => m.valorCents < 0);
  const grupos = agrupar(movimentos, (m) =>
    [m.contaCorrenteCodigo, m.data.toISOString().slice(0, 10), m.valorCents].join("|")
  );

  const achados: AchadoNovo[] = [];
  for (const [, grupo] of grupos) {
    if (grupo.length < 2) continue;
    const valor = Math.abs(grupo[0].valorCents);
    if (valor < materialidade / 2) continue;
    const excedente = valor * (grupo.length - 1);

    achados.push({
      regra: "CB-DEBITO-DUPLICADO",
      tipo: "ESTADO",
      severidade: severidadePorValor(excedente, materialidade),
      categoria: "PERDA_FINANCEIRA",
      titulo: `${grupo.length} débitos idênticos de ${fmtBRL(valor)} no mesmo dia`,
      descricao:
        `A conta registra ${grupo.length} saídas de exatamente ${fmtBRL(valor)} em ${fmtData(grupo[0].data)}` +
        `${grupo[0].parceiroNome ? ` (${grupo[0].parceiroNome})` : ""}. Pode ser pagamento em duplicidade — ` +
        `exposição de ${fmtBRL(excedente)}.`,
      recomendacao:
        "Conferir os comprovantes. Confirmada a duplicidade, pedir estorno ao banco (em até 90 dias costuma haver reversão) " +
        "ou compensação com o fornecedor.",
      valorCents: excedente,
      impactoCents: excedente,
      dataReferencia: grupo[0].data,
      entidadeTipo: "OmieMovimento",
      entidadeId: grupo[0].id,
      evidencia: { lancamentos: grupo.map((m) => m.codigoLancamento), valorUnitario: valor, data: grupo[0].data.toISOString() },
      chave: chaveAchado("CB-DEBITO-DUPLICADO", ...grupo.map((m) => m.codigoLancamento).sort()),
    });
  }
  return achados;
}

// CB-SEM-CATEGORIA — movimento bancario sem classificacao. Mesmo raciocinio
// do titulo sem categoria: e dinheiro que anda sem aparecer em lugar nenhum
// da analise gerencial.
function movimentoSemCategoria(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const movimentos = movimentosDoPeriodo(ctx);
  const semCategoria = movimentos.filter((m) => !m.categoriaCodigo);
  if (semCategoria.length === 0 || movimentos.length === 0) return [];

  const valor = somar(semCategoria, (m) => Math.abs(m.valorCents));
  const percentual = (semCategoria.length / movimentos.length) * 100;
  if (percentual < 15 && valor < materialidade) return [];

  return [
    {
      regra: "CB-SEM-CATEGORIA",
      tipo: "ESTADO",
      severidade: severidadePorValor(valor, materialidade),
      categoria: "ERRO_PROCESSO",
      titulo: `${fmtPercent(percentual)} dos movimentos bancários sem categoria`,
      descricao:
        `${semCategoria.length} de ${movimentos.length} lançamentos do período (${fmtBRL(valor)}) não têm categoria. ` +
        `Esse dinheiro entra e sai sem aparecer em nenhuma análise por natureza de receita ou despesa.`,
      recomendacao:
        "Categorizar os lançamentos e configurar regras de classificação automática na Omie para os recorrentes " +
        "(tarifas, combustível, folha) — a maior parte do volume costuma ser resolvida por meia dúzia de regras.",
      valorCents: valor,
      dataReferencia: ctx.dataReferencia,
      evidencia: { semCategoria: semCategoria.length, quantidade: movimentos.length, valor },
      chave: chaveAchado("CB-SEM-CATEGORIA", chaveMes(ctx.dataReferencia)),
    },
  ];
}

// CB-SALDO-MINIMO — saldo projetado abaixo do colchao definido pela empresa.
// Depende de ControladoriaConfig.saldoMinimoCaixaCents: sem esse parametro, o
// sistema nao inventa um numero — apenas nao avalia.
function saldoAbaixoDoMinimo(ctx: ContextoAuditoria): AchadoNovo[] {
  const minimo = ctx.config.saldoMinimoCaixaCents;
  if (minimo === null) return [];

  const saldo = saldoAtualCents(ctx);
  if (saldo >= minimo) return [];

  return [
    {
      regra: "CB-SALDO-MINIMO",
      tipo: "ESTADO",
      severidade: saldo < 0 ? "CRITICA" : "ALTA",
      categoria: "RISCO_FINANCEIRO",
      titulo: `Saldo em caixa (${fmtBRL(saldo)}) abaixo do mínimo definido`,
      descricao:
        `A soma dos saldos das contas correntes é ${fmtBRL(saldo)}, abaixo do mínimo de segurança de ${fmtBRL(minimo)} ` +
        `definido no modelo de gestão. Nessa faixa, qualquer atraso de recebimento vira juros de conta garantida.`,
      recomendacao:
        "Antecipar cobrança dos títulos vencidos de maior valor e renegociar os vencimentos da semana. " +
        "Antes de contratar capital de giro, comparar o custo dele com o desconto de antecipação de recebíveis.",
      valorCents: saldo,
      dataReferencia: ctx.dataReferencia,
      evidencia: { saldo, minimo },
      chave: chaveAchado("CB-SALDO-MINIMO", ctx.dataReferencia.toISOString().slice(0, 10)),
    },
  ];
}

// Saldo atual = saldo inicial cadastrado de cada conta + soma dos movimentos
// espelhados. Aproximacao explicita: so e exato se o extrato foi importado
// desde a data do saldo inicial. A tela de sincronizacao mostra essa
// limitacao junto do numero, em vez de apresenta-lo como verdade absoluta.
export function saldoAtualCents(ctx: ContextoAuditoria): number {
  const inicial = somar(
    ctx.contasCorrentes.filter((c) => !c.inativa),
    (c) => c.saldoInicialCents
  );
  const movimentado = somar(
    ctx.movimentos.filter((m) => m.data <= ctx.dataReferencia),
    (m) => m.valorCents
  );
  return inicial + movimentado;
}

// CB-TRANSFERENCIA-INTERGRUPO — dinheiro que passou de uma empresa para a outra
//
// Um débito na conta da Azul e um crédito de mesmo valor na conta da MCZ
// (ou vice-versa), no mesmo dia ou no seguinte, sem título de nenhum dos
// dois lados. Mútuo, aporte, folha paga pela matriz — legítimo quase
// sempre, e por isso INFO. Mas é dinheiro que muda de CNPJ sem documento:
// precisa de contrato de mútuo ou de nota, senão vira problema fiscal e
// esconde qualquer coisa no meio. As duas regras de "sem título" já excluem
// esse par para não apontar em dobro; esta é a lista dele. Um por mês.
function transferenciaEntreEmpresas(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const movimentos = movimentosDoPeriodo(ctx).filter((m) => !m.tituloCodigo);
  const creditos = movimentos.filter((m) => m.valorCents > 0);
  const debitos = movimentos.filter((m) => m.valorCents < 0);
  const usados = new Set<string>();
  const pares: { data: Date; de: string; para: string; valor: number }[] = [];
  for (const c of creditos) {
    const d = debitos.find(
      (x) =>
        !usados.has(x.id) &&
        x.conexaoId !== c.conexaoId &&
        Math.abs(Math.abs(x.valorCents) - c.valorCents) <= TOLERANCIA_CENTAVOS &&
        Math.abs(diasEntre(x.data, c.data)) <= 1
    );
    if (!d) continue;
    usados.add(d.id);
    pares.push({ data: c.data, de: d.conexaoApelido, para: c.conexaoApelido, valor: c.valorCents });
  }
  if (pares.length === 0) return [];
  const achados: AchadoNovo[] = [];
  for (const [mes, lista] of agrupar(pares, (p) => chaveMes(p.data))) {
    const valor = somar(lista, (p) => p.valor);
    if (valor < materialidade) continue;
    achados.push({
      regra: "CB-TRANSFERENCIA-INTERGRUPO",
      tipo: "EVENTO",
      severidade: "INFO",
      categoria: "RISCO_FINANCEIRO",
      titulo: `${lista.length} transferência(s) entre empresas do grupo sem título em ${mes}: ${fmtBRL(valor)}`,
      descricao:
        `Débito numa empresa e crédito de mesmo valor na outra, sem título a pagar nem a receber de nenhum dos lados. ` +
        `Mútuo e aporte são legítimos, mas dinheiro que muda de CNPJ sem documento precisa de contrato de mútuo ou nota — ` +
        `é exigência fiscal e é o que impede a transferência de esconder outra coisa.`,
      recomendacao:
        "Registrar cada transferência com o documento que a sustenta (contrato de mútuo, aporte, rateio de folha) e lançar " +
        "os títulos correspondentes nas duas empresas.",
      valorCents: valor,
      dataReferencia: lista[lista.length - 1].data,
      evidencia: {
        transferencias: lista.map((p) => ({ data: p.data.toISOString().slice(0, 10), de: p.de, para: p.para, valor: p.valor })),
        soma: valor,
      },
      chave: chaveAchado("CB-TRANSFERENCIA-INTERGRUPO", mes),
    });
  }
  return achados;
}
