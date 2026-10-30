# Spec 08 — Auditoria, relatórios de gestão e governança (Fase 7 e contínua)

## Objetivo
Toda decisão rastreável, todo número conferível, e a diretoria recebendo o que importa sem pedir.

## Trilha de auditoria
- `auditoria.log` preenchido pelo helper `app/core/audit.py` em toda escrita (API, importadores, agentes). Campos: quem (usuário ou agente), quando, tabela, id, operação, antes/depois (jsonb).
- Consulta: por período, por tabela, por registro (ex.: "tudo que mudou no veículo ABC1D23"), por usuário.
- Retenção: 5 anos (prazo trabalhista/fiscal); exportável em CSV.

## Pendências (fila de decisão humana)
- Segregação: quem cria (agente ou usuário) ≠ quem aprova; perfil aprovador obrigatório por tipo (ADR-005).
- SLA de decisão por severidade (crítica 4 h, alta 1 dia, média 3 dias); pendência vencida escala para `gestor`.
- Toda decisão guarda comentário; rejeições alimentam a revisão de regras dos agentes.

## Execução de agentes
- `auditoria.execucao_agente`: início, fim, registros, exceções, pendências, erro. Agente que não roda no horário ou falha 2x → alerta para `admin`.
- Painel "saúde dos agentes": última execução, taxa de falsos positivos (pendências rejeitadas ÷ criadas), por agente.

## Agente `relatorio_semanal`
- Segunda-feira, 07:00. Coleta os KPIs abaixo da semana e do mês; LLM redige 10–15 linhas em linguagem de gestão ("o que mudou, o que preocupa, o que decidir"); envia à diretoria com link ao dashboard.
- KPIs: disponibilidade de frota, pontualidade por contrato vs SLA, horas extras, documentos vencidos/a vencer, custo/km, margem por contrato (mês fechado), contas vencidas, pendências abertas por perfil, licitações em curso.

## Dashboard de gestão (uma página)
Blocos: Frota (disponibilidade, idade média, veículos em manutenção) · Operação (pontualidade, exceções da semana) · Pessoas (horas extras, violações de jornada, erros de ponto) · Compliance (semáforo de documentos) · Financeiro (margem por contrato, custo/km, aging) · Comercial (licitações, vigências, reajustes) · Pendências abertas.

## Governança
- Revisão trimestral dos thresholds (`agents/config.yaml`) com base em falsos positivos.
- Backups diários; teste de restauração mensal documentado em `auditoria.log` (operação `restore_test`).
- Controle de acesso por perfil; senhas/tokens rotacionados semestralmente.
- Política de dados pessoais (LGPD): CPF e dados de alunos só nos schemas necessários; acesso logado; exportações com justificativa.

## Critérios de pronto
- [ ] Qualquer alteração em qualquer tabela de domínio aparece no log com antes/depois.
- [ ] Relatório semanal chegando há 4 semanas e ajustado com feedback da diretoria.
- [ ] Painel de saúde dos agentes com taxa de falsos positivos por agente.
- [ ] Um teste de restauração de backup documentado.
