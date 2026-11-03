import { fmtBRL, fmtData } from "../format";
import { diasEntre } from "../periodos";
import { nomeDoBanco } from "../boleto";
import type { AchadoNovo, ContextoAuditoria } from "../types";
import type { AuditSeveridade, OmieTitulo } from "@prisma/client";
import { agravar, agrupar, chaveAchado, chaveParceiro, nomeParceiro, referenciaTitulo, severidadePorValor, somar, titulosAtivos } from "./comum";

// BOLETO FRIO E BOLETO ADULTERADO — o que o código de barras denuncia.
//
// O golpe: um boleto verdadeiro (fornecedor certo, nota certa, valor certo)
// tem o código de barras trocado pelo de uma conta de quem aplica o golpe —
// por e-mail interceptado, PDF editado, "reemissão com novo banco". Quem paga
// confere fornecedor e valor, e paga. A Omie guarda o código de barras do
// título a pagar; a sincronização grava dele o banco emissor, o valor e o
// vencimento impressos, se o dígito fecha e um hash do código (nunca o código
// inteiro: ele traz agência e conta do beneficiário). Daí saem cinco sinais:
//
//   FR-BOLETO-TROCADO          o código mudou num título já lançado
//   FR-BOLETO-BANCO-NOVO       fornecedor que sempre cobrou por um banco
//                              mandou boleto de outro
//   FR-BOLETO-REPETIDO         o mesmo boleto em dois títulos
//   FR-BOLETO-VALOR-DIVERGENTE o boleto cobra outro valor que o título
//   FR-BOLETO-INVALIDO         o código não fecha o dígito verificador
//
// Nenhum prova golpe — reemissão e troca de banco de cobrança acontecem. Cada
// um diz o que confirmar, e com quem, ANTES de pagar.

// Histórico mínimo do fornecedor para "banco diferente do de sempre" valer:
// com um ou dois boletos, qualquer banco novo é só o segundo banco.
const BOLETOS_PARA_HABITO = 3;
// Diferença de valor que não é arredondamento de centavos nem de juros
// impressos: R$ 1 ou 0,5% do título, o maior.
const TOLERANCIA_CENTS = 100;
const TOLERANCIA_PCT = 0.005;

const ESCALA: AuditSeveridade[] = ["INFO", "BAIXA", "MEDIA", "ALTA", "CRITICA"];
const peloMenos = (s: AuditSeveridade, piso: AuditSeveridade): AuditSeveridade => (ESCALA.indexOf(s) < ESCALA.indexOf(piso) ? piso : s);

const banco = (codigo: string | null) => (codigo ? nomeDoBanco(codigo) : "—");

// O que o fornecedor recebe de fato: o título menos o que foi retido na fonte.
// O boleto vem pelo líquido quando há retenção — e pelo bruto quando não há.
function liquidoDoTitulo(t: OmieTitulo): number {
  return t.valorDocumentoCents - t.retencaoIrCents - t.retencaoIssCents - t.retencaoPisCents - t.retencaoCofinsCents - t.retencaoCsllCents - t.retencaoInssCents;
}

const pago = (t: OmieTitulo) => t.liquidado || t.valorPagoCents > 0;

function situacaoDoPagamento(t: OmieTitulo): string {
  return pago(t)
    ? `Já foi pago${t.dataUltimaBaixa ? ` em ${fmtData(t.dataUltimaBaixa)}` : ""} (${fmtBRL(t.valorPagoCents)}).`
    : `Ainda não foi pago (vence em ${fmtData(t.dataVencimento)}): segure o pagamento até confirmar.`;
}

const CONFIRMAR =
  "Confirmar com o fornecedor por telefone já cadastrado — nunca pelo contato do e-mail que mandou o boleto — e, no internet banking, " +
  "conferir que o beneficiário mostrado antes de pagar é o CNPJ do fornecedor. Se já foi pago, conferir o beneficiário no comprovante.";

export function auditarBoletos(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const comBoleto = titulosAtivos(ctx, "PAGAR").filter((t) => t.boletoHash !== null);
  if (comBoleto.length === 0) return [];
  return [...boletoTrocado(ctx, materialidade), ...bancoNovo(ctx, comBoleto, materialidade), ...boletoRepetido(ctx, comBoleto, materialidade), ...valorDivergente(ctx, comBoleto, materialidade), ...boletoInvalido(ctx, comBoleto)];
}

