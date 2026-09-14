import type { OmieParceiro, OmieTitulo } from "@prisma/client";
import { fmtBRL, fmtData, fmtDocumento, fmtPercent } from "../format";
import { diasEntre } from "../periodos";
import { ehPessoaFisica } from "../documento";
import type { AchadoNovo, ContextoAuditoria } from "../types";
import { agravar, agrupar, chaveAchado, chaveParceiro, nomeParceiro, referenciaTitulo, severidadePorValor, somar, titulosAtivos } from "./comum";

// ANTIFRAUDE — O CADASTRO DO FORNECEDOR E O QUE ELE FATURA
//
// Continuação do agente antifraude (antifraude.ts), separada em arquivo pelo
// tamanho. As regras daqui olham o fornecedor como entidade: a conta bancária
// que ele divide com outro, a nota que aparece duas vezes, o cadastro criado e
// pago na mesma semana, o valor sempre redondo, a numeração de nota que só
// tem a gente como cliente. São os sinais clássicos de "empresa de fachada" e
// de "pagamento a mais" da literatura (ACFE, testes de vendor master), postos
// sobre o que o espelho da Omie tem.
//
// Mesma regra de ouro: nada acusa. Cada achado diz qual conferência fazer.

// Quem legitimamente recebe por vários cedentes numa conta só: factoring,
// FIDC, cooperativa, banco cobrando por boleto de terceiros.
const RECEBE_POR_TERCEIROS =
  /\b(banco|bco|financeira|fomento|factoring|fidc|securitizadora|cooperativa|sicredi|sicoob|cobran[cç]a|pagamentos?|pag\b|adquir)/i;

// Categorias em que valor redondo é a regra, não o sinal: aluguel, folha,
// diária, pró-labore, honorário fixo, consórcio, empréstimo, adiantamento.
const CATEGORIA_DE_VALOR_FIXO =
  /alug|loca[cç][aã]o|sal[aá]rio|folha|pr[oó].?labore|di[aá]ria|ajuda de custo|honor[aá]rio|cons[oó]rcio|empr[eé]stimo|financiamento|parcela|adiantamento|vale|mensalidade|assinatura|plano de|condom[ií]nio|imposto|tributo|taxa|contribui[cç]/i;

// Quem numera documento por contrato/veículo, não por nota: banco, DETRAN,
// seguradora, rastreador, pedágio, consórcio. Numeração "sequencial" desses
// é o contrato, e nota repetida é a parcela.
const NUMERA_POR_CONTRATO =
  /\b(banco|bco|financeira|financiamento|cons[oó]rcio|leasing|arrendamento|fomento|fidc|detran|ipva|licenciamento|segur|rastrea|monitoramento|ped[aá]gio|sem parar|conectcar|veloe|telefon|vivo|claro|tim\b|oi\b|energia|enel|cpfl|sabesp|comgas|internet|plano de sa[uú]de|unimed|amil|bradesco sa[uú]de|sulam[eé]rica)/i;

// Dígitos do número de documento, sem zeros à esquerda. "NF-e 000123",
// "123/1" e "123" são a mesma nota. Menos de 3 dígitos é referência curta
// ("1", "12"), não número de nota.
export function numeroDaNota(numero: string | null | undefined): string | null {
  const digitos = (numero ?? "").replace(/\D/g, "").replace(/^0+/, "");
  return digitos.length >= 3 ? digitos : null;
}

function documentoRaiz(p: { documento: string | null }): string | null {
  if (!p.documento) return null;
  return ehPessoaFisica(p.documento) ? `cpf:${p.documento}` : p.documento.slice(0, 8);
}

function cpfsDaFolha(ctx: ContextoAuditoria): Set<string> {
  return new Set(ctx.motoristas.map((m) => m.cpf.replace(/\D/g, "")).filter((c) => c.length === 11));
}

