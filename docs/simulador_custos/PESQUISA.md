# Pesquisa — Simulador de Custos e Orçamento para Transporte de Passageiros

> Pesquisa de referência para o módulo genérico de simulação de custos e formação de preços (fretamento contínuo/eventual, escolar, transporte de pacientes, locação com e sem motorista; SP e PR).
> Data da pesquisa: 30/09/2026. Nenhum código foi alterado. Este documento não contém dados pessoais nem credenciais.

## Legenda de confiabilidade

| Marca | Significado |
|---|---|
| **[V]** | Verificado **no texto** de fonte primária (lei, norma, manual oficial, edital, tabela oficial) lido nesta pesquisa |
| **[V-s]** | Conteúdo de fonte primária obtido por meio de transcrição ou resumo secundário (a fonte original não foi aberta na íntegra) |
| **[S]** | Fonte secundária (imprensa, consultoria, blog, fórum) |
| **[D]** | Derivação ou proposta própria, feita a partir das fontes. É uma conta nossa, não um número de fonte |
| **[NV]** | Não verificado: o valor precisa ser confirmado antes de entrar como padrão no motor |

Os números abaixo são **referências**. O motor deve tratar todos como parâmetros editáveis, com fonte e data de vigência.

---

## 0. Resumo executivo — o que um simulador completo precisa suportar

- **Dois métodos de custo variável, lado a lado.** (a) *Medido*: km/l, R$/km reais da telemetria e da oficina. (b) *Paramétrico GEIPOT/ANTP*: coeficientes de consumo de combustível (l/km); lubrificantes como fração do preço do diesel; ARLA como 3–5% do volume de diesel; rodagem = (pneus + recapagens)/vida útil; peças como % anual do preço do veículo novo, por faixa etária. O modo (b) serve para licitações e para validar o (a). [V]
- **Depreciação por vários métodos.** Linear, **Cole/soma dos dígitos** (padrão GEIPOT/ANTP), curva de mercado FIPE (regressão por idade, modelo TCE-PE) e anuidade (fator de recuperação de capital). Todos com **valor residual**, **vida útil por tipo de veículo** e **idade inicial** para veículo usado. [V]
- **Remuneração do capital sobre o valor não depreciado**, não sobre o valor cheio. Taxa selecionável: 12% a.a. (GEIPOT); Selic média de 24 meses − ½ IPCA (ANTP 2017); TLP; ou custo ponderado capital próprio/dívida. Nunca somar a parcela do financiamento (amortização + juros) *além* de depreciação + remuneração, porque seria dupla contagem. [V]/[D]
- **Mão de obra por Fator de Utilização (FU)** derivado da jornada (5x2, 6x1, 12x36, dupla pegada) e da duração da operação, com reserva para folgas, férias e faltas. O **calculador de encargos por grupos (A/B/C/D)** precisa ser coerente com o FU: se o FU já cobre férias e folgas, o Grupo B não as repete. [V]
- **Presets de regime tributário e de serviço.** Simples Anexo III, Presumido e Real. ISS (serviço municipal), ICMS (intermunicipal), locação sem motorista (sem ISS). PIS/COFINS **cumulativos mesmo no Lucro Real** para transporte coletivo, **inclusive fretamento**. Desoneração (CPRB) **só para CNAE 4921/4922**: fretamento, escolar e locação **não** têm CPRB. [V]
- **Estruturas de preço.** Tarifa binômia (R$/veículo-mês + R$/km); R$/km com **franquia + km excedente**; **diária com km livres** (e até franquia de litros); **hora à disposição/hora parada**; por viagem; por passageiro/aluno. Com ou sem motorista; combustível pago pela contratada ou pelo cliente. [V]
- **BDI/markup divisor explícito.** Fórmula TCU (Acórdão 2622/2013), com alerta de **dupla incidência**: Módulo 6 da IN 5/2017 somado a um BDI geral. Em licitação, IRPJ/CSLL entram dentro do lucro (Súmula TCU 254), não como despesa indireta. [V]
- **Parâmetros operacionais.** km produtivo × km morto (teto de referência de 5%); frota reserva (10% como referência); split asfalto/terra (consumo, pneus e peças diferentes); calendário (dias úteis, sábados, domingos); **sazonalidade escolar** (12 meses de fixo × 10 meses de variável). [V]
- **Linha do tempo tributária.** Reoneração da folha (2025–2027); ajuste LC 224/2025 no presumido (+10% na presunção acima de R$ 5 mi/ano); crédito outorgado de ICMS/SP de 20% válido até 31/12/2026; Reforma Tributária (CBS/IBS de 2026 a 2033, ICMS/ISS em extinção de 2029 a 2032, redutor nas compras governamentais). Fretamento vai para o **regime regular** do IBS/CBS, sem redução. [V]
- **Análises.** Cenários de utilização, ponto de equilíbrio em km e em horas, custo marginal para viagem eventual com frota ociosa, sensibilidade (diesel, piso salarial, Selic) e fórmula paramétrica de reajuste (pesos no estilo ANTT). [V]/[D]

---

## 1. Metodologias de referência: GEIPOT, ANTP 2017 e ANTT

### 1.1 GEIPOT — "Cálculo de tarifas de ônibus urbanos: instruções práticas atualizadas" (1982/1996; coeficientes de 1993)

Estrutura (manual GEIPOT, reproduzido na atualização da AGER-MT de 2018 e em fontes secundárias) [V]:

- **Custo Total** = Custo Variável (R$/km) + Custo Fixo (R$/veículo-mês), acrescido dos tributos sobre a receita. [V] (AGER-MT)
- **Tarifa**: `T = CT / P` (P = passageiros pagantes equivalentes). No nosso caso, P é trocado por km, veículo-mês, hora ou diária. [V]
- **Tributos por dentro**: `CT = (CV + CF) / (1 − T/100)`, com T = soma das alíquotas sobre a receita. [V]

**Custo variável (R$/km)**

| Item | Fórmula GEIPOT | Coeficientes originais (1993/96) | Status |
|---|---|---|---|
| Combustível | preço do litro × coef. (l/km) | Leve 0,35–0,39; Pesado 0,45–0,50; Especial 0,53–0,65 l/km; **+10% se trechos não pavimentados > 20%** | [V-s] viacircular; AGER mediu 0,4091 l/km (pesado, 2018) [V] |
| Lubrificantes | preço do diesel × coef. ("consumo equivalente em diesel") | 0,04–0,06 l/km | [V-s]; AGER-MT adota 0,0263 [V]; FNDE repete 0,04–0,06 [V] |
| Rodagem | (pneus + recapagens) / vida útil total (km) | Radial: 2,0–3,0 recapagens, vida de 85.000–125.000 km; Diagonal: 2,5–3,5 recapagens, 70.000–92.000 km | [V-s]; FNDE confirma o radial [V]; AGER: 1 recapagem, 172.822 km [V] |
| Peças e acessórios | coef. mensal × preço do veículo novo ÷ PMM (percurso médio mensal) | 0,0033–0,0083 (fração do preço por mês) | [V-s]; FNDE 0,0033–0,0083 [V]; AGER 0,0041 [V] |

**Custo fixo (R$/veículo-mês)**

- **Depreciação — Método de Cole (soma dos dígitos decrescentes)** [V] (AGER-MT; FNDE):
  `F_j = (VU − j + 1) / (1 + 2 + … + VU) × (1 − VR/100)`
  Vida útil e valor residual do GEIPOT: **Leve 7 anos / 20%; Pesado 10 anos / 15%; Especial 12 anos / 10%** [V] (FNDE Módulo 6, Tabela 3, citando GEIPOT 1996). A AGER-MT adotou 7 anos / 15% para pesado [V]. A base é o preço do veículo novo **sem pneus**.
- **Depreciação de máquinas, instalações e equipamentos**: preço do veículo leve novo × 0,0001 por mês. [V]
- **Remuneração do capital**: **12% a.a.** sobre o valor do veículo novo sem pneus, **deduzida a parcela já depreciada**. Almoxarifado = 3% do preço do veículo × 12%/12 → **0,0003** × preço por mês. Instalações e equipamentos = 4% × 12%/12 → **0,0004** × preço por mês. [V]
- **Pessoal de operação**: `PO = (SB_mot×FU_mot + SB_cob×FU_cob + SB_desp×FU_desp) × (1 + ES/100)` [V]
  - FU de referência GEIPOT: motorista 2,20–2,80; cobrador 2,20–2,80; fiscal/despachante 0,20–0,50. [V-s]
  - Pessoal de manutenção = 12%–15% da despesa com pessoal de operação; administrativo = 8%–13%. [V-s]; FNDE confirma 12–15% para manutenção [V]
  - **Benefícios** (VR/VA, cesta, uniforme, convênio) **não sofrem encargos nem adicional de HE**: são somados à parte. [V]
  - Pró-labore da diretoria sem encargos, rateado pela frota. [V]
- **Despesas administrativas**: despesas gerais = 2%–4% a.a. do preço do veículo leve → coeficiente mensal 0,0017–0,0033 (média 0,0025 × preço × frota total). Somam-se seguro obrigatório, licenciamento, IPVA e RC (RCF/APP/DMH), cada um ÷ 12. [V]

**Fator de Utilização (FU) de motoristas — procedimento GEIPOT** [V] (AGER-MT, Anexo II):
1. Monta-se o perfil horário da frota em operação (dias úteis, sábados, domingos). Conta o veículo que opera ≥ 30 min na faixa.
2. **Duração equivalente de operação** (A) = Σ(% da frota operante por faixa)/100.
3. **Coeficiente em horas normais** C = A / B, sendo B a jornada diária contratual. Em operação normal, C ≈ 2.
4. Se C > 2, o excedente é hora extra: soma-se com adicional de 50%.
5. Acréscimos em % sobre o coeficiente:
   - **Folgas**: ex.: (52/365)×20% = 2,85% + feriados (12/365)×50% = 1,64% → 4,49%
   - **Férias**: `FE = (1/12)/(1 − 1/12) = 1/11 = 9,09%` (progressão geométrica: substitutos também tiram férias)
   - **Reserva** (doença, 15 dias pagos pela empresa × 12% dos empregados = 0,49%; faltas, 5 dias/ano = 1,37%) → 1,86%
   - Total do exemplo: **15,44%**.
6. FU = C + C × 15,44%.

**Encargos sociais (GEIPOT, Anexo III)**: Grupo A 36,80%; B 13,53%; C 7,56%; D 4,98%; **total 62,87%** (valores originais, [V-s]). Na versão AGER-MT 2018, desonerada (sem INSS patronal): A 18,30%; B 13,53%; C 8,47%; D 2,48%; **total 42,78%** [V].

**Parâmetros operacionais úteis (AGER-MT 2018)** [V]:
- **Quilometragem morta** (garagem ↔ início/fim de linha) limitada a **5% da km produtiva**.
- Base de cálculo: média dos últimos 12 meses.
- **Frota reserva = 10% da frota operante** (exigência de lei complementar estadual do MT; serve de referência).
- Depreciação, remuneração e despesas administrativas multiplicam-se pela **frota total**; pessoal, pela **frota operante**.

