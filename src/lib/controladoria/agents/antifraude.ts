import { fmtBRL, fmtData, fmtDocumento, fmtPercent } from "../format";
import { diasEntre, ehDiaNaoUtil, inicioDoMes } from "../periodos";
import { documentoValido, ehPessoaFisica, normalizarRazaoSocial } from "../documento";
import type { AchadoNovo, Agente, ContextoAuditoria } from "../types";
import {
  agravar,
  agrupar,
  chaveAchado,
  chaveMes,
  chaveParceiro,
  materialidadeCents,
  nomeParceiro,
  severidadePorValor,
  somar,
  titulosAtivos,
} from "./comum";

// AGENTE ANTIFRAUDE
//
// Regra de ouro deste agente, que vale para cada linha abaixo: ele NAO acusa
// ninguem. Ele aponta PADROES que, na literatura de auditoria e na pratica de
// controles internos brasileiros, exigem verificacao — e diz exatamente qual
// verificacao fazer. A diferenca importa: um sistema que "acusa" e desligado
// na primeira vez que erra; um que aponta indicio com evidencia e caminho de
// checagem vira rotina de controle.
//
// Todo achado aqui e formulado como "verificar", nunca como "houve fraude".

// Um pagamento a fornecedor cuja conta bancaria mudou pouco antes e o vetor
// mais comum de fraude de boleto/PIX no Brasil. 45 dias cobre o ciclo tipico
// entre a alteracao e o proximo pagamento.
const DIAS_JANELA_TROCA_CONTA = 45;
// Fracionamento: pagamentos logo ABAIXO da alcada. 80% do limite e a faixa
// classica de teste em auditoria de compras.
const FAIXA_FRACIONAMENTO = 0.8;
const DIAS_JANELA_FRACIONAMENTO = 30;
// Benford so tem poder estatistico com amostra razoavel. Abaixo disso o teste
// acusa desvio em qualquer base pequena e vira ruido.
const MINIMO_AMOSTRA_BENFORD = 150;

export const agenteAntifraude: Agente = {
  id: "antifraude",
  nome: "Antifraude e integridade",
  area: "Controladoria",
  descricao:
    "Procura padrões que exigem verificação. Para quem se pagou: troca de conta bancária de fornecedor às vésperas do pagamento, fracionamento para burlar alçada, fornecedor com documento inválido ou igual ao de funcionário, cadastros duplicados, pagamentos em dia não útil e desvio da distribuição esperada de valores (Lei de Benford). Por onde o dinheiro saiu: conta excluída do resumo de caixa com movimento, pagamento por conta diferente da do título, baixa sem conta corrente, baixa em título cancelado, pagamento anterior à emissão, baixa com data no futuro e baixa repetida no mesmo título. O que sumiu do lado de receber: recebível cancelado sem substituto, desconto que engole o título e parceiro que é cliente e fornecedor ao mesmo tempo.",
  executar: auditarFraude,
};

// Exportada para o teste. O contrato de `Agente.executar` passou a admitir
// Promise por causa do agente de histórico, e testar pelo contrato obrigaria a
// tratar um `await` que aqui nunca acontece — este agente decide olhando só o
// contexto. Testar a função concreta mantém o teste síncrono e honesto.
export function auditarFraude(ctx: ContextoAuditoria): AchadoNovo[] {
  const achados: AchadoNovo[] = [];
  const materialidade = materialidadeCents(ctx);

  achados.push(...contaBancariaAlterada(ctx, materialidade));
  achados.push(...fracionamentoDeAlcada(ctx, materialidade));
  achados.push(...fornecedorQueEFuncionario(ctx, materialidade));
  achados.push(...documentoInvalido(ctx, materialidade));
  achados.push(...cadastrosDuplicados(ctx));
  achados.push(...pagamentoEmDiaNaoUtil(ctx, materialidade));
  achados.push(...fornecedorNovoComValorAlto(ctx, materialidade));
  achados.push(...desvioDeBenford(ctx));
  achados.push(...dinheiroPorContaEscondida(ctx, materialidade));
  achados.push(...baixaDesviadaDeConta(ctx, materialidade));
  achados.push(...baixaSemConta(ctx, materialidade));
  achados.push(...canceladoComBaixa(ctx, materialidade));
  achados.push(...baixaAntesDaEmissao(ctx, materialidade));
  achados.push(...baixaComDataFutura(ctx, materialidade));
  achados.push(...baixaDuplicada(ctx, materialidade));
  achados.push(...recebivelCancelado(ctx, materialidade));
  achados.push(...descontoQueEngoleOTitulo(ctx, materialidade));
  achados.push(...clienteQueTambemEFornecedor(ctx, materialidade));

  return achados;
}

// ---------------------------------------------------------------------------
// POR ONDE O DINHEIRO SAIU
//
// As regras acima olham PARA QUEM se pagou. Este bloco olha POR ONDE. Sao
// perguntas diferentes, e a segunda estava sem ninguem: o espelho guarda a
// conta corrente do titulo e a conta corrente da baixa em campos separados, e
// nada comparava os dois.
// ---------------------------------------------------------------------------

// FR-CONTA-ESCONDIDA — conta marcada na Omie para NAO entrar no resumo de
// caixa nem na projecao de fluxo, com dinheiro passando por ela.
//
// A marca tem uso legitimo — aplicacao, conta de cartao, conta de
// transferencia interna — e por isso o achado e de VERIFICACAO, nao de
// suspeita. Mas o efeito dela e objetivo: o dinheiro entra e sai sem aparecer
// no relatorio de caixa que a empresa le. Uma conta assim, com movimento
// relevante, precisa de dono e de motivo escrito.
function dinheiroPorContaEscondida(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const escondidas = ctx.contasCorrentes.filter((c) => c.naoEntraNoResumo || c.naoEntraNoFluxo);
  if (escondidas.length === 0) return [];

  const achados: AchadoNovo[] = [];
  for (const conta of escondidas) {
    const baixas = ctx.baixas.filter((b) => b.contaCorrenteCodigo === conta.codigo);
    if (baixas.length === 0) continue;

    const valor = somar(baixas, (b) => Math.abs(b.valorCents));
    if (valor < materialidade) continue;

    const fora = [
      conta.naoEntraNoResumo ? "do resumo de caixa" : null,
      conta.naoEntraNoFluxo ? "da projeção de fluxo" : null,
    ].filter(Boolean);

    achados.push({
      regra: "FR-CONTA-ESCONDIDA",
      tipo: "ESTADO",
      // Sempre um degrau acima do valor: o que pesa aqui nao e o tamanho, e o
      // fato de o dinheiro nao aparecer onde a empresa olha.
      severidade: agravar(severidadePorValor(valor, materialidade)),
      categoria: "FRAUDE",
      titulo: `Conta "${conta.descricao}" está fora ${fora.join(" e ")} e movimentou ${fmtBRL(valor)}`,
      descricao:
        `A conta ${conta.descricao}${conta.banco ? ` (banco ${conta.banco})` : ""} está marcada na Omie para não ` +
        `entrar ${fora.join(" nem ")}, e ainda assim ${baixas.length} baixa(s) passaram por ela no período, ` +
        `somando ${fmtBRL(valor)}. Na prática, esse dinheiro entra e sai sem aparecer no relatório de caixa que a ` +
        `empresa lê.`,
      recomendacao:
        "Confirmar quem marcou a conta e por quê. Aplicação, conta de cartão e conta de transferência interna são " +
        "usos legítimos da marca — e é justamente por isso que ela precisa de motivo escrito. Sem motivo, desmarcar.",
      valorCents: valor,
      dataReferencia: ctx.dataReferencia,
      evidencia: {
        conta: conta.descricao,
        codigo: conta.codigo,
        foraDoResumo: conta.naoEntraNoResumo,
        foraDoFluxo: conta.naoEntraNoFluxo,
        baixas: baixas.length,
        valorCents: valor,
      },
      chave: chaveAchado("FR-CONTA-ESCONDIDA", conta.codigo, chaveMes(ctx.dataReferencia)),
    });
  }
  return achados;
}

