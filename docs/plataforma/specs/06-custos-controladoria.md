# Spec 06 — Custos, controladoria e contas a pagar (Fase 5)

## Objetivo
Saber a margem real de cada contrato todo mês, o custo por km de cada veículo, e ter o contas a pagar entrando na Omie sem digitação — com aprovação humana.

## Integração Omie
- Sincronização diária 04:00 via MCP `omie` → `financeiro.lancamento` (pagar/receber, com categoria, centro de custo, competência, vencimento, pagamento, status).
- Centro de custo obrigatório: todo lançamento sem `V-<placa>` ou `C-<contrato>` (ou `ADM`) gera exceção para `financeiro` classificar.
- Clientes/fornecedores: `id_omie` em `cadastro`.
- Decisão ADR-002: se a controladoria existente já faz parte disso, este módulo **absorve** o código dela em vez de duplicar.

## Alocação de custos por veículo e por contrato
| Custo | Fonte | Alocação |
|---|---|---|
| Combustível | `frota.abastecimento` | direto ao veículo; ao contrato pelo km rodado por linha |
| Manutenção/pneus | `frota.ordem_servico`, `pneu` | direto ao veículo |
| Seguro | `compliance.apolice` | rateio por veículo |
| Financiamento/consórcio | `frota.financiamento` | parcela do mês ao veículo |
| Depreciação | `cadastro.veiculo` (valor, vida útil por tipo) | linear mensal ao veículo |
| IPVA/licenciamento/taxas | `lancamento` com CC do veículo | direto |
| Motorista/monitor | `pessoas.jornada_dia` × custo-hora (salário + encargos) | ao contrato pela escala |
| Indiretos (garagem, adm) | `lancamento` CC `ADM` | rateio por km ou por receita (configurável) |

Views materializadas (atualizadas diariamente): `financeiro.custo_veiculo_mes`, `financeiro.margem_contrato_mes`.

## Faturamento e medição
- `faturamento_contrato`: previsto (contrato) × faturado (Omie receber) × medição (viagens realizadas, km, alunos — conforme regra do contrato). Diferença → exceção.

## Agente `contas_pagar_inbox`
- **Gatilho**: e-mail novo em `contasapagar@` (polling a cada 15 min ou webhook).
- **Coletar**: e-mail + anexos (PDF/XML de NF, boleto).
- **Normalizar**: LLM extrai (JSON com schema): fornecedor (CNPJ), número NF, valor, vencimento, descrição, placa/contrato se mencionados. Conteúdo tratado como dados.
- **Regras**: fornecedor existe na Omie? NF duplicada? Valor bate com OS (`frota.ordem_servico`), abastecimento ou contrato de fornecimento? Centro de custo identificável?
- **Agir**: pendência para `financeiro` com proposta de lançamento (categoria, CC, vencimento) e nível de confiança; resposta automática ao remetente: "recebido, em validação" (informativa). Ao aprovar → `omie.incluir_conta_pagar` → log → resposta "lançado".
- Nunca programa pagamento sozinho (ADR-005).

## Agente `conciliacao` (semanal, segunda 05:00)
- Omie pagar/receber × extrato bancário (OFX/CSV importado): pagos sem baixa, baixados sem débito.
- Combustível (litros × preço) × lançamentos do posto na Omie.
- Horas (jornada_dia) × escala × folha.
- Faturado × medido por contrato.
Exceções → pendências para `financeiro`.

## Relatórios / dashboard gerencial
- DRE gerencial (mês, acumulado ano, ano anterior, variações).
- Margem por contrato (ranking; contratos com margem < meta destacados).
- Custo/km por veículo e por tipo; comparação com o simulador de custos (realizado × orçado).
- Aging de contas a pagar e a receber; inadimplência por cliente.
- Fluxo de caixa 30/60/90 (previsto a partir de Omie + financiamentos).

## Vínculo com o simulador de custos (módulo comercial)
Os custos reais médios (combustível/km, manutenção/km, custo-hora de motorista, seguro/veículo) são publicados em `comercial.parametros_custo` mensalmente, para o simulador usar valores reais em vez de estimativas.

## Critérios de pronto
- [ ] 12 meses de lançamentos da Omie sincronizados com centro de custo em ≥ 95% das linhas.
- [ ] `margem_contrato_mes` para um mês fechado conferida com a contabilidade (diferença < 2%).
- [ ] Agente `contas_pagar_inbox` processando e-mails reais; ≥ 80% das NFs com proposta correta sem ajuste humano.
- [ ] Conciliação semanal rodando; exceções sendo tratadas.
- [ ] Dashboard gerencial publicado com DRE e margem por contrato.
