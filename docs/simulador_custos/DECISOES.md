# Simulador de custos e preços — decisões

O simulador é um **módulo do sistema**, não uma planilha. Um *estudo* é
qualquer operação que se quer custear antes de existir — licitação, contrato
privado, renovação ou orçamento interno — e cada estudo guarda versões com a
conta inteira. A planilha Excel é só uma das saídas.

Base do trabalho: o pacote de migração em `docs/simulador_custos_handoff/`
(especificação, sementes, planilhas de referência de Holambra PE 036/2026 e
São José dos Pinhais PE 089/2026, Gabarito em branco), dois modelos de
concorrentes e a pesquisa em `PESQUISA.md` (57 fontes: GEIPOT, ANTP, FNDE,
IN 5/2017, editais, TCU, legislação tributária e trabalhista).

## 1. Onde está

| O quê | Onde |
|---|---|
| Motor (função pura `simular`) | `src/lib/simulador/motor.ts`, tipos em `tipos.ts` |
| Premissas, origem de cada número, tipos de veículo | `src/lib/simulador/premissas.ts` |
| Base de custos com vigência (Gabarito) | `baseDeCustos.ts`, `gabarito.ts`, `catalogo.ts` |
| Ajuste da base pela tela (tela Custos base) | `edicaoBase.ts`, `src/app/(app)/simulador/base/` |
| Estudos, versões, lances, resultado, realizado | `estudos.ts` |
| Painel de decisão | `decisao.ts` |
| Calibração realizado × previsto | `calibracao.ts` |
| Custos reais da empresa | `custosReais.ts` (servidor), `aplicarReais.ts` (navegador) |
| Encargos por grupos e motoristas por veículo | `maoDeObra.ts` |
| Excel em fórmulas | `exportarXlsx.ts`, `exportacaoEstudo.ts`, rota `/api/simulador/[estudoId]/xlsx` |
| Especialista de IA em precificação | `ferramentasDoSimulador.ts`, registro em `src/lib/controladoria/especialistas.ts` |
| Telas | `src/app/(app)/simulador/` (lista, novo, editor `[id]`, base) |
| Tabelas | `Sim*` em `prisma/schema.prisma`, migração `20260930120000_simulador_custos` |
| Testes | `teste:simulador`, `teste:gabarito`, `teste:decisao`, `teste:custos-reais`, `teste:mao-de-obra`, `teste:exportar-xlsx`, `teste:simulador-banco`, `teste:especialistas` |

Permissões: `simulador` abre as telas e exporta; `gerir-simulador` cria
estudos, salva versões, registra lances, resultado e realizado, e importa a
base. Toda gravação passa pela trilha de auditoria.

## 2. Como se monta um orçamento

O editor segue a ordem em que um orçamento se constrói, e o resumo do topo
(preço, faturamento, custo, lucro, margem e veredicto) é sempre a conta de
verdade, recalculada no navegador pelo mesmo motor que o servidor usa ao
salvar.

1. **Operação**: unidade de preço (km, veículo-mês, diária, hora ou
   binômia), julgamento por item ou lote, apuração mensal ou por período,
   utilização, itens (com ou sem motorista, combustível por conta do
   cliente) e rotas (tipo de veículo, km, veículos, motoristas, noturno,
   pedágio, horas por dia). Itens e rotas se incluem, duplicam e excluem na
   própria tabela.
2. **Veículos**: carro, van, micro e ônibus lado a lado, cada um com o seu
   veículo, custos por km e **motorista** (salário pela categoria da CNH e
   motoristas por veículo). Trocar o tipo de uma rota sugere os motoristas.
   A calculadora de jornada dá os motoristas por veículo.
3. **Premissas**: todas as premissas com a **origem** de cada número (base
   da empresa, custo real medido, estimativa, ajuste manual), os custos reais
   para escolher e aplicar, os presets de regime tributário e a calculadora
   de encargos.
4. **Custos**: a composição por item.
5. **Cenários**: lucro por utilização, ponto de equilíbrio (mínimo no preço
   por km, máximo no preço fixo).
6. **Decisão**: veredicto, faixa de lance (piso de lucro zero, margem
   mínima, alvo, teto do edital), sensibilidade (cada premissa 10% pior ao
   mesmo preço), alertas e acesso ao especialista de IA.
7. **Orçamento**: o preço de cada item na unidade do contrato e em todas as
   outras, franquia de km e km excedente, CSV e Excel.
8. **Versões e resultado**: versões salvas (abrir, baixar o Excel), lances,
   resultado da disputa e realizado × previsto com a calibração.

Desfazer (botão ou Ctrl+Z) e o aviso de alteração não salva valem em
qualquer aba. Quem tem só leitura simula à vontade e não salva.

## 3. Decisões de arquitetura

- **Um motor, puro.** `simular(entrada)` não lê banco nem relógio. A tela, o
  salvamento, a exportação, o painel e o especialista de IA chamam a mesma
  função; um número citado em qualquer lugar é o mesmo número.
- **Versão é snapshot.** Cada versão grava a entrada inteira e o resultado.
  Reabrir uma versão antiga mostra a conta como ela foi; `reexecutar` confere
  que o motor atual ainda chega ao número gravado.
- **A base de custos nunca é sobrescrita.** Valor alterado fecha a vigência
  do anterior; cada versão lembra a data da base usada.
- **Toda premissa diz de onde veio.** `MapaOrigem` acompanha a entrada; o
  painel aponta as premissas decisivas que ainda são estimativa.
- **Custo real é oferta, não imposição.** Os indicadores medidos na
  controladoria (DRE por categoria, cartão de combustível, frota) aparecem
  com a conta, a amostra e a confiança; só entram no estudo quando alguém
  escolhe. É o diferencial: precificar com o que a empresa gasta de fato.
- **Excel em fórmulas.** A planilha exportada é a conta, não um relatório: as
  premissas são entradas e o resto é fórmula. O teste recalcula a planilha com
  LibreOffice e com a biblioteca `formulas` e compara com `simular()`.
- **Sem segredo no navegador.** A tela recebe a base e os indicadores já
  lidos; mensagens de erro de banco ficam no log do servidor.

## 4. O que as planilhas de referência fazem e o motor reproduz

O motor reproduz Holambra e São José dos Pinhais com diferença relativa da
ordem de 1e-7, inclusive o arredondamento para cima do preço do lote. Para
manter a reprodução, os dois estudos históricos guardam as premissas
originais, inclusive as que a pesquisa corrigiu:

- **IRPJ de 1,2%** (base presumida de 8%, que é a de cargas). Transporte de
  passageiros presume 16%: 2,4% da receita, e 4% com o adicional de 10% que
  toda empresa desse porte paga na margem. O painel mostra o alerta "IRPJ na
  base presumida de cargas" quando o estudo usa a alíquota antiga; o padrão
  de estudos novos e o preset Presumido usam 4%.
- **Depreciação percentual sobre o valor cheio** e remuneração do capital
  sobre o valor cheio. Estudos novos podem usar linear ou soma dos dígitos e
  remuneração sobre o valor médio.

## 5. O que veio dos concorrentes

Dos dois modelos de concorrentes o módulo incorporou: o preço expresso por
mês, por veículo, por km, por diária e por hora a partir da mesma
composição; a **tarifa em duas partes** (fixo por veículo-mês mais variável
por km, a "binômia"); a hora extra calculada por hora, com 50%, 100% e
noturno; as despesas que incidem sobre o preço; e a referência de 2,2
motoristas por van, que bate com o limite inferior do GEIPOT.

## 6. Correções e acréscimos da pesquisa

- **Regimes tributários.** Três presets: Presumido (IRPJ 4% com o
  adicional, CSLL 1,08%,
  PIS/COFINS cumulativos 3,65%); Real para transporte de passageiros (IR/CSLL
  34% sobre o lucro, PIS/COFINS **continuam cumulativos e sem crédito**,
  Solução de Consulta Cosit 50/2026); Real para locação sem motorista
  (PIS/COFINS não cumulativos 9,25% com crédito).
