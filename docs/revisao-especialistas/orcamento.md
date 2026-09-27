# Parecer de FP&A — projeção, orçamento e cenários

Revisão do sistema feita por um especialista de IA (Fable 5.1) no papel de analista de orçamento e planejamento financeiro, em 27/09/2026, somente leitura do código. Referências `arquivo:linha` apontam para o estado do repositório naquela data.

## 1. Resumo executivo

O sistema **projeta caixa, não resultado**: a única projeção existente é a de tesouraria de curto prazo (até 90 dias), calculada a partir dos títulos em aberto já lançados na Omie — `agents/fluxoCaixa.ts:45-68` (contratual: cada título no vencimento) e `previsaoCaixa.ts:189-255` (realista: cada cliente pelo atraso mediano das próprias baixas). O método realista é bem construído e testado (`scripts/teste-previsao.ts`), mas cobre só o lado das entradas; as saídas continuam contratuais e nada que ainda não virou título (folha do mês seguinte, impostos, diesel) entra na conta. **Não existe orçamento, nem orçado × realizado, nem cenário, nem rolling forecast**: `prisma/schema.prisma` não tem modelo de orçamento (a única "meta" persistida é `BscMeta`, um número por indicador, e `ControladoriaConfig.metaMargemPercent`), o DRE anual (`dre.ts:925-984`) para no mês corrente e o comparativo (`analytics.ts:125-181`) só confronta realizado com realizado. As séries históricas (`HistoricoMensal`, `historico.ts`) existem, são agregadas no banco e têm baseline por mediana/MAD, mas foram desenhadas para auditoria (detectar desvio), não para projeção: sem sazonalidade, sem marcação de mês parcial, sem dimensão por linha do DRE. Os contratos da Omie (`OmieContrato`) trazem valor mensal, vigência e periodicidade, mas só alimentam regras de auditoria (`agents/contratos.ts`) — nunca uma projeção de receita. Confiabilidade hoje: boa para "o que vence nos próximos 30 dias", nula para "como fecha o ano". Os dados para um módulo de cenários mínimo já existem em boa parte (contratos, histórico 24 meses por categoria/parceiro, km/litros/hora da gestão); o que falta é a camada de premissas e as tabelas de orçamento.

## 2. Achados ranqueados

### A1. CRÍTICO — Não há orçamento nem orçado × realizado em lugar nenhum
- **Onde:** `prisma/schema.prisma` (nenhum modelo `Orcamento`/`Meta` por período); `ControladoriaConfig` (só `metaMargemPercent`, `saldoMinimoCaixaCents`, `toleranciaVariacaoPercent`); `analytics.ts:125-181` (`comparativoDoEscopo`: mês anterior, ano anterior, mesmo mês do ano anterior); `dre.ts:931-935` (`montarDreAnual` para no mês da referência); `docs/roadmap.md` (seções 3 e 5 não mencionam orçamento).
- **O que existe:** comparação realizado × realizado, com o cuidado correto de YTD contra YTD (`periodos.ts:81-84`) e "sem base" quando o ano anterior não está carregado (`analytics.ts:157`).
- **Limitação:** o gestor não tem como registrar o que esperava e medir desvio. `agents/custos.ts:159` chega a recomendar "conferir se está no orçamento" — orçamento que o sistema não conhece. A MCZ lança previsões como títulos a pagar (`CP-PREVISAO`, `scripts/teste-calibragem.ts:321-334`): é o sintoma de que a empresa já precisa de um lugar para previsões e usa o contas a pagar como improviso.
- **O que mudar:** tabela de orçamento por (empresa, ano, versão, linha do DRE ou categoria, mês, valor, origem) alinhada a `LINHAS_DRE` (`dre.ts:29-119`) via `DreClassificacao`; coluna "orçado" e "desvio" em `montarDreAnual`, no comparativo e no cartão de resultado do painel.

