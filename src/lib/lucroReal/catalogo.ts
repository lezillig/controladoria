// O CATÁLOGO DO LUCRO REAL — o que cada gasto vale na apuração, que documento
// o sustenta e qual é a base legal.
//
// O ponto de partida do Lucro Real é o lucro contábil; dele se chega ao lucro
// tributável somando as despesas que a lei não aceita (adições) e tirando o
// que ela permite tirar (exclusões), no e-Lalur e no e-Lacs. A regra geral da
// despesa dedutível tem três condições — NECESSÁRIA à atividade, USUAL ou
// NORMAL no tipo de negócio, e COMPROVADA por documento hábil (RIR/2018, art.
// 311; Decreto-Lei 1.598/1977, art. 9º, § 1º). Despesa real sem documento é
// despesa que a fiscalização glosa, e o pagamento sem causa ou a beneficiário
// não identificado ainda carrega IRRF de 35% sobre a base reajustada (Lei
// 8.981/1995, art. 61).
//
// Por isso este catálogo não diz só "dedutível": diz o que precisa existir no
// arquivo para a despesa continuar dedutível depois de uma fiscalização.
//
// ALERTA DE PRECISÃO: o catálogo organiza a análise e aponta a norma; o
// enquadramento é da contabilidade e da assessoria tributária. Os itens com
// `conferir` dependem de confirmação antes de virar procedimento — ou porque a
// norma mudou há pouco (LC 224/2025, Lei 15.270/2025), ou porque há
// divergência entre a Receita e o CARF.

export type Tratamento = "DEDUTIVEL" | "ADICAO" | "LIMITE" | "NAO_E_DESPESA" | "VERIFICAR";

export const ROTULO_TRATAMENTO: Record<Tratamento, string> = {
  DEDUTIVEL: "Dedutível",
  ADICAO: "Indedutível — adicionar",
  LIMITE: "Dedutível até o limite",
  NAO_E_DESPESA: "Não é despesa",
  VERIFICAR: "Depende do fato",
};

export type TipoDeGasto = {
  codigo: string;
  nome: string;
  // Pelo nome da categoria da Omie. O primeiro tipo que casar, na ordem da
  // lista, decide — por isso os específicos (multa de trânsito, leasing) vêm
  // antes dos genéricos (multa, financiamento).
  padrao: RegExp | null;
  tratamento: Tratamento;
  // Documentos que sustentam a despesa numa fiscalização.
  documentos: string[];
  baseLegal: string;
  // O argumento do auditor: o que olhar, onde a despesa costuma cair.
  observacao: string;
  // Exige nota fiscal do fornecedor pessoa jurídica (a varredura cobra o
  // número do documento fiscal no título).
  exigeNota?: boolean;
  // Não é pagamento a um beneficiário que precise de CPF/CNPJ no título
  // (guia de tributo, folha consolidada, tarifa e juros do banco).
  semBeneficiarioProprio?: boolean;
  conferir?: boolean;
};

