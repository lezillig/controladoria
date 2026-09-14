# Sistema de Controladoria — como funciona

Sistema independente, ligado à API da Omie, que espelha o ERP em D-1, roda uma
bateria de agentes de auditoria sobre os dados, mede um Balanced Scorecard e
envia um relatório gerencial e executivo por e-mail todos os dias.

---

## 1. Em uma passada

```
Omie (Azul) ──┐
              ├─sync D-1 por empresa──▶ espelho ──▶ 11 agentes ──▶ supervisor ──▶ achados
Omie (MCZ) ───┘                            │                                        │
                                            ├──▶ analytics (DRE, caixa, comparativos)│
gestão de motoristas ──leitura──────────────┤                                        │
(frota, ponto, contratos)                   ├──▶ BSC (4 perspectivas, metas, faróis) │
relatórios de consultoria ──upload──────────┤                                        │
(risco fiscal, trabalhista, ...)            ├──▶ conformidade (apontamentos × achados)│
                                            └──▶ unit economics (custo/contrato)     │
                                                                │                     │
                                                                └──▶ analista (IA) ──▶ relatório diário
```

---

## 2. Duas empresas, um sistema

O grupo opera com mais de um CNPJ, cada um com sua conta na Omie. Isso **não é
detalhe de configuração**: cada conta tem numeração de lançamento própria, e o
título nº 12345 existe nas duas sendo documentos diferentes.

Por isso:

- **toda tabela espelhada carrega a conexão de origem**, e toda chave natural a
  inclui. Sem isso, um título sobrescreveria o outro em silêncio — e num sistema
  de auditoria o número errado é pior que número nenhum, porque parece plausível;
- **a sincronização roda por empresa**, com credencial, cursor e limite de
  consumo próprios: uma falha na Azul não para o espelho da MCZ;
- **a auditoria roda sobre o grupo**, depois que todas terminaram. É aí que
  aparece o que nenhuma das duas veria sozinha: a mesma nota paga pelas duas, o
  caixa total, a concentração real de um fornecedor;
- **fornecedores são reconhecidos entre empresas pelo CNPJ**, não pelo código da
  Omie — que é diferente em cada conta.

As credenciais ficam só em variável de ambiente. O cadastro da conexão guarda
apenas o **nome** das variáveis (`credencialRef` `AZUL` → `OMIE_APP_KEY_AZUL`).
Guardar chave e segredo no banco significaria que um vazamento de backup
entregaria acesso ao ERP financeiro do grupo.

---

## 3. Estrutura de agentes

A escolha por **três camadas** é o que dá confiança ao resultado:

### Camada 1 — Quinze agentes de domínio

Determinísticos e puros: recebem o mesmo retrato dos dados, não consultam banco
nem API, não escrevem nada. São quinze porque cada um responde a uma pergunta
com **dono diferente na empresa** — o que torna o achado endereçável a alguém.

| Agente | Área | O que procura |
|---|---|---|
| `contas-pagar` | Financeiro | Juros e multa por atraso, duplicidade, pagamento acima do documento, títulos vencidos e "fantasma", antecipação sem desconto, falta de classificação |
| `contas-receber` | Financeiro | Inadimplência por cliente, aging, descontos concedidos, recebimento a menor, concentração de receita, atraso recorrente, atraso recebido sem juros |
| `conciliacao-bancaria` | Financeiro | Movimentos não conciliados, saída sem título, **entrada sem título**, baixa sem dinheiro no extrato, débito duplicado, saldo abaixo do mínimo |
| `antifraude` | Controladoria | Troca de conta bancária de fornecedor, fracionamento de alçada, fornecedor que é funcionário, documento inválido, cadastro duplicado, pagamento em dia não útil, Lei de Benford; por onde o dinheiro saiu (conta escondida, baixa desviada, sem conta, em título cancelado, antes da emissão, no futuro, repetida); o fornecedor como entidade (conta bancária dividida, nota repetida, cadastrado e pago na mesma semana, valor sempre redondo, numeração de nota exclusiva) |
| `frota` | Operações | Antifraude do combustível, transação a transação no extrato do cartão: abastecimento maior que o tanque ou dois tanques em 12 h, consumo que despenca ou hodômetro que anda para trás, abastecimento em dia sem escala nem uso do veículo, placa fora da frota ou veículo inativo, produto que o motor não usa, posto acima da frota e da ANP, motorista abastecendo vários veículos no dia |
| `custos` | Controladoria | Variação por categoria, despesa nova, gasto recorrente, valor fora do padrão, divergência combustível Omie × cartão de frota |
| `padroes` | Controladoria | Cada fornecedor contra o histórico DELE (24 meses): valor fora do padrão, fornecedor efêmero, fornecedor dormente que voltou, reajuste silencioso, prazo antecipado |
| `fiscal` | Contabilidade | Nota cancelada com título ativo, receita sem nota, nota sem título, carga tributária fora da faixa do Lucro Presumido, falha de sequência; **CT-e espelhado × título** — CT-e cancelado com título vivo, CT-e autorizado sem título, valor do título diferente do documento |
| `fluxo-caixa` | Tesouraria | Projeção 7/15/30/60/90 dias, descasamento da semana, ciclo financeiro (PMR/PMP) |
| `rentabilidade` | Controladoria | Margem por contrato, contrato no prejuízo, veículo fora do padrão, cobertura do rateio |
| `oportunidades` | Controladoria | **Onde reduzir custo** (seção 5), juros evitáveis anualizados, tarifas, consolidação de fornecedores, política de alçadas sugerida |
| `administrativo` | Administrativo | Sync atrasado ou com erro, cadastro incompleto, conta sem extrato, título emitido depois de vencer, achados críticos sem tratativa |
| `conformidade` | Controladoria | Prazo estourado, risco grave sem responsável, apontamento externo reincidente, apontamento confirmado pelos dados, proposta de leitura não conferida, relatório mensal não recebido, ponto cego do sistema |
| `pessoal` | RH | O que se paga a CPF de gente da folha cruzado com o rastro operacional da gestão (ponto, escala, uso de veículo, cartão de frota, afastamento): pagamento a quem já saiu, pagamento a quem nunca aparece na operação, diária fora do padrão do departamento ou sem dia trabalhado, reembolso repetido, adiantamento sem acerto, ponto batido em dia de atestado ou férias |
| `contratos` | Comercial | O que **deveria** ter sido faturado, pelo contrato de serviço da Omie: título em contrato suspenso/cancelado ou depois da vigência, contrato ativo sem título no mês, faturado abaixo de 90% do valor mensal, valor ou situação alterados em silêncio (com o usuário que alterou), vigência terminando em 60 dias |

Um agente que quebra **não derruba os outros catorze**.

**Frota e combustível — o que cada regra precisa e quando fica calada.** O
agente lê o extrato do cartão (`FuelTransaction` da gestão) e cruza com escala
(`Escala`), uso real (`VehicleUsageLog`), cadastro da frota e preço ANP
(`AnpPrecoReferencia`) — três tabelas a mais no papel de leitura
(`docs/papel-leitura-gestao.sql`). Toda regra é agregada por veículo e mês (um
achado, a lista na evidência), e toda regra tem uma condição de silêncio:

