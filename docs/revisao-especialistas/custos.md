# Parecer de especialista em custos — módulo de custos e rentabilidade

Revisão do sistema feita por um especialista de IA (Fable 5.1) no papel de especialista em custos de transporte, em 27/09/2026, somente leitura do código. Referências `arquivo:linha` apontam para o estado do repositório naquela data.

## 1. Resumo executivo

O sistema responde bem **"quanto gastamos, em que categoria, e o que parece anormal"** (DRE gerencial por competência, variação por categoria, antifraude de combustível) e é honesto sobre o que não sabe (cobertura do rateio, DRE "por classificar"). Mas **ainda não responde "quanto custa rodar"**: não existe custo por km, por veículo-dia, por hora de motorista, taxa de ocupação da frota nem ponto de equilíbrio em lugar nenhum — embora hodômetro, km de check-in/check-out, escala, ponto e preço ANP já sejam lidos da gestão. Responde **"onde cortar"** com baixa confiança: a classificação variável/fixo/descolado compara duas metades de uma série de 12 meses que, no ciclo diário, só tem dados completos do ano corrente (a janela do contexto é menor que a janela da análise), não normaliza metades de tamanhos diferentes, não depura financiamento/tributo/venda de ativo da base, e converte tudo em "economia anual" por percentuais fixos (20/8/5%). A margem por contrato tem dois defeitos de construção (mês parcial e combustível contado duas vezes no total) que hoje a tornam inutilizável mesmo com cobertura alta, enquanto a margem por OS — que já dá para calcular só com a Omie, sem nenhum vínculo — não é exibida. Em resumo: infraestrutura e postura estão certas; a camada de custeio propriamente dita ainda está por fazer, e as peças já estão na base.

## 2. Achados ranqueados

### A1. CRÍTICO — A série de 12 meses da estratégia é alimentada por um contexto que só carrega o ano corrente
- **Onde:** `estrategiaCusto.ts:109-120` (`janelaDeAnalise`: 12 meses até a referência) e `:122-145` (`seriesMensais` lê `ctx.titulos`); `contexto.ts:339-343` (`janelaDeAuditoria` = 1º de janeiro do ano corrente); `ciclo.ts:272`; `custos/page.tsx:85-87` (visão anual: `desde = 1/jan`); `escopoSql.ts:43-51`.
- **O que faz:** em setembro/2026 a análise monta out/25…set/26, mas out–dez/25 só contêm títulos ainda em aberto. `baseSuficiente` conta meses de calendário, não meses com dado.
- **Por que engana:** a primeira metade sai subestimada; `variacaoCusto` fica grande e positiva para tudo; `FIXO_ESTRUTURAL` fica praticamente inalcançável; o descolamento vira ruído. Em janeiro, a série tem 1–2 meses reais e o resto vazio.
- **O que mudar:** alimentar a análise pela série de `HistoricoMensal` (dimensão `CATEGORIA`), que existe para isso e tem anos; ou passar `desde = primeiroMes` ao carregar o contexto do ciclo e marcar `baseSuficiente` pelos meses **com dado**. Observação: a tela de Custos e DRE (visão mensal) já usa treze meses via `estrategiaCustoNoBanco.ts`; o problema está no ciclo diário (agente de oportunidades) e na visão anual.

### A2. CRÍTICO — Metades desiguais e mês parcial distorcem a medida de acoplamento
- **Onde:** `estrategiaCusto.ts:157-172` (`meio = floor(n/2)`, somas brutas), `:116-117` (o último mês vai só até a referência), `:39` (`MINIMO_MESES_ANALISE = 4`).
- **O que faz:** compara **somas**, não médias mensais. Com 5 meses: 2 vs 3 → um custo fixo aparece com +50%; com 9 meses: 4 vs 5 → +25%. O mês parcial encurta a segunda metade.
- **O que mudar:** dividir cada metade pelo seu número de meses; excluir o mês corrente (ou pró-ratear); exigir 6 meses (3×3) para classificar e 12 fechados para chamar de "fixo".

