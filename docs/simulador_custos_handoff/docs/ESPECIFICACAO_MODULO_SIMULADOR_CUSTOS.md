# Módulo Simulador de Custos — Especificação para o sistema de controladoria da Azul Mob

Versão 1.0 — set/2026. Origem: planilhas de custos dos editais PE 036/2026 (Holambra/SP, transporte escolar, ônibus) e PE 089/2026 (São José dos Pinhais/PR, transporte de pacientes SUS e servidores, vans), mais o Gabarito de Dados do simulador.

## 1. Objetivo

Calcular, para qualquer edital de fretamento contínuo (van, micro-ônibus, ônibus) ou transporte escolar, o custo por km / por veículo-mês / por posto, o preço de proposta e a margem, usando os custos REAIS da Azul registrados na controladoria, e guardar cada simulação com histórico de versões, lances e resultado do certame.

## 2. Modelo de dados (entidades)

### 2.1 Base de custos (dados da empresa — alimentados pela controladoria)

| Entidade | Campos principais | Origem |
|---|---|---|
| `veiculo_modelo` | tipo (van/micro/onibus_urbano/onibus_rodoviario/onibus_escolar), modelo, ano, lotacao, acessivel, valor_compra, valor_fipe, forma_aquisicao, parcela_mensal, taxa_aa, consumo_km_l, combustivel, manutencao_rs_km, pneus_qtde, pneu_preco, pneu_vida_km, seguro_anual, ipva_licenc_anual, licencas_anual, rastreador_mensal, idade_venda, revenda_pct_fipe | Gabarito aba 1_Frota; tabelas de frota/financiamentos da controladoria |
| `funcao_mao_de_obra` | funcao, cct, regiao, salario_base, adicionais_fixos, he_pct, noturno_pct, encargos_pct, vr_va, cesta, vt, plano, seguro_vida, uniforme_epi, exames_cursos, absenteismo_pct, rotatividade_pct | Gabarito aba 2; folha |
| `regra_jornada` | jornada_semanal, escalas, he_pct, noturno_pct, motoristas_por_veiculo[tipo_operacao], monitoras_por_veiculo, km_morto_pct, tempo_deslocamento_min | Gabarito aba 3 |
| `custo_indireto` | folha_adm, contabilidade, sistemas, sede_garagem_sp, oficina, gerais, veiculos_ativos, faturamento_medio, base_rateio; garagem_externa_mes, preposto_mes, veiculo_apoio_mes, implantacao | Gabarito aba 4 |
| `tributo` | regime, pis, cofins, irpj_efetivo, csll_efetivo, iss[municipio], icms[uf], retencoes, cprb | Gabarito aba 5 |
| `financeiro` | prazo_recebimento[tipo_cliente], custo_capital_giro_am, inadimplencia_pct, seguro_garantia_pct | Gabarito aba 5 |
| `insumo` | diesel_rs_l, gasolina, forma_abastecimento, reajuste_anual, arla_rs_l, arla_pct, oleo_rs_km, lavagem, recapagem, alinhamento_rs_km, multas_veic_mes, sinistros_veic_mes | Gabarito aba 6 |
| `pedagio_praca` | rodovia, concessionaria, tarifa[classe], desconto_tag, data | Gabarito aba 7 |
| `regra_azul` | margem_minima, margem_alvo, contingencia_pct, adm_pct, passo_lance, reserva_tecnica[tipo], idade_max, km_max_ano, dist_max_sem_base, utilizacao_srp, meses_custo_fixo_escolar | Gabarito aba 8 |

Cada registro tem `vigencia_inicio`, `vigencia_fim`, `fonte` e `atualizado_por`. Nunca sobrescrever: versionar.

### 2.2 Simulação (por edital)