### 1.2 ANTP 2017 — "Custos dos serviços de transporte público por ônibus: método de cálculo" (ANTP/FNP/NTU)

Substitui o GEIPOT, mantendo a mesma lógica com mais itens [V] (ANTP 2017, 191 p.):

`CT = (CV + CF + RPS) / (1 − ATR)`
CV = combustível + lubrificantes + ARLA 32 + rodagem + peças + custos ambientais; CF = depreciação + remuneração do capital + pessoal + administrativas + locações (bilhetagem/ITS, garagem, veículos de apoio); RPS = γ × (CV + CF) = remuneração pela prestação do serviço (markup de risco); ATR = soma das alíquotas dos tributos diretos. [V]

**Coeficientes de referência ANTP** [V]:

| Item | Valor de referência |
|---|---|
| Combustível (l/km), sem ar-condicionado e sem câmbio automático | Micro 0,24–0,29; Mini 0,30–0,34; Midi 0,34–0,38; **Básico 0,37–0,45**; Padron 0,45–0,65; Articulado 0,65–0,85; Biarticulado 0,86–0,95 |
| Lubrificantes: coef. j (l-eq diesel/km) | 0,0240–0,0290 (estudo de 24 meses com OF-1721, preços de 2013) |
| ARLA 32 | **3%–5% do consumo de diesel** (litros de ARLA por litro de diesel) |
| Pneus | 2–3 recapagens; vida de 85.000–125.000 km; 6 pneus (micro a padron), 10 (articulado), 14 (biarticulado) |
| Peças e acessórios, por faixa etária (% do preço do ônibus básico novo) | 0–2 anos 6%; 2–4 anos 7%; 4–6 anos 8%; 6–8 anos 9%; 8–10 anos 10%; > 10 anos 12% |
| Vida útil / valor residual | Micro e Mini 5 anos / 15%; Midi e Básico 8 / 10%; Padron 10 / 10%; Articulado 12 / 5%; Biarticulado 15 / 5%; veículos de apoio: automóvel 5 / 20%, caminhonete 8 / 15%, caminhão-oficina 15 / 10% |
| Edificações / equipamentos de garagem | 25 anos / 10%; 10 anos / 0% |
| Bilhetagem e ITS | vida de 5 anos; investimento de 4% do ônibus básico; residual 0% |

> Observação: o texto da Equação 2.12 fala em "coeficiente de consumo **anual**" de peças e a tabela A.VII.2 em "mensal". A ordem de grandeza (6–12%) é compatível com o GEIPOT **mensal** 0,33–0,83%, ou seja, 4–10% a.a. Portanto **tratar como % a.a.** [D].

**Depreciação (Cole) — coeficientes anuais publicados (Tabela A.IX.2)** [V]:

| Faixa etária | Micro/Mini (5a, 15%) | Midi/Básico (8a, 10%) | Padron (10a, 10%) |
|---|---|---|---|
| 0–1 | 0,28333 | 0,20000 | 0,16364 |
| 1–2 | 0,22667 | 0,17500 | 0,14727 |
| 2–3 | 0,17000 | 0,15000 | 0,13091 |
| 3–4 | 0,11333 | 0,12500 | 0,11455 |
| 4–5 | 0,05667 | 0,10000 | 0,09818 |
| 5–6 | 0 | 0,07500 | 0,08182 |
| 6–7 | — | 0,05000 | 0,06545 |
| 7–8 | — | 0,02500 | 0,04909 |

**Remuneração do capital (Tabela A.X.1)** [V]: o coeficiente `k_t` é a fração **ainda não depreciada** no início do ano t, ou seja, `k_t = 1 − Σ_{i<t} F_i`. Exemplo para micro: 1,000; 0,717; 0,490; 0,320; 0,207; e 0,15 (= VR) após a vida útil. Mensal: `RVE = Σ k_t × TRC × VEC / 12`, com VEC = preço do veículo novo.

**Taxa de Remuneração de Capital (TRC)** [V]: **Selic média dos últimos ≥ 24 meses, excluída metade do IPCA médio do mesmo período**, fixada no contrato ou na licitação. Almoxarifado: remunera E meses de consumo de peças (`RAL = TRC × E × CPA`).

**Pessoal** [V]:
- FU por posto.
- **Benefícios multiplicam pelo FU "físico"** (pessoas), não pelo FU com HE.
- Pessoal de manutenção, administração e diretoria como % θ sobre o pessoal de operação, por porte: θ de 24–64% nas faixas calculadas, **valores de mercado de 20–28%** (Tabela A.XIII.9).
- **Tabela A.XII.5 — FU de referência** por duração equivalente da operação (dia útil) × jornada contratual:

| Duração equivalente | Jornada 6:00 | 6:40 | 7:20 | 7:40 | 8:00 |
|---|---|---|---|---|---|
| 12:00 | 2,34 | 2,11 | 1,92 | 1,83 | 1,76 |
| 14:00 | 3,02 | 2,54 | 2,24 | 2,14 | 2,05 |
| 16:00 | 3,71 | 3,16 | 2,72 | 2,52 | 2,34 |
| 18:00 | 4,39 | 3,77 | 3,28 | 3,05 | 2,85 |
| 20:00 | 5,07 | 4,39 | 3,83 | 3,59 | 3,37 |

**Encargos ANTP** [V]:
- **Grupo A** = 16,80% (INSS 0% por causa da CPRB; SEST 1,50; SENAT 1,00; SEBRAE 0,60; INCRA 0,20; salário-educação 2,50; acidente de trabalho 3,00; FGTS 8,00).
- **Grupo B** = 13,49% (abono de férias 2,78; 13º 8,33; aviso trabalhado 0,07; licenças 0,07; adicional noturno 2,24). **RSR, férias e feriados foram excluídos porque o FU já os cobre.**
- **Grupo C** = 9,43% (aviso indenizado 4,56; depósito rescisório 4,54; indenização adicional 0,33).
- **Grupo D** = A × B = 2,27%.
- **Total 41,99%.**

Fórmulas paramétricas úteis no motor:
- Aviso indenizado = `p·R·T/30`
- Depósito rescisório = `0,08·(1+B)·0,5`
- Indenização adicional = `R/12`
- Adicional noturno = `(U·u + S·s + D·d)/H/0,875 × a`

**Sem desoneração**, o Grupo A volta a 36,80%, e o total fica em ≈ 64,7% [D].

**RPS (margem de risco) γ** [V]: matriz de 10 dimensões de risco → **baixo 5,02%; médio 7,31%; alto 12,00%**, aplicados sobre CV + CF (markup multiplicador).

**Tributos (ANTP)** [V]: ISS municipal; PIS 0,65% e COFINS 3,00% (zero para transporte público municipal/metropolitano, Lei 12.860/2013); taxa de gerenciamento; CPRB de 2% (à época); ICMS no intermunicipal.

**Aplicações recentes**: Manaus (IMMU, metodologia de junho/2025) usa GEIPOT/ANTP. Lubrificante no mínimo GEIPOT (0,04); FU pelo perfil horário; **encargos de 47,66%** com INSS substituído por 1,6% do faturamento (CPRB 2025); despesas de diretoria = 10 salários mínimos ÷ frota operante. [V]

### 1.3 ANTT — transporte rodoviário interestadual

- Resolução ANTT 18/2002 criou a planilha tarifária, com coeficientes básicos de combustível (CBCC), óleo/lubrificantes (CBCOL), rodagem (CBCR), pessoal de operação (CBPO), administração/vendas (CBPAV), manutenção (CBPM), depreciação (CBDV) e remuneração (CBRV). [V-s]
- Reajuste anual por **fórmula paramétrica** (Resolução ANTT 2.130/2007, semiurbano). **Pesos** [V-s, legisweb]:
  - Diesel 0,329990 (ANP)
  - Lubrificantes 0,007241 (IPA)
  - Pneus 0,040918 (IPA)
  - **Pessoal 0,386975 (INPC)**
  - Peças 0,070212 (IPA)
  - Veículos 0,112203 (IPA Ônibus)
  - Despesas gerais 0,052461 (IPCA)
- O reajuste 2026 (RIDE-DF) ficou em 2,546%; o voto registra peso do diesel ≈ 33% e variação de −0,332% no diesel em 2025. [V] (Voto DAA 004/2026)
- **Uso no motor**: uma fórmula de reajuste com pesos derivados da própria planilha, útil para cláusula de reajuste e simulação de repactuação.

---

## 2. Modelos usados em licitações

### 2.1 IN SEGES/MP nº 5/2017, Anexo VII-D (serviços com dedicação exclusiva de mão de obra)

Estrutura modular [V] (gov.br/Compras):
1. **Módulo 1 — Remuneração**: salário-base (piso da CCT), adicionais (noturno, HE habitual, periculosidade etc.).
2. **Módulo 2 — Encargos e benefícios**:
   - 2.1 13º, férias e adicional de férias
   - 2.2 GPS, FGTS e outras contribuições (INSS, salário-educação, SAT/RAT×FAP, Sistema S, INCRA, SEBRAE, FGTS)
   - 2.3 benefícios mensais e diários (VT, VA/VR, assistência médica, seguro de vida)
3. **Módulo 3 — Provisão para rescisão**: aviso indenizado e trabalhado, com incidência de FGTS; multa do FGTS de 40% mais a contribuição social de 10% da LC 110/2001, citada no material.
4. **Módulo 4 — Reposição do profissional ausente**: férias, licenças (paternidade de 20 dias no Empresa Cidadã; maternidade de 180 dias), acidente de trabalho (15 dias), faltas legais (art. 473 da CLT), intrajornada.
5. **Módulo 5 — Insumos**: uniformes, EPI, materiais, equipamentos.
6. **Módulo 6 — Custos indiretos, tributos e lucro**. Custos indiretos = % sobre (M1..M5). Lucro = % sobre o faturamento (na prática, % sobre a base + CI). **Tributos por dentro**: `tributo = base/(1 − ΣT) × T`.

Orientações do material gov.br [V]:
- **IRPJ/CSLL não integram a planilha como custo** (Acórdãos 1.319/2010-2ªC, 1.696/2010-2ªC, 1.442/2010-2ªC e 1.597/2010-P). Súmula TCU 254 (ver 2.6).
- Valores-limite SEGES para vigilância e limpeza, como **ordem de grandeza** de CITL:
  - Custos indiretos 2–6%
  - Lucro 3,90%–6,79% (estudo FIA)
  - Tributos cumulativos 8,65% (PIS 0,65 + COFINS 3,00 + ISS 5,00)
  - CITL total entre 16% e 30%
- **Para locação de veículos com motorista**, o preenchimento da planilha é obrigatório quando a unidade de medida é a remuneração do posto [S], com referência ao Acórdão TCU 3.393/2012 [NV].

