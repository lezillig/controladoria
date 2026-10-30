# 05 — Benchmarking: o que cargas, urbano e rodoviário já fazem (e o que vale trazer)

Transporte de cargas, ônibus urbano e rodoviário têm mais pressão regulatória, mais volume e mais margem apertada — por isso avançaram antes em controle. A tabela abaixo mapeia cada prática ao módulo deste sistema e a um veredito: **Adotar** (entra no backlog), **Adaptar** (vale com ajuste para fretamento/escolar), **Observar** (só quando a escala justificar).

## 1. Transporte de cargas (TMS, gerenciadoras de risco, embarcadores)

| Prática | O que é | Mapeia para | Veredito |
|---|---|---|---|
| **Torre de controle** | Sala/painel único com todas as viagens em curso, status, desvios e alertas priorizados; operador age por exceção | `operacao` · agente `monitor_rotas` | **Adotar** — é o "assistente Mari" que você quer; a torre é a tela, o agente é o cérebro |
| **Gerenciamento de risco (GR)** | Cadastro e consulta de motorista antes da viagem (CNH, antecedentes, histórico), rota pré-definida com cercas eletrônicas, paradas autorizadas, escolta por risco | `compliance` + `operacao.ponto_parada` | **Adaptar** — no escolar, cerca eletrônica em cada ponto + alerta de parada não prevista é controle de segurança do aluno |
| **Checklist pré-viagem digital** | Motorista responde checklist no celular (pneus, luzes, extintor, documentos) com foto; veículo não sai sem checklist OK | `frota.vistoria` (tipo diaria) | **Adotar** — app simples ou formulário; vira evidência em vistoria de órgão e em sinistro |
| **Telemetria de condução** | Score por motorista: frenagem brusca, aceleração, curva, excesso de velocidade, marcha lenta; ranking e bônus | `operacao.evento_viagem` · `pessoas` | **Adotar** — a Ituran já entrega eventos; falta transformar em score e feedback mensal |
| **Videotelemetria com IA** | Câmera interna detecta fadiga, celular, distração; câmera externa grava sinistro | hardware + `frota.sinistro` | **Observar** — custo por veículo; começar por veículos escolares/rodoviários de maior risco |
| **Gestão de combustível por telemetria** | Cruzamento abastecimento (cartão) × nível do tanque (CAN) × km; detecta abastecimento fantasma e desvio | `frota.abastecimento` · agente `combustivel` | **Adotar** (versão km/l); nível de tanque via CAN depende do rastreador |
| **Gestão de pneus por número de fogo** | Cada pneu rastreado por vida (novo, R1, R2), posição, km rodado, CPK (custo por km) | `frota.pneu` | **Adaptar** — alto retorno em ônibus; começar simples (cadastro + rodízio + CPK) |
| **Manutenção preditiva** | Probabilidade de falha por idade × histórico × uso; OS preventiva antes da quebra | `frota.plano_manutencao` | **Observar** — exige histórico limpo primeiro (Fase 4); preditiva só depois de 12 meses de dados |
| **Documentos fiscais eletrônicos integrados** | CT-e/MDF-e emitidos e conciliados automaticamente com viagem e financeiro | `financeiro.nota_fiscal` | **Adaptar** — no fretamento o equivalente é NF de serviço × medição do contrato; conciliar automaticamente |
| **Roteirização** | Otimização de rotas por restrições (janelas, capacidade, custo) | `cadastro.linha` | **Adaptar** — útil no escolar (ordem de pontos, tempo máximo de aluno a bordo) e em novas propostas |
| **Jornada embarcada** | Registro de jornada no próprio dispositivo do veículo (Lei 13.103) | `pessoas.marcacao_ponto` | **Adotar** — cruzar ponto × ignição/posição da Ituran para validar marcações |

## 2. Ônibus urbano (concessionárias municipais, SPTrans/EMTU)