// ---------------------------------------------------------------------------
// FR-CONTA-COMPARTILHADA — dois fornecedores, uma conta bancária
// ---------------------------------------------------------------------------
// Empresas diferentes não dividem conta corrente. Quando dividem, ou uma
// delas é de fachada, ou a conta é de uma pessoa. O hash de banco+agência+
// conta já existe no cadastro (para detectar troca); aqui ele é comparado
// ENTRE cadastros — dentro e entre as duas contas Omie.
export function contaBancariaCompartilhada(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const achados: AchadoNovo[] = [];
  const folha = cpfsDaFolha(ctx);
  const pagoPorParceiro = new Map<string, number>();
  for (const t of titulosAtivos(ctx, "PAGAR")) {
    if (!t.parceiroCodigo || t.valorPagoCents <= 0) continue;
    const k = `${t.conexaoId}|${t.parceiroCodigo}`;
    pagoPorParceiro.set(k, (pagoPorParceiro.get(k) ?? 0) + t.valorPagoCents);
  }

  const comConta = ctx.parceiros.filter((p) => p.contaBancariaHash && !p.inativo);
  for (const [hash, grupo] of agrupar(comConta, (p) => p.contaBancariaHash as string)) {
    // Documentos DISTINTOS. O mesmo CNPJ nas duas contas Omie é o mesmo
    // fornecedor; matriz e filial (mesma raiz) também ficam de fora; sem
    // documento não dá para afirmar nada.
    const raizes = new Set(grupo.map(documentoRaiz).filter((r): r is string => r !== null));
    if (raizes.size < 2) continue;
    if (grupo.some((p) => RECEBE_POR_TERCEIROS.test(p.nome))) continue;

    const pago = somar(grupo, (p) => pagoPorParceiro.get(`${p.conexaoId}|${p.codigoOmie}`) ?? 0);
    const pessoaFisica = grupo.some((p) => ehPessoaFisica(p.documento));
    const daFolha = grupo.some((p) => p.documento && folha.has(p.documento));
    const severidade = daFolha
      ? "CRITICA"
      : pago >= materialidade
        ? agravar(severidadePorValor(pago, materialidade))
        : pessoaFisica
          ? "MEDIA"
          : "BAIXA";
    const nomes = grupo.map((p) => `${p.nome} (${p.conexaoApelido})`);

    achados.push({
      regra: "FR-CONTA-COMPARTILHADA",
      tipo: "ESTADO",
      severidade,
      categoria: "FRAUDE",
      titulo: `${grupo.length} cadastros com documentos diferentes recebem na mesma conta bancária`,
      descricao:
        `${nomes.join(", ")} têm CNPJ/CPF distintos e o mesmo banco, agência e conta. ` +
        (pago > 0 ? `Juntos receberam ${fmtBRL(pago)} no período. ` : "Ainda sem pagamento no período. ") +
        `Empresas diferentes não dividem conta corrente; quando dividem, ou uma delas é de fachada, ou a conta é de uma pessoa.` +
        (daFolha ? " Um dos documentos é o CPF de alguém da folha." : pessoaFisica ? " Um dos cadastros é pessoa física." : ""),
      recomendacao:
        "Abrir os cadastros na Omie e conferir a titularidade da conta no banco (comprovante de titularidade). " +
        "Bloquear novos pagamentos aos cadastros até a titularidade bater com o documento de cada um.",
      valorCents: pago > 0 ? pago : undefined,
      dataReferencia: ctx.dataReferencia,
      entidadeTipo: "OmieParceiro",
      entidadeId: grupo[0].id,
      entidadeRef: grupo[0].nome,
      evidencia: {
        cadastros: grupo.map((p) => ({
          empresa: p.conexaoApelido,
          codigo: p.codigoOmie,
          nome: p.nome,
          documento: fmtDocumento(p.documento),
          pago: pagoPorParceiro.get(`${p.conexaoId}|${p.codigoOmie}`) ?? 0,
        })),
        pessoaFisica,
        cpfDaFolha: daFolha,
      },
      chave: chaveAchado("FR-CONTA-COMPARTILHADA", hash.slice(0, 16)),
    });
  }
  return achados;
}