**Exemplo real (Maceió, transporte escolar, 2025)** [V]: tarifa binômia com mão de obra em módulos.
- Motorista de ônibus: R$ 3.000,00 → M2 R$ 1.867,33 (≈ 62,2%), M3 R$ 198,36 (≈ 6,6%), M6 R$ 1.742,72.
- Veículo fixo: depreciação, IPVA, seguros, rastreador/tacógrafo.
- Variável de R$ 0,978/km (combustível 0,60; ARLA 0,20; peças 0,083; pneus 0,03; óleo 0,06; lavagem 0,005).
- **BDI de 25% aplicado sobre tudo, inclusive a mão de obra que já tem Módulo 6**, o que configura **dupla incidência** de custos indiretos, tributos e lucro. Também chama atenção o ARLA de 1/3 do combustível, desproporcional ao padrão ANTP de 3–5%. Os dois pontos devem ser **alertas automáticos** no motor.

### 2.2 Caderno de Logística — Prestação de Serviços de Transporte (SEGES)

Unidades de medida e modelos de preço [V]:
- **Postos de trabalho** (só motorista), de uso excepcional. Diárias de viagem do motorista entram com LDI e tributos por dentro: exemplo de diária de R$ 100 + CI 5% + lucro 10% ÷ (1 − 8,65%) = R$ 125,89.
- **Km rodado com franquia + excedente**: `Valor mensal = Franquia_km × Preço_km_franquia + Km_excedente × Preço_km_excedente`. No exemplo, o preço do km excedente é **menor** que o da franquia (R$ 3,00 contra R$ 5,00, e R$ 2,00 contra R$ 4,00), porque o custo fixo está todo alocado na franquia.
- **Diária com X km livres + km excedente**: ex.: van com diária de R$ 419,33 e km excedente a R$ 2,20; ônibus com R$ 768,92 e R$ 4,30 (valores fictícios).
- **Locação sem motorista e sem combustível, com quilometragem livre**.
- **Reajuste por INPC**, com interregno anual.

### 2.3 Transporte escolar — FNDE/CEFTRU e TCE-PE (usado no PR)

**FNDE (Caminho da Escola/PNATE; metodologia FNDE/CEFTRU 2008)** [V]:
- **Custo anual = 12 × Custos fixos + 10 × Custos variáveis**: os fixos correm o ano todo e os variáveis só nos ~10 meses letivos. No rodoviário, `C_TER = (12·Cfk + 10·Cv) × Km`.
- Custo fixo = depreciação (**soma dos dígitos**, VU/VR do GEIPOT) + remuneração do capital (fórmula por idade com TRC = TLP ou Selic) + pessoal (motorista × coef. de utilização = nº motoristas/nº veículos; manutenção = 12–15% do custo do motorista; monitor) + administrativos (IPVA, licenciamento, seguros).
- Custo variável = combustível (coef. l/km × preço) + lubrificantes (0,04–0,06 l-eq/km × preço do diesel) + rodagem + peças (0,0033–0,0083 × preço ÷ PMM).
- **Veículo-tipo**: composição ponderada da frota.
- Embarcações: depreciação linear com residual de 10% e 15 anos; seguro de 4,2% a.a.; e **FRC** `= i(1+i)^n/((1+i)^n − 1)` para remuneração. *Atenção:* o módulo soma depreciação linear **e** CRC via FRC. Como o FRC já embute a recuperação do capital, **no motor usar um ou outro**. [D]

**Metodologia TCE-PE (Grupo de Trabalho Intersetorial), adotada por municípios do PR** (exemplo: Capanema/PR, rota com van Sprinter 515/2013) [V]:
- **Custos separados para via pavimentada e não pavimentada**:
  - autonomia 9,00 contra 6,92 km/l (−23%)
  - vida do pneu 40.000 contra 30.769 km (−23%)
  - peças 0,29 contra 0,38 R$/km (+30%)
  - lubrificantes 0,025 contra 0,033 R$/km
- **Peças por km** = coeficiente por idade × preço do veículo. Ex.: 7,69×10⁻⁷ × preço/km de 0 a 2 anos, subindo até 1,54×10⁻⁶ após 11 anos.
- **Depreciação por curva de mercado** (regressão `Y = a + b/X + c/X² + d/X³` sobre valores FIPE por idade, por tipo de veículo). Remuneração do capital pela **TLP** (5,56% pré-fixada no exemplo).
- **Lavagem** a cada 1.000 km; rastreador mensal; tacógrafo (aferição bienal ÷ 24); adesivagem amortizada em 24 meses; **reserva técnica** apropriada no custo fixo.
- **BDI de 17,44%**: despesas indiretas 4,41%; **risco de 5% (terra) / 3% (asfalto)**; lucro 5%; tributos 6,65% (ISS 3% + PIS/COFINS 3,65%).
- **Encargos de 59,59%**: A 36,80; B 2,52 (férias 0%); C 11,43; D 3,71; F (A × (B+C)) 5,13. Benefício da CCT à parte (auxílio-alimentação de R$ 664).
- Contrato de 11 meses (200 dias letivos). **Deflator k** = lance vencedor ÷ estimativa, aplicado mensalmente sobre o custo recalculado (diesel ANP e piso da CCT). **Desconto de 15%** para veículos com mais de 15 anos. Remuneração variável pelo uso efetivo do ar-condicionado.

### 2.4 Fretamento, locação com motorista e diárias — editais recentes

- **ALEAC, PE SRP 005/2025**: fretamento de ônibus DD, executivo, micro e van "com motorista e combustível, sob regime de quilômetro rodado e diárias". O preço por km inclui tributos, taxa de administração, encargos, seguro, **pernoite/alojamento do motorista e combustível**. Item "Van por diária" **com franquia de 50 litros de combustível**. [V]
- **Fomento Paraná, PP 01/2018**: locação de veículos com **combustível por conta da contratante** e **franquia de km livre**; motoristas por posto, com **HE até 2 h/dia** e **diárias de viagem** repassadas. [V]
- **Transporte de pacientes (TFD)**: editais municipais contratam por km e/ou diária, com espera em hospital. Não encontramos, em fonte primária lida, um modelo padronizado de "hora de espera" [NV]. Ver a proposta de hora à disposição na seção 3.6.

### 2.5 Retenções que afetam o caixa (licitações e grandes tomadores)

- **Órgãos federais — IN RFB 1.234/2012**, código **6175** (passagens e demais serviços de transporte de passageiros): **7,05%** (IR 2,40 + CSLL 1,00 + COFINS 3,00 + PIS 0,65). [V] Serviços em geral (6190): 9,45%. [V]
- **INSS 11% por cessão de mão de obra — IN RFB 2.110/2022**:
  - art. 112, XVIII: "operação de transporte de passageiros, inclusive nos casos de concessão ou de subconcessão"
  - art. 117, I: **base mínima de 30% do valor bruto** quando combustível e manutenção correm por conta da contratada, o que dá **3,3% da nota**
  - demais casos: 50%
  - exige cessão de mão de obra (serviço contínuo, à disposição do tomador) [V]
- **Empresas na CPRB (4921/4922)**: a retenção é de **3,5%** (Lei 12.546, art. 7º, §6º). [V]

### 2.6 BDI — TCU

- **Acórdão 2622/2013-Plenário** [V]: `BDI = [(1 + AC + S + R + G)(1 + DF)(1 + L) / (1 − I)] − 1`.
  - Faixas para edificações (1º quartil / médio / 3º quartil): AC 3,00/4,00/5,50%; S+G 0,80/0,80/1,00%; R 0,97/1,27/1,27%; DF 0,59/1,23/1,39%; L 6,16/7,40/8,96%; BDI 20,34/22,12/25,00%.
  - Para "mero fornecimento": AC 1,50/3,45/4,49; lucro 3,50/5,11/6,22; BDI 11,10/14,02/16,80%.
  - *Essas faixas são de obras e fornecimento. Não há faixa oficial TCU específica para transporte*: use-as só como sanidade. [D]
- **Súmula TCU 254** [V-s]: "O IRPJ e a CSLL não se consubstanciam em despesa indireta passível de inclusão na taxa de BDI do orçamento-base da licitação…". Na proposta da licitante, podem compor o lucro [S].

---

## 3. Conceitos de precificação aplicados ao motor

### 3.1 Fixo × variável, tarifa binômia e ociosidade [V]/[D]

- **Fixo** (R$/veículo-mês): depreciação, remuneração, pessoal (salvo HE variável), seguro, IPVA, licenciamento, rastreamento, garagem, administração.
- **Variável** (R$/km): combustível, ARLA, lubrificantes, pneus, peças/manutenção, lavagem, pedágio.
- A **tarifa binômia** (R$/veículo-mês + R$/km) reproduz essa estrutura e transfere ao cliente o risco de km (a planilha do concorrente 2 segue essa linha; Maceió 2025 também [V]).
- **Ociosidade**: o custo fixo corre com o veículo parado. Em preço por km puro, `P_km = CF/km_contratado + CV_km`: se o cliente rodar menos, a margem some. Daí as **franquias** mínimas e a cobrança de **km excedente** a preço marginal (Caderno de Logística [V]).
- **Custo marginal** de uma viagem eventual com frota e motorista ociosos = CV_km × km + HE/diária do motorista + pedágio + pernoite. O preço mínimo aceitável é esse custo ÷ (1 − tributos). Qualquer valor acima contribui para cobrir o fixo. [D]
- **Ponto de equilíbrio** (km/mês por veículo): `km* = CF / (p_km·(1 − t − c) − CV_km)`, com t = tributos e c = despesas variáveis sobre o preço. Por hora: substituir km por horas. [D]

### 3.2 Markup divisor × multiplicador [S]/[D]

- **Divisor** (Sebrae): `P = C / [1 − (DV% + DF% + ML%)]`. DV = tributos e comissões sobre a venda; DF = despesas fixas rateadas como % da receita; ML = margem sobre o preço.
- **Multiplicador**: `P = C × (1 + mk)`. A equivalência é `mk = 1/(1 − Σ%) − 1`.
- O concorrente 2 (adm. central 1% + encargos financeiros 1% + impostos 16,67% + lucro 8%, **tudo sobre o preço**) tem divisor `1 − 0,2667 = 0,7333`, ou seja, multiplicador de **1,3636** [D].
- O ANTP usa **multiplicador** para a RPS (γ × custo) e **divisor** para os tributos. A TCU combina multiplicadores (AC, DF, L) com divisor (I). **O motor deve deixar explícito, item a item, se cada % incide sobre o custo ou sobre o preço.** [D]

### 3.3 Perfis por tipo de veículo