// FR-BOLETO-TROCADO — o código de barras de um título já lançado mudou entre
// duas leituras da Omie. Boleto que aparece onde não havia não conta (a nota
// chega antes do boleto): a sincronização só grava a TROCA (sync.ts).
function boletoTrocado(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const porId = new Map(titulosAtivos(ctx, "PAGAR").map((t) => [t.id, t]));
  const versoes = (ctx.versoesDeTitulo ?? []).filter((v) => v.campo === "boletoHash" || v.campo === "boletoBanco");
  const porTitulo = agrupar(versoes, (v) => v.tituloId);
  const achados: AchadoNovo[] = [];
  for (const [tituloId, lista] of porTitulo) {
    const t = porId.get(tituloId);
    if (!t) continue;
    for (const troca of lista.filter((v) => v.campo === "boletoHash")) {
      // O banco que mudou na mesma leitura (mesmo instante de gravação).
      const doBanco = lista.find((v) => v.campo === "boletoBanco" && v.vistoEm.getTime() === troca.vistoEm.getTime());
      const nome = nomeParceiro(ctx, t);
      let severidade = agravar(severidadePorValor(t.valorDocumentoCents, materialidade));
      if (doBanco) severidade = agravar(severidade);
      if (!pago(t)) severidade = peloMenos(severidade, "ALTA");
      achados.push({
        regra: "FR-BOLETO-TROCADO",
        tipo: "EVENTO",
        severidade,
        categoria: "FRAUDE",
        titulo: `Boleto trocado em ${referenciaTitulo(t)} (${nome})${doBanco ? `: ${banco(doBanco.de)} → ${banco(doBanco.para)}` : ""}`,
        descricao:
          `O código de barras deste título mudou em ${fmtData(troca.vistoEm)}` +
          (doBanco ? `, e com ele o banco que recebe: era ${banco(doBanco.de)}, passou a ser ${banco(doBanco.para)}.` : " (mesmo banco, outro código).") +
          ` Fornecedor, nota e valor continuam os mesmos — e é isso que o golpe do boleto adulterado preserva: só muda para onde o dinheiro vai. ` +
          `Reemissão legítima existe (vencimento perdido, troca de banco de cobrança), e por isso a troca precisa de confirmação por fora. ${situacaoDoPagamento(t)}`,
        recomendacao: `${CONFIRMAR} Registrar quem confirmou e quando.`,
        valorCents: t.valorDocumentoCents,
        dataReferencia: troca.vistoEm,
        entidadeTipo: "OmieTitulo",
        entidadeId: t.id,
        entidadeRef: referenciaTitulo(t),
        evidencia: {
          fornecedor: nome,
          trocadoEm: fmtData(troca.vistoEm),
          bancoAntes: doBanco ? banco(doBanco.de) : banco(t.boletoBanco),
          bancoDepois: banco(t.boletoBanco),
          vencimento: fmtData(t.dataVencimento),
          valor: t.valorDocumentoCents,
          pago: pago(t),
          incluidoPor: t.usuarioInclusao ?? "—",
          alteradoPor: t.usuarioAlteracao ?? "—",
        },
        chave: chaveAchado("FR-BOLETO-TROCADO", t.conexaoApelido, t.codigoLancamento, troca.vistoEm.toISOString().slice(0, 10)),
      });
    }
  }
  return achados;
}

// O INDÍCIO DA TROCA NO PASSADO. Antes de 01/11/2026 o código de barras não
// era guardado, então a troca em si (código A → código B) não aparece. O que
// a Omie guarda é a ÚLTIMA alteração do título (quem e quando, bloco `info`).
// Título alterado depois de lançado e ANTES de pago, com boleto de banco fora
// do hábito do fornecedor, é o rastro que a troca deixa. A baixa e a
// conciliação também mexem na data de alteração: por isso, no título pago, só
// vale alteração pelo menos um dia antes do pagamento — a de depois pode ser a
// própria baixa, e apagou a anterior.
export function alteracaoAntesDoPagamento(t: OmieTitulo): { quando: Date; quem: string | null; outraPessoa: boolean; diasDepoisDeLancado: number } | null {
  if (!t.alteradoEmOmie || !t.dataInclusaoOmie) return null;
  const diasDepoisDeLancado = diasEntre(t.dataInclusaoOmie, t.alteradoEmOmie);
  if (diasDepoisDeLancado < 1) return null;
  if (pago(t) && (!t.dataUltimaBaixa || diasEntre(t.alteradoEmOmie, t.dataUltimaBaixa) < 1)) return null;
  const outraPessoa = Boolean(t.usuarioAlteracao && t.usuarioInclusao && t.usuarioAlteracao.trim().toLowerCase() !== t.usuarioInclusao.trim().toLowerCase());
  return { quando: t.alteradoEmOmie, quem: t.usuarioAlteracao, outraPessoa, diasDepoisDeLancado };
}

