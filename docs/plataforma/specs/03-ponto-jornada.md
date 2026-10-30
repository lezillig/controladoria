# Spec 03 — Ponto e jornada (Fase 2)

## Objetivo
Marcações corrigidas em até 24 h, jornada dentro da Lei 13.103/2015 e horas extras visíveis antes do fechamento da folha.

## Fluxo diário
1. 05:00 — MCP `ponto.marcacoes_por_data(ontem)` → `pessoas.marcacao_ponto`.
2. Validação por pessoa/dia: pares entrada/saída, intervalo registrado, marcações duplicadas, marcação fora da escala (> 2 h do previsto), ausência sem justificativa.
3. Cruzamento com Ituran (quando houver viagem): marcação de entrada muito depois da ignição ligada, ou saída muito antes da ignição desligada → `suspeita`.
4. Cálculo de `jornada_dia`.
5. Agentes agem.

## Regras de jornada (configuráveis em `agents/config.yaml`)
- Jornada diária padrão 8 h; horas extras até 2 h (ou acordo coletivo — parametrizar).
- Intervalo intrajornada mínimo 1 h (pode ser fracionado conforme Lei 13.103 — parametrizar).
- Interjornada mínima 11 h.
- Tempo máximo de direção contínua 5h30 com pausa de 30 min (quando aplicável a viagens longas; medir pela Ituran).
- Descanso semanal 35 h (pelo menos um a cada semana).

**Observação**: regras legais devem ser validadas com contador/advogado trabalhista antes de serem usadas para desconto ou advertência; o sistema aponta, pessoas decidem.

## Agente `ponto_erros`
- **Periodicidade**: diário, 07:00.
- **Agir**: e-mail ao gestor da equipe com lista por motorista (o que falta, o que está duplicado); opcionalmente e-mail/WhatsApp ao próprio motorista com link para justificar. Reincidência (3 erros em 30 dias) → pendência para RH.

## Agente `jornada_limites`
- **Periodicidade**: diário, 07:10 (após o anterior).
- **Regras**: excedente diário, intervalo não cumprido, interjornada violada, descanso semanal não cumprido.
- **Agir**: pendência para `rh` com evidências (marcações + ignição Ituran); severidade `alta` se repetir na semana.

## Escala
- `pessoas.escala` planejada semanalmente; o módulo valida (a) documentos críticos (spec 02), (b) jornada projetada (não escalar quem já vai estourar), (c) habilitação para o segmento.
- Escala realizada é preenchida pela operação (spec 04) ou manualmente.

## Relatórios
- Horas extras por motorista/mês e por contrato (custo de MO alocado ao contrato).
- Taxa de erro de marcação por equipe (meta < 2%).
- Violações de jornada por mês (meta: zero).

## Critérios de pronto
- [ ] 30 dias de marcações importadas e validadas; taxa de erro medida.
- [ ] `jornada_dia` calculada e conferida com a folha de um mês (diferença < 1%).
- [ ] Dois agentes rodando; e-mail de erros chegando ao gestor até 07:30.
- [ ] Testes unitários das regras com 10 casos (normal, extra, sem intervalo, interjornada, duplicata…).
