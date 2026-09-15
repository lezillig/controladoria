import type { OmieParceiro, OmieTitulo, ParceiroReceita } from "@prisma/client";
import { fmtBRL, fmtData, fmtDocumento } from "../format";
import { diasEntre, somarDias } from "../periodos";
import { normalizarRazaoSocial } from "../documento";
import type { AchadoNovo, ContextoAuditoria } from "../types";
import { fmtCnae } from "@/lib/receita/cliente";
import { agravar, agrupar, chaveAchado, emAberto, saldoAberto, severidadePorValor, somar, titulosAtivos } from "./comum";

// ANTIFRAUDE — O QUE A RECEITA FEDERAL DIZ DO CNPJ
//
// Continuação do agente antifraude (antifraude.ts), com o cadastro público
// da Receita (ParceiroReceita, ver src/lib/receita) no lugar do cadastro da
// Omie. São as conferências que todo manual de compras manda fazer antes de
// pagar um fornecedor novo e que ninguém faz depois: o CNPJ continua ativo?
// a empresa existe há quanto tempo? a atividade declarada tem a ver com o
// que se paga? quem são os sócios? é MEI faturando como empresa?
//
// Mesma regra de ouro de todo o agente: NADA ACUSA. Cada achado diz o que
// conferir, e a descrição fala em "conferir", nunca em "houve".
//
// TODAS FICAM CALADAS quando o CNPJ ainda não foi consultado (ctx.receita
// vazio ou sem a linha): a tabela enche aos poucos, e ausência de consulta
// não é informação sobre o fornecedor.

// Um fornecedor PJ com consulta na Receita e dinheiro no contexto.
type Fornecedor = {
  cnpj: string;
  receita: ParceiroReceita;
  // Cadastros com esse documento — pode haver um por conta Omie.
  cadastros: OmieParceiro[];
  nome: string;
  // Títulos a pagar ativos (não cancelados) desse CNPJ, nas duas empresas.
  titulos: OmieTitulo[];
};

// Montado uma vez por contexto (WeakMap: some junto com ele) — cinco regras
// leem a mesma lista, e agrupar cinquenta mil títulos cinco vezes é custo
// que não compra nada.
const FORNECEDORES_POR_CONTEXTO = new WeakMap<ContextoAuditoria, Fornecedor[]>();

function fornecedoresComReceita(ctx: ContextoAuditoria): Fornecedor[] {
  const pronto = FORNECEDORES_POR_CONTEXTO.get(ctx);
  if (pronto) return pronto;

  const lista: Fornecedor[] = [];
  const receita = ctx.receita ?? [];
  if (receita.length > 0) {
    const cadastrosPorDoc = agrupar(
      ctx.parceiros.filter((p) => p.documento),
      (p) => p.documento as string
    );
    const titulosPorDoc = agrupar(
      titulosAtivos(ctx, "PAGAR").filter((t) => t.parceiroDocumento),
      (t) => t.parceiroDocumento as string
    );
    for (const r of receita) {
      // Linha só com erro (nunca consultou com sucesso) não diz nada.
      if (!r.situacao && !r.inicioAtividade && !r.cnaeCodigo) continue;
      const titulos = titulosPorDoc.get(r.cnpj) ?? [];
      // Sem dinheiro envolvido não há o que conferir: cadastro é cadastro.
      if (titulos.length === 0) continue;
      const cadastros = cadastrosPorDoc.get(r.cnpj) ?? [];
      lista.push({
        cnpj: r.cnpj,
        receita: r,
        cadastros,
        nome: cadastros[0]?.nome ?? titulos[0].parceiroNome ?? r.razaoSocial ?? fmtDocumento(r.cnpj),
        titulos,
      });
    }
  }
  FORNECEDORES_POR_CONTEXTO.set(ctx, lista);
  return lista;
}

function pagosEm12Meses(f: Fornecedor, ctx: ContextoAuditoria): OmieTitulo[] {
  const desde = somarDias(ctx.dataReferencia, -365);
  return f.titulos.filter((t) => t.valorPagoCents > 0 && t.dataUltimaBaixa !== null && t.dataUltimaBaixa >= desde);
}

const ESCALA: AchadoNovo["severidade"][] = ["INFO", "BAIXA", "MEDIA", "ALTA", "CRITICA"];
function noMinimo(s: AchadoNovo["severidade"], piso: AchadoNovo["severidade"]): AchadoNovo["severidade"] {
  return ESCALA.indexOf(s) < ESCALA.indexOf(piso) ? piso : s;
}
function noMaximo(s: AchadoNovo["severidade"], teto: AchadoNovo["severidade"]): AchadoNovo["severidade"] {
  return ESCALA.indexOf(s) > ESCALA.indexOf(teto) ? teto : s;
}

// Empresas de origem, para o título do achado ("AZUL e MCZ").
function empresasDe(f: Fornecedor): string {
  return [...new Set(f.titulos.map((t) => t.conexaoApelido))].sort().join(" e ");
}