export const TIPOS_DE_GASTO: TipoDeGasto[] = [
  {
    codigo: "IRPJ_CSLL",
    nome: "IRPJ e CSLL",
    padrao: /\b(irpj|csll)\b|imposto de renda pessoa jur|contribui[çc][ãa]o social sobre o lucro/i,
    tratamento: "ADICAO",
    documentos: ["DARF"],
    baseLegal: "Lei 9.316/1996, art. 1º (a CSLL não reduz a própria base nem a do IRPJ); o IRPJ não é despesa da apuração dele mesmo",
    observacao: "É o resultado da apuração, não custo. No Presumido a empresa os mostra como dedução da receita; no Real eles saem da base e voltam como imposto calculado.",
    semBeneficiarioProprio: true,
  },
  {
    codigo: "MULTA_TRANSITO",
    nome: "Multas de trânsito",
    padrao: /multa.{0,25}(tr[âa]nsito|detran|\bder\b|dnit|\bprf\b|\bcet\b|\bait\b|antt|artesp|infra[çc])|infra[çc][ãa]o de tr[âa]nsito/i,
    tratamento: "ADICAO",
    documentos: ["Auto de infração (AIT)", "Comprovante de pagamento", "Termo de ciência e desconto do condutor, quando for o caso"],
    baseLegal: "RIR/2018, art. 311 (não é despesa necessária); entendimento da Receita e do CARF pela indedutibilidade",
    observacao:
      "Multa punitiva não é custo da atividade. O que reduz o efeito é cobrar do responsável: a parte descontada do motorista na folha deixa de ser despesa da empresa. Há quem sustente a dedutibilidade quando o veículo está a serviço — tese de risco, não de planejamento.",
    conferir: true,
  },
  {
    codigo: "MULTA_PUNITIVA",
    nome: "Multas punitivas (fiscais, trabalhistas, ambientais, de órgãos reguladores)",
    padrao: /auto de infra|multa.{0,20}(fiscal|of[íi]cio|trabalhist|mte|procon|ibama|anatel|antt|ag[êe]ncia)/i,
    tratamento: "ADICAO",
    documentos: ["Auto de infração", "Comprovante"],
    baseLegal: "RIR/2018, art. 352, § 5º (multa por infração fiscal só é dedutível se compensatória ou sem falta de pagamento de tributo)",
    observacao: "Multa de mora (atraso de pagamento) é compensatória e dedutível; multa de ofício, de auto de infração, não. Separar as duas em categorias distintas na Omie evita adicionar a mais ou a menos.",
  },
  {
    codigo: "MORA_ENCARGOS",
    nome: "Juros e multa de mora por atraso",
    padrao: /multa de mora|juros e multa|multa.{0,15}atraso|encargos? (por|de) atraso|acr[ée]scimos? morat/i,
    tratamento: "DEDUTIVEL",
    documentos: ["Guia ou boleto com o acréscimo discriminado"],
    baseLegal: "RIR/2018, art. 352, § 5º (multa compensatória) e art. 311",
    observacao: "Dedutível, mas é dinheiro perdido: o ganho fiscal (34%) nunca compensa o acréscimo. Vale como argumento para pagar em dia, não como economia.",
    semBeneficiarioProprio: true,
  },
  {
    codigo: "BRINDES",
    nome: "Brindes",
    padrao: /brinde/i,
    tratamento: "ADICAO",
    documentos: ["NF"],
    baseLegal: "Lei 9.249/1995, art. 13, VII",
    observacao: "Indedutível por lei, sem exceção. Material promocional com a marca usado na operação (uniforme, adesivo do veículo) não é brinde — classificar certo.",
  },
  {
    codigo: "DOACOES",
    nome: "Doações e patrocínios",
    padrao: /doa[çc][ãa]o|doa[çc][õo]es|contribui[çc][ãa]o (a|para) (entidade|institui)/i,
    tratamento: "LIMITE",
    documentos: ["Recibo da entidade", "Comprovação da qualificação da entidade (OSCIP, utilidade pública, ensino e pesquisa)"],
    baseLegal: "Lei 9.249/1995, art. 13, VI e § 2º (até 2% do lucro operacional para entidades civis qualificadas; 1,5% para ensino e pesquisa)",
    observacao: "Fora dessas entidades, a doação é adicionada. Para doar com efeito fiscal, o caminho são os fundos incentivados, que abatem do imposto e não da base (ver oportunidades).",
  },
  {
    codigo: "PRO_LABORE",
    nome: "Pró-labore dos sócios",
    padrao: /pr[óo][- ]?labore/i,
    tratamento: "DEDUTIVEL",
    documentos: ["Contrato social ou ata fixando a remuneração", "Folha e eSocial (S-1200)", "INSS de 20% da empresa e 11% retido do sócio", "IRRF pela tabela"],
    baseLegal: "RIR/2018, art. 311 e Lei 8.212/1991, art. 22, III (remuneração de administrador, com contribuição patronal)",
    observacao:
      "Dedutível como remuneração pelo trabalho. Gratificação e participação no lucro atribuídas a administradores não são — e retirada sem folha, lançada como despesa, é distribuição de lucro disfarçada.",
  },
  {
    codigo: "DISTRIBUICAO",
    nome: "Distribuição de lucros",
    padrao: /distribui[çc][ãa]o de (lucro|resultado)|dividendo|antecipa[çc][ãa]o de lucro|retirada de lucro/i,
    tratamento: "NAO_E_DESPESA",
    documentos: ["Ata ou alteração contratual aprovando a distribuição", "Demonstrações que provem o lucro distribuído"],
    baseLegal: "Lei 9.249/1995, art. 10; Lei 9.250/1995, art. 6º-A (retenção de 10% acima de R$ 50 mil por mês a uma mesma pessoa física, desde 2026, na redação da Lei 15.270/2025)",
    observacao: "É destinação do lucro, não despesa. O que reduz a base é remunerar o capital por juros sobre capital próprio, que é dedutível (ver oportunidades).",
    semBeneficiarioProprio: true,
    conferir: true,
  },
  {
    codigo: "DESPESAS_SOCIOS",
    nome: "Despesas pessoais dos sócios",
    padrao: /despesas? (pessoa(l|is) )?(dos |de )?s[óo]cios?|particular|uso pessoal/i,
    tratamento: "ADICAO",
    documentos: ["Se forem remuneração indireta: identificação do beneficiário e tributação na folha"],
    baseLegal: "Lei 9.249/1995, art. 13, III e IV; Lei 8.383/1991, art. 74 (remuneração indireta só é dedutível com beneficiário identificado e tributado)",
    observacao: "Veículo, alimentação e gastos de uso particular dos sócios são indedutíveis — e um dos primeiros itens que a fiscalização procura. Ou viram remuneração tributada, ou saem da empresa.",
  },
  {
    codigo: "IMOBILIZADO",
    nome: "Compra de veículos, máquinas e outros bens duráveis",
    padrao: /aquisi[çc][ãa]o de (ve[íi]culo|bem|bens|m[áa]quina|equipamento)|compra de (ve[íi]culo|[ôo]nibus|van|micro)|imobilizado|ativo fixo|benfeitoria/i,
    tratamento: "NAO_E_DESPESA",
    documentos: ["NF de compra", "Controle patrimonial do bem (data, valor, taxa, baixas)"],
    baseLegal: "RIR/2018, art. 313 (bem acima de R$ 1.200 ou com vida útil acima de um ano é ativo); arts. 317 e seguintes (depreciação); IN RFB 1.700/2017, Anexo III (taxas)",
    observacao: "A compra não é despesa no ano: entra como ativo e vira despesa pela depreciação, ano a ano. Veículos de passageiros depreciam a 20% ao ano; os de transporte de dez ou mais pessoas, a 25% — conferir o código de cada veículo no Anexo III.",
    conferir: true,
  },
  {
    codigo: "LEASING",
    nome: "Arrendamento mercantil (leasing)",
    padrao: /leasing|arrendamento mercantil/i,
    tratamento: "DEDUTIVEL",
    documentos: ["Contrato de arrendamento", "Nota ou fatura da arrendadora"],
    baseLegal: "Lei 6.099/1974, art. 11; Lei 9.249/1995, art. 13, II (só bens intrinsecamente ligados à atividade)",
    observacao: "A contraprestação é dedutível quando o bem é usado na operação. Veículo arrendado para uso de sócio é adicionado.",
    conferir: true,
  },
  {
    codigo: "FINANCIAMENTO",
    nome: "Parcelas de financiamento, consórcio e empréstimo",
    // "Juros de financiamento" é despesa financeira, não parcela: fica para o
    // tipo de juros, logo abaixo.
    padrao: /^(?!.*\bjuros\b).*(financiamento|\bcdc\b|finame|cons[óo]rcio|empr[ée]stimo|m[úu]tuo|capital de giro|amortiza[çc])/i,
    tratamento: "NAO_E_DESPESA",
    documentos: ["Contrato", "Planilha do banco com juros e amortização de cada parcela"],
    baseLegal: "RIR/2018, art. 311 (os juros são despesa financeira dedutível por competência); a amortização do principal não é despesa",
    observacao:
      "A parcela inteira não é despesa: só os juros embutidos nela. O principal amortiza a dívida, e o bem financiado entra pela depreciação. Consórcio não contemplado é adiantamento; a taxa de administração é despesa. Separar juros e principal de cada contrato é o que permite deduzir o que é dedutível.",
  },
  {
    codigo: "JUROS_TARIFAS",
    nome: "Juros, tarifas e encargos bancários",
    padrao: /\bjuros\b|tarifa|\biof\b|encargos? financeir|despesas? banc|taxa de antecipa|des[áa]gio/i,
    tratamento: "DEDUTIVEL",
    documentos: ["Extrato ou contrato com a cobrança"],
    baseLegal: "RIR/2018, art. 311",
    observacao: "Dedutível por competência: juro de contrato de vários meses é apropriado mês a mês, não no pagamento.",
    semBeneficiarioProprio: true,
  },
  {
    codigo: "COMBUSTIVEL",
    nome: "Combustível, Arla e lubrificantes",
    padrao: /combust[íi]vel|diesel|gasolina|etanol|[áa]lcool|\barla\b|lubrificante|[óo]leo/i,
    tratamento: "DEDUTIVEL",
    documentos: ["NF-e ou NFC-e com o CNPJ da empresa (e a placa, quando o posto informa)", "Vínculo com veículo da frota (abastecimento × telemetria)"],
    baseLegal: "RIR/2018, art. 311",
    observacao: "Insumo típico, mas o cupom sem CNPJ da empresa não prova que o gasto é dela. Abastecimento de veículo que não é da frota é o achado clássico de fiscalização em transportadora.",
    exigeNota: true,
  },
  {
    codigo: "MANUTENCAO",
    nome: "Manutenção, peças e pneus",
    padrao: /manuten[çc]|pe[çc]as?\b|pneu|oficina|funilaria|borracharia|revis[ãa]o|mec[âa]nic|reparo|lavagem|ret[íi]fica/i,
    tratamento: "DEDUTIVEL",
    documentos: ["NF-e das peças e NFS-e do serviço, com a placa", "Ordem de serviço"],
    baseLegal: "RIR/2018, art. 311 e art. 354 (reparo que aumenta a vida útil em mais de um ano é ativado, não deduzido de uma vez)",
    observacao: "Retífica de motor, troca de câmbio e reforma de carroceria aumentam a vida útil: vão para o ativo e depreciam. Manutenção corrente é despesa do mês.",
    exigeNota: true,
  },
  {
    codigo: "PEDAGIO",
    nome: "Pedágio",
    padrao: /ped[áa]gio|sem parar|conectcar|veloe|move ?mais|\btag\b/i,
    tratamento: "DEDUTIVEL",
    documentos: ["Extrato da operadora da tag por placa", "Vínculo com a viagem ou o contrato"],
    baseLegal: "RIR/2018, art. 311",
    observacao: "Pedágio de veículo que não é da frota ou fora de rota de contrato é o que se glosa.",
  },
  {
    codigo: "VEICULO_TRIBUTOS_SEGURO",
    nome: "IPVA, licenciamento e seguros",
    padrao: /\bipva\b|licenciamento|\bdpvat\b|\bcrlv\b|seguro(?! de vida)/i,
    tratamento: "DEDUTIVEL",
    documentos: ["Apólice", "Guia do IPVA e do licenciamento"],
    baseLegal: "RIR/2018, art. 311; regime de competência (Decreto-Lei 1.598/1977, art. 6º)",
    observacao: "Seguro anual e IPVA pago à vista são despesa antecipada: apropriar mês a mês. Deduzir o ano inteiro no mês do pagamento antecipa despesa e é ajustado na fiscalização.",
  },
  {
    codigo: "PLR",
    nome: "Participação nos lucros dos empregados",
    padrao: /\bplr\b|participa[çc][ãa]o nos (lucros|resultados)/i,
    tratamento: "VERIFICAR",
    documentos: ["Acordo coletivo ou com comissão de empregados, com regras e metas claras", "Pagamento no máximo duas vezes por ano"],
    baseLegal: "Lei 10.101/2000, art. 3º, § 1º",
    observacao: "Dedutível e sem encargos quando segue a Lei 10.101; fora dela vira salário (com encargos). Para administradores, é adicionada.",
  },
  {
    codigo: "SALARIOS_ENCARGOS",
    nome: "Salários e encargos",
    padrao: /sal[áa]rio|folha|f[ée]rias|13[ºo°]?|d[ée]cimo|rescis|\binss\b|\bfgts\b|encargos? socia|horas? extra|adicional noturno|aviso pr[ée]vio|\bcpp\b/i,
    tratamento: "DEDUTIVEL",
    documentos: ["Folha de pagamento", "eSocial", "DCTFWeb e FGTS Digital com o recolhimento"],
    baseLegal: "RIR/2018, art. 311; Lei 9.249/1995, art. 13, I (provisão de férias e 13º é a exceção dedutível)",
    observacao: "No Real, férias e 13º entram por competência, com a provisão mensal — não no mês em que são pagos.",
    semBeneficiarioProprio: true,
  },
  {
    codigo: "BENEFICIOS",
    nome: "Benefícios aos empregados",
    padrao: /vale[- ]?(refei|alimenta|transporte)|\bv[art]\b|plano de sa[úu]de|odontol|seguro de vida|cesta b[áa]sica|alimenta[çc][ãa]o|refeit[óo]rio|previd[êe]ncia privada|uniforme|\bepi\b/i,
    tratamento: "DEDUTIVEL",
    documentos: ["Contrato com a operadora (registrada no PAT, no caso de alimentação)", "NF ou fatura", "Concessão indistinta aos empregados"],
    baseLegal: "RIR/2018, art. 311; Lei 9.249/1995, art. 13, V (plano de saúde e previdência a empregados e dirigentes são exceção dedutível; previdência até 20% da folha)",
    observacao: "Dedutível quando é para os empregados de forma geral. A alimentação pelo PAT ainda abate parte do IRPJ (ver oportunidades).",
    exigeNota: true,
  },
  {
    codigo: "SERVICOS_TERCEIROS",
    nome: "Serviços de terceiros",
    padrao: /servi[çc]os? (de )?terceiros|consultoria|assessoria|contab|jur[íi]dic|advoca|honor[áa]rio|terceiriza|limpeza|vigil[âa]ncia|agregad|subcontrat|frete|motorista terceir/i,
    tratamento: "DEDUTIVEL",
    documentos: [
      "NFS-e do prestador",
      "Contrato com o escopo",
      "Retenções na fonte: IRRF 1,5% em serviço profissional, 4,65% de PIS/COFINS/CSLL, 11% de INSS na cessão de mão de obra, ISS conforme o município",
      "Pessoa física: RPA com INSS (11% retido e 20% patronal) e IRRF",
    ],
    baseLegal: "RIR/2018, art. 311 e art. 714 (IRRF de serviço profissional); Lei 10.833/2003, art. 30; Lei 8.212/1991, art. 31",
    observacao: "Serviço sem nota ou sem contrato é a glosa mais comum. E serviço de pessoa física pago sem RPA cria duas contas: a despesa indedutível e o INSS que deveria ter sido recolhido.",
    exigeNota: true,
  },
  {
    codigo: "ALUGUEL",
    nome: "Aluguéis e condomínio",
    padrao: /aluguel|alugu[ée]is|loca[çc][ãa]o|condom[íi]nio|\biptu\b/i,
    tratamento: "DEDUTIVEL",
    documentos: ["Contrato de locação", "Pessoa jurídica: nota ou recibo", "Pessoa física: recibo e IRRF retido pela empresa (tabela progressiva)"],
    baseLegal: "RIR/2018, art. 311; IRRF sobre aluguel pago a pessoa física (Lei 7.713/1988 e tabela progressiva)",
    observacao: "Aluguel de imóvel de sócio é dedutível se o valor é de mercado e o contrato existe — senão é distribuição disfarçada.",
  },
  {
    codigo: "UTILIDADES",
    nome: "Energia, água, telefone e internet",
    padrao: /energia|[áa]gua|telefon|internet|celular|\bg[áa]s\b|telecom/i,
    tratamento: "DEDUTIVEL",
    documentos: ["Fatura em nome e CNPJ da empresa"],
    baseLegal: "RIR/2018, art. 311",
    observacao: "Fatura em nome de sócio ou de terceiro não comprova que o gasto é da empresa.",
  },
  {
    codigo: "TRIBUTOS",
    nome: "Tributos sobre a receita e taxas",
    padrao: /\biss\b|\bpis\b|cofins|\bicms\b|simples nacional|\bdas\b|\bcbs\b|\bibs\b|\btaxas?\b|tributo|imposto/i,
    tratamento: "DEDUTIVEL",
    documentos: ["Guia de recolhimento", "Apuração"],
    baseLegal: "Lei 8.981/1995, art. 41 (dedutível por competência; o que está com a exigibilidade suspensa é adicionado até a decisão)",
    observacao: "Tributo questionado em juízo com depósito ou liminar não é dedutível enquanto durar a suspensão.",
    semBeneficiarioProprio: true,
  },
  {
    codigo: "PERDAS_CREDITO",
    nome: "Perdas com clientes inadimplentes",
    padrao: /perda|inadimpl|incobr|\bpdd\b|devedores duvidosos/i,
    tratamento: "VERIFICAR",
    documentos: ["Título vencido", "Cobrança administrativa ou judicial conforme o valor"],
    baseLegal: "Lei 9.430/1996, arts. 9º a 14",
    observacao: "Só é dedutível dentro dos critérios de valor, prazo e cobrança da lei; a provisão contábil fora deles é adicionada (ver oportunidades).",
  },
  {
    codigo: "PROVISOES",
    nome: "Outras provisões",
    padrao: /provis[ãa]o/i,
    tratamento: "ADICAO",
    documentos: [],
    baseLegal: "Lei 9.249/1995, art. 13, I",
    observacao: "Provisão contábil é adicionada e excluída quando a perda se realiza. A exceção são férias e 13º.",
  },
  {
    codigo: "INDENIZACOES",
    nome: "Indenizações, acordos e sinistros",
    padrao: /indeniza|acordo|reclamat|processo|condena[çc]|sinistro|avaria|franquia|roubo|furto/i,
    tratamento: "DEDUTIVEL",
    documentos: ["Sentença, acordo homologado ou termo", "Sinistro: boletim de ocorrência e o valor recuperado do seguro"],
    baseLegal: "RIR/2018, art. 311",
    observacao: "Dedutível com o documento que prova a obrigação. Sinistro entra pelo valor líquido do que o seguro indenizou.",
  },
  {
    codigo: "VIAGENS_REFEICOES",
    nome: "Viagens, hospedagem e refeições",
    padrao: /viage(m|ns)|hospedagem|hotel|passage(m|ns)|refei[çc][ãa]o|restaurante|lanche|\buber\b|t[áa]xi|estacionamento|di[áa]ria/i,
    tratamento: "DEDUTIVEL",
    documentos: ["Nota do fornecedor", "Relatório de despesas com o motivo e quem viajou"],
    baseLegal: "RIR/2018, art. 311; Lei 9.249/1995, art. 13, IV (refeição de sócio e administrador é indedutível)",
    observacao: "Dedutível quando ligada à operação e documentada com o motivo. Refeição de sócio vai para adição.",
    exigeNota: true,
  },
  {
    codigo: "PROPAGANDA",
    nome: "Propaganda e marketing",
    padrao: /propaganda|publicidade|marketing|an[úu]ncio|m[íi]dia/i,
    tratamento: "DEDUTIVEL",
    documentos: ["NF da agência ou do veículo de comunicação", "Peça ou comprovação da veiculação"],
    baseLegal: "RIR/2018, art. 311 e arts. 380 a 382",
    observacao: "Dedutível quando ligada à atividade e comprovada a veiculação.",
    exigeNota: true,
    conferir: true,
  },
  {
    codigo: "TI_MATERIAL",
    nome: "Sistemas, informática e material",
    padrao: /software|sistema|licen[çc]a|inform[áa]tica|computador|nuvem|material|escrit[óo]rio|copa|suprimento/i,
    tratamento: "DEDUTIVEL",
    documentos: ["NF do fornecedor", "Equipamento acima de R$ 1.200: ativar e depreciar"],
    baseLegal: "RIR/2018, arts. 311 e 313",
    observacao: "Computador, celular e mobiliário acima de R$ 1.200 por unidade vão para o ativo.",
    exigeNota: true,
  },
  {
    codigo: "CONTRIBUICOES",
    nome: "Contribuições a sindicatos e associações",
    padrao: /sindica|associa[çc][ãa]o|contribui[çc][ãa]o (sindical|associativa|assistencial|confederativa)|mensalidade/i,
    tratamento: "VERIFICAR",
    documentos: ["Boleto ou recibo da entidade", "Vínculo com a atividade"],
    baseLegal: "Lei 9.249/1995, art. 13, V (contribuição não compulsória é indedutível, salvo as exceções para empregados)",
    observacao: "Entidade ligada à atividade (sindicato patronal, associação do setor) costuma ser aceita; as demais, adicionadas.",
    conferir: true,
  },
];