| Regra | Aponta | Fica calada quando |
|---|---|---|
| `FR-COMBUSTIVEL-VOLUME` | Abastecimento acima de 1,5× o percentil 90 do veículo (ou do modelo), ou dois em 12 h que somados passam disso — com 20 L de folga | Veículo com menos de 8 abastecimentos e modelo com menos de 15 |
| `FR-COMBUSTIVEL-CONSUMO` | Intervalo entre abastecimentos com km/L abaixo da metade do típico do veículo, ou hodômetro que anda para trás | Menos de 6 intervalos com hodômetro |
| `FR-COMBUSTIVEL-SEM-OPERACAO` | Abastecimento em dia sem escala nem check-in do veículo | A operação registra escala/uso para menos de 70% dos abastecimentos do mês |
| `FR-COMBUSTIVEL-FORA-DA-FROTA` | Placa que não casa com veículo cadastrado (ESTADO: some ao cadastrar); veículo INATIVO abastecendo nos últimos 30 dias | Menos de 80% do extrato vinculado a veículo (cadastro incompleto) |
| `FR-COMBUSTIVEL-PRODUTO` | Gasolina/etanol num veículo que abastece diesel em 80% de ≥ 6 registros (e vice-versa; Arla é à parte) | Sem produto dominante |
| `FR-COMBUSTIVEL-PRECO` | Posto com mediana ≥ 8% acima da frota (mesmo produto, mesmo mês, outros postos) e acima da ANP + 10% quando há referência | Menos de 10 abastecimentos em 3 postos no mês, ou posto com menos de 3 |
| `FR-COMBUSTIVEL-MOTORISTA` | Pessoa que abastece 3+ veículos no mesmo dia (INFO quando é rotina de pátio) | — |

A severidade sobe pela **recorrência** no mês (3+ casos = MÉDIA), não só pelo
valor: um abastecimento sozinho nunca chega à materialidade da empresa.

**Desvio de dinheiro — as regras que vieram do estudo de fraude.** Benchmark
das regras contra ACFE (Fraud Tree, Report to the Nations), ISA 240, COSO e os
testes clássicos de cadastro de fornecedores; cada uma com o caso que aponta e
o caso legítimo que preserva (`scripts/teste-desvios.ts`):

| Regra | Aponta | Deixa em paz |
|---|---|---|
| `FR-CONTA-COMPARTILHADA` | Dois cadastros com documentos de raízes diferentes e o mesmo hash de banco/agência/conta (dentro e entre as empresas); CRÍTICA quando um deles é CPF da folha | Matriz e filial, o mesmo CNPJ nas duas contas Omie, factoring/FIDC/cooperativa |
| `FR-NF-REPETIDA` | O mesmo número de nota do mesmo fornecedor pago mais de uma vez com valor ou vencimento diferentes — inclusive Azul e MCZ | Parcelas de carnê, duplicidade exata (é de `CP-DUPLICIDADE`), quem numera por contrato (banco, DETRAN, telefonia…), "número" que se repete todo mês |
| `FR-CADASTRO-E-PAGO` | Fornecedor criado na Omie (`info.dInc`) e pago em até 3 dias, valor ≥ metade da materialidade; PF, sem nota, sem e-mail/cidade e categoria de serviço agravam | Sem data real de cadastro (a carga histórica cria cadastro e título juntos), motorista da folha |
| `FR-VALOR-REDONDO` | Fornecedor PJ com 6+ títulos, 70%+ múltiplos de R$ 100 (e 3× a taxa da base), metade ou mais sem nota | Aluguel, folha, diária, consórcio, honorário fixo, mesmo valor todo mês |
| `FR-NOTA-SEQUENCIAL` | 4+ notas numeradas quase sem intervalo ao longo de 60+ dias: somos praticamente o único cliente | Quem numera por contrato, PF, sequência curta demais no tempo |
| `CB-ENTRADA-SEM-TITULO` | Crédito no extrato sem título a receber nem baixa casável — receita que o sistema não conhece | Transferência entre contas do grupo (par débito/crédito em ±1 dia), resgate, rendimento, estorno, tarifa |
| `CR-JUROS-NAO-COBRADOS` | Cliente que pagou 30+ dias depois do vencimento com juros e multa zerados; um achado por cliente e trimestre; impacto = custo do atraso a 1% a.m.; cita a Lei 14.133 (art. 92 V) para tomador público | Atraso com encargo cobrado, juros abaixo de ¼ da materialidade |
| `HI-FORNECEDOR-DORMENTE` | Relação antiga (3+ meses ativos), 12+ meses sem título, volta no mês corrente ou anterior com valor ≥ materialidade | Quem acordou há mais de um mês, quem nunca teve relação |
| `FR-EDITADO-APOS-BAIXA` | Título a pagar liquidado e alterado na Omie mais de 2 dias depois da baixa, com o usuário que alterou (bloco `info`, pedido com `lDadosCad`) | Alteração no dia da baixa, título sem usuário de alteração (a conta não devolve o bloco) |
| `FR-LANCAMENTO-MANUAL` | Títulos a pagar de origem manual (`cOrigem` MANP) sem número de nota, por usuário e mês, somando ≥ materialidade | Título nascido de nota (NFEP) ou de extrato, manual com número de nota |
| `FR-BENFORD` (Nigrini) | Por empresa e grupo de categoria, sem valores fixos recorrentes: MAD > 0,015 (1º dígito, n ≥ 500) ou > 0,0022 (dois dígitos, n ≥ 300) **e** qui-quadrado acima do crítico a 1%; evidência lista os fornecedores nos dígitos em excesso | Amostra pequena, categoria conforme — o teste anterior (8 p.p. num dígito, n ≥ 150) dava falso alarme perto de 1 em 4 |
| `FR-KICKBACK-CATEGORIA` | Fornecedor que passa de ≤ 40% para ≥ 75% de uma categoria+departamento entre o primeiro e o último trimestre da janela, com o custo subindo ≥ 25% e a receita crescendo menos da metade disso | Menos de 3 fornecedores, receita que acompanha, menos de 6 meses |
| `FR-CONTA-ALTERADA-REPETIDA` | 2+ trocas de conta bancária em 12 meses, ou volta a uma conta anterior (trocar, receber, voltar) — do histórico append-only do sync; nunca fecha sozinha | Uma troca só (é `FR-CONTA-ALTERADA`) |
| `FR-EDITADO-APOS-BAIXA` (com versões) | Além do bloco `info`, dispara quando o sync gravou uma versão do título depois da baixa, e diz o que mudou (fornecedor, valor, categoria, conta, vencimento, documento) | — |
| `CR-RETENCAO-INDEVIDA` | Tomador privado retendo PCC (Lei 10.833 art. 30 não lista transporte de passageiros); estado/município retendo PCC (IN RFB 2145: só IRRF); órgão federal acima de 7,05% (IN 1234, cód. 6175). Por cliente e trimestre, OPORTUNIDADE (recuperável) | Retenção coerente com o tipo de tomador, abaixo de ¼ da materialidade |
| `CR-LAPPING` | Baixa cujo valor não é o do título baixado mas é exatamente o de outro título em aberto do mesmo cliente | Baixa no valor do próprio título |
| `CB-TRANSFERENCIA-INTERGRUPO` | Débito numa empresa e crédito de mesmo valor na outra em ±1 dia, sem título dos dois lados (INFO, um por mês) | — |
| `HI-REAJUSTE-VENCIDO` | Cliente com 13+ meses de faturamento estável (MAD/mediana < 15%) sem nenhum aumento; impacto = 12 meses × 4% (estimativa declarada) | Valor que varia com o volume (por km), aumento já ocorrido |

**Pessoal — o que se paga a quem é da folha, contra o rastro da operação.** O
agente `pessoal` (`src/lib/controladoria/agents/pessoal.ts`) parte dos títulos
a pagar cujo documento é o CPF de um motorista (o mesmo cruzamento de
`FR-FORNECEDOR-FUNCIONARIO`) e pergunta o que a Omie sozinha não responde: a
pessoa estava trabalhando? O rastro vem da gestão — ponto (`TimeClockEntry`),
afastamento (`DriverLeave`), escala, uso de veículo e cartão de frota; ponto e
afastamento são duas tabelas a mais no papel de leitura
(`docs/papel-leitura-gestao.sql`), lidas como opcionais: até a permissão ser
concedida, a tela de sincronização lista o que falta e as regras ficam caladas.
O TiqueTaque importa o ponto com atraso, então todo título precisa de idade
antes de contar (7 dias; 45 para o desligado). Evidência sempre com o CPF
mascarado.