// O que sempre vai na evidência: o retrato da Receita, para quem for
// conferir não precisar abrir o site.
function retratoDaReceita(r: ParceiroReceita) {
  return {
    razaoSocialNaReceita: r.razaoSocial,
    situacao: r.situacao,
    situacaoDesde: r.situacaoEm?.toISOString() ?? null,
    abertura: r.inicioAtividade?.toISOString() ?? null,
    cnae: r.cnaeCodigo ? `${fmtCnae(r.cnaeCodigo)} — ${r.cnaeDescricao ?? ""}`.trim() : null,
    porte: r.porte,
    capitalSocial: r.capitalSocialCents,
    naturezaJuridica: r.naturezaJuridica,
    municipio: r.municipio && r.uf ? `${r.municipio}/${r.uf}` : r.municipio,
    mei: r.mei,
    consultadoEm: r.consultadoEm.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// FR-CNPJ-IRREGULAR — o CNPJ não está ATIVO e continua recebendo
// ---------------------------------------------------------------------------
// Empresa BAIXADA deixou de existir; INAPTA não entregou declaração por dois
// anos e não pode emitir nota válida; SUSPENSA e NULA são intervenções da
// própria Receita. Pagar a qualquer uma delas é pagar a quem, para o fisco,
// não presta serviço — e a nota que sustenta o pagamento não vale como
// despesa dedutível nem como crédito. Situação irregular com título EM ABERTO
// é o caso urgente: ainda dá para segurar o pagamento.
export function cnpjIrregular(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const achados: AchadoNovo[] = [];
  for (const f of fornecedoresComReceita(ctx)) {
    const situacao = f.receita.situacao;
    if (!situacao || situacao === "ATIVA") continue;

    const pagos = pagosEm12Meses(f, ctx);
    const abertos = f.titulos.filter(emAberto);
    if (pagos.length === 0 && abertos.length === 0) continue;

    const valorPago = somar(pagos, (t) => t.valorPagoCents);
    const valorAberto = somar(abertos, saldoAberto);
    // "Não encontrada" é mais fraco que "baixada": a base pública demora
    // semanas para conhecer uma empresa recém-aberta, e a BrasilAPI republica
    // com atraso. Fica em MÉDIA, com a ressalva na descrição.
    const naoEncontrada = situacao === "NAO ENCONTRADA";
    let severidade = noMinimo(severidadePorValor(valorPago, materialidade), "MEDIA");
    if (abertos.length > 0) severidade = noMinimo(severidade, "ALTA");
    if (naoEncontrada) severidade = noMaximo(severidade, "MEDIA");

    const desde = f.receita.situacaoEm ? ` desde ${fmtData(f.receita.situacaoEm)}` : "";
    achados.push({
      regra: "FR-CNPJ-IRREGULAR",
      tipo: "ESTADO",
      severidade,
      categoria: "FRAUDE",
      titulo: naoEncontrada
        ? `CNPJ de ${f.nome} não consta na base pública da Receita`
        : `CNPJ de ${f.nome} está ${situacao} na Receita e segue recebendo`,
      descricao:
        (naoEncontrada
          ? `O CNPJ ${fmtDocumento(f.cnpj)} não foi encontrado na base pública da Receita Federal (consulta de ${fmtData(f.receita.consultadoEm)}). ` +
            `Pode ser empresa aberta há poucas semanas, que a base pública ainda não conhece — ou um número que não existe. `
          : `A Receita Federal registra o CNPJ ${fmtDocumento(f.cnpj)} como ${situacao}${desde}. `) +
        (pagos.length > 0
          ? `Mesmo assim, ${empresasDe(f)} pagou ${fmtBRL(valorPago)} em ${pagos.length} título(s) a esse fornecedor nos últimos 12 meses. `
          : "") +
        (abertos.length > 0 ? `Há ${fmtBRL(valorAberto)} em ${abertos.length} título(s) EM ABERTO, ainda por pagar. ` : "") +
        (naoEncontrada
          ? ""
          : `Empresa baixada deixou de existir; inapta não pode emitir nota válida; suspensa ou nula é intervenção do fisco. ` +
            `Em qualquer caso, a nota que sustenta o pagamento não vale como despesa nem como crédito.`),
      recomendacao:
        (abertos.length > 0 ? "Segurar o pagamento em aberto até a conferência. " : "") +
        (naoEncontrada
          ? "Conferir o CNPJ no cartão da Receita (site oficial): se existe e está ativo, o cadastro da Omie tem o número certo e a base pública só está atrasada; se não existe, o número do cadastro está errado ou o fornecedor não é quem diz ser."
          : "Conferir no cartão CNPJ da Receita se a empresa foi sucedida por outra (novo CNPJ do mesmo dono) e, nesse caso, atualizar o cadastro na Omie e exigir nota do CNPJ ativo. Se não há sucessora, apurar quem aprovou os pagamentos e com que documento fiscal."),
      valorCents: valorPago + valorAberto,
      dataReferencia: ctx.dataReferencia,
      entidadeTipo: "OmieParceiro",
      entidadeId: f.cadastros[0]?.id,
      entidadeRef: f.nome,
      evidencia: {
        fornecedor: f.nome,
        documento: fmtDocumento(f.cnpj),
        ...retratoDaReceita(f.receita),
        pagoEm12Meses: valorPago,
        titulosPagos: pagos.length,
        emAberto: valorAberto,
        titulosEmAberto: abertos.length,
        titulos: [...abertos, ...pagos].slice(0, 20).map((t) => ({
          empresa: t.conexaoApelido,
          lancamento: t.codigoLancamento,
          documento: t.numeroDocumento,
          vencimento: t.dataVencimento,
          valor: t.valorDocumentoCents,
          situacao: emAberto(t) ? "em aberto" : "pago",
        })),
      },
      chave: chaveAchado("FR-CNPJ-IRREGULAR", f.cnpj),
    });
  }
  return achados;
}

// ---------------------------------------------------------------------------
// FR-CNPJ-RECENTE — empresa aberta há poucos meses já recebendo valor alto
// ---------------------------------------------------------------------------
// Diferente de FR-FORNECEDOR-NOVO-ALTO, que olha a data do CADASTRO na Omie:
// aqui é a data de ABERTURA da empresa na Receita. Fornecedor antigo
// cadastrado hoje é normal; empresa que abriu em março e em junho já
// faturou o dobro da materialidade para o grupo é o perfil de empresa de
// fachada — sobretudo com capital social simbólico e porte de MEI/ME, que
// são os agravantes listados na descrição.
const DIAS_EMPRESA_RECENTE = 183;
const CAPITAL_SIMBOLICO_CENTS = 10_000_00;

export function cnpjRecente(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const achados: AchadoNovo[] = [];
  for (const f of fornecedoresComReceita(ctx)) {
    const abertura = f.receita.inicioAtividade;
    if (!abertura) continue;

    const datas = f.titulos.map((t) => (t.dataEmissao ?? t.dataVencimento).getTime());
    const primeiroTitulo = new Date(Math.min(...datas));
    const idadeNoPrimeiroTitulo = diasEntre(abertura, primeiroTitulo);
    if (idadeNoPrimeiroTitulo > DIAS_EMPRESA_RECENTE) continue;

    const total = somar(f.titulos, (t) => t.valorDocumentoCents);
    if (total < materialidade * 2) continue;

    const capital = f.receita.capitalSocialCents;
    const porte = f.receita.porte ?? "";
    const pequena = f.receita.mei === true || /MICRO/.test(porte);
    const agravantes: string[] = [];
    if (capital !== null && capital < CAPITAL_SIMBOLICO_CENTS) agravantes.push(`capital social de ${fmtBRL(capital)}`);
    if (pequena) agravantes.push(f.receita.mei ? "porte de MEI" : "porte de microempresa");
    if (idadeNoPrimeiroTitulo < 0) agravantes.push("título emitido ANTES da data de abertura");

    const base = severidadePorValor(total, materialidade);
    achados.push({
      regra: "FR-CNPJ-RECENTE",
      tipo: "ESTADO",
      severidade: agravantes.length >= 2 ? agravar(base) : base,
      categoria: "FRAUDE",
      titulo: `${f.nome} abriu há ${Math.max(0, Math.round(idadeNoPrimeiroTitulo / 30))} mês(es) e já recebe ${fmtBRL(total)}`,
      descricao:
        `A Receita Federal registra a abertura de ${f.nome} (CNPJ ${fmtDocumento(f.cnpj)}) em ${fmtData(abertura)}. ` +
        `O primeiro título a pagar do grupo para esse fornecedor é de ${fmtData(primeiroTitulo)} — ` +
        (idadeNoPrimeiroTitulo < 0
          ? `ANTES de a empresa existir — `
          : `${idadeNoPrimeiroTitulo} dia(s) depois — `) +
        `e ${f.titulos.length} título(s) já somam ${fmtBRL(total)} (${(total / materialidade).toFixed(1)}× a materialidade). ` +
        (agravantes.length > 0 ? `Agravantes: ${agravantes.join(", ")}. ` : "") +
        `Empresa recém-aberta faturando alto para um cliente só é o perfil típico tanto de um prestador novo legítimo ` +
        `quanto de uma empresa aberta para receber — a diferença está em quem a indicou e no que ela entregou.`,
      recomendacao:
        "Conferir quem indicou o fornecedor, se houve cotação com outros, se há contrato assinado e o que foi entregue " +
        "(nota, relatório, medição). Para empresa com capital simbólico e porte de MEI/ME recebendo esse volume, exigir " +
        "também comprovação de estrutura (funcionários, veículos, endereço) compatível com o serviço.",
      valorCents: total,
      dataReferencia: ctx.dataReferencia,
      entidadeTipo: "OmieParceiro",
      entidadeId: f.cadastros[0]?.id,
      entidadeRef: f.nome,
      evidencia: {
        fornecedor: f.nome,
        documento: fmtDocumento(f.cnpj),
        ...retratoDaReceita(f.receita),
        primeiroTitulo: primeiroTitulo.toISOString(),
        diasEntreAberturaEPrimeiroTitulo: idadeNoPrimeiroTitulo,
        titulos: f.titulos.length,
        total,
        agravantes,
      },
      chave: chaveAchado("FR-CNPJ-RECENTE", f.cnpj),
    });
  }
  return achados;
}

// ---------------------------------------------------------------------------
// FR-CNAE-INCOMPATIVEL — a atividade declarada não tem a ver com o que se paga
// ---------------------------------------------------------------------------
// A pergunta é simples e ninguém faz: um posto de combustível cobrando
// "consultoria"? uma loja de roupas cobrando "manutenção de veículos"? O
// CNAE principal é o que a empresa declarou fazer; a categoria do título é
// o que a empresa recebeu por fazer. Quando os dois não conversam, ou a
// categoria está errada (erro de processo, que distorce o DRE) ou a nota é
// de fachada — e a segunda hipótese é o motivo desta regra.
//
// COMO FUNCIONA. Cada lado cai numa FAMÍLIA:
//   - a categoria do título, por expressão sobre a descrição
//     (FAMILIA_DA_CATEGORIA);
//   - o CNAE, pelos primeiros dígitos — divisão (2), grupo (3) ou classe (4),
//     o prefixo mais longo que casar (FAMILIA_DO_CNAE).
// Depois, a tabela INCOMPATIBILIDADES diz, para cada família de categoria,
// quais famílias de CNAE são incompatíveis de forma FORTE (ninguém com
// aquela atividade presta aquele serviço) ou FRACA (raro, mas acontece —
// transportadora que revende diesel, concessionária que aluga carro). O que
// não está na tabela é plausível, e a regra se cala. Só o que está listado
// vira achado: forte é MÉDIA quando o valor passa da materialidade (BAIXA
// abaixo dela); fraca é sempre INFO.
//
// CATEGORIAS FORA DA CONTA: vale, benefício, cartão, reembolso, diária —
// pagas a operadoras de benefício (CNAE financeiro) e a pessoas, onde o
// CNAE não diz nada sobre o que se comprou.
type Familia =
  | "COMBUSTIVEL"
  | "MANUTENCAO"
  | "TRANSPORTE"
  | "CONSULTORIA"
  | "ALUGUEL_IMOVEL"
  | "ALUGUEL_VEICULO"
  | "ALIMENTACAO"
  | "TI_TELECOM"
  | "SEGUROS"
  | "FINANCEIRO"
  | "SAUDE"
  | "LIMPEZA_SEGURANCA"
  | "UNIFORME"
  | "VAREJO_ROUPAS"
  | "CONSTRUCAO"
  | "EDUCACAO"
  | "ENERGIA_AGUA"
  | "PUBLICIDADE"
  | "RH"
  | "PESSOAIS"
  | "COMERCIO";

const CATEGORIA_FORA_DA_CONTA = /\bvale\b|benef[ií]cio|cart[aã]o|reembolso|adiantamento|di[aá]ria|ajuda de custo|imposto|tributo|taxa|tarifa|juros|multa/i;

const FAMILIA_DA_CATEGORIA: [RegExp, Familia][] = [
  [/combust|diesel|gasolina|etanol|\barla\b|abastec|\bposto/i, "COMBUSTIVEL"],
  [/manuten|pe[cç]as?\b|pneu|oficina|reparo|conserto|lataria|funilaria|borracharia|lubrific|revis[aã]o|mec[aâ]nic|autope[cç]a|retif/i, "MANUTENCAO"],
  [/(aluguel|loca[cç][aã]o)\s*(de\s+)?(im[oó]ve|sala|galp|garagem|p[aá]tio|escrit|terreno|pr[eé]dio)|condom[ií]nio|\biptu\b/i, "ALUGUEL_IMOVEL"],
  [/(aluguel|loca[cç][aã]o)\s*(de\s+)?(ve[ií]culo|carro|van|[oô]nibus|caminh|frota|m[aá]quina|equipamento)/i, "ALUGUEL_VEICULO"],
  [/frete|fretamento|transporte|subcontrat|agregado|carreteiro|log[ií]stic/i, "TRANSPORTE"],
  [/consultor|assessor|advocac|advogad|jur[ií]dic|cont[aá]bil|contabil|auditor|honor[aá]rio|per[ií]cia/i, "CONSULTORIA"],
  [/alimenta|refei|restaurante|lanch|cesta b[aá]sica|supermercado|padaria|marmita/i, "ALIMENTACAO"],
  [/telefon|internet|software|sistema|inform[aá]tica|\bti\b|licen[cç]a de uso|rastrea|telemetria|tecnologia|dados m[oó]veis|celular|\bsaas\b|hospedagem de site/i, "TI_TELECOM"],
  [/seguro|ap[oó]lice|sinistro/i, "SEGUROS"],
  [/plano de sa[uú]de|m[eé]dic|odont|exame|cl[ií]nica|farm[aá]cia|hospital|psic|fisioter/i, "SAUDE"],
  [/limpeza|vigil[aâ]ncia|seguran[cç]a patrimonial|portaria|zelador|jardin|dedetiza/i, "LIMPEZA_SEGURANCA"],
  [/uniforme|\bepi\b|fardamento|vestu[aá]rio|cal[cç]ado|\bbota/i, "UNIFORME"],
  [/\bobra|constru|reforma|pedreiro|alvenaria|pintura predial|hidr[aá]ulic|el[eé]trica predial/i, "CONSTRUCAO"],
  [/treinamento|\bcurso|educa|escola|faculdade|capacita/i, "EDUCACAO"],
  [/energia|luz el[eé]trica|\b[aá]gua\b|saneamento|esgoto|g[aá]s encanado/i, "ENERGIA_AGUA"],
  [/publicidade|propaganda|marketing|an[uú]ncio|m[ií]dia|brinde/i, "PUBLICIDADE"],
];

// Prefixos do CNAE 2.x: classe (4 dígitos) antes de divisão (2), porque o
// prefixo mais longo vence. Divisões inteiras só onde a atividade é homogênea
// (49 = transporte terrestre, 86 = saúde); dentro de comércio (46/47), classe
// a classe, porque "comércio varejista" sozinho não diz o que se vende.
const FAMILIA_DO_CNAE: [string, Familia][] = [
  ["4731", "COMBUSTIVEL"], // posto de combustível
  ["4681", "COMBUSTIVEL"], // atacado de combustíveis
  ["192", "COMBUSTIVEL"], // refino
  ["4711", "ALIMENTACAO"], // hipermercado / supermercado
  ["4712", "ALIMENTACAO"], // minimercado
  ["472", "ALIMENTACAO"], // varejo de alimentos, padaria, açougue, bebidas
  ["463", "ALIMENTACAO"], // atacado de alimentos
  ["4771", "SAUDE"], // farmácia
  ["4773", "SAUDE"], // artigos médicos
  ["4781", "VAREJO_ROUPAS"], // vestuário
  ["4782", "VAREJO_ROUPAS"], // calçados
  ["4642", "UNIFORME"], // atacado de vestuário
  ["4643", "UNIFORME"], // atacado de calçados
  ["4744", "CONSTRUCAO"], // material de construção varejo
  ["4679", "CONSTRUCAO"], // material de construção atacado
  ["6622", "SEGUROS"], // corretora de seguros
  ["9511", "TI_TELECOM"], // reparação de computadores
  ["10", "ALIMENTACAO"],
  ["11", "ALIMENTACAO"],
  ["13", "UNIFORME"],
  ["14", "UNIFORME"],
  ["15", "UNIFORME"],
  ["21", "SAUDE"],
  ["35", "ENERGIA_AGUA"],
  ["36", "ENERGIA_AGUA"],
  ["37", "ENERGIA_AGUA"],
  ["41", "CONSTRUCAO"],
  ["42", "CONSTRUCAO"],
  ["43", "CONSTRUCAO"],
  ["45", "MANUTENCAO"], // comércio e reparação de veículos e peças
  ["46", "COMERCIO"],
  ["47", "COMERCIO"],
  ["49", "TRANSPORTE"],
  ["50", "TRANSPORTE"],
  ["51", "TRANSPORTE"],
  ["52", "TRANSPORTE"], // armazenamento e auxiliares
  ["53", "TRANSPORTE"], // correio
  ["56", "ALIMENTACAO"],
  ["58", "TI_TELECOM"],
  ["59", "TI_TELECOM"],
  ["60", "TI_TELECOM"],
  ["61", "TI_TELECOM"],
  ["62", "TI_TELECOM"],
  ["63", "TI_TELECOM"],
  ["64", "FINANCEIRO"],
  ["65", "SEGUROS"],
  ["66", "FINANCEIRO"],
  ["68", "ALUGUEL_IMOVEL"],
  ["69", "CONSULTORIA"], // jurídico, contabilidade, auditoria
  ["70", "CONSULTORIA"], // consultoria em gestão
  ["73", "PUBLICIDADE"],
  ["77", "ALUGUEL_VEICULO"],
  ["78", "RH"],
  ["80", "LIMPEZA_SEGURANCA"],
  ["81", "LIMPEZA_SEGURANCA"],
  ["85", "EDUCACAO"],
  ["86", "SAUDE"],
  ["96", "PESSOAIS"],
];

// Para cada família de CATEGORIA paga, as famílias de CNAE que não combinam.
// Ausente da lista = plausível = silêncio. Compatibilidades óbvias (posto e
// combustível) não precisam constar; o que a tabela diz é a exceção.
const INCOMPATIBILIDADES: Record<string, { forte: Familia[]; fraca: Familia[] }> = {
  COMBUSTIVEL: {
    forte: ["VAREJO_ROUPAS", "CONSULTORIA", "ALUGUEL_IMOVEL", "SAUDE", "EDUCACAO", "ALIMENTACAO", "PUBLICIDADE", "RH", "PESSOAIS", "LIMPEZA_SEGURANCA", "UNIFORME", "CONSTRUCAO", "SEGUROS"],
    fraca: ["MANUTENCAO", "TI_TELECOM", "TRANSPORTE", "COMERCIO"],
  },
  MANUTENCAO: {
    forte: ["VAREJO_ROUPAS", "CONSULTORIA", "ALUGUEL_IMOVEL", "SAUDE", "EDUCACAO", "ALIMENTACAO", "PUBLICIDADE", "RH", "PESSOAIS", "FINANCEIRO", "SEGUROS", "LIMPEZA_SEGURANCA", "UNIFORME"],
    fraca: ["TRANSPORTE", "TI_TELECOM", "CONSTRUCAO", "COMBUSTIVEL"],
  },
  TRANSPORTE: {
    forte: ["VAREJO_ROUPAS", "CONSULTORIA", "ALUGUEL_IMOVEL", "SAUDE", "EDUCACAO", "ALIMENTACAO", "PUBLICIDADE", "PESSOAIS", "SEGUROS", "UNIFORME", "ENERGIA_AGUA", "LIMPEZA_SEGURANCA"],
    fraca: ["COMBUSTIVEL", "MANUTENCAO", "COMERCIO", "CONSTRUCAO", "RH", "TI_TELECOM"],
  },
  CONSULTORIA: {
    forte: ["COMBUSTIVEL", "VAREJO_ROUPAS", "MANUTENCAO", "ALIMENTACAO", "TRANSPORTE", "CONSTRUCAO", "PESSOAIS", "ENERGIA_AGUA", "UNIFORME", "LIMPEZA_SEGURANCA", "ALUGUEL_VEICULO"],
    fraca: ["COMERCIO", "ALUGUEL_IMOVEL", "SAUDE", "EDUCACAO", "TI_TELECOM", "PUBLICIDADE", "RH", "FINANCEIRO", "SEGUROS"],
  },
  ALUGUEL_IMOVEL: {
    forte: ["COMBUSTIVEL", "VAREJO_ROUPAS", "MANUTENCAO", "ALIMENTACAO", "CONSULTORIA", "SAUDE", "EDUCACAO", "TI_TELECOM", "PUBLICIDADE", "RH", "PESSOAIS", "LIMPEZA_SEGURANCA", "UNIFORME"],
    fraca: ["TRANSPORTE", "COMERCIO", "CONSTRUCAO", "ALUGUEL_VEICULO"],
  },
  ALUGUEL_VEICULO: {
    forte: ["VAREJO_ROUPAS", "ALIMENTACAO", "CONSULTORIA", "SAUDE", "EDUCACAO", "PESSOAIS", "UNIFORME", "LIMPEZA_SEGURANCA"],
    fraca: ["COMBUSTIVEL", "ALUGUEL_IMOVEL", "COMERCIO"],
  },
  ALIMENTACAO: {
    forte: ["VAREJO_ROUPAS", "MANUTENCAO", "CONSULTORIA", "ALUGUEL_IMOVEL", "TRANSPORTE", "CONSTRUCAO", "TI_TELECOM", "SAUDE", "EDUCACAO", "SEGUROS", "UNIFORME", "ENERGIA_AGUA", "LIMPEZA_SEGURANCA", "PUBLICIDADE"],
    fraca: ["COMBUSTIVEL", "COMERCIO", "RH", "PESSOAIS"],
  },
  TI_TELECOM: {
    forte: ["COMBUSTIVEL", "VAREJO_ROUPAS", "MANUTENCAO", "ALIMENTACAO", "ALUGUEL_IMOVEL", "TRANSPORTE", "CONSTRUCAO", "SAUDE", "PESSOAIS", "UNIFORME", "LIMPEZA_SEGURANCA", "ENERGIA_AGUA"],
    fraca: ["CONSULTORIA", "COMERCIO", "PUBLICIDADE", "EDUCACAO", "RH", "FINANCEIRO", "SEGUROS"],
  },
  SEGUROS: {
    forte: ["COMBUSTIVEL", "VAREJO_ROUPAS", "MANUTENCAO", "ALIMENTACAO", "ALUGUEL_IMOVEL", "TRANSPORTE", "CONSTRUCAO", "SAUDE", "EDUCACAO", "PESSOAIS", "UNIFORME", "LIMPEZA_SEGURANCA", "TI_TELECOM", "ENERGIA_AGUA", "PUBLICIDADE", "RH"],
    fraca: ["CONSULTORIA", "COMERCIO", "ALUGUEL_VEICULO"],
  },
  SAUDE: {
    forte: ["COMBUSTIVEL", "VAREJO_ROUPAS", "MANUTENCAO", "ALIMENTACAO", "ALUGUEL_IMOVEL", "TRANSPORTE", "CONSTRUCAO", "CONSULTORIA", "EDUCACAO", "TI_TELECOM", "PUBLICIDADE", "PESSOAIS", "UNIFORME", "LIMPEZA_SEGURANCA", "ENERGIA_AGUA", "ALUGUEL_VEICULO"],
    fraca: ["COMERCIO", "RH"],
  },
  LIMPEZA_SEGURANCA: {
    forte: ["COMBUSTIVEL", "VAREJO_ROUPAS", "MANUTENCAO", "ALIMENTACAO", "CONSULTORIA", "SAUDE", "EDUCACAO", "FINANCEIRO", "SEGUROS", "TI_TELECOM", "PUBLICIDADE", "ALUGUEL_IMOVEL"],
    fraca: ["TRANSPORTE", "COMERCIO", "RH", "CONSTRUCAO", "PESSOAIS"],
  },
  UNIFORME: {
    forte: ["COMBUSTIVEL", "MANUTENCAO", "ALIMENTACAO", "CONSULTORIA", "ALUGUEL_IMOVEL", "TRANSPORTE", "CONSTRUCAO", "SAUDE", "EDUCACAO", "FINANCEIRO", "SEGUROS", "TI_TELECOM", "LIMPEZA_SEGURANCA", "ENERGIA_AGUA"],
    fraca: ["COMERCIO", "PUBLICIDADE", "PESSOAIS"],
  },
  CONSTRUCAO: {
    forte: ["VAREJO_ROUPAS", "ALIMENTACAO", "CONSULTORIA", "SAUDE", "EDUCACAO", "FINANCEIRO", "SEGUROS", "TRANSPORTE", "COMBUSTIVEL", "PESSOAIS", "TI_TELECOM", "PUBLICIDADE"],
    fraca: ["COMERCIO", "MANUTENCAO", "ALUGUEL_IMOVEL", "LIMPEZA_SEGURANCA", "RH", "ALUGUEL_VEICULO"],
  },
  EDUCACAO: {
    forte: ["COMBUSTIVEL", "VAREJO_ROUPAS", "MANUTENCAO", "ALIMENTACAO", "ALUGUEL_IMOVEL", "TRANSPORTE", "CONSTRUCAO", "SAUDE", "FINANCEIRO", "SEGUROS", "PESSOAIS", "UNIFORME", "LIMPEZA_SEGURANCA", "ENERGIA_AGUA"],
    fraca: ["CONSULTORIA", "TI_TELECOM", "COMERCIO", "PUBLICIDADE", "RH"],
  },
  ENERGIA_AGUA: {
    forte: ["VAREJO_ROUPAS", "MANUTENCAO", "ALIMENTACAO", "CONSULTORIA", "TRANSPORTE", "SAUDE", "EDUCACAO", "PESSOAIS", "UNIFORME", "PUBLICIDADE", "LIMPEZA_SEGURANCA", "TI_TELECOM", "RH"],
    fraca: ["ALUGUEL_IMOVEL", "COMERCIO", "CONSTRUCAO", "COMBUSTIVEL"],
  },
  PUBLICIDADE: {
    forte: ["COMBUSTIVEL", "VAREJO_ROUPAS", "MANUTENCAO", "ALIMENTACAO", "ALUGUEL_IMOVEL", "TRANSPORTE", "CONSTRUCAO", "SAUDE", "EDUCACAO", "FINANCEIRO", "SEGUROS", "UNIFORME", "LIMPEZA_SEGURANCA", "ENERGIA_AGUA", "PESSOAIS"],
    fraca: ["CONSULTORIA", "TI_TELECOM", "COMERCIO", "RH"],
  },
};

export function familiaDaCategoria(descricao: string | null | undefined): Familia | null {
  if (!descricao || CATEGORIA_FORA_DA_CONTA.test(descricao)) return null;
  for (const [re, familia] of FAMILIA_DA_CATEGORIA) if (re.test(descricao)) return familia;
  return null;
}

export function familiaDoCnae(codigo: string | null | undefined): Familia | null {
  const d = (codigo ?? "").replace(/\D/g, "");
  if (d.length < 2) return null;
  let melhor: [string, Familia] | null = null;
  for (const entrada of FAMILIA_DO_CNAE) {
    if (d.startsWith(entrada[0]) && (!melhor || entrada[0].length > melhor[0].length)) melhor = entrada;
  }
  return melhor?.[1] ?? null;
}

export function forcaDaIncompatibilidade(categoria: Familia, cnae: Familia): "forte" | "fraca" | null {
  if (categoria === cnae) return null;
  const regra = INCOMPATIBILIDADES[categoria];
  if (!regra) return null;
  if (regra.forte.includes(cnae)) return "forte";
  if (regra.fraca.includes(cnae)) return "fraca";
  return null;
}

export function cnaeIncompativel(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const achados: AchadoNovo[] = [];
  for (const f of fornecedoresComReceita(ctx)) {
    const familiaCnae = familiaDoCnae(f.receita.cnaeCodigo);
    if (!familiaCnae) continue;

    type Linha = { categoria: string; familia: Familia; forca: "forte" | "fraca"; titulos: number; valor: number };
    const linhas: Linha[] = [];
    for (const [categoria, grupo] of agrupar(f.titulos, (t) => t.categoriaDescricao ?? "")) {
      const familiaCategoria = familiaDaCategoria(categoria);
      if (!familiaCategoria) continue;
      const forca = forcaDaIncompatibilidade(familiaCategoria, familiaCnae);
      if (!forca) continue;
      linhas.push({ categoria, familia: familiaCategoria, forca, titulos: grupo.length, valor: somar(grupo, (t) => t.valorDocumentoCents) });
    }
    if (linhas.length === 0) continue;

    const fortes = linhas.filter((l) => l.forca === "forte");
    const valor = somar(linhas, (l) => l.valor);
    const valorForte = somar(fortes, (l) => l.valor);
    const severidade = fortes.length === 0 ? "INFO" : valorForte >= materialidade ? "MEDIA" : "BAIXA";
    const cnae = `${fmtCnae(f.receita.cnaeCodigo)} — ${f.receita.cnaeDescricao ?? "sem descrição"}`;
    const categorias = linhas.map((l) => `"${l.categoria}"`).join(", ");

    achados.push({
      regra: "FR-CNAE-INCOMPATIVEL",
      tipo: "ESTADO",
      severidade,
      categoria: "FRAUDE",
      titulo:
        fortes.length > 0
          ? `${f.nome} (${f.receita.cnaeDescricao ?? "CNAE " + fmtCnae(f.receita.cnaeCodigo)}) recebe por ${fortes.map((l) => `"${l.categoria}"`).join(", ")}`
          : `Atividade de ${f.nome} não é a esperada para ${categorias}`,
      descricao:
        `A atividade principal de ${f.nome} na Receita Federal é ${cnae}. Nos títulos do grupo, o fornecedor recebe ` +
        `${fmtBRL(valor)} em ${somar(linhas, (l) => l.titulos)} título(s) lançados em ${categorias} — ` +
        (fortes.length > 0
          ? `categoria(s) que essa atividade não presta. `
          : `combinação rara para essa atividade, embora possível. `) +
        `Ou a categoria do lançamento está errada (e o DRE está lendo a despesa no lugar errado), ou a nota é de uma ` +
        `empresa que não faz o que a nota diz — e a segunda hipótese é a que precisa ser afastada.`,
      recomendacao:
        fortes.length > 0
          ? "Abrir a nota fiscal de um dos títulos e ler a descrição do serviço: se ela bate com a categoria, conferir com o fornecedor por que a atividade da Receita é outra (CNAE desatualizado é comum e se corrige); se bate com o CNAE, corrigir a categoria na Omie. Se nem uma nem outra, apurar quem contratou e o que foi entregue."
          : "Nenhuma ação imediata. Registrar para a próxima revisão de cadastro de fornecedores; se o volume crescer, conferir a nota fiscal de um título.",
      valorCents: valor,
      dataReferencia: ctx.dataReferencia,
      entidadeTipo: "OmieParceiro",
      entidadeId: f.cadastros[0]?.id,
      entidadeRef: f.nome,
      evidencia: {
        fornecedor: f.nome,
        documento: fmtDocumento(f.cnpj),
        ...retratoDaReceita(f.receita),
        familiaDoCnae: familiaCnae,
        categorias: linhas.sort((a, b) => b.valor - a.valor).map((l) => ({
          categoria: l.categoria,
          familia: l.familia,
          incompatibilidade: l.forca,
          titulos: l.titulos,
          valor: l.valor,
        })),
      },
      chave: chaveAchado("FR-CNAE-INCOMPATIVEL", f.cnpj),
    });
  }
  return achados;
}

// ---------------------------------------------------------------------------
// FR-SOCIO-FUNCIONARIO — sócio do fornecedor com o nome de alguém da folha
// ---------------------------------------------------------------------------
// FR-FORNECEDOR-FUNCIONARIO cruza o CPF do fornecedor com o da folha e pega o
// motorista pago como pessoa física. Não pega o motorista que abriu uma
// empresa: o CNPJ é outro documento, e o CPF do sócio não vem no cadastro
// da Omie. Vem, mascarado, no quadro societário da Receita — junto com o
// NOME por extenso, que é o que dá para cruzar.
//
// Nome igual não é a mesma pessoa. Homônimo existe, e "José da Silva" existe
// aos milhares — por isso a regra exige o nome INTEIRO igual, com pelo menos
// duas palavras, e três quando a segunda é um sobrenome muito comum. O que
// sobra é raro o bastante para valer uma pergunta ao RH, e é só isso que o
// achado pede: conferir parentesco ou vínculo, nunca afirmar.
//
// Para o MEI e o empresário individual, a Receita não devolve quadro
// societário: a razão social É o nome do titular (mais o CPF, que aqui é
// descartado). Entra na mesma comparação.
const SOBRENOMES_MUITO_COMUNS = new Set([
  "SILVA", "SANTOS", "OLIVEIRA", "SOUZA", "SOUSA", "PEREIRA", "LIMA", "FERREIRA", "COSTA", "RODRIGUES",
  "ALMEIDA", "NASCIMENTO", "ALVES", "CARVALHO", "GOMES", "MARTINS", "ARAUJO", "RIBEIRO", "BARBOSA", "ROCHA",
  "DIAS", "MOREIRA", "NUNES", "MENDES", "JESUS", "LOPES", "VIEIRA", "MONTEIRO", "CARDOSO", "RAMOS", "REIS",
  "BATISTA", "FREITAS", "MACHADO", "CORREIA", "CASTRO", "PINTO", "MARQUES", "MELO", "CAMPOS", "TEIXEIRA",
  "GONCALVES", "FERNANDES", "CUNHA", "DUARTE", "MORAES", "MORAIS", "AZEVEDO", "BORGES", "MIRANDA", "ANDRADE",
  "SANTANA", "BARROS", "MEDEIROS", "NOGUEIRA", "FARIAS", "FONSECA", "LEITE", "PIRES", "GUIMARAES", "XAVIER",
  "BRITO", "MAGALHAES", "BEZERRA", "SIQUEIRA", "CRUZ", "PAULA", "NEVES", "SALES", "TAVARES", "SOARES", "MOURA",
]);

// Caixa alta, sem acento, sem partícula, sem dígito (o CPF na razão social
// do MEI). Reaproveita a normalização de razão social: ela tira "de/da/do"
// e as formas societárias, que é tudo que separa "JOÃO DA SILVA LTDA" de
// "Joao Silva".
export function nomeComparavel(nome: string): string {
  return normalizarRazaoSocial(nome.replace(/\d+/g, " ")).toUpperCase();
}

// Nome inteiro o bastante para cruzar sem virar loteria de homônimo.
export function nomeCruzavel(nomeNormalizado: string): boolean {
  const palavras = nomeNormalizado.split(" ").filter(Boolean);
  if (palavras.length < 2) return false;
  if (palavras.length === 2 && SOBRENOMES_MUITO_COMUNS.has(palavras[1])) return false;
  return true;
}

type Socio = { nome: string; qualificacao: string | null };

function sociosDe(r: ParceiroReceita): { socio: Socio; origem: string }[] {
  const lista: { socio: Socio; origem: string }[] = [];
  if (Array.isArray(r.socios)) {
    for (const s of r.socios) {
      if (!s || typeof s !== "object" || Array.isArray(s)) continue;
      const nome = (s as Record<string, unknown>).nome;
      const qualificacao = (s as Record<string, unknown>).qualificacao;
      if (typeof nome !== "string" || !nome.trim()) continue;
      lista.push({ socio: { nome, qualificacao: typeof qualificacao === "string" ? qualificacao : null }, origem: "quadro societário" });
    }
  }
  const individual = r.mei === true || /individual/i.test(r.naturezaJuridica ?? "");
  if (individual && r.razaoSocial) {
    // A Receita grava a razão social do MEI como "56.966.710 FULANO DE TAL":
    // a raiz do CNPJ na frente do nome do titular. Sem tirar a raiz, o achado
    // dizia "56.966.710 FULANO, titular de 56.966.710 FULANO" — correto e
    // ilegível. A comparação com a folha já ignora dígitos; aqui é só o nome
    // que a pessoa lê.
    const nomeDoTitular = r.razaoSocial.replace(/^[\d.\-\/\s]+/, "").trim() || r.razaoSocial;
    lista.push({
      socio: { nome: nomeDoTitular, qualificacao: r.mei ? "titular (MEI)" : "titular (empresário individual)" },
      origem: "razão social",
    });
  }
  return lista;
}

export function socioQueEFuncionario(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const motoristasPorNome = agrupar(
    ctx.motoristas.filter((m) => m.name),
    (m) => nomeComparavel(m.name)
  );
  if (motoristasPorNome.size === 0) return [];

  const achados: AchadoNovo[] = [];
  for (const f of fornecedoresComReceita(ctx)) {
    for (const { socio, origem } of sociosDe(f.receita)) {
      const nome = nomeComparavel(socio.nome);
      if (!nomeCruzavel(nome)) continue;
      const motoristas = motoristasPorNome.get(nome);
      if (!motoristas) continue;

      const pagos = pagosEm12Meses(f, ctx);
      const valorPago = somar(pagos, (t) => t.valorPagoCents);
      const total = somar(f.titulos, (t) => t.valorDocumentoCents);

      for (const m of motoristas) {
        achados.push({
          regra: "FR-SOCIO-FUNCIONARIO",
          tipo: "ESTADO",
          // Crítica por desenho: é o conflito de interesse mais direto que
          // existe — a pessoa da folha do lado de quem recebe — e o valor não
          // muda isso. A materialidade fica na evidência, para a triagem.
          severidade: "CRITICA",
          categoria: "FRAUDE",
          titulo: `${socio.nome}, ${origem === "razão social" ? "titular" : "sócio"} de ${f.nome}, tem o mesmo nome de motorista da folha`,
          descricao:
            `O cadastro de ${f.nome} (CNPJ ${fmtDocumento(f.cnpj)}) na Receita Federal traz ${socio.nome}` +
            `${socio.qualificacao ? ` como ${socio.qualificacao}` : ""} (${origem}), e a folha tem um motorista com exatamente esse ` +
            `nome (${m.active ? "ativo" : "desligado"} no cadastro). O grupo tem ${f.titulos.length} título(s) a pagar para esse ` +
            `fornecedor, somando ${fmtBRL(total)}${valorPago > 0 ? `, dos quais ${fmtBRL(valorPago)} pagos nos últimos 12 meses` : ""}. ` +
            `Nome igual não prova que é a mesma pessoa — homônimo existe —, mas é exatamente o cruzamento que a política de ` +
            `conflito de interesse manda fazer: conferir parentesco ou vínculo entre quem está na folha e quem é dono de ` +
            `quem recebe.`,
          recomendacao:
            `Conferir com o RH se o motorista ${m.name} é a mesma pessoa (o cartão CNPJ completo na Receita traz o CPF do ` +
            `sócio mascarado — os dígitos visíveis bastam para comparar com a folha). Sendo a mesma pessoa ou parente, ` +
            `exigir declaração de conflito de interesse e aprovação formal de quem não é o contratante; sem isso, suspender ` +
            `novos pagamentos até a apuração. Sendo homônimo, registrar a conferência para o achado não voltar.`,
          valorCents: total,
          dataReferencia: ctx.dataReferencia,
          entidadeTipo: "OmieParceiro",
          entidadeId: f.cadastros[0]?.id,
          entidadeRef: f.nome,
          evidencia: {
            fornecedor: f.nome,
            documento: fmtDocumento(f.cnpj),
            ...retratoDaReceita(f.receita),
            socio: socio.nome,
            qualificacao: socio.qualificacao,
            origemDoNome: origem,
            motorista: m.name,
            motoristaAtivo: m.active,
            titulos: f.titulos.length,
            total,
            pagoEm12Meses: valorPago,
            acimaDaMaterialidade: total >= materialidade,
          },
          chave: chaveAchado("FR-SOCIO-FUNCIONARIO", f.cnpj, m.id),
        });
      }
    }
  }
  return achados;
}

// ---------------------------------------------------------------------------
// FR-MEI-ACIMA-DO-TETO — o MEI que só com o grupo já passou do teto
// ---------------------------------------------------------------------------
// O MEI fatura até R$ 81 mil por ano (LC 123/2006, art. 18-A). Um MEI que
// recebeu mais do que isso SÓ do grupo está, no mínimo, desenquadrado sem
// saber — e a nota dele passa a ser de uma empresa que não pode emiti-la
// nesse regime. Mais que fiscal, é trabalhista: uma pessoa só, prestando
// serviço contínuo a um cliente só, acima do que um MEI pode faturar, é o
// desenho que a Justiça do Trabalho lê como vínculo. Informativo, porque
// o risco é da empresa e o conserto é de contrato, não de pagamento.
const TETO_ANUAL_MEI_CENTS = 81_000_00;
// Até 20% acima do teto o MEI paga a diferença e continua; acima disso é
// desenquadramento retroativo a janeiro. A severidade acompanha.
const TOLERANCIA_MEI = 1.2;

export function meiAcimaDoTeto(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const achados: AchadoNovo[] = [];
  for (const f of fornecedoresComReceita(ctx)) {
    if (f.receita.mei !== true) continue;
    const pagos = pagosEm12Meses(f, ctx);
    const valorPago = somar(pagos, (t) => t.valorPagoCents);
    if (valorPago <= TETO_ANUAL_MEI_CENTS) continue;

    const acimaDaTolerancia = valorPago > TETO_ANUAL_MEI_CENTS * TOLERANCIA_MEI;
    achados.push({
      regra: "FR-MEI-ACIMA-DO-TETO",
      tipo: "ESTADO",
      severidade: acimaDaTolerancia ? "BAIXA" : "INFO",
      categoria: "RISCO_FINANCEIRO",
      titulo: `MEI ${f.nome} recebeu ${fmtBRL(valorPago)} do grupo em 12 meses — acima do teto do MEI`,
      descricao:
        `${f.nome} (CNPJ ${fmtDocumento(f.cnpj)}) é MEI na Receita Federal, e ${empresasDe(f)} pagou a ele ${fmtBRL(valorPago)} ` +
        `em ${pagos.length} título(s) nos últimos 12 meses — ${fmtBRL(valorPago - TETO_ANUAL_MEI_CENTS)} acima do teto anual ` +
        `de faturamento do MEI (${fmtBRL(TETO_ANUAL_MEI_CENTS)}), só com o que o grupo pagou. ` +
        (acimaDaTolerancia
          ? `Passou também dos 20% de tolerância: é desenquadramento retroativo, e a nota emitida como MEI deixa de ser a nota certa. `
          : `Dentro dos 20% de tolerância, o MEI recolhe a diferença e continua — mas o próximo ano começa acima do teto. `) +
        `Uma pessoa só, faturando acima do que o regime permite para um cliente só, é o desenho que uma reclamação ` +
        `trabalhista lê como vínculo.`,
      recomendacao:
        "Avisar o fornecedor do desenquadramento (a nota dele precisa mudar de regime) e levar o caso ao RH e ao contador: " +
        "se o serviço é contínuo e pessoal, decidir entre contratar como empregado ou espalhar a demanda entre mais " +
        "prestadores. Não é o pagamento que está errado; é o contrato.",
      valorCents: valorPago,
      dataReferencia: ctx.dataReferencia,
      entidadeTipo: "OmieParceiro",
      entidadeId: f.cadastros[0]?.id,
      entidadeRef: f.nome,
      evidencia: {
        fornecedor: f.nome,
        documento: fmtDocumento(f.cnpj),
        ...retratoDaReceita(f.receita),
        pagoEm12Meses: valorPago,
        titulosPagos: pagos.length,
        tetoAnualMei: TETO_ANUAL_MEI_CENTS,
        excedente: valorPago - TETO_ANUAL_MEI_CENTS,
        acimaDaMaterialidade: valorPago >= materialidade,
      },
      chave: chaveAchado("FR-MEI-ACIMA-DO-TETO", f.cnpj),
    });
  }
  return achados;
}