| Perfil | VU/VR de referência | Consumo de referência | Fonte |
|---|---|---|---|
| Carro leve (executivo/serviço) | 5 anos / 20% (automóvel de apoio ANTP). Locadoras renovam com **idade média de ~16–17 meses** | usar PBEV/INMETRO ou histórico | ANTP [V]; ABLA 2025 [S] |
| Van (≤ 20 lugares) | ANTP micro/mini: 5 / 15% | não há coeficiente oficial para van. TCE-PE: Sprinter 515 com 9,0 km/l (asfalto) e 6,92 km/l (terra) [V] | ANTP [V] |
| Micro-ônibus | 5 / 15% (ANTP); leve GEIPOT: 7 / 20% | 0,24–0,29 l/km (micro urbano ANTP) | [V] |
| Ônibus urbano/básico | 8 / 10% (ANTP); pesado GEIPOT: 10 / 15% | 0,37–0,45 l/km | [V] |
| Ônibus rodoviário/executivo/DD | sem tabela oficial nas fontes lidas. Sugestão: 10–12 anos, 10–15% | medir: ar-condicionado e câmbio automático elevam o consumo (ANTP) | [NV]/[D] |
| Veículo adaptado (PcD) / pacientes | acrescentar a adaptação ao investimento. Isenção de IPVA para ônibus com acessibilidade no MT (não é regra geral) | — | [V] (MT) |

### 3.4 Com × sem motorista; quem paga o combustível [V]/[D]

- **Locação sem motorista**:
  - não há mão de obra nem Módulos 1–4
  - **não incide ISS** (STF, Súmula Vinculante 31) [V-s]
  - PIS/COFINS pelo regime da empresa: no Real, **não cumulativo**, com crédito sobre a depreciação de bens adquiridos "para locação a terceiros" (Lei 10.833, art. 3º, VI) [V]
  - CNAE 7711-0/00 com RAT grau 2 [V]
  - preço tipicamente mensal (R$/veículo-mês), com km livre ou franquia
- **Com motorista (transporte)**: ISS (municipal) ou ICMS (intermunicipal). PIS/COFINS cumulativos (ver 5.3). RAT grau 3 para 4923-0/02, 4924-8, 4929-9/01 e /02 [V].
- **Combustível pelo cliente**:
  - se o cliente abastece diretamente, o combustível sai do custo **e da base tributária**: o preço cai mais que o custo do combustível, porque os tributos por dentro também saem [D]
  - se é reembolsado na nota, vira receita tributada
  - a "franquia de litros" (ALEAC) é um meio-termo

### 3.5 FU por jornada (5x2, 6x1, 12x36, dupla pegada) [V]/[D]

Fórmula geral proposta [D], compatível com GEIPOT e ANTP:

```
horas_posto_mes  = Σ_tipos_de_dia (horas_operação_dia × dias_no_mês)          # inclui garagem↔início
horas_contrato   = jornada_mensal_contratual (ex.: 220 h para 44 h/sem; ~182,5 h no 12x36 = 15,2 plantões × 12 h)
FU_base          = min(horas_posto_mes, horas_contrato_normais) / horas_contrato
HE_horas         = max(0, horas_posto_mes − FU_inteiro × horas_contrato)  → pagas com (1 + %HE)
FU_final         = FU_base × (1 + %folgas + %férias(=1/11) + %reserva)   # se férias/folgas NÃO estiverem nos encargos
```

- **12x36** (CLT, art. 59-A; permitido ao motorista por CCT, art. 235-F; mantido pelo STF na ADI 5322 [V-s]):
  - posto 12 h/dia, 7 dias → 2 motoristas por posto (+9,09% de férias + reserva) ≈ **2,2**
  - posto 24 h → ≈ 4,4
- **5x2 / 6x1** (44 h): posto de 10 h/dia em dias úteis → 1 motorista + ~1,2 h/dia de HE, ou 1,14 motorista sem HE
- **Dupla pegada** (intervalo > 2 h) permite cobrir picos manhã/tarde com 1 motorista (GEIPOT/AGER [V]). Depende da CCT (ex.: RP/Franca: intervalo > 2 h só por ACT [V]).
- **Referência de mercado** do concorrente 2: **2,2 motoristas por van**, coerente com o limite inferior do GEIPOT (2,20–2,80) [V].

**Horas extras e noturno** [V]:
- `valor_hora = salário/220`
- HE a 50% pela CLT/CF (CCT RP/Franca: 50% até 60 h/mês e 60% acima)
- noturno entre 22h e 5h, com hora reduzida de 52′30″ (fator 60/52,5 = 1,1429) e adicional ≥ 20% (CLT, art. 73; **CCT RP/Franca: 25%**)
- reflexo do DSR sobre HE habitual de ~1/6 [S/D]

**Lei 13.103/2015 após a ADI 5322 (efeitos a partir de 12/07/2023)** [V-s]:
- o **tempo de espera passa a contar como jornada** (não mais a indenização de 30%)
- o descanso de 11 h entre jornadas não pode ser fracionado
- a dupla de motoristas não descansa com o veículo em movimento
- **Impacto**: hora parada = hora trabalhada

### 3.6 Preço por hora, hora à disposição e hora parada [D]

Proposta de construção:
```
custo_hora_disponível = (CF_veículo_mês + CF_motorista_mês) / horas_disponíveis_mês      # custo de "reservar" o conjunto
custo_hora_parada     = custo_hora_disponível (+ HE se fora da jornada)                 # veículo parado, motorista em jornada (ADI 5322)
custo_hora_rodando    = custo_hora_parada + CV_km × velocidade_média
preço_hora            = custo / divisor (tributos + adm + lucro)
```
- **Diária** = custo de 1 dia de disponibilidade (fixo/dias úteis do mês) + km livre × CV_km + diária de alimentação/pernoite do motorista (a CCT RP/Franca impõe alimentação e pernoite por conta da empresa em viagem [V]).
- **Franquia + excedente**: `Preço_franquia = (CF + CV_km × km_franquia)/divisor`; `Preço_excedente_km ≈ CV_km/divisor` (+ HE, se houver).

### 3.7 km morto, reserva técnica e calendário [V]/[D]

- km improdutivo (garagem ↔ 1º ponto) com **teto de 5%** na regulação da AGER-MT [V]. Em fretamento, o km morto entra no custo mesmo que não seja faturado. [D]
- **Reserva técnica**: frota reserva de **10% da operante** (AGER-MT) [V]. Nas planilhas, rateio do custo fixo do reserva sobre a frota operante (TCE-PE: "apropriação reserva técnica") [V].
- Calendário: dias úteis, sábados, domingos e feriados; escolar com 200 dias letivos e 10 meses variáveis contra 12 fixos (FNDE) [V].

---

## 4. Encargos sociais de motoristas e monitores

### 4.1 Composição por grupos — referências comparadas

| Fonte | Regime | A | B | C | D (+outros) | Total | Observação |
|---|---|---|---|---|---|---|---|
| GEIPOT (original) | folha 20% | 36,80 | 13,53 | 7,56 | 4,98 | **62,87%** | férias e RSR via FU [V-s] |
| AGER-MT 2018 | desonerado | 18,30 | 13,53 | 8,47 | 2,48 | **42,78%** | [V] |
| ANTP 2017 | CPRB (INSS 0) | 16,80 | 13,49 | 9,43 | 2,27 | **41,99%** | férias e RSR via FU [V] |
| ANTP sem desoneração | folha 20% | 36,80 | 13,49 | 9,43 | 4,96 | **≈ 64,7%** | [D] |
| Manaus/IMMU 2025 | CPRB 1,6% da receita | — | — | — | — | **47,66%** | [V] |
| TCE-PE (Capanema/PR) | folha 20% | 36,80 | 2,52 (sem férias) | 11,43 | 3,71 + F 5,13 | **59,59%** | [V] |
| SINAPI SP 01/2025, mensalista (construção) | sem desoneração | 37,80* | 18,17 | 8,37 | 7,20 | **71,54%** | *inclui SECONCI 1% e SESI/SENAI [V] |
| SINAPI SP 01/2025, mensalista | com desoneração (INSS 5% em 2025) | 22,80* | 18,17 | 8,37 | 4,04 | **53,38%** | [V] |
| Concorrente 2 | ? | — | — | — | — | 47,52% | provável base desonerada ou sem férias. **Conferir** [D] |

**Grupo A para empresa de transporte em regime normal (Presumido/Real, sem CPRB)** [V]:
- INSS 20%
- **RAT 3% × FAP** (CNAE 4929-9/01 e /02, 4924-8 e 4923-0/02 = grau 3; FAP de 0,5 a 2,0)
- **SEST 1,5% + SENAT 1,0%** (no lugar de SESC/SENAC)
- SEBRAE 0,6%
- INCRA 0,2%
- salário-educação 2,5%
- FGTS 8%
- **Total 36,80%** com FAP 1,0

Na SINAPI, basta trocar SESI/SENAI por SEST/SENAT e remover o SECONCI.

**Duas escolas incompatíveis** — o motor precisa impedir a soma das duas [D]:
1. **FU com reserva** (GEIPOT/ANTP): as férias, folgas e faltas estão no FU (mais pessoas). O Grupo B **não** inclui férias, RSR nem feriados; inclui só 1/3 de férias, 13º, licenças e noturno.
2. **Posto fixo com reposição** (IN 5/2017, SINAPI): a pessoa é única. As férias entram como encargo (8,33% + 1/3) e a **reposição do ausente** entra no Módulo 4.

### 4.2 Simples Nacional [V]

- CPP dentro do DAS (Anexo III: faixas de 6% a 33% nominal, com parcela a deduzir).
- Dispensa das "demais contribuições", inclusive Sistema S e terceiros (LC 123, art. 13, §3º). O Grupo A fica ≈ **FGTS 8%** (salário-educação e RAT também dispensados pela mesma regra; confirmar o RAT [NV]).
- **Vedação**: transporte intermunicipal/interestadual de passageiros **não pode** ser Simples, **exceto** com características urbanas/metropolitanas ou **fretamento contínuo em área metropolitana para estudantes ou trabalhadores** (LC 123, art. 17, VI). Nesse caso: Anexo III sem ISS, **com a parcela de ICMS do Anexo I** (art. 18, §5º-E).

### 4.3 Desoneração da folha (CPRB) — situação em 2025–2028 [V]

- **Quem pode**: empresas de **transporte rodoviário coletivo de passageiros com itinerário fixo**, CNAE **4921-3 e 4922-1** (Lei 12.546, art. 7º, III). O **fretamento (4929-9)** constou só da MP 612/2013, com **vigência encerrada**: **fretamento, escolar (4924-8) e locação não têm CPRB**.
- Alíquota-base de **2%** (art. 7º-A) e transição do art. 9º-A (Lei 14.973/2024), **opcional**:
  - **2025**: 80% da CPRB (1,6%) + 25% da CPP (5%)
  - **2026**: 60% (1,2%) + 50% (10%)
  - **2027**: 40% (0,8%) + 75% (15%)
  - **2028**: folha integral (20%)