### A3. CRÍTICO — Base do Pareto e da receita sem depuração: financiamento, tributo e venda de ativo entram como "custo" e "receita"
- **Onde:** `estrategiaCusto.ts:126-142` (todos os títulos PAGAR/RECEBER), `:326-330`; as linhas que separariam isso já existem em `dre.ts:29-119` e as classificações confirmadas são carregadas na mesma página (`custos/page.tsx:103-106`) mas não chegam à análise.
- **Por que engana:** parcela de consórcio/financiamento tende a ser uma das maiores categorias e será rotulada "estrutura — renegociar"; ISS/PIS/COFINS e IRPJ presumido ocupam vaga nos "primeiros 80%"; venda de veículo e resgate de consórcio inflam a "receita".
- **O que mudar:** filtrar a série pelas linhas operacionais do DRE e usar `RECEITA_BRUTA` como receita; mostrar financiamento/tributos à parte como "não negociáveis por corte". `CATEGORIA_NAO_NEGOCIAVEL` de `oportunidades.ts:198-199` já é uma lista pronta.

### A4. CRÍTICO — Combustível contado duas vezes no total de custo por contrato/veículo e na cobertura
- **Onde:** `unitEconomics.ts:143-148` (todos os títulos PAGAR, inclusive a fatura do cartão de frota), `:176-188` e `:248-256` (soma de novo cada transação do extrato), `:384-391`; consumidores: `bsc.ts:219-234`, `:322-336`, `agents/rentabilidade.ts:41-68`, `rentabilidade/page.tsx:99`. O sistema sabe que os dois lados coexistem: `agents/custos.ts:279-329` (`CU-COMBUSTIVEL`).
- **O que mudar:** tratar o extrato do cartão como **chave de rateio** da fatura da Omie, não como custo adicional. Enquanto isso não existir, excluir do total os títulos de categorias de combustível quando há extrato no período, e dizer isso na tela.

### A5. CRÍTICO — Margem por contrato apurada sobre mês parcial, com receita praticamente inalcançável
- **Onde:** `agents/rentabilidade.ts:27-33` (1º do mês até D-1) e `rentabilidade/page.tsx:31-32`; receita só entra por vínculo (`unitEconomics.ts:164-170`); a UI só oferece DEPARTAMENTO, CATEGORIA e TEXTO como origem (`rentabilidade/page.tsx:42-50`), embora a ação aceite PROJETO e PARCEIRO.
- **Por que engana:** contrato de fretamento fatura uma vez por mês e incorre custo todos os dias; até o dia do faturamento todo contrato tem margem negativa. Título a receber raramente carrega departamento.
- **O que mudar:** apurar sobre o **último mês fechado** (ou trimestre móvel); expor origem PARCEIRO e PROJETO na UI; derivar a receita do contrato do parceiro do título a receber e do `contratoCodigo`.

### A6. IMPORTANTE — O vínculo de centro de custo ignora a conexão: código da Azul casa com código da MCZ
- **Onde:** `schema.prisma` (`OmieVinculoCentroCusto.conexaoId` opcional); `rentabilidade/actions.ts:90-102` nunca grava `conexaoId`; `unitEconomics.ts:94-96` casa só `tipoOrigem` + `valorOrigem`; `OmieDepartamento` é `@@unique([conexaoId, codigo])`.
- **O que mudar:** gravar `conexaoId` no vínculo e filtrar `v.conexaoId === null || v.conexaoId === titulo.conexaoId` em `resolverDestinos`.

### A7. IMPORTANTE — "Economia anual" por percentuais fixos, quando o dado para medi-la já existe
- **Onde:** `estrategiaCusto.ts:81-86` (20% / 8% / 5%), `:243`; `oportunidades.ts:148, 183, 261`; `custos.ts:211, 359`.
- **O que mudar:** DESACOPLADO → economia = excesso medido (`custoDepois − custoAntes × (1 + variacaoReceita)`), anualizado; FIXO/VARIAVEL → rotular como "cenário de X%" com o percentual visível e configurável.

