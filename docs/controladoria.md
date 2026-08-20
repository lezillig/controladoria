# Sistema de Controladoria — como funciona

Sistema independente, ligado à API da Omie, que espelha o ERP em D-1, roda uma
bateria de agentes de auditoria sobre os dados, mede um Balanced Scorecard e
envia um relatório gerencial e executivo por e-mail todos os dias.

---

## 1. Em uma passada

```
Omie (Azul) ──┐
              ├─sync D-1 por empresa──▶ espelho ──▶ 10 agentes ──▶ supervisor ──▶ achados
Omie (MCZ) ───┘                            │                                        │
                                            ├──▶ analytics (DRE, caixa, comparativos)│
gestão de motoristas ──leitura──────────────┤                                        │
(frota, ponto, contratos)                   ├──▶ BSC (4 perspectivas, metas, faróis) │
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

### Camada 1 — Dez agentes de domínio

Determinísticos e puros: recebem o mesmo retrato dos dados, não consultam banco
nem API, não escrevem nada. São dez porque cada um responde a uma pergunta com
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

Um agente que quebra **não derruba os outros nove**.

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

## 7. Ciclo diário

Uma única rota agendada, como máquina de estados com cursor persistido:

```
por empresa:  cadastros → títulos → movimentos → notas
depois:       auditoria → relatório     (grupo inteiro)
```

Cada invocação trabalha ~42s, grava onde parou e dispara a próxima via
`waitUntil` — o plano Hobby da Vercel tem 60s de teto duro por invocação.

**Carga histórica (backfill)** usa a mesma máquina, mês a mês, por empresa, sem
gerar relatório (disparar um e-mail por mês carregado seria absurdo).

**Agendamento:** `10 6 * * *` UTC = 03:10 de Brasília, depois do fechamento
bancário e antes do expediente.

---

## 8. Segurança e rastreabilidade

- **Credenciais só em variável de ambiente**, uma por empresa. O cliente da Omie
  remove qualquer eco de `app_key`/`app_secret` das mensagens de erro antes de
  virarem texto persistido — a Omie ecoa a chave dentro da própria faultstring.
- **Dados bancários de fornecedor viram hash**, nunca ficam em claro. O hash
  serve a um propósito único: detectar **troca** de conta entre sincronizações.
- **CPF de pessoa física é mascarado na exibição** (LGPD, minimização).
- **Segregação de função:** ver o sistema (ADMIN, GESTOR, CONTROLADORIA) é
  diferente de tratar achado e mudar parâmetro (ADMIN, CONTROLADORIA). Num
  sistema que aponta o erro dos outros, "ver" e "poder desligar o alerta" não
  podem ser a mesma permissão.
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

---

## 9. O que validar na PRIMEIRA execução real contra a Omie

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

## 10. Modelo de gestão: parâmetros que valem preencher

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
