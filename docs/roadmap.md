# Roadmap da Controladoria — pegar qualquer desvio de dinheiro

Consolidação de cinco estudos feitos sobre esta base em 14/09/2026 (API da
Omie, benchmark de regras contra COSO/IIA/ISA 240/ACFE e o setor, desenho de
regras de fraude para os dados que existem, desempenho a 50–100 mil títulos,
camada de IA) e do que foi construído a partir deles no mesmo dia. Serve para
a diretoria decidir o que vem depois e para quem for continuar o trabalho.

## 1. O que existe hoje

- **15 agentes, 126 regras**, supervisor, motor com fechamento/reabertura
  automáticos, auditoria retroativa por ano, investigador com IA, 17 conjuntos
  de teste rodando a cada push (`.github/workflows/testes.yml`).
- Cobertura por esquema de fraude (árvore da ACFE): fornecedor de fachada
  (cadastro da Receita Federal incluído), pagamento em duplicidade, desvio de
  pagamento (troca de conta, histórico de trocas, baixa desviada), conflito de
  interesse (funcionário-fornecedor, sócio-funcionário, cliente-fornecedor),
  combustível e frota, pessoal (pagamento a CPF sem rastro operacional),
  receita (cancelamento, desconto, entrada sem título, lapping, retenção
  indevida, reajuste vencido, contrato de serviço × faturado), estatística
  (Benford de Nigrini, kickback por categoria), master data e processo.
- Construído em 14/09, primeira onda: agente de frota (7 regras), 8 regras de
  desvio (conta dividida, nota repetida, cadastrado-e-pago, valor redondo, nota
  sequencial, entrada sem título, juros não cobrados, fornecedor dormente), 2
  regras de operador (editado após baixa, lançamento manual sem documento),
  auditoria retroativa, extrato da Omie pelo array correto, bloco `info`
  (usuário) nos títulos, `nIdLancCC` nas baixas, gravação de achados em lote,
  teto do INT4, índices medidos, cache de prompt e tetos na IA, CPF fora da
  evidência persistida.
- Construído em 14/09, segunda onda (todos os itens da seção 3 da versão
  anterior deste documento): agente de **pessoal** (6 regras, ponto e
  afastamento da gestão), **retenção indevida** (PCC/INSS/ISS por tipo de
  tomador), **Benford de Nigrini** (1º e 2º dígitos, MAD + χ², por empresa e
  categoria), **reajuste vencido** em contas a receber, **kickback por
  categoria**, **conta alterada repetida** sobre `OmieParceiroContaHistorico`
  (append-only), **versões de título** (`OmieTituloVersao`, o QUE mudou),
  **transferência intergrupo** e **lapping** sobre o extrato, **CT-e
  automático** pelo painel do contador, **contratos de serviço** (agente
  `contratos`, 7 regras), **Receita Federal** (`ParceiroReceita`, 5 regras),
  hash bancário em HMAC quando `CONTROLADORIA_HASH_KEY` existe, retenção de
  dados pessoais (`retencao.ts`).

## 2. O que depende de quem opera (sem código)