- **Depreciação padrão.** O padrão de estudos novos estava em 0,1 ÷ 6 =
  1,7% a.a.; a conta pretendida era (1 − 10% de revenda) ÷ 6 anos = 15% a.a.
  Corrigido; os estudos históricos não usam o padrão.
- **Encargos por grupos A a D** (GEIPOT), com presets Presumido/Real, CPRB
  (só CNAE 4921/4922 — fretamento é 4929) e Simples. Férias entram **ou** no
  fator de utilização **ou** nos encargos, nunca nos dois. A multa do FGTS
  provisionada é de 40%: a contribuição adicional de 10% da LC 110 foi
  extinta a partir de 2020.
- **Motoristas por veículo pela jornada** (44 h em 5x2 ou 6x1, 12x36), com a
  alternativa de motoristas inteiros e horas extras. O tempo de espera conta
  como jornada desde a ADI 5322.
- **Franquia de km e km excedente** nos contratos por veículo-mês, diária ou
  hora: o km acima do previsto é custo sem receita.
- **Alertas novos**: depreciação abaixo de 8% a.a. para van e micro; ARLA
  acima de 6% do custo de combustível; contrato que atravessa 2027
  (reforma tributária: CBS por fora do preço no lugar de PIS/COFINS; ISS e
  ICMS caem de 2029 a 2032) — informativo, pede cláusula de reequilíbrio.
- **Parcela de financiamento nunca entra no custo.** O Gabarito guarda a
  parcela para o fluxo de caixa; o veículo é pago por depreciação mais
  remuneração do capital, e somar a parcela contaria o veículo duas vezes.
- **Horas noturnas pagam só o adicional.** As horas noturnas em horas estão
  dentro da jornada que o salário já paga; o motor as cobrava a 1,2 × valor
  da hora, pagando a hora-base duas vezes. Agora cada hora de relógio entre
  22h e 5h custa `(1 + adicional) × 60 ÷ 52,5 − 1` do valor da hora (hora
  reduzida de 52′30″, CLT art. 73): 37,1% com 20%, 42,9% com 25%. O
  adicional é premissa (`pessoal.adicionalNoturnoPct`, 20%; vem do
  `noturno_pct` da base quando houver). Hora noturna além da jornada é hora
  extra. O `fatorJornadaNoturna` (rotas noturnas) ficou como estava: é um
  multiplicador agregado de jornada estendida e noturno, e cobrir o mesmo
  adicional pelos dois caminhos contaria duas vezes — a ajuda das duas
  premissas avisa.
- **Locação sem motorista tem os tributos da locação.** O item sem motorista
  pagava ISS/ICMS e a presunção do transporte. Locação de bem móvel não tem
  ISS (Súmula Vinculante 31) nem ICMS, e no Presumido presume 32%: IRPJ
  8% (25% × 32%, com o adicional de 10%, como o transporte já tem nos 4%) e
  CSLL 2,88% da receita (`preco.irpjLocacao`, `preco.csllLocacao`). Até
  out/2026 o IRPJ padrão era 4,8%, sem o adicional; os estudos salvos com
  4,8% gravado continuam com ele até a premissa voltar à base.
  No Real, o item segue o regime (IR sobre o lucro). PIS/COFINS continuam os
  do estudo: um estudo misto no Real (transporte cumulativo, locação não
  cumulativa com crédito) ainda não é separado por item.
- **Base do IR no Lucro Real.** O custo inclui a remuneração do capital
  próprio (custo de oportunidade, não despesa) e a contingência (provisão), e
  o IR era calculado sobre o lucro depois deles. Agora a base é lucro antes
  do IR + N, com N = capital próprio × meses + contingência; com capital
  composto, só a parte própria (`(1 − fração financiada) × custo do capital
  próprio`, também sobre as adaptações) — os juros financiados são despesa.
  O preço que dá o lucro alvo α depois do IR sai de
  `(P·L − C) − ir·(P·L − C + N) = α·P`:
  `P = (C + N·ir/(1 − ir)) ÷ (L − α/(1 − ir))` — o divisor é o mesmo, o custo
  a cobrir ganha o IR sobre N. Idem no preço mínimo (α = 0), na binômia (N
  do fixo e do variável em cada parcela), nos cenários e no equilíbrio, que
  passa a ser o de lucro zero depois do IR. Contingência não dedutível é o
  lado prudente: se o risco acontecer, a despesa deduz. Os dois históricos
  são Presumido, sem item sem motorista e sem horas noturnas: nada muda
  neles. Versões salvas antes (motor `2026.09-v1`) com Real, locação ou
  horas noturnas dão outro número ao reexecutar.

## 6.1 Correções das revisões de especialistas (set/2026)

Duas revisões independentes — precificação e experiência de uso — rodaram
sobre o módulo pronto. O que foi confirmado e corrigido, além das três
correções do motor acima:

- **Leitura de números pt-BR** (`numeros.ts`, uma regra para tela e
  servidor). Entrar e sair de um campo com "2.000" gravava 2; no servidor,
  "9.31" virava 931. Passar pelo campo não grava; Esc desiste; entrar com
  Tab seleciona o valor.
- **Administração central sobre o custo direto.** O motor aplica a
  administração sobre o custo direto, mas o custo real e a base a ofereciam
  como % da receita. O custo real mede sobre o custo direto do DRE; a base
  converte `x = a·(1 + c)/(d − a)`, com `d` o divisor do preço (com o ISS)
  e `c` a contingência, que o motor soma à administração sobre o custo
  direto. Até out/2026 a conversão ignorava `c` e usava o maior entre ISS e
  ICMS (12%): com 8,8% da receita, a administração saía 15,95% do custo
  direto, ou 9,5% do preço, e não 14,58% (8,8% do preço).
- **IRPJ presumido com o adicional**: 4% da receita, com aviso quando o
  estudo usa 2,4%. Alertas críticos para IRPJ/CSLL na receita e no lucro ao
  mesmo tempo e para crédito de PIS/COFINS no regime cumulativo.
- **Encargos padrão** pelos grupos A a D com as férias no fator de
  utilização: 62,45% (os 68% anteriores somavam as férias duas vezes).
- **Sensibilidade**: no preço por veículo, diária ou hora, o risco medido é
  rodar mais km.
- **Garantia contratual** da base entra como despesa sobre o preço.
- **Estudo sem rota** não mostra veredicto nem zeros, e não se salva.

Ficaram registrados como melhoria, sem mudança agora: o piso salarial por
convenção coletiva (alerta de salário abaixo do piso), um ônibus 0 km entre
os tipos padrão, remuneração do capital sobre o valor médio como padrão,
deságio contra o preço de referência do edital e indício de
inexequibilidade, data-base da convenção antes do reajuste anual,
presets de IPVA e ICMS por UF, e PIS/COFINS por item em estudo misto no
Lucro Real (transporte cumulativo e locação não cumulativa).

## 7. Especialista de IA em precificação

Registrado entre os especialistas da tela Investigar, com as mesmas
garantias dos outros: só leitura, escopo pela sessão, toda consulta
registrada e mostrada. Ferramentas: listar e ler estudos (a conta, a origem
das premissas e o painel), simular variações numa cópia (o preço novo para a
margem alvo e o resultado ao preço já lançado; ajuste proporcional que
alcança os tipos de veículo), custos reais, histórico de disputas e base de
custos. A aba Decisão leva ao especialista com perguntas prontas sobre o
estudo aberto. Ele lê só versões salvas.

## 7.0 Público ou privado, e os tipos de veículo

O estudo nasce com a **esfera**: público (licitação, contratação direta,
renovação — pede edital, modalidade, sessão, preço máximo, reajuste do
edital, SRP) ou privado (proposta comercial — CNPJ da empresa cliente,
responsável, validade da proposta, início previsto, reajuste, faturamento,
aviso de rescisão). A esfera também escolhe o prazo de recebimento padrão
da base (prefeituras ou empresas).