### A2. CRÍTICO — A projeção de caixa só enxerga títulos já lançados; sem recorrência, sem horizonte além de 90 dias
- **Onde:** `agents/fluxoCaixa.ts:20` (`HORIZONTES_DIAS` 3…90), `:45-68` (`projetarFluxoCaixa`: saldo + receber a vencer − pagar em aberto); `fluxo-caixa/page.tsx:156` (`saldoRealista = saldo + realista - p.saidasCents` — saídas continuam contratuais); `page.tsx:45-59` (agenda dia a dia pelo vencimento).
- **O que existe:** projeção conservadora e declarada (`fluxoCaixa.ts:41-44`: vencido a pagar é saída imediata, vencido a receber não entra), com alerta de ruptura (`FC-SALDO-NEGATIVO`) e descasamento da semana.
- **Limitação:** folha, encargos, impostos, diesel e qualquer despesa que só vira título perto do vencimento ficam fora. Em 60/90 dias a coluna "saídas" subestima sistematicamente, e o "saldo realista" fica otimista justamente no horizonte em que a decisão de crédito precisa ser tomada. Não há visão mensal de 12 meses. O sync revisita vencimentos em ±120 dias (`omie/sync.ts:434-437`), coerente com o horizonte atual, mas insuficiente para um rolling forecast.
- **O que mudar:** camada de "saídas recorrentes previstas" derivada de `HistoricoMensal` na dimensão CATEGORIA (mediana dos últimos meses fechados, natureza PAGAR) para todo mês do horizonte que ainda não tem título lançado, descontando o que já está lançado; estender a projeção a 12 meses em granularidade mensal, mantendo a diária em 90 dias.

### A3. CRÍTICO — `OmieContrato` é a melhor base de receita recorrente do sistema e não alimenta nenhuma projeção
- **Onde:** `schema.prisma` (`OmieContrato`: `valorMensalCents`, `vigenciaInicio/Fim`, `diaFaturamento`, `periodicidade`, `itens` Json, `versoes`); `agents/contratos.ts:206-211` (`contratoDeveOMes` — a regra "este contrato deve receita neste mês" já existe), `:219-253` (`CR-CONTRATO-SEM-FATURAMENTO`); `omie/mapping.ts:875-890` (só periodicidade mensal é avaliada).
- **O que existe:** o espelho guarda tudo de que uma projeção de receita contratada precisa, e o agente já sabe calcular a receita esperada do mês — mas só para acusar ausência de faturamento.
- **Limitação:** `previsaoCaixa.ts`, `fluxoCaixa.ts` e `analytics.ts` não leem `ctx.contratos`. Sem data-base/índice de reajuste (a Omie não devolve; `padroes.ts:266-268` estima 4% fixo). `itens` é Json sem estrutura — quantidade/valor unitário não viram km ou horas contratadas. Periodicidade bimestral/trimestral/semestral é ignorada em vez de distribuída.
- **O que mudar:** função pura "receita contratada por mês" = Σ contratos ativos × vigência × periodicidade (distribuindo não mensais), consumida pela projeção de 12 meses; tabela complementar de reajuste por contrato (data-base, índice, % esperado, tipo de tomador público/privado); estrutura mínima de `itens` (serviço, quantidade, unidade: mês/km/hora).

### A4. IMPORTANTE — Previsão realista de recebimento: bom método de prazo, mas sem inadimplência, sem retenção e sem ponderação por valor
- **Onde:** `previsaoCaixa.ts:28` (`MINIMO_DE_AMOSTRA = 3`), `:32` (corte de 365 dias), `:81-101` (mediana simples de atrasos, uma baixa = um voto), `:138-154` (`preverTitulo`: vencido além do padrão → "incerto"), `:61` (`saldoAberto` = saldo bruto); `schema.prisma` (`retencao*Cents` espelhados; `OmieTitulo.dataPrevisao` espelhado e não usado por nenhuma previsão); `previsaoHistorico.ts:37-49` (código de parceiro traduzido só quando único nas duas contas).
- **O que existe:** dois cenários lado a lado (contratual × realista), cliente a cliente, com fallback de 24 meses e coluna "incerto" como lista de cobrança. Testado em `scripts/teste-previsao.ts`.
- **Limitação:** (a) o modelo desloca no tempo, nunca perde — "incerto" sai da previsão mas não vira taxa de perda esperada; (b) `calcularCiclo` pondera por valor (`fluxoCaixa.ts:86-91`) e `comportamentoPorCliente` não; (c) título de prefeitura entra pelo bruto e recebe líquido de ISS/IR/PCC — a projeção erra exatamente o valor retido; (d) cliente com o mesmo código nas duas contas Omie fica sem histórico de 24 meses; (e) `dataPrevisao` da Omie (previsão digitada pelo financeiro) é ignorada.
- **O que mudar:** curva de recebimento por cliente (% recebido em 0/30/60/90 dias e % não recebido) em vez de um atraso mediano; ponderar por valor; deduzir retenções do saldo previsto; usar `dataPrevisao` como override quando preenchida.