| Regra | Aponta | Fica calada quando |
|---|---|---|
| `PE-PAGO-A-DESLIGADO` | Motorista INATIVO com título emitido mais de 45 dias depois do último rastro operacional (ponto, uso, escala — o mais recente), fora das categorias de desligamento (rescisão, acordo, judicial, indenização, FGTS, homologação, aviso prévio, férias vencidas); um achado por pessoa, severidade agravada pelo valor | Nenhuma fonte de rastro carregada; a pessoa não tem rastro nenhum na janela (não se sabe quando saiu); título com menos de 45 dias |
| `PE-FANTASMA` | Motorista ATIVO com função de operação (nula ou motorista/cobrador/ajudante/monitor/auxiliar), com título nos últimos 60 dias e nenhum ponto, escala, uso de veículo nem abastecimento no período, sem afastamento cobrindo 30+ desses dias; ALTA fixa | Tabela de afastamentos ausente ou vazia; menos de 50% dos ativos de operação com rastro no período (a base não registra a operação); título com menos de 7 dias; admissão há menos de 30 dias; rescisão (é desligamento não registrado, do antifraude) |
| `PE-DIARIA-OUTLIER` | Diária/ajuda de custo/reembolso/pedágio/alimentação por dia trabalhado (dias com ponto; sem ponto, dias com uso de veículo) acima de mediana + 5·MAD do departamento no mês, com excesso ≥ ¼ da materialidade → ERRO_PROCESSO MÉDIA; diária com zero dia trabalhado → FRAUDE MÉDIA; um achado por pessoa e mês | Sem ponto nem uso carregados; mês ainda aberto (fecha 7 dias depois do fim); metade de quem recebeu diária sem dia registrado (o ponto do mês não veio); departamento com menos de 5 pessoas (só o caso de zero dias roda) |
| `PE-REEMBOLSO-DUPLICADO` | O mesmo número de documento em dois reembolsos (mesma pessoa, ou pessoas diferentes com o mesmo valor); ou a mesma pessoa, o mesmo valor e a mesma categoria em até 7 dias; EVENTO | Número que a pessoa repete 4+ vezes (rótulo, não cupom); parcelas do mesmo documento; 4+ títulos iguais com metade dos intervalos em 7 dias (diária fixa, é o ritmo da pessoa) |
| `PE-ADIANTAMENTO-ABERTO` | Adiantamento/vale pago a CPF há 60+ dias sem título de acerto/devolução/desconto em folha, sem título a receber do CPF e sem rescisão nos 60 dias seguintes; agregado por pessoa, RISCO_FINANCEIRO | Vale-alimentação/transporte (benefício); adiantamento ainda não pago; 10+ adiantamentos vencidos e nenhum com acerto na Omie (o acerto é feito na folha, fora dela — apontaria todo mundo) |
| `PE-AFASTADO-COM-OPERACAO` | Atestado, férias, licença ou afastamento com ponto, uso de veículo ou abastecimento da pessoa em dia coberto; INFO, um achado por afastamento | Sem afastamentos carregados; sem ponto, uso nem abastecimento carregados; folga e abono (trocar folga de dia é rotina); escala não conta (é plano, não presença) |

**O que a Omie passou a entregar ao espelho** (migração `20260914160000`): no
título, `usuarioInclusao`/`usuarioAlteracao`/`dataInclusaoOmie` (bloco `info`,
com `lDadosCad: true` — se a conta recusar a tag, o sync refaz o pedido sem ela
e segue), `chaveNfe` (chave da NF-e/CT-e de origem), `origemLancamento`
(`cOrigem`), `contratoCodigo`, `ordemServicoCodigo`; na baixa,
`lancamentoCCCodigo` (`nIdLancCC`), a ligação exata com a linha do extrato. O
extrato bancário lê o array oficial `listaMovimentos` (as grafias anteriores
eram chute — a resposta chegava cheia e ninguém a lia), ignora as linhas de
SALDO e as PREVISTAS, e traz `cSituacao` ("Conciliado"/"Não conciliado"),
`dDataConciliacao`, `cDocumentoFiscal` e `nCodLancRelac`. As linhas já
espelhadas só ganham esses campos quando a janela delas for relida.

**Contratos de serviço e CT-e** (migração `20260914180000`, duas fases novas no
fim do ciclo de sincronização — `contratos` e `cte` —, ambas best-effort como a
de notas). `OmieContrato` espelha `servicos/contrato/ListarContratos`: código,
número, cliente, situação (`cCodSit`: 00 elaboração, 10 ativo, 90 suspenso,
99 cancelado), vigência, dia de faturamento, valor mensal (`nValTotMes`),
periodicidade (`cTipoFat`), itens e quem incluiu/alterou. Como a Omie só
devolve o estado atual, o espelho guarda `hashCampos` (situação, valor mensal,
vigência, itens) e uma lista `versoes` append-only — é o que sustenta
`CR-CONTRATO-ALTERADO`. O elo título → contrato é `OmieTitulo.contratoCodigo`
(`nCodCtr`); enquanto nenhum título a receber da base o traz (linhas
espelhadas antes da coluna existir), as regras de faturamento esperado ficam
caladas — acusar "sem faturamento" numa base sem elo seria acusar todos os
contratos de uma vez.

`OmieCte` espelha os CT-e emitidos (modelos 57 e 67) pelo **painel do contador**
(`contador/xml/ListarDocumentos`) — não existe `ListarCTe` na Omie; foram cinco
grafias recusadas antes de a conferência virar colagem manual. Só número, série,
chave de acesso, data, valor e status entram; o XML (`cXml`) é descartado. A
chamada **depende de o painel do contador estar habilitado na conta**: recusa
vira erro registrado no run, o diagnóstico ("Testar a integração") mostra se a
conta aceita e quais campos vieram, e as três regras de CT-e do agente fiscal
ficam caladas com o motivo escrito pelo supervisor. O casamento CT-e × título
é a mesma função da tela de conferência (`casarCtesComTitulos` em `cte.ts`):
chave de acesso, depois número, depois valor e data (±7 dias) — e só os dois
primeiros sustentam "cancelado com título" e "valor divergente" (> 1% e
> R$ 10); por valor e data, um cancelado e o seu substituto são indistinguíveis.

### Camada 2 — Supervisor

`src/lib/controladoria/supervisor.ts`. Nenhum achado chega ao painel ou ao
e-mail sem passar por ele. Existe porque um agente determinístico sempre "tem
certeza" do que calculou, mas não consegue saber:

1. **se o dado que leu estava completo** — sem extrato importado, "baixa sem
   movimento bancário" acusa centenas de falsos positivos, todos tecnicamente
   corretos e todos errados. O supervisor suprime a família inteira de regras
   que depende do dado ausente;
2. **se outro agente já apontou o mesmo fato** — consolida e mantém o segundo
   como corroboração, rebaixado;
3. **se o achado já foi julgado inaplicável por uma pessoa** — volta como INFO,
   com nota, respeitando a tratativa anterior. A tratativa é reconhecida pela
   chave exata e também por **regra + entidade**: as regras de padrão
   histórico carregam a competência na chave, e sem isso "não se aplica"
   marcado em agosto voltava gritando em setembro. Só o julgamento humano
   (`IGNORADO`) atravessa a competência; `RESOLVIDO` e `OBSOLETO` não;
4. **se está gritando "crítico" mais alto que os outros 40** — calibra: no
   máximo 5 críticos por execução, priorizados por impacto financeiro.

Também checa coerência aritmética (valor negativo ou acima do total da base =
erro de cálculo; o achado é descartado, não "corrigido"), penaliza achado sem
evidência e ajusta a **confiança** de toda a rodada pela qualidade da base.
Quando intervém, escreve o porquê em `notaSupervisor`, visível ao lado do achado
— revisão invisível seria indistinguível de censura.

