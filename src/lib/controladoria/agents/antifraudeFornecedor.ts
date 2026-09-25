import type { OmieParceiro, OmieTitulo } from "@prisma/client";
import { fmtBRL, fmtData, fmtDiaDoInstante, fmtDocumento, fmtPercent } from "../format";
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

// ---------------------------------------------------------------------------
// O OPERADOR — o que o bloco `info` da Omie permite ver
// ---------------------------------------------------------------------------
// Com `lDadosCad`, cada título traz quem o incluiu, quem o alterou e quando.
// As duas regras abaixo só existem quando esse dado veio (título com
// `usuarioInclusao`/`usuarioAlteracao`); sem ele, ficam caladas — e a tela
// de sincronização ("Testar integração") mostra se a conta devolve o bloco.

// FR-EDITADO-APOS-BAIXA — o título mudou depois de pago.
//
// Um título liquidado é fato encerrado. Alteração dias depois da baixa
// (fornecedor, valor, categoria, conta — a Omie não diz o quê, só quem e
// quando) é o que se faz para esconder um pagamento: muda-se o beneficiário
// ou a categoria depois que o dinheiro saiu. Dois dias de folga cobrem a
// própria baixa e a conciliação bumping a data de alteração.
const DIAS_DE_FOLGA_APOS_BAIXA = 2;

export function editadoAposBaixa(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const achados: AchadoNovo[] = [];
  // Duas fontes: o bloco `info` (quem e quando) e as versões gravadas pelo
  // sync (o quê). Com versão depois da baixa a regra dispara mesmo sem o
  // bloco info; com as duas, diz quem mudou o quê.
  const versoesPorTitulo = agrupar(ctx.versoesDeTitulo ?? [], (v) => v.tituloId);
  const editados = titulosAtivos(ctx, "PAGAR").filter((t) => {
    if (!t.liquidado || t.dataUltimaBaixa === null || t.valorPagoCents < materialidade / 2) return false;
    const pelaInfo =
      t.alteradoEmOmie !== null && t.usuarioAlteracao !== null && diasEntre(t.dataUltimaBaixa, t.alteradoEmOmie) > DIAS_DE_FOLGA_APOS_BAIXA;
    const pelasVersoes = (versoesPorTitulo.get(t.id) ?? []).some((v) => diasEntre(t.dataUltimaBaixa as Date, v.vistoEm) > DIAS_DE_FOLGA_APOS_BAIXA);
    return pelaInfo || pelasVersoes;
  });
  for (const t of editados) {
    const versoes = (versoesPorTitulo.get(t.id) ?? []).filter((v) => diasEntre(t.dataUltimaBaixa as Date, v.vistoEm) > DIAS_DE_FOLGA_APOS_BAIXA);
    const quando = t.alteradoEmOmie && t.usuarioAlteracao ? t.alteradoEmOmie : versoes[versoes.length - 1]?.vistoEm ?? (t.alteradoEmOmie as Date);
    const dias = diasEntre(t.dataUltimaBaixa as Date, quando);
    const nome = nomeParceiro(ctx, t);
    const mudancas = versoes.map((v) => `${v.campo}: ${v.de ?? "—"} → ${v.para ?? "—"}`);
    achados.push({
      regra: "FR-EDITADO-APOS-BAIXA",
      tipo: "EVENTO",
      severidade: severidadePorValor(t.valorPagoCents, materialidade) === "BAIXA" ? "MEDIA" : agravar(severidadePorValor(t.valorPagoCents, materialidade)),
      categoria: "FRAUDE",
      titulo: `${referenciaTitulo(t)} (${nome}) alterado ${dias} dias depois de pago`,
      descricao:
        `O título foi baixado em ${fmtData(t.dataUltimaBaixa)} (${fmtBRL(t.valorPagoCents)}) e alterado na Omie em ` +
        `${fmtData(quando)}${t.usuarioAlteracao ? ` por ${t.usuarioAlteracao}` : ""}.` +
        (mudancas.length > 0 ? ` O que mudou: ${mudancas.join("; ")}.` : "") +
        ` Título pago é fato encerrado: o que muda depois (fornecedor, valor, categoria, conta) precisa de motivo registrado.`,
      recomendacao:
        "Abrir o histórico do título na Omie e ver o que foi alterado. Se foi o beneficiário ou o valor, comparar com o " +
        "comprovante do pagamento; se foi a categoria, confirmar com quem aprovou. Registrar a justificativa.",
      valorCents: t.valorPagoCents,
      dataReferencia: t.alteradoEmOmie as Date,
      entidadeTipo: "OmieTitulo",
      entidadeId: t.id,
      entidadeRef: referenciaTitulo(t),
      evidencia: {
        fornecedor: nome,
        pagoEm: fmtData(t.dataUltimaBaixa),
        alteradoEm: fmtData(quando),
        diasDepois: dias,
        alteradoPor: t.usuarioAlteracao ?? "—",
        mudancas,
        incluidoPor: t.usuarioInclusao ?? "—",
        valor: t.valorPagoCents,
      },
      chave: chaveAchado("FR-EDITADO-APOS-BAIXA", t.conexaoApelido, t.codigoLancamento, quando.toISOString().slice(0, 10)),
    });
  }
  return achados;
}