### A5. IMPORTANTE — Séries históricas sem sazonalidade, sem marcação de mês parcial e sem dimensão de DRE
- **Onde:** `historico.ts:33` (dimensões só PARCEIRO/CATEGORIA), `:43-44` (competência por emissão), `:384-410` (`montarBaselines`: mediana+MAD sobre a janela inteira, sem mês do ano); `ciclo.ts:178-179` (recalcula competências da janela D-3 — o mês corrente é gravado parcial e nada o marca); `previsaoHistorico.ts:18-26` (lê até o mês corrente, parcial); `padroes.ts:43` (janela 24 meses), `:104` (`foraDoPadrao` exclui o mês corrente — cuidado local, não da camada); `dre.ts:484-495` (reconhece sazonalidade escolar, mas só como comparação mês × mesmo mês); `agents/custos.ts:83-94` (`CU-VARIACAO` compara "mesmo dia do mês" — tratamento correto de mês parcial, mas isolado).
- **O que mudar:** flag "mês fechado" (ou excluir por regra o mês da referência em qualquer leitura para projeção); baseline sazonal = mesmo mês do ano anterior × tendência dos últimos 12 meses fechados, com winsorização pelo MAD; consulta agregada por linha do DRE via join com `DreClassificacao`.

### A6. IMPORTANTE — Metas do BSC: número único sem período, sugestões fixas e indicadores medidos sobre mês parcial
- **Onde:** `bsc.ts:52-358` (`INDICADORES_BSC` com `metaSugerida` fixa), `:391-432` (`medirBsc`), `:62-73` (FIN-MARGEM sobre `janelas.mesAtual`, que vai até D-1), `:103-119` (FIN-COBERTURA-CAIXA = saldo ÷ a pagar 30 dias, sem entradas); `BscMeta` (um `Float` por código, sem ano/mês); `metaMargemPercent` em `ControladoriaConfig` (segunda meta de margem, usada só em `agents/rentabilidade.ts:101`).
- **O que mudar:** `BscMeta` por período (ano, opcionalmente mês) e derivável do orçamento; FIN-MARGEM sobre último mês fechado ou YTD; unificar `metaMargemPercent` com a meta de FIN-MARGEM; cobertura de caixa usando o realista da projeção.

### A7. IMPORTANTE — Os direcionadores operacionais já existem na gestão, mas não chegam à camada financeira como série
- **Onde:** `gestao/leitura.ts:72-92` (`AbastecimentoGestao.volumeLitros`, `kmRodados`, `hodometro`), `:98-105` (`UsoDeVeiculoGestao.kmInicial/kmFinal`), `:115-121` (`PrecoAnpGestao`), `:33-51` (`MotoristaGestao.valorHoraCents`, `clienteId`, `active`); `unitEconomics.ts:133-214` (custo e receita por contrato — só realizado, sem unidade física); `bsc.ts:303-357` (calculados por dia, nunca guardados como série mensal).
- **O que mudar:** série mensal de drivers realizados (km, litros, R$/L pago, R$/L ANP, motoristas ativos, veículos ativos, receita, receita por km) persistida no fechamento de cada mês; cadastro de km/horas contratadas por cliente.