// FR-BAIXA-DESVIADA — o titulo aponta uma conta corrente, e o pagamento saiu
// de outra.
//
// E o padrao mais direto de desvio que este espelho consegue enxergar: o
// lancamento foi aprovado com uma conta e liquidado por outra. Tem explicacao
// banal na maioria das vezes (troca de banco, conta sem saldo no dia) — e e
// exatamente por ser banal que ninguem confere, o que faz dele um bom lugar
// para esconder um pagamento.
function baixaDesviadaDeConta(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const porId = new Map(ctx.titulos.map((t) => [t.id, t]));
  const nomeDaConta = new Map(ctx.contasCorrentes.map((c) => [c.codigo, c.descricao]));

  const desviadas = ctx.baixas.filter((b) => {
    const t = porId.get(b.tituloId);
    if (!t || t.cancelado) return false;
    // So conta como desvio quando os DOIS lados informam conta e elas diferem.
    // Ausencia de um dos lados e outro achado (FR-BAIXA-SEM-CONTA) — misturar
    // os dois faria a lista crescer sem que nenhuma das duas ficasse clara.
    if (!t.contaCorrenteCodigo || !b.contaCorrenteCodigo) return false;
    return t.contaCorrenteCodigo !== b.contaCorrenteCodigo;
  });
  if (desviadas.length === 0) return [];

  const achados: AchadoNovo[] = [];
  // Um achado por PAR de contas: trinta pagamentos que mudaram do mesmo banco
  // para o mesmo banco sao um fato so, e trinta linhas iguais afogariam o resto.
  for (const [par, grupo] of agrupar(desviadas, (b) => {
    const t = porId.get(b.tituloId);
    return `${t?.contaCorrenteCodigo ?? "?"}->${b.contaCorrenteCodigo ?? "?"}`;
  })) {
    const valor = somar(grupo, (b) => Math.abs(b.valorCents));
    if (valor < materialidade) continue;

    const [de, para] = par.split("->");
    achados.push({
      regra: "FR-BAIXA-DESVIADA",
      tipo: "ESTADO",
      severidade: severidadePorValor(valor, materialidade),
      categoria: "FRAUDE",
      titulo: `${grupo.length} pagamento(s) saíram de conta diferente da do título`,
      descricao:
        `${grupo.length} baixa(s) somando ${fmtBRL(valor)} têm no título a conta ` +
        `"${nomeDaConta.get(de) ?? de}" e foram liquidadas pela conta "${nomeDaConta.get(para) ?? para}". ` +
        `O lançamento foi aprovado com uma conta e pago por outra.`,
      recomendacao:
        "Confirmar com o financeiro se houve troca de banco no período. Se a troca for definitiva, corrigir a conta " +
        "padrão no cadastro — o desvio deixa de aparecer e volta a ser sinal quando acontecer de novo.",
      valorCents: valor,
      dataReferencia: ctx.dataReferencia,
      evidencia: {
        contaDoTitulo: nomeDaConta.get(de) ?? de,
        contaDoPagamento: nomeDaConta.get(para) ?? para,
        baixas: grupo.slice(0, 20).map((b) => ({ chave: b.chave, data: b.dataBaixa, valorCents: b.valorCents })),
        total: grupo.length,
      },
      chave: chaveAchado("FR-BAIXA-DESVIADA", par, chaveMes(ctx.dataReferencia)),
    });
  }
  return achados;
}

// FR-BAIXA-SEM-CONTA — o titulo consta como pago e nao ha conta corrente na
// baixa. Dinheiro que saiu sem origem declarada: nao da para conferir contra
// extrato nenhum, porque nao se sabe qual extrato olhar.
function baixaSemConta(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const semConta = ctx.baixas.filter((b) => !b.contaCorrenteCodigo);
  if (semConta.length === 0) return [];

  const valor = somar(semConta, (b) => Math.abs(b.valorCents));
  if (valor < materialidade && semConta.length < 5) return [];

  return [
    {
      regra: "FR-BAIXA-SEM-CONTA",
      tipo: "ESTADO",
      severidade: severidadePorValor(valor, materialidade),
      categoria: "ERRO_PROCESSO",
      titulo: `${semConta.length} baixa(s) sem conta corrente informada`,
      descricao:
        `${fmtBRL(valor)} em baixas registradas sem conta corrente. O título consta como pago, mas não há de onde ` +
        `o dinheiro saiu — e sem isso não há extrato contra o qual conferir, porque não se sabe qual extrato olhar.`,
      recomendacao:
        "Tornar a conta corrente obrigatória na baixa. Para as já lançadas, o financeiro consegue identificar pela " +
        "data e pelo valor no extrato do banco — comece pelas maiores.",
      valorCents: valor,
      dataReferencia: ctx.dataReferencia,
      evidencia: {
        total: semConta.length,
        valorCents: valor,
        baixas: semConta.slice(0, 20).map((b) => ({ chave: b.chave, data: b.dataBaixa, valorCents: b.valorCents })),
      },
      chave: chaveAchado("FR-BAIXA-SEM-CONTA", chaveMes(ctx.dataReferencia)),
    },
  ];
}

// FR-CANCELADO-COM-BAIXA — o titulo esta cancelado E tem baixa.
//
// Cancelamento e baixa sao estados que se excluem: ou a obrigacao deixou de
// existir, ou ela foi paga. As duas coisas juntas significam que se pagou algo
// que o sistema diz nao existir — ou que se cancelou algo depois de pago, que
// e como uma saida some do relatorio sem sumir do banco.
function canceladoComBaixa(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const cancelados = new Map(ctx.titulos.filter((t) => t.cancelado).map((t) => [t.id, t]));
  if (cancelados.size === 0) return [];

  const suspeitas = ctx.baixas.filter((b) => cancelados.has(b.tituloId));
  if (suspeitas.length === 0) return [];

  const valor = somar(suspeitas, (b) => Math.abs(b.valorCents));

  return [
    {
      regra: "FR-CANCELADO-COM-BAIXA",
      tipo: "ESTADO",
      // Sem corte por materialidade: um unico caso ja e uma contradicao de
      // estado, e o valor pequeno e justamente o teste que costuma vir antes
      // do grande.
      severidade: agravar(severidadePorValor(valor, materialidade)),
      categoria: "FRAUDE",
      titulo: `${suspeitas.length} baixa(s) em título cancelado — ${fmtBRL(valor)}`,
      descricao:
        `${suspeitas.length} baixa(s), somando ${fmtBRL(valor)}, estão registradas em títulos que constam como ` +
        `CANCELADOS. Cancelamento e pagamento se excluem: ou a obrigação deixou de existir, ou ela foi paga. As duas ` +
        `juntas significam pagamento de algo que o sistema diz não existir — ou cancelamento depois do pagamento, ` +
        `que é como uma saída some do relatório sem sumir do banco.`,
      recomendacao:
        "Conferir cada caso no extrato: se o dinheiro saiu, o cancelamento é indevido e precisa ser revertido. Se não " +
        "saiu, a baixa é que está errada. Nenhum dos dois se resolve deixando como está.",
      valorCents: valor,
      dataReferencia: ctx.dataReferencia,
      evidencia: {
        casos: suspeitas.slice(0, 20).map((b) => {
          const t = cancelados.get(b.tituloId);
          return {
            titulo: t?.codigoLancamento,
            parceiro: t?.parceiroNome,
            natureza: t?.natureza,
            dataBaixa: b.dataBaixa,
            valorCents: b.valorCents,
          };
        }),
        total: suspeitas.length,
      },
      chave: chaveAchado("FR-CANCELADO-COM-BAIXA", chaveMes(ctx.dataReferencia)),
    },
  ];
}