// ---------------------------------------------------------------------------
// FR-NF-REPETIDA — a mesma nota, paga mais de uma vez
// ---------------------------------------------------------------------------
// CP-DUPLICIDADE exige valor e vencimento iguais. Esta olha o NÚMERO da nota:
// o mesmo fornecedor, a mesma nota, em datas ou valores diferentes — nas duas
// empresas inclusive. É a duplicidade que a regra exata não pega: a nota
// lançada de novo com o valor corrigido, sem cancelar a anterior; a mesma
// nota paga pela Azul e pela MCZ.
export function notaRepetida(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const achados: AchadoNovo[] = [];
  const pagos = titulosAtivos(ctx, "PAGAR").filter((t) => t.valorPagoCents > 0 && numeroDaNota(t.numeroDocumento));

  for (const [parceiro, doFornecedor] of agrupar(pagos, chaveParceiro)) {
    if (NUMERA_POR_CONTRATO.test(nomeParceiro(ctx, doFornecedor[0]))) continue;
    const porNota = agrupar(doFornecedor, (t) => numeroDaNota(t.numeroDocumento) as string);
    // Fornecedor cujo "número" se repete em muitos meses usa o campo como
    // referência (contrato, código do cliente), não como número de nota.
    const mesesPorNota = [...porNota.values()].map((l) => new Set(l.map((t) => `${t.dataVencimento.getFullYear()}-${t.dataVencimento.getMonth()}`)).size);
    if (mesesPorNota.filter((m) => m >= 3).length >= 2) continue;

    for (const [nota, lista] of porNota) {
      if (lista.length < 2) continue;
      // Parcelas distintas da mesma nota são um carnê, não repetição.
      const parcelas = new Set(lista.map((t) => (t.numeroParcela ?? "").trim()));
      if (parcelas.size === lista.length && lista.length > 1 && [...parcelas].some((p) => p !== "")) continue;
      // Valor e vencimento iguais é o caso de CP-DUPLICIDADE — não repete aqui.
      const iguais = new Set(lista.map((t) => `${t.valorDocumentoCents}|${t.dataVencimento.toISOString().slice(0, 10)}`));
      if (iguais.size === 1) continue;

      const ordenados = [...lista].sort((a, b) => b.valorPagoCents - a.valorPagoCents);
      const excedente = somar(ordenados.slice(1), (t) => t.valorPagoCents);
      if (excedente <= 0) continue;
      const empresas = [...new Set(lista.map((t) => t.conexaoApelido))];
      const nome = nomeParceiro(ctx, lista[0]);

      achados.push({
        regra: "FR-NF-REPETIDA",
        tipo: "EVENTO",
        severidade: severidadePorValor(excedente, materialidade),
        categoria: "PERDA_FINANCEIRA",
        titulo: `Nota ${nota} de ${nome} paga ${lista.length} vezes${empresas.length > 1 ? ` (${empresas.join(" e ")})` : ""}`,
        descricao:
          `${lista.length} títulos com o mesmo número de nota, ${lista.map((t) => `${fmtBRL(t.valorPagoCents)} em ${fmtData(t.dataUltimaBaixa ?? t.dataVencimento)}`).join(" e ")}. ` +
          `A regra de duplicidade exata não os junta porque valor ou vencimento diferem — e é exatamente assim que uma nota ` +
          `relançada com o valor corrigido, sem cancelar a anterior, sai paga duas vezes. ${fmtBRL(excedente)} a recuperar se for o caso.`,
        recomendacao:
          "Abrir os títulos na Omie (nas duas empresas, se for o caso) e conferir a nota fiscal de cada um. Sendo a mesma nota, " +
          "pedir a devolução ou o abatimento na próxima fatura e registrar o crédito como título a receber.",
        valorCents: excedente,
        impactoCents: excedente,
        dataReferencia: ordenados[ordenados.length - 1].dataUltimaBaixa ?? ctx.dataReferencia,
        entidadeTipo: "OmieParceiro",
        entidadeRef: nome,
        evidencia: {
          fornecedor: nome,
          nota,
          titulos: lista.map((t) => ({
            ref: referenciaTitulo(t),
            empresa: t.conexaoApelido,
            parcela: t.numeroParcela ?? "",
            vencimento: fmtData(t.dataVencimento),
            pagoEm: t.dataUltimaBaixa ? fmtData(t.dataUltimaBaixa) : "—",
            valor: t.valorDocumentoCents,
            pago: t.valorPagoCents,
          })),
          excedente,
        },
        chave: chaveAchado("FR-NF-REPETIDA", parceiro, nota),
      });
    }
  }
  return achados;
}

