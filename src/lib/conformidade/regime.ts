import type { ConformidadeArea, ConformidadeNatureza } from "@prisma/client";

// TRANSIÇÃO DE REGIME: LUCRO REAL A PARTIR DE JANEIRO DE 2027,
// NO MEIO DA REFORMA TRIBUTÁRIA.
//
// Este catálogo existe porque a decisão de mudar de regime não é um evento
// contábil: é um projeto com prazo, decisões que precisam de dono e
// pré-requisitos operacionais que levam meses para ficar de pé. Deixá-lo numa
// apresentação de consultoria significa relembrá-lo uma vez por mês; deixá-lo
// aqui significa que cada item vira apontamento com responsável, prazo e
// tratativa — no mesmo lugar em que o resto da conformidade é cobrada.
//
// DUAS COISAS TORNAM ESTA JANELA ESPECÍFICA, E É POR ISSO QUE O CATÁLOGO É
// SOBRE 2027 E NÃO SOBRE "MIGRAR PARA O LUCRO REAL" EM GERAL:
//
//   1. Em 2027 o PIS e a COFINS deixam de existir. A razão clássica para
//      migrar — capturar o crédito não cumulativo de 9,25% — desaparece junto.
//      Quem migra em jan/2027 nunca vai operar EFD-Contribuições no regime não
//      cumulativo, que é justamente a parte mais cara da mudança. O custo de
//      complexidade da migração está no menor patamar em vinte anos.
//   2. O crédito de CBS e IBS não depende do regime de IRPJ. Lucro Presumido
//      credita igual. Ou seja: a partir de 2027 a escolha entre Presumido e
//      Real é uma decisão exclusivamente de IRPJ/CSLL — lucro presumido contra
//      lucro efetivo —, e não mais uma decisão sobre créditos.
//
// ALERTA DE PRECISÃO: legislação em transição muda rápido, e alíquota de
// referência da CBS/IBS ainda depende de resolução do Senado. Todo item traz a
// norma para conferência, e os que dependem de confirmação estão marcados. Este
// catálogo organiza a decisão; quem decide o enquadramento é a assessoria.

export type MarcoReforma = {
  periodo: string;
  titulo: string;
  oQueMuda: string;
  baseLegal: string;
  acaoAgora: string;
};

// A linha do tempo importa porque as obrigações começam ANTES do imposto: já
// em 2026 o documento fiscal precisa destacar CBS e IBS, mesmo com alíquota de
// teste. Emissor desatualizado em janeiro é descumprimento de obrigação
// acessória em janeiro, não em 2033.
export const MARCOS_REFORMA: MarcoReforma[] = [
  {
    periodo: "2026",
    titulo: "Ano-teste da CBS e do IBS",
    oQueMuda:
      "CBS a 0,9% e IBS a 0,1%, com o valor compensável com PIS/COFINS. O efeito de caixa é próximo de zero para quem apura certo — mas o destaque nos documentos fiscais passa a ser obrigatório, e a apuração precisa existir.",
    baseLegal: "EC 132/2023; LC 214/2025",
    acaoAgora:
      "Confirmar com o fornecedor do emissor de CT-e e de NFS-e que o layout com CBS/IBS está entregue e testado. É a única obrigação da reforma que já vence dentro do exercício corrente.",
  },
  {
    periodo: "2027",
    titulo: "PIS e COFINS são extintos; a CBS entra com alíquota cheia",
    oQueMuda:
      "Fim do PIS e da COFINS, e com eles o fim da diferença de crédito entre Lucro Real e Presumido. O IPI é reduzido a zero (salvo Zona Franca) e o Imposto Seletivo começa. A partir daqui, escolher regime é escolher entre lucro presumido e lucro efetivo — nada mais.",
    baseLegal: "EC 132/2023, art. 126; LC 214/2025",
    acaoAgora:
      "É a data da decisão. Se a migração for em jan/2027, a empresa nunca apura PIS/COFINS não cumulativo — o pedaço mais caro e mais arriscado da mudança some.",
  },
  {
    periodo: "2029 a 2032",
    titulo: "ICMS e ISS caem gradualmente; o IBS sobe",
    oQueMuda:
      "As alíquotas de ICMS e ISS são reduzidas ano a ano e o IBS ocupa o espaço. Benefícios estaduais e municipais perdem eficácia na mesma proporção.",
    baseLegal: "EC 132/2023, art. 128",
    acaoAgora:
      "Todo benefício de ICMS hoje aproveitado — inclusive o crédito outorgado do transporte — tem prazo de validade conhecido. Vale medir agora quanto do resultado depende dele.",
  },
  {
    periodo: "2033",
    titulo: "Só IBS e CBS",
    oQueMuda: "Extinção definitiva do ICMS e do ISS.",
    baseLegal: "EC 132/2023",
    acaoAgora: "Horizonte de planejamento de contratos longos: reajuste e cláusula tributária precisam prever a transição.",
  },
];