- De 2025 a 2027, a parcela de CPP **não incide sobre o 13º** (§1º). A SINAPI já reflete essa regra.
- Em contratos públicos, a orientação SEGES/Compras nº 43 manda tratar a mudança por **reequilíbrio**, ajustando o submódulo 2.2 (INSS) e o Módulo 6 (tributo) [V].

### 4.4 Convenções coletivas de fretamento (exemplos; o motor deve ter "perfil CCT" por base territorial)

- **SINDIFRETUR (SP e região), 2026** [V-s, site do sindicato]:
  - motorista de ônibus R$ 3.663,66 (mai/26) → **R$ 3.733,44** (nov/26)
  - outros veículos R$ 2.930,93 → **R$ 2.986,75**
  - reajuste de 5% + 2%
  - VR de **R$ 42,00 por tíquete** (a partir de jul/26)
  - PLR de R$ 1.650
  - convênio odontológico obrigatório
- **Fretamento Ribeirão Preto/Franca, 2025/26** (SINFREPASS × condutores de Franca) [V]:
  - piso de ônibus R$ 2.479,71 a R$ 2.526,47, conforme o porte da empresa
  - **van/micro R$ 2.195,14** (220 h; valor-hora proporcional)
  - HE de 50% até 60 h/mês e 60% acima
  - **noturno de 25%**
  - PLR de 50% do salário
  - comissão de viagem de 8% (turismo), substituindo HE
  - alimentação e pernoite pagos pela empresa
  - prorrogação além de 2 h/dia somente por ACT
- **FTTRESP (interior de SP), 2025/26**: piso de motorista de ônibus R$ 2.301,98 a partir de 01/05/2025 [V].
- **SINFRETIBA (PR), 2023/24** (via planilha de Capanema) [V-s]: ônibus R$ 2.793,00; micro R$ 2.315,25; van R$ 1.921,50; assistente de transporte escolar R$ 1.816,60; auxílio-alimentação R$ 664.

---

## 5. Tributos sobre transporte de passageiros

### 5.1 ISS (municipal) [V]

- LC 116: item **16.01**, transporte coletivo municipal de passageiros; **16.02**, outros serviços de transporte de natureza municipal (fretamento municipal, escolar municipal etc.).
- Local da incidência: o **município onde se executa o transporte** (art. 3º, XIX).
- Alíquota mínima de 2% (art. 8º-A). O **16.01 é exceção** ao mínimo (pode ser menor). Máxima de 5%.
- **Locação de bens móveis: sem ISS** (Súmula Vinculante 31) [V-s].

### 5.2 ICMS (intermunicipal/interestadual)

- **SP**: alíquota interna de **12%** para transporte intermunicipal de passageiros, **inclusive fretamento** (RICMS/SP, art. 54, I; RC 28953/2023) [V].
  - **Crédito outorgado de 20% do imposto** (Anexo III, art. 11; Convênio ICMS 106/96), opcional e com vedação de outros créditos. Carga efetiva: **9,6%**.
  - **Vigência até 31/12/2026** (Decreto 70.292/2025) [V].
  - Isenção para ônibus em transporte público urbano e metropolitano (IPVA, não ICMS; ver 3.3).
- **PR**: **12%** (RICMS/PR, art. 17, II; consultas SEFA) [V-s]. Crédito presumido equivalente ao do Conv. 106/96: **não verificado** [NV].
- De 2029 a 2032, as alíquotas de ICMS e ISS caem a 9/10, 8/10, 7/10 e 6/10 e se extinguem em 2033 (EC 132, art. 128 do ADCT) [V].

### 5.3 PIS/COFINS [V]

- **Transporte coletivo rodoviário de passageiros fica no regime CUMULATIVO mesmo no Lucro Real** (Lei 10.833, art. 10, XII; Lei 10.637, art. 8º). A **RFB inclui fretamento e turismo** (ADI RFB 27/2008, que revogou a ADI 23/2008 [V-s]; reafirmado na **SC Cosit 50/2026**, que também exclui o fretamento do crédito presumido da Lei 14.592/2023 [V-s]).
  - Alíquotas: **PIS 0,65% + COFINS 3,00% = 3,65%, sem créditos.**
  - **Transporte escolar**: por analogia, provavelmente cumulativo [NV]. Consultar o contador ou uma SC específica.
- **Alíquota zero** só para transporte **público** coletivo municipal/metropolitano (Lei 12.860/2013), o que **não se aplica** a fretamento.
- **Locação sem motorista**: segue o regime da empresa. Real = **1,65% + 7,60%** com créditos (art. 3º: insumos, inclusive combustíveis e lubrificantes; aluguéis; arrendamento mercantil; depreciação de bens para locação ou para a prestação de serviços). Vale-transporte, VR e uniforme **só geram crédito para limpeza/conservação** (art. 3º, X). Portanto, **não** para transporte.
- **Base de cálculo**: o ICMS destacado sai da base de PIS/COFINS (STF, Tema 69) [S]. O ISS na base (Tema 118) segue **pendente**, com placar de 5 a 5 e sem data (fev/2026) [S].

### 5.4 IRPJ/CSLL [V]

- **Presumido** (Lei 9.249, art. 15, §1º, II, "a"):
  - **16%** para "prestação de serviços de transporte, **exceto o de carga**" (carga = 8%)
  - CSLL de **12%** (art. 20)
  - efeito sobre a receita: IRPJ 15% × 16% = **2,40%** + adicional de 10% sobre o lucro presumido acima de R$ 20 mil/mês (até +1,60% da receita que exceder R$ 125 mil/mês); CSLL 9% × 12% = **1,08%**
  - total entre **3,48% e 5,08%**
- **LC 224/2025**: **+10% nos percentuais de presunção** sobre a parcela da receita **acima de R$ 5 mi/ano** (proporcional por trimestre). Transporte de passageiros: 16% → **17,6%** (IRPJ, desde 01/01/2026) e 12% → **13,2%** (CSLL, desde 01/04/2026) [V-s].
  - Judicialização: liminar individual (JF Resende), MS coletivo do Sescon-SP e ADI 7920 da CNI no STF [S].
- **Real**: IRPJ 15% + adicional de 10% (lucro > R$ 20 mil/mês) + CSLL 9% = **34%** sobre o lucro real (24% abaixo do limite do adicional).
- **Retenção federal** (IN 1.234): IR 2,4% e CSLL 1% são **antecipação**, compensáveis.

### 5.5 Reforma Tributária (CBS/IBS) [V]

- **2026**: CBS de 0,9% e IBS de 0,1% em fase de teste (LC 214, arts. 343–346), com dispensa de recolhimento para quem cumprir as obrigações acessórias (EC 132, art. 125) [V]/[NV quanto aos detalhes operacionais].
- **2027**: CBS plena (−0,1 p.p. em 2027–2028); **extinção de PIS/COFINS** (EC 132, art. 126).
- **2029–2032**: IBS sobe enquanto ICMS e ISS caem; **2033**: modelo pleno.
- **Transporte de passageiros na LC 214**:
  - **Isenção**: transporte **público** coletivo urbano, semiurbano e metropolitano "sob regime de autorização, permissão ou concessão pública" (art. 157).
  - **Regime específico com redução de 40%**: coletivo rodoviário intermunicipal e interestadual (art. 286), **só se "público"**, isto é, acessível a toda a população com cobrança individualizada (arts. 284 e 157, par. único).
  - **Fretamento, escolar contratado, pacientes e locação vão para o regime regular**: alíquota cheia, **com crédito amplo** de insumos (diesel, peças, veículos, serviços). Para clientes PJ no regime regular, o IBS/CBS pago **gera crédito** ao tomador.
- **Compras governamentais (2027–2033)**: **redutor uniforme** nas alíquotas de IBS/CBS; a arrecadação vai para o ente contratante (arts. 370, 472 e 473) [V].
- **IBS/CBS são "por fora"** (não integram a própria base; EC 132). O motor precisa do modo "tributo por fora" além do divisor [V-s].

---

## 6. Remuneração do capital próprio × taxa de financiamento

### 6.1 Referências de taxa

| Referência | Valor / regra | Fonte |
|---|---|---|
| GEIPOT | **12% a.a.** sobre o capital não depreciado (veículo sem pneus), almoxarifado (3%) e instalações (4%) | [V] |
| ANTP 2017 | **TRC = Selic média (≥ 24 m) − ½ IPCA médio**, fixada no contrato | [V] |
| FNDE/escolar | TRC = TLP ou Selic | [V] |
| TCE-PE (PR) | TLP pré-fixada de 5,56% no exemplo de Capanema | [V] |
| Selic atual | **13,75% a.a.** (Copom de 16/09/2026) | [S] (conferir no BCB) |
| BNDES Finame/TLP | TLP (IPCA + juro real) + spread do BNDES + spread do agente + risco. Empresas: prazo até 60 meses (fonte secundária) | BNDES [V-s]; [S] |

### 6.2 Base de remuneração — valor cheio × não depreciado × médio

- **Não depreciado por idade** (GEIPOT/ANTP): `R_t = TRC × P × k_t / 12`, com `k_t = 1 − Σ_{i<t} F_i`. Após a vida útil, remunera só o VR. **Recomendado** [V].
- **Valor médio ao longo da vida**: `R = TRC × (P + VR)/2 / 12`. Simplificação para contrato de prazo fixo com veículo novo [D]. O ANTP usa "valor médio do ativo" para bilhetagem e veículos de apoio [V].
- **Valor cheio** (concorrente 1: **1% a.m. sobre o investimento**, ≈ 12,68% a.a. composto): superestima o custo de veículos em fim de vida e subestima nos primeiros meses se a taxa for baixa. Aceitável só como aproximação de contratos curtos com veículo 0 km [D].

### 6.3 Capital próprio + financiado (custo ponderado) [D]

```
TRC_pond = w_E × k_E + w_D × k_D × (1 − t_IR)
w_E, w_D = participação de capital próprio / dívida no veículo (ex.: entrada 20% / Finame 80%)
k_E      = custo de oportunidade do sócio (Selic, CDI, IPCA+ real, ou ANTP-TRC) + prêmio de risco (ex.: RPS ANTP 5–12%)
k_D      = custo efetivo do CDC/leasing/Finame/consórcio (CET a.a.)
t_IR     = 34% só no Lucro Real (juros dedutíveis). No Presumido e no Simples, t_IR = 0
```

**Evitar dupla contagem**:
1. A **parcela do financiamento** (PMT) = amortização + juros é **fluxo de caixa**. Economicamente, **amortização ≈ depreciação** e **juros ≈ remuneração da parcela financiada**.
2. O preço deve conter **depreciação + remuneração (TRC_pond)**, **ou** a **anuidade equivalente**. **Nunca** somar PMT com depreciação ou remuneração.
3. **Anuidade com residual** (método único que substitui depreciação + remuneração):
   `A_mensal = [P − VR·(1+i)^−n] × i / (1 − (1+i)^−n)`, com i = TRC mensal e n = meses de vida (ou do contrato, com VR ao fim do contrato).
