import type { ChaveDre } from "./dre";
import { sugerirSubgrupo } from "./subgrupos";

// RECLASSIFICAÇÕES SUGERIDAS — a revisão de custos de outubro/2026 em forma de
// regra.
//
// Cada regra diz: a categoria cuja descrição casa com o padrão, e que hoje
// está numa destas linhas, vai para aquela linha e subgrupo, por este motivo.
// A tela lista o "de → para" de cada categoria com o valor de 12 meses, e
// nada muda sem alguém confirmar: classificar decide o lucro da empresa, e
// essa decisão continua tendo dono e data (ver custos/actions.ts).
//
// Além das mudanças de linha, toda categoria sem subgrupo recebe a sugestão
// do catálogo (subgrupos.ts) na linha em que está — é assim que o catálogo se
// preenche sem classificar duzentas categorias uma a uma.

export type RegraReclassificacao = {
  padrao: RegExp;
  // Só quando a categoria está numa destas linhas hoje.
  de: ChaveDre[];
  para: ChaveDre;
  // Sem subgrupo: o catálogo sugere pela descrição, na linha de destino.
  subgrupo?: string;
  motivo: string;
};

const r = (padrao: RegExp, de: ChaveDre[], para: ChaveDre, motivo: string, subgrupo?: string): RegraReclassificacao => ({ padrao, de, para, motivo, subgrupo });

const RECEITAS: ChaveDre[] = ["RECEITA_BRUTA", "OUTRAS_RECEITAS"];