// ---------------------------------------------------------------------------
// Três modalidades que a lei trata de forma diferente
// ---------------------------------------------------------------------------
//
// A distinção mais importante deste catálogo, e a que mais se perde quando se
// fala genericamente em "transporte de passageiros": linha regular concedida,
// transporte urbano e FRETAMENTO são três coisas juridicamente distintas.
// Regulador diferente, documento fiscal diferente, CNAE diferente, imposto
// diferente — e, na reforma, regime de alíquota diferente.
//
// A operação deste grupo é FRETAMENTO. Isso não é um detalhe de cadastro: é o
// que faz a maior parte dos benefícios do setor de transporte NÃO se aplicar a
// ela. Um catálogo que tratasse os três como a mesma coisa produziria, aqui,
// otimismo injustificado.

export type Modalidade = {
  codigo: string;
  nome: string;
  oQueE: string;
  regulador: string;
  documentoFiscal: string;
  cnae: string;
  impostoSobreOServico: string;
  desoneracaoDaFolha: string;
  reformaTributaria: string;
};

export const MODALIDADES: Modalidade[] = [
  {
    codigo: "URBANO",
    nome: "Transporte público coletivo urbano",
    oQueE:
      "Linha regular dentro do município ou da região metropolitana, aberta ao público, delegada por concessão ou permissão. Itinerário, horário e tarifa são fixados pelo poder concedente.",
    regulador: "Prefeitura ou órgão metropolitano (SPTrans, EMTU)",
    documentoFiscal: "Bilhete de passagem / NFS-e",
    cnae: "4921-3/01 e 4921-3/02",
    impostoSobreOServico: "ISS quando estritamente municipal; ICMS na prestação metropolitana intermunicipal",
    desoneracaoDaFolha: "Alcançada — o CNAE está entre os beneficiados",
    reformaTributaria:
      "Alíquota reduzida a zero para o transporte público coletivo urbano, semiurbano e metropolitano.",
  },
  {
    codigo: "CONCEDIDO",
    nome: "Transporte rodoviário de linha regular (concedido)",
    oQueE:
      "Linha intermunicipal ou interestadual com itinerário fixo, aberta ao público, mediante autorização, permissão ou concessão. O passageiro compra a passagem individualmente.",
    regulador: "ANTT (interestadual) ou agência estadual, como a ARTESP (intermunicipal)",
    documentoFiscal: "BP-e — Bilhete de Passagem Eletrônico",
    cnae: "4922-1/01, 4922-1/02 e 4922-1/03",
    impostoSobreOServico: "ICMS",
    desoneracaoDaFolha: "Alcançada — o CNAE está entre os beneficiados",
    reformaTributaria: "Redução de alíquota prevista para o transporte coletivo de passageiros intermunicipal e interestadual.",
  },
  {
    codigo: "FRETAMENTO",
    nome: "Fretamento — a operação deste grupo",
    oQueE:
      "Contrato bilateral com um tomador determinado, sem itinerário fixo e sem venda de passagem ao público. No fretamento contínuo, os transportados têm vínculo com o contratante (empregados, estudantes, associados) e devem constar de relação nominal.",
    regulador: "ANTT no interestadual (com licença e relação de passageiros) ou agência estadual no intermunicipal",
    documentoFiscal: "CT-e OS, modelo 67",
    cnae: "4929-9/01 (municipal) e 4929-9/02 (intermunicipal, interestadual e internacional)",
    impostoSobreOServico: "ISS quando o trajeto é municipal; ICMS quando é intermunicipal ou interestadual",
    desoneracaoDaFolha: "NÃO alcançada — a desoneração é dos CNAE de itinerário fixo, não do 4929-9",
    reformaTributaria:
      "Fretamento não é transporte público coletivo. A hipótese mais provável é regime cheio, sem a redução prevista para as outras duas modalidades — e é a questão de maior impacto financeiro em aberto.",
  },
];

// O risco que atravessa as três: descaracterização.
//
// Fretamento que transporta quem não tem vínculo com o contratante deixa de ser
// fretamento e passa a ser, na prática, linha regular sem autorização. A
// consequência é dupla e costuma ser lembrada pela metade: além da infração
// perante o regulador, cai o enquadramento tributário que dependia da natureza
// do serviço.
//
// Não é hipótese teórica neste caso. O primeiro dos seis questionamentos da
// consultoria é exatamente sobre notas cuja descrição diz "transporte para
// funcionários e TERCEIROS", e há notas emitidas para pessoas físicas sem
// contrato de fretamento contínuo. A palavra na descrição da nota é, ao mesmo
// tempo, a prova fiscal e a prova regulatória.
export const RISCO_DESCARACTERIZACAO = {
  titulo: "Descaracterização do fretamento",
  baseLegal: "Regulamentação de fretamento da ANTT e da agência estadual; RICMS-SP; LC 116/2003",
  oQueObservar:
    "Transportado sem vínculo com o contratante, ausência de relação nominal de passageiros e descrição genérica na nota descaracterizam o fretamento. O efeito vai além da multa do regulador: o enquadramento tributário do serviço é consequência da natureza dele, e a nota que descreve 'terceiros' documenta a operação fora da hipótese.",
} as const;

