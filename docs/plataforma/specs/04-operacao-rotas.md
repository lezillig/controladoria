# Spec 04 — Operação: rota planejada × realizada e torre de controle (Fase 3)

## Objetivo
Saber, em até 10 minutos, que uma viagem atrasou, desviou, usou veículo errado ou parou onde não devia — e ter o histórico de pontualidade por linha e contrato para o SLA.

## Dados
- **Planejado**: `cadastro.linha` (horários, km, veículo e motorista padrão), `cadastro.ponto_parada` (ordem, lat/lng, horário previsto), `pessoas.escala` (quem/qual veículo no dia).
- **Realizado**: `operacao.posicao` (Ituran, a cada 5 min ou por evento), `operacao.viagem` derivada.

## Geração de viagens
- Job noturno cria `viagem` planejada para o dia seguinte (linha × escala × dia útil/calendário escolar).
- Calendário por contrato (feriados, recesso escolar) em `cadastro.contrato.calendario` (jsonb).

## Agente `monitor_rotas`
- **Periodicidade**: a cada 5 min, 05:00–23:00.
- **Coletar**: posições novas via MCP `ituran.posicoes` (ou webhook se disponível).
- **Regras** (thresholds em config):
  - `inicio_viagem`: veículo sai do raio da garagem/primeiro ponto no horário ± tolerância.
  - `atraso`: chegada em ponto de parada > `atraso_min` (10) após o previsto.
  - `desvio`: posição > `desvio_metros` (300) do corredor da rota por > 3 posições.
  - `veiculo_errado`: veículo no corredor da linha ≠ veículo escalado.
  - `parada_nao_prevista`: parado > 5 min fora de ponto cadastrado (escolar: severidade alta).
  - `excesso_velocidade` / `frenagem_brusca`: eventos da Ituran → repassados como evento de condução.
  - `fim_viagem`: chegada no último ponto; preenche `chegada_real`, `km_realizado`.
- **Julgar** (LLM, opcional): dada uma lista de exceções do intervalo, priorizar e redigir resumo de 3 linhas para o operador da torre.
- **Agir**: alerta imediato (e-mail/WhatsApp) para `operacao` em atraso e parada não prevista no escolar; demais vão para o painel. Pendências só para ações (trocar veículo, cancelar viagem).

## Torre de controle (tela)
Painel único: viagens do dia por status (planejada / em curso / concluída / com exceção), mapa, lista de exceções ordenada por severidade, botão "registrar ocorrência" e "acionar reserva". Operador trabalha por exceção.

## Escolar: embarque/desembarque
- Fase 3b: lista digital do monitor (app ou formulário) ou QR/NFC → `operacao.frequencia_aluno`.
- Regra de segurança: aluno embarcou e não desembarcou no ponto previsto → alerta crítico.

## Protocolo de contingência (copiado do urbano)
Quebra → reserva acionado em ≤ 15 min → cliente avisado em ≤ 20 min → ocorrência registrada com causa. O agente mede os tempos.

## Relatórios
- Pontualidade por linha/contrato/mês (% viagens dentro da tolerância) — comparar com `contrato.sla`.
- Km planejado × realizado por veículo (alimenta custo/km e manutenção).
- Odômetro diário por veículo.
- Ranking de eventos de condução por motorista (alimenta score — spec 05).

## Critérios de pronto
- [ ] Posições de toda a frota entrando no banco há 7 dias sem perda > 1%.
- [ ] Viagens planejadas geradas automaticamente para todas as linhas ativas.
- [ ] Agente detecta atraso e desvio em teste com rota real; alerta chega em < 10 min.
- [ ] Relatório de pontualidade de um mês para um contrato, conferido manualmente.
- [ ] Painel da torre exibindo viagens e exceções do dia.