### A8. IMPORTANTE — Classificação fixo × variável existe como heurística de corte, não como comportamento para projetar
- **Onde:** `estrategiaCusto.ts:42-54`, `:152-173` (primeira metade × segunda metade de 12 meses), `:175-184` (limiares de 10 p.p.), `:81-86` (percentuais de redução fixos).
- **O que mudar:** campo "comportamento" por categoria (FIXO, VARIÁVEL_KM, VARIÁVEL_RECEITA, FOLHA, TRIBUTO_%RECEITA, FINANCIAMENTO) em `DreClassificacao`, proposto pela heurística atual e confirmado pela pessoa.

### A9. MELHORIA — Saldo de caixa é aproximação e a projeção herda a incerteza
- **Onde:** `agents/conciliacao.ts:423-433` (`saldoAtualCents` = saldo inicial + movimentos espelhados), `:378-381`; `supervisor.ts:200-203` (sem extrato, projeção suspensa).
- **O que mudar:** registrar "saldo conferido em <data>" por conta e projetar a partir dele; exibir a data da última conferência ao lado do saldo projetado.

### A10. MELHORIA — Ciclo financeiro bom, custo do capital fixo
- **Onde:** `agents/fluxoCaixa.ts:79-104` (PMR/PMP ponderados por valor); `:185` (`custoDoCiclo = receberEmAberto * 0.01 * dias/30` — 1% a.m. fixo).
- **O que mudar:** taxa de custo de capital em `ControladoriaConfig`, reutilizada pelo cenário "antecipar recebíveis × capital de giro".

### A11. MELHORIA — Projeções pontuais espalhadas, cada uma com sua premissa
- **Onde:** `agents/oportunidades.ts:124-130`, `padroes.ts:268` (`REAJUSTE_ESTIMADO = 0.04`), `padroes.ts:351`, `agents/rentabilidade.ts:106`.
- **O que mudar:** tabela única de premissas (índice de reajuste esperado, custo de capital, inflação de custo fixo) lida por essas regras e pelo módulo de cenários.

### A12. MELHORIA — Descrições desatualizadas dos horizontes
- **Onde:** `agents/fluxoCaixa.ts:111` ("7, 15, 30, 60 e 90 dias") e `docs/controladoria.md:73`, contra `HORIZONTES_DIAS` com dez pontos (`fluxoCaixa.ts:20`).

## 3. Módulo de cenários mínimo viável (sem código)

Princípio: o cenário é uma **camada de premissas sobre séries realizadas que já existem**, produzindo o mesmo DRE (`LINHAS_DRE`) e o mesmo fluxo de caixa que as telas já mostram — só que para frente.

### 3.1 Direcionadores, linha afetada e base

| Driver | Mexe em | Base já existente | Cadastro novo necessário |
|---|---|---|---|
| Receita contratada (valor mensal × vigência × periodicidade) | RECEITA_BRUTA; entradas de caixa | `OmieContrato`, `contratoDeveOMes` | estrutura mínima de `itens` (unidade, quantidade, preço unitário) |
| Reajuste de tarifa/contrato (% e data-base) | RECEITA_BRUTA a partir da data-base | histórico de valor por cliente (24 meses), `HI-REAJUSTE-VENCIDO` | tabela de reajuste por contrato: data-base, índice, % esperado, tomador público/privado |
| Km rodado | DESPESA_VEICULOS nas categorias VARIÁVEL_KM; receita nos contratos por km | `UsoDeVeiculoGestao`, `AbastecimentoGestao.kmRodados/hodometro`, custo por veículo | km contratado/mês por cliente; vínculo veículo→cliente por mês |
| Preço do diesel (R$/L) | DESPESA_VEICULOS (combustível) | litros e valor pagos, referência ANP, litros/km por veículo | nenhum |
| Headcount e reajuste de CCT | DESPESA_SALARIOS | motoristas ativos e `valorHoraCents`, folha por categoria | custo médio mensal por função, data-base da CCT e % esperado |
| Inadimplência / prazo de recebimento | só caixa | `comportamentoPorCliente`, `diasPagamentoSoma`, retenções | nenhum; evoluir para curva por cliente |
| Custo fixo + inflação | ESTRUTURA, INFORMATICA, ADMINISTRATIVA | mediana 12 meses fechados por categoria fixa | % de inflação anual por grupo |
| Tributos (% da receita) | DEDUCOES, TRIBUTO_SOBRE_LUCRO | percentual efetivo realizado | alíquota efetiva por empresa |
| Financiamento/consórcio e capex | FINANCIAMENTO_INVESTIMENTO; saídas | parcelas já lançadas | tabela de financiamentos (parcela, quantidade restante) e plano de renovação de frota |