// ---------------------------------------------------------------------------
// Onde nasce o crédito
// ---------------------------------------------------------------------------

export type Aproveitamento = "SIM" | "NAO" | "PARCIAL" | "VERIFICAR";

export type FonteDeCredito = {
  item: string;
  // Regime atual da empresa: Lucro Presumido, PIS/COFINS cumulativo. Aqui é
  // tudo "NAO" — o cumulativo não dá crédito nenhum, e é essa a linha de base
  // contra a qual qualquer ganho precisa ser medido.
  presumidoHoje: Aproveitamento;
  // Lucro Real hoje (2026): PIS/COFINS não cumulativo, 9,25%.
  realHoje: Aproveitamento;
  // CBS e IBS a partir de 2027, para qualquer regime de IRPJ.
  cbsIbs: Aproveitamento;
  observacao: string;
};

// A tabela responde à pergunta que sempre aparece primeiro ("o que a gente
// poderia creditar?") e, mais importante, à que quase nunca aparece: o que
// NÃO gera crédito. Numa operação de fretamento o maior custo é folha, e folha
// não gera crédito em regime nenhum — nem hoje, nem depois de 2027. Quem
// dimensiona o ganho da migração pelo total de custos, e não pelos custos
// creditáveis, erra por um fator grande.
export const FONTES_DE_CREDITO: FonteDeCredito[] = [
  {
    item: "Folha de motoristas e demais empregados",
    presumidoHoje: "NAO",
    realHoje: "NAO",
    cbsIbs: "NAO",
    observacao:
      "Mão de obra própria não gera crédito em nenhum regime — nem no não cumulativo (vedação expressa), nem na CBS/IBS, que credita operação com fornecedor. É o maior custo da operação e está integralmente fora do crédito.",
  },
  {
    item: "Combustível e lubrificantes",
    presumidoHoje: "NAO",
    realHoje: "SIM",
    cbsIbs: "SIM",
    observacao: "Insumo típico e incontroverso da atividade de transporte. É a maior linha creditável da operação.",
  },
  {
    item: "Pneus, peças e material de manutenção",
    presumidoHoje: "NAO",
    realHoje: "SIM",
    cbsIbs: "SIM",
    observacao:
      "Crédito como insumo. Peça que aumenta a vida útil do veículo por mais de um ano entra no imobilizado e credita pela depreciação, não pela compra.",
  },
  {
    item: "Manutenção terceirizada (oficinas, funilaria, borracharia)",
    presumidoHoje: "NAO",
    realHoje: "SIM",
    cbsIbs: "SIM",
    observacao:
      "Atenção ao porte do fornecedor: aquisição de optante pelo Simples Nacional gera crédito limitado na CBS/IBS. Numa cadeia de oficinas pequenas isso vira decisão de fornecimento, não de contabilidade.",
  },
  {
    item: "Arrendamento mercantil e locação de veículos",
    presumidoHoje: "NAO",
    realHoje: "SIM",
    cbsIbs: "SIM",
    observacao: "Contraparte precisa ser pessoa jurídica. Frota arrendada credita a contraprestação; frota própria credita a depreciação.",
  },
  {
    item: "Depreciação da frota própria",
    presumidoHoje: "NAO",
    realHoje: "SIM",
    cbsIbs: "SIM",
    observacao:
      "Depende de controle patrimonial que hoje provavelmente não existe formalizado: cada veículo com data de aquisição, valor, taxa e baixas. Sem isso o crédito não é defensável — e a depreciação também reduz o lucro tributável no Lucro Real.",
  },
  {
    item: "Pedágio",
    presumidoHoje: "NAO",
    realHoje: "SIM",
    cbsIbs: "SIM",
    observacao: "Custo diretamente ligado à prestação. Exige documentação por viagem para sustentar a apropriação.",
  },
  {
    item: "Energia elétrica, aluguel de garagem e de oficina",
    presumidoHoje: "NAO",
    realHoje: "SIM",
    cbsIbs: "SIM",
    observacao: "Aluguel pago a pessoa jurídica. Aluguel pago a pessoa física não gera crédito no regime atual.",
  },
  {
    item: "Seguros da frota",
    presumidoHoje: "NAO",
    realHoje: "VERIFICAR",
    cbsIbs: "VERIFICAR",
    observacao:
      "Crédito de seguro no não cumulativo é controvertido e depende da caracterização como insumo essencial. Na CBS/IBS, serviços financeiros e securitários têm regime específico. Não contar com este crédito antes de parecer.",
  },
  {
    item: "Serviços de terceiros: contabilidade, jurídico, TI, limpeza",
    presumidoHoje: "NAO",
    realHoje: "PARCIAL",
    cbsIbs: "SIM",
    observacao:
      "É a mudança mais relevante de 2027. Hoje esses serviços são custo puro; no não cumulativo o crédito é discutível porque não são insumo da prestação; na CBS/IBS o crédito é financeiro e amplo, e passam a creditar.",
  },
  {
    item: "Vale-transporte, vale-refeição, uniforme e EPI",
    presumidoHoje: "NAO",
    realHoje: "VERIFICAR",
    cbsIbs: "VERIFICAR",
    observacao:
      "No regime atual o crédito é expresso apenas para alguns setores; fora deles depende de tese. Levantar o valor antes de decidir se vale a discussão.",
  },
  {
    item: "Aquisições de fornecedores do Simples Nacional",
    presumidoHoje: "NAO",
    realHoje: "PARCIAL",
    cbsIbs: "PARCIAL",
    observacao:
      "Crédito limitado nos dois regimes. Vale mapear quanto da despesa vem de optantes pelo Simples: acima de um certo peso, a escolha de fornecedor passa a ter efeito tributário mensurável.",
  },
];