// Sem nome reconhecido, o tipo sai da linha do DRE em que a categoria está.
export const TIPO_GENERICO: TipoDeGasto = {
  codigo: "OUTRAS_OPERACIONAIS",
  nome: "Outras despesas operacionais",
  padrao: null,
  tratamento: "DEDUTIVEL",
  documentos: ["Nota ou documento do fornecedor", "Prova de que o gasto é da atividade"],
  baseLegal: "RIR/2018, art. 311",
  observacao: "Dedutível se necessária, usual e comprovada. Categoria genérica demais é onde a fiscalização procura primeiro: quanto menos se sabe do que é, mais difícil defender.",
  exigeNota: true,
};

export const TIPO_SEM_CATEGORIA: TipoDeGasto = {
  codigo: "SEM_CATEGORIA",
  nome: "Sem categoria",
  padrao: null,
  tratamento: "VERIFICAR",
  documentos: ["Classificar o lançamento e anexar o documento"],
  baseLegal: "RIR/2018, art. 311; Lei 8.981/1995, art. 61",
  observacao: "Despesa sem natureza identificada não se sustenta numa fiscalização, e saída sem causa comprovada pode atrair IRRF de 35%.",
};

const TIPO_POR_LINHA: Record<string, string> = {
  DESPESA_SALARIOS: "SALARIOS_ENCARGOS",
  DESPESA_SALARIOS_CORPORATIVO: "SALARIOS_ENCARGOS",
  DESPESA_FINANCEIRA: "JUROS_TARIFAS",
  FINANCIAMENTO_INVESTIMENTO: "FINANCIAMENTO",
  TRIBUTO_SOBRE_LUCRO: "IRPJ_CSLL",
  DISTRIBUICAO_LUCROS: "DISTRIBUICAO",
  DESPESA_SOCIOS: "DESPESAS_SOCIOS",
  DEDUCOES: "TRIBUTOS",
};