### A8. IMPORTANTE — O limiar de 10 p.p. não separa sazonalidade nem efeito-preço
- **Onde:** `estrategiaCusto.ts:177-183`; o sistema reconhece a sazonalidade escolar (`dre.ts:484-491`) e tem litros e preço ANP.
- **O que mudar:** comparar ano contra ano quando houver `HistoricoMensal`; para combustível, decompor variação em preço × volume antes de classificar; tolerância proporcional à dispersão da série (mediana + k·MAD, como `pessoal.ts:538-544`).

### A9. IMPORTANTE — Agente de custos ainda trabalha por vencimento e compara meses errados no combustível
- **Onde:** `agents/custos.ts:52-59` (por `dataVencimento`), `:280-299` (`CU-COMBUSTIVEL`: Omie por vencimento vs cartão por `dataHora` no mesmo mês; identificação por regex).
- **Por que engana:** a fatura do cartão vence no mês seguinte ao consumo, então a regra compara o extrato de setembro com a fatura de agosto; e o "custo do mês" dos achados não bate com o DRE da tela, que é por emissão.
- **O que mudar:** usar `dataDeCompetencia`; em `CU-COMBUSTIVEL`, casar extrato do mês M com título emitido em M ou M+1 do parceiro-administradora.

### A10. IMPORTANTE — Não existe custo por km, embora o km seja lido
- **Onde:** `leitura.ts:79,89,103-104,57`; único uso de km é anomalia de consumo em `frota.ts:297-382`; a gestão tem `FuelConsumptionSummary` (`kmRodados`, `kmPorLitro`, contrato por veículo) não lida.
- **O que mudar:** km/veículo/mês = Σ(kmFinal − kmInicial) do uso de veículo (fallback: Δ hodômetro); daí R$/km de combustível, L/100 km, R$/km total alocado.

### A11. IMPORTANTE — Só há alocação direta; sem rateio de indiretos a cobertura-alvo é inalcançável
- **Onde:** `unitEconomics.ts:70-118`, `:159-161`, `:280-283`; metas 70% (`rentabilidade.ts:16`) e 85% (`bsc.ts:225`).
- **O que mudar:** rateio em dois estágios com chave declarada (veículo-dia por contrato via escala, horas de ponto por motorista, km por contrato), com a coluna `origens` distinguindo "direto" de "rateado", e cobertura em dois números.

### A12. IMPORTANTE — Margem por OS já é calculável só com a Omie e não aparece em tela nenhuma
- **Onde:** `agents/contasReceber.ts:697-770` (`CR-OS-NAO-FATURADA` agrupa PAGAR e RECEBER por `projetoCodigo`); `OmieTitulo.projetoCodigo/contratoCodigo/ordemServicoCodigo`; `OmieContrato.valorMensalCents`.
- **O que mudar:** seção "Por OS (projeto)" e "Por contrato Omie" na tela de rentabilidade; agregação por cliente Omie dá margem por cliente sem passar pelo cadastro da gestão.

### A13. MELHORIA — Preço ANP usado só para calar achado, não para medir sobrepreço
- **Onde:** `frota.ts:664-670`, `:694-696`.
- **O que falta:** KPI "prêmio médio pago sobre a ANP" por mês/UF/produto, sem os filtros de fraude.

### A14. MELHORIA — Ponto de equilíbrio e ociosidade da frota: ausentes, com dado para ambos
- **O que construir:** PE em R$ = custos fixos ÷ (1 − variáveis/receita líquida) sobre 3 meses fechados; taxa de utilização = veículo-dias com uso ÷ disponíveis; veículos ATIVO sem escala nem uso em ≥ N dias com o custo fixo que carregam.

