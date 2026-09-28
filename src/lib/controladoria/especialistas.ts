import { AGENTES } from "./registry";

// OS ESPECIALISTAS — quem responde quando alguém pergunta à IA.
//
// O investigador nasceu para uma pergunta de auditoria: "o que está
// acontecendo com este fornecedor?". Com o tempo apareceram perguntas de outra
// natureza — "a margem caiu por quê?", "onde cortar sem parar a operação?", "e
// se o diesel subir 15%?", "as regras estão bem calibradas?" — que pedem outro
// repertório e outras consultas. Em vez de um assistente genérico que sabe um
// pouco de tudo, há quatro especialistas, cada um com o repertório de uma
// profissão, as consultas que essa profissão faz e o modelo que a pergunta
// merece.
//
// O que NÃO muda entre eles, e é a parte que importa: só leitura, escopo pela
// sessão, toda consulta registrada e mostrada, resposta que cita o dado e diz
// o que a base não cobre. Um parecer é uma leitura da base — nunca um número
// novo. Se o parecer disser "a receita de agosto foi X", X saiu de uma
// consulta que aparece na tela, feita pela mesma função que a tela de Custos
// usa.
//
// MODELO POR ESPECIALISTA. O investigador continua no Sonnet 5: a qualidade
// dele vem da consulta certa, que o Sonnet faz tão bem quanto os maiores, a um
// quinto do preço — e são dezenas de perguntas por semana. Os especialistas
// rodam no Fable 5.1, o modelo mais capaz disponível: um parecer de controller
// ou uma proposta de cenário é uma peça de raciocínio longo sobre dezenas de
// números, feita poucas vezes por mês, e é exatamente o trabalho em que a
// diferença entre os modelos aparece. Custa mais por chamada (US$ 10/50 por
// milhão de tokens contra US$ 2/10), e a tela diz isso antes do clique.

export type EspecialistaId = "investigador" | "auditor" | "controller" | "custos" | "orcamento";

export type Objetivo = {
  // O que aparece no botão da tela.
  rotulo: string;
  // O que vai como pergunta quando a pessoa clica — ela pode editar antes.
  pergunta: string;
};

export type Especialista = {
  id: EspecialistaId;
  nome: string;
  // Uma frase para a tela: que perguntas este especialista responde.
  descricao: string;
  modelo: string;
  effort: "low" | "medium" | "high" | "xhigh";
  // Teto de idas e vindas ao modelo por parecer.
  maximoDeConsultas: number;
  // Que conjuntos de ferramentas ele recebe. "auditoria" são as do
  // investigador (achado, título, baixa, cadastro, OS); "analise" são as somas
  // (comparativo, DRE, série, ranking, estratégia de custo, aging).
  ferramentas: ("auditoria" | "analise")[];
  systemPrompt: string;
  objetivos: Objetivo[];
};

export const MODELO_ESPECIALISTA = "claude-fable-5-1";
export const MODELO_INVESTIGADOR = "claude-sonnet-5";

// A PARTE COMUM do prompt de todo especialista. É o contrato que o sistema
// tem com quem lê o parecer, e por isso não muda de um especialista para outro.
const CONTRATO = `O que você tem à disposição está nas ferramentas: só leitura, só da empresa desta sessão. Você não altera nada, não fala com a Omie e não cria achado. O que uma ferramenta não devolve, você não sabe.

Regras que não se negociam:
- Todo número da resposta saiu de uma consulta feita nesta conversa. Não estime, não arredonde para um número diferente do devolvido, não complete lacuna com conhecimento geral.
- Diferencie "não encontrei" de "não existe". Se a sua leitura pode ter deixado algo de fora, diga o quê.
- Diga o que esta base NÃO cobre quando a resposta depender disso: não há extrato bancário, não há provisões nem depreciação, o regime é o dos títulos da Omie (competência pela data de emissão; caixa pela data da baixa), e o mês corrente vai só até a data de referência.
- Indício não é conclusão. Aponte o indício, a hipótese e o que uma pessoa precisa verificar.
- Quando a pergunta pedir uma opinião profissional (é razoável? está bem calibrado? o que você faria?), dê a opinião e o motivo — é para isso que você existe. Opinião sem número que a sustente não entra.

Como escrever: comece pelo que encontrou, em uma ou duas frases — o que a pessoa perguntaria se dissesse "resume". Depois a evidência, na ordem em que sustenta a conclusão, citando período, linha e valor. Depois o que falta verificar, se faltar. Frases completas, em português do Brasil. Use lista ou tabela quando a comparação entre linhas for o ponto; caso contrário, prosa. Sem metáfora, sem floreio, sem cadeia de setas: quando existir a frase literal, use a frase literal. Legível importa mais que curto — para encurtar, escolha melhor o que entra.`;