Tipos de veículo: as quatro **categorias** (carro, van, micro, ônibus) e as
variantes **adaptada** (elevador ou rampa, ancoragem de cadeira de rodas,
menos lugares; o equipamento entra como adaptação depreciada na vigência, e
a manutenção dele por mês) e **unidade móvel** (veículo implementado como
consultório ou posto de atendimento; a implementação entra como adaptação,
não leva passageiros, CNH C acima de 3,5 t). Os valores padrão das variantes
são estimativas, ajustáveis em Custos base. Os custos reais são medidos por
categoria e valem para as variantes dela; o salário do motorista vem da
função do mesmo tipo ou, sem ela, da categoria.

Energia: cada tipo de veículo tem a sua — diesel, gasolina, etanol ou
elétrico. O motor não muda: o campo de preço é o preço por unidade de
energia (litro ou kWh) e o consumo é km por essa unidade. Trocar a energia
na aba Veículos puxa o preço da base (diesel, gasolina, etanol ou tarifa da
recarga em R$/kWh), zera a ARLA fora do diesel e, no elétrico, põe o
consumo típico da categoria em km/kWh. Preço e consumo medidos no cartão de
combustível não se aplicam aos tipos elétricos.

## 7.0.1 Editar os dados do estudo e abrangência

Os dados do estudo (nome, cliente, tipo, serviço, município, vigência,
prazo, esfera, edital ou proposta, objeto) se editam depois de criado, em
"Editar dados do estudo" — o mesmo formulário da criação, preenchido. Itens,
rotas, tipos de veículo, unidade de preço e julgamento continuam nas abas,
que é onde a versão os guarda. Versões salvas não mudam; vigência e prazo
editados entram na reabertura como ajuste ("dados do estudo") e o editor
abre com "alterações não salvas".

**Abrangência**: municipal (ISS), intermunicipal (ICMS) ou misto. Municipal e
intermunicipal põem o % intermunicipal de todos os itens em 0 ou 100%; misto
deixa o % por item na aba Operação.

## 7.0.2 Mão de obra × veículo

A aba Custos abre com o custo separado em mão de obra (salários, encargos,
benefícios, supervisão) e veículo — fixo (capital, seguro, IPVA, telemetria,
garagem, adaptações, manutenção fixa, com a reserva técnica) e variável
(combustível, ARLA, óleo, pneus, manutenção por km, pedágio) — com a
implantação à parte. Cada parte leva a sua fração de administração e
contingência (são % do custo direto), e o crédito de PIS/COFINS abate só do
veículo, de onde ele vem. O preço de cada parte é o faturamento rateado pelo
custo líquido: uma leitura do preço calculado (quanto paga a equipe, quanto
paga o carro, por veículo-mês e por km), não um segundo preço. Serve para
quem pede os dois valores separados e para comparar com a locação pura.
Conta em `src/lib/simulador/separacao.ts`; a tabela de composição ganhou os
subtotais de cada parte. Cada cartão traz a memória de cálculo: salário de
cada tipo × motoristas, horas extras, jornada noturna e monitoras; encargos
pelos grupos A a D (quando o % é o do cálculo padrão); benefícios por pessoa;
e administração central e contingência em linhas separadas.

Correção junto: a função de motorista da base sem nenhum benefício preenchido
zerava VR/VA, cesta e plano no estudo. Agora só substitui o padrão da
convenção quando informa ao menos um benefício.

## 7.1 Custos base editáveis

A tela **Custos base** (submenu do simulador) mostra cada parâmetro do
Gabarito com o valor que vale hoje, de onde veio (base, com data e autor, ou
o padrão do simulador), o valor anterior e onde ele entra na conta. Frota,
mão de obra por função e pedágios são tabelas editáveis, e os tipos padrão
do simulador podem ser trazidos para a base e ajustados. Ajustar pela tela
usa a mesma gravação da importação: valor diferente fecha a vigência do
anterior e abre uma nova com a fonte "ajuste na tela"; "voltar ao padrão"
encerra o valor da base. Estudos já salvos não mudam.

**Custos indiretos vindos do DRE.** Enquanto a base não tem o valor
digitado, cada custo indireto (administração central) é a média mensal da
linha do DRE consolidado — Azul + MCZ, sem as operações entre elas — nos
doze meses fechados com receita: folha administrativa = pessoas —
corporativo; contabilidade e jurídico = despesas administrativas; sistemas =
informática; sede = estrutura; despesas gerais = comerciais + outras
despesas operacionais; faturamento médio = receita bruta. Oficina própria
não tem linha no DRE: é a folha da empresa corporativa lançada no centro
de custo (departamento da Omie) cujo nome tem "oficina", e sai da folha
administrativa. Contabilidade e jurídico são os pagamentos ao escritório
contratado (parâmetro da base, padrão JL Business), e o que sobra das
despesas administrativas vai para despesas gerais — a soma dos indiretos
continua a do DRE. A tela mostra o valor, o período e as categorias da
Omie que o compõem; o estudo novo calcula a administração com eles, e a
origem da premissa diz "DRE consolidado". Digitar um valor na base continua
valendo acima do DRE.

### Composição da administração central em Excel

Na base de custos, "baixar a composição em Excel" (`/api/simulador/indiretos`)
gera a planilha com os mesmos números com que o estudo novo abre: aba Resumo
(cada custo de estrutura em R$/mês, faturamento médio, % da receita e a
conversão para % do custo direto em fórmulas, com lucro, tributos e giro
editáveis) e aba Categorias por mês (cada categoria do Omie nos doze meses
fechados, a contabilidade pelos pagamentos à JL/Joel, a oficina pelo centro de
custo, média só dos meses com receita). `scripts/teste-indiretos-xlsx.ts`
recalcula no LibreOffice e confere com `indiretosDoDre`. As abas Por
fornecedor e Lançamentos abrem cada custo nos títulos do Omie (quem recebeu,
documento, competência, centro de custo), com a diferença para o DRE
(movimentos de caixa sem título e ajustes).