// ---------------------------------------------------------------------------
// Decisões que precisam de dono
// ---------------------------------------------------------------------------

export type DecisaoRegime = {
  codigo: string;
  titulo: string;
  area: ConformidadeArea;
  natureza: ConformidadeNatureza;
  pergunta: string;
  porQueImporta: string;
  baseLegal: string;
  // Quando o item depende de confirmação da assessoria antes de virar decisão.
  confirmar: boolean;
};

export const DECISOES: DecisaoRegime[] = [
  {
    codigo: "LR-OBRIGATORIEDADE",
    titulo: "A migração pode não ser uma escolha",
    area: "FISCAL",
    natureza: "QUESTIONAMENTO",
    pergunta: "A receita total de 2026 vai ultrapassar R$ 78 milhões?",
    porQueImporta:
      "Acima desse limite o Lucro Real deixa de ser opção e passa a ser obrigatório no ano seguinte. Uma empresa que fecha 2026 acima do teto e descobre isso em fevereiro de 2027 começa o exercício sem plano de contas adequado, sem controle patrimonial e sem fechamento contábil no prazo — que é o pior cenário possível. A projeção precisa ser acompanhada mês a mês, não conferida no fim.",
    baseLegal: "Lei 9.718/1998, art. 14, I",
    confirmar: false,
  },
  {
    codigo: "LR-MARGEM",
    titulo: "Qual é a margem contábil real",
    area: "FINANCEIRO",
    natureza: "QUESTIONAMENTO",
    pergunta: "O lucro efetivo, depois de todos os custos, fica acima ou abaixo do lucro presumido?",
    porQueImporta:
      "É a única conta que decide. No Presumido o IRPJ e a CSLL incidem sobre uma margem fixada em lei, independentemente do resultado; no Real, sobre o lucro que a contabilidade apurar. Divide-se o que se paga hoje de IRPJ+CSLL por 34% e chega-se ao lucro que produziria a mesma conta: acima dele o Presumido é mais barato, abaixo o Real é. A resposta depende de uma DRE fechada e confiável — que é exatamente o que este sistema passa a produzir quando o espelho da Omie estiver sincronizado.",
    baseLegal: "Lei 9.249/1995, arts. 15 e 20; Lei 9.430/1996",
    confirmar: false,
  },
  {
    codigo: "LR-PRESUNCAO",
    titulo: "Qual percentual de presunção se aplica a cada receita",
    area: "FISCAL",
    natureza: "QUESTIONAMENTO",
    pergunta: "Fretamento, transporte municipal e locação de veículo com motorista usam a mesma presunção?",
    porQueImporta:
      "Transporte de passageiros, transporte de carga e locação de bens móveis têm percentuais de presunção diferentes, e a operação mistura os três. Sem a segregação correta da receita, nem se sabe quanto se paga a mais ou a menos hoje — e a mesma segregação decide o tratamento na CBS/IBS. É a versão tributária da pergunta que a consultoria já faz sobre a descrição das notas.",
    baseLegal: "Lei 9.249/1995, art. 15, § 1º, II, 'a', e art. 20",
    confirmar: true,
  },
  {
    codigo: "LR-FRETAMENTO-CBS",
    titulo: "O fretamento provavelmente fica de fora das reduções",
    area: "FISCAL",
    natureza: "RISCO",
    pergunta: "O fretamento se enquadra em alguma redução, ou vai para o regime cheio da CBS/IBS?",
    porQueImporta:
      "As reduções da LC 214/2025 foram escritas para o transporte PÚBLICO coletivo — urbano e metropolitano com alíquota zero, intermunicipal e interestadual com redução. Fretamento é contrato privado, sem itinerário fixo e sem venda de passagem ao público; a leitura mais provável é regime cheio. Se for esse o caso, a carga nominal sobre o serviço sai de algo em torno de 4% a 5% da receita (ISS, ICMS quase todo isento e PIS/COFINS cumulativo) para a alíquota de referência da CBS somada à do IBS. É a maior variável financeira que a empresa tem em aberto, e ela se decide em 2026.",
    baseLegal: "LC 214/2025 (regimes diferenciados do transporte coletivo de passageiros); EC 132/2023",
    confirmar: true,
  },
  {
    codigo: "LR-REPASSE",
    titulo: "Quanto da carteira consegue creditar o imposto que vamos destacar",
    area: "CONTRATUAL",
    natureza: "RISCO",
    pergunta: "Qual fatia da receita vem de cliente que NÃO aproveita crédito de CBS/IBS?",
    porQueImporta:
      "Num imposto sobre valor agregado, alíquota maior na saída é neutra para o cliente que credita — empresa contribuinte do regime regular recupera o que pagou. Deixa de ser neutra para quem não credita: órgão público, associação sem fins lucrativos, entidade imune e pessoa física. A carteira desta operação tem os dois tipos lado a lado, e é a segunda metade que concentra todo o risco de margem. Sem essa segmentação, qualquer projeção da reforma é chute.",
    baseLegal: "LC 214/2025 (direito a crédito do adquirente contribuinte)",
    confirmar: false,
  },
  {
    codigo: "LR-CONTRATOS-PUBLICOS",
    titulo: "Contratos com o poder público precisam de cláusula tributária",
    area: "CONTRATUAL",
    natureza: "DOCUMENTO",
    pergunta: "Os contratos vigentes preveem reequilíbrio quando a carga tributária mudar?",
    porQueImporta:
      "Contrato administrativo de longa duração assinado sob a carga atual e executado sob a carga nova, sem cláusula de reequilíbrio, transfere a diferença inteira para a contratada. A transição tem data marcada e é de conhecimento público — quem não pedir o reequilíbrio no momento certo tende a perder o argumento de imprevisibilidade.",
    baseLegal: "Lei 14.133/2021, art. 124, II, 'd'; LC 214/2025 (regras de transição em contratos)",
    confirmar: true,
  },
  {
    codigo: "LR-CREDITO-ACUMULADO",
    titulo: "O que fazer com crédito acumulado se a saída for reduzida",
    area: "FISCAL",
    natureza: "RISCO",
    pergunta: "Se a receita tiver alíquota reduzida e os insumos forem tributados cheios, para onde vai o crédito?",
    porQueImporta:
      "Saída com alíquota reduzida e entrada tributada integralmente produz acúmulo de crédito. A lei prevê ressarcimento com prazo, mas ressarcimento é caixa que sai antes e volta depois — vira uma linha de capital de giro que hoje não existe na projeção.",
    baseLegal: "LC 214/2025 (ressarcimento de créditos acumulados)",
    confirmar: true,
  },
  {
    codigo: "LR-CREDITO-OUTORGADO",
    titulo: "O crédito outorgado de ICMS tem prazo de validade",
    area: "FISCAL",
    natureza: "QUESTIONAMENTO",
    pergunta: "A empresa optou pelo crédito outorgado do transporte, e quanto do resultado depende dele?",
    porQueImporta:
      "É pergunta que a consultoria repete há quatro relatórios sem resposta, e ela ganha uma segunda camada: benefício estadual perde eficácia progressivamente entre 2029 e 2032, e a Lei 14.789/2023 mudou o tratamento de subvenções — no Lucro Real, o aproveitamento como crédito fiscal exige habilitação prévia na Receita. Continuar sem responder custa duas vezes.",
    baseLegal: "Art. 11 do Anexo III do RICMS-SP; Lei 14.789/2023; EC 132/2023, art. 128",
    confirmar: false,
  },
  {
    codigo: "LR-JCP",
    titulo: "Juros sobre capital próprio passam a existir como dedução",
    area: "FISCAL",
    natureza: "OPORTUNIDADE",
    pergunta: "O patrimônio líquido comporta a dedução de JCP?",
    porQueImporta:
      "JCP é dedutível no Lucro Real e simplesmente não existe no Presumido. Numa empresa com patrimônio líquido relevante, é redução legítima e recorrente da base — mas depende de contabilidade em dia e de decisão societária formalizada.",
    baseLegal: "Lei 9.249/1995, art. 9º, com as alterações da Lei 14.789/2023",
    confirmar: false,
  },
  {
    codigo: "LR-DIVIDENDOS",
    titulo: "Como fica a distribuição de lucros",
    area: "SOCIETARIO",
    natureza: "QUESTIONAMENTO",
    pergunta: "A política de distribuição precisa mudar antes da virada?",
    porQueImporta:
      "No Presumido a isenção alcança o lucro presumido, ou o lucro contábil quando há escrituração. No Real, o que se distribui isento é o lucro contábil apurado — o que torna a qualidade da contabilidade uma questão de bolso do sócio, e não só de conformidade. Há ainda regra recente de tributação na fonte de dividendos acima de faixa mensal, que precisa ser confirmada com a assessoria antes de qualquer planejamento.",
    baseLegal: "Lei 9.249/1995, art. 10; legislação de tributação de dividendos em vigor a partir de 2026",
    confirmar: true,
  },
  {
    codigo: "LR-PREJUIZO",
    titulo: "Prejuízo no primeiro ano tem trava",
    area: "FISCAL",
    natureza: "RISCO",
    pergunta: "Se o primeiro exercício der prejuízo fiscal, em quanto tempo ele é recuperado?",
    porQueImporta:
      "Prejuízo fiscal só compensa até 30% do lucro de cada período seguinte. Empresa que migra, apura prejuízo e conta com recuperá-lo rápido descobre que leva anos. Isso muda a escolha entre apuração anual e trimestral — a anual permite absorver dentro do próprio exercício.",
    baseLegal: "Lei 9.065/1995, arts. 15 e 16; Lei 9.430/1996, art. 2º",
    confirmar: false,
  },
  {
    codigo: "LR-DESONERACAO",
    titulo: "A desoneração da folha provavelmente não alcança fretamento",
    area: "PREVIDENCIARIO",
    natureza: "QUESTIONAMENTO",
    pergunta: "Alguma parcela da operação tem CNAE de itinerário fixo e poderia optar pela contribuição sobre a receita?",
    porQueImporta:
      "A desoneração foi escrita para os CNAE de transporte coletivo com itinerário fixo — 4921-3 e 4922-1. O fretamento é 4929-9 e fica de fora. Vale confirmar o CNAE efetivo de cada estabelecimento antes de descartar: se houver linha regular em alguma filial, a parcela pode ser elegível, e a diferença entre vinte por cento sobre uma folha superior a dez milhões ao ano e um percentual sobre a receita é material. A reoneração é gradual e tem data para acabar, o que torna a verificação urgente e não permanente.",
    baseLegal: "Lei 12.546/2011, art. 8º-A e anexos; Lei 14.973/2024 (reoneração gradual)",
    confirmar: true,
  },
  {
    codigo: "LR-DESCARACTERIZACAO",
    titulo: "Fretamento que transporta terceiros deixa de ser fretamento",
    area: "REGULATORIO",
    natureza: "RISCO",
    pergunta: "Todos os transportados têm vínculo com o contratante, e existe relação nominal de passageiros?",
    porQueImporta:
      "É a questão que a consultoria abre há dois relatórios pelo lado tributário, e ela tem um lado regulatório que ninguém somou: transportar quem não tem vínculo com o contratante descaracteriza o fretamento e aproxima a operação de linha regular sem autorização. Perde-se o enquadramento tributário e ganha-se exposição perante a agência reguladora, com base na mesma prova — a descrição da nota. Sob a CBS/IBS, esse enquadramento passa a decidir alíquota, não só isenção estadual.",
    baseLegal: "Regulamentação de fretamento da ANTT e da agência estadual; art. 78 do Anexo I do RICMS-SP",
    confirmar: false,
  },
];

