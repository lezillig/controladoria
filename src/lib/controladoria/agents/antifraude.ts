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
    "Procura padrões que exigem verificação: troca de conta bancária de fornecedor às vésperas do pagamento, fracionamento para burlar alçada, fornecedor com documento inválido ou igual ao de funcionário, cadastros duplicados, pagamentos em dia não útil e desvio da distribuição esperada de valores (Lei de Benford).",
  executar: auditarFraude,
};

function auditarFraude(ctx: ContextoAuditoria): AchadoNovo[] {
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

  return achados;
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
const DIAS_FORNECEDOR_NOVO = 60;

function fornecedorNovoComValorAlto(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const achados: AchadoNovo[] = [];
  const novos = ctx.parceiros.filter(
    (p) => diasEntre(p.sincronizadoEm, ctx.dataReferencia) <= DIAS_FORNECEDOR_NOVO
  );

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
      evidencia: { fornecedor: p.nome, documento: p.documento, titulos: titulos.length, valor, pessoaFisica: ehPessoaFisica(p.documento) },
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