// FR-BAIXA-ANTECIPADA — pagamento com data ANTERIOR a emissao do titulo.
//
// Impossivel na ordem natural dos fatos: paga-se o que ja existe. Quando
// aparece, ou a data foi digitada errada, ou o titulo foi criado depois para
// justificar uma saida que ja tinha acontecido — e a segunda hipotese e a
// razao de esta regra existir.
function baixaAntesDaEmissao(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const porId = new Map(ctx.titulos.map((t) => [t.id, t]));

  const invertidas = ctx.baixas.filter((b) => {
    const t = porId.get(b.tituloId);
    if (!t || t.cancelado || !t.dataEmissao) return false;
    // Um dia de folga: baixa e emissao no mesmo dia, com horas diferentes,
    // aparecem invertidas por arredondamento de fuso e nao sao anomalia.
    // `diasEntre(a, b)` devolve b − a. O que se quer aqui é quanto a BAIXA
    // antecede a EMISSÃO, então a baixa vem primeiro. Invertido, a regra
    // apontava pagamento em atraso — o oposto exato do que ela procura, e
    // silenciosamente, porque atraso é comum e o achado pareceria plausível.
    return diasEntre(b.dataBaixa, t.dataEmissao) > 1;
  });
  if (invertidas.length === 0) return [];

  const valor = somar(invertidas, (b) => Math.abs(b.valorCents));

  return [
    {
      regra: "FR-BAIXA-ANTECIPADA",
      tipo: "ESTADO",
      severidade: agravar(severidadePorValor(valor, materialidade)),
      categoria: "FRAUDE",
      titulo: `${invertidas.length} pagamento(s) com data anterior à emissão do título`,
      descricao:
        `${invertidas.length} baixa(s), somando ${fmtBRL(valor)}, têm data de pagamento ANTERIOR à data de emissão ` +
        `do título que elas liquidam. Paga-se o que já existe: ou a data foi digitada errada, ou o título foi criado ` +
        `depois para justificar uma saída que já tinha acontecido.`,
      recomendacao:
        "Conferir cada caso contra o extrato do banco. A data do banco é a que não se digita — é ela que decide qual " +
        "das duas hipóteses é a verdadeira.",
      valorCents: valor,
      dataReferencia: ctx.dataReferencia,
      evidencia: {
        casos: invertidas.slice(0, 20).map((b) => {
          const t = porId.get(b.tituloId);
          return {
            titulo: t?.codigoLancamento,
            parceiro: t?.parceiroNome,
            emissao: t?.dataEmissao,
            dataBaixa: b.dataBaixa,
            diasDeDiferenca: t?.dataEmissao ? diasEntre(b.dataBaixa, t.dataEmissao) : null,
            valorCents: b.valorCents,
          };
        }),
        total: invertidas.length,
      },
      chave: chaveAchado("FR-BAIXA-ANTECIPADA", chaveMes(ctx.dataReferencia)),
    },
  ];
}

// FR-CONTA-ALTERADA — fornecedor teve os dados bancarios trocados e recebeu
// pagamento logo depois. Detectavel porque o sync guarda o HASH da conta e
// carimba a data quando ele muda (ver OmieParceiro.contaBancariaHash).
function contaBancariaAlterada(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const alterados = ctx.parceiros.filter(
    (p) =>
      p.contaBancariaAlteradaEm !== null &&
      diasEntre(p.contaBancariaAlteradaEm, ctx.dataReferencia) <= DIAS_JANELA_TROCA_CONTA
  );

  const achados: AchadoNovo[] = [];
  for (const p of alterados) {
    const pagamentosDepois = ctx.titulos.filter(
      (t) =>
        t.natureza === "PAGAR" &&
        t.parceiroCodigo === p.codigoOmie &&
        t.dataUltimaBaixa !== null &&
        t.dataUltimaBaixa >= p.contaBancariaAlteradaEm!
    );
    const valor = somar(pagamentosDepois, (t) => t.valorPagoCents);

    achados.push({
      regra: "FR-CONTA-ALTERADA",
      tipo: "EVENTO",
      severidade: pagamentosDepois.length > 0 ? agravar(severidadePorValor(valor, materialidade)) : "MEDIA",
      categoria: "FRAUDE",
      titulo: `Conta bancária de ${p.nome} foi alterada`,
      descricao:
        `Os dados bancários desse fornecedor mudaram em ${fmtData(p.contaBancariaAlteradaEm)}. ` +
        (pagamentosDepois.length > 0
          ? `Desde então, ${pagamentosDepois.length} pagamento(s) somando ${fmtBRL(valor)} foram feitos a ele. `
          : "Ainda não houve pagamento após a alteração. ") +
        `Troca de conta às vésperas do pagamento é o vetor mais comum de fraude de boleto/PIX — na maioria das vezes ` +
        `é legítima, e é exatamente por isso que precisa de confirmação por fora do e-mail que pediu a mudança.`,
      recomendacao:
        "Confirmar a nova conta por telefone, em número já cadastrado (nunca no contato que solicitou a alteração) " +
        "e checar se a titularidade bate com o CNPJ do fornecedor. Registrar quem confirmou e quando.",
      valorCents: valor > 0 ? valor : undefined,
      dataReferencia: p.contaBancariaAlteradaEm ?? ctx.dataReferencia,
      entidadeTipo: "OmieParceiro",
      entidadeId: p.id,
      entidadeRef: p.nome,
      evidencia: {
        fornecedor: p.nome,
        documento: p.documento,
        alteradaEm: p.contaBancariaAlteradaEm?.toISOString() ?? null,
        pagamentosApos: pagamentosDepois.length,
        valorPago: valor,
      },
      chave: chaveAchado("FR-CONTA-ALTERADA", p.codigoOmie, p.contaBancariaAlteradaEm?.toISOString().slice(0, 10)),
    });
  }
  return achados;
}