| Ação | Onde | O que destrava |
|---|---|---|
| Conceder SELECT em `VehicleUsageLog`, `Escala`, `AnpPrecoReferencia`, `TimeClockEntry`, `DriverLeave` ao papel `controladoria_leitura` | banco da gestão, `docs/papel-leitura-gestao.sql` seção 3 | `FR-COMBUSTIVEL-SEM-OPERACAO`, a referência ANP em `FR-COMBUSTIVEL-PRECO` e as seis regras do agente `pessoal` |
| Rodar "Testar integração" e conferir se aparecem `info.uInc`, `info.uAlt`, `cChaveNFe`, `cOrigem` nos títulos, `listaMovimentos[].cSituacao` no extrato e se as sondas de contratos e CT-e respondem | Sincronização | Confirma o bloco `info` (regras de operador), o extrato (7 regras `CB-*`/`FC-*` hoje suspensas), `contratos` e as regras de CT-e |
| "Auditar o passado" para 2025 e 2024 | Sincronização → Auditar o passado | Os desvios que já aconteceram entram na fila com a mesma tratativa |
| "Consultar Receita agora" até esgotar a fila (ou esperar os ciclos diários) | Sincronização | As cinco regras `FR-CNPJ-*`/`FR-CNAE-*`/`FR-SOCIO-*`/`FR-MEI-*` só falam de CNPJ já consultado |
| Reler janelas antigas se o extrato e o `info` passarem a chegar | Sincronização → Reler um período | As linhas já espelhadas só ganham os campos novos na releitura |
| Definir `CONTROLADORIA_HASH_KEY` na Vercel (chave longa e aleatória, Sensitive) | Vercel → controladoria | Hash bancário vira HMAC (LGPD item 3); sem ela o sistema continua em SHA-256 e a troca de formato não gera alarme |
| Cadastrar `limiteAlcadaCents` | Modelo de gestão | `FR-FRACIONAMENTO` está inerte sem alçada; `OP-ALCADA` sugere o valor |
| Ativar "Alerta por exceção" e `RESEND_API_KEY` | Modelo de gestão / Vercel | Crítico novo avisa no dia |

## 3. Próximas regras (o que ainda não existe)

| # | Regra | Dado necessário | Estado |
|---|---|---|---|
| 1 | `FR-BENEFICIARIO-DIVERGENTE` — beneficiário do PIX/TED no extrato ≠ CNPJ do título baixado | extrato bancário na Omie com favorecido | o detector mais forte de desvio de pagamento; depende da seção 4 |
| 2 | `FR-DIA-SEMANA` — concentração de baixas em dia/horário fora do padrão do operador | extrato com data-hora | barato depois do extrato entrar |
| 3 | `FL-GPS-ABASTECIMENTO` — cartão usado a mais de 5 km do veículo | telemetria real | seção 4 |
| 4 | `PE-ADIANTAMENTO-SEM-DESCONTO` — adiantamento pago sem desconto correspondente em folha | folha analítica | hoje só "adiantamento aberto" (sem acerto em título) |
| 5 | `CR-CONTRATO-GESTAO` — faturado abaixo do contrato cadastrado na gestão (quando houver `valorMensalCents` por cliente lá) | formulário na gestão | o agente `contratos` já faz isso com o contrato da Omie |

## 4. Fontes externas que mudam o jogo

| Fonte | Como | O que destrava |
|---|---|---|
| Extrato bancário na Omie (OFX diário ou Open Finance) | ativar conciliação/importação de OFX nas duas contas — o sync já lê | as 7 regras `CB-*`/`FC-*`, saldo real, `CB-TRANSFERENCIA-INTERGRUPO`, `CR-LAPPING`, `FR-BENEFICIARIO-DIVERGENTE` |
| Folha analítica (contador/eSocial) + `Driver.desligadoEm` | CSV mensal | fantasma de verdade, pagamento a desligado exato, adiantamento × desconto em folha |
| Telemetria real (Ituran) no lugar do mock | API do rastreador | `FL-GPS-ABASTECIMENTO`: cartão usado a mais de 5 km do veículo — o teste definitivo do cartão |
| Pedágio (Sem Parar/ConectCar/Veloe) e multas (DETRAN/Infosiga) | export mensal por placa | pedágio sem viagem, multa paga sem ressarcimento, atribuição ao motorista pela escala |
| Adquirente/PIX (Cielo/Rede/Stone, relatório PIX do banco) | export diário | receita eventual recebida sem nota/título |
| Trilha de operador da Omie | usuários com privilégio mínimo + "Relatório de auditoria" mensal na Conformidade | quem lança não paga — controle, até a API expor a baixa por usuário |

