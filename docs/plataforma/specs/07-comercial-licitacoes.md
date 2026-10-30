# Spec 07 — Comercial, licitações, contratos e reajustes (Fase 6)

## Objetivo
Nenhuma licitação relevante passa despercebida, nenhum prazo de proposta/recurso/reajuste/vigência é perdido, e toda proposta nasce dos custos reais.

## Radar de licitações
### Agente `radar_pncp`
- Diário, 08:00. Consulta a API pública do PNCP (e, depois, portais estaduais/municipais) por palavras-chave (fretamento, transporte escolar, locação de veículos com motorista, transporte de passageiros) e UFs de interesse.
- Normaliza para `comercial.licitacao` (órgão, número, objeto, modalidade, datas, valor estimado, URL).
- **Julgar** (LLM): classifica aderência (alta/média/baixa) a partir do objeto e do histórico de contratos da Azul; resume exigências de habilitação e frota (idade máxima, tipo, quantidade).
- **Agir**: e-mail diário "novas licitações aderentes"; pendência para `gestor` decidir participar; ao marcar `participando`, cria tarefas com prazos (impugnação, proposta, recurso).
- Varreduras manuais continuam pelo navegador interno do Claude quando o site não tiver API.

## Habilitação
- Checklist de habilitação por licitação alimentado pelas certidões da empresa (spec 02) e pela frota apta por segmento (spec 02, relatório "aptos").

## Propostas e simulador de custos
- `comercial.proposta` guarda a composição de custos (jsonb) gerada pelo simulador, versão, preço e margem prevista.
- Simulador lê `comercial.parametros_custo` (custos reais publicados pela controladoria — spec 06) e os dados do gabarito (frota, jornada, tributos, pedágios, insumos).
- Após vencer: proposta vira `cadastro.contrato`; realizado × orçado comparado mensalmente (spec 06).

## Contratos: vigência e reajuste
### Agente `reajustes`
- Mensal (dia 1). Contratos com data-base em 60 dias → pendência para `gestor` com índice previsto (IPCA/IGP-M/planilha, conforme contrato) e minuta de pedido de reajuste/repactuação.
### Vigências
- Contratos a vencer em 180/90/30 dias → alerta; B2G: prazo para prorrogação ou nova licitação.

## Pipeline
- Status: radar → analisando → participando → vencida/perdida; para privados: lead → proposta → negociação → fechado/perdido.
- Relatório mensal: taxa de vitória, valor em disputa, motivos de perda (win/loss).

## Critérios de pronto
- [ ] Radar rodando diariamente com ≥ 1 mês de histórico e classificação de aderência avaliada manualmente (≥ 80% de acerto).
- [ ] Todos os contratos ativos com data-base, índice e vigência cadastrados; agente de reajustes ativo.
- [ ] Uma proposta real gerada a partir do simulador e armazenada em `comercial.proposta`.