// FR-FRACIONAMENTO — varios titulos do mesmo fornecedor, cada um logo abaixo
// da alcada, somando bem acima dela no mesmo periodo. Depende de a empresa
// ter cadastrado a alcada (ControladoriaConfig.limiteAlcadaCents): sem esse
// numero, nao ha "limite a burlar" e a regra nao roda — em vez de inventar um.
function fracionamentoDeAlcada(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const alcada = ctx.config.limiteAlcadaCents;
  if (!alcada || alcada <= 0) return [];

  const inicio = new Date(ctx.dataReferencia);
  inicio.setDate(inicio.getDate() - DIAS_JANELA_FRACIONAMENTO);

  const candidatos = titulosAtivos(ctx, "PAGAR").filter(
    (t) =>
      t.dataEmissao !== null &&
      t.dataEmissao >= inicio &&
      t.valorDocumentoCents >= alcada * FAIXA_FRACIONAMENTO &&
      t.valorDocumentoCents < alcada
  );

  const porFornecedor = agrupar(candidatos, (t) => chaveParceiro(t));
  const achados: AchadoNovo[] = [];

  for (const [codigo, grupo] of porFornecedor) {
    if (grupo.length < 2) continue;
    const total = somar(grupo, (t) => t.valorDocumentoCents);
    if (total <= alcada) continue;

    achados.push({
      regra: "FR-FRACIONAMENTO",
      tipo: "ESTADO",
      severidade: agravar(severidadePorValor(total, materialidade)),
      categoria: "FRAUDE",
      titulo: `Possível fracionamento — ${nomeParceiro(ctx, grupo[0])}`,
      descricao:
        `${grupo.length} títulos desse fornecedor nos últimos ${DIAS_JANELA_FRACIONAMENTO} dias, cada um entre ` +
        `${fmtBRL(Math.round(alcada * FAIXA_FRACIONAMENTO))} e ${fmtBRL(alcada)} (logo abaixo da alçada de aprovação), ` +
        `somando ${fmtBRL(total)}. Lançados juntos, exigiriam aprovação de nível superior; separados, não exigiram.`,
      recomendacao:
        "Verificar se correspondem a serviços/compras distintos ou ao mesmo fornecimento dividido. Sendo o mesmo, " +
        "submeter à alçada correta retroativamente e ajustar a política para consolidar por fornecedor e período, não por nota.",
      valorCents: total,
      dataReferencia: ctx.dataReferencia,
      entidadeTipo: "OmieParceiro",
      entidadeRef: nomeParceiro(ctx, grupo[0]),
      evidencia: {
        fornecedor: nomeParceiro(ctx, grupo[0]),
        alcada,
        titulos: grupo.map((t) => ({ lancamento: t.codigoLancamento, valor: t.valorDocumentoCents })),
      },
      chave: chaveAchado("FR-FRACIONAMENTO", codigo, chaveMes(ctx.dataReferencia)),
    });
  }
  return achados;
}

// FR-FORNECEDOR-FUNCIONARIO — o documento do fornecedor e o CPF de alguem da
// folha. Nao e necessariamente irregular (motorista autonomo, reembolso), mas
// e conflito de interesse que precisa ser declarado e aprovado — e e o
// caminho mais curto para um pagamento a si mesmo.
function fornecedorQueEFuncionario(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const cpfsFuncionarios = new Map(
    ctx.motoristas.filter((m) => m.cpf).map((m) => [m.cpf.replace(/\D/g, ""), m])
  );

  const achados: AchadoNovo[] = [];
  for (const p of ctx.parceiros) {
    if (!p.documento) continue;
    const funcionario = cpfsFuncionarios.get(p.documento);
    if (!funcionario) continue;

    const titulos = ctx.titulos.filter((t) => t.natureza === "PAGAR" && t.parceiroCodigo === p.codigoOmie);
    const valor = somar(titulos, (t) => t.valorDocumentoCents);

    achados.push({
      regra: "FR-FORNECEDOR-FUNCIONARIO",
      tipo: "ESTADO",
      severidade: agravar(severidadePorValor(valor, materialidade)),
      categoria: "FRAUDE",
      titulo: `Fornecedor com o mesmo CPF de funcionário: ${p.nome}`,
      descricao:
        `O fornecedor "${p.nome}" (${fmtDocumento(p.documento)}) tem o mesmo CPF do funcionário cadastrado ` +
        `"${funcionario.name}"${funcionario.active ? "" : " (inativo)"}. ` +
        `${titulos.length} título(s) a pagar somando ${fmtBRL(valor)} estão vinculados a esse cadastro. ` +
        `Pode ser reembolso ou serviço autônomo legítimo — e, sendo, precisa estar declarado.`,
      recomendacao:
        "Verificar a natureza dos pagamentos e se há autorização formal para contratar pessoa da própria folha. " +
        "Havendo, registrar a declaração de conflito de interesse; não havendo, suspender novos pagamentos até a apuração. " +
        "Atenção adicional se os pagamentos forem por serviço que a empresa já remunera via folha (risco trabalhista e fiscal).",
      valorCents: valor,
      dataReferencia: ctx.dataReferencia,
      entidadeTipo: "OmieParceiro",
      entidadeId: p.id,
      entidadeRef: p.nome,
      evidencia: {
        fornecedor: p.nome,
        funcionario: funcionario.name,
        funcionarioAtivo: funcionario.active,
        titulos: titulos.length,
        valor,
      },
      chave: chaveAchado("FR-FORNECEDOR-FUNCIONARIO", p.codigoOmie),
    });
  }
  return achados;
}

// FR-DOCUMENTO-INVALIDO — CNPJ/CPF que nao passa no digito verificador, ou
// fornecedor sem documento nenhum recebendo pagamento.
function documentoInvalido(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const pagamentosPorParceiro = agrupar(
    titulosAtivos(ctx, "PAGAR").filter((t) => t.valorPagoCents > 0),
    (t) => chaveParceiro(t)
  );

  const suspeitos = ctx.parceiros.filter((p) => {
    const temPagamento = (pagamentosPorParceiro.get(p.codigoOmie)?.length ?? 0) > 0;
    if (!temPagamento) return false;
    return !documentoValido(p.documento);
  });

  if (suspeitos.length === 0) return [];

  const valorTotal = somar(suspeitos, (p) =>
    somar(pagamentosPorParceiro.get(p.codigoOmie) ?? [], (t) => t.valorPagoCents)
  );

  return [
    {
      regra: "FR-DOCUMENTO-INVALIDO",
      tipo: "ESTADO",
      severidade: agravar(severidadePorValor(valorTotal, materialidade)),
      categoria: "FRAUDE",
      titulo: `${suspeitos.length} fornecedores pagos com CNPJ/CPF ausente ou inválido`,
      descricao:
        `${fmtBRL(valorTotal)} foram pagos a fornecedores cujo documento não existe no cadastro ou não passa na validação ` +
        `do dígito verificador. Sem documento válido não há como emitir informe, reter tributo corretamente, nem sequer ` +
        `provar a quem se pagou.`,
      recomendacao:
        "Exigir e validar o documento antes de liberar novos pagamentos a esses fornecedores. " +
        "Conferir na Receita se o CNPJ está ativo e se a atividade declarada tem relação com o serviço contratado.",
      valorCents: valorTotal,
      dataReferencia: ctx.dataReferencia,
      evidencia: {
        fornecedores: suspeitos.slice(0, 50).map((p) => ({
          nome: p.nome,
          documento: p.documento,
          pago: somar(pagamentosPorParceiro.get(p.codigoOmie) ?? [], (t) => t.valorPagoCents),
        })),
        total: suspeitos.length,
      },
      chave: chaveAchado("FR-DOCUMENTO-INVALIDO", "atual"),
    },
  ];
}