Feito: Receita Federal (BrasilAPI, `ParceiroReceita`), CT-e pelo painel do
contador (`OmieCte`), contratos de serviço da Omie (`OmieContrato`).

## 5. Motor, dados e IA — o que ainda vale fazer

- Contexto com `select` (títulos sem 8 colunas: −33% de tempo e bytes; parceiros com 4 colunas) e páginas que não precisam do contexto inteiro (`/custos?visao=ano` chega a 869 MB de heap a 100 mil títulos — calcular as 12 colunas com um GROUP BY; `/configuracao` com `percentile_cont` em SQL; `/titulos` só com títulos em aberto).
- `DATABASE_URL` com `-pooler`, `pgbouncer=true&connection_limit=10&pool_timeout=20`; segundo pool da gestão quando `GESTAO_DATABASE_URL` existe.
- Sync incremental por `dDtAltDe/dDtIncDe/dDtCancDe` em vez dos três filtros (sondar antes se a baixa avança `dAlt`).
- Narrativa diária pela Batches API (−50% e fora do relógio da função) com fase própria no ciclo e prazo de entrega; conferir `fallbacks: "default"` no `claude-sonnet-5` (`/v1/models` com o header do beta); esforço `medium` só com avaliação de 20–30 briefings.
- Índices sem uso (0 varreduras): `OmieTitulo_companyId_natureza_status_idx`, `OmieTitulo_companyId_parceiroCodigo_idx`, `OmieSyncRun_conexaoId_status_idx`, `AuditFinding_conexaoId_status_idx` — candidatos a remoção.

## 6. LGPD — o que um encarregado apontaria

1. CPF em claro em `OmieParceiro.documento` e `OmieTitulo.parceiroDocumento` é necessário ao cruzamento; a evidência do achado deixou de carregá-lo. Falta: mascarar `entidadeRef` de PF no briefing do analista.
2. Base legal: legítimo interesse (art. 7º IX / art. 10) para monitorar pagamentos a PF e cruzar ponto/afastamento — registrar a avaliação (LIA) e mencionar o cruzamento no aviso de privacidade dos motoristas.
3. Hash bancário: HMAC com `CONTROLADORIA_HASH_KEY` já está no código; falta definir a variável (seção 2). Sem ela, SHA-256 sem sal é pseudonimização e deve ser tratado como dado pessoal.
4. Registro das operações (art. 37) e RIPD (art. 38): monitoramento sistemático de titulares tende a não caber na simplificação de pequeno porte.
5. Transferência internacional (art. 33) ao enviar nomes de PF à API do modelo: cláusulas-padrão e registro no ROPA.
6. Retenção: implementada em `retencao.ts` (IP/UA da trilha anonimizados após 180 dias, investigações apagadas após 5 anos, falhas de sync após 90 dias). Falta a política escrita e o prazo dos achados em si.
7. Incidente: procedimento para comunicação à ANPD em 3 dias úteis; backup contém CPF em claro.
8. Restringir a evidência de "processo judicial pago a ativo" ao perfil RH/controladoria.
9. `ParceiroReceita.socios` guarda nome e qualificação de sócios (dado pessoal público): incluir no registro das operações.

## 7. Limites conhecidos (aceitos e documentados)

- O sync não apaga título nem baixa removidos na Omie.
- Status do veículo e do motorista na gestão é o de hoje, sem histórico por data.
- `FR-COMBUSTIVEL-CONSUMO` depende do hodômetro digitado no cupom; sem ele, cala.
- Regras de operador dependem de a conta devolver o bloco `info` — o "Testar integração" diz.
- `valorCents` de achado é INT4: acima de R$ 21,4 milhões grava no teto, com nota.
- A base pública da Receita atrasa para empresa recém-aberta: "não encontrada" fica em MÉDIA.
- CT-e depende do painel do contador estar habilitado na conta Omie; sem ele, as regras de CT-e calam e o diagnóstico mostra.