// A ORDEM IMPORTA: vale a primeira regra que casa. "Devolução de empréstimo"
// é empréstimo antes de ser devolução; "Comissão sobre venda de veículo" é
// venda de veículo antes de ser comissão.
export const REGRAS_RECLASSIFICACAO: RegraReclassificacao[] = [
  // ---------------- Receita bruta e outras receitas
  r(/capital de giro|empr[ée]stimo|desconto de duplicata/i, [...RECEITAS, "DESPESA_GERAL"], "FINANCIAMENTO_INVESTIMENTO",
    "Entrada ou devolução de empréstimo é dívida, não receita: o principal vai para a linha dos financiamentos.", "Empréstimos e capital de giro"),
  r(/t[íi]tulo de capitaliza|capitaliza[çc][ãa]o/i, [...RECEITAS, "DESPESA_FINANCEIRA"], "FINANCIAMENTO_INVESTIMENTO",
    "Título de capitalização é aplicação: o resgate devolve o que foi posto, e a parcela não é despesa.", "Aplicações e capitalização"),
  r(/venda de (ve[íi]culo|ativo)|devolu[çc][õo]es de compra de ativo|comiss[ãa]o sobre venda de ve/i, [...RECEITAS, "DESPESA_GERAL", "DESPESA_VEICULOS"], "FINANCIAMENTO_INVESTIMENTO",
    "Venda de veículo é desinvestimento: abate a compra de frota, não é resultado da operação. No EBITDA, faz o mês da venda parecer um mês bom.", "Venda de veículos"),
  r(/dividendos? recebidos?/i, RECEITAS, "RECEITA_FINANCEIRA", "Dividendo recebido é rendimento de investimento, não serviço prestado."),
  r(/venda de (pneu|[óo]leo|sucata)|avaria|devolu[çc]|reembolso|cr[ée]dito n[ãa]o utilizado|pagamentos? n[ãa]o identificad|confraterniza/i, ["RECEITA_BRUTA"], "OUTRAS_RECEITAS",
    "Não é faturamento de serviço: inflava a receita bruta, base de todo percentual do DRE e da carga tributária efetiva."),

  // ---------------- Despesas financeiras
  r(/^empr[ée]stimo\b|pagamento de empr[ée]stimo|^capital de giro/i, ["DESPESA_FINANCEIRA"], "FINANCIAMENTO_INVESTIMENTO",
    "Parcela de empréstimo e de capital de giro é principal mais juros. O principal não é despesa; separe os juros no Omie numa categoria própria.", "Empréstimos e capital de giro"),
  r(/outras multas|multa da clt/i, ["DESPESA_FINANCEIRA"], "DESPESA_GERAL", "Multa é penalidade controlável, não custo de capital.", "Multas e penalidades"),

  // ---------------- Sócios
  r(/retirada|distribui[çc][ãa]o de lucro|adiantamento de distribui|antecipa[çc][ãa]o de lucro/i, ["DESPESA_SOCIOS", "DESPESA_SALARIOS", "DESPESA_GERAL"], "DISTRIBUICAO_LUCROS",
    "Retirada e distribuição de lucro são destinação do resultado, não despesa: ficam abaixo do resultado líquido. Só o pró-labore é custo."),

  // ---------------- Investimento na frota
  r(/transforma[çc][ãa]o de ve[íi]culo|blindagem/i, ["DESPESA_VEICULOS", "DESPESA_GERAL"], "FINANCIAMENTO_INVESTIMENTO",
    "Adaptação e blindagem ficam no veículo por anos: são investimento, amortizado no contrato, não custo do mês.", "Adequação de frota"),

  // ---------------- Deduções e parcelamentos
  r(/baixa 100% de desconto|desconto de baixa/i, ["CUSTO_SERVICO", "DESPESA_GERAL"], "DEDUCOES",
    "Desconto concedido na baixa do título é receita que não entrou: dedução da receita, não custo.", "Descontos e abatimentos concedidos"),
  r(/parcelamento/i, ["DESPESA_GERAL", "DEDUCOES", "DESPESA_ESTRUTURA"], "FINANCIAMENTO_INVESTIMENTO",
    "Parcelamento é dívida de tributo de anos anteriores: não é custo da operação de hoje nem estrutura que contrato novo deve carregar.", "Parcelamentos de tributos"),
  r(/taxa dtp/i, ["DEDUCOES"], "DESPESA_VEICULOS", "Taxa de operação do veículo, não tributo sobre a receita.", "Regulatório e inspeções"),
  r(/ir servi[çc]o|1708|pcc|5952/i, ["DEDUCOES", "DESPESA_GERAL"], "DESPESA_SERVICOS_TERCEIROS",
    "Imposto retido de fornecedor é parte do preço do serviço contratado, não tributo da empresa.", "Tributos retidos de terceiros"),

  // ---------------- Serviços de terceiros
  r(/advogad|assist[êe]ncia t[ée]cnica judicial|gru judicial|^gru\b/i, ["DESPESA_SERVICOS_TERCEIROS", "DESPESA_ESTRUTURA", "DESPESA_GERAL"], "DESPESA_ADMINISTRATIVA",
    "Jurídico é administração, não operação feita por terceiros. Separe o honorário de êxito tributário do jurídico recorrente: só o recorrente entra no preço.", "Jurídico"),
  r(/controladoria|contabilidade|consultoria|cart[óo]rio|registro de marca|associa[çc][õo]es|consulta de restri/i, ["DESPESA_SERVICOS_TERCEIROS", "DESPESA_ESTRUTURA", "DESPESA_GERAL"], "DESPESA_ADMINISTRATIVA",
    "Despesa administrativa: a linha estava vazia e o que é dela estava em estrutura e terceiros."),
  r(/marketing|seguro garantia|comiss[õo]es clientes|a[çc][ãa]o comercial|kit lanche|coffee|brindes clientes|licita[çc][õo]es|patroc/i, ["DESPESA_SERVICOS_TERCEIROS", "DESPESA_GERAL", "DESPESA_SALARIOS", "DESPESA_VEICULOS"], "DESPESA_COMERCIAL",
    "Custo de ganhar e manter contrato: comercial."),
  r(/^comiss[ãa]o\b/i, ["DESPESA_VEICULOS"], "DESPESA_COMERCIAL", "Comissão de venda não é custo de rodar o veículo.", "Comissões"),
  r(/coordena[çc][ãa]o/i, ["DESPESA_SERVICOS_TERCEIROS"], "DESPESA_SALARIOS", "Coordenação da operação é mão de obra direta, mesmo contratada como PJ.", "Supervisão e coordenação"),
  r(/aluguel de ve[íi]culo/i, ["DESPESA_VEICULOS"], "DESPESA_SERVICOS_TERCEIROS",
    "Veículo alugado é frota de terceiros: lido junto da sublocação e dos agregados, permite comparar frota própria com terceirizada.", "Locação de veículos de terceiros"),

  // ---------------- Veículos e pessoas: o que é sede
  r(/toldos|aluguel de gerador|vistoria de garagem|aluguel garagem|manuten[çc][ãa]o predial/i, ["DESPESA_VEICULOS", "DESPESA_SALARIOS"], "DESPESA_ESTRUTURA",
    "Garagem e prédio são estrutura, não custo do veículo nem da folha."),
  r(/doa[çc][ãa]o/i, ["DESPESA_VEICULOS"], "DESPESA_GERAL", "Doação não é custo do veículo.", "Despesas diversas"),
  r(/^m[ãa]o de obra$/i, ["DESPESA_SALARIOS"], "DESPESA_VEICULOS", "Mão de obra de oficina contratada é manutenção do veículo.", "Manutenção e peças"),
  r(/uber|t[áa]xi/i, ["DESPESA_GERAL"], "DESPESA_SALARIOS", "Deslocamento de motorista é custo da mão de obra direta.", "Viagens e deslocamento"),
  r(/\bplr\b/i, ["DESPESA_GERAL"], "DESPESA_SALARIOS", "PLR é remuneração: folha, dividida entre operação e corporativo pela empresa.", "Benefícios"),
  r(/despesas com inform[áa]tica/i, ["DESPESA_GERAL"], "DESPESA_INFORMATICA", "Informática tem linha própria."),
  r(/free ?lancer/i, ["DESPESA_GERAL"], "DESPESA_SALARIOS", "Motorista avulso é mão de obra direta.", "Avulsos e freelancers"),
  r(/\btfe\b|taxa de fiscaliza/i, ["DESPESA_GERAL"], "DESPESA_ESTRUTURA", "Taxa de funcionamento do estabelecimento é custo da sede.", "Taxas e licenças da sede"),
  r(/artesp|antt|emtu|taxa de turismo/i, ["DESPESA_GERAL"], "DESPESA_VEICULOS", "Taxa de órgão de transporte é custo regulatório do veículo.", "Regulatório e inspeções"),
];