4. **Leasing operacional/locação de frota de terceiros**: a contraprestação substitui depreciação e remuneração do ativo. No Real, o arrendamento mercantil gera crédito de PIS/COFINS não cumulativo (Lei 10.833, art. 3º, V) [V]. No transporte coletivo, o regime é cumulativo, então **não há crédito**.
5. **Consórcio**: o custo é a taxa de administração + fundo de reserva (+ custo de oportunidade até a contemplação). Tratar como k_D efetivo [D].
6. O **descasamento** entre prazo do financiamento (ex.: 60 meses) e vida útil econômica (ex.: 8–10 anos) é tema de **capital de giro**, não de custo. O motor pode ter uma aba de fluxo de caixa separada [D].

---

## 7. Depreciação

### 7.1 Métodos [V]/[D]

- **Linear**: `D_mês = (P − VR)/(VU × 12)`.
- **Cole / soma dos dígitos** (GEIPOT, ANTP, FNDE): `F_j = (VU − j + 1)/[VU(VU+1)/2] × (1 − VR)`. Concentra a perda nos primeiros anos, como o mercado.
- **Curva de mercado FIPE** (TCE-PE): regressão do valor venal por idade (ex.: `Y = a + b/X + c/X² + d/X³` por tipo) e depreciação anual = variação do valor de mercado. Mais aderente para vans e carros leves [V].
- **Anuidade/FRC**: substitui depreciação + remuneração (ver 6.3).
- **Base**: preço **sem pneus** (os pneus estão no custo variável; GEIPOT/ANTP) [V].

### 7.2 Vida útil e valor residual — referências

Ver 1.1 e 1.2: GEIPOT leve 7/20, pesado 10/15, especial 12/10; ANTP micro/mini 5/15, midi/básico 8/10, padron 10/10, articulado 12/5, biarticulado 15/5; automóvel de apoio 5/20; caminhonete 8/15.

A **vida útil contratual** pode ser menor que a econômica. Exemplos: idade máxima em edital (TCE-PE: desconto de 15% para van com mais de 15 anos); renovação de carros de locadora com ~16–17 meses de idade média [S]. Nesses casos, usar **VR ao fim do contrato** pela curva FIPE [D].

### 7.3 Depreciação fiscal × econômica [V]

- **Fiscal (IN RFB 1.700/2017, Anexo III)**: NCM **8702 (veículo para 10 ou mais pessoas: vans, micros e ônibus) = 4 anos, 25% a.a.**; NCM **8703 (automóveis) = 5 anos, 20% a.a.**
- A depreciação fiscal só importa no **Lucro Real** (dedutibilidade) e para crédito de PIS/COFINS na locação não cumulativa. **Não usar a taxa fiscal como custo econômico** (ANTP: "não deve ser confundida com a depreciação contábil").
- Depreciação acelerada por turnos (RIR): **[NV]** para veículos.

### 7.4 Veículo usado / idade inicial [V]/[D]

- ANTP: a idade conta da **entrada em operação** (veículo novo) ou do **1º licenciamento** (veículo usado).
- Para veículo usado comprado por preço de mercado M e idade i, o motor deve:
  (a) aplicar os fatores de Cole a partir do ano i+1 sobre o preço do novo; **ou**
  (b) depreciar M até o VR ao longo da vida remanescente.
  O resultado deve ficar consistente com a curva FIPE [D].
- Remuneração: sobre `k_t × P_novo` (ANTP) ou sobre o valor de mercado corrente [D].

### 7.5 Leitura do modelo do concorrente 1 (% mensal do investimento) [D]

| Item | % a.m. | % a.a. | Comparação |
|---|---|---|---|
| Remuneração do capital | 1,00 | ~12,7 (composto) | próximo do GEIPOT (12%), mas **sobre o valor cheio** e não sobre o não depreciado |
| Depreciação | 0,50 | 6,0 | implica ~16,7 anos (VR 0) ou ~10 anos com VR 40%. **Baixa** frente a ANTP (van 5a/15% → ~17% a.a.; básico 8a/10% → ~11% a.a.) |
| Manutenção | 0,80 | 9,6 | dentro da faixa ANTP de peças (6–12% a.a. por idade) |
| Seguro | 0,30 | 3,6 | depende da apólice (RCF/APP/casco) |
| Documentação | 0,13 | 1,56 | coerente com IPVA de 1–2% + licenciamento, mas **IPVA de SP para ônibus/micro é 2%, e 4% para "demais"** (ver 8.4) |

---

## 8. Lucro Real × Lucro Presumido × Simples para transporte de passageiros

### 8.1 Carga sobre o preço por cenário (ilustrativo) [D]

| Cenário | ISS/ICMS | PIS/COFINS | IRPJ/CSLL | Total sobre a receita (exceto CPP) |
|---|---|---|---|---|
| Fretamento **intermunicipal SP**, Presumido, com crédito outorgado de ICMS | 9,6% | 3,65% (≈ 3,21% excluindo ICMS da base) | 3,48% (até 5,08% com adicional) | **≈ 16,3–18,3%** |
| Fretamento **municipal** (ISS 2–5%), Presumido | 2–5% | 3,65% | 3,48–5,08% | **≈ 9,1–13,7%** |
| Fretamento, **Lucro Real** | idem | **3,65% cumulativo, sem créditos** | 34% × lucro | ICMS/ISS + 3,65% + 34% do lucro |
| Locação sem motorista, Real | — (sem ISS) | 9,25% com créditos | 34% × lucro | depende dos créditos |
| Simples Anexo III (municipal, ou fretamento contínuo metropolitano para trabalhadores/estudantes) | incluído (sem ISS e com ICMS no caso do §5º-E) | incluído | incluído | alíquota efetiva da faixa (6% → 33% nominal) |

> O "impostos 16,67%" do concorrente 2 é compatível com **ICMS de 9,6% + PIS/COFINS de 3,65% + IRPJ/CSLL presumidos de 3,48% = 16,73%** (hipótese [D]).

### 8.2 Fórmula de preço por regime [D]

**Presumido** (IRPJ/CSLL como % da receita):
```
P = C / [1 − (ISS|ICMS_efetivo + PIS + COFINS + IRPJ_pres + CSLL_pres + CPRB? + adm% + fin% + m%)]
```

**Real** (IRPJ/CSLL sobre o lucro; m_liq = margem líquida desejada sobre o preço):
```
P = C_liq / [1 − (ISS|ICMS + PIS/COFINS_efetivo + adm% + fin% + m_liq/(1 − 0,34))]
C_liq = C − créditos_PIS/COFINS (somente se não cumulativo; em transporte coletivo = 0)
```
Em licitação (TCU), IRPJ/CSLL **não aparecem** como linha: ficam embutidos no lucro (`m_bruto = m_liq/(1 − 0,34)`).

**Simples**: `P = C / [1 − (alíquota_efetiva + adm% + m%)]`, com `alíquota_efetiva = (RBT12 × nominal − dedução)/RBT12`. Encargos da folha **sem** INSS patronal nem terceiros.

### 8.3 Quando cada regime tende a ser vantajoso [D]

- **Presumido** é vantajoso quando a **margem real supera ~16%** da receita, o que é raro em fretamento. Também é mais simples e tem retenções federais compatíveis (IR 2,4% ≈ IRPJ presumido).
- **Real** é vantajoso com **margens baixas ou prejuízo** (licitações apertadas, anos de renovação de frota com depreciação fiscal de 25% a.a. em 8702) e com juros de financiamento dedutíveis.
  - **Não traz crédito de PIS/COFINS no transporte coletivo** (cumulativo).
  - Traz crédito na **locação sem motorista**. Receitas mistas exigem **rateio**.
- **Simples**: só para municipal ou fretamento contínuo metropolitano de trabalhadores/estudantes; limite de R$ 4,8 mi. Folha barata (sem 20%), mas a alíquota efetiva cresce rápido.
- **LC 224/2025** encarece o Presumido acima de R$ 5 mi/ano; o motor deve recalcular o ponto de indiferença.
- **A partir de 2027**: PIS/COFINS dão lugar à CBS **não cumulativa, com crédito amplo**. Para fretamento (regime regular), a vantagem relativa do Real muda. É preciso simular por ano.

### 8.4 IPVA e taxas veiculares (custo fixo) [V]

- **SP (Lei 13.296/2008, art. 9º)**: **ônibus e micro-ônibus 2%**; caminhões 1,5%; **locadoras 1%**; demais veículos 4%.
  - A van registrada como micro-ônibus paga 2%; como utilitário, verificar a espécie no CRLV [D].
  - Isenções: ônibus e micro exclusivos do transporte **público** urbano/metropolitano; **um veículo escolar de motorista autônomo**; veículos com mais de 20 anos.
- **PR (2026)**: **1,9%** para automóveis e utilitários; **1% para ônibus**, caminhões e veículos de aluguel [V-s].

---

## 9. Recomendações para o motor

Parâmetros e funcionalidades a acrescentar, com unidade, valor típico, fórmula e origem.

### 9.1 Perfis de veículo (tabela `perfil_veiculo`)

| Parâmetro | Unidade | Típico / default | Fórmula / uso | Fonte |
|---|---|---|---|---|
| `tipo` | enum | carro_leve, van, micro, onibus_urbano, onibus_rodoviario, executivo, dd, adaptado | define os defaults abaixo | [D] |
| `preco_novo` | R$ | FIPE/fabricante | base de depreciação, remuneração e peças | [V] |
| `preco_pneus_jogo` | R$ | nº pneus × preço (6 para micro/ônibus; 4 para van/carro) | depreciação sobre `preco_novo − preco_pneus_jogo` | ANTP [V] |
| `vida_util_anos` / `valor_residual_pct` | anos / % | van/micro 5/15; básico 8/10; rodoviário 10/15 [NV]; leve 5/20 | Cole ou linear | GEIPOT/ANTP [V] |
| `idade_inicial_anos` | anos | 0 | desloca o índice j de Cole | ANTP [V] |
| `consumo_l_km_asfalto` / `_terra` | l/km | micro 0,24–0,29; básico 0,37–0,45; terra ≈ +10% (GEIPOT, se > 20% de terra) a +30% (TCE-PE) | `R$/km = consumo × preço` | [V] |
| `arla_pct_diesel` | % | 3–5% (só em diesel P7+) | `l_arla = consumo × %` | ANTP [V] |
| `lubrif_coef_l_eq` | l-eq diesel/km | 0,024–0,029 (ANTP); 0,04–0,06 (GEIPOT) | `R$/km = coef × preço_diesel` | [V] |
| `pneu_vida_km`, `recapagens`, `preco_recap` | km, n, R$ | 85–125 mil km; 2–3 recapagens; terra −23% | `(pneus + recaps)/vida` | [V] |
| `pecas_pct_aa_por_idade` | % a.a. do preço novo | 6/7/8/9/10/12% (0–2, …, > 10 anos); terra +30% | `R$/km = pct × preço / 12 / km_mês` | ANTP/TCE-PE [V] |
| `ipva_pct`, `licenciamento`, `seguro_rcf_app`, `seguro_casco_pct` | %, R$/ano | SP: ônibus/micro 2%, locadora 1%, demais 4%; PR: 1%/1,9% | ÷ 12 | [V] |
| `telemetria`, `tacografo_afericao`, `adesivagem`, `lavagem_km` | R$ | ex.: tacógrafo bienal ÷ 24; adesivagem amortizada em 24 meses; lavagem a cada 1.000 km | fixo mensal ou R$/km | TCE-PE [V] |