// ---------------------------------------------------------------------------
// FR-CADASTRO-E-PAGO — cadastrado e pago na mesma semana
// ---------------------------------------------------------------------------
// Fornecedor legítimo passa por cotação, cadastro, nota, prazo. Um cadastro
// criado e pago em três dias pulou tudo isso — é o teste "vendor created and
// paid same day" do catálogo de auditoria de contas a pagar. Só com a data
// real de cadastro da Omie (info.dInc): a primeira vez no espelho não serve,
// porque a carga histórica cria cadastro e título no mesmo instante.
const DIAS_ENTRE_CADASTRO_E_PAGAMENTO = 3;

export function cadastradoEPago(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const achados: AchadoNovo[] = [];
  const folha = cpfsDaFolha(ctx);
  const parceiros = new Map(ctx.parceiros.filter((p) => p.dataCadastroOmie).map((p) => [`${p.conexaoId}|${p.codigoOmie}`, p]));

  const porParceiro = agrupar(
    titulosAtivos(ctx, "PAGAR").filter((t) => t.parceiroCodigo && t.dataUltimaBaixa),
    (t) => `${t.conexaoId}|${t.parceiroCodigo}`
  );
  for (const [chave, titulos] of porParceiro) {
    const p = parceiros.get(chave);
    if (!p) continue;
    const cadastro = p.dataCadastroOmie as Date;
    // Motorista da folha pago como fornecedor é assunto de outra regra.
    if (p.documento && folha.has(p.documento)) continue;
    const primeiro = [...titulos].sort((a, b) => (a.dataUltimaBaixa as Date).getTime() - (b.dataUltimaBaixa as Date).getTime())[0];
    const dias = diasEntre(cadastro, primeiro.dataUltimaBaixa as Date);
    if (dias < 0 || dias > DIAS_ENTRE_CADASTRO_E_PAGAMENTO) continue;
    const valor = primeiro.valorPagoCents;
    if (valor < materialidade / 2) continue;

    const sinais: string[] = [];
    if (ehPessoaFisica(p.documento)) sinais.push("pessoa física");
    if (!numeroDaNota(primeiro.numeroDocumento)) sinais.push("sem número de nota");
    if (!p.email && !p.cidade) sinais.push("cadastro sem e-mail nem cidade");
    if (/servi|consult|assessor|manuten|comiss|intermedia/i.test(primeiro.categoriaDescricao ?? "")) sinais.push("categoria de serviço");
    const base = severidadePorValor(valor, materialidade);

    achados.push({
      regra: "FR-CADASTRO-E-PAGO",
      tipo: "EVENTO",
      severidade: sinais.length >= 2 ? agravar(base) : base,
      categoria: "FRAUDE",
      titulo: `${p.nome}: cadastrado em ${fmtData(cadastro)} e pago ${dias === 0 ? "no mesmo dia" : `${dias} dia(s) depois`}`,
      descricao:
        `O fornecedor foi criado na Omie em ${fmtData(cadastro)} e recebeu ${fmtBRL(valor)} em ${fmtData(primeiro.dataUltimaBaixa as Date)}. ` +
        `Cotação, cadastro, nota e prazo não cabem em ${dias} dia(s).` +
        (sinais.length > 0 ? ` Agrava: ${sinais.join(", ")}.` : ""),
      recomendacao:
        "Confirmar quem cadastrou o fornecedor e quem aprovou o pagamento (devem ser pessoas diferentes), a situação do CNPJ " +
        "na Receita e o documento que sustentou o valor. Sem os três, tratar como pagamento sem lastro.",
      valorCents: valor,
      dataReferencia: primeiro.dataUltimaBaixa as Date,
      entidadeTipo: "OmieParceiro",
      entidadeId: p.id,
      entidadeRef: p.nome,
      evidencia: {
        fornecedor: p.nome,
        documento: fmtDocumento(p.documento),
        cadastradoEm: fmtData(cadastro),
        primeiroPagamento: referenciaTitulo(primeiro),
        pagoEm: fmtData(primeiro.dataUltimaBaixa as Date),
        valor,
        diasEntre: dias,
        sinais,
      },
      chave: chaveAchado("FR-CADASTRO-E-PAGO", p.conexaoApelido, p.codigoOmie),
    });
  }
  return achados;
}

