# 02 — Modelo de dados

Convenções: `snake_case` sem acento; PK `id bigserial` + chave natural `unique`; `criado_em`/`atualizado_em timestamptz`; `ativo boolean` em vez de delete. DDL completa em `db/schema.sql`.

## Schema `cadastro` (mestre — tudo referencia aqui)

| Tabela | Chave natural | Campos principais |
|---|---|---|
| `veiculo` | `placa` | renavam, chassi, tipo (van/micro/onibus), marca, modelo, ano_fab, ano_mod, capacidade, categoria_uso (fretamento/escolar/cargas), status (ativo/manutencao/vendido), data_compra, valor_compra, fornecedor_id, data_venda, valor_venda |
| `pessoa` | `cpf` | nome, data_nasc, cargo (motorista/monitor/mecanico/adm), data_admissao, data_desligamento, matricula_ponto, telefone, email |
| `cliente` | `cnpj` | razao_social, nome_fantasia, tipo (privado/publico), contato, id_omie |
| `fornecedor` | `cnpj` | razao_social, categoria (combustivel/pecas/seguro/financiamento/...), id_omie |
| `contrato` | `numero_contrato` | cliente_id, tipo (fretamento_continuo/escolar/eventual/locacao), segmento, inicio, fim, valor_mensal, indice_reajuste, data_base_reajuste, sla (jsonb), status, origem (licitacao/privado), licitacao_id |
| `linha` | (contrato_id, codigo) | nome, turno, km_planejado, horario_saida, horario_chegada, veiculo_padrao_id, motorista_padrao_id, id_ituran_rota |
| `ponto_parada` | (linha_id, ordem) | nome, lat, lng, horario_previsto |
| `centro_custo` | `codigo` | tipo (veiculo/contrato/administrativo), referencia_id, id_omie |

Regra: `centro_custo` tem uma linha por veículo (`V-<placa>`) e uma por contrato (`C-<numero>`); é o elo com a Omie.

## Schema `compliance`

| Tabela | Descrição |
|---|---|
| `tipo_documento` | catálogo: CNH, EAR, curso_escolar, curso_coletivo, toxicologico, ASO, CRLV, ARTESP, EMTU, ANTT, CVS, tacografo, extintor, apolice_RC, vistoria_escolar, inspecao_veicular… com `aplica_a` (veiculo/pessoa/empresa), `antecedencia_dias` e `obrigatorio_para` (segmentos) |
| `documento` | tipo_documento_id, veiculo_id ou pessoa_id, numero, emissao, **vencimento**, orgao, arquivo_url, status (vigente/vencido/renovando) |
| `vistoria` | veiculo_id, data, tipo (interna/orgao), checklist (jsonb), aprovado, pendencias, responsavel_id |
| `apolice` | seguradora, numero, segmento, vigencia_ini, vigencia_fim, corretora, valor; `apolice_veiculo` (apolice_id, veiculo_id) |

## Schema `pessoas`

| Tabela | Descrição |
|---|---|
| `escala` | pessoa_id, data, linha_id, turno, veiculo_id, origem (planejada/realizada) |
| `marcacao_ponto` | pessoa_id, data_hora, tipo (entrada/saida/intervalo), origem_api_id, valida boolean, erro (jsonb) |
| `jornada_dia` | pessoa_id, data, horas_trabalhadas, horas_extras, intervalo_ok, excedeu_limite (Lei 13.103), observacao |
| `ocorrencia_rh` | pessoa_id, data, tipo (falta/atraso/advertencia/elogio), descricao |
| `beneficio` | pessoa_id, tipo (VT/VR/...), valor, vigencia |

## Schema `operacao`

| Tabela | Descrição |
|---|---|
| `viagem` | linha_id, data, veiculo_id, motorista_id, status (planejada/realizada/cancelada), saida_prevista, saida_real, chegada_prevista, chegada_real, km_realizado |
| `posicao` (particionada por mês) | veiculo_id, data_hora, lat, lng, velocidade, odometro, ignicao, id_ituran |
| `evento_viagem` | viagem_id, tipo (atraso/desvio/veiculo_errado/parada_nao_prevista/excesso_velocidade/frenagem_brusca), data_hora, detalhe (jsonb), origem_agente |
| `ocorrencia_operacional` | viagem_id, tipo (quebra/acidente/reclamacao/aluno_ausente), descricao, responsavel_id |
| `frequencia_aluno` (escolar) | viagem_id, aluno_id, embarque, desembarque |
| `aluno` (escolar) | contrato_id, nome, responsavel, ponto_parada_id, ativo |

