import { LINHA_PESSOAS_CORPORATIVO, type ChaveDre } from "./dre";

// O CATÁLOGO DE SUBGRUPOS DO DRE, com a NATUREZA DE CUSTO de cada um.
//
// O subgrupo era texto livre: servia de etiqueta, e cada pessoa escrevia o
// seu. O catálogo dá a cada linha uma lista fixa — a de um especialista em
// custo de transporte de passageiros — e a cada subgrupo uma natureza, que é o
// que liga o DRE ao orçamento e ao simulador:
//
//   V  variável por km      combustível, pneus, manutenção, pedágio
//   F  fixo por veículo     seguro, IPVA, regulatório, monitoramento
//   M  mão de obra direta   motoristas e monitores: salário, encargos, benefícios
//   T  frota de terceiros   agregados, sublocação, locação de veículos
//   I  indireto             administração central: sede, folha administrativa
//   N  não recorrente       multas, juros de mora, parcelamentos, descontos
//   K  capital              consórcio, financiamento, compra e venda de veículo
//
// Com a natureza, "quanto custa um km" deixa de depender de adivinhar pela
// descrição da categoria, a administração central fica só com o que é
// estrutura recorrente, e a partir de 2027 (CBS) a natureza diz o que gera
// crédito sobre insumos.
//
// Texto livre continua aceito — a empresa pode precisar de um eixo que o
// catálogo não tem —, mas sem natureza.

export type Natureza = "RECEITA" | "TRIBUTO" | "V" | "F" | "M" | "T" | "I" | "N" | "K" | "DESTINACAO";

export const NATUREZAS: Record<Natureza, { rotulo: string; sigla: string; explicacao: string }> = {
  RECEITA: { rotulo: "Receita", sigla: "R", explicacao: "Receita de serviço, por segmento." },
  TRIBUTO: { rotulo: "Tributo sobre a receita", sigla: "Tr", explicacao: "Varia com o faturamento." },
  V: { rotulo: "Variável por km", sigla: "V", explicacao: "Cresce com o quilômetro rodado." },
  F: { rotulo: "Fixo por veículo", sigla: "F", explicacao: "Custa por veículo, rodando ou não." },
  M: { rotulo: "Mão de obra direta", sigla: "M", explicacao: "Motoristas e monitores." },
  T: { rotulo: "Frota de terceiros", sigla: "T", explicacao: "Operação feita com veículo ou empresa de fora." },
  I: { rotulo: "Indireto (administração central)", sigla: "I", explicacao: "Estrutura rateada nos contratos." },
  N: { rotulo: "Não recorrente / controlável", sigla: "N", explicacao: "Não entra no preço; meta de redução." },
  K: { rotulo: "Capital", sigla: "K", explicacao: "Investimento e financiamento da frota." },
  DESTINACAO: { rotulo: "Destinação do resultado", sigla: "D", explicacao: "O que sai do lucro para os sócios." },
};

export type SubgrupoCatalogo = { linha: ChaveDre; nome: string; natureza: Natureza; padrao?: RegExp };

const s = (linha: ChaveDre, nome: string, natureza: Natureza, padrao?: RegExp): SubgrupoCatalogo => ({ linha, nome, natureza, padrao });