// ---------------------------------------------------------------------------
// FR-VALOR-REDONDO — o fornecedor que só cobra números redondos
// ---------------------------------------------------------------------------
// Nota de verdade tem centavos: quantidade x preço, imposto, frete. Um
// fornecedor cujos títulos são quase todos múltiplos de R$ 100 está cobrando
// um valor combinado, não medido — o perfil de "number duplication" de
// Nigrini e o red flag de shell company da ACFE. Só conta contra a base da
// própria empresa (a fração de redondos do conjunto), para não apontar o
// que é costume da casa.
const MINIMO_DE_TITULOS_PARA_PERFIL = 6;
const FRACAO_REDONDA_MINIMA = 0.7;
const MULTIPLO_DA_BASE = 3;

function ehRedondo(cents: number): boolean {
  return cents > 0 && cents % 10_000 === 0;
}

export function valoresRedondos(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const achados: AchadoNovo[] = [];
  const pagos = titulosAtivos(ctx, "PAGAR").filter((t) => t.valorPagoCents > 0 && !ehPessoaFisica(t.parceiroDocumento));
  if (pagos.length < 50) return [];
  const taxaDaBase = pagos.filter((t) => ehRedondo(t.valorDocumentoCents)).length / pagos.length;

  for (const [parceiro, lista] of agrupar(pagos, chaveParceiro)) {
    if (lista.length < MINIMO_DE_TITULOS_PARA_PERFIL) continue;
    const nome = nomeParceiro(ctx, lista[0]);
    if (NUMERA_POR_CONTRATO.test(nome) || RECEBE_POR_TERCEIROS.test(nome)) continue;
    if (lista.every((t) => CATEGORIA_DE_VALOR_FIXO.test(t.categoriaDescricao ?? ""))) continue;
    // Mesmo valor todo mês é contrato fixo — assunto de CU-RECORRENTE.
    if (new Set(lista.map((t) => t.valorDocumentoCents)).size === 1) continue;

    const redondos = lista.filter((t) => ehRedondo(t.valorDocumentoCents));
    const fracao = redondos.length / lista.length;
    if (fracao < FRACAO_REDONDA_MINIMA || fracao < taxaDaBase * MULTIPLO_DA_BASE) continue;
    const semNota = lista.filter((t) => !numeroDaNota(t.numeroDocumento)).length / lista.length;
    if (semNota < 0.5) continue;

    const valor = somar(lista, (t) => t.valorPagoCents);
    achados.push({
      regra: "FR-VALOR-REDONDO",
      tipo: "ESTADO",
      severidade: valor >= materialidade * 3 ? "MEDIA" : "BAIXA",
      categoria: "FRAUDE",
      titulo: `${nome}: ${fmtPercent(fracao * 100, 0)} dos títulos em valor redondo, ${fmtPercent(semNota * 100, 0)} sem nota`,
      descricao:
        `${redondos.length} de ${lista.length} títulos pagos a este fornecedor são múltiplos exatos de R$ 100 (na base inteira, ` +
        `${fmtPercent(taxaDaBase * 100, 0)} são), e ${fmtPercent(semNota * 100, 0)} não têm número de nota. ${fmtBRL(valor)} no período. ` +
        `Valor combinado em vez de medido, sem documento fiscal, é o perfil que precisa de contrato e entrega comprovados.`,
      recomendacao:
        "Pedir o contrato e a nota fiscal de cada título listado. Serviço sem nota não é dedutível e, sem contrato, não " +
        "há como saber o que foi entregue por esse valor.",
      valorCents: valor,
      dataReferencia: ctx.dataReferencia,
      entidadeTipo: "OmieParceiro",
      entidadeRef: nome,
      evidencia: {
        fornecedor: nome,
        titulos: lista.length,
        redondos: redondos.length,
        fracaoRedonda: fmtPercent(fracao * 100, 0),
        fracaoRedondaDaBase: fmtPercent(taxaDaBase * 100, 0),
        semNota: fmtPercent(semNota * 100, 0),
        valor,
        exemplos: lista.slice(0, 8).map((t) => ({ ref: referenciaTitulo(t), valor: t.valorDocumentoCents, categoria: t.categoriaDescricao ?? "" })),
      },
      chave: chaveAchado("FR-VALOR-REDONDO", parceiro),
    });
  }
  return achados;
}