// Categorias que pedem AÇÃO NO OMIE, não reclassificação: a categoria mistura
// naturezas, e nenhuma linha está certa para ela inteira.
export const ABRIR_NO_OMIE: { padrao: RegExp; motivo: string }[] = [
  { padrao: /^cart[ãa]o de cr[ée]dito$/i, motivo: "A fatura do cartão é pagamento de compras (combustível, pedágio, sistemas, viagens), não juro. Lance a fatura rateada pelas categorias de natureza." },
  { padrao: /^compra de servi[çc]os?$/i, motivo: "Separe agregados e fretamento terceirizado (custo direto) de serviços administrativos: é o segundo maior custo variável e hoje não se sabe de qual contrato é." },
  { padrao: /^presta[çc][ãa]o de servi[çc]o$/i, motivo: "Categoria genérica: abra pela natureza do serviço." },
  { padrao: /adiantamento a fornecedor/i, motivo: "Adiantamento não é despesa: apropriar na categoria da nota quando ela chegar." },
  { padrao: /clientes - servi[çc]os prestados/i, motivo: "Abra a receita por segmento (fretamento contínuo, escolar, eventual, locação, terceirização) para medir a margem de cada um." },
];

export type CategoriaParaRevisao = {
  codigo: string;
  descricao: string;
  // A linha em que a categoria está classificada (gravada ou proposta).
  linha: string;
  subgrupo: string | null;
  confirmada: boolean;
  valorCents: number;
};

export type Sugestao = {
  codigo: string;
  descricao: string;
  valorCents: number;
  de: { linha: string; subgrupo: string | null; confirmada: boolean };
  para: { linha: string; subgrupo: string | null };
  tipo: "LINHA" | "SUBGRUPO";
  motivo: string;
};

// A descrição sem o " · EMPRESA" das categorias de código repetido
// (chaveCategoria.ts): os padrões com âncora ("^Empréstimo") olham o nome.
export const semEmpresa = (descricao: string) => descricao.replace(/ · [^·]+$/, "");

export function regraPara(c: Pick<CategoriaParaRevisao, "descricao" | "linha">): RegraReclassificacao | null {
  const texto = semEmpresa(c.descricao);
  return REGRAS_RECLASSIFICACAO.find((x) => (x.de as string[]).includes(c.linha) && x.padrao.test(texto) && x.para !== c.linha) ?? null;
}

export function sugestoesDeReclassificacao(categorias: CategoriaParaRevisao[]): Sugestao[] {
  const lista: Sugestao[] = [];
  for (const c of categorias) {
    if (c.codigo === "RETENCAO_NA_FONTE" || c.codigo === "SEM_CATEGORIA") continue;
    const de = { linha: c.linha, subgrupo: c.subgrupo, confirmada: c.confirmada };
    const regra = regraPara(c);
    if (regra) {
      lista.push({
        codigo: c.codigo,
        descricao: c.descricao,
        valorCents: c.valorCents,
        de,
        para: { linha: regra.para, subgrupo: regra.subgrupo ?? sugerirSubgrupo(regra.para, semEmpresa(c.descricao)) },
        tipo: "LINHA",
        motivo: regra.motivo,
      });
      continue;
    }
    if (c.subgrupo) continue;
    const subgrupo = sugerirSubgrupo(c.linha, semEmpresa(c.descricao));
    if (!subgrupo) continue;
    lista.push({
      codigo: c.codigo,
      descricao: c.descricao,
      valorCents: c.valorCents,
      de,
      para: { linha: c.linha, subgrupo },
      tipo: "SUBGRUPO",
      motivo: "Subgrupo do catálogo pela descrição da categoria.",
    });
  }
  return lista.sort((a, b) => (a.tipo === b.tipo ? Math.abs(b.valorCents) - Math.abs(a.valorCents) : a.tipo === "LINHA" ? -1 : 1));
}

export function acoesNoOmie(categorias: CategoriaParaRevisao[]) {
  return categorias
    .map((c) => ({ ...c, motivo: ABRIR_NO_OMIE.find((a) => a.padrao.test(semEmpresa(c.descricao)))?.motivo }))
    .filter((c): c is CategoriaParaRevisao & { motivo: string } => !!c.motivo)
    .sort((a, b) => Math.abs(b.valorCents) - Math.abs(a.valorCents));
}