// A ORDEM DENTRO DE CADA LINHA IMPORTA: a sugestão automática pega o primeiro
// padrão que casa. "FGTS Rescisório" é rescisão antes de ser encargo; "Sistema
// de multas" é monitoramento antes de ser multa.
export const CATALOGO_SUBGRUPOS: SubgrupoCatalogo[] = [
  s("RECEITA_BRUTA", "Escolar", "RECEITA", /escolar/i),
  s("RECEITA_BRUTA", "Terceirização de mão de obra", "RECEITA", /terceiriza[çc][ãa]o de m[ãa]o/i),
  s("RECEITA_BRUTA", "Terceirização de frota", "RECEITA", /terceiriza[çc][ãa]o de frota/i),
  s("RECEITA_BRUTA", "Locação com motorista", "RECEITA", /(loca[çc][ãa]o|aluguel) c(om|\/) ?motorista/i),
  s("RECEITA_BRUTA", "Locação sem motorista", "RECEITA", /(loca[çc][ãa]o|aluguel) s(em|\/) ?motorista/i),
  s("RECEITA_BRUTA", "Eventual e turismo", "RECEITA", /eventual|turismo|evento/i),
  s("RECEITA_BRUTA", "Fretamento contínuo", "RECEITA", /fretamento|transporte de passageiros/i),
  s("RECEITA_BRUTA", "Revenda e outros", "RECEITA", /revenda|mercadoria|adiantamento de clientes/i),

  s("DEDUCOES", "Descontos e abatimentos concedidos", "N", /desconto|abatimento|baixa 100/i),
  s("DEDUCOES", "Retenções na fonte", "TRIBUTO", /retid|reten[çc]/i),
  s("DEDUCOES", "ISS", "TRIBUTO", /\biss\b/i),
  s("DEDUCOES", "PIS e COFINS", "TRIBUTO", /\bpis\b|cofins/i),
  s("DEDUCOES", "ICMS", "TRIBUTO", /icms/i),
  s("DEDUCOES", "IRPJ e CSLL", "TRIBUTO", /irpj|csll|imposto de renda|contribui[çc][ãa]o social/i),
  s("DEDUCOES", "Simples Nacional", "TRIBUTO", /simples|\bdas\b/i),

  s("OUTRAS_RECEITAS", "Indenizações e sinistros", "N", /sinistro|indeniza|lucros cessantes|seguro|avaria/i),
  s("OUTRAS_RECEITAS", "Venda de sucata e materiais", "N", /venda de (pneu|[óo]leo|sucata|material)|sucata/i),
  s("OUTRAS_RECEITAS", "Recuperações e reembolsos", "N", /reembolso|recupera|devolu|estorno|repasse|cr[ée]dito n[ãa]o utilizado|n[ãa]o identificad|confraterniza/i),

  s("CUSTO_SERVICO", "Custo direto do serviço", "V"),

  s("DESPESA_VEICULOS", "Combustível", "V", /combust|diesel|gasolina|etanol|abastec|carga el[ée]trica|recarga/i),
  s("DESPESA_VEICULOS", "ARLA, óleo e lubrificantes", "V", /arla|[óo]leo|lubrific|filtro/i),
  s("DESPESA_VEICULOS", "Pneus", "V", /pneu|borrach|recap|alinhamento|balanceamento/i),
  s("DESPESA_VEICULOS", "Monitoramento e sistemas de frota", "F", /monitora|rastre|telemetria|sistema de (frota|multas)|internet/i),
  s("DESPESA_VEICULOS", "IPVA, licenciamento e despachante", "F", /ipva|licenciamento|dpvat|despachante|crlv|emplacamento/i),
  s("DESPESA_VEICULOS", "Multas de trânsito", "N", /multa|renainf/i),
  s("DESPESA_VEICULOS", "Sinistros e socorro", "N", /sinistro|franquia|guincho|socorro/i),
  s("DESPESA_VEICULOS", "Manutenção e peças", "V", /manuten|pe[çc]a|oficina|mec[âa]nic|funilaria|m[ãa]o de obra|ar condicionado|chaveiro|acess[óo]rio/i),
  s("DESPESA_VEICULOS", "Pedágio e estacionamento", "V", /ped[áa]gio|estacionamento|zona azul/i),
  s("DESPESA_VEICULOS", "Limpeza e higienização", "V", /limpeza|lavagem|higieniza|dedetiza/i),
  s("DESPESA_VEICULOS", "Seguro de frota", "F", /seguro/i),
  s("DESPESA_VEICULOS", "Pernoite e guarda de veículos", "F", /aluguel garagem|pernoite|guarda de ve[íi]culo/i),
  s("DESPESA_VEICULOS", "Regulatório e inspeções", "F", /emtu|artesp|antt|\bdtp\b|tac[óo]grafo|inspe[çc][ãa]o|vistoria|cadastro|fretado|turismo|visto na declara|inclus[ãa]o ou altera/i),
  s("DESPESA_VEICULOS", "Caracterização e adequação", "F", /adesivo|insulfilm|pel[íi]cula|transforma[çc][ãa]o|blindagem|adapta/i),

  s("DESPESA_SERVICOS_TERCEIROS", "Fretamento terceirizado (agregados)", "T", /compra de servi[çc]o|agregad|terceiriz|subcontrat/i),
  s("DESPESA_SERVICOS_TERCEIROS", "Locação de veículos de terceiros", "T", /subloca|(aluguel|loca[çc][ãa]o) de ve[íi]culo/i),
  s("DESPESA_SERVICOS_TERCEIROS", "Comissão de contrato específico", "T", /^comiss[ãa]o$/i),
  s("DESPESA_SERVICOS_TERCEIROS", "Tributos retidos de terceiros", "I", /pcc|5952|1708|ir servi[çc]o|retid/i),
  s("DESPESA_SERVICOS_TERCEIROS", "Serviços diversos (a abrir)", "I", /presta[çc][ãa]o de servi|adiantamento a fornecedor/i),

  s("DESPESA_SALARIOS", "13º, férias e rescisões", "M", /13|d[ée]cimo|f[ée]rias|rescis|homologa|aviso pr[ée]vio|grrf/i),
  s("DESPESA_SALARIOS", "Saúde ocupacional", "M", /exame|toxicol|admissional|pcmso/i),
  s("DESPESA_SALARIOS", "Benefícios", "M", /vale|refei[çc]|alimenta|assist[êe]ncia (m[ée]dica|odonto)|conv[êe]nio|seguro de vida|benef|\bplr\b|cesta|confraterniza|brinde/i),
  s("DESPESA_SALARIOS", "Encargos (INSS e FGTS)", "M", /\binss\b|fgts|contribui[çc][ãa]o sindical|encargo/i),
  s("DESPESA_SALARIOS", "Uniformes e EPI", "M", /uniforme|\bepi\b|equipamentos de seguran/i),
  s("DESPESA_SALARIOS", "Avulsos e freelancers", "M", /freelanc|free lancer|avulso|di[áa]ria/i),
  s("DESPESA_SALARIOS", "Viagens e deslocamento", "M", /viagem|hospedagem|passagem|uber|t[áa]xi|deslocamento/i),
  s("DESPESA_SALARIOS", "Treinamento", "M", /curso|treinamento/i),
  s("DESPESA_SALARIOS", "Contingências trabalhistas", "N", /processo|judicial|trabalhist|acordo/i),
  s("DESPESA_SALARIOS", "Supervisão e coordenação", "M", /coordena|supervis/i),
  s("DESPESA_SALARIOS", "Salários e horas extras", "M", /sal[áa]ri|ordenado|hora extra|banco de horas|pens[ãa]o|ponto eletr|m[ãa]o de obra|servi[çc]os com pessoal/i),

  s(LINHA_PESSOAS_CORPORATIVO as ChaveDre, "Apoio administrativo (PJ)", "I", /apoio administrativo|presta[çc][ãa]o de servi/i),
  s(LINHA_PESSOAS_CORPORATIVO as ChaveDre, "Oficina própria", "I", /oficina/i),
  s(LINHA_PESSOAS_CORPORATIVO as ChaveDre, "Folha administrativa", "I"),

  s("DESPESA_SOCIOS", "Pró-labore", "I", /pr[óo].?labore/i),
  s("DESPESA_SOCIOS", "Despesas dos sócios", "I", /despesa|reembolso/i),

  s("DESPESA_ESTRUTURA", "Garagem", "I", /garagem|gerador|toldo|p[áa]tio/i),
  s("DESPESA_ESTRUTURA", "Taxas e licenças da sede", "I", /taxa|licen[çc]a|avcb|bombeiro|alvar|\btfe\b/i),
  s("DESPESA_ESTRUTURA", "Segurança patrimonial", "I", /seguran[çc]a|vigil|alarme/i),
  s("DESPESA_ESTRUTURA", "Sede (aluguel e IPTU)", "I", /aluguel|iptu|condom/i),
  s("DESPESA_ESTRUTURA", "Utilidades", "I", /energia|[áa]gua|telefon|internet|celular|\bg[áa]s\b/i),
  s("DESPESA_ESTRUTURA", "Manutenção e conservação", "I", /manuten|constru|conserva|dedetiza|limpeza|cozinha|copa/i),
  s("DESPESA_ESTRUTURA", "Material de escritório", "I", /escrit[óo]rio|papelaria|correio|gr[áa]fic|m[áa]quinas e equipamentos/i),

  s("DESPESA_INFORMATICA", "Sistemas e licenças", "I", /sistema|licen[çc]a|software|assinatura|certificado/i),
  s("DESPESA_INFORMATICA", "Equipamentos e manutenção", "I", /equipamento|impressora|computador|manuten|inform[áa]tica/i),

  s("DESPESA_COMERCIAL", "Licitações e seguro-garantia", "I", /licita|preg[ãa]o|seguro garantia|edital/i),
  s("DESPESA_COMERCIAL", "Comissões", "I", /comiss/i),
  s("DESPESA_COMERCIAL", "Marketing e patrocínio", "I", /marketing|patroc|propaganda|publicidade|a[çc][ãa]o comercial/i),
  s("DESPESA_COMERCIAL", "Relacionamento com clientes", "I", /brinde|coffee|kit lanche|cliente/i),

  s("DESPESA_ADMINISTRATIVA", "Recuperação tributária (êxito)", "N", /recupera[çc][ãa]o tribut|[êe]xito|tributtax/i),
  s("DESPESA_ADMINISTRATIVA", "Jurídico", "I", /advog|jur[íi]dic|honor[áa]rio|gru|judicial/i),
  s("DESPESA_ADMINISTRATIVA", "Contabilidade e controladoria", "I", /contab|controladoria|auditoria/i),
  s("DESPESA_ADMINISTRATIVA", "Consultorias", "I", /consultoria|assessoria/i),
  s("DESPESA_ADMINISTRATIVA", "Cartório, registros e associações", "I", /cart[óo]rio|registro|associa|restri[çc]/i),

  s("DESPESA_GERAL", "Parcelamentos de tributos", "N", /parcelamento/i),
  s("DESPESA_GERAL", "Multas e penalidades", "N", /multa|penalidade/i),
  s("DESPESA_GERAL", "Acertos e pagamentos incorretos", "N", /pagamento incorreto|devolu|acerto|estorno/i),
  s("DESPESA_GERAL", "Descontos de títulos", "N", /desconto/i),
  s("DESPESA_GERAL", "Despesas diversas", "I"),

  s("RECEITA_FINANCEIRA", "Rendimentos de aplicações", "N", /rendimento|aplica|capitaliza/i),
  s("RECEITA_FINANCEIRA", "Dividendos recebidos", "N", /dividendo/i),
  s("RECEITA_FINANCEIRA", "Juros e descontos obtidos", "N", /juros|desconto/i),

  s("DESPESA_FINANCEIRA", "Cartão de crédito (a abrir)", "N", /cart[ãa]o de cr[ée]dito/i),
  s("DESPESA_FINANCEIRA", "Juros de mora e multas", "N", /mora|multa/i),
  s("DESPESA_FINANCEIRA", "Deságio de antecipação", "K", /desconto de duplicata|t[íi]tulo descontado|antecipa/i),
  s("DESPESA_FINANCEIRA", "Juros de empréstimos e financiamentos", "K", /juros/i),
  s("DESPESA_FINANCEIRA", "Tarifas bancárias e IOF", "I", /tarifa|iof|pix|banc/i),

  s("FINANCIAMENTO_INVESTIMENTO", "Venda de veículos", "K", /venda de (ve[íi]culo|ativo)|aliena|comiss[ãa]o sobre venda/i),
  s("FINANCIAMENTO_INVESTIMENTO", "Adequação de frota", "K", /transforma|blindagem|adapta/i),
  s("FINANCIAMENTO_INVESTIMENTO", "Parcelamentos de tributos", "K", /parcelamento/i),
  s("FINANCIAMENTO_INVESTIMENTO", "Consórcio", "K", /cons[óo]rcio/i),
  s("FINANCIAMENTO_INVESTIMENTO", "CDC e financiamento de veículos", "K", /\bcdc\b|financiamento|leasing|finame/i),
  s("FINANCIAMENTO_INVESTIMENTO", "Compra de veículos", "K", /compra de ve[íi]culo|compra de ativo|devolu[çc][õo]es de compra de ativo/i),
  s("FINANCIAMENTO_INVESTIMENTO", "Aplicações e capitalização", "K", /capitaliza|aplica/i),
  s("FINANCIAMENTO_INVESTIMENTO", "Empréstimos e capital de giro", "K", /empr[ée]stimo|m[úu]tuo|capital de giro|desconto de duplicata/i),

  s("TRIBUTO_SOBRE_LUCRO", "IRPJ", "TRIBUTO", /irpj|imposto de renda/i),
  s("TRIBUTO_SOBRE_LUCRO", "CSLL", "TRIBUTO", /csll|contribui[çc][ãa]o social/i),

  s("DISTRIBUICAO_LUCROS", "Retiradas dos sócios", "DESTINACAO", /retirada/i),
  s("DISTRIBUICAO_LUCROS", "Distribuição e antecipação de lucros", "DESTINACAO", /distribui|antecipa|dividendo|lucro/i),
];

