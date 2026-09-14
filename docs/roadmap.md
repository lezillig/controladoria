# Roadmap da Controladoria — pegar qualquer desvio de dinheiro

Consolidação de cinco estudos feitos sobre esta base em 14/09/2026 (API da
Omie, benchmark de regras contra COSO/IIA/ISA 240/ACFE e o setor, desenho de
regras de fraude para os dados que existem, desempenho a 50–100 mil títulos,
camada de IA) e do que foi construído a partir deles no mesmo dia. Serve para
a diretoria decidir o que vem depois e para quem for continuar o trabalho.

## 1. O que existe hoje

- **13 agentes, 106 regras**, supervisor, motor com fechamento/reabertura
  automáticos, auditoria retroativa por ano, investigador com IA, 14 conjuntos
  de teste rodando a cada push (`.github/workflows/testes.yml`).
- Cobertura por esquema de fraude (árvore da ACFE): fornecedor de fachada,
  pagamento em duplicidade, desvio de pagamento (troca de conta, baixa
  desviada), conflito de interesse (funcionário-fornecedor, cliente-fornecedor),
  combustível e frota (novo), receita (cancelamento, desconto, entrada sem
  título), estatística (Benford), master data e processo.
- Construído hoje: agente de frota (7 regras), 8 regras de desvio (conta
  dividida, nota repetida, cadastrado-e-pago, valor redondo, nota sequencial,
  entrada sem título, juros não cobrados, fornecedor dormente), 2 regras de
  operador (editado após baixa, lançamento manual sem documento), auditoria
  retroativa, extrato da Omie pelo array correto, bloco `info` (usuário) nos
  títulos, `nIdLancCC` nas baixas, gravação de achados em lote, teto do INT4,
  índices medidos, cache de prompt e tetos na IA, CPF fora da evidência
  persistida.

## 2. O que depende de quem opera (sem código)

| Ação | Onde | O que destrava |
|---|---|---|
| Conceder SELECT em `VehicleUsageLog`, `Escala`, `AnpPrecoReferencia` ao papel `controladoria_leitura` | banco da gestão, `docs/papel-leitura-gestao.sql` seção 3 | `FR-COMBUSTIVEL-SEM-OPERACAO` e a referência ANP em `FR-COMBUSTIVEL-PRECO` |
| Rodar "Testar integração" e conferir se aparecem `info.uInc`, `info.uAlt`, `cChaveNFe`, `cOrigem` nos títulos e `listaMovimentos[].cSituacao` no extrato | Sincronização | Confirma o bloco `info` (regras de operador) e o extrato (7 regras `CB-*`/`FC-*` hoje suspensas) |
| "Auditar o passado" para 2025 e 2024 | Sincronização → Auditar o passado | Os desvios que já aconteceram entram na fila com a mesma tratativa |
| Reler janelas antigas se o extrato e o `info` passarem a chegar | Sincronização → Reler um período | As linhas já espelhadas só ganham os campos novos na releitura |
| Cadastrar `limiteAlcadaCents` | Modelo de gestão | `FR-FRACIONAMENTO` está inerte sem alçada; `OP-ALCADA` sugere o valor |
| Ativar "Alerta por exceção" e `RESEND_API_KEY` | Modelo de gestão / Vercel | Crítico novo avisa no dia |

## 3. Próximas regras, ranqueadas por recuperação ÷ ruído

| # | Regra | Dado necessário | Estado |
|---|---|---|---|
| 1 | `PE-PAGO-A-DESLIGADO` / `PE-FANTASMA` / `PE-DIARIA-OUTLIER` — pagamento a CPF sem rastro operacional (ponto, uso de veículo, escala) | GRANT em `TimeClockEntry` e `DriverLeave`; `Driver.desligadoEm` na gestão | leitura opcional a criar em `leitura.ts`, agente `pessoal.ts` |
| 2 | `CR-RETENCAO-INDEVIDA` — 4,65% (PCC) retido por tomador privado em fretamento, 11% INSS sem cessão de mão de obra, ISS retido por tomador de outro município | já existe (retenções por tributo no título) | classificar o tomador por nome/CNPJ; dinheiro a recuperar via PER/DCOMP |
| 3 | `FR-BENFORD-NIGRINI` — trocar o teste de 1º dígito (n≥150, 8 p.p.) por MAD de Nigrini (1º e 2º dígitos, n≥500) por conexão e grupo de categoria, excluindo valores fixos recorrentes | já existe | o teste atual dá falso alarme perto de 1 em 4 |
| 4 | `CR-REAJUSTE-VENCIDO` — cliente com 13+ meses de faturamento estável sem reajuste (Lei 14.133 art. 25 §7/§8) | `HistoricoMensal` RECEBER | espelho do `HI-REAJUSTE-SILENCIOSO` |
| 5 | `FR-KICKBACK-CATEGORIA` — um fornecedor passa a dominar categoria+departamento enquanto o custo sobe mais que a receita | já existe | relacionar com `OP-CONSOLIDACAO` no supervisor |
| 6 | `FR-CONTA-ALTERADA-REPETIDA` — 2+ trocas de conta em 12 meses ou volta a uma conta anterior | tabela `OmieParceiroContaHistorico` (append-only, escrita no sync) | só a última troca é guardada hoje |
| 7 | `FR-EDITADO-APOS-BAIXA` com o QUE mudou — versão do título por hash de campos (`OmieTituloVersao`) | escrita no sync quando o hash muda | hoje a regra sabe quem e quando, não o quê |
| 8 | `CB-TRANSFERENCIA-INTERGRUPO`, `CR-LAPPING`, `FR-DIA-SEMANA` | extrato | baratos depois do extrato entrar |
| 9 | `FI-CTE-OS` automático — listar CT-e/CT-e OS por `contador/xml/ListarDocumentos` (`cModelo` 57/67) e casar por `cChaveNFe` | acesso ao painel do contador na conta Omie (a confirmar) | hoje a conferência é por colagem manual |
| 10 | Contratos de serviço (`servicos/contrato/ListarContratos`) — receita recorrente esperada × faturada, mudança silenciosa de valor, contrato suspenso ainda faturado | endpoint disponível | precisa modelo `OmieContrato` |