### 9.2 Custo variável — seletor de método

- `metodo_variavel ∈ {medido, geipot, antp}`, com validação cruzada: alertar se o medido desviar mais de 25% do paramétrico [D].
- Split `pct_km_terra` (asfalto/terra) com multiplicadores por item [V].
- `pedagio_por_viagem`, `pct_km_morto` (default ≤ 5%, alerta acima) [V].

### 9.3 Depreciação e capital

| Parâmetro | Unidade | Default | Fórmula |
|---|---|---|---|
| `metodo_depreciacao` | enum | `cole` | linear, cole, fipe_curva, anuidade |
| `base_remuneracao` | enum | `nao_depreciado` | nao_depreciado (k_t), valor_medio, valor_cheio (legado) |
| `taxa_capital_modo` | enum | `antp` | fixa_12, antp (Selic_24m − IPCA_24m/2), tlp, ponderada |
| `pct_capital_proprio`, `custo_capital_proprio_aa`, `custo_divida_aa`, `ir_dedutivel` | % | 20/80; Selic + prêmio; CET; true só no Real | `TRC = wE·kE + wD·kD·(1 − t)` |
| `almoxarifado_pct_veiculo` | % | 3% (GEIPOT) ou E meses de peças (ANTP) | `× TRC/12` |
| `instalacoes_pct_veiculo` | % | 4% (GEIPOT) | `× TRC/12` |
| `vr_fim_contrato` | R$ | curva FIPE | para anuidade e contratos curtos |

Travas: **proibir** somar `parcela_financiamento` com depreciação ou remuneração. Aba de fluxo de caixa separada [D].

### 9.4 Mão de obra

| Parâmetro | Unidade | Default | Fórmula / nota |
|---|---|---|---|
| `jornada_tipo` | enum | 44h_5x2 | 5x2, 6x1, 12x36, dupla_pegada, custom (horas_mensais: 220/180/182,5) |
| `horas_operacao_por_tipo_dia` | h | perfil do contrato | inclui garagem ↔ 1º ponto |
| `FU_calculado` | motoristas/veículo | 2,2–2,8 (GEIPOT); tabela ANTP | fórmula da 3.5; opção de override manual |
| `pct_folgas`, `pct_ferias` (1/11 = 9,09%), `pct_reserva` (≈ 1,9%) | % | GEIPOT | somente se `modo_encargos = FU_com_reserva` |
| `modo_encargos` | enum | `FU_com_reserva` | FU_com_reserva (Grupo B sem férias/RSR) ou posto_IN5 (Módulos 1–6 com reposição). Nunca os dois |
| `perc_he`, `faixa_he_2` | % | 50% / 60% acima de 60 h (CCT) | `sal/220 × (1 + %)` + reflexo DSR |
| `adic_noturno`, `hora_reduzida` | %, fator | 20–25%; 60/52,5 | ANTP/CCT |
| `beneficios_por_cabeca` | R$ | VR/VA, cesta, odonto, seguro de vida, PLR/12 | × FU **físico**, sem encargos |
| `monitor` | bool + perfil | escolar/pacientes | mesmo mecanismo |
| `pct_manutencao_adm_sobre_operacao` | % | 20–28% (ANTP θ) ou 12–15% + 8–13% (GEIPOT) | alternativa ao rateio real |
| `perfil_cct` | chave | por base territorial | piso, VR, PLR, % HE, noturno, data-base |

### 9.5 Calculadora de encargos por grupos (`encargos_perfil`)

- **Grupo A**: INSS (20% | parcela por ano da reoneração | 0 no Simples); RAT (3%) × FAP; SEST 1,5; SENAT 1,0; SEBRAE 0,6; INCRA 0,2; salário-educação 2,5; FGTS 8.
- **Grupo B**: 13º 8,33; 1/3 de férias 2,78; [férias 8,33 ou 9,09 **só** no modo posto]; licenças; faltas legais; auxílio-doença (15 dias); noturno (se não estiver no salário).
- **Grupo C**: aviso indenizado `p·R·T/30`; aviso trabalhado; depósito rescisório `0,08·(1+B)·0,5` (40% + 10%, conforme a regra vigente [NV]); indenização adicional `R/12`.
- **Grupo D**: A × B (e A × aviso trabalhado).
- Entradas: rotatividade mensal R, % indenizado T, tempo médio de casa (tabela de aviso de 30 a 90 dias).
- Presets: `presumido_normal` (≈ 60–72%), `cprb_2026` (INSS 10% + CPRB 1,2% na receita; **só CNAE 4921/4922**), `simples` (A ≈ 8%), `antp_2017`, `geipot`.

### 9.6 Estruturas de preço (`modalidade_preco`)

| Modalidade | Saídas | Fórmula |
|---|---|---|
| Binômia | R$/veículo-mês + R$/km | fixo ÷ divisor; CV ÷ divisor |
| Por km com franquia | R$/km na franquia + R$/km excedente | `(CF + CV·km_f)/km_f/div`; `CV/div` (+ HE) |
| Diária | R$/diária (X km livres; opcional franquia de litros) + R$/km excedente | `(CF/dias + CV·km_livre + diária_motorista)/div` |
| Hora | R$/h à disposição, R$/h parada, R$/h rodando | seção 3.6 |
| Veículo-mês sem motorista | R$/veículo-mês (+ km excedente) | sem M1–M4 e sem ISS |
| Viagem / passageiro / aluno | R$/viagem, R$/pax | custo ÷ ocupação × IPK |
| Escolar | anual = 12·CF + 10·CV (ou meses letivos parametrizáveis) | FNDE |

Parâmetros: `combustivel_por ∈ {contratada, cliente_direto, reembolso}`, `motorista ∈ {sim, nao}`, `deflator_k` (lance/estimativa, para reajuste do modelo TCE-PE), `desconto_idade_veiculo`.

### 9.7 BDI/markup (`bdi_perfil`)

- Modo TCU: `[(1 + AC + S + R + G)(1 + DF)(1 + L)/(1 − I)] − 1`. Modo divisor simples: `1/(1 − Σ%)`. Mostrar sempre o equivalente multiplicador e o divisor.
- Itens: adm central, seguros/garantia (garantia contratual de até 5%, conforme edital [NV]), risco (3–5%; mais alto em terra), despesas financeiras (derivadas do **prazo de recebimento + retenções**; ver 9.8), lucro e tributos.
- **Alertas**:
  - (i) BDI sobre mão de obra que já tem Módulo 6
  - (ii) IRPJ/CSLL como despesa em licitação (Súmula 254)
  - (iii) ARLA > 6% do custo de combustível
  - (iv) depreciação < 8% a.a. para van ou micro

### 9.8 Presets tributários (`regime_tributario × tipo_servico × UF × município × ano`)

- `tipo_servico`:
  - `municipal` (ISS 16.02, % do município)
  - `intermunicipal` (ICMS 12%; SP com `credito_outorgado_20` até 31/12/2026)
  - `interestadual`
  - `locacao_sem_motorista` (sem ISS/ICMS)
  - `publico_coletivo` (isenções)
- PIS/COFINS: `cumulativo_transporte` = 3,65% também no Real (flag de rateio para receita mista) | `nao_cumulativo` 9,25% com créditos (locação) | 0 (público municipal). Opção de excluir o ICMS da base.
- IRPJ/CSLL presumidos: 16%/12%, com **LC 224** (17,6%/13,2% sobre a receita acima de R$ 5 mi/ano), adicional do IR e flag de litígio.
- CPRB: habilitar **somente** para CNAE 4921/4922, com tabela anual 2025–2028.
- **Retenções** (caixa, não custo): 7,05% federais (IN 1.234; 6175); INSS 11% × 30% (IN 2.110) ou 3,5% (CPRB); ISS retido. Geram **custo financeiro de capital de giro** = `retido × meses_até_compensar × taxa`.
- **Reforma**: por ano, CBS/IBS **por fora**; `regime_regular` (fretamento, escolar, pacientes, locação) com crédito sobre insumos; `redutor_compras_gov` (2027–2033); ICMS/ISS × {0,9; 0,8; 0,7; 0,6} de 2029 a 2032.

### 9.9 Operação, cenários e reajuste

- Calendário por tipo de dia, `pct_frota_reserva` (default 10%), `km_morto_pct`, `meses_letivos`.
- Cenários de utilização (km/mês, horas/mês, % de ociosidade), **ponto de equilíbrio** em km e em horas, **custo marginal** de viagem eventual, sensibilidade (diesel ±10%, piso ±5%, Selic ±2 p.p.).
- **Fórmula paramétrica de reajuste** gerada da própria planilha (pesos de diesel, pessoal, veículo, peças, pneus, lubrificantes e despesas gerais, no estilo ANTT: 33/38,7/11,2/7,0/4,1/0,7/5,2%), com índices ANP, INPC/CCT, IPA e IPCA.

---

## 10. Fontes consultadas

**Metodologias de custo (GEIPOT, ANTP, ANTT, reguladores)**
1. AGER-MT — Manual tarifário GEIPOT, atualização 2018 (PDF) — https://www.ager.mt.gov.br/documents/5177949/11043921/Minuta+do+MANUAL+TARIFARIO+DO+GEIPOT+-+atualiza%C3%A7%C3%A3o+2018/a2e06886-a75a-3470-cb3d-cdca698d5b11 [V]
2. ViaCircular — Método de cálculo de tarifas (Parte 1): GEIPOT 1996 — https://viacircular.com.br/operacao/metodo-de-calculo-de-tarifas-de-onibus-urbanos-parte1-geipot/ [S]
3. ANTP — Custos dos serviços de transporte público por ônibus: método de cálculo (ago/2017) — https://files.antp.org.br/2017/8/21/1.-metodo-de-calculo--final-impresso.pdf [V]
4. ANTP — Método de cálculo para ônibus elétrico (2023) — https://files.antp.org.br/2023/10/30/metodo-de-calculo-da-prestacao-de-servico-por-onibus-eletrico-a-bateria.pdf (referência; não lido na íntegra)
5. NTU — Nova planilha tarifária — https://ntu.org.br/novo/NoticiaCompleta.aspx?idArea=10&idNoticia=1108 [S]
6. Manaus/IMMU — Metodologia de cálculo da remuneração (jun/2025) — https://www.manaus.am.gov.br/immu/wp-content/uploads/sites/14/2026/03/Metodologia-de-calculo-da-remuneracao-junho2025.pdf [V]
7. ANTT — Voto DAA 004/2026 (reajuste semiurbano) — https://portal.antt.gov.br/documents/498202/0/Voto+DAA+004-2026+(1).pdf/6e65a46d-821c-1894-bc77-f83c46a8999c?t=1771444125007 [V]
8. Resolução ANTT 2.130/2007 (fórmula paramétrica) — https://www.legisweb.com.br/legislacao/?id=105752 [V-s]

