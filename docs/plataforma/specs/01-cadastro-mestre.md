# Spec 01 — Cadastro mestre (Fase 0)

## Objetivo
Uma fonte única para veículo, pessoa, cliente, fornecedor, contrato, linha e centro de custo. Tudo que os outros módulos fazem referencia estas tabelas por FK.

## Fontes de carga inicial
| Entidade | Fonte | Observação |
|---|---|---|
| veiculo | Planilha "CONTROLE INFORMAÇÕES GERAIS" (FROTA ATIVA, VENDIDOS) + relação de placas da Ituran | Ituran é a base oficial; divergências viram relatório, não bloqueio |
| financiamento | Planilha "Consórcios e Financiamentos" (Controle Geral) | 1 linha por veículo × contrato de financiamento |
| pessoa | Sistema de ponto (API) + sistema de gestão de motoristas | matrícula do ponto é o elo |
| cliente/fornecedor | Omie (via MCP) | guardar `id_omie` |
| contrato/linha | Cadastro manual assistido (importar de planilha/rotas da Ituran) | linhas com `id_ituran_rota` |

## Regras
1. `placa` normalizada (maiúscula, sem hífen); CPF/CNPJ só dígitos, validados.
2. Veículo nunca é apagado: `status = vendido` + `data_venda`.
3. Toda mudança de `status`, `capacidade`, `categoria_uso` gera log em `auditoria.log`.
4. Ao criar veículo ou contrato, criar automaticamente `centro_custo` (`V-<placa>`, `C-<numero>`) e, se a Omie estiver conectada, espelhar lá (pendência para `financeiro` confirmar).
5. Contrato tem `sla` em jsonb (ex.: `{"pontualidade_min_pct": 95, "tolerancia_atraso_min": 10}`) para ser lido pela operação.

## Tools MCP (Fase 0)
- `omie`: `consultar_cliente(cnpj)`, `consultar_fornecedor(cnpj)`, `listar_contas_pagar(periodo)`, `listar_contas_receber(periodo)`, `incluir_conta_pagar(dados)` [escrita; sempre atrás de pendência].
- `ituran`: `listar_veiculos()`, `posicoes(placa, inicio, fim)`, `odometro_atual(placa)`, `rotas_cadastradas()`, `eventos(placa, inicio, fim)`.
- `ponto`: `funcionarios()`, `marcacoes_por_data(data)`.

Todos: autenticação via `.env`, bind em `127.0.0.1`, retorno normalizado (chaves em snake_case, datas ISO em UTC), paginação transparente, timeout e retry com backoff.

## Interface mínima
- CRUD via API para as 7 entidades.
- Tela de pendências (lista, detalhe com evidências, aprovar/rejeitar com comentário).
- Importadores em `app/modulos/cadastro/importadores/` (xlsx → banco) com relatório de divergências em CSV.

## Relatórios
- Frota por tipo/status/idade média.
- Divergências planilha × Ituran × apólices (placas faltantes de um lado).

## Critérios de pronto
- [ ] 100% das placas da Ituran existem em `cadastro.veiculo`; divergências listadas.
- [ ] Toda pessoa ativa no ponto existe em `cadastro.pessoa`.
- [ ] Cada veículo e contrato tem `centro_custo`.
- [ ] As 3 tools de leitura dos MCPs respondem em < 5 s com dados reais.
- [ ] Uma pendência criada por script pode ser aprovada e aparece em `auditoria.log`.
- [ ] Testes: normalização de placa/CPF/CNPJ; importador com planilha de exemplo.