**Sócios na administração central (revisto em 03/10/2026).** A linha
"Despesas com sócios" do DRE (retirada de valor e adiantamento de distribuição
de lucro) **não** entra: remunera o sócio e já sai do lucro alvo do preço;
contá-la também como estrutura cobrava duas vezes, e o valor oscilava de
R$ 330 mil a R$ 770 mil por mês. No lugar dela entra o **pró-labore fixo**
`pro_labore_socios` da base de custos, padrão R$ 180 mil/mês. O campo
`socios_pct_adm` deixou de existir. Parcelamentos de tributos ("1124 -
Parcelamento Simplificado", "1734 - Parcelamento da Dívida Ativa"),
empréstimos ("Devolução Empréstimo", "Pagamento de Empréstimos"), "Baixa 100%
de Desconto" e "Desconto de Baixa de Título" ficam **sempre** fora da
administração, junto do que o campo `categorias_fora_adm` disser. Em
04/10/2026 entraram na mesma lista, por estarem em "despesas gerais" sem ser
estrutura: blindagem, adesivos, rastreador e comissão na venda de veículo
(custo do veículo), pagamentos incorretos e adiantamento a fornecedor (não
são despesa), PCC 5952 (tributo retido), seguro-garantia (já cobrado sobre o
preço), Uber (deslocamento de motorista) e PLR (benefício do motorista; a da
folha corporativa continua). Na composição do grupo de out/25 a set/26, a
administração caiu de 14,7% para 8,2% da receita — de 29,8% para 14,7% do
custo direto. Advogados ficam fora (decisão da diretoria); a oficina entra
pela folha da MCZ. O repasse da Azul à MCZ em "Apoio Administrativo" (R$ 180
mil em setembro/2026) fica **sempre** fora (`FORNECEDORES_SEMPRE_FORA`): é a
MCZ cobrando a folha administrativa que já está na linha corporativa. A
exclusão por fornecedor passou a valer também para categoria classificada
inteira em "pessoas — corporativo"; só os PJs do apoio (cerca de R$ 79 mil)
entram, quando a categoria for reclassificada. A folha da oficina continua na administração.

**Seguro de vida e carro.** O seguro de vida da Azul (R$ 15 por pessoa/mês)
entra nos benefícios padrão; vale-transporte fica zero (por estudo). O carro
(SINDILOCADESP) usa o padrão da TRANSFRETUR Nível B até a convenção dele ser
informada.

**Fora da administração central.** O que está nas linhas de estrutura do DRE
mas não é estrutura sai do rateio: por fornecedor (`fornecedores_fora_adm`,
padrão "Manoel", o advogado) e por categoria (`categorias_fora_adm`, padrão
"Compra de Serviços", a terceirização com outras transportadoras, que é custo
da operação). Sai do custo e não vai para nenhum outro; a planilha mostra o
que saiu, fora das somas.

## 7.1.1 Capital e depreciação nas regras da Azul Mob

As regras da Azul Mob na base ganham a remuneração do capital próprio, a
parte da frota financiada, a taxa do financiamento, o método de depreciação
(percentual, linear ou soma dos dígitos), a vida útil e o valor residual.
Qualquer regra de capital liga o capital composto (parte financiada à taxa
do financiamento + parte própria ao custo de oportunidade). As regras valem
para todos os tipos de veículo dos estudos novos, por cima da taxa de cada
modelo da tabela da frota. Cada regra tem na tela um "o que é?" com o
conceito.

## 7.1.2 Mão de obra pelas convenções coletivas

Padrões da mão de obra (em `convencoes.ts`), com os valores de 01/11/2026:
- **Fretamento — TRANSFRETUR × SINDIFRETUR 2026/2028** e Circular 013-A/2026:
  Nível A (ônibus acima de 32 lugares) R$ 3.733,44; Nível B (van e micro,
  empresa com acordo coletivo) R$ 2.986,75 (80% do A); por mês, PLR
  R$ 137,50 (R$ 1.650/ano, sem encargos), cesta R$ 190, VR R$ 1.092 (R$ 42 ×
  26 dias), plano médico R$ 283,76 e odontológico R$ 50. Jornada de 44 h
  (7h20/dia); domingo e feriado a 100%.
- **Administrativo — TRANSFRETUR × SINDRASP 2026/2028** (Circular 028/2026):
  auxiliar administrativo R$ 1.957,83; PLR de 40% do salário (até
  R$ 1.605/ano); VR R$ 42 por dia; odontológico familiar pago pela empresa.
- **Carro — SINDILOCADESP**: convenção não obtida; padrão do simulador.

A tabela de mão de obra ganhou a coluna PLR (R$/mês), somada aos benefícios.
**Fretamento eventual**: a cláusula 9ª paga ao motorista um prêmio de 8% da
nota sem os tributos (fim de semana, feriado, viagem longa; 5% em dia útil
fora do expediente) no lugar de horas extras e adicional noturno — o estudo
eventual nasce com o prêmio nas despesas sobre o preço e sem hora extra.

### Vale-refeição por dia trabalhado

A convenção paga o VR por dia trabalhado (R$ 42). A circular conta 26 dias
(escala 6x1), mas um contrato de segunda a sexta paga ~22. Por isso o VR é
uma premissa própria, em R$ por dia (`pessoal.valeRefeicaoDia`), e os dias
saem da operação de cada rota: dias no mês do item (ou km ÷ km/dia; no
período letivo, dias do período ÷ meses), até 26 por pessoa. Os demais
benefícios (cesta, PLR, plano) continuam mensais em "Outros benefícios".
Na base, a função ganhou "VR por dia trabalhado"; uma linha com VR/VA
mensal continua valendo como está, sem o VR por dia (não paga o mesmo vale
duas vezes). Versões salvas antes não têm o campo e mantêm o VR no mensal.
Motor 2026.10-v3.

## 7.2 Pedágio pela categoria, margem de indiferença e reforma

Aprendido com o roteiro de outro kit de custeio (detalhe em
`APRENDIZADOS_VERIFICAR.md`):

- **Pedágio pela categoria do veículo**, que segue os eixos e a rodagem do
  eixo traseiro, não a lotação: rodagem simples (carro, van Master) ×1,
  2 eixos de rodagem dupla (van Sprinter 516, micro, ônibus) ×2, 3 eixos ×3.
  Cada tipo de veículo tem a sua categoria (aba Veículos); a rota escolhe a
  praça da tabela de pedágios da base e a tarifa por passagem sai da coluna
  da categoria, ou da tarifa de carro × multiplicador, com o desconto da tag.
  Digitar a tarifa à mão solta a praça. A praça fica gravada na rota
  (`SimRota.pracaPedagio`).
- **Margem de indiferença Presumido × Real** na aba Premissas: a margem antes
  do IRPJ em que os dois regimes pagam o mesmo (14,94% com as alíquotas
  padrão), calculada com as alíquotas do próprio estudo.
- **Reforma**: fretamento não tem a redução de 40% do IBS/CBS (ela é do
  transporte coletivo regular); em 2026 a CBS de 0,9% e o IBS de 0,1% são
  compensáveis, sem carga adicional.
- **Registro intermunicipal em SP**: ARTESP; a EMTU deixou de ser citada como
  órgão vigente.

## 7.3 Reforma tributária ano a ano (aba 6. Reforma)

O estudo calcula com os tributos de hoje; a aba Reforma passa o mesmo custo
por cada ano civil do contrato com os tributos daquele ano
(`src/lib/simulador/reforma.ts`):

- 2026: PIS/COFINS como hoje; CBS 0,9% + IBS 0,1% de teste, compensados;
- 2027–2028: sem PIS/COFINS; CBS cheia − 0,1 p.p.; IBS 0,1%;
- 2029–2032: ISS/ICMS a 90/80/70/60%; IBS a 10/20/30/40% da referência;
- 2033: ISS/ICMS extintos; IBS cheio.

CBS e IBS por fora do preço, com crédito sobre as compras (combustível,
ARLA, óleo, pneus, manutenção, pedágio, garagem, telemetria, higienização;
o veículo só com "comprado com crédito"), a folha sem crédito. IRPJ/CSLL
continuam (Presumido: sobre a receita sem CBS/IBS). Duas leituras: B, o
preço que mantém o lucro alvo (nota a cobrar e reequilíbrio sobre a de
hoje); A, o cliente pagando a nota de hoje (a margem que sobra). Em 2026 o
B é o preço do motor; em todos os anos o B dá exatamente o lucro alvo
(teste). Simplificações ditas na tela: insumos ao preço de hoje com CBS/IBS
dentro (crédito = t ÷ (1 + t)); administração central igual.

Alíquotas de referência: premissas `preco.cbsReferencia` (8,8%),
`preco.ibsReferencia` (17,7%) e `preco.reducaoIbsCbsPct` (0, fretamento),
estimativas até o Senado fixar; na base, `cbs_referencia`, `ibs_referencia`
e `reducao_ibs_cbs`. O início do contrato é o da aba (gravado na versão, em
`entrada.reforma`), senão o início previsto do estudo, senão o mês seguinte.
O alerta da Decisão traz os números; o Orçamento mostra preço sem CBS/IBS,
CBS, IBS e valor da nota de 2027 em diante; o Excel ganhou a aba Reforma e
a cláusula de reequilíbrio sugerida.

Depois do fim do contrato, a aba, o Orçamento e o Excel seguem até 2033
com os anos que faltam da transição (`alemDoContrato`), como renovação nas
mesmas condições, 12 meses por ano, marcados "renovação" e mais claros no
gráfico. É a mesma conta de um contrato que cobrisse aquele ano (teste). Os
indicadores do topo (pior margem, reequilíbrio no último ano, carga média) e
a cláusula seguem só os anos do contrato.

## 7.4 Modelo de proposta (Word)

`docs/proposta-modelo/` tem o modelo de proposta técnica e comercial da Azul
Mob em Word (`Modelo_Proposta_Azul_Mob.docx`), gerado por `gerar.js` (lib
`docx`) com o papel timbrado da empresa e fotos do site azulmob.com.br
(`img/`). Os campos a preencher estão entre « » com marca-texto amarelo; a
tabela de preço ano a ano (2026–2033) é a da aba Reforma. Próximo passo
possível: o simulador gerar este documento já preenchido com o estudo.

## 7.5 Voltar à base (aba 3. Premissas)

Todo estudo novo já nasce da base vigente (Custos base + padrão do simulador
onde a base está vazia), e o que se ajusta num estudo fica só nele. Para
desfazer esses ajustes sem recriar o estudo:

- cada premissa diferente da base mostra **"voltar à base: <valor>"**, que
  traz o valor e a origem que um estudo novo usaria hoje;
- **"Voltar tudo à base"** volta todas as premissas ajustadas no estudo ou
  diferentes da base de hoje (versão salva quando a base era outra — a
  administração central recalculada, o diesel novo) e os tipos de veículo que
  a base também tem (salário do motorista, valor, consumo). O **custo real**
  aplicado de propósito fica.

O destino é `premissasNovasDoEstudo` (estudos.ts), a mesma função que monta o
estudo novo — com as regras do tipo de serviço (escolar: período e 12 meses;
eventual: prêmio do motorista) e os dados do estudo (vigência, prazo, tipos de
veículo). A volta entra pelo desfazer como qualquer edição e só grava ao
salvar a versão. Testes: `teste:itens` (VOLTAR À BASE) e
`teste:simulador-banco`.

## 7.6 Capital sobre o valor médio, locação sem motorista e elétrico

- **Remunerar só o valor não depreciado** passa a ser o padrão de todo estudo
  novo (`remuneracaoSobreValorMedio: true`): o capital rende sobre o valor
  médio do veículo nos anos do contrato (GEIPOT), não sobre o valor cheio —
  a depreciação devolve o capital ao longo do contrato.
- **Locação sem motorista** (tipo de serviço LOCACAO_SM) nasce com reserva
  técnica 0, km improdutivo 0, utilização 100%, capital sobre o valor médio e
  administração central reduzida: o parâmetro `adm_pct_locacao` da base
  (Custos base → Regras), padrão **4% do custo direto**, no lugar do rateio —
  locação não tem equipe, escala nem supervisão. Item sem km informado nasce
  com a franquia de **2.000 km/mês**.
- **Elétrico** não tem troca de óleo e filtros, ARLA, embreagem, correia nem
  escapamento, e o freio regenerativo poupa pastilhas: óleo e lavagem vira só
  lavagem (R$ 0,02/km) e a manutenção por km fica em 70% da do mesmo tipo a
  combustão. Vale ao trocar a energia na aba Veículos e para os modelos
  elétricos da base (a manutenção da base, quando informada, prevalece).
  Voltar para a combustão devolve óleo e manutenção. Pneus gastam **20% a
  mais** (peso e torque; troca a cada 40–50 mil km contra 60 mil).
- **Híbrido** (fonte de energia HIBRIDO; "híbrido", HEV, PHEV, plug-in, DM-i
  na frota da base): abastece com o combustível da categoria (carro a
  gasolina; van, micro e ônibus a diesel, com ARLA), rende mais por litro
  **sem recarga** (carro +45% — King DM-i 16,8 km/l só gasolina; pesados
  +20%) e a manutenção é **35% mais cara** (dois sistemas; revisão BYD de
  King/Song R$ 0,13–0,15/km contra R$ 0,07 de Onix Plus/HB20S). O plug-in
  recarregado todo dia gasta menos combustível: ajuste o consumo no tipo.
  Custo real do cartão de combustível não se aplica a elétrico nem híbrido.

Pesquisa de mercado (BYD Mais/Arval, MG, Geely Energeely,
calculadoracarroeletrico, FIPE, IPVA SP) em `ELETRICOS.md`.

Testes: `teste:energia`, `teste:itens`, `teste:simulador-banco`.

## 7.7 Ano do veículo e manutenção pela idade (curva ANTP)

Cada tipo de veículo do estudo tem o **ano do veículo** (aba Veículos; idade no
início do contrato = ano do início − ano do veículo) e a **idade para a qual a
manutenção foi informada**. A manutenção por km e a fixa são corrigidas pela
curva ANTP/NTU (2017) de peças e acessórios: 6% do preço novo por ano até 2
anos, 7%, 8%, 9%, 10% (8–10 anos) e 12% acima de 10. O fator é a média, nos
anos do contrato, do coeficiente da idade no meio de cada ano (o veículo
envelhece no contrato), sobre o da idade de referência. Padrões: carro, van e
micro informados para veículo novo (0 anos); ônibus usado de 8 anos. Modelo
da base com ano: idade pelo ano, e a manutenção da base vale para essa idade.
Versões salvas antes (sem a idade de referência): fator 1. O Excel reproduz
o fator em fórmula (aba Perfis). Teste: `teste:manutencao-idade`.
Pesquisa: `reports/Manutenção de frota por montadora.md` (repositório
gestao-motoristas).

## 7.8 Ajustes do relatório de manutenção

- **Óleo em uma linha só.** O preço fixo da revisão já inclui óleo e filtros;
  "Lavagem e consumíveis" passa a ser só isso (carro e van R$ 0,02/km, micro
  0,03). No ônibus a linha continua com os lubrificantes (0,09), como na ANTP.
  Se a base da Azul tiver `oleo_rs_km` com o óleo, revise o valor.
- **Consumos urbanos/pendulares** (o fretamento da Azul em SP): van 7,3 km/l
  (Master Minibus Inmetro, cidade; 7,8 na estrada), micro 4,0 (ANTP 3,4–4,2;
  4,7 só rodoviário), ônibus com ar 2,3 (ANTP 2,22–2,70 sem ar, COPPE
  1,98–2,22 com ar; 2,6 rodoviário). ARLA acompanha (~4% dos litros de
  diesel): van 0,036, micro 0,059, ônibus 0,088 R$/km.
- **ARLA da base** passa a ser calculado depois do veículo escolhido (usava o
  consumo padrão, não o do modelo).
- **Corretiva fora da garantia** (`variaveis.corretivaKm`, R$/km): só nos meses
  do contrato fora da garantia da montadora (`veiculo.garantiaMeses` e
  `garantiaKm`, o que vier primeiro; km inicial = idade × 12 × km/mês da
  rota), corrigida pela idade. Carro: 3 anos/100 mil km, manutenção 0,18 +
  corretiva 0,04 (0,22 fora da garantia). Van: 2 anos com km ilimitado
  (Sprinter), manutenção 0,34 (revisão 0,12 + desgaste) + corretiva 0,08
  (estimativa) = 0,42 depois da garantia. Micro e ônibus: sem garantia, a
  corretiva já está na manutenção.
- **Micro**: manutenção informada para veículo de 6 anos (curva ANTP).
- **Ônibus**: manutenção 1,15/km (8–10 anos, serviço severo urbano/pendular,
  ANTP); 0,95 continua valendo para rodoviário de estrada (ajuste no tipo).
- **Pneus por eixos**: no micro e no ônibus, trocar a categoria de 2 para 3
  eixos (aba Veículos) multiplica os pneus por km por 8/6.
- Ficaram para depois (precisam dos dados da Azul): fator de severidade por
  rota no lugar do par asfalto/terra, avaria por veículo·ano, índices de
  reajuste separados por insumo.

## 7.9 Elétricos e híbridos pelo relatório da ABVE

- **Híbrido em três tipos** (aba Veículos, sob a energia): pleno/Toyota (HEV),
  plug-in/BYD DM-i (PHEV) e leve (MHEV, 12–48 V); o tipo vem do texto do
  cadastro da base ("DM-i", "plug-in" → PHEV; "Bio-Hybrid", "48V" → MHEV).
  Rendimento sobre a combustão pela ROTA (o ganho é da frenagem e some na
  estrada): HEV 1,50 urbana / 1,30 mista / 1,07 rodoviária; PHEV sem recarga
  1,30 / 1,12 / 1,00; MHEV 1,10 / 1,06 / 1,00 (pesados menos). Manutenção:
  HEV e MHEV iguais à combustão, PHEV ×1,35. Depreciação: HEV ×0,8, PHEV
  ×1,3 (FIPE 2025–26).
- **Flex a etanol** no carro híbrido: preço do etanol e 70% do rendimento.
- **Plug-in com recarga**: % do km no elétrico (0,23 kWh/km); o consumo vira
  o km/l EQUIVALENTE do custo misto (litro + kWh), sem mudar o motor nem o
  Excel. Locação sem motorista: deixe 0% (o cliente decide se recarrega).
- **Elétrico**: preço do kWh = mix de recarga — garagem (tarifa da base;
  padrão R$ 0,89 = Enel SP tarifa branca fora de ponta com tributos), AC
  pública R$ 1,15, DC pública R$ 2,10; padrão 90% garagem + 10% DC ≈ R$ 1,01.
  Carregador por veículo (padrão R$ 7 mil, wallbox AC instalado) somado às
  adaptações. Depreciação ×1,4 a partir de R$ 200 mil (médio/premium).
  Ônibus elétrico 0,78 km/kWh (SPTrans 1,19–1,27 kWh/km).
- **IPVA SP** (linha da aba Veículos): média do contrato, ano a ano — 4%
  (ônibus e micro 2%), locadora 1%, híbrido flex até R$ 261 mil isento em
  2026 e 1–2–3% até 2029, elétrico na capital com devolução de metade até
  R$ 3.642/ano até 2030. Grava no campo "IPVA + licenciamento" (somar a taxa).
- Configurações guardadas no tipo (`hibrido`, `eletrico`) para desfazer ao
  trocar de energia ou de tipo; híbridos salvos na versão de um fator só são
  desfeitos com os fatores antigos.

## 7.10 Erros de fórmula da varredura de out/2026

Varredura do motor, do preço e do ciclo com o custo real, com as fórmulas
refeitas à mão. Corrigidos (com teste que falha na versão anterior):

- **Capital do veículo usado no PERCENTUAL.** O valor do PERCENTUAL é o de
  hoje (FIPE na idade atual), mas o valor médio descontava a depreciação de
  todos os anos desde o 0 km: o ônibus padrão (8 anos, R$ 280 mil, 12% a.a.)
  ficava com remuneração do capital ZERO, e o preço ~11% abaixo. Agora só os
  anos já corridos do contrato saem do valor. No LINEAR e na SOMA_DIGITOS o
  valor continua sendo o do 0 km (a idade conta desde a compra) — quem usa
  esses métodos com o valor FIPE de um usado precisa trocar pelo do 0 km.
- **Garantia por km com o km da rota inteira.** Com 3 veículos na rota, a
  garantia por km "acabava" 3× mais cedo. Agora é o km de cada veículo.
- **IRPJ da locação sem motorista sem o adicional.** 15% × 32% = 4,8%; com o
  adicional de 10%, como o transporte já tinha (16% × 25% = 4%), é 8%.
- **Administração da base convertida sem a contingência e com o ICMS.**
  Agora x = a·(1 + c)/(d − a), com o ISS no divisor (ver "Administração
  central sobre o custo direto").
- **Manutenção real contada duas vezes.** Ao aplicar o R$/km medido, o
  estudo continuava corrigindo pela idade a partir de 0 km e somando a
  corretiva. Agora a corretiva vai a zero e a idade de referência passa a ser
  a idade média da frota ativa (ano dos veículos da gestão).
- **Locação sem motorista nascia com o combustível da contratada.** O item
  nasce com o combustível por conta do cliente; a caixa da Operação desfaz.

## 7.11 Premissas de preço revistas (out/2026, decisão da diretoria)

A margem embutida no preço da van passava de 40% de EBITDA, contra 23–24% da
operação: lucro, capital, contingência e utilização se somavam. Mudou:

- **Lucro alvo 7% do preço e contingência 1%** (eram 12% e 3%). Padrão do
  simulador e base de custos (migração `premissas_varredura`: nova vigência,
  só baixa; a margem mínima vai a 3,5% quando passaria do alvo).
- **Taxa de capital real.** `contrato.inflacaoAa` (padrão 4,5%, base
  `inflacao_aa`): o capital rende (1 + taxa)/(1 + inflação) − 1, porque o
  reajuste anual por índice devolve a inflação. No capital composto, cada
  parte deflaciona. Zero para preço fixo sem reajuste. Versões salvas antes
  não têm o campo e seguem nominais.
- **Utilização abaixo de 100% só em registro de preços.** A `utilizacao_srp`
  da base vale nos estudos SRP; nos de km fixo o km contratado é pago inteiro.
- **Capital de giro pelo prazo líquido.** `preco.prazoPagamentoCustosDias`
  (padrão 25, base `prazo_pagamento_custos`): giro = taxa × (recebimento −
  pagamento) ÷ 30. A conversão da administração e o Excel usam o mesmo.

Efeito (10 vans, 3.500 km/mês cada, fretamento de km fixo): veículo-mês de
R$ 35.336 para R$ 31.180 (−11,8%); R$/km de 11,88 para 8,91 (o km pago passa a
ser o contratado inteiro). Ônibus: veículo-mês de R$ 50.804 para R$ 47.539.

## 7.12 Mão de obra, tributos e frota (itens E a L da varredura)

- **Escolar com 1,07 motorista por veículo** (`MOTORISTAS_POR_VEICULO_ESCOLAR`):
  as férias caem no recesso, sem operação; o fator só cobre faltas e
  afastamentos. Vale nas rotas novas e nos tipos de veículo do estudo escolar.
- **Vale-refeição por posto.** Os motoristas a mais do fator (1,2) cobrem
  ausências e o ausente não recebe VR: postos = motoristas ÷ fator do tipo,
  nunca menos que um por veículo e turno (dupla pegada 2,4 → 2 postos).
- **Adicional noturno pelo horário da rota** (`horasNoturnasDoHorario`): as
  horas entre 22h e 5h × veículos × dias de operação × valor da hora × o
  adicional com a hora reduzida. Nessa rota, as horas noturnas por motorista
  das premissas não somam de novo.
- **Reflexo da hora extra no DSR** (`pessoal.dsrSobreHoraExtraPct`, 1/6,
  Súmula 172 do TST), no percentual e nas horas extras em horas.
- **ICMS intermunicipal 9,6%**: 12% com o crédito outorgado de 20% do imposto
  em SP, até 31/12/2026 (padrão e base, por migração). Confirmar a prorrogação
  para 2027.
- **IPVA de micro e ônibus a 2%** do valor (SP) nos tipos padrão: micro
  R$ 8.550/ano, ônibus R$ 5.750/ano.
- **ISS**: o campo diz que é o do município do serviço (2% a 5%) — conferir no
  edital. **LC 224/2025** (Presumido acima de R$ 5 milhões): não aplicada,
  depende da confirmação do contador.

## 7.13 Custo real, calibração e aprendizados da planilha EMDEC (out/2026)

- **Piso de peças pela idade** (`veiculo.pisoPecasAntp`, padrão ligado): a
  manutenção do mês dos veículos operacionais não fica abaixo de valor ×
  coeficiente ANTP médio da idade no contrato ÷ 12 (6% a 12% a.a.); a
  diferença entra na manutenção fixa. Com pouco km (escolar) o R$/km sozinho
  cobria metade das peças. Fora no elétrico.
- **Revenda líquida de IR/CSLL** (`revendaLiquidaDeIr`): o veículo de 10+
  lugares está zerado no fisco em 4 anos (25% a.a.); a venda depois disso é
  toda ganho de capital, 34%. A depreciação da base usa revenda × 0,66 nesse
  caso (planilha EMDEC faz o mesmo). Padrão: 15,57% a.a. (era 15%).
- **Administração central real do DRE vira referência** (`referencia:
  administracaoBrutaPct`): era a soma bruta das linhas e, aplicada, apagava o
  rateio da aba 4 (que tira assessorias fiscais, parcelamentos, multas,
  empréstimos e o repasse à MCZ e soma o pró-labore). Uma fonte só.
- **Confiança do REAL na origem**: o painel de decisão trata o medido com
  confiança BAIXA como estimativa.
- **Calibração mês a mês**: cada mês contra o previsto no km daquele mês,
  desvio por razão de somas; sugestão só com 3 meses ou mais; outros custos
  diretos (frota de terceiros, custo do contrato) lançáveis e margem
  realizada × prevista.
- **Abastecimento sem veículo vinculado liga pela placa do extrato**: antes
  saía do km da frota sem rebaixar a confiança, inflando o R$/km.
- **Subgrupo do DRE manda no custo real**: categoria com subgrupo entra no
  indicador pelo subgrupo (guincho em "Sinistros e socorro" não é
  manutenção; "Serviços diversos" em "Manutenção e peças" é); sem subgrupo,
  pelo nome. ARLA fica fora do óleo por km (vem do cartão).
- **Rentabilidade por contrato só com custo de operação**: saem do custo os
  títulos de investimento e financiamento, distribuição e retirada de sócios,
  IR/CSLL e deduções, e as operações entre as empresas (custo e receita) na
  visão do grupo. O valor que saiu aparece na tela.

## 7.14 Correções da auditoria independente (out/2026)

Três auditorias: conta refeita à mão em 6 casos (o motor bateu centavo por
centavo), processo de ponta a ponta e validação contra o DRE real. Corrigido:

- **O custo real chega aos tipos de veículo.** Manutenção, pneus e óleo
  medidos mudavam só o veículo padrão; as rotas usam os tipos e o preço não
  mudava. Agora o indicador traz o fator da frota (real ÷ o que os tipos
  padrão dariam no mix de km da frota) e aplicar multiplica cada tipo por ele.
  Na manutenção, a corretiva vai a zero, a idade de referência vira a da
  frota e o piso de peças desliga (vale o medido).
- **Revenda líquida de IR também nos tipos vindos da base** (antes só no
  veículo padrão).
- **Fator de jornada noturna não soma ao noturno do horário**; o adicional
  noturno habitual reflete no DSR (Súmula 60 do TST).
- **Teto de 26 dias do VR por pessoa**, não por posto: VR = mín(postos ×
  dias; motoristas × 26).
- **Piso de peças sobre a frota com a reserva** (o veículo parado envelhece).
- **Franquia da locação por carro** (N carros × 2.000 km).
- **IPVA da van a 2%** (micro-ônibus no CTB): R$ 5.850/ano.
- **Painel de decisão com o alvo do próprio estudo**; a mínima da base segue
  como piso da empresa.
- **Versão do motor 2026.10-v4.**

Pontos que dependem de decisão (ver o relatório da auditoria): seguro de
casco nos tipos padrão (a Azul tem só APP), oficina própria na administração
e mão de obra na manutenção por km (contagem dupla), administração padrão sem
base (7% do custo direto contra ~13% do DRE), monitora no escolar, licenças
nos encargos com o fator de motoristas, hora extra no recesso do escolar.

## 7.15 Importar edital e Habilitação (out/2026)

**Importar edital** (Novo estudo): a pessoa escolhe os arquivos do processo —
edital, TR, anexos; PDF, Word (.docx), Excel (.xlsx), texto, imagem — e a
leitura preenche o formulário para ela conferir antes de criar.

- **Envio**: a hospedagem recusa requisição acima de ~4,5 MB, então cada
  arquivo sobe sozinho para a Files API da Anthropic (ação do servidor), e o
  PDF maior que 3,5 MB é dividido **no navegador** por intervalo de páginas
  (pdf-lib). Word e Excel viram texto no servidor (a API lê PDF, imagem e
  texto). O identificador de cada arquivo volta **assinado** (HMAC com a
  empresa): só quem enviou pede a leitura. Os arquivos são apagados ao fim
  da leitura, com ou sem erro.
- **Leitura**: Claude (`claude-opus-5-5`, esforço médio) com saída
  estruturada no `EditalSchema` (`editalParaEstudo.ts`). Ela TRANSCREVE —
  não precifica nem estima km; o que deduz vai em suposições. Sem a chave
  `ANTHROPIC_API_KEY` a tela diz que a leitura está indisponível. Leva de 1 a
  4 minutos (`maxDuration = 300`).
- **Conversão** (`editalParaEstudo`, testada em `teste:edital`):
  - km da rota = km/dia × (1 + km improdutivo **pago** pelo edital) × dias —
    no escolar, os dias de operação do ano que o edital usa na conta do km
    (20 × 11 = 220 na TCB); sem isso, 200 (LDB), registrado como suposição;
  - **frota compartilhada**: quando o edital fixa a frota (TCB: 52 ônibus)
    e as rotas somam mais (107 itinerários em manhã, tarde e noite), cada rota
    fica com a sua fração da frota — o custo do veículo segue a frota, o km
    segue as rotas; motoristas = frota × 1,07;
  - km/dia das rotas conferido contra o km/mês do edital (alerta acima de 2%);
  - preço máximo só vai ao campo de R$/km quando o edital paga por km; nas
    outras unidades vira regra;
  - números no padrão do formulário (vírgula decimal): com ponto, "5.172"
    seria lido como 5.172 reais (milhar) — o teste passa o número da
    conversão pelo mesmo leitor do servidor (`formularioDoEstudo.ts`).
- **Regras do edital**: exigências que pesam no custo e as suposições da
  leitura ficam no estudo (cartão "Regras do edital"), para conferir antes de
  lançar preço. As premissas do edital (reserva, km improdutivo, encargos
  fixos, piso da CCT) ainda **não** são aplicadas sozinhas: a regra diz o que
  ajustar na aba Premissas.

**Habilitação** (aba do estudo público): os documentos que o edital pede,
um por linha, por grupo — jurídica; fiscal, social e trabalhista;
econômico-financeira (contábil); técnica (atestados, registros, visita);
declarações; o que vai com a proposta. Cada um com a exigência que decide se
a empresa atende (índices, PL mínimo, quantitativo do atestado, se o SICAF
substitui), a fonte, a situação (pendente, providenciando, pronto, não se
aplica), a validade da certidão — vencida ou vencendo antes da sessão fica
em vermelho — e uma observação. Dá para acrescentar à mão e copiar a lista em
texto (para o contador ou o jurídico). Tabela `SimDocumentoHabilitacao`.

## 7.16 Correções da auditoria dos editais (out/2026)

Auditoria independente dos 4 editais de teste (TCB, Santos, CPB, SENAR): a
conta do motor conferiu componente a componente (recalculada à parte em
Python); o que mudou foram regras de modelagem.

- **Piso de peças por item e tipo de veículo**, não por rota: com a frota
  repartida entre rotas de manhã e de tarde, o piso rota a rota cobrava a
  diferença da rota curta sem descontar a sobra da longa (+R$ 0,29/km na
  TCB). O complemento é Σ piso − Σ manutenção do grupo, repartido pelo piso
  de cada rota; no Excel, colunas "grupo", "pisoR" e "baseR" com SUMIFS.
- **Diária e hora pagas acompanham a utilização** (no registro de preços o
  órgão paga as diárias que pedir), no preço e nos cenários — antes a receita
  ficava fixa e a margem subia com a demanda caindo.
- **Teto do edital na unidade do contrato** (veículo-mês, diária, hora; por
  km na binômia): a locação acima do teto do SUV passava sem aviso.
- **Monitor com o fator de cobertura do motorista** (1,07 no escolar): férias
  e faltas do monitor também precisam de cobertura (a TCB fixa 55 monitores
  para 52 ônibus).
- **Prêmio do motorista no eventual** descontando o tributo da abrangência
  dos itens (ISS no municipal), não o maior entre ISS e ICMS.
- Abrangência mista no edital importado vira aviso para ajustar o %
  intermunicipal de cada item.

**Excel**: aba **Habilitação** (quando o estudo tem documentos), por grupo,
com situação em lista, validade em vermelho se vencida ou vencendo antes da
sessão (formatação condicional) e a fonte de cada documento.

## 7.17 Histórico de editais (out/2026)

- **Arquivos do estudo** (`SimArquivo`): o edital e os anexos enviados na
  importação ficam guardados no banco (como na Conformidade), presos ao
  estudo no "Criar"; o que não virou estudo some em dois dias. Depois dá para
  acrescentar ata, contrato, proposta enviada. PDF grande vai em partes (o
  limite de envio da hospedagem); download só pela rota
  `/api/simulador/[estudoId]/arquivo/[arquivoId]`, sempre como anexo.
  Limite de 80 MB por estudo.
- **Disputa** (`SimParticipante`, aba 9. Versões e resultado): a ata da
  sessão empresa a empresa — posição, preço na unidade do contrato, valor
  total, situação, a linha da Azul. A vencedora e a nossa posição vão ao
  resultado do estudo.
- **Histórico de editais** (`/simulador/editais`): os estudos com o
  resultado, filtros (busca por órgão/edital/município/concorrente, serviço,
  situação, ano da sessão, público/privado) e as contas de
  `historicoDeEditais.ts`: taxa de vitória (ganhos ÷ decididos, com os que
  viraram contrato), nosso preço ÷ vencedor nas perdidas, desconto do
  vencedor sobre o teto, por serviço, e concorrentes (disputas, vitórias e o
  preço deles ÷ o nosso no mesmo edital — razão sem unidade, comparável entre
  km, veículo-mês e diária; o mesmo nome escrito de jeitos diferentes conta
  como uma empresa).

## 7.18 Premissas que o edital fixa (out/2026)

A leitura do edital transcreve também os números que a proposta TEM de usar
(`EditalSchema.premissas`), e o estudo novo abre com eles, com a origem "do
edital" (`premissasDoEdital.ts`, aplicadas por último em
`premissasNovasDoEstudo` — o "Voltar à base" do estudo volta a elas):

- **Reserva técnica** (TCB: 3 ônibus para 52 = 5,77%): substitui a da base.
- **Km improdutivo já pago** (TCB: 5%): a premissa de km improdutivo passa
  a ser só o que roda sem receber, (1 + base) ÷ (1 + pago) − 1 — 12% vira
  6,67%. Antes os 5% eram contados duas vezes.
- **Encargos sociais fixados pelo órgão** (TCB: 70,64%): substituem os da
  base (o preço tem de bater com a planilha que vai na proposta).
- **Piso do motorista e do monitor e vale-refeição da CCT**: são mínimos —
  só sobem o que a base tem abaixo.
- **Veículo zero km** ou **idade máxima de entrada**: a idade inicial dos
  perfis desce até ela.
- **Consumo de referência** fixado (km/L de diesel), nos perfis a combustão.

Com isso a TCB (base de exemplo) foi de R$ 24,38 para R$ 23,48/km.
Ainda fora: os meses sem operação pagos à parte (a TCB paga janeiro como
parcela fixa, sem km) — hoje o R$/km cobre os 12 meses de custo fixo.

## 7.19 Planilha de custos do edital preenchida (out/2026)

Quando o edital traz o modelo da planilha de custos em Excel (a TCB manda o
dela, com as fórmulas do órgão e as células amarelas), o arquivo fica no
estudo e o botão **Preencher com o estudo** gera a proposta
(`planilhaDoEdital.ts`):

1. **Inventário** (sem IA): as células de entrada são as que as fórmulas do
   órgão leem e não são fórmula, mais as amarelas; cada uma com o rótulo da
   linha (texto formatado incluído) e a unidade à direita.
2. **Mapa** (IA, saída estruturada `MapaSchema`): para cada célula da
   licitante, a chave do catálogo do estudo (diesel, salários, encargos,
   VR, seguro, IPVA, valor do veículo, frota, km, tributos, preço) e o
   multiplicador da unidade (R$/dia × 22 = R$/mês). O que o estudo não tem
   (pneu por unidade, lubrificante por litro, aluguel, salário do
   administrativo) fica **pendente**, nunca inventado.
3. **Preenchimento** (sem IA): só células do inventário que não são fórmula
   e só chaves do catálogo; as fórmulas do órgão ficam intactas. A aba
   **Conferência (simulador)** lista o que entrou e de onde, as pendentes e
   o preço da planilha do órgão (fórmula) ao lado do preço do simulador.

Usa a última versão salva (ou o estudo como abre). O arquivo gerado fica no
estudo como "Proposta enviada". Na TCB, com as pendentes preenchidas com
valores de referência, a planilha do órgão dá R$ 16,98/km + R$ 1,22 milhão
por mês sem operação (janeiro, pago à parte); o simulador dá R$ 23,48/km com
os 12 meses no km e 12% de margem — a comparação lado a lado é o propósito
da aba de conferência. Modelo só em PDF ou Word não é preenchido (use o
Excel do próprio simulador).

## 7.20 Modelos da leitura: padrão, forte e automático (out/2026)

- Leitura do edital no **Sonnet 5.5** (metade do preço do Opus 5.5); o
  resultado passa pela conferência `problemasDaLeitura` (sem item, item sem
  km nem rotas, mais de 30% das rotas sem km, licitação sem habilitação) e,
  se ela acusar — ou a leitura for recusada, cortada ou fora do formato —,
  é refeita no **Opus 5.5** quando sobram ao menos 130 s dos 300 s da
  função. Processo com 10 ou mais arquivos/partes já vai direto ao Opus.
  Sem tempo para a segunda, fica a primeira, com os problemas nas
  suposições. Conta sem crédito e chave recusada não tentam de novo.
- Planilha do órgão mapeada pelo **Haiku 5.5**, com o Sonnet de reserva.
- A tela diz quem leu e por que refez. Os três modelos trocam por variável
  de ambiente: `ANTHROPIC_MODELO_EDITAL`, `ANTHROPIC_MODELO_EDITAL_FORTE`,
  `ANTHROPIC_MODELO_PLANILHA`.

## 8. O que ainda não existe

- Seletor de método para o custo variável (medido, GEIPOT, ANTP) com
  validação cruzada.
- Custo financeiro das retenções na fonte (7,05% federais, INSS, ISS) como
  capital de giro.
- CBS/IBS por fora do preço a partir de 2027, por ano de contrato.
- Fórmula paramétrica de reajuste gerada da própria composição.
- Realizado do contrato preenchido automaticamente pela controladoria (hoje
  é lançado na tela).
- Premissas do edital aplicadas sozinhas ao estudo importado (reserva
  técnica, km improdutivo, encargos fixados pelo órgão, piso da CCT).
- Edital ganho ligado ao contrato da Omie (o campo existe), para o
  realizado entrar sozinho.
- Biblioteca de certidões da empresa (com validade) para a aba Habilitação
  marcar sozinha o que já está pronto.
- As calculadoras de encargos e de jornada ainda não vão para o Excel; o
  Excel recebe o resultado delas (o percentual e os motoristas por veículo).