| Entidade | Campos |
|---|---|
| `edital` | orgao, uf, municipio, numero, modalidade, plataforma, data_sessao, objeto, tipo_servico (escolar/fretamento/saude/locacao_cm/locacao_sm), criterio_julgamento (por item/por lote/global), unidade_preco (km/veiculo_mes/dia/aluno/posto), preco_maximo[item], valor_total_maximo, vigencia_meses, prorrogavel_ate, data_orcamento (base do reajuste), indice_reajuste, prazo_pagamento_dias, garantia_pct, srp (bool), arquivos (edital, TR, anexos) |
| `regra_edital` | edital_id, tema, texto, fonte (item do edital/TR), impacto_custo, campo_afetado — ver `seeds/regras_edital_*.json` |
| `rota` | edital_id, item, nome, km_mes_max (ou km_dia × dias), km_dia, km_terra_dia, dias_mes, periodos, horario_inicio, horario_fim, noturno, veiculos_qtde, tipo_veiculo_exigido, lotacao_min, idade_max, km_max, acessivel, motoristas_por_veiculo, monitoras, viagens_dia, passagens_pedagio_mes, preco_referencia |
| `simulacao` | edital_id, versao, data, autor, premissas_snapshot (JSON com TODAS as premissas usadas — congela o cálculo), utilizacao_pct, resultado (JSON: custo por rota/item, custo_km, preco_km, margem, cenários), status (rascunho/aprovada/lançada), observacoes |
| `lance` | simulacao_id, preco_unitario[item], valor_total, data_hora, fase (proposta inicial/lance/negociação), resultado (vencedor/posição/preço vencedor/empresa vencedora) |
| `contrato_realizado` | edital_id, mes, km_previsto, km_realizado, faturamento, custo_realizado por natureza (folha, combustível, manutenção, veículo, pedágio, indiretos), resultado — alimenta a calibração |

## 3. Motor de cálculo (fórmulas exatas das planilhas)

Todas as fórmulas abaixo estão implementadas e testadas nas planilhas de referência; os casos de teste em `testes/casos_de_teste_esperados.json` devem ser reproduzidos com tolerância de R$ 0,01.

### 3.1 Por rota (ou item)

```
km_util_mes        = km_mes_max × utilizacao_pct                    (SRP/demanda) ou km_dia × dias_mes (escolar/fixo)
km_rodado_mes      = km_util_mes × (1 + km_morto_pct)
pct_terra          = km_terra_dia / km_dia

-- Mão de obra (fixo mensal)
motoristas         = veiculos × motoristas_por_veiculo[tipo_operacao]
salarios           = motoristas × salario_base × (1 + he_pct) × (noturno ? fator_jornada_noturna : 1)
                   + monitoras × salario_monitora
encargos           = salarios × encargos_pct
beneficios         = (motoristas + monitoras) × (vr_va + cesta + vt + plano + seguro_vida + uniforme_epi + exames_cursos)
supervisao         = preposto_mes × (km_util_rota / km_util_total)     (rateio por km)
mao_de_obra        = salarios + encargos + beneficios + supervisao

-- Veículo (fixo mensal, com reserva técnica)
veic_reserva       = veiculos × (1 + reserva_tecnica_pct)
capital            = veic_reserva × valor_veiculo × (depreciacao_aa + custo_capital_aa) / 12
       (alternativa quando financiado: parcela_mensal + depreciação econômica — escolher na regra_azul)
seguro             = veic_reserva × seguro_mensal
ipva_lic           = veic_reserva × (ipva_licenc_anual + laudo_anual + licencas_anual) / 12
telemetria         = veic_reserva × (rastreador + telemetria_extra_edital + sistema_embarque)
higiene_acess      = veiculos × (higienizacao + acessibilidade_identificacao)
garagem            = veic_reserva × garagem_mes_por_veiculo   (só quando distância > dist_max_sem_base)
veiculo            = capital + seguro + ipva_lic + telemetria + higiene_acess + garagem

-- Variáveis (por km rodado)
diesel_km          = diesel_rs_l × ( (1 − pct_terra)/consumo_asfalto + pct_terra/consumo_terra )
outros_km          = arla + oleo_lavagem + (1 − pct_terra) × (pneus_asfalto + manut_asfalto) + pct_terra × (pneus_terra + manut_terra)
variaveis          = (diesel_km + outros_km) × km_rodado_mes + pedagio_mes

-- Totais
custo_direto       = mao_de_obra + veiculo + variaveis
indiretos          = custo_direto × (adm_pct + contingencia_pct)
custo_total_mes    = custo_direto + indiretos
custo_km           = custo_total_mes / km_util_mes
custo_veiculo_mes  = custo_total_mes / veiculos

-- Preço
tributos_pct       = pis + cofins + irpj + csll + ( iss × share_municipal + icms × share_intermunicipal )
fin_pct            = custo_capital_giro_am × prazo_recebimento_dias / 30
preco_km           = ROUNDUP( custo_km / (1 − lucro_alvo − tributos_pct − fin_pct), 2 )
preco_minimo_km    = custo_km / (1 − tributos_pct − fin_pct)          (lucro zero — piso de exequibilidade)
faturamento_mes    = preco_km × km_util_mes
lucro_liquido_mes  = faturamento_mes × (1 − tributos_pct − fin_pct) − custo_total_mes
```