// FR-LANCAMENTO-MANUAL — título a pagar digitado à mão, sem documento.
//
// `cOrigem` diz de onde o título nasceu: NFEP veio de nota, OFXP do extrato,
// MANP foi digitado. Lançamento manual não é errado — é onde o controle é
// mais fraco, e por isso o teste clássico de "manual journal entries". Um
// achado por usuário e mês, com os títulos manuais SEM número de documento
// e acima da metade da materialidade.
const ORIGEM_MANUAL = /^MAN[PR]$/i;

export function lancamentoManualSemDocumento(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const achados: AchadoNovo[] = [];
  const manuais = titulosAtivos(ctx, "PAGAR").filter(
    (t) =>
      t.origemLancamento !== null &&
      ORIGEM_MANUAL.test(t.origemLancamento) &&
      !numeroDaNota(t.numeroDocumento) &&
      t.valorDocumentoCents >= materialidade / 2
  );
  const mes = (t: OmieTitulo) => {
    const d = t.dataInclusaoOmie ?? t.dataEmissao ?? t.dataVencimento;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };
  for (const [chave, lista] of agrupar(manuais, (t) => `${t.conexaoApelido}|${t.usuarioInclusao ?? "?"}|${mes(t)}`)) {
    const [empresa, usuario, competencia] = chave.split("|");
    const valor = somar(lista, (t) => t.valorDocumentoCents);
    if (valor < materialidade) continue;
    achados.push({
      regra: "FR-LANCAMENTO-MANUAL",
      tipo: "EVENTO",
      severidade: severidadePorValor(valor, materialidade),
      categoria: "RISCO_FINANCEIRO",
      titulo: `${empresa}: ${lista.length} título(s) a pagar lançados à mão sem documento por ${usuario} em ${competencia}`,
      descricao:
        `${fmtBRL(valor)} em títulos com origem manual (MANP) e sem número de nota, incluídos por ${usuario}. ` +
        `Título que não nasce de nota nem de extrato depende só de quem o digitou — é a classe de lançamento em que a ` +
        `conferência precisa ser por amostra, todo mês.`,
      recomendacao:
        "Pedir o documento de suporte (nota, contrato, recibo) de cada título listado e conferir quem aprovou o pagamento. " +
        "Fornecedor recorrente lançado à mão deveria entrar por nota.",
      valorCents: valor,
      dataReferencia: ctx.dataReferencia,
      entidadeTipo: "Usuario",
      entidadeId: `${empresa}|${usuario}`,
      entidadeRef: usuario,
      evidencia: {
        empresa,
        usuario,
        competencia,
        quantidade: lista.length,
        valor,
        titulos: lista.slice(0, 20).map((t) => ({
          ref: referenciaTitulo(t),
          fornecedor: nomeParceiro(ctx, t),
          categoria: t.categoriaDescricao ?? "",
          valor: t.valorDocumentoCents,
          pago: t.valorPagoCents,
        })),
      },
      chave: chaveAchado("FR-LANCAMENTO-MANUAL", empresa, usuario, competencia),
    });
  }
  return achados;
}

