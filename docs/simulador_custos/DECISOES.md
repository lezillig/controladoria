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
  passageiros presume 16%: 2,4% da receita. O painel mostra o alerta "IRPJ na
  base presumida de cargas" quando o estudo usa a alíquota antiga; o padrão
  de estudos novos e o preset Presumido já usam 2,4%.
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

- **Regimes tributários.** Três presets: Presumido (IRPJ 2,4%, CSLL 1,08%,
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

## 7. Especialista de IA em precificação

Registrado entre os especialistas da tela Investigar, com as mesmas
garantias dos outros: só leitura, escopo pela sessão, toda consulta
registrada e mostrada. Ferramentas: listar e ler estudos (a conta, a origem
das premissas e o painel), simular variações numa cópia (o preço novo para a
margem alvo e o resultado ao preço já lançado; ajuste proporcional que
alcança os tipos de veículo), custos reais, histórico de disputas e base de
custos. A aba Decisão leva ao especialista com perguntas prontas sobre o
estudo aberto. Ele lê só versões salvas.

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