Contrato escolar com N dias letivos: custo fixo mensal × `meses_custo_fixo_escolar` (12 por padrão) e km = km_dia × dias_letivos; custo_km = custo_total_periodo / km_periodo.

### 3.2 Cenários (obrigatório na saída)

Para utilização em {60, 70, 80, 85, 90, 100}% e para o preço de lance informado pelo usuário: km, custo, custo/km, preço p/ lucro alvo, preço lucro zero, faturamento, lucro/mês, margem, lucro/ano, lucro/veículo/mês. Ponto de equilíbrio (utilização em que lucro = 0).

### 3.3 Julgamento por lote

Quando o edital julga por lote com preço unitário único, calcular o preço de cada item isoladamente (diagnóstico) e o preço médio ponderado do lote pelos km; a proposta usa o preço do lote nos dois itens. Sinalizar itens que isoladamente ficam acima do teto.

## 4. Regras do edital que o extrator deve capturar (checklist)

Sessão/plataforma, critério de julgamento, modo de disputa e passo do lance, preço máximo por item, unidade de medida, forma de pagamento (por km útil, por veículo-mês, por posto), ponto de partida do km pago, SRP e fases de implantação, frota (tipo, lotação, idade, km, acessibilidade, mínimo de veículos, prazo de substituição), jornada (horários, dias, feriados), pessoal (habilitação, cursos, monitor, uniforme), telemetria/monitoramento, controle de embarque, seguros, insumos por conta da contratada, pedágio (reembolsa ou não), reajuste (índice e data-base), prazo de pagamento e documentos exigidos, tributos (ISS local × ICMS intermunicipal), habilitação (atestados, certidões, garantia), sanções, subcontratação, vistoria.

Ver `seeds/regras_edital_sjpinhais_pe089_2026.json` como exemplo do formato.

## 5. Telas / fluxo

1. **Base de custos** — CRUD versionado das entidades 2.1, com importação do Gabarito (xlsx) e sincronização com as tabelas já existentes da controladoria (frota, folha, lançamentos por centro de custo). Indicador de "dado estimado" × "dado real".
2. **Novo edital** — upload de edital/TR; extração assistida (IA) preenche `edital`, `regra_edital`, `rota`; usuário confere.
3. **Simulação** — escolhe versão da base de custos, ajusta premissas específicas do edital (utilização, km morto, base local, telemetria extra, pedágio), roda o motor, vê composição por rota/item, cenários e piso de exequibilidade. Salva versão com snapshot.
4. **Proposta / lance** — registra preço lançado por fase e o resultado do certame (posição, vencedor, preço).
5. **Realizado × previsto** — importa km (Ituran) e custos realizados por contrato; mostra desvios por natureza e sugere ajuste das premissas (calibração).
6. **Exportação** — planilha Excel no padrão das referências (abas Regras, Premissas, Rotas, Composição, Cenários, Proposta) e proposta no modelo do edital.

## 6. Histórico a preservar (importado do trabalho já feito)

- Premissas de mercado usadas em set/2026: `seeds/premissas_*.json` (marcadas como `fonte = "estimativa de mercado"`).
- Duas simulações completas com resultados esperados: `testes/casos_de_teste_esperados.json`.
- Regras extraídas do edital de SJP: `seeds/regras_edital_sjpinhais_pe089_2026.json`.
- Planilhas originais e scripts geradores (Python/openpyxl): `planilhas_referencia/`, `scripts/`.
- Decisões registradas: Holambra — linhas 03 e 09 acima da referência por custo fixo diluído em poucos km; SJP — Item 2 isolado a R$ 18/km, lote fecha a R$ 9,31 (lucro 9%) e a R$ 9,89 rende 13,7% a 85% de utilização, equilíbrio em ~68%.

## 7. Critérios de aceite da v1

- Reproduz os dois casos de teste com tolerância de R$ 0,01 no preço/km e 0,1% nos totais.
- Toda simulação salva o snapshot de premissas e é reexecutável.
- Exporta a planilha Excel com as mesmas abas e a mesma composição das referências.
- Base de custos importa o Gabarito preenchido sem edição manual.
- Registro de lance e resultado por edital.