## Schema `frota`

| Tabela | Descrição |
|---|---|
| `plano_manutencao` | tipo_veiculo, item, intervalo_km, intervalo_dias |
| `ordem_servico` | veiculo_id, tipo (preventiva/corretiva), abertura, fechamento, km, fornecedor_id, itens (jsonb), valor_pecas, valor_mao_obra, nf_id |
| `abastecimento` | veiculo_id, motorista_id, data_hora, litros, valor, km, posto_id, origem (cartao/manual), anomalia boolean |
| `pneu` | numero_fogo, marca, medida, vida (novo/R1/R2), status; `pneu_posicao` (pneu_id, veiculo_id, posicao, instalado_em, removido_em, km) |
| `multa` | veiculo_id, motorista_id, auto_infracao, data_infracao, data_notificacao, prazo_indicacao, prazo_recurso, valor, pontos, status (recebida/indicada/recorrida/paga/descontada) |
| `sinistro` | veiculo_id, motorista_id, data, descricao, terceiros, apolice_id, franquia, status |
| `financiamento` | veiculo_id, instituicao, tipo (CDC/consorcio), parcelas, valor_parcela, saldo_devedor, vencimento_dia |

## Schema `financeiro`

| Tabela | Descrição |
|---|---|
| `lancamento` | espelho da Omie: id_omie, tipo (pagar/receber), fornecedor/cliente, centro_custo_id, categoria, competencia, vencimento, pagamento, valor, status, nf_id |
| `nota_fiscal` | chave, emitente, valor, data, arquivo_url, origem (email/omie/manual), validada boolean |
| `faturamento_contrato` | contrato_id, competencia, valor_previsto, valor_faturado, medicao (jsonb), status |
| `custo_veiculo_mes` (view materializada) | veiculo_id, competencia, combustivel, manutencao, pneus, seguro, financiamento, depreciacao, motorista, total, km → custo_km |
| `margem_contrato_mes` (view materializada) | contrato_id, competencia, receita, custo_direto, custo_rateado, margem |

## Schema `comercial`

| Tabela | Descrição |
|---|---|
| `licitacao` | orgao, numero, objeto, modalidade, data_abertura, prazo_proposta, prazo_recurso, valor_estimado, status (radar/analisando/participando/vencida/perdida), url_pncp |
| `proposta` | licitacao_id ou cliente_id, versao, composicao_custos (jsonb — saída do simulador), preco, margem_prevista |
| `reajuste` | contrato_id, data_prevista, indice, percentual, aplicado |

## Schema `auditoria`

| Tabela | Descrição |
|---|---|
| `log` | data_hora, usuario_id ou agente, tabela, registro_id, operacao (insert/update/desativar), antes (jsonb), depois (jsonb) |
| `pendencia` | agente, tipo, titulo, descricao, evidencias (jsonb), acao_proposta (jsonb), perfil_aprovador, status (aguardando_aprovacao/aprovada/rejeitada/executada/erro), criada_em, decidida_por, decidida_em, executada_em |
| `execucao_agente` | agente, inicio, fim, registros_lidos, excecoes, pendencias_criadas, erro |
| `alerta` | tipo, destinatarios, assunto, corpo, enviado_em, referencia (tabela/id) |

## Relacionamentos-chave

```
cliente 1─n contrato 1─n linha 1─n viagem n─1 veiculo
                                   viagem n─1 pessoa (motorista)
veiculo 1─n documento / ordem_servico / abastecimento / multa / financiamento
pessoa  1─n documento / marcacao_ponto / jornada_dia / escala
veiculo 1─1 centro_custo ; contrato 1─1 centro_custo
centro_custo 1─n financeiro.lancamento
```