### Camada 3 — Analista (IA)

`src/lib/controladoria/aiAnalyst.ts`, usando `claude-fable-5-1` (o mesmo
modelo lê os relatórios de consultoria em `src/lib/conformidade/analise.ts`).
Lê **apenas** os números já calculados e os achados já validados, e escreve a
leitura executiva. Não cria, não apaga e não altera achado nenhum: se pudesse
produzir os próprios "fatos", o relatório deixaria de ser auditável. Sem
`ANTHROPIC_API_KEY`, o relatório sai completo, apenas sem essa seção.

Cada ponto de atenção da leitura cita os **códigos das regras** dos achados que
o sustentam, e o e-mail liga cada código à tela de auditoria filtrada. É o que
torna a interpretação conferível em um toque. Ponto sem regra é leitura dos
números, e a lista vazia diz isso.

Duas proteções da chamada: recusa por classificador de segurança chega como
resposta bem-sucedida com `stop_reason: "refusal"` e é verificada antes de ler
o resultado; e a chamada leva `fallbacks: "default"`, que faz a API refazer a
mesma requisição num modelo de cobertura mais ampla quando o principal recusa
— o relatório não fica sem leitura por um falso positivo. Falhas da IA são
registradas no log da função (status da API e motivo), nunca engolidas.

### Investigador (IA, sob demanda)

`src/lib/controladoria/investigador.ts`, tela **Auditoria → Investigar com a
IA** (`/auditoria/investigar`, permissão `investigar`). É a segunda forma de IA
do módulo, com fronteira diferente: o analista recebe o relatório pronto; o
investigador recebe uma **pergunta** de uma pessoa e vai buscar a resposta na
base, através de um conjunto fechado de sete consultas — achados, detalhe de
achado, títulos de um parceiro, um título com as baixas, série mensal, cadastro
do parceiro e ordem de serviço. Todas de leitura, todas restritas à empresa da
sessão (o escopo vem da sessão por fechamento; o modelo não escolhe de que
empresa lê). Roda em `claude-sonnet-5` com esforço alto — um quinto do preço
por token do modelo do relatório diário, para um uso que é interativo e
frequente; se uma resposta parecer rasa, o ajuste é subir o esforço para
`xhigh`, não trocar de modelo.

Cada consulta feita fica registrada e aparece embaixo da resposta: a pessoa vê
o que a IA olhou e o que não olhou. A pergunta vai para a trilha de auditoria
(`INVESTIGACAO_IA`); a conversa inteira, as consultas e a resposta ficam na
tabela `Investigacao`, listada na própria tela como histórico.

A investigação anda em **rodadas**, como a sincronização: uma investigação são
várias chamadas ao modelo, cada uma de dezenas de segundos, e a hospedagem
corta a requisição em sessenta. Cada rodada faz as chamadas que cabem no
orçamento (uma chamada nova só começa com folga para terminar), grava a
conversa e devolve o estado; o navegador de quem perguntou chama a rodada
seguinte até o status sair de EXECUTANDO. Fechar a aba não perde nada —
reabrir pelo histórico retoma. Teto de doze consultas por pergunta; a tela tem `maxDuration` de 300 segundos (Fluid Compute). Cada
pergunta é uma chamada paga.

---

## 4. Conceitos que sustentam a qualidade dos achados

**Materialidade** — o que é "muito dinheiro" não é número fixo, é 0,5% do total
pago no ano (piso de R$ 500). Limiar chumbado ficaria grosseiro para uma empresa
que cresce e sensível demais para uma que encolhe — e encheria a tela de achado
irrelevante no primeiro mês, que é como um sistema de auditoria morre.

**Achado de ESTADO × de EVENTO** — "título vencido em aberto" é estado: some
sozinho quando o título é pago, e o motor o encerra como `OBSOLETO`. "Pagou
R$ 320 de juros em 14/02" é evento: não deixa de ser verdade porque não apareceu
hoje. A distinção importa no indicador de controle interno — "resolvemos 40
achados" é diferente de "40 sumiram sozinhos".

Um evento fecha sozinho quando uma auditoria **completa** acabou de rodar, o
agente dono rodou sem erro e, mesmo assim, não o apontou. Ou o fato está dentro
da janela e foi reavaliado (o dado foi corrigido na Omie, ou a regra foi
recalibrada), ou ficou para trás da janela e nenhum agente vai reencontrá-lo —
pendência que ninguém reavalia não é controle. Sem isso, 766 "recebimentos a
menor" e 850 "duplicidades" continuaram abertos depois de as regras terem sido
corrigidas, porque nada os fechava.

**Calibragem pelas evidências** — cada regra recalibrada nasce de uma evidência
real, e o teste (`npm run teste:calibragem`) fixa o caso:

- `CR-RETENCAO-PRESUMIDA` — a Omie do cliente não registra retenção em título
  nenhum, e o órgão público paga líquido: a Secretaria da Educação "recebia a
  menor" exatamente 7,70% em todos os títulos. Percentual fixo ao centavo é
  imposto retido, não perda. Dois ou mais títulos do mesmo cliente com a mesma
  alíquota (ou um só com alíquota conhecida: 1,5%, 4,65%, 5,85%, 11%…) viram
  um achado de retenção não registrada por cliente; o resto continua
  `CR-RECEBIDO-MENOR`, com o percentual na evidência.
- `CP-PAGO-ACIMA` — excedente igual ao desconto (documento 49.379,54, desconto
  49.379,54, pago 49.379,54) é forma de registro da Omie, não dinheiro a mais.
  O `resumo` de pesquisartitulos traz `nDesconto`/`nJuros`/`nMulta`, e o
  mapeamento passou a lê-los de lá em vez de somar das baixas.
- `CP-DIVERGENCIA-BAIXA` — diferença igual a juros + multa + tarifa − desconto
  (do título ou das baixas) é bruto de um lado e líquido do outro. O que sobra
  traz a lista de baixas espelhadas na evidência, para comparar com a aba de
  baixas da Omie.
- `CP-DUPLICIDADE` — documento "QUITADO"/"PAGO" vale como documento em branco;
  N parcelas idênticas para banco, financeira ou consórcio ficam informativas
  (em frota, são N contratos), com a leitura provável escrita no achado.
- `FR-FORNECEDOR-FUNCIONARIO` — motorista recebe pelo contas a pagar (diária,
  adiantamento, reembolso): 331 linhas de "conflito de interesse" eram
  processo. Passou a ser um achado por empresa e **categoria** de pagamento,
  com a lista de pessoas na evidência; categoria de rotina de motorista fica
  informativa, categoria de fornecedor comum (serviços, manutenção) continua
  fraude.
- `FR-CADASTRO-DUPLICADO` / `FR-CADASTRO-NOME-SIMILAR` — só dentro da mesma
  conta Omie. O mesmo fornecedor existe, com razão, na Azul e na MCZ; 203
  "duplicidades" eram isso. Nome igual com dois CPFs é homônimo (duas
  pessoas); com CNPJs de mesma raiz é matriz e filial. Sobra CNPJ de raiz
  diferente com o mesmo nome.
- `CP-DUPLICIDADE` (de novo) — três licenciamentos do DETRAN com documento
  "Toyota Corolla": texto sem dígito no número do documento é legenda, e
  quem cobra por veículo (DETRAN, seguradora, rastreador, pedágio, além de
  banco e consórcio) entra na leitura de "N veículos", informativa.

- `FR-FORNECEDOR-FUNCIONARIO` (de novo) — lê a árvore de categorias da Omie
  ("Banco de Horas" em "Despesas com Pessoal" é rotina pelo grupo); título de
  funcionário até R$ 1.000 em qualquer categoria é reembolso; "Freelancer" com
  várias pessoas da folha é pagamento por fora (risco financeiro, passivo
  trabalhista); rescisão ou acordo judicial pago a quem ainda consta ativo sobe
  para médio.