| Prática | O que é | Mapeia para | Veredito |
|---|---|---|---|
| **CCO (Centro de Controle Operacional)** | Despacho em tempo real, regularidade de intervalo, troca de veículo/motorista em minutos | `operacao` | **Adaptar** — a versão fretamento é a torre de controle acima; o que vale copiar é o **protocolo de contingência** (quebra → veículo reserva → aviso ao cliente em X min) |
| **Indicadores de SLA contratual** | Índice de cumprimento de viagens, pontualidade, regularidade, com penalidade automática no contrato | `operacao.viagem` · `financeiro.faturamento_contrato` | **Adotar** — medir antes do cliente medir; licitações de escolar e fretamento B2G cada vez mais exigem |
| **Disponibilidade de frota (%)** | Frota operacional ÷ frota total, diário, com causa de indisponibilidade | `frota.ordem_servico` · `cadastro.veiculo.status` | **Adotar** — KPI nº 1 de oficina |
| **Idade média da frota** | Controle por tipo; exigido em edital (idade máxima) | `cadastro.veiculo` | **Adotar** — relatório simples, decisivo em licitação |
| **Controle de acidentes por milhão de km** | Taxa padronizada, permite comparar meses e motoristas | `frota.sinistro` + km | **Adotar** |
| **Bilhetagem / contagem de passageiros** | Validador ou sensor de porta; receita e ocupação por viagem | `operacao.frequencia_aluno` | **Adaptar** — no escolar, embarque/desembarque do aluno (NFC, QR ou lista digital do monitor) é segurança e evidência de serviço prestado |
| **GTFS / dados abertos de linha** | Formato padrão de linhas, pontos e horários | `cadastro.linha`, `ponto_parada` | **Adaptar** — modelar linhas no padrão GTFS facilita integrar com mapas e com a Ituran |
| **Programação de escala com regras trabalhistas** | Sistema monta escala respeitando jornada, folgas e habilitações | `pessoas.escala` + `compliance.documento` | **Adotar** (versão validação): escala não aceita motorista sem documento ou com jornada estourada |

## 3. Rodoviário de passageiros (ANTT, ARTESP)

| Prática | O que é | Mapeia para | Veredito |
|---|---|---|---|
| **MONITRIIP / transmissão de dados ao regulador** | Posição, velocidade, viagem e passageiros transmitidos à ANTT | `operacao.posicao` | **Observar** — se entrar em linhas interestaduais regulares, vira obrigação; a estrutura de posições já prepara |
| **Controle de viagem com motorista reserva e troca por jornada** | Planejamento de troca de motorista em viagens longas | `pessoas.escala` | **Adaptar** — relevante em fretamento eventual de longa distância |
| **Gestão de licenças por linha/trecho** | Cada serviço tem autorização específica com vigência | `compliance.documento` por `linha` | **Adotar** — no fretamento ARTESP/EMTU é por veículo e por contrato; modelar documento ligado a contrato além de veículo |
| **Avaliação do passageiro e ouvidoria integrada** | Reclamação entra como ocorrência com SLA de resposta | `operacao.ocorrencia_operacional` | **Adaptar** — canal para o cliente/escola com prazo de resposta e histórico por contrato |
| **Tacógrafo digital integrado** | Dados de velocidade/tempo de condução sincronizados automaticamente | `operacao` | **Observar** — a telemetria da Ituran cobre o uso gerencial; o tacógrafo segue como obrigação legal |

## 4. Transversal (os três segmentos)

| Prática | Mapeia para | Veredito |
|---|---|---|
| **Gestão por exceção**: ninguém olha relatório inteiro; o sistema aponta o que fugiu da regra | padrão de agentes (`docs/04`) | **Adotar** — já é o desenho |
| **Custo por km como linguagem comum** entre oficina, operação e financeiro | `financeiro.custo_veiculo_mes` | **Adotar** |
| **Score de motorista** unindo condução, pontualidade, multas, reclamações e jornada; alimenta bônus e treinamento | `pessoas` + `operacao` + `frota` | **Adotar** na Fase 4/5 — é o que mais muda comportamento |
| **Portal do cliente** com indicadores do contrato | relatórios | **Adaptar** — diferencial comercial em B2B/B2G |
| **Digitalização documental com OCR e alertas de vencimento** | `compliance` | **Adotar** — Fase 1 |
| **Agente de IA conversando com os dados da frota** (ex.: assistentes dos grandes fornecedores de telemetria) | servidores MCP + Claude | **Adotar** — é exatamente o que os MCPs deste repositório entregam, sem depender do fornecedor |

## Fornecedores e ferramentas para referência (não para copiar)

- Telemetria/videotelemetria: Geotab, Cobli, Sascar, Omnilink, Ituran (já contratada).
- Gestão de frotas: Gestran, Frotcom, Infleet, Sofit, Frota Control.
- TMS/GR (cargas): Buonny, Apisul, Multisoftware.
- Urbano/rodoviário: Praxio, Transdata, Consórcio/SPTrans (SIM).
- Checklist e app motorista: Checklist Fácil, Produttivo, uMov.me.

Use-os para comparar funcionalidade e preço; o valor deste projeto é ter os dados **integrados** entre si e com o financeiro, o que fornecedor nenhum entrega sozinho.

## O que entra no backlog por causa deste benchmarking

Já incluídos no `docs/03-backlog-por-fase.md`: torre de controle (Fase 3), checklist pré-viagem (Fase 4), score de condução (Fase 4), combustível km/l (Fase 4), SLA/pontualidade (Fase 3), disponibilidade e idade de frota (Fase 4/5), validação de escala por documento e jornada (Fases 1–2), embarque/desembarque de aluno (Fase 3, escolar). Videotelemetria, preditiva e MONITRIIP ficam em "Depois".