// FR-BOLETO-BANCO-NOVO — o fornecedor cobrou por um ou dois bancos em todos
// os boletos anteriores e este vem de outro. Só o PRIMEIRO boleto do banco
// novo é apontado: a partir dele, o banco passa a ser do histórico.
function bancoNovo(ctx: ContextoAuditoria, comBoleto: OmieTitulo[], materialidade: number): AchadoNovo[] {
  const achados: AchadoNovo[] = [];
  const bancarios = comBoleto.filter((t) => t.boletoBanco !== null);
  for (const titulos of agrupar(bancarios, (t) => chaveParceiro(t)).values()) {
    const ordem = [...titulos].sort((a, b) => a.dataVencimento.getTime() - b.dataVencimento.getTime() || a.codigoLancamento.localeCompare(b.codigoLancamento));
    for (let i = BOLETOS_PARA_HABITO; i < ordem.length; i++) {
      const t = ordem[i];
      const anteriores = ordem.slice(0, i);
      const habituais = new Set(anteriores.map((a) => a.boletoBanco as string));
      if (habituais.has(t.boletoBanco as string) || t.valorDocumentoCents < materialidade / 2) continue;
      const nome = nomeParceiro(ctx, t);
      const deSempre = [...habituais].map(banco).join(", ");
      const alteracao = alteracaoAntesDoPagamento(t);
      // Sem agravar: troca de banco de cobrança é comum e legítima; o que
      // pesa é o valor. A pagar, no mínimo média — ainda dá para segurar.
      // Com o título alterado depois de lançado (o rastro da troca), agrava;
      // alterado por outra pessoa que não quem lançou, agrava de novo.
      let severidade = pago(t) ? severidadePorValor(t.valorDocumentoCents, materialidade) : peloMenos(severidadePorValor(t.valorDocumentoCents, materialidade), "MEDIA");
      if (alteracao) severidade = peloMenos(agravar(severidade), "MEDIA");
      if (alteracao?.outraPessoa) severidade = agravar(severidade);
      achados.push({
        regra: "FR-BOLETO-BANCO-NOVO",
        tipo: "ESTADO",
        severidade,
        categoria: "FRAUDE",
        titulo: `${nome} sempre cobrou por ${deSempre}; este boleto é de ${banco(t.boletoBanco)}${alteracao ? " (título alterado antes de pagar)" : ""}`,
        descricao:
          `Os ${anteriores.length} boletos anteriores deste fornecedor vieram de ${deSempre}. O de ${referenciaTitulo(t)} (${fmtBRL(t.valorDocumentoCents)}) ` +
          `vem de ${banco(t.boletoBanco)}. Boleto de banco que o fornecedor nunca usou é o sinal mais comum do boleto frio — e também o que acontece quando ` +
          `ele troca de banco de cobrança, por isso confirmar. ` +
          (alteracao
            ? `O título foi alterado na Omie em ${fmtData(alteracao.quando)}${alteracao.quem ? ` por ${alteracao.quem}` : ""}, ${alteracao.diasDepoisDeLancado} dia(s) depois de lançado` +
              `${alteracao.outraPessoa ? " (por outra pessoa, não quem lançou)" : ""}${pago(t) ? " e antes do pagamento" : ""}: é o rastro que a troca do código de barras deixa. `
            : "") +
          situacaoDoPagamento(t),
        recomendacao: CONFIRMAR,
        valorCents: t.valorDocumentoCents,
        dataReferencia: t.dataVencimento,
        entidadeTipo: "OmieTitulo",
        entidadeId: t.id,
        entidadeRef: referenciaTitulo(t),
        evidencia: {
          fornecedor: nome,
          bancoDoBoleto: banco(t.boletoBanco),
          bancosAnteriores: deSempre,
          boletosAnteriores: anteriores.length,
          vencimento: fmtData(t.dataVencimento),
          valor: t.valorDocumentoCents,
          pago: pago(t),
          incluidoPor: t.usuarioInclusao ?? "—",
          alteradoEm: alteracao ? fmtData(alteracao.quando) : "—",
          alteradoPor: alteracao?.quem ?? "—",
        },
        chave: chaveAchado("FR-BOLETO-BANCO-NOVO", t.conexaoApelido, t.codigoLancamento),
      });
    }
  }
  return achados;
}

