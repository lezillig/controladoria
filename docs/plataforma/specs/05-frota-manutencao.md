# Spec 05 — Frota: manutenção, combustível, pneus, multas, sinistros, score (Fase 4)

## Objetivo
Disponibilidade de frota acima de 95%, custo por km conhecido por veículo, desvio de combustível e multas tratados no prazo.

## Manutenção
- `plano_manutencao` por tipo de veículo (van / micro / ônibus): óleo e filtros (km), correia, freios, revisão geral, tacógrafo (tempo), extintor (tempo), pneus (rodízio km).
- `ordem_servico`: preventiva (gerada pelo agente) ou corretiva (aberta pela oficina/operação); vincula fornecedor, NF e valores; ao fechar, atualiza "último serviço" por item.
- **Checklist pré-viagem** (do benchmarking de cargas): `compliance.vistoria` tipo `diaria`, preenchida pelo motorista (formulário/app) com foto quando houver avaria → abre OS corretiva automaticamente (ação interna, logada).

### Agente `preventiva`
- Diário, 06:00. Km atual (Ituran) − km do último serviço por item ≥ intervalo − margem (ex.: 500 km) → OS preventiva sugerida (pendência para `operacao`/oficina: aprova data e fornecedor).
- Veículo com item vencido e em operação → severidade alta.

## Combustível
- `abastecimento` importado de cartão (CSV/API do fornecedor) ou lançado manualmente com km do hodômetro.
### Agente `combustivel`
- Semanal. Calcula km/l por veículo (km Ituran ÷ litros) e por motorista; compara com média móvel 8 semanas do mesmo veículo/tipo.
- Exceções: desvio > `desvio_pct` (15%); abastecimento sem km coerente (km informado < anterior ou > Ituran + 50 km); abastecimento com veículo parado (ignição off no horário, posição longe do posto) → pendência para `operacao` + `financeiro`.

## Pneus (fase 4b)
- Cadastro por número de fogo; posição no veículo; vida (novo/R1/R2); km acumulado; CPK = custo ÷ km.
- Alerta de rodízio por km e de sucata por vida.

## Multas
- Cadastro da notificação (data, prazo de indicação de condutor, prazo de recurso); vínculo ao motorista pela escala/viagem do horário da infração (sugestão automática, confirmação humana).
### Agente `multas_prazos`
- Diário. Indicação de condutor a vencer em 7/3/1 dias e recurso a vencer → pendência para `gestor`. Desconto em folha → pendência para `rh` (ADR-005).
- Relatório de pontos na CNH por motorista (cruzar com spec 02).

## Sinistros
- Registro com fotos, terceiros, apólice, franquia, status; vínculo ao evento de condução (frenagem/velocidade) nos 5 min anteriores, quando houver.
- Taxa de sinistros por milhão de km (do benchmarking urbano).

## Score de motorista (mensal)
Composição sugerida (pesos em config): condução (eventos Ituran por 100 km) 35%, pontualidade 20%, multas 15%, reclamações 10%, jornada/ponto 10%, checklist e cuidado com veículo 10%. Resultado em `pessoas.score_mes` (criar tabela na Fase 4). Serve para feedback, treinamento e bônus; nunca para punição automática.

## Relatórios
- Disponibilidade de frota diária (%), com causas.
- Idade média da frota por tipo (licitações exigem).
- Custo de manutenção por veículo/km; top 10 veículos mais caros.
- km/l por veículo e motorista; desvios.
- Multas por motorista/mês; prazos pendentes.
- Score de motorista.

## Critérios de pronto
- [ ] Plano de manutenção cadastrado para os 3 tipos; histórico de OS dos últimos 6 meses importado.
- [ ] Agente `preventiva` sugerindo OS com base no km da Ituran.
- [ ] 3 meses de abastecimentos importados; km/l calculado; agente apontando desvios.
- [ ] Multas dos últimos 12 meses cadastradas; agente de prazos ativo.
- [ ] Relatório de disponibilidade e idade média gerados.
