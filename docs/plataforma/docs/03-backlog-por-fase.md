# 03 — Backlog por fase

Ordem definida por valor ÷ esforço e por dependência de dados. Marcar `[x]` ao concluir. Cada item aponta a spec; os critérios de pronto detalhados estão lá.

## Fase 0 — Fundação (2–3 semanas) · `specs/01-cadastro-mestre.md`

- [ ] Decidir stack definitiva (ADR-002): verificar a controladoria existente.
- [ ] `db/schema.sql` aplicado; Alembic inicializado; `app/core/` (config, db, audit).
- [ ] Migrar planilha "CONTROLE INFORMAÇÕES GERAIS" (FROTA ATIVA + VENDIDOS) → `cadastro.veiculo`; relatório de divergências vs base Ituran.
- [ ] Migrar "Consórcios e Financiamentos" → `frota.financiamento`.
- [ ] Cadastro de pessoas a partir do sistema de ponto/motoristas → `cadastro.pessoa`.
- [ ] Contratos e linhas ativos → `cadastro.contrato`, `cadastro.linha`.
- [ ] `centro_custo` gerado para cada veículo e contrato, e espelhado na Omie.
- [ ] MCP `omie` (tools: listar_contas_pagar, listar_contas_receber, consultar_fornecedor, consultar_cliente, incluir_conta_pagar [escrita, logada]).
- [ ] MCP `ituran` (tools: listar_veiculos, posicoes, odometro_atual, rotas_cadastradas, eventos).
- [ ] MCP `ponto` (tools: marcacoes_por_data, funcionarios).
- [ ] Tela/CLI de pendências (`auditoria.pendencia`) — aprovar/rejeitar.
- [ ] `agents/base.py` + `agents/_template.py` conforme `docs/04-padrao-de-agentes.md`.

**Pronto quando**: toda placa ativa existe no banco e bate com a Ituran; as três tools MCP de leitura respondem; um `pendencia` pode ser criada e aprovada com log.

## Fase 1 — Compliance e vencimentos (1 semana) · `specs/02-compliance-vencimentos.md`

- [ ] Catálogo `tipo_documento` com antecedências (CNH 60d, licenças 90d, apólice 45d, vistoria escolar 30d…).
- [ ] Carga inicial de documentos (planilha + apólices Sombrero/ESSOR).
- [ ] **Agente `vencimentos`** (diário): gera alertas 60/30/7 dias e pendências para vencidos; bloqueia escala de motorista/veículo com documento obrigatório vencido (pendência, não bloqueio automático).
- [ ] Relatório "Documentos a vencer" por segmento.

## Fase 2 — Ponto e jornada (1–2 semanas) · `specs/03-ponto-jornada.md`

- [ ] Sincronização diária de marcações via MCP `ponto`.
- [ ] **Agente `ponto_erros`**: marcações inválidas/ausentes do dia anterior → e-mail ao gestor/motorista.
- [ ] Cálculo de `jornada_dia` com regras da Lei 13.103 (limite diário, intervalo, interjornada).
- [ ] **Agente `jornada_limites`**: excedentes → pendência para RH.
- [ ] Relatório: horas extras por motorista/mês, reincidência de erros.

## Fase 3 — Operação: rota planejada × realizada (2–3 semanas) · `specs/04-operacao-rotas.md`

- [ ] Ingestão de posições Ituran (a cada 5 min) → `operacao.posicao`.
- [ ] Geração de `viagem` planejada a partir de `linha` + `escala`.
- [ ] **Agente `monitor_rotas`**: início/fim de viagem, atraso > X min, desvio > Y m, veículo diferente do escalado, parada não prevista → `evento_viagem` + alerta em tempo quase real.
- [ ] Odômetro diário por veículo (para manutenção e custo/km).
- [ ] Relatório de pontualidade por linha/contrato (base do SLA).

## Fase 4 — Frota: manutenção, combustível, multas (2–3 semanas) · `specs/05-frota-manutencao.md`

- [ ] `plano_manutencao` por tipo de veículo; **agente `preventiva`** (km da Ituran × último serviço) → OS sugerida.
- [ ] Importação de abastecimentos (cartão/planilha); **agente `combustivel`**: consumo km/l por veículo e motorista, desvio > 15% da média → pendência.
- [ ] Multas: cadastro, prazo de indicação de condutor; **agente `multas_prazos`**.
- [ ] Pneus (fase 4b, opcional no início).

## Fase 5 — Financeiro e controladoria (3 semanas) · `specs/06-custos-controladoria.md`

- [ ] Sincronização diária Omie → `financeiro.lancamento` (com centro de custo).
- [ ] Views `custo_veiculo_mes` e `margem_contrato_mes`.
- [ ] Depreciação e financiamento alocados por veículo.
- [ ] **Agente `contas_pagar_inbox`** (contasapagar@): lê e-mail/NF, extrai dados, valida contra OS/abastecimento/contrato, propõe lançamento na Omie → pendência para financeiro.
- [ ] **Agente `conciliacao`** (semanal): Omie × extrato; combustível × km; horas × escala.
- [ ] Dashboard gerencial: custo/km, margem por contrato, DRE gerencial.
- [ ] Integrar simulador de custos: `comercial.proposta.composicao_custos` alimentada pelos custos reais.

## Fase 6 — Comercial e licitações (2 semanas) · `specs/07-comercial-licitacoes.md`

- [ ] **Agente `radar_pncp`**: busca diária por objeto/UF, grava em `comercial.licitacao`, alerta prazos de proposta e recurso.
- [ ] Reajustes contratuais: **agente `reajustes`** avisa 60 dias antes da data-base.
- [ ] Vigências: contratos a vencer em 180/90/30 dias.
- [ ] Pipeline comercial simples (status por licitação/proposta).

## Fase 7 — Auditoria e governança contínua · `specs/08-auditoria-governanca.md`

- [ ] **Agente `relatorio_semanal`**: resumo em texto + números para a diretoria (segunda-feira, 7h).
- [ ] Trilha de auditoria consultável (quem alterou o quê, por período).
- [ ] Segregação de funções nas pendências (quem cria ≠ quem aprova).
- [ ] Backups testados; rotina mensal de restauração.
- [ ] Revisão trimestral de regras dos agentes (thresholds) com base em falsos positivos.

## Depois (ideias registradas, sem compromisso)

- Videotelemetria / câmera com IA de fadiga e distração (ver `docs/05-benchmarking-segmentos.md`).
- App do motorista: checklist pré-viagem digital, jornada, ocorrências.
- Portal do cliente/escola: pontualidade, frequência de alunos, ocorrências.
- Calculadora de CO2 por contrato (veículo elétrico × combustão).
- Manutenção preditiva (probabilidade de falha por idade × histórico × uso).
