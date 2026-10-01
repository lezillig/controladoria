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
  4,8% e CSLL 2,88% da receita (`preco.irpjLocacao`, `preco.csllLocacao`).
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
  converte `x = a/(d − a)`, com `d` o divisor do preço.
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

**Sócios na administração central.** A linha "Despesas com sócios" (pró-labore)
entra como custo de estrutura (`socios`), na parte do campo
`socios_pct_adm` da base (padrão 100%; 0% tira tudo). A folha da oficina
continua na administração.

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

## 8. O que ainda não existe

- Seletor de método para o custo variável (medido, GEIPOT, ANTP) com
  validação cruzada.
- Custo financeiro das retenções na fonte (7,05% federais, INSS, ISS) como
  capital de giro.
- CBS/IBS por fora do preço a partir de 2027, por ano de contrato.
- Fórmula paramétrica de reajuste gerada da própria composição.
- Realizado do contrato preenchido automaticamente pela controladoria (hoje
  é lançado na tela).
- As calculadoras de encargos e de jornada ainda não vão para o Excel; o
  Excel recebe o resultado delas (o percentual e os motoristas por veículo).