**Transporte escolar**
9. FNDE — Cartilha "Entendendo os custos do transporte escolar" (2019) — https://www.gov.br/fnde/pt-br/acesso-a-informacao/acoes-e-programas/programas/pnate/media-pnate/cartilhas-e-manuais/Custo_do_Transporte_Escolar.pdf [V]
10. FNDE — Módulo 6: Metodologia de custo do transporte escolar rural — https://www.gov.br/fnde/pt-br/acesso-a-informacao/acoes-e-programas/programas/pnate/media-pnate/cartilhas-e-manuais/Custo_do_Transporte.pdf [V]
11. Capanema/PR — Planilha de custos referencial, transporte escolar (metodologia TCE-PE) — https://www.capanema.pr.gov.br/attachments/article/14340/ROTA07~1.PDF [V]
12. TCE-PE — Manual do transporte escolar (site) — https://sites.google.com/tce.pe.gov.br/transporteescolarpe/manual (PDF não acessado)

**Contratações públicas, editais e TCU**
13. gov.br/Compras — Elaboração da planilha de custos e formação de preços (IN 5/2017) — https://www.gov.br/compras/pt-br/agente-publico/orientacoes-e-procedimentos/midia/elaborao-da-planilha-de-custos-e-formao-de-preos.pdf [V]
14. gov.br/Compras — Orientação 11: planilha de custos — https://www.gov.br/compras/pt-br/agente-publico/orientacoes-e-procedimentos/11-orientacoes-gerais-para-planilha-de-custos-e-formacao-de-precos [V]
15. gov.br/Compras — Orientação 43: reoneração gradual da folha — https://www.gov.br/compras/pt-br/agente-publico/orientacoes-e-procedimentos/43-orientacao-sobre-a-reoneracao-gradual-de-folha-de-pagamento-alteracoes-da-lei-no-12-546-de-14-de-dezembro-de-2011-pela-lei-14-973-de-16-de-setembro-de-2024 [V]
16. SEGES — Caderno de Logística: Prestação de Serviços de Transporte — https://www.gov.br/compras/pt-br/agente-publico/cadernos-de-logistica/midia/temporario-servicos_transportes-1.pdf [V]
17. Maceió — Anexo VI, planilha de custos (transporte escolar, 2025) — https://www.licitacao.maceio.al.gov.br/baixar/anexo/3711/12977 [V]
18. ALEAC — Edital PE SRP 005/2025 (fretamento de ônibus e vans) — https://www.al.ac.leg.br/wp-content/uploads/2026/02/EDITAL-PREGAO-ELETRONICO-SRP-N-005-2025-ALEAC-LOCACAO-DE-ONIBUS-E-VANS-1.pdf [V]
19. Fomento Paraná — Edital PP 01/2018 (motoristas e locação) — https://www.fomento.pr.gov.br/sites/default/arquivos_restritos/files/documento/2019-02/Ed_2018_01_Motorista_Locacao_Veiculo.pdf [V]
20. TCU — Acórdão 2622/2013-Plenário (BDI; cópia UFF) — https://www.editais.uff.br/sites/default/files/arquivos/Base%20BDI%20-%20Ac%C3%B3rd%C3%A3o-2622-2013.pdf [V]
21. CNJ — Súmula TCU 254 — https://www.cnj.jus.br/sumula-254-tcu/ [V-s]
22. Curitiba — Planilha de custo de equipamentos (referência de estrutura; coleta de resíduos) — https://mid-transparencia.curitiba.pr.gov.br/contratos/licitacoes/2023/PMC_2023_CP_63_218905_56493.pdf [V]

**Legislação tributária**
23. Lei 12.546/2011 (CPRB; arts. 7º, 7º-A e 9º-A) — https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2011/lei/l12546.htm [V]
24. Contábeis — Desoneração 2024–2027 (Lei 14.973/2024) — https://www.contabeis.com.br/artigos/67166/desoneracao-da-folha-de-pagamento-de-2024-a-2027-como-aplicar-a-lei-14-973-2024/ [S]
25. Lei 9.249/1995 (presunção de 16% e 12%) — https://www.planalto.gov.br/ccivil_03/leis/l9249.htm [V]
26. Senior — LC 224/2025 e majoração da presunção — https://documentacao.senior.com.br/exigenciaslegais/noticias/federal/2026/2026-01-07-federal-lei-complementar-n-224-2025-percentuais-de-presuncao-do-lucro-presumido-serao-majorados-em-10-para-empresas-que-faturam-mais-de-r-5-000-000-00/ [V-s]
27. Barbieri Advogados — Liminar contra a LC 224 — https://www.barbieriadvogados.com/lucro-presumido-liminar/ [S]
28. LC 116/2003 (ISS) — https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp116.htm [V]
29. Lei 12.860/2013 (PIS/COFINS zero para transporte público) — https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2013/lei/l12860.htm [V]
30. Lei 10.833/2003 (COFINS não cumulativa; art. 10, XII; art. 3º) — https://www.planalto.gov.br/ccivil_03/leis/2003/l10.833.htm [V]
31. Lei 10.637/2002 (PIS não cumulativo) — https://www.planalto.gov.br/ccivil_03/leis/2002/l10637.htm [V]
32. Rota da Jurisprudência — SC Cosit 50/2026 (fretamento, crédito presumido, ADI 27/2008) — https://rotadajurisprudencia.com.br/2026/03/transporte-por-fretamento-fica-fora-do-credito-presumido-de-pis-e-cofins-instituido-pela-lei-14-592-2023-diz-receita/ [V-s]
33. IN RFB 2.110/2022 (retenção de 11%; RAT por CNAE) — https://www.legisweb.com.br/legislacao/?id=437340 [V]
34. IN RFB 1.234/2012 (retenções federais; código 6175) — https://www.gov.br/transportes/pt-br/servicos/gestao-de-pessoas/manuais-e-normativos/8.INSTRUONORMATIVARFBN1234DE11DEJANEIRODE2012.pdf [V]
35. SEFAZ-SP — RC 28953/2023 (ICMS de 12% no fretamento) — https://legislacao.fazenda.sp.gov.br/Paginas/RC28953_2023.aspx [V]
36. SEFAZ-SP — RICMS, Anexo III, art. 11 (crédito outorgado de 20%) — https://legislacao.fazenda.sp.gov.br/Paginas/an3art011.aspx [V]
37. SEFA-PR — RICMS/PR (Decreto 7.871/2017) — https://www.sefanet.pr.gov.br/dados/SEFADOCUMENTOS/106201707871.pdf e Consulta 40/2021 — https://www.legisweb.com.br/legislacao/?id=420025 [V-s]
38. LC 214/2025 (IBS/CBS; arts. 157, 284–287, 346, 370, 472–473) — https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm [V]
39. EC 132/2023 (arts. 126 e 128 do ADCT) — https://www.planalto.gov.br/ccivil_03/constituicao/emendas/emc/emc132.htm [V]
40. LC 123/2006 (Simples; art. 17, VI; art. 18, §5º-E; Anexo III; art. 13, §3º) — https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm [V]
41. IN RFB 1.700/2017, Anexo III (taxas de depreciação) — https://www.normaslegais.com.br/legislacao/anexoIII-in-rfb-1700-2017.htm [V]
42. STF — Súmula Vinculante 31 — https://portal.stf.jus.br/jurisprudencia/sumariosumulas.asp?base=26&sumula=1286 [V-s]
43. Felsberg / STF — Tema 118 (ISS na base do PIS/COFINS) — https://www.felsberg.com.br/stf-suspende-julgamento-do-re-592-616-tema-118-que-trata-da-exclusao-do-iss-da-base-de-calculo-do-pis-e-da-cofins/ [S]
44. SEFAZ-SP — Lei 13.296/2008 (IPVA) — https://legislacao.fazenda.sp.gov.br/Paginas/lei13296.aspx [V]
45. Fazenda PR — IPVA 2026 (1,9%) — https://www.fazenda.pr.gov.br/Noticia/Com-aliquota-de-19-e-desconto-vista-Fazenda-divulga-datas-do-IPVA-2026 [V-s]

**Trabalho e encargos**
46. SINAPI — Encargos sociais SP 01/2025 (Apêndice 25) — https://www.areias.sp.gov.br/wp-content/uploads/areias-anexo-v-encargos-sociais.pdf [V]
47. NTC&Logística — ADI 5322 e a Lei do Motorista — https://www.portalntc.org.br/a-decisao-do-stf-na-adi-5322-e-as-alteracoes-na-lei-do-motorista/ [S]
48. Conjur — Impactos da ADI 5322 — https://conjur.com.br/2023-jul-20/pratica-trabalhista-lei-motorista-impactos-decisao-supremo-adi-5322/ [S]
49. CCT Fretamento Eventual e Contínuo 2025/2026 (SINFREPASS × Condutores de Franca) — http://www.sindicatomotoristas.com.br/convencoes/ConvencaoFretamento2025.pdf [V]
50. CCT 2025/2026 FTTRESP (Mediador MTE) — https://mediador.trabalho.gov.br/sistemas/mediador/imagemAnexo/MR039000_20252025_07_11T10_09_00.pdf [V]
51. SINDIFRETUR — Piso SP 2026 — https://sindifretur.com/pisoSP.php [V-s]

**Mercado, capital e conceitos**
52. Diário do Grande ABC — Copom: Selic a 13,75% (16/09/2026) — https://www.dgabc.com.br/Noticia/4347352/copom-reduz-taxa-selic-em-0-25-ponto-porcentual-para-13-75-ao-ano [S]
53. BNDES — TLP — https://www.bndes.gov.br/wps/portal/site/home/financiamento/guia/custos-financeiros/tlp-taxa-de-longo-prazo [V-s]
54. WebFrete — Finame 2026 — https://webfrete.com/blog/financiamento-caminhao-2026-bndes-finame [S]
55. ABLA — Anuário 2025 (idade média da frota das locadoras) — https://aiafanews.com.br/locadoras/renovacao-da-frota-das-locadoras-manteve-ritmo-acelerado-em-2025 [S]
56. Sebrae — "Saiba como fazer seu preço de venda" (markup) — https://sebrae.com.br/Sebrae/Portal%20Sebrae/Arquivos/ebook_sebrae_saiba_como_fazer_seu_preco_de_venda.pdf [S]
57. Ônibus & Transporte — Como calcular o preço de um contrato de fretamento (set/2026) — https://onibusetransporte.com/2026/09/21/como-calcular-preco-contrato-fretamento-custo-km/ [S]