## 4. Fontes externas que mudam o jogo

| Fonte | Como | O que destrava |
|---|---|---|
| Extrato bancário na Omie (OFX diário ou Open Finance) | ativar conciliação/importação de OFX nas duas contas — o sync já lê | as 7 regras `CB-*`/`FC-*`, saldo real, `FR-BENEFICIARIO-DIVERGENTE` (beneficiário do PIX ≠ CNPJ do título) — o detector mais forte de desvio de pagamento |
| Receita Federal (dados abertos CNPJ / API pública) | consulta noturna por CNPJ, cache mensal | fornecedor inapto/baixado pago, CNAE incompatível com a categoria, sócio com nome de funcionário, empresa aberta há menos de 6 meses |
| Folha analítica (contador/eSocial) + `Driver.desligadoEm` | CSV mensal | fantasma de verdade, pagamento a desligado exato, adiantamento × desconto em folha |
| Telemetria real (Ituran) no lugar do mock | API do rastreador | `FL-GPS-ABASTECIMENTO`: cartão usado a mais de 5 km do veículo — o teste definitivo do cartão |
| Pedágio (Sem Parar/ConectCar/Veloe) e multas (DETRAN/Infosiga) | export mensal por placa | pedágio sem viagem, multa paga sem ressarcimento, atribuição ao motorista pela escala |
| Adquirente/PIX (Cielo/Rede/Stone, relatório PIX do banco) | export diário | receita eventual recebida sem nota/título |
| Contratos por cliente (`valorMensalCents`, `reajusteEm`) na gestão | formulário | faturado abaixo do contrato, reajuste vencido exato |
| Trilha de operador da Omie | usuários com privilégio mínimo + "Relatório de auditoria" mensal na Conformidade | quem lança não paga — controle, até a API expor a baixa por usuário |

## 5. Motor, dados e IA — o que ainda vale fazer

- Contexto com `select` (títulos sem 8 colunas: −33% de tempo e bytes; parceiros com 4 colunas) e páginas que não precisam do contexto inteiro (`/custos?visao=ano` chega a 869 MB de heap a 100 mil títulos — calcular as 12 colunas com um GROUP BY; `/configuracao` com `percentile_cont` em SQL; `/titulos` só com títulos em aberto).
- `DATABASE_URL` com `-pooler`, `pgbouncer=true&connection_limit=10&pool_timeout=20`; segundo pool da gestão quando `GESTAO_DATABASE_URL` existe.
- Sync incremental por `dDtAltDe/dDtIncDe/dDtCancDe` em vez dos três filtros (sondar antes se a baixa avança `dAlt`).
- Narrativa diária pela Batches API (−50% e fora do relógio da função) com fase própria no ciclo e prazo de entrega; conferir `fallbacks: "default"` no `claude-sonnet-5` (`/v1/models` com o header do beta); esforço `medium` só com avaliação de 20–30 briefings.
- Índices sem uso (0 varreduras): `OmieTitulo_companyId_natureza_status_idx`, `OmieTitulo_companyId_parceiroCodigo_idx`, `OmieSyncRun_conexaoId_status_idx`, `AuditFinding_conexaoId_status_idx` — candidatos a remoção.

## 6. LGPD — o que um encarregado apontaria

1. CPF em claro em `OmieParceiro.documento` e `OmieTitulo.parceiroDocumento` é necessário ao cruzamento; a evidência do achado deixou de carregá-lo hoje. Falta: mascarar `entidadeRef` de PF no briefing do analista.
2. Base legal: legítimo interesse (art. 7º IX / art. 10) para monitorar pagamentos a PF — registrar a avaliação (LIA) e mencionar o cruzamento no aviso de privacidade dos motoristas.
3. Hash bancário SHA-256 sem sal é pseudonimização, não anonimização: tratar como dado pessoal; preferir HMAC com chave em variável de ambiente.
4. Registro das operações (art. 37) e RIPD (art. 38): monitoramento sistemático de titulares tende a não caber na simplificação de pequeno porte.
5. Transferência internacional (art. 33) ao enviar nomes de PF à API do modelo: cláusulas-padrão e registro no ROPA.
6. Retenção: definir prazo para achados, evidências, investigações e trilha com IP (5 anos / 6 meses).
7. Incidente: procedimento para comunicação à ANPD em 3 dias úteis; backup contém CPF em claro.
8. Restringir a evidência de "processo judicial pago a ativo" ao perfil RH/controladoria.

## 7. Limites conhecidos (aceitos e documentados)

- O sync não apaga título nem baixa removidos na Omie.
- Status do veículo e do motorista na gestão é o de hoje, sem histórico por data.
- `FR-COMBUSTIVEL-CONSUMO` depende do hodômetro digitado no cupom; sem ele, cala.
- Regras de operador dependem de a conta devolver o bloco `info` — o "Testar integração" diz.
- `valorCents` de achado é INT4: acima de R$ 21,4 milhões grava no teto, com nota.