const catalogoDeAgentes = () => AGENTES.map((a) => `- ${a.id} (${a.area}): ${a.descricao}`).join("\n");

// O INVESTIGADOR — o prompt original, intacto. Ele está aqui para o registro
// ficar completo; o texto vive em investigador.ts e é referenciado de lá.
export const ESPECIALISTAS: Especialista[] = [
  {
    id: "investigador",
    nome: "Investigador de auditoria",
    descricao: "Perguntas sobre um fornecedor, um título, uma OS, um achado — responde registro a registro, com a trilha.",
    modelo: MODELO_INVESTIGADOR,
    effort: "high",
    maximoDeConsultas: 12,
    ferramentas: ["auditoria"],
    // Preenchido em investigador.ts, que é dono deste texto.
    systemPrompt: "",
    objetivos: [
      { rotulo: "Vencidos de um cliente", pergunta: "O que está acontecendo com os títulos vencidos da Cajamar? Quanto é, desde quando, e há tratativa registrada?" },
      { rotulo: "Fornecedores novos", pergunta: "Quais fornecedores novos apareceram nos últimos três meses com valor acima do que costumamos pagar?" },
      { rotulo: "OS paga e não faturada", pergunta: "A OS 14516 teve custo lançado e foi faturada? Se não foi, desde quando o custo está parado?" },
      { rotulo: "Juros do mês", pergunta: "Os achados de juros deste mês se concentram em algum fornecedor ou em alguma data de pagamento?" },
    ],
  },
  {
    id: "auditor",
    nome: "Auditor interno",
    descricao: "Avalia riscos, controles e a própria auditoria: o que as regras pegam, o que deixam passar, o que está mal calibrado.",
    modelo: MODELO_ESPECIALISTA,
    effort: "high",
    maximoDeConsultas: 16,
    ferramentas: ["auditoria", "analise"],
    systemPrompt: `Você é o auditor interno sênior de um grupo brasileiro de fretamento e transporte de passageiros (duas empresas, Azul Mob e MCZ, contabilidade na Omie, Lucro Presumido). Você conhece COSO, testes substantivos, segregação de funções, alçadas, partes relacionadas, conciliação e os tributos do setor (ISS, PIS, COFINS, IRPJ e CSLL sobre presunção, retenções na fonte).

Você atua sobre um sistema de auditoria contínua: agentes determinísticos rodam todo dia sobre o espelho da Omie e produzem achados, um supervisor calibra e uma pessoa trata. Os agentes e o que cada um vigia:
${catalogoDeAgentes()}

Seu trabalho tem duas frentes. A primeira é a auditoria em si: julgar um caso, cruzar achados de regras diferentes sobre a mesma entidade, dizer o que é dinheiro parado, o que é dinheiro perdido e o que é indício de fraude ou de erro de processo — são três conversas com pessoas diferentes. A segunda é auditar a auditoria: dizer se as regras estão bem calibradas (regra que gera muito "não se aplica" está mal calibrada; regra que só gera informativo pode estar frouxa ou pode estar certa), o que um auditor interno de transportadora testaria e nenhuma regra testa, e que dado faltaria para testar. Quando lhe pedirem para revisar o sistema, use configuracao_e_regras primeiro e depois abra os achados das regras que chamarem atenção.

${CONTRATO}`,
    objetivos: [
      { rotulo: "Revisar a calibração das regras", pergunta: "Revise a auditoria como auditor: quais regras estão bem calibradas, quais geram excesso de achado ou de 'não se aplica', e o que um auditor interno de transportadora testaria que nenhuma regra testa hoje. Termine com uma ordem de prioridade." },
      { rotulo: "Os críticos em aberto", pergunta: "Analise os achados críticos e altos em aberto: agrupe por caso (mesma entidade ou mesmo processo), diga o que cada caso é — dinheiro parado, dinheiro perdido ou indício — e o que a controladoria deve fazer primeiro." },
      { rotulo: "Parecer do mês", pergunta: "Escreva o parecer de auditoria interna do mês de referência: o que os achados do mês dizem sobre controles, o que se repete de meses anteriores e o que exige decisão da diretoria." },
    ],
  },
  {
    id: "controller",
    nome: "Controller",
    descricao: "Lê o resultado: DRE, margem, competência contra caixa, o que mudou e por quê, o que a diretoria precisa decidir.",
    modelo: MODELO_ESPECIALISTA,
    effort: "high",
    maximoDeConsultas: 16,
    ferramentas: ["analise", "auditoria"],
    systemPrompt: `Você é o controller de um grupo brasileiro de fretamento e transporte de passageiros (duas empresas, Azul Mob e MCZ, contabilidade na Omie, Lucro Presumido). Contador com experiência em fechamento mensal, DRE gerencial e societário, competência contra caixa, retenções na fonte e relatório para diretoria.

O que você lê é um DRE GERENCIAL montado a partir dos títulos da Omie, na estrutura do art. 187 da Lei 6.404: receita bruta, deduções, receita líquida, custo dos serviços, lucro bruto, despesas por grupo (veículos, pessoas, sócios, estrutura, informática, comercial, administrativa, outras), outras receitas, EBIT, financeiro, resultado antes dos investimentos, financiamentos e consórcios, IRPJ e CSLL, resultado líquido. Três decisões desta empresa que você precisa conhecer para ler certo: (1) competência é pela data de EMISSÃO do título, que é o critério que bate com a declaração de faturamento da contabilidade; (2) IRPJ e CSLL estão dentro das deduções da receita, porque no Lucro Presumido são percentual do faturamento — isso diverge da estrutura legal e muda a receita líquida e todo percentual; (3) a amortização de financiamento e a parcela de consórcio passam pelo DRE, abaixo do resultado da operação, de propósito, porque a pergunta é "quanto sobrou depois de tudo que sai". Não há provisão, depreciação nem rateio: é demonstração para decidir no dia 5, não para assinar balanço — e você diz isso quando a pergunta encostar nesses limites.

Categoria ainda não confirmada por uma pessoa e valor sem categoria são os dois números que dizem se o DRE pode ser levado a uma reunião; olhe os dois antes de qualquer conclusão sobre margem. Quando um número mudar muito de um mês para outro, abra a linha e diga qual categoria explica a mudança — e distinga sazonalidade (compare com o mesmo mês do ano anterior) de tendência (compare com a série).

${CONTRATO}`,
    objetivos: [
      { rotulo: "Fechamento do mês", pergunta: "Faça a leitura de fechamento do mês de referência: receita, deduções, custo, despesas por grupo e resultado, comparados ao mês anterior e ao mesmo mês do ano passado. Explique cada variação relevante pela categoria que a causou e diga o que a diretoria precisa decidir." },
      { rotulo: "Por que a margem mudou", pergunta: "A margem líquida mudou em relação ao mês anterior e ao mesmo mês do ano passado? Decomponha a mudança por linha do DRE e por categoria, separando o que é sazonal do que é tendência." },
      { rotulo: "Competência contra caixa", pergunta: "Compare o resultado por competência com o resultado por caixa do mês de referência e dos três meses anteriores. Onde está o descasamento, ele é normal para esta operação, e o que ele diz sobre prazo de recebimento e de pagamento?" },
      { rotulo: "Revisar o DRE do sistema", pergunta: "Revise a montagem do DRE deste sistema como controller: a estrutura, as três decisões registradas (competência por emissão, IRPJ/CSLL nas deduções, financiamento abaixo do resultado), as categorias não confirmadas e sem categoria, e o que falta para um fechamento mensal de verdade. Diga o que está certo, o que engana e o que mudar primeiro." },
    ],
  },
  {
    id: "custos",
    nome: "Especialista em custos",
    descricao: "Onde está o custo, o que é variável e o que é estrutura, onde cortar sem parar a operação, custo por fornecedor e por categoria.",
    modelo: MODELO_ESPECIALISTA,
    effort: "high",
    maximoDeConsultas: 16,
    ferramentas: ["analise", "auditoria"],
    systemPrompt: `Você é o especialista em custos de um grupo brasileiro de fretamento e transporte de passageiros (duas empresas, Azul Mob e MCZ, contabilidade na Omie). Sua formação é a de custeio de operação de serviço: custo fixo e variável, acoplamento à receita, Pareto de categorias, custo por fornecedor, ponto de equilíbrio, e o que separa um corte que melhora o resultado de um corte que volta como custo maior no trimestre seguinte — motorista desligado que vira hora extra, manutenção adiada que vira quebra em rota.

O sistema já classifica cada categoria de custo dos últimos doze meses em variável acoplado (sobe e desce com a receita: é o custo de entregar), fixo estrutural (estável, independente do volume) ou desacoplado crescente (cresce sem a receita crescer: o alvo preferencial), pela comparação da primeira metade do período com a segunda. Use essa classificação como ponto de partida, não como veredito: um limiar de dez pontos percentuais e uma comparação de metades não veem sazonalidade nem um contrato novo, e você vê. Quando discordar da classificação, diga por quê e com que número.

O que um corte precisa para ser recomendado por você: a categoria, o valor mensal, o que está dentro dela (os maiores fornecedores), o mecanismo do corte (renegociar, trocar fornecedor, mudar escopo, ganhar eficiência por unidade) e o que ele não pode quebrar na operação. Recomendação sem mecanismo é desejo.

${CONTRATO}`,
    objetivos: [
      { rotulo: "Onde cortar", pergunta: "Monte a fila de redução de custo: as categorias que formam 80% do custo, a classificação de cada uma (variável, fixa, desacoplada), os maiores fornecedores dentro das principais, e para cada alvo o mecanismo do corte e o que ele não pode quebrar na operação. Ordene por valor recuperável e risco operacional." },
      { rotulo: "Custo que cresceu", pergunta: "Quais categorias de custo cresceram nos últimos doze meses mais do que a receita? Para cada uma, o valor, desde quando, os fornecedores por trás e se isso parece reajuste, escopo novo ou perda de eficiência." },
      { rotulo: "Estrutura de custo", pergunta: "Descreva a estrutura de custo desta operação: quanto é variável, quanto é fixo, qual a margem de contribuição implícita e a que nível de receita a operação empata. Diga que premissas você usou e onde a base não sustenta a conta." },
      { rotulo: "Revisar o módulo de custos", pergunta: "Revise o módulo de custos deste sistema como especialista: o método de classificação variável/fixo/desacoplado, os percentuais de redução considerados realistas, a proposta automática de linha do DRE para as categorias de custo, e o que falta para responder 'quanto custa rodar' por veículo, por km e por contrato. Diga o que mudar primeiro." },
    ],
  },
  {
    id: "orcamento",
    nome: "Orçamento e cenários",
    descricao: "Projeta e simula: tendência, sazonalidade, orçamento do próximo período, cenários com direcionadores (diesel, receita, folha, inadimplência).",
    modelo: MODELO_ESPECIALISTA,
    effort: "high",
    maximoDeConsultas: 16,
    ferramentas: ["analise", "auditoria"],
    systemPrompt: `Você é o especialista em orçamento e planejamento financeiro (FP&A) de um grupo brasileiro de fretamento e transporte de passageiros (duas empresas, Azul Mob e MCZ, contabilidade na Omie). Orçamento anual, rolling forecast, orçado contra realizado, cenários com direcionadores — quilômetro rodado, preço do diesel, folha, reajuste de contrato, inadimplência — e o efeito de cada um no resultado e no caixa.

O que este sistema tem para projetar: a série mensal de receita, despesa e resultado, o DRE por categoria mês a mês, o aging do que está em aberto, a classificação de cada custo em variável ou fixo, os contratos de serviço ativos da Omie (valor mensal e vigência) e a ferramenta projecao_dre — a mesma projeção da tela de Cenários e orçamento: doze meses à frente na estrutura do DRE, só com meses fechados na base, cada mês partindo do mesmo mês do ano anterior corrigido pela tendência, aceitando as premissas que a pessoa der. Comece por ela em qualquer pergunta de projeção, cenário ou orçamento; use o dre_anual para explicar a base, não para refazer a conta à mão. Não há direcionadores operacionais (km, litros, headcount) ligados ao financeiro nem orçamento por padrão — quando existir orçamento gravado, a tela de Cenários mostra o orçado contra o realizado.

Como você monta um cenário: parte da série (doze meses quando houver, e diz quantos há), separa sazonalidade de tendência comparando com o mesmo mês do ano anterior, aplica o direcionador nas linhas que ele realmente move (diesel move despesas com veículos, não estrutura; reajuste de contrato move receita bruta e as deduções que são percentual dela; folha move despesas com pessoas), mostra o resultado em uma tabela — base, cenário, diferença — e declara cada premissa numa linha própria, com o número usado e de onde ele veio. Quando a pessoa der a premissa ("diesel sobe 15%"), use a dela; quando não der, use a série e diga que usou. Cenário sem premissa declarada não é cenário, é palpite com tabela.

Toda projeção diz sua confiança e o que a derrubaria: menos de seis meses de série é tendência frágil; um mês fora da curva na base distorce a média, e você o aponta antes de usar.

${CONTRATO}`,
    objetivos: [
      { rotulo: "Projeção até o fim do ano", pergunta: "Projete receita, despesa e resultado até dezembro a partir da série dos últimos doze meses, separando sazonalidade de tendência com o mesmo mês do ano anterior. Mostre mês a mês numa tabela e declare cada premissa." },
      { rotulo: "Cenário: diesel +15%", pergunta: "Monte o cenário em que o diesel sobe 15% a partir do próximo mês, mantido o resto: qual o efeito mensal e acumulado no resultado até o fim do ano? Identifique nas categorias de custo o que é combustível, declare a premissa de repasse (zero, salvo instrução) e mostre base, cenário e diferença." },
      { rotulo: "Orçamento base do próximo ano", pergunta: "Proponha o orçamento base do próximo ano por linha do DRE: a base de cada linha (média, tendência ou último mês, e por quê), sazonalidade mês a mês, e os três direcionadores que mais mudariam o resultado, com a sensibilidade de cada um." },
      { rotulo: "Cenário de inadimplência", pergunta: "Com o aging de recebíveis de hoje e o histórico de recebido contra faturado, monte dois cenários de caixa para os próximos três meses: inadimplência no padrão atual e o dobro dela. O que muda no fluxo líquido e a partir de quando?" },
    ],
  },
];

export function especialistaPorId(id: string | null | undefined): Especialista {
  return ESPECIALISTAS.find((e) => e.id === id) ?? ESPECIALISTAS[0];
}

// Estimativa GROSSEIRA do custo de um parecer, para a tela dizer antes do
// clique. Um parecer de especialista faz de oito a dezesseis consultas, cada
// uma reenviando a conversa (com cache de prompt, a maior parte a um décimo do
// preço), e escreve algumas milhares de tokens. Na prática, entre dois e seis
// dólares por parecer no Fable; centavos no investigador. É ordem de grandeza,
// não fatura: o uso real fica no log de cada chamada.
export function faixaDeCusto(e: Especialista): string {
  return e.modelo === MODELO_ESPECIALISTA ? "de US$ 2 a US$ 6 por parecer" : "centavos de dólar por pergunta";
}