- `CP-PREVISAO` — documento "PREVISÃO" é orçamento lançado como conta a pagar;
  sai da duplicidade e vira um achado informativo por empresa.
- `CR-DESCONTO` — desconto acima de 50% do faturado (Ame 96,7%, SPAL 96,8%) é
  o campo registrando compensação, crédito ou baixa errada, não política
  comercial: erro de processo, sem impacto, com a forma de baixa a conferir.
- `OP-CONSOLIDACAO` — folha, encargos, tributos e financeiro não se cotam;
  pessoa física não entra; categoria com o maior fornecedor acima de 60% já
  está consolidada e o achado passa a ser a cauda fora do acordo.
- Padrões (`HI-*`) — a própria empresa (CNPJ ou nome da conexão), banco,
  consórcio e tributo não têm padrão de fornecedor. Reajuste que acompanha o
  crescimento da receita do grupo diz isso e pede custo por veículo, não aditivo.
- `FR-BAIXA-ANTECIPADA` — débito automático (banco, consórcio, cartão de
  combustível, tributo), baixa de valor zero e até 7 dias de atraso de
  lançamento não são título criado depois. Era um crítico de 1.704 casos.
- `FI-NOTA-CANCELADA` — NF-e de produto numa empresa de serviço é devolução; o
  título é resto do cancelamento e deve ser cancelado, não a nota reemitida.

A tabela "Concentração por regra" mostra, por regra, quantos achados são
apenas informativos, e o cabeçalho separa "a triar" de "informativos". A
calibragem levou a lista de 2.977 achados em aberto para 396, com 168 a triar.

**Triagem** — cada achado aceita responsável (texto livre) e prazo; prazo
vencido em achado aberto aparece em vermelho. Com a lista filtrada por regra,
"Tratar os N em lote" aplica a mesma decisão e justificativa a todos os achados
em aberto da regra (opcionalmente só os informativos), com um evento na trilha
dizendo quem, quando, o recorte e a quantidade. O lote exige a regra: não existe
"encerrar tudo". "Exportar CSV" baixa o recorte da tela, sem a evidência, para
virar lista de trabalho do RH, do jurídico e do financeiro
(`/api/exportar/achados`).

**Testes a cada push** — `.github/workflows/testes.yml` roda tipos, lint e os
doze conjuntos em todo push e pull request para `main`.

**Investigador com proposta** — a ferramenta `propor_tratativa` deixa a IA
propor resolvido, não se aplica ou em análise para um achado, com a
justificativa que a evidência sustenta. Nada é gravado: a proposta aparece na
lista de consultas com um botão "Aplicar", que chama a mesma ação de tratativa
da tela de auditoria, com a sessão, a permissão e a trilha de quem clicou.

**Agente de validação** — `.claude/agents/validacao-sistema.md` descreve, para
sessões futuras do Claude Code, a conferência completa: testes e build,
revisão de segurança, auditoria da lógica do motor e QA funcional local com
Playwright. Ele só executa e relata; não altera nem publica.

**Chave determinística** — o mesmo fato, reavaliado amanhã, produz a mesma chave
e reencontra o achado, preservando a tratativa que alguém escreveu nele.

**Valor × impacto** — `valorCents` é o dinheiro do fato (o que já saiu);
`impactoCents` é o que dá para evitar daqui para frente. Somar os dois no mesmo
campo inflaria o total do relatório.

---

## 5. Onde reduzir custo (capacidade estratégica)

`src/lib/controladoria/estrategiaCusto.ts`, usado pelo agente de oportunidades.