// FR-BOLETO-REPETIDO — o mesmo código de barras em dois títulos (nas duas
// empresas também: o boleto é um só, quem pagar primeiro quita). Pagar os dois
// é pagar duas vezes; cadastrar o mesmo boleto em outra nota é o jeito de
// fazer um pagamento parecer outro.
function boletoRepetido(ctx: ContextoAuditoria, comBoleto: OmieTitulo[], materialidade: number): AchadoNovo[] {
  const achados: AchadoNovo[] = [];
  for (const titulos of agrupar(comBoleto, (t) => t.boletoHash as string).values()) {
    if (titulos.length < 2) continue;
    const ordem = [...titulos].sort((a, b) => a.dataVencimento.getTime() - b.dataVencimento.getTime() || a.codigoLancamento.localeCompare(b.codigoLancamento));
    const pagos = ordem.filter(pago);
    // O excesso: tudo o que passa do primeiro título.
    const excesso = somar(ordem.slice(1), (t) => t.valorDocumentoCents);
    const primeiro = ordem[0];
    const nomes = [...new Set(ordem.map((t) => nomeParceiro(ctx, t)))];
    let severidade = severidadePorValor(excesso, materialidade);
    if (pagos.length >= 2) severidade = agravar(severidade);
    if (nomes.length > 1) severidade = agravar(severidade);
    achados.push({
      regra: "FR-BOLETO-REPETIDO",
      tipo: "ESTADO",
      severidade: peloMenos(severidade, "MEDIA"),
      categoria: "FRAUDE",
      titulo: `O mesmo boleto em ${ordem.length} títulos (${nomes.join(" / ")})`,
      descricao:
        `O código de barras de ${referenciaTitulo(primeiro)} aparece também em ${ordem.slice(1).map(referenciaTitulo).join(", ")}. ` +
        `Um boleto só se paga uma vez: ${pagos.length >= 2 ? `${pagos.length} desses títulos já foram pagos — pagamento em duplicidade ou um pagamento disfarçado de outro.` : "pagar mais de um é pagar em dobro."}` +
        (nomes.length > 1 ? ` E os títulos estão em fornecedores diferentes (${nomes.join(", ")}), o que um boleto legítimo não explica.` : ""),
      recomendacao:
        "Ver na Omie qual título o boleto quita de fato (o que bate com a nota do fornecedor) e cancelar ou corrigir o outro antes do pagamento. " +
        "Se os dois já foram pagos, pedir a devolução ao fornecedor com os dois comprovantes.",
      valorCents: excesso,
      dataReferencia: ordem[ordem.length - 1].dataVencimento,
      entidadeTipo: "OmieTitulo",
      entidadeId: primeiro.id,
      entidadeRef: referenciaTitulo(primeiro),
      evidencia: {
        titulos: ordem.map((t) => `${referenciaTitulo(t)} · ${nomeParceiro(ctx, t)} · ${fmtBRL(t.valorDocumentoCents)} · ${pago(t) ? "pago" : "em aberto"}`),
        banco: banco(primeiro.boletoBanco),
        pagos: pagos.length,
      },
      chave: chaveAchado("FR-BOLETO-REPETIDO", ...ordem.map((t) => `${t.conexaoApelido}:${t.codigoLancamento}`)),
    });
  }
  return achados;
}