// ---------------------------------------------------------------------------
// O que precisa estar de pé antes de janeiro
// ---------------------------------------------------------------------------

export type PreparacaoLucroReal = {
  codigo: string;
  titulo: string;
  area: ConformidadeArea;
  natureza: ConformidadeNatureza;
  quando: string;
  porQue: string;
  comoFazer: string;
};

// A ordem não é arbitrária: é a ordem de dependência. Sem fechamento contábil
// mensal não há DRE; sem DRE não há como decidir o regime; sem plano de contas
// adequado o fechamento não serve para apurar imposto.
//
// O primeiro item é o mais importante e o mais desconfortável: o balancete
// trimestral é o documento que a consultoria cobra em todos os relatórios desde
// dezembro de 2025 e que continua não saindo. No Lucro Presumido isso é uma
// pendência de conformidade. No Lucro Real é a base de cálculo do imposto.
export const PREPARACAO: PreparacaoLucroReal[] = [
  {
    codigo: "PREP-FECHAMENTO",
    titulo: "Fechamento contábil mensal com data fixa",
    area: "CONTABIL",
    natureza: "DOCUMENTO",
    quando: "Começar imediatamente — precisa de pelo menos um trimestre rodando antes da virada",
    porQue:
      "É o pré-requisito de todos os outros. No Lucro Real o balancete não é relatório gerencial: é a base de cálculo do IRPJ e da CSLL, e atraso no fechamento vira imposto não apurado no prazo. O acervo de conformidade mostra que o balancete trimestral está em aberto desde dez/2025 — migrar sem resolver isso é transformar uma pendência de obrigação acessória em risco de autuação sobre o principal.",
    comoFazer:
      "Definir o dia do mês em que o balancete fecha, quem assina e o que precisa estar concluído antes (conciliação bancária, provisões, apropriação de despesas, depreciação). Rodar em teste durante o segundo semestre de 2026, com o mesmo rigor que valerá em 2027.",
  },
  {
    codigo: "PREP-PLANO-CONTAS",
    titulo: "Plano de contas que serve ao fiscal e ao gerencial",
    area: "CONTABIL",
    natureza: "DOCUMENTO",
    quando: "Até outubro de 2026",
    porQue:
      "O plano de contas precisa separar o que a apuração exige (receitas por natureza tributária, despesas creditáveis e não creditáveis) sem perder o que a gestão usa (custo por contrato, por veículo, por pessoa). Refazer plano de contas com o exercício já em curso é retrabalho garantido.",
    comoFazer:
      "Partir das dimensões que o sistema já usa no rateio — departamento, projeto, categoria — e amarrá-las às contas contábeis, de modo que o custo por veículo do painel e o custo da contabilidade sejam o mesmo número.",
  },
  {
    codigo: "PREP-PATRIMONIO",
    titulo: "Controle patrimonial da frota",
    area: "CONTABIL",
    natureza: "DOCUMENTO",
    quando: "Até novembro de 2026",
    porQue:
      "Depreciação reduz o lucro tributável e sustenta crédito. Sem ficha por veículo — aquisição, valor, taxa, baixas, benfeitorias — a depreciação não é defensável numa fiscalização, e o maior ativo da empresa fica fora da conta.",
    comoFazer:
      "Inventário físico da frota confrontado com o imobilizado contábil, tratando as divergências antes do saldo de abertura. Depois disso, manter o cadastro vivo a cada compra e cada baixa.",
  },
  {
    codigo: "PREP-SEGREGACAO",
    titulo: "Segregação da receita por natureza tributária",
    area: "FISCAL",
    natureza: "RISCO",
    quando: "Até setembro de 2026",
    porQue:
      "Transporte municipal, intermunicipal, fretamento e locação têm tratamentos diferentes de ISS, ICMS, presunção e, em 2027, de CBS/IBS. Hoje a diferença aparece como seis perguntas da consultoria sobre a descrição das notas; no Lucro Real e sob a reforma, ela é base de cálculo.",
    comoFazer:
      "Padronizar a descrição na emissão, amarrar cada tipo de contrato a um enquadramento e revisar a base contratual dos casos que a consultoria já apontou — terceiros, pessoa física, transporte municipal e transporte individual.",
  },
  {
    codigo: "PREP-CARTEIRA",
    titulo: "Segmentar a carteira entre quem credita e quem não credita",
    area: "CONTRATUAL",
    natureza: "DOCUMENTO",
    quando: "Até setembro de 2026",
    porQue:
      "É o levantamento que transforma a reforma de assunto abstrato em número. Cliente contribuinte do regime regular recupera o imposto destacado e absorve a mudança sem dor; órgão público, associação, entidade imune e pessoa física, não. A carteira desta operação tem os dois grupos, e só o segundo ameaça a margem.",
    comoFazer:
      "Classificar cada contrato por tipo de tomador e medir a receita de cada grupo. Para os que não creditam, simular o efeito da alíquota cheia sobre o preço atual e decidir, contrato a contrato, entre repasse, renegociação e reequilíbrio.",
  },
  {
    codigo: "PREP-CONCILIACAO",
    titulo: "Conciliação mensal entre apuração, DCTFWeb e e-CAC",
    area: "FISCAL",
    natureza: "OBRIGACAO",
    quando: "Começar imediatamente",
    porQue:
      "Hoje quem faz esse confronto é a consultoria, uma vez por mês, e o resultado chega em forma de apontamento. Sob o Lucro Real o volume de declarações cresce e a checagem precisa ser rotina interna, feita antes de transmitir e não depois de alguém apontar.",
    comoFazer:
      "Transformar em rotina de fechamento, com evidência arquivada — a mesma lista de provas que o catálogo de obrigações deste sistema já traz para cada tributo.",
  },
  {
    codigo: "PREP-POLITICA-CREDITO",
    titulo: "Política de créditos escrita, com dono e revisão",
    area: "FISCAL",
    natureza: "DOCUMENTO",
    quando: "Até dezembro de 2026",
    porQue:
      "Crédito tomado sem tese documentada é glosa esperando acontecer — e o acervo de conformidade já tem um exemplo caro disso, com mais de um milhão em PER/DCOMP cuja origem ninguém consegue explicar em quatro relatórios seguidos. O erro a não repetir não é o crédito: é o crédito sem memória.",
    comoFazer:
      "Para cada categoria de despesa, registrar por escrito se credita, com que fundamento e quem aprovou. Revisão semestral. Divergência entre contabilidade e assessoria vira decisão registrada, não pendência silenciosa.",
  },
  {
    codigo: "PREP-EMISSOR",
    titulo: "Emissor de CT-e e NFS-e adequado ao destaque de CBS e IBS",
    area: "REGULATORIO",
    natureza: "OBRIGACAO",
    quando: "Vence dentro do exercício corrente",
    porQue:
      "É a única obrigação da reforma que não espera 2027. O documento fiscal precisa destacar os novos tributos já no ano-teste, e emissor desatualizado significa documento irregular emitido em série.",
    comoFazer:
      "Confirmar por escrito com o fornecedor do sistema a data de entrega do layout e testar a emissão em homologação antes da virada do ano.",
  },
  {
    codigo: "PREP-SALDO-ABERTURA",
    titulo: "Saldo de abertura auditado",
    area: "CONTABIL",
    natureza: "DOCUMENTO",
    quando: "Dezembro de 2026",
    porQue:
      "O primeiro balanço do Lucro Real parte dos saldos de 31/12. Erro que hoje passa despercebido no Presumido — estoque, imobilizado, provisões, partes relacionadas — vira erro de base de cálculo já no primeiro trimestre.",
    comoFazer:
      "Revisão independente dos saldos antes do fechamento do exercício, tratando as divergências em 2026, enquanto elas ainda são ajuste contábil e não retificação de declaração.",
  },
  {
    codigo: "PREP-CALENDARIO",
    titulo: "Calendário de obrigações com responsável nomeado",
    area: "FISCAL",
    natureza: "OBRIGACAO",
    quando: "Até dezembro de 2026",
    porQue:
      "O Lucro Real acrescenta obrigações e encurta a tolerância. Calendário sem nome ao lado de cada item é calendário que ninguém cumpre — e o histórico de documentos pendentes deste grupo mostra exatamente esse padrão.",
    comoFazer:
      "Usar o catálogo de obrigações deste sistema como base, atribuir responsável e prazo interno anterior ao legal, e acompanhar pelo próprio módulo de Conformidade.",
  },
];

