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

### Camada 1 — Onze agentes de domínio

Determinísticos e puros: recebem o mesmo retrato dos dados, não consultam banco
nem API, não escrevem nada. São onze porque cada um responde a uma pergunta com
**dono diferente na empresa** — o que torna o achado endereçável a alguém.

| Agente | Área | O que procura |
|---|---|---|
| `contas-pagar` | Financeiro | Juros e multa por atraso, duplicidade, pagamento acima do documento, títulos vencidos e "fantasma", antecipação sem desconto, falta de classificação |
| `contas-receber` | Financeiro | Inadimplência por cliente, aging, descontos concedidos, recebimento a menor, concentração de receita, atraso recorrente |
| `conciliacao-bancaria` | Financeiro | Movimentos não conciliados, saída sem título, baixa sem dinheiro no extrato, débito duplicado, saldo abaixo do mínimo |
| `antifraude` | Controladoria | Troca de conta bancária de fornecedor, fracionamento de alçada, fornecedor que é funcionário, documento inválido, cadastro duplicado, pagamento em dia não útil, Lei de Benford |
| `custos` | Controladoria | Variação por categoria, despesa nova, gasto recorrente, valor fora do padrão, divergência combustível Omie × cartão de frota |
| `fiscal` | Contabilidade | Nota cancelada com título ativo, receita sem nota, nota sem título, carga tributária fora da faixa do Lucro Presumido, falha de sequência |
| `fluxo-caixa` | Tesouraria | Projeção 7/15/30/60/90 dias, descasamento da semana, ciclo financeiro (PMR/PMP) |
| `rentabilidade` | Controladoria | Margem por contrato, contrato no prejuízo, veículo fora do padrão, cobertura do rateio |
| `oportunidades` | Controladoria | **Onde reduzir custo** (seção 5), juros evitáveis anualizados, tarifas, consolidação de fornecedores, política de alçadas sugerida |
| `administrativo` | Administrativo | Sync atrasado ou com erro, cadastro incompleto, conta sem extrato, achados críticos sem tratativa |
| `conformidade` | Controladoria | Prazo estourado, risco grave sem responsável, apontamento externo reincidente, apontamento confirmado pelos dados, proposta de leitura não conferida, relatório mensal não recebido, ponto cego do sistema |

Um agente que quebra **não derruba os outros dez**.

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
   com nota, respeitando a tratativa anterior;
4. **se está gritando "crítico" mais alto que os outros 40** — calibra: no
   máximo 5 críticos por execução, priorizados por impacto financeiro.

Também checa coerência aritmética (valor negativo ou acima do total da base =
erro de cálculo; o achado é descartado, não "corrigido"), penaliza achado sem
evidência e ajusta a **confiança** de toda a rodada pela qualidade da base.
Quando intervém, escreve o porquê em `notaSupervisor`, visível ao lado do achado
— revisão invisível seria indistinguível de censura.

### Camada 3 — Analista (IA)

`src/lib/controladoria/aiAnalyst.ts`, usando `claude-opus-5`. Lê **apenas** os
números já calculados e os achados já validados, e escreve a leitura executiva.
Não cria, não apaga e não altera achado nenhum: se pudesse produzir os próprios
"fatos", o relatório deixaria de ser auditável. Sem `ANTHROPIC_API_KEY`, o
relatório sai completo, apenas sem essa seção.

---

## 4. Conceitos que sustentam a qualidade dos achados

**Materialidade** — o que é "muito dinheiro" não é número fixo, é 0,5% do total
pago no ano (piso de R$ 500). Limiar chumbado ficaria grosseiro para uma empresa
que cresce e sensível demais para uma que encolhe — e encheria a tela de achado
irrelevante no primeiro mês, que é como um sistema de auditoria morre.

**Achado de ESTADO × de EVENTO** — "título vencido em aberto" é estado: some
sozinho quando o título é pago, e o motor o encerra como `OBSOLETO`. "Pagou
R$ 320 de juros em 14/02" é evento: nunca deixa de ser verdade, e só uma pessoa
o encerra. A distinção importa no indicador de controle interno — "resolvemos 40
achados" é diferente de "40 sumiram sozinhos".

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
por empresa:  cadastros → títulos → movimentos → notas
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

**Carga histórica (backfill)** usa a mesma máquina, mês a mês, por empresa, sem
gerar relatório (disparar um e-mail por mês carregado seria absurdo).

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
  escrita apenas no schema próprio e leitura apenas nas 6 tabelas necessárias.
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