export function subgruposDaLinha(linha: string): SubgrupoCatalogo[] {
  return CATALOGO_SUBGRUPOS.filter((c) => c.linha === linha);
}

// A natureza do subgrupo NA LINHA EM QUE O ITEM APARECE. A categoria de
// pessoas é classificada uma vez (DESPESA_SALARIOS) e a empresa do título a
// divide entre operação e corporativo: "Salários" é mão de obra direta na
// operação e administração central no corporativo.
export function naturezaDoSubgrupo(linha: string, subgrupo: string | null | undefined): Natureza | null {
  if (!subgrupo) return null;
  if (linha === LINHA_PESSOAS_CORPORATIVO) return "I";
  const alvo = subgrupo.trim().toLowerCase();
  return CATALOGO_SUBGRUPOS.find((c) => c.linha === linha && c.nome.toLowerCase() === alvo)?.natureza ?? null;
}

// O subgrupo do catálogo que a descrição da categoria sugere naquela linha. O
// último subgrupo de uma linha sem padrão é o "resto" dela (folha
// administrativa, despesas diversas) e só é sugerido quando nada mais casou e
// a linha o tem.
export function sugerirSubgrupo(linha: string, descricao: string): string | null {
  const daLinha = subgruposDaLinha(linha);
  const casou = daLinha.find((c) => c.padrao?.test(descricao));
  if (casou) return casou.nome;
  return daLinha.find((c) => !c.padrao)?.nome ?? null;
}