// FR-CADASTRO-DUPLICADO — o mesmo fornecedor cadastrado duas vezes. Alem de
// sujar o relatorio (o gasto com ele aparece dividido, e some do ranking de
// concentracao), e o terreno perfeito para pagar a mesma nota duas vezes.
function cadastrosDuplicados(ctx: ContextoAuditoria): AchadoNovo[] {
  const achados: AchadoNovo[] = [];

  const porDocumento = agrupar(
    ctx.parceiros.filter((p) => p.documento),
    (p) => p.documento!
  );
  for (const [documento, grupo] of porDocumento) {
    if (grupo.length < 2) continue;
    achados.push({
      regra: "FR-CADASTRO-DUPLICADO",
      tipo: "ESTADO",
      severidade: "MEDIA",
      categoria: "ERRO_PROCESSO",
      titulo: `${grupo.length} cadastros com o mesmo documento ${fmtDocumento(documento)}`,
      descricao:
        `Os cadastros "${grupo.map((p) => p.nome).join('", "')}" compartilham o mesmo CNPJ/CPF. ` +
        `Além de dividir o histórico de compras do fornecedor, cadastro duplicado permite que a mesma nota seja ` +
        `lançada e paga duas vezes sem que o sistema perceba.`,
      recomendacao:
        "Unificar os cadastros na Omie, mantendo o mais completo e inativando os demais após transferir os títulos em aberto.",
      dataReferencia: ctx.dataReferencia,
      entidadeTipo: "OmieParceiro",
      entidadeId: grupo[0].id,
      entidadeRef: grupo[0].nome,
      evidencia: { documento, cadastros: grupo.map((p) => ({ codigo: p.codigoOmie, nome: p.nome })) },
      chave: chaveAchado("FR-CADASTRO-DUPLICADO", documento),
    });
  }

  // Nomes praticamente iguais sem documento em comum: mesma consequencia,
  // mas indicio mais fraco — severidade menor e verificacao antes de agir.
  const porNome = agrupar(ctx.parceiros, (p) => normalizarRazaoSocial(p.nome));
  for (const [nomeNormalizado, grupo] of porNome) {
    if (grupo.length < 2 || nomeNormalizado.length < 6) continue;
    const documentos = new Set(grupo.map((p) => p.documento).filter(Boolean));
    if (documentos.size <= 1) continue; // ja coberto pela regra acima

    achados.push({
      regra: "FR-CADASTRO-NOME-SIMILAR",
      tipo: "ESTADO",
      severidade: "BAIXA",
      categoria: "ERRO_PROCESSO",
      titulo: `Cadastros com nome muito parecido: ${grupo[0].nome}`,
      descricao:
        `Os cadastros "${grupo.map((p) => p.nome).join('", "')}" têm praticamente o mesmo nome, mas documentos diferentes. ` +
        `Pode ser matriz e filial (legítimo) ou duplicidade com documento digitado errado.`,
      recomendacao: "Conferir os documentos na Receita e unificar se for o mesmo fornecedor.",
      dataReferencia: ctx.dataReferencia,
      entidadeTipo: "OmieParceiro",
      entidadeId: grupo[0].id,
      entidadeRef: grupo[0].nome,
      evidencia: { cadastros: grupo.map((p) => ({ codigo: p.codigoOmie, nome: p.nome, documento: p.documento })) },
      chave: chaveAchado("FR-CADASTRO-NOME-SIMILAR", nomeNormalizado),
    });
  }

  return achados;
}

// FR-PAGAMENTO-NAO-UTIL — pagamento efetivado em sabado, domingo ou feriado.
// Transferencia bancaria em dia nao util e possivel (PIX), mas pagamento de
// fornecedor fora do expediente foge do fluxo normal de aprovacao — vale
// conferir quem executou.
function pagamentoEmDiaNaoUtil(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const inicio = inicioDoMes(new Date(ctx.dataReferencia.getFullYear(), ctx.dataReferencia.getMonth() - 1, 1));
  const suspeitos = ctx.baixas.filter(
    (b) => b.dataBaixa >= inicio && ehDiaNaoUtil(b.dataBaixa) && Math.abs(b.valorCents) >= materialidade
  );
  if (suspeitos.length === 0) return [];

  const valor = somar(suspeitos, (b) => Math.abs(b.valorCents));
  return [
    {
      regra: "FR-PAGAMENTO-NAO-UTIL",
      tipo: "ESTADO",
      severidade: severidadePorValor(valor, materialidade),
      categoria: "FRAUDE",
      titulo: `${suspeitos.length} pagamentos relevantes em dia não útil`,
      descricao:
        `${fmtBRL(valor)} foram baixados em fins de semana ou feriados nos últimos dois meses. ` +
        `Pagamento fora do expediente escapa do fluxo normal de conferência e aprovação — costuma ser agendamento legítimo, ` +
        `mas é o horário preferido de quem quer que ninguém veja.`,
      recomendacao:
        "Conferir se foram agendamentos feitos em dia útil (legítimo) ou execuções manuais fora do expediente. " +
        "No segundo caso, identificar o operador e revisar as permissões de pagamento no banco e na Omie.",
      valorCents: valor,
      dataReferencia: ctx.dataReferencia,
      evidencia: {
        baixas: suspeitos.slice(0, 30).map((b) => ({ data: b.dataBaixa.toISOString(), valor: b.valorCents })),
        total: suspeitos.length,
      },
      chave: chaveAchado("FR-PAGAMENTO-NAO-UTIL", chaveMes(ctx.dataReferencia)),
    },
  ];
}

// FR-FORNECEDOR-NOVO-ALTO — cadastro recente que ja recebe valor relevante.
// Empresa de fachada tipicamente aparece assim: cadastro novo, poucas notas,
// valores altos, sem historico.
//
// ESTA REGRA ESTAVA SEM EFEITO, e o defeito era de uma palavra: ela lia
// `sincronizadoEm`, que e reescrito a CADA sincronizacao. Todo fornecedor
// parecia cadastrado hoje, entao "novo" nao filtrava nada — na pratica a regra
// virou "fornecedor com volume alto", que nao e o que ela se propoe a achar, e
// ainda dava a impressao de que a checagem de empresa de fachada estava
// rodando.
//
// A data certa e `dataCadastroOmie` (o `info.dInc` da propria Omie). Quando a
// conta nao devolve aquele bloco, vale `primeiraVezEm` — quando o espelho viu a
// linha pela primeira vez —, que nao e o cadastro real mas responde "apareceu
// agora?" para tudo daqui em diante.
//
// SEM NENHUMA DAS DUAS, A REGRA SE CALA. Sao as linhas que ja existiam antes
// destas colunas: nao ha resposta, e tratar ausencia de data como "novo" faria
// a base inteira disparar de uma vez — exatamente o defeito que se esta
// corrigindo, invertido.
const DIAS_FORNECEDOR_NOVO = 60;

function desdeQuandoExiste(p: {
  dataCadastroOmie: Date | null;
  primeiraVezEm: Date | null;
}): Date | null {
  return p.dataCadastroOmie ?? p.primeiraVezEm ?? null;
}