Base histórica: 12 meses fechados para custo fixo, consumo e folha; 24 meses fechados para sazonalidade de receita e prazo de recebimento. Mês corrente sempre fora.

### 3.2 Entradas

1. **Cenário**: empresa, nome, ano, tipo (orçamento anual / rolling forecast / simulação), versão, quem aprovou, data. Um cenário "Base" gerado automaticamente das séries e dos contratos.
2. **Premissa do cenário**: chave (driver), valor, mês de início e fim, empresa.
3. **Orçamento por linha**: empresa, ano, versão, linha do DRE ou categoria, mês, valor, origem.
4. **Contrato projetável**: liga `OmieContrato` a km/horas contratadas, data-base, índice e % de reajuste, tipo de tomador.
5. **Comportamento por categoria**: campo em `DreClassificacao`, proposto pela heurística e confirmado.
6. **Série mensal de drivers realizados**: km, litros, R$/L pago e ANP, motoristas e veículos ativos, receita, custo variável, custo fixo.
7. **Curva de recebimento por cliente**: derivada, com override opcional.

### 3.3 Saídas

1. **DRE projetado 12 meses** na estrutura de `LINHAS_DRE`: realizado + projetado + orçado + desvio.
2. **Fluxo de caixa mensal 12 meses**: saldo conferido + entradas (contratos × curva, líquidas de retenção, + títulos lançados) − saídas (lançados + recorrentes projetados) = saldo; cobertura de caixa em meses de custo fixo; primeiro mês de ruptura; necessidade máxima de capital de giro.
3. **Orçado × realizado**: mensal e YTD por linha, por categoria e por contrato, com a tolerância configurada como farol.
4. **Sensibilidade**: driver × variação (−10%, +10%, +20%) → efeito em EBIT, resultado líquido e saldo mínimo de caixa.
5. **Metas do BSC derivadas** do cenário aprovado.

## 4. O que está bem feito

- `previsaoCaixa.ts` é puro, testado e separado da leitura do banco; a coluna "incerto" é a decisão certa.
- `competencia.ts:9-16`: critério de competência validado contra a declaração de faturamento da contabilidade.
- `historico.ts`: agregação no banco, recálculo idempotente, limpeza de órfãs, mediana + MAD com tratamento do MAD zero.
- `serieMensal.ts`: competência, caixa e faturamento fiscal lado a lado; mês sem movimento entra zerado.
- `dre.ts` / `dreNoBanco.ts`: uma única conta com duas colheitas e teste diferencial; DRE anual reusa a mensal.
- `unitEconomics.ts:23-26`: cobertura do rateio como número de primeira classe.
- `agents/contratos.ts:206-211` e `estrategiaCusto.ts:175-184`: reaproveitáveis de imediato por um módulo de cenários.
- `agents/custos.ts:83-94`: comparação "mesmo dia do mês".
- `agents/fluxoCaixa.ts:86-91`: PMR/PMP ponderados por valor.
- `bsc.ts:15-27`: fórmula em código, meta no banco, snapshot diário.

## 5. Ordem sugerida de implementação

1. Fechar a base histórica para projeção (A5).
2. Série mensal de drivers realizados (A7).
3. Receita contratada projetável (A3).
4. Fluxo de caixa 12 meses (A2, A4, A9).
5. Orçamento anual e orçado × realizado (A1, A8).
6. Cenários e sensibilidade (A11).
7. Metas do BSC por período derivadas do orçamento (A6, A10).