// ---------------------------------------------------------------------------
// FR-NOTA-SEQUENCIAL — a numeração de nota do fornecedor só anda conosco
// ---------------------------------------------------------------------------
// Se as notas 118, 119, 120 e 121 de um fornecedor vieram todas para nós, em
// meses diferentes, ele não emite nota para mais ninguém. Prestador exclusivo
// existe (o MEI que só atende a empresa) — e é exatamente quem precisa de
// contrato, existência confirmada e outro cliente para ser fornecedor e não
// funcionário disfarçado ou empresa de fachada.
const MINIMO_DE_NOTAS_PARA_SEQUENCIA = 4;
const MINIMO_DE_DIAS_PARA_SEQUENCIA = 60;
const FOLGA_NA_NUMERACAO = 1.25;

export function notaSequencial(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const achados: AchadoNovo[] = [];
  const titulos = titulosAtivos(ctx, "PAGAR").filter((t) => numeroDaNota(t.numeroDocumento) && !ehPessoaFisica(t.parceiroDocumento));

  for (const [parceiro, lista] of agrupar(titulos, chaveParceiro)) {
    const nome = nomeParceiro(ctx, lista[0]);
    if (NUMERA_POR_CONTRATO.test(nome)) continue;
    const numeros = [...new Set(lista.map((t) => Number(numeroDaNota(t.numeroDocumento))))].filter((n) => Number.isFinite(n));
    if (numeros.length < MINIMO_DE_NOTAS_PARA_SEQUENCIA) continue;
    const datas = lista.map((t) => (t.dataEmissao ?? t.dataVencimento).getTime());
    const dias = (Math.max(...datas) - Math.min(...datas)) / 86_400_000;
    if (dias < MINIMO_DE_DIAS_PARA_SEQUENCIA) continue;
    const faixa = Math.max(...numeros) - Math.min(...numeros) + 1;
    if (faixa > numeros.length * FOLGA_NA_NUMERACAO) continue;

    const valor = somar(lista, (t) => t.valorDocumentoCents);
    const servico = lista.some((t) => /servi|consult|assessor|manuten|m[aã]o de obra|terceiriz|frete|transporte/i.test(t.categoriaDescricao ?? ""));
    achados.push({
      regra: "FR-NOTA-SEQUENCIAL",
      tipo: "ESTADO",
      severidade: valor >= materialidade && servico ? "MEDIA" : "BAIXA",
      categoria: "FRAUDE",
      titulo: `${nome}: ${numeros.length} notas de ${Math.min(...numeros)} a ${Math.max(...numeros)} — somos praticamente o único cliente`,
      descricao:
        `Em ${Math.round(dias)} dias, as notas deste fornecedor vieram numeradas quase sem intervalo (${numeros.length} notas numa faixa de ` +
        `${faixa}), ${fmtBRL(valor)} no total. Fornecedor que não fatura para mais ninguém pode ser prestador exclusivo legítimo — ` +
        `e pode ser cadastro criado para nos faturar.`,
      recomendacao:
        "Confirmar a existência (CNPJ ativo na Receita, endereço, sócios), o contrato e a entrega. Se os sócios forem pessoas " +
        "da empresa ou parentes, é conflito de interesse a registrar; se o serviço é contínuo e subordinado, é vínculo.",
      valorCents: valor,
      dataReferencia: ctx.dataReferencia,
      entidadeTipo: "OmieParceiro",
      entidadeRef: nome,
      evidencia: {
        fornecedor: nome,
        notas: numeros.sort((a, b) => a - b).slice(0, 30),
        faixaDeNumeracao: faixa,
        diasCobertos: Math.round(dias),
        valor,
      },
      chave: chaveAchado("FR-NOTA-SEQUENCIAL", parceiro),
    });
  }
  return achados;
}

export type { OmieParceiro, OmieTitulo };