const PORCODIGO = new Map([...TIPOS_DE_GASTO, TIPO_GENERICO, TIPO_SEM_CATEGORIA].map((t) => [t.codigo, t]));
export const tipoPorCodigo = (codigo: string) => PORCODIGO.get(codigo) ?? TIPO_GENERICO;

// O tipo de uma categoria: pelo nome, e só sem nome reconhecido pela linha do
// DRE. A linha sozinha erra para os dois lados — "Pró-labore" mora na linha de
// sócios e é dedutível; "Multa de trânsito" mora em despesas de veículo e não é.
export function tipoDaCategoria(descricao: string, linhaDre: string | null): TipoDeGasto {
  if (!descricao || descricao === "SEM_CATEGORIA") return TIPO_SEM_CATEGORIA;
  for (const t of TIPOS_DE_GASTO) if (t.padrao?.test(descricao)) return t;
  const pelaLinha = linhaDre ? TIPO_POR_LINHA[linhaDre] : undefined;
  return pelaLinha ? tipoPorCodigo(pelaLinha) : TIPO_GENERICO;
}

// ---------------------------------------------------------------------------
// Alíquotas e limites
// ---------------------------------------------------------------------------

export const ALIQUOTAS = {
  irpj: 0.15,
  adicionalIrpj: 0.1,
  // R$ 20 mil por mês: R$ 240 mil no ano (Lei 9.430/1996, art. 3º, parágrafo único).
  limiteAdicionalAnoCents: 240_000_00,
  csll: 0.09,
  // Presumido: transporte de passageiros (Lei 9.249/1995, arts. 15, § 1º, II, "a", e 20).
  presuncaoIrpj: 0.16,
  presuncaoCsll: 0.12,
  // LC 224/2025: os percentuais de presunção sobem 10% sobre a parcela da
  // receita bruta do ano que passa de R$ 5 milhões (IN RFB 2.305/2025).
  acrescimoPresuncao: 0.1,
  limiteAcrescimoAnoCents: 5_000_000_00,
  // Acima disto no ano anterior, o Lucro Real é obrigatório (Lei 9.718/1998, art. 14, I).
  limiteObrigatoriedadeCents: 78_000_000_00,
  // IRRF sobre JCP: 17,5% desde 2026 (LC 224/2025, alterando a Lei 9.249/1995, art. 9º, § 2º).
  irrfJcp: 0.175,
  // Encargos patronais sobre a folha que deixa o Simples (fretamento não tem
  // desoneração): INSS 20%, RAT ajustado pelo FAP (estimado em 3%) e
  // terceiros do FPAS 612 (salário-educação 2,5%, INCRA 0,2%, SEST 1,5%,
  // SENAT 1,0%). Conferir RAT, FAP e FPAS com a contabilidade.
  encargosPatronais: 0.2 + 0.03 + 0.052,
};