// ---------------------------------------------------------------------------
// FR-CONTA-ALTERADA-REPETIDA — trocou, recebeu, voltou
// ---------------------------------------------------------------------------
// FR-CONTA-ALTERADA vê uma troca de cada vez. O esquema clássico é a
// sequência: muda a conta, recebe um pagamento, volta à conta de antes — e o
// cadastro fica igual ao original, como se nada tivesse acontecido. Ou duas
// trocas no mesmo ano, cada uma "confirmada por e-mail". O histórico
// append-only do sync guarda a sequência; aqui ela é lida.
const TROCAS_POR_ANO_PARA_APONTAR = 2;

export function contaAlteradaRepetida(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const historico = ctx.contaHistorico ?? [];
  if (historico.length === 0) return [];
  const achados: AchadoNovo[] = [];
  const parceiros = new Map(ctx.parceiros.map((p) => [`${p.conexaoId}|${p.codigoOmie}`, p]));
  const pagarPorParceiro = agrupar(
    titulosAtivos(ctx, "PAGAR").filter((t) => t.parceiroCodigo && t.valorPagoCents > 0),
    (t) => `${t.conexaoId}|${t.parceiroCodigo}`
  );

  for (const [chave, trocas] of agrupar(historico, (h) => `${h.conexaoId}|${h.codigoOmie}`)) {
    const ordenadas = [...trocas].sort((a, b) => a.detectadoEm.getTime() - b.detectadoEm.getTime());
    const hashesVistos = new Set(ordenadas.map((t) => t.hashAnterior));
    const voltou = ordenadas.some((t, i) => i > 0 && ordenadas.slice(0, i).some((x) => x.hashAnterior === t.hashNovo));
    if (ordenadas.length < TROCAS_POR_ANO_PARA_APONTAR && !voltou) continue;

    const p = parceiros.get(chave);
    const nome = p?.nome ?? chave;
    const primeira = ordenadas[0].detectadoEm;
    const pagoDesde = somar(
      (pagarPorParceiro.get(chave) ?? []).filter((t) => t.dataUltimaBaixa && t.dataUltimaBaixa >= primeira),
      (t) => t.valorPagoCents
    );
    achados.push({
      regra: "FR-CONTA-ALTERADA-REPETIDA",
      tipo: "ESTADO",
      severidade: voltou ? "ALTA" : agravar(severidadePorValor(pagoDesde, materialidade)),
      categoria: "FRAUDE",
      titulo: voltou
        ? `${nome}: conta bancária trocada e depois devolvida à anterior`
        : `${nome}: ${ordenadas.length} trocas de conta bancária em 12 meses`,
      descricao:
        `${ordenadas.length} troca(s) de conta desde ${fmtData(primeira)}` +
        (voltou ? ", e uma delas VOLTOU a uma conta usada antes — o cadastro fica igual ao original, como se nada tivesse acontecido. " : ". ") +
        (pagoDesde > 0 ? `${fmtBRL(pagoDesde)} pagos desde a primeira troca. ` : "") +
        `Trocar, receber e voltar é o desenho do desvio de pagamento por conta falsa; duas trocas no ano "confirmadas por e-mail" também.`,
      recomendacao:
        "Levantar cada pagamento feito entre as trocas e conferir no banco a titularidade da conta que recebeu. Confirmar as " +
        "trocas por telefone em número já cadastrado e registrar quem as autorizou na Omie.",
      valorCents: pagoDesde > 0 ? pagoDesde : undefined,
      dataReferencia: ordenadas[ordenadas.length - 1].detectadoEm,
      entidadeTipo: "OmieParceiro",
      entidadeId: p?.id ?? chave,
      entidadeRef: nome,
      evidencia: {
        fornecedor: nome,
        trocas: ordenadas.map((t) => ({ em: fmtDiaDoInstante(t.detectadoEm), voltouAConta: hashesVistos.has(t.hashNovo) && t.hashNovo !== t.hashAnterior })),
        pagoDesdeAPrimeiraTroca: pagoDesde,
      },
      chave: chaveAchado("FR-CONTA-ALTERADA-REPETIDA", chave),
    });
  }
  return achados;
}