Reduzir custo é meta; saber **onde** reduzir é estratégia. Corte linear ("todos
reduzem 10%") trata igual o que é desigual: corta o combustível que leva o
passageiro na mesma proporção do contrato que ninguém usa mais. O módulo cruza:

1. **Peso** — quanto a categoria representa do custo total (Pareto: as que
   formam os primeiros 80%);
2. **Acoplamento à receita** — o custo sobe e desce com o faturamento, ou segue
   o próprio caminho?

| Classificação | Significado | O que fazer |
|---|---|---|
| **Cresce sem a receita crescer** | Aumento sem contrapartida de entrega | Alvo prioritário: achar o que entrou e cortar |
| **Estrutura (fixo)** | Estável, independente do volume | Renegociar contrato/escopo — efeito permanente |
| **Acompanha a entrega (variável)** | É o custo de prestar o serviço | **Não cortar**: buscar eficiência (custo por km, por hora) |
| **Histórico insuficiente** | Menos de 4 meses de base | Acompanhar antes de decidir |

Com menos de 4 meses de histórico o módulo **diz isso** em vez de recomendar
corte a partir de dois pontos.

---

## 6. Unit economics: custo por contrato, veículo e funcionário

`src/lib/controladoria/unitEconomics.ts`.

**Nada é inventado.** Um custo só é atribuído quando existe ligação verificável:
um de-para de centro de custo **confirmado por uma pessoa**, uma placa citada no
documento do título, ou um dado que já nasce vinculado (o abastecimento do cartão
de frota, que tem veículo e motorista). O resto vai para "não alocado".

**A cobertura é número de primeira classe.** Abaixo de 70% de cobertura, a tela e
o agente **não publicam** o ranking de rentabilidade — publicam o alerta de que a
base ainda não sustenta a conclusão, e o caminho para melhorá-la.

---

## 7. Conformidade: o que vem de fora

Este sistema audita os **dados**. Uma consultoria audita a **empresa**:
contrato, obrigação acessória, enquadramento, processo, contingência. São duas
leituras diferentes do mesmo risco, e o valor está em cruzá-las.

O menu **Conformidade** recebe o relatório mensal da consultoria (também da
contabilidade, da auditoria externa ou de uma fiscalização), guarda o arquivo
original como evidência e transforma o conteúdo em **apontamentos rastreáveis**
— com área, gravidade, prazo, responsável e tratativa.

### O que passa a ser possível

| | |
|---|---|
| **Confirmação cruzada** | A consultoria aponta "juros relevantes por atraso" e o agente de contas a pagar já vinha apontando os títulos um a um. O risco deixa de ser opinião de terceiro: duas fontes independentes chegaram nele por caminhos diferentes. |
| **Ponto cego dos dois lados** | Apontamento sem achado correspondente é coisa que este sistema não sabe ver — e talvez devesse. Achado sem apontamento é coisa que a consultoria não viu. |
| **Reincidência** | O mesmo ponto em três meses seguidos não é três problemas: é um processo que nunca foi corrigido. É o sinal de controle interno mais forte que existe, e ele é invisível quando cada relatório é lido isolado. |

### Como o arquivo vira apontamento

```
upload ──▶ arquivo guardado (SHA-256, evidência) ──▶ leitura ──▶ propostas ──▶ conferência humana ──▶ apontamento
                                                                                       │
                                              conciliação diária com os achados ◀───────┘
```

1. **O arquivo é guardado antes de qualquer processamento** e nunca é apagado
   por falha de leitura. Ele é a evidência, e apontamento sem fonte verificável
   não resiste a uma discussão com o fisco ou com um auditor.
2. **O caminho normal é encaminhar o e-mail da consultoria** (`.msg`). O sistema
   lê o corpo e os anexos juntos, porque os dois carregam metades diferentes do
   conteúdo: o PDF tem as tabelas de conformidade, e o corpo do e-mail tem a
   lista acionável com prazo ("Documentos que devem ser enviados até o dia
   10/08") e as referências de página. Ler só o anexo perderia justamente a
   metade com data. Remetente, assunto e data do e-mail preenchem sozinhos o
   que ficar em branco no formulário.
3. **PDF e imagem vão inteiros para o modelo**, que lê tabela e layout melhor
   que qualquer extração de texto — e nesses relatórios os slides de
   "Apontamentos/Questionamentos" são imagens, então extração de texto puro
   simplesmente não os enxerga. `.xlsx`, `.docx` e `.msg` são abertos por
   leitores próprios (ZIP+XML e OLE2/CFB), sem biblioteca de terceiros —
   parser de documento é uma das maiores superfícies de ataque que existe, e o
   arquivo vem de fora.
4. **A leitura transcreve, não julga.** Cada proposta carrega o **trecho
   literal** do documento e a página. Sem citação verificável, o apontamento não
   é emitido.
5. **Máquina propõe, pessoa confirma.** Enquanto não for conferida, a proposta
   não entra no relatório da diretoria nem conta como risco assumido pela
   empresa — e o próprio agente cobra as que ficam esperando.
6. **Sem `ANTHROPIC_API_KEY` o módulo funciona inteiro**, apenas sem a
   transcrição automática: o arquivo é guardado e os apontamentos são
   cadastrados à mão. A IA acelera a digitação; ela não é o produto.

### Quatro coisas diferentes numa lista só

Lendo os relatórios reais que o grupo recebe, ficou claro que uma consultoria
não produz uma lista homogênea de "riscos". Ela produz coisas que se resolvem de
formas diferentes, e tratar todas como risco faz a lista inteira parecer
igualmente grave — que é o mesmo que não priorizar nada. Por isso cada
apontamento tem uma **natureza**:

| Natureza | Como se resolve |
|---|---|
| **Documento pendente** | Enviando um arquivo. É a maior parte de qualquer relatório — e a que mais se arrasta. |
| **Questionamento** | Com uma resposta da contabilidade ou da empresa. |
| **Divergência técnica** | Só uma decisão da empresa encerra. Enquanto não encerra, o risco corre. |
| **Obrigação acessória** | Declaração entregue fora do prazo ou não entregue. |
| **Risco identificado** | Exposição de enquadramento, tese ou contingência. |
| **Dinheiro a recuperar** | Pagamento a maior, crédito não aproveitado. |

A natureza também muda a recomendação do agente na reincidência: documento
cobrado cinco vezes e nunca entregue quase nunca é esquecimento — ou ninguém foi
designado para produzi-lo, ou ele não existe, e nesse caso a resposta formal
"não temos" encerra o ponto, enquanto o silêncio o mantém aberto para sempre.

### Fundamentação técnica e legal

`src/lib/conformidade/obrigacoes.ts` traz o catálogo das obrigações que uma
operação de fretamento no Lucro Presumido cumpre todo mês — ISS, ICMS/CT-e, EFD
ICMS/IPI, EFD-Contribuições, DCTFWeb, eSocial, contribuição patronal, retenção
de 11% na cessão de mão de obra, IRPJ/CSLL trimestral, ECD, ECF, FGTS e as
certidões — com a norma que as cria, o prazo, a evidência que prova o
cumprimento e o risco de não cumprir. Junto vem a lista das **teses em que este
setor erra**: isenção do art. 78 do Anexo I do RICMS-SP aplicada fora das
hipóteses, crédito outorgado do art. 11 do Anexo III, compensação sem lastro
(art. 74 da Lei 9.430/96), ajuste M220/M620 sem processo ativo, dívida ativa não
tributária e locação com motorista lida como cessão de mão de obra.

O catálogo vive em código, e não no banco, por três razões: ele **fundamenta a
leitura automática** (é o que faz "registro C110 inexistente" ser classificado
como EFD ICMS/IPI, com base legal preenchida sem invenção), **fundamenta a
tela** (quem abre o apontamento vê a norma, o prazo e a consequência) e **fica
versionado** — prazo de obrigação acessória muda, e quando mudar o diff mostra o
que mudou e quando. Não substitui a assessoria: é o mapa que permite ao sistema
conversar com ela na mesma língua.

### Reincidência: como o mesmo assunto é reconhecido

A chave de recorrência é o conjunto **ordenado** de palavras significativas do
assunto — insensível à ordem da frase, porque a consultoria reescreve o mesmo
parágrafo todo mês. E, na criação, o sistema ainda procura um assunto anterior
da mesma área com 60% ou mais de sobreposição e **reaproveita a chave dele**:
sem isso, "juros e multa por atraso a fornecedores" e "atraso a fornecedores
gerando juros e multa" seriam dois problemas novos em vez de um problema de três
meses.

### Conciliação com os achados

Roda todo dia, logo depois da auditoria (os achados precisam existir com os ids
definitivos). O pareamento é **determinístico** — sobreposição de vocabulário
mais afinidade entre a área do apontamento e a família da regra —, nunca por IA:
é uma decisão que precisa ser explicável, reprodutível e revisável. Áreas como
trabalhista, societário e LGPD têm afinidade **vazia de propósito**: não há
regra correspondente aqui, e é isso que faz o apontamento cair corretamente em
"ponto cego do sistema" em vez de ser forçado num achado qualquer.

A ligação nasce como **sugestão**. Só depois que uma pessoa confirma é que ela
vale como confirmação cruzada no relatório — semelhança de texto não é prova.

### O que o agente de conformidade audita

| Regra | Quando dispara |
|---|---|
| `CONF-PRAZO` | Prazo combinado venceu e o apontamento continua aberto |
| `CONF-PARADO` | Risco crítico ou alto há mais de 30 dias sem prazo nem responsável |
| `CONF-REINCIDENTE` | Mesmo assunto em 3+ competências (5+ vira crítico) |
| `CONF-CONFIRMADO` | Apontamento com ligação **confirmada** a um achado interno |
| `CONF-NAO-CONFERIDO` | Propostas de leitura automática esperando conferência há 3+ dias |
| `CONF-SEM-RELATORIO` | A cadência mensal foi interrompida (só dispara onde já existe cadência) |
| `CONF-PONTO-CEGO` | Apontamentos em aberto que nenhum achado interno cobre |

Duas calibragens deliberadas: assunto já reincidente **não** vira também
`CONF-PARADO` (um problema de três meses ocuparia quatro linhas na mesa de quem
decide), e o teto de plausibilidade aritmética do supervisor **não se aplica** a
`CONF-*` — uma contingência trabalhista de R$ 800 mil pode superar o total de
títulos espelhados, e suprimi-la apagaria justamente o risco mais grave da lista.

### Transição para o Lucro Real em janeiro de 2027

`/conformidade/transicao`, alimentada por `src/lib/conformidade/regime.ts`. Mudar
de regime não é evento contábil: é projeto com prazo, decisões que precisam de
dono e pré-requisitos que levam meses. E os pré-requisitos falham exatamente
onde a conformidade desta empresa já falha — o balancete trimestral cobrado
desde dez/2025 é pendência de obrigação acessória no Presumido e **base de
cálculo do imposto** no Real. Mesmo item, duas gravidades: é essa continuidade
que faz as duas coisas morarem na mesma tela.

**Fretamento não é transporte público, e a diferença decide quase tudo.** O
catálogo separa as três modalidades porque a lei as separa:

| | Urbano (4921-3) | Linha regular concedida (4922-1) | **Fretamento (4929-9)** |
|---|---|---|---|
| Natureza | Serviço público delegado | Serviço público delegado | **Contrato privado, sem itinerário fixo** |
| Documento | Bilhete / NFS-e | BP-e | **CT-e OS, modelo 67** |
| Desoneração da folha | alcança | alcança | **não alcança** |
| Reforma | alíquota zero | redução | **provável regime cheio** |

Tratar as três como a mesma coisa produziria, aqui, otimismo injustificado — e
é o erro mais comum quando se fala genericamente em "transporte de passageiros".
Some-se o risco de **descaracterização**: transportado sem vínculo com o
contratante deixa de ser fretamento e aproxima a operação de linha regular sem
autorização, com a mesma prova servindo aos dois lados — a descrição da nota,
que é justamente o que a consultoria já questiona.

**Duas coisas tornam a janela de 2027 específica**, e o catálogo é construído em
cima delas: em 2027 PIS e COFINS são extintos, então quem migra em janeiro nunca
apura EFD-Contribuições não cumulativa — a parte mais cara da mudança; e o
crédito de CBS/IBS não depende do regime de IRPJ, então a escolha entre
Presumido e Real vira uma decisão exclusivamente de IRPJ/CSLL.

A tabela de créditos responde à pergunta que sempre vem primeiro (o que se pode
creditar) e à que decide o tamanho do ganho: **folha não gera crédito em regime
nenhum** — nem no não cumulativo, nem na CBS/IBS. Numa operação cujo maior custo
é folha, quem dimensiona o ganho pelo total de custos erra por um fator grande.

Cada decisão e cada item de preparação vira **apontamento com um clique**, com
área, natureza e base legal preenchidas — é o que separa um documento de
referência de um plano com dono. Itens que dependem de norma em transição saem
marcados como *confirmar com a assessoria*: o sistema organiza a decisão, quem
decide o enquadramento é a assessoria.

### No relatório diário e no BSC

O e-mail ganha o bloco **Conformidade e riscos externos** (só aparece quando há
o que mostrar): apontamentos em aberto, graves, com prazo vencido, reincidentes,
os cinco prioritários e o placar do cruzamento. A ordem dos prioritários é
prazo vencido → reincidência → gravidade: um apontamento médio que se repete há
cinco meses interessa mais à diretoria que um alto que chegou ontem — o primeiro
é falha de gestão, o segundo ainda é notícia.

No BSC, dois indicadores em **Processos internos** (e não na perspectiva
financeira, porque risco externo vira custo meses depois — o que se controla
hoje é a disciplina de tratar, não o valor):

- `PRO-CONFORMIDADE-PRAZO` — % dos apontamentos com prazo que ainda estão dentro dele
- `PRO-CONFORMIDADE-GRAVES` — quantidade de riscos críticos/altos em aberto

---

## 8. Ciclo diário

Uma única rota agendada, como máquina de estados com cursor persistido:

```
por empresa:  cadastros → títulos → movimentos → notas → contratos → CT-e
depois:       auditoria → conciliação da conformidade → relatório*    (grupo inteiro)

* só com "Relatório diário automático" ligado no modelo de gestão — nasce
  desligado, e sem ele o ciclo encerra depois da auditoria.
```

**Por que o relatório nasce desligado.** Durante a integração o que se quer é
espelhar e conferir. Um relatório gerado todo dia sobre uma base ainda
incompleta produz histórico enganoso — documento com data, com números que
ninguém validou, guardado como se fosse o retrato daquele dia (ver o comentário
em `RelatorioDiario`, sobre por que o HTML é preservado inteiro). A auditoria
continua rodando: é o achado que revela o que ficou faltando no espelho. E a
geração manual em **Relatórios → Gerar sem enviar** continua disponível, que é
como se confere o resultado antes de ligar o automático.

Cada invocação trabalha ~42s, grava onde parou e dispara a próxima via
`waitUntil` — o plano Hobby da Vercel tem 60s de teto duro por invocação.

**Previsão de caixa por contrato** (tela Fluxo de caixa,
`src/lib/controladoria/previsaoCaixa.ts`). A projeção por horizonte é
**contratual** — cada recebível entra no vencimento. Ao lado dela, a leitura
**realista**: cada cliente pelo próprio padrão (mediana do atraso entre
vencimento e baixa, e a frequência com que pagou no prazo), data prevista =
vencimento + atraso típico; sem 3 baixas de amostra, vale o padrão do
conjunto. Título vencido **além do padrão do cliente** não entra na previsão:
vai para a coluna "incerto", que é a lista de cobrança. Regras puras, testadas
em `teste:previsao`.

**Alerta por exceção.** O contrário do relatório: fica em silêncio enquanto
nada muda e manda um e-mail curto, logo depois da auditoria, no dia em que
surge um achado **crítico novo** ou o **caixa projetado** (pelos títulos em
aberto) fica negativo. Cada achado alerta uma vez — `AuditFinding.alertadoEm`
— e o caixa negativo repete no máximo a cada três dias
(`ControladoriaConfig.ultimoAlertaCaixaEm`). Liga-se em Modelo de gestão,
independente do relatório diário; usa os mesmos destinatários. Sem canal de
e-mail configurado, nada é marcado como alertado: o que ficou represado sai
quando o canal existir. Regra de decisão pura em `alerta.ts`, testada em
`teste:alerta`.

**Carga histórica (backfill)** usa a mesma máquina, mês a mês, por empresa, sem
gerar relatório (disparar um e-mail por mês carregado seria absurdo).

**Auditoria retroativa — auditar o passado** (Sincronização → "Auditar o
passado", `src/lib/controladoria/retroativa.ts`). O ciclo protege o presente:
audita o ano corrente, todo dia. Um desvio que começou em 2024 não aparece nele,
e "isso já vinha acontecendo?" é a primeira pergunta diante de um achado. A
varredura carrega um ano fechado inteiro (títulos, baixas, notas, extrato e
cartão de frota daquele ano) e roda os mesmos agentes, no **modo retroativo do
motor**: só fatos datados (EVENTO) são gravados — ESTADO descreve o "agora", e
calculado sobre 2024 seria um agora falso sobrescrevendo o verdadeiro — e nada
de ESTADO é fechado. Os achados entram na mesma fila, com a mesma tratativa.
Um ano por vez, sob demanda, dentro dos 300 s da tela.

Consequência no fechamento automático: um EVENTO só fecha sozinho quando a
auditoria **reavaliou o período em que ele aconteceu** (a data do fato cai na
janela lida) e o agente não o reencontrou. O ciclo diário de 2026 não fecha
mais um fato de 2024 "porque saiu do alcance" — quem reavalia 2024 é outra
varredura de 2024.

**Agendamento:** `10 6 * * *` UTC = 03:10 de Brasília, depois do fechamento
bancário e antes do expediente.

---

## 9. Segurança e rastreabilidade

- **Credenciais só em variável de ambiente**, uma por empresa. O cliente da Omie
  remove qualquer eco de `app_key`/`app_secret` das mensagens de erro antes de
  virarem texto persistido — a Omie ecoa a chave dentro da própria faultstring.
- **Dados bancários de fornecedor viram hash**, nunca ficam em claro. O hash
  serve a um propósito único: detectar **troca** de conta entre sincronizações.
- **CPF de pessoa física é mascarado na exibição** (LGPD, minimização).
- **Segregação de função:** ver o sistema é diferente de tratar achado, mudar
  parâmetro ou disparar sincronização. Num sistema que aponta o erro dos
  outros, "ver" e "poder desligar o alerta" não podem ser a mesma permissão.
  O recorte de cada pessoa é configurável em **Usuários e acessos** (abaixo).
- **Login compartilhado com a gestão**, o que garante desligamento único: quem é
  desativado lá perde o acesso ao financeiro no mesmo ato.
- **Trilha append-only** (`ControladoriaEventLog`): toda ação humana — tratativa,
  parâmetro, meta de BSC, conexão, sync e envio manual — fica registrada com
  autor, valores antes/depois, IP e user-agent.
- **Tratativa exige justificativa** ao marcar como resolvido ou "não se aplica".
- **Cron autenticado com comparação em tempo constante.**
- **Relatório servido com CSP restritiva**, sem cache compartilhado, sempre
  filtrado por empresa.
- **Leitura da gestão é só leitura**, por consultas explícitas num arquivo só.
  Para endurecer mais, `prisma/seguranca-banco.sql` cria um usuário Postgres com
  escrita apenas no schema próprio e leitura apenas nas 9 tabelas necessárias.
- **Documento de conformidade sai por um caminho só:** a rota de download, com
  `Content-Disposition: attachment`, `nosniff`, CSP `sandbox` e filtro por
  empresa. Nenhuma tela, contexto de auditoria ou relatório carrega o binário —
  o arquivo vem de fora, e abri-lo *inline* no domínio do sistema seria o
  caminho clássico de XSS por upload.
- **Arquivo idêntico não entra duas vezes:** o SHA-256 é chave única por
  empresa. Além de evitar apontamento duplicado, ele prova depois que o
  documento guardado é byte a byte o que a consultoria enviou.
- **Exclusão de documento preserva trabalho humano:** apagam-se as propostas não
  conferidas; apontamento que alguém validou sobrevive sem o anexo. E apontamento
  assumido nunca é excluído — encerra-se por tratativa, com justificativa, para
  sobrar histórico.

---

### Usuários e perfis de acesso

Os cinco papéis do cadastro da gestão — ADMIN, GESTOR, CONTROLADORIA, FOLHA,
MOTORISTA — descrevem a operação de transporte, não a controladoria. Não há como
expressar neles "vê o DRE mas não trata achado" ou "só olha conformidade". O
**perfil** é a peça que faltava: um recorte de telas e ações, definido pela
própria empresa em **Usuários e acessos**.

**A identidade continua sendo da gestão.** Criar usuário nessa tela escreve no
cadastro de lá — o mesmo do login da frota. Um cadastro paralelo faria o
desligamento depender de alguém lembrar de repetir a operação nos dois lugares,
e o dia do esquecimento é o dia em que um ex-funcionário continua enxergando o
caixa do grupo. Só a **autorização** mora aqui.

Três regras sustentam o desenho:

| Regra | Por quê |
|---|---|
| **Sem perfil atribuído, valem as regras de papel** | É o contrato de "nada muda no dia em que isto sobe". Ninguém ganhou nem perdeu acesso quando o módulo subiu; o que passou a existir é a possibilidade de ajustar. |
| **Papel sem acesso vence qualquer perfil** | FOLHA e MOTORISTA não entram, e um perfil generoso não pode virar porta dos fundos. Quem administra pessoas é a gestão, e a decisão de lá sobre quem é do financeiro continua valendo aqui. |
| **Um perfil padrão por empresa** | Vale para quem não tiver perfil próprio. Dois marcados fariam a resolução depender da ordem que o banco devolvesse — acesso decidido por sorte. |

**O acesso é cobrado em três camadas, a partir de uma resolução só**
(`acessoDaSessao`, em `src/app/(app)/_dados.ts`):

1. **o menu** mostra apenas o que a pessoa alcança;
2. **a página** recusa quem digitar a URL (`exigirPermissao`);
3. **a ação e a rota de exportação** recusam o formulário montado à mão.

Esconder o item do menu não é controle de acesso — é sugestão. E duas
implementações da mesma regra divergem com o tempo, nas duas direções ruins:
item de menu que leva a "sem acesso", ou página que abre sem estar no menu.

O catálogo de permissões está em `src/lib/acessos.ts`, separado em **Telas** e
**Ações** — e a separação é a mesma ideia da segregação de função acima. A
resolução tem testes sem banco: `npm run teste:acessos`.

**Criar usuário exige escrita no banco da gestão**, que pelo desenho recomendado
é somente leitura. Nesse caso a tela recusa dizendo exatamente isso e apontando
as duas saídas — cadastrar pela gestão, ou conceder `INSERT`/`UPDATE` em
`public."User"`. O comando está em `docs/papel-leitura-gestao.sql`, numa seção
separada e comentada, com o custo da concessão escrito nela.

---

### Testar a integração antes de carregar

**Conexões Omie → Testar a integração** consulta cada endpoint com **os mesmos
parâmetros que a sincronização usa**, sem gravar nada. Um teste que usasse uma
chamada mais simples poderia passar enquanto o sync falha, e teste que mente é
pior que teste nenhum.

Para cada endpoint ele mostra três coisas, e as três importam por motivos
diferentes:

| | Por que importa |
|---|---|
| **Estado** | Separa "não conectou" de "conectou e não há registro no período". A Omie responde HTTP 500 nos dois casos, e confundi-los é o erro mais comum ao ligar uma integração com esse ERP. |
| **Campos que o mapeamento não preencheu** | É aqui que aparece um nome de campo divergente. Campo com nome diferente **não quebra o sync** — grava nulo em silêncio, e o problema só aparece semanas depois como uma coluna vazia no relatório. |
| **Campos crus da conta** | O que a conta de fato devolveu, incluindo um nível de aninhamento. Permite corrigir `mapping.ts` sem precisar de acesso à conta Omie. |

O extrato é testado por último e usa o código de conta corrente que o próprio
diagnóstico acabou de obter — não há como consultá-lo sem uma conta válida, e
testar a cadeia inteira é justamente como o sync funciona.

Três sondas cobrem o que ainda não foi confirmado contra a conta real:
**Contratos de serviço** (mostra sob qual nome veio o array, se
`cExibirProdutos` passou e se `cCodSit`, `nValTotMes` e `cTipoFat` chegaram
preenchidos) e **CT-e pelo painel do contador**, uma por modelo (57 e 67). Se a
conta não tem o painel habilitado, a sonda mostra a recusa — e é essa recusa,
não um vazio, que explica por que as regras de CT-e estão caladas.

---

## 10. O que validar na PRIMEIRA execução real contra a Omie

Esta é a parte honesta: o mapeamento dos campos foi escrito a partir da
documentação pública, e **a resposta real da conta pode trazer nomes de campo
diferentes** — a Omie varia nomes entre endpoints e entre versões do mesmo
endpoint.

A leitura é tolerante de propósito (`src/lib/omie/mapping.ts`): um campo que mude
de nome vira `null` e o registro entra com aquele campo vazio, em vez de derrubar
o sync. E existe uma tela feita para revelar isso:

**Sincronização → "Preenchimento dos campos"** mostra o percentual preenchido por
campo e por entidade. Depois da primeira carga:

1. Se **categoria, centro de custo ou documento** aparecerem com preenchimento
   muito baixo, verifique se é falha de processo na Omie (o campo realmente não é
   preenchido — e aí o agente já abre o achado) ou se é um alias faltando na
   lista de nomes conhecidos do `mapping.ts`.
2. Confira se o **extrato bancário** trouxe lançamentos para todas as contas
   ativas. Sem extrato, o supervisor suspende a conciliação e a projeção de caixa.
3. As **notas fiscais** são sincronizadas em modo best-effort: os parâmetros de
   filtro de data de NF-e/NFS-e variam entre planos do ERP. Uma recusa ali é
   registrada como erro e **não** impede o núcleo financeiro.
4. Confira se o total de **títulos a pagar do mês** bate com o relatório da
   própria Omie, **empresa por empresa**. Divergência aponta para uma janela de
   sincronização que não foi coberta.

---

## 11. Modelo de gestão: parâmetros que valem preencher

Vários agentes ficam **parcialmente desligados** enquanto os parâmetros não
existirem — e dizem isso, em vez de inventar um número:

- **Alçada de aprovação** → liga a detecção de fracionamento. O sistema calcula
  uma **sugestão a partir da distribuição real dos pagamentos** (percentis
  50/90/99), melhor que uma tabela genérica de mercado.
- **Saldo mínimo de caixa** → liga o alerta antes que a falta de saldo vire juros
  de conta garantida.
- **Meta de margem por contrato** → sem ela, o sistema só aponta margem negativa.
- **Tolerância de variação, atraso crítico e limite de concentração** → têm padrão
  razoável, mas valem ajuste à realidade da operação.

Regra de controle interno que sustenta o resto: **quem cadastra o título nunca
pode ser quem aprova o pagamento.**