// Texto compacto para a leitura automática, no mesmo formato da fundamentação
// de obrigações: quando o próximo relatório da consultoria falar de CBS, IBS ou
// mudança de regime, o modelo classifica com o vocabulário certo em vez de
// jogar tudo em "outro".
export function fundamentacaoDaTransicao(): string {
  const linhas: string[] = [];

  linhas.push("## Modalidade da operação (decisiva para a classificação)");
  linhas.push(
    "A operação é de FRETAMENTO (CNAE 4929-9), que é juridicamente distinta do transporte público urbano (4921-3) e da linha regular concedida (4922-1). Fretamento é contrato privado com tomador determinado, sem itinerário fixo, documentado por CT-e OS. Consequências: não é alcançado pela desoneração da folha, provavelmente não é alcançado pelas reduções de CBS/IBS do transporte coletivo, e depende do vínculo dos transportados com o contratante para não ser descaracterizado. Nunca classifique apontamento desta empresa presumindo transporte público."
  );

  linhas.push("");
  linhas.push("## Transição de regime e reforma tributária (contexto desta empresa)");
  linhas.push(
    "A empresa avalia migrar para o Lucro Real em janeiro de 2027, no meio da transição da reforma tributária. Marcos:"
  );
  for (const m of MARCOS_REFORMA) {
    linhas.push(`- ${m.periodo}: ${m.titulo}. ${m.oQueMuda} (${m.baseLegal})`);
  }

  linhas.push("");
  linhas.push("Decisões em aberto do projeto de transição:");
  for (const d of DECISOES) {
    linhas.push(`- [${d.codigo}] ${d.titulo} — ${d.pergunta} (${d.baseLegal})`);
  }

  return linhas.join("\n");
}