function fornecedorNovoComValorAlto(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const achados: AchadoNovo[] = [];
  const novos = ctx.parceiros.filter((p) => {
    const desde = desdeQuandoExiste(p);
    return desde !== null && diasEntre(desde, ctx.dataReferencia) <= DIAS_FORNECEDOR_NOVO;
  });

  for (const p of novos) {
    const titulos = ctx.titulos.filter((t) => t.natureza === "PAGAR" && t.parceiroCodigo === p.codigoOmie);
    if (titulos.length === 0) continue;
    const valor = somar(titulos, (t) => t.valorDocumentoCents);
    if (valor < materialidade * 3) continue;

    achados.push({
      regra: "FR-FORNECEDOR-NOVO-ALTO",
      tipo: "ESTADO",
      severidade: severidadePorValor(valor, materialidade),
      categoria: "FRAUDE",
      titulo: `Fornecedor recente com volume alto: ${p.nome}`,
      descricao:
        `${p.nome} apareceu na base há pouco tempo e já acumula ${fmtBRL(valor)} em ${titulos.length} título(s). ` +
        `Volume relevante sem histórico é o perfil típico tanto de um fornecedor novo legítimo quanto de um cadastro criado ` +
        `para receber pagamento indevido — a diferença está na documentação.`,
      recomendacao:
        "Confirmar a existência real do fornecedor: situação do CNPJ na Receita, endereço, contrato assinado e " +
        "quem o indicou. Para valores dessa ordem, exigir também comprovação de capacidade técnica do serviço contratado.",
      valorCents: valor,
      dataReferencia: ctx.dataReferencia,
      entidadeTipo: "OmieParceiro",
      entidadeId: p.id,
      entidadeRef: p.nome,
      evidencia: {
        fornecedor: p.nome,
        documento: p.documento,
        titulos: titulos.length,
        valor,
        pessoaFisica: ehPessoaFisica(p.documento),
        cadastradoEm: desdeQuandoExiste(p)?.toISOString() ?? null,
        // Qual das duas datas sustentou o achado. "Primeira vez no espelho" e
        // um limite inferior, nao o cadastro de verdade — quem for conferir na
        // Omie precisa saber disso antes de cobrar alguem.
        origemDaData: p.dataCadastroOmie ? "cadastro na Omie" : "primeira vez no espelho",
      },
      chave: chaveAchado("FR-FORNECEDOR-NOVO-ALTO", p.codigoOmie),
    });
  }
  return achados;
}

// FR-BENFORD — Lei de Benford (Newcomb-Benford) aplicada ao primeiro digito
// dos valores pagos. Em conjuntos financeiros naturais, o digito 1 aparece em
// ~30,1% dos valores, o 2 em ~17,6%, e assim por diante decrescendo. Valores
// inventados por pessoas nao seguem essa curva — e por isso o teste e padrao
// em auditoria forense desde os anos 1990.
//
// Importante: desvio de Benford NAO e prova de nada. E um sinal de onde
// olhar. O achado diz isso explicitamente, e a recomendacao aponta a
// verificacao concreta.
const PROPORCOES_BENFORD = [0.301, 0.176, 0.125, 0.097, 0.079, 0.067, 0.058, 0.051, 0.046];

export function testeBenford(valoresCents: number[]): {
  amostra: number;
  desvioMaximo: number;
  digitoSuspeito: number | null;
  distribuicao: { digito: number; esperado: number; observado: number }[];
} {
  const digitos = valoresCents
    .map((v) => Math.abs(v))
    .filter((v) => v >= 1000) // abaixo de R$ 10 o primeiro digito perde sentido economico
    .map((v) => Number(String(v)[0]))
    .filter((d) => d >= 1 && d <= 9);

  const total = digitos.length;
  const distribuicao = PROPORCOES_BENFORD.map((esperado, i) => {
    const digito = i + 1;
    const observado = total > 0 ? digitos.filter((d) => d === digito).length / total : 0;
    return { digito, esperado: esperado * 100, observado: observado * 100 };
  });

  let desvioMaximo = 0;
  let digitoSuspeito: number | null = null;
  for (const linha of distribuicao) {
    const desvio = linha.observado - linha.esperado;
    if (Math.abs(desvio) > Math.abs(desvioMaximo)) {
      desvioMaximo = desvio;
      digitoSuspeito = linha.digito;
    }
  }

  return { amostra: total, desvioMaximo, digitoSuspeito, distribuicao };
}

// Acima de 8 pontos percentuais de desvio num digito, com amostra suficiente,
// e o ponto em que a literatura de auditoria forense sugere investigar.
const DESVIO_BENFORD_RELEVANTE = 8;

function desvioDeBenford(ctx: ContextoAuditoria): AchadoNovo[] {
  const pagamentos = titulosAtivos(ctx, "PAGAR")
    .filter((t) => t.valorPagoCents > 0)
    .map((t) => t.valorPagoCents);

  const resultado = testeBenford(pagamentos);
  if (resultado.amostra < MINIMO_AMOSTRA_BENFORD) return [];
  if (Math.abs(resultado.desvioMaximo) < DESVIO_BENFORD_RELEVANTE) return [];

  const digito = resultado.digitoSuspeito!;
  const linha = resultado.distribuicao.find((d) => d.digito === digito)!;

  return [
    {
      regra: "FR-BENFORD",
      tipo: "ESTADO",
      severidade: "MEDIA",
      categoria: "FRAUDE",
      titulo: `Distribuição de valores foge do padrão esperado (dígito ${digito})`,
      descricao:
        `Entre ${resultado.amostra} pagamentos analisados, ${fmtPercent(linha.observado)} começam com o dígito ${digito}, ` +
        `contra ${fmtPercent(linha.esperado)} esperados pela Lei de Benford — desvio de ${fmtPercent(
          Math.abs(resultado.desvioMaximo)
        )}. Valores gerados naturalmente seguem essa curva; valores escolhidos por pessoas, não. ` +
        `Isso não prova irregularidade: pode refletir contratos de valor fixo, parcelas iguais ou concentração em um fornecedor.`,
      recomendacao:
        `Listar os pagamentos que começam com ${digito} e verificar se há concentração em um fornecedor, um aprovador ` +
        `ou uma faixa de valor logo abaixo de alguma alçada. Se a explicação for contrato de valor fixo, documentar e ignorar o alerta.`,
      dataReferencia: ctx.dataReferencia,
      evidencia: { amostra: resultado.amostra, distribuicao: resultado.distribuicao, digitoSuspeito: digito },
      chave: chaveAchado("FR-BENFORD", chaveMes(ctx.dataReferencia)),
    },
  ];
}

// ---------------------------------------------------------------------------
// O QUE SUMIU DO LADO DE RECEBER
//
// As regras de contas a receber olham CREDITO: quem esta atrasado, quem deve
// virar perda, quem paga a menos. Todas partem do principio de que o titulo
// existe e continua existindo. Este bloco olha o contrario — o titulo que
// deixou de existir, o desconto que o engoliu, o recebimento que foi
// registrado antes de acontecer.
//
// Uma regra que eu ia escrever aqui NAO entrou: "mesmo cliente, mesmo valor,
// mesma data, dois titulos". Esta base tem dois CT-e de R$ 52.000,00 emitidos
// no mesmo dia para o mesmo tomador, e sao os dois legitimos — a regra
// acusaria duplicidade toda vez que a operacao fizesse dois fretes iguais.
// Fica registrado para nao ser reinventada.
// ---------------------------------------------------------------------------