// FR-BOLETO-VALOR-DIVERGENTE — o boleto cobra um valor que não é o do título
// nem o do título menos as retenções. Boleto de outro título (de outra
// parcela, de uma nota já paga) colado neste, ou valor alterado no boleto.
function valorDivergente(ctx: ContextoAuditoria, comBoleto: OmieTitulo[], materialidade: number): AchadoNovo[] {
  const achados: AchadoNovo[] = [];
  for (const t of comBoleto) {
    if (t.boletoValorCents === null) continue;
    const liquido = liquidoDoTitulo(t);
    const tolerancia = Math.max(TOLERANCIA_CENTS, Math.round(t.valorDocumentoCents * TOLERANCIA_PCT));
    const diferenca = t.boletoValorCents - liquido;
    if (Math.abs(t.boletoValorCents - t.valorDocumentoCents) <= tolerancia || Math.abs(diferenca) <= tolerancia) continue;
    if (Math.abs(diferenca) < materialidade / 10) continue;
    const nome = nomeParceiro(ctx, t);
    const aMais = diferenca > 0;
    achados.push({
      regra: "FR-BOLETO-VALOR-DIVERGENTE",
      tipo: "ESTADO",
      severidade: aMais ? agravar(severidadePorValor(diferenca, materialidade)) : severidadePorValor(-diferenca, materialidade),
      categoria: "FRAUDE",
      titulo: `Boleto de ${fmtBRL(t.boletoValorCents)} em título de ${fmtBRL(t.valorDocumentoCents)} — ${referenciaTitulo(t)} (${nome})`,
      descricao:
        `O código de barras cobra ${fmtBRL(t.boletoValorCents)}; o título é de ${fmtBRL(t.valorDocumentoCents)}` +
        (liquido !== t.valorDocumentoCents ? ` (${fmtBRL(liquido)} depois das retenções)` : "") +
        `. ${aMais ? "Pagar o boleto é pagar mais do que a nota." : "O boleto cobra menos: é de outro título (outra parcela, outra nota) ou o título está errado."} ` +
        `Boleto de outro título colado neste é como se paga duas vezes a mesma nota — ou se paga uma conta que não é a do fornecedor. ${situacaoDoPagamento(t)}`,
      recomendacao: "Abrir o boleto e a nota: o valor, o vencimento e o beneficiário do boleto têm de ser os desta nota. Se não forem, pedir o boleto certo ao fornecedor (pelo contato cadastrado).",
      valorCents: Math.abs(diferenca),
      dataReferencia: t.dataVencimento,
      entidadeTipo: "OmieTitulo",
      entidadeId: t.id,
      entidadeRef: referenciaTitulo(t),
      evidencia: {
        fornecedor: nome,
        valorDoBoleto: t.boletoValorCents,
        valorDoTitulo: t.valorDocumentoCents,
        liquidoDasRetencoes: liquido,
        vencimentoDoBoleto: t.boletoVencimento ? fmtData(t.boletoVencimento) : "sem vencimento",
        vencimentoDoTitulo: fmtData(t.dataVencimento),
        banco: banco(t.boletoBanco),
        pago: pago(t),
      },
      chave: chaveAchado("FR-BOLETO-VALOR-DIVERGENTE", t.conexaoApelido, t.codigoLancamento),
    });
  }
  return achados;
}

// FR-BOLETO-INVALIDO — o código não fecha o dígito verificador. Gerador de
// boleto (o legítimo e o do golpe) sempre fecha: dígito errado é código
// digitado ou editado à mão. Só o que ainda vai ser pago — o banco recusaria,
// e quem paga acaba "corrigindo" pela linha que veio no e-mail.
function boletoInvalido(ctx: ContextoAuditoria, comBoleto: OmieTitulo[]): AchadoNovo[] {
  return comBoleto
    .filter((t) => t.boletoDigitoValido === false && !pago(t))
    .map((t) => {
      const nome = nomeParceiro(ctx, t);
      return {
        regra: "FR-BOLETO-INVALIDO",
        tipo: "ESTADO" as const,
        severidade: "MEDIA" as const,
        categoria: "FRAUDE" as const,
        titulo: `Código de barras que não fecha o dígito — ${referenciaTitulo(t)} (${nome})`,
        descricao:
          `O código de barras gravado na Omie para este título não confere com o próprio dígito verificador: foi digitado errado ou editado à mão. ` +
          `Nenhum boleto emitido por banco sai assim. ${situacaoDoPagamento(t)}`,
        recomendacao: "Copiar a linha digitável de novo, do PDF original enviado pelo fornecedor (pelo canal de sempre), e conferir o beneficiário antes de pagar.",
        valorCents: t.valorDocumentoCents,
        dataReferencia: t.dataVencimento,
        entidadeTipo: "OmieTitulo",
        entidadeId: t.id,
        entidadeRef: referenciaTitulo(t),
        evidencia: { fornecedor: nome, banco: banco(t.boletoBanco), vencimento: fmtData(t.dataVencimento), valor: t.valorDocumentoCents },
        chave: chaveAchado("FR-BOLETO-INVALIDO", t.conexaoApelido, t.codigoLancamento),
      };
    });
}