### A15. MELHORIA — Combustível alocado pelo cliente cadastral do motorista, não pela operação do dia
- **Onde:** `unitEconomics.ts:172-188` (`Driver.clienteId` estático).
- **O que mudar:** precedência: escala do dia → cliente do motorista escalado; depois `Driver.clienteId`; depois `FuelConsumptionSummary.contrato`.

## 3. O que dá para construir com os dados que JÁ existem

| Indicador / tela | Fonte de dado |
|---|---|
| Margem por OS (projeto) | `OmieTitulo.projetoCodigo` + `natureza` + `OmieProjeto` |
| Receita faturada vs contratada por contrato Omie; margem por cliente Omie | `OmieContrato`, `OmieTitulo.contratoCodigo/parceiroCodigo` |
| Km por veículo/mês e por modelo | uso de veículo (`kmInicial/kmFinal`); Δ hodômetro |
| R$/km e L/100 km de combustível por veículo, modelo e contrato | abastecimentos + km acima; contrato via escala → cliente do motorista |
| Preço médio pago por produto/posto/mês e prêmio sobre ANP | abastecimentos + preço ANP |
| Taxa de utilização e ociosidade da frota | escala, uso de veículo, status do veículo |
| Veículos-dia e horas de motorista por contrato (chaves de rateio) | escala, ponto, cliente do motorista |
| Custo de hora de motorista por contrato | `valorHoraCents` + ponto |
| Série de custo por categoria de 12 a 60 meses | `HistoricoMensal` (CATEGORIA) |
| Custo fixo vs variável e ponto de equilíbrio | DRE por linha + `DreClassificacao` + marca fixo/variável por categoria |
| Rateio do título do cartão de frota por veículo/motorista | fatura Omie × extrato do período |

**Exige dado novo:** folha analítica por funcionário; pedágio por placa; manutenção por placa como regra de lançamento; valor de aquisição/residual do veículo; CNPJ no cliente da gestão (ou vínculo PARCEIRO na UI); telemetria; passageiros/viagens; tarifa contratual por km/hora.

## 4. O que está bem feito

- Cobertura como número de primeira classe e recusa de publicar ranking abaixo de 70% (`unitEconomics.ts:22-26,44-46`, `agents/rentabilidade.ts:43-68`).
- Só vínculo confirmado move dinheiro; percentual que não fecha vira "não alocado".
- Competência por emissão decidida com evidência numérica (`competencia.ts:5-16`).
- DRE com linhas próprias para veículos, pessoas, estrutura, informática e financiamento; proposta automática conservadora; retenções mostradas sem somar.
- Materialidade relativa ao porte (`agents/comum.ts:44-68`).
- Antifraude de combustível calibrado com estatística robusta (`frota.ts:270-279,686-690,412-427`).
- Teste diferencial memória × SQL para DRE, ranking e estratégia (`scripts/teste-dre-banco.ts`).
- Explicabilidade sobre correlação (`estrategiaCusto.ts:147-151`).
- `CATEGORIA_NAO_NEGOCIAVEL` e `FATIA_JA_CONSOLIDADA` nascidos de evidência real (`oportunidades.ts:194-204`).
- OS = projeto, com carência de 30 dias antes de acusar (`contasReceber.ts:690-695`).

## 5. Ordem sugerida de implementação

1. Corrigir a base da estratégia (A1, A2, A3).
2. Tirar o combustível em dobro e fechar o mês (A4, A5); `conexaoId` no vínculo (A6).
3. Publicar margem por OS e por contrato Omie (A12).
4. Custo por km e utilização da frota (A10, A14-ociosidade).
5. Rateio de indiretos com chave declarada (A11, A15).
6. Economia estimada honesta e limiares adaptativos (A7, A8).
7. Alinhar o agente de custos à competência e consertar `CU-COMBUSTIVEL` (A9).
8. Ponto de equilíbrio e prêmio sobre ANP (A13, A14-PE).