// FR-BAIXA-FUTURA — baixa com data POSTERIOR a hoje.
//
// O espelho de uma baixa e um fato consumado: o dinheiro entrou ou saiu. Data
// no futuro nao e previsao — previsao tem campo proprio (dDtPrevisao). Do lado
// de receber, infla o resultado do mes com dinheiro que ainda nao chegou; do
// lado de pagar, esvazia o caixa que ainda esta la.
function baixaComDataFutura(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const futuras = ctx.baixas.filter((b) => diasEntre(ctx.agora, b.dataBaixa) > 0);
  if (futuras.length === 0) return [];

  const porId = new Map(ctx.titulos.map((t) => [t.id, t]));
  const valor = somar(futuras, (b) => Math.abs(b.valorCents));

  return [
    {
      regra: "FR-BAIXA-FUTURA",
      tipo: "ESTADO",
      severidade: agravar(severidadePorValor(valor, materialidade)),
      categoria: "FRAUDE",
      titulo: `${futuras.length} baixa(s) com data no futuro — ${fmtBRL(valor)}`,
      descricao:
        `${futuras.length} baixa(s), somando ${fmtBRL(valor)}, estão registradas com data POSTERIOR a hoje. Baixa é ` +
        `fato consumado: o dinheiro entrou ou saiu. Previsão tem campo próprio na Omie. Do lado de receber, isso ` +
        `infla o resultado do mês com dinheiro que ainda não chegou; do lado de pagar, esvazia um caixa que ainda ` +
        `está lá.`,
      recomendacao:
        "Conferir se foi erro de digitação de data ou baixa antecipada de propósito. Baixa antecipada de propósito " +
        "muda o resultado do mês e precisa de autorização — não de correção silenciosa.",
      valorCents: valor,
      dataReferencia: ctx.dataReferencia,
      evidencia: {
        casos: futuras.slice(0, 20).map((b) => {
          const t = porId.get(b.tituloId);
          return {
            titulo: t?.codigoLancamento,
            parceiro: t?.parceiroNome,
            natureza: t?.natureza,
            dataBaixa: b.dataBaixa,
            diasNoFuturo: diasEntre(ctx.agora, b.dataBaixa),
            valorCents: b.valorCents,
          };
        }),
        total: futuras.length,
      },
      chave: chaveAchado("FR-BAIXA-FUTURA", chaveMes(ctx.dataReferencia)),
    },
  ];
}

// FR-BAIXA-DUPLICADA — o MESMO titulo baixado duas vezes, mesmo dia, mesmo
// valor.
//
// Diferente de CP-DUPLICIDADE, que olha titulos repetidos: aqui o titulo e um
// so e a baixa e que veio dobrada. Do lado de pagar, e pagamento em dobro — o
// fornecedor recebeu duas vezes e raramente avisa. Do lado de receber, e
// credito dado duas vezes ao cliente pelo mesmo dinheiro.
//
// A Omie ja impede baixa identica (chave unica), entao o que sobra aqui sao
// baixas DISTINTAS que coincidem em titulo, dia e valor — que e exatamente o
// formato do pagamento em duplicidade.
function baixaDuplicada(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const porId = new Map(ctx.titulos.map((t) => [t.id, t]));

  const suspeitas: typeof ctx.baixas = [];
  for (const [, grupo] of agrupar(
    ctx.baixas,
    (b) => `${b.tituloId}|${b.dataBaixa.toISOString().slice(0, 10)}|${b.valorCents}`
  )) {
    // A partir da SEGUNDA: a primeira baixa e a legitima, e conta-la como
    // perda dobraria o valor do achado.
    if (grupo.length > 1) suspeitas.push(...grupo.slice(1));
  }
  if (suspeitas.length === 0) return [];

  const valor = somar(suspeitas, (b) => Math.abs(b.valorCents));

  return [
    {
      regra: "FR-BAIXA-DUPLICADA",
      tipo: "ESTADO",
      severidade: agravar(severidadePorValor(valor, materialidade)),
      categoria: "FRAUDE",
      titulo: `${suspeitas.length} baixa(s) repetidas no mesmo título, dia e valor — ${fmtBRL(valor)}`,
      descricao:
        `${suspeitas.length} baixa(s) além da primeira, somando ${fmtBRL(valor)}, repetem título, data e valor. Do ` +
        `lado de pagar isso é pagamento em dobro — o fornecedor recebeu duas vezes e raramente avisa. Do lado de ` +
        `receber, é crédito dado duas vezes ao cliente pelo mesmo dinheiro.`,
      recomendacao:
        "Conferir no extrato se saíram (ou entraram) dois valores. Havendo dobra real, pedir devolução ao fornecedor " +
        "ou reabrir a cobrança do cliente; sendo lançamento duplicado, estornar a segunda baixa na Omie.",
      valorCents: valor,
      impactoCents: valor,
      dataReferencia: ctx.dataReferencia,
      evidencia: {
        casos: suspeitas.slice(0, 20).map((b) => {
          const t = porId.get(b.tituloId);
          return {
            titulo: t?.codigoLancamento,
            parceiro: t?.parceiroNome,
            natureza: t?.natureza,
            dataBaixa: b.dataBaixa,
            valorCents: b.valorCents,
          };
        }),
        total: suspeitas.length,
      },
      chave: chaveAchado("FR-BAIXA-DUPLICADA", chaveMes(ctx.dataReferencia)),
    },
  ];
}

// FR-RECEBIVEL-CANCELADO — titulo a receber cancelado sem nunca ter sido
// recebido.
//
// Cancelar um titulo a receber e desistir de cobrar. Pode ser correto (nota
// emitida errada, servico nao prestado) — e o caso do CT-e cancelado e
// reemitido, que esta base tem as dezenas. O que faz disto um achado e o
// caminho: cancelamento nao passa por provisao de perda, nao aparece no
// resultado como baixa contabil e nao pede aprovacao de ninguem. E a forma
// mais silenciosa de uma receita desaparecer.
function recebivelCancelado(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const comBaixa = new Set(ctx.baixas.map((b) => b.tituloId));
  const cancelados = ctx.titulos.filter(
    (t) => t.natureza === "RECEBER" && t.cancelado && !comBaixa.has(t.id) && t.valorDocumentoCents > 0
  );
  if (cancelados.length === 0) return [];

  const achados: AchadoNovo[] = [];
  // Por CLIENTE: um cliente com quinze cancelamentos e um padrao; quinze
  // clientes com um cancelamento cada e rotina de emissao.
  for (const [chave, grupo] of agrupar(cancelados, (t) => chaveParceiro(t))) {
    const valor = somar(grupo, (t) => t.valorDocumentoCents);
    if (valor < materialidade) continue;

    achados.push({
      regra: "FR-RECEBIVEL-CANCELADO",
      tipo: "ESTADO",
      severidade: severidadePorValor(valor, materialidade),
      categoria: "RISCO_FINANCEIRO",
      titulo: `${fmtBRL(valor)} a receber cancelados de ${nomeParceiro(ctx, grupo[0])}`,
      descricao:
        `${grupo.length} título(s) a receber desse cliente, somando ${fmtBRL(valor)}, foram CANCELADOS sem nenhum ` +
        `recebimento. Cancelar um recebível é desistir de cobrar — e, ao contrário de uma perda provisionada, não ` +
        `passa por aprovação, não aparece no resultado como baixa contábil e não deixa rastro fora da Omie.`,
      recomendacao:
        "Conferir se cada cancelamento tem substituto: documento reemitido, nota corrigida, serviço não prestado. " +
        "Cancelamento sem substituto é receita perdida, e precisa aparecer como tal.",
      valorCents: valor,
      dataReferencia: ctx.dataReferencia,
      entidadeTipo: "OmieParceiro",
      entidadeRef: nomeParceiro(ctx, grupo[0]),
      evidencia: {
        cliente: nomeParceiro(ctx, grupo[0]),
        total: grupo.length,
        valorCents: valor,
        titulos: grupo.slice(0, 20).map((t) => ({
          codigoLancamento: t.codigoLancamento,
          numeroDocumento: t.numeroDocumento,
          emissao: t.dataEmissao ?? t.dataVencimento,
          valorCents: t.valorDocumentoCents,
        })),
      },
      chave: chaveAchado("FR-RECEBIVEL-CANCELADO", chave, chaveMes(ctx.dataReferencia)),
    });
  }
  return achados;
}

// FR-DESCONTO-TOTAL — o desconto engoliu o titulo.
//
// CR-DESCONTO ja olha o desconto como politica comercial, somado por cliente e
// medido em percentual do faturamento. Esta regra e outra coisa: um desconto
// que zera (ou quase) UM titulo nao e politica, e baixa contabil disfarcada.
// O titulo fecha como "recebido", o resultado nao registra perda nenhuma, e o
// dinheiro simplesmente nao entrou.
const PERCENTUAL_DESCONTO_QUE_ENGOLE = 90;

function descontoQueEngoleOTitulo(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const porId = new Map(ctx.titulos.map((t) => [t.id, t]));

  const engolidas = ctx.baixas.filter((b) => {
    if (b.descontoCents <= 0) return false;
    const t = porId.get(b.tituloId);
    if (!t || t.natureza !== "RECEBER" || t.cancelado) return false;
    const bruto = b.valorCents + b.descontoCents;
    return bruto > 0 && (b.descontoCents / bruto) * 100 >= PERCENTUAL_DESCONTO_QUE_ENGOLE;
  });
  if (engolidas.length === 0) return [];

  const valor = somar(engolidas, (b) => b.descontoCents);
  if (valor < materialidade) return [];

  return [
    {
      regra: "FR-DESCONTO-TOTAL",
      tipo: "ESTADO",
      severidade: agravar(severidadePorValor(valor, materialidade)),
      categoria: "PERDA_FINANCEIRA",
      titulo: `${engolidas.length} recebimento(s) com desconto de ${PERCENTUAL_DESCONTO_QUE_ENGOLE}% ou mais`,
      descricao:
        `${engolidas.length} baixa(s) de títulos a receber tiveram desconto de ao menos ` +
        `${PERCENTUAL_DESCONTO_QUE_ENGOLE}% do valor, somando ${fmtBRL(valor)} em desconto. Desconto desse tamanho ` +
        `não é política comercial: é baixa contábil disfarçada. O título fecha como recebido, o resultado não ` +
        `registra perda nenhuma, e o dinheiro não entrou.`,
      recomendacao:
        "Verificar quem autorizou cada um. Se a dívida foi mesmo perdoada, o lançamento correto é perda, não " +
        "desconto — a diferença muda o resultado, a base de imposto e o histórico de crédito do cliente.",
      valorCents: valor,
      impactoCents: valor,
      dataReferencia: ctx.dataReferencia,
      evidencia: {
        casos: engolidas.slice(0, 20).map((b) => {
          const t = porId.get(b.tituloId);
          return {
            titulo: t?.codigoLancamento,
            parceiro: t?.parceiroNome,
            dataBaixa: b.dataBaixa,
            recebidoCents: b.valorCents,
            descontoCents: b.descontoCents,
          };
        }),
        total: engolidas.length,
      },
      chave: chaveAchado("FR-DESCONTO-TOTAL", chaveMes(ctx.dataReferencia)),
    },
  ];
}

// FR-CLIENTE-FORNECEDOR — o mesmo CNPJ/CPF recebe da empresa E paga a ela.
//
// Nao e irregularidade: no transporte, subcontratar quem tambem e seu cliente
// e comum. E parte relacionada, e o que a auditoria pede de parte relacionada
// e que ela seja DECLARADA — porque e o desenho onde dinheiro circula em
// volta (paga-se mais caro de um lado, cobra-se mais barato do outro) sem que
// nenhum dos dois lados, olhado sozinho, pareca errado.
//
// Exige valor relevante NOS DOIS SENTIDOS: um fornecedor que uma vez comprou
// uma passagem nao e parte relacionada.
function clienteQueTambemEFornecedor(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const porDocumento = new Map<string, { pagar: number; receber: number; nome: string }>();

  for (const t of ctx.titulos) {
    if (t.cancelado) continue;
    const doc = t.parceiroDocumento;
    if (!doc || !documentoValido(doc)) continue;
    const atual = porDocumento.get(doc) ?? { pagar: 0, receber: 0, nome: t.parceiroNome ?? doc };
    if (t.natureza === "PAGAR") atual.pagar += t.valorDocumentoCents;
    else atual.receber += t.valorDocumentoCents;
    porDocumento.set(doc, atual);
  }

  const achados: AchadoNovo[] = [];
  for (const [doc, v] of porDocumento) {
    if (v.pagar < materialidade || v.receber < materialidade) continue;

    const total = v.pagar + v.receber;
    achados.push({
      regra: "FR-CLIENTE-FORNECEDOR",
      tipo: "ESTADO",
      severidade: severidadePorValor(Math.min(v.pagar, v.receber), materialidade),
      categoria: "RISCO_FINANCEIRO",
      titulo: `${v.nome} é cliente e fornecedor ao mesmo tempo`,
      descricao:
        `${fmtDocumento(doc)} tem ${fmtBRL(v.pagar)} em títulos a pagar e ${fmtBRL(v.receber)} a receber no período. ` +
        `Subcontratar quem também é cliente é comum no transporte — e é exatamente por ser comum que precisa estar ` +
        `declarado: é o desenho em que dinheiro circula em volta, pagando mais caro de um lado e cobrando mais ` +
        `barato do outro, sem que nenhum dos dois lados, olhado sozinho, pareça errado.`,
      recomendacao:
        "Registrar a relação como parte relacionada e conferir os preços dos dois lados contra o praticado com " +
        "terceiros. Havendo diferença nos dois sentidos ao mesmo tempo, o caso é de contrato, não de lançamento.",
      valorCents: Math.min(v.pagar, v.receber),
      dataReferencia: ctx.dataReferencia,
      entidadeTipo: "OmieParceiro",
      entidadeRef: v.nome,
      evidencia: {
        documento: fmtDocumento(doc),
        nome: v.nome,
        pagarCents: v.pagar,
        receberCents: v.receber,
        totalCents: total,
        pessoaFisica: ehPessoaFisica(doc),
      },
      chave: chaveAchado("FR-CLIENTE-FORNECEDOR", doc, chaveMes(ctx.dataReferencia)),
    });
  }
  return achados;
}
