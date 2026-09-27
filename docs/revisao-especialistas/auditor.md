# Parecer de auditoria interna — regras, supervisor e motor

Revisão do sistema feita por um especialista de IA (Fable 5.1) no papel de auditor interno, em 27/09/2026, somente leitura do código. Referências `arquivo:linha` apontam para o estado do repositório naquela data. O achado 1 foi conferido no código por quem consolidou os pareceres: a chave do índice (`chaveParceiro`) e a chave da busca (`codigoOmie`) nunca coincidem.

## 1. Resumo executivo

O sistema cobre, com profundidade acima do usual para um controle interno automatizado, o eixo **contas a pagar → baixa → banco** e o cadastro de fornecedores, o **combustível** transação a transação, o **pessoal** cruzado com rastro operacional e o **contas a receber** (retenção, lapping, contrato × faturado). A arquitetura (agente puro → supervisor → motor com chave determinística e fechamento controlado) é a correta para auditoria contínua, e a disciplina de "calar sem dado" evita a maior parte dos falsos positivos em massa.

A confiança nas regras, porém, é **desigual**: há uma regra de cadastro **inerte por defeito de chave** (`FR-DOCUMENTO-INVALIDO`), um comportamento do motor que **fecha indícios de fraude de combustível sem ninguém olhar** (EVENTO sem data na auditoria retroativa), achados **RESOLVIDOS que não reabrem** quando a condição volta, e uma família de cruzamentos que **mistura as duas contas Omie** (conciliação, fiscal, OS, histórico). Metade dos códigos de regra (67 de 133) não tem caso de teste. As lacunas de cobertura mais relevantes para uma transportadora estão parcialmente alcançáveis com dados que o espelho **já tem**.

## 2. Achados ranqueados

### 1. CRÍTICO — `FR-DOCUMENTO-INVALIDO` nunca dispara: chave de índice incompatível
- **Onde:** `agents/antifraude.ts:777-791`. `pagamentosPorParceiro` é indexado por `chaveParceiro(t)` (`doc:<documento>`, `<APELIDO>:<codigo>` ou `nome:<nome>`), mas a busca é feita com `p.codigoOmie`. Nenhuma das formas é igual ao código puro, então `temPagamento` é sempre falso.
- **Risco:** falso negativo total num dos testes mais baratos de cadastro de fornecedor (CNPJ/CPF ausente ou inválido recebendo pagamento). Não há teste da regra.
- **Mudar:** indexar por `${conexaoId}|${parceiroCodigo}` e buscar por `${p.conexaoId}|${p.codigoOmie}`, como `cadastradoEPago` já faz (`antifraudeFornecedor.ts:216-219`); caso positivo e negativo em `teste-antifraude.ts`.

### 2. CRÍTICO — Auditoria retroativa e janela de 400 dias fecham EVENTOs de frota sem ninguém ter olhado
- **Onde:** `engine.ts:510-518` (EVENTO sem `dataReferencia` "conta como dentro da janela"); nenhum dos sete achados de `agents/frota.ts` define `dataReferencia`; `teste-engine.ts:83-84` fixa esse comportamento.
- **O que acontece:** ao rodar "Auditar o passado" para 2024, o agente `frota` não reemite as chaves de 2026 e, como os EVENTOs não têm data, `podeFecharSozinho` os fecha como OBSOLETO. No ciclo diário, o mesmo quando o abastecimento sai da janela de 400 dias.
- **Mudar:** em `frota.ts`, `dataReferencia = data do último caso do mês`; em `engine.ts`, EVENTO sem data **não** fecha; ajustar o teste.

### 3. CRÍTICO — Achado RESOLVIDO cuja condição volta fica RESOLVIDO para sempre
- **Onde:** `engine.ts:210-213` (reabre só OBSOLETO); `engine.ts:355-437` (upsert não toca `status`); `supervisor.ts:379-384` (só escreve nota).
- **O que acontece:** um `CP-VENCIDO` marcado "resolvido" que continua vencido volta a ser emitido, `ocorrencias` sobe, a nota registra, mas o status fica RESOLVIDO — e tudo que filtra por ABERTO/EM_ANALISE não vê.
- **Mudar:** para achado ESTADO re-emitido com status RESOLVIDO e `resolvidoEm` anterior a esta rodada, reabrir como ABERTO com nota "resolvido por X em D; condição voltou em D2", evento na trilha, `observacaoTratativa` preservada. IGNORADO permanece. Métrica "reaberto após resolução" no BSC.

### 4. IMPORTANTE — Conciliação casa movimento com baixa de qualquer empresa, conta e natureza
- **Onde:** `agents/conciliacao.ts:68-84, 166-175, 229-239`; `supervisor.ts:185` (`temExtrato` = qualquer movimento no grupo).
- **Mudar:** exigir `b.conexaoId === m.conexaoId`; conta igual quando os dois lados informam; sinal coerente com a natureza; usar `lancamentoCCCodigo` também em `saidaSemTitulo`/`entradaSemTitulo`; extrato avaliado **por conexão** no supervisor.

### 5. IMPORTANTE — Cruzamentos por código sem a conexão
- `fiscal.ts:345-350` (`FI-NOTA-CANCELADA`), `:445-456` (`FI-NOTA-SEM-TITULO`), `:625-648` (`FI-ISS-RECOLHIDO-A-MENOR`), `contasReceber.ts:706-714` (`CR-OS-NAO-FATURADA`), `antifraude.ts:461-463` e `:999-1001` (`FR-CONTA-ALTERADA`, `FR-FORNECEDOR-NOVO-ALTO`), `padroes.ts:72-80` + `historico.ts:338-359` (séries das duas conexões fundidas pela mesma `chave`).
- **Mudar:** prefixar `conexaoId` em todas essas chaves; em `lerSeries` devolver `conexaoId` e agrupar por `${conexaoId}|${chave}` — ou recalcular `HistoricoMensal` na dimensão PARCEIRO por **documento**. Teste "mesmo código, parceiros diferentes" por regra.

### 6. IMPORTANTE — Saldo de caixa = saldo inicial + 400 dias de extrato; alimenta um achado CRÍTICO e o alerta por e-mail
- **Onde:** `agents/conciliacao.ts:423-433`; `contexto.ts:98-101`; `agents/fluxoCaixa.ts:124-154`; `alerta.ts:80-87`; `saldos.ts:148-151` (a tela usa lógica diferente).
- **Mudar:** unificar com `saldos.ts` (EXTRATO por conta quando o extrato cobre o saldo inicial; senão BAIXAS; senão "sem base") e não emitir `FC-SALDO-NEGATIVO`/`CB-SALDO-MINIMO` nem alertar sem base. Alternativa: espelhar o saldo atual da conta devolvido pela Omie.

### 7. IMPORTANTE — Uma escala de severidade para fraude e para perda, sobre materialidade consolidada
- **Onde:** `agents/comum.ts:60-76` (materialidade = 0,5% de todas as baixas do grupo, pagar e receber; CRÍTICA exige 10×). Regras de FRAUDE que usam `severidadePorValor` sem piso: `FR-CONTA-ALTERADA`, `FR-BAIXA-DESVIADA`, `FR-RECEBIVEL-CANCELADO`, `FR-CNPJ-RECENTE`, `FR-CADASTRO-E-PAGO`, `FR-NF-REPETIDA`.
- **Mudar:** `severidadeDeFraude(valor, materialidade)` = `severidadePorValor(valor, materialidade / 5)` com piso MÉDIA quando há dinheiro pago; materialidade por conexão; alinhar base "pago" com a documentação.

### 8. IMPORTANTE — Supervisor: consolidação entre agentes inerte e teto de críticos que rebaixa fraude sem valor
- **Onde:** `supervisor.ts:118-126, 396-415, 486-504`. O Controle 4 agrupa por `entidadeId` e os pares que deveria consolidar nunca coincidem; no teto de 5 críticos, `FR-CONTA-COMPARTILHADA` sem pagamento ainda perde a vaga para um `CP-VENCIDO`.
- **Mudar:** consolidar por chave de entidade normalizada; `entidadeId` nas regras de receber; nunca rebaixar categoria FRAUDE por volume.

### 9. IMPORTANTE — Achados de ESTADO com relógio próprio fecham sozinhos
- `PE-FANTASMA`, `PE-DIARIA-OUTLIER`, veículo inativo abastecendo, `FR-PAGAMENTO-NAO-UTIL`, `FR-CANCELADO-COM-BAIXA`, `FR-BAIXA-ANTECIPADA`, `FR-BAIXA-FUTURA`, `FR-BAIXA-DUPLICADA`: ESTADO com `chaveMes` — todo mês nasce chave nova e a anterior vira OBSOLETO.
- **Mudar:** os três primeiros → EVENTO com `dataReferencia`; nos agregados mensais, tirar `chaveMes` da chave ou incluí-los em `REGRAS_SEM_FECHAMENTO_AUTOMATICO`.

### 10. IMPORTANTE — Tributos: retenção sofrida e IRPJ/CSLL do Presumido sem regra
- A empresa como fonte retentora (INSS 11%, IRRF, ISS retido de prestadores) tem os valores no título a pagar e nenhuma regra os confronta com a guia do mês seguinte. IRPJ/CSLL trimestral não é comparado com receita × presunção × alíquota.
- **Mudar:** `FI-RETENCAO-NAO-RECOLHIDA` por competência, conexão e tributo; `FI-IRPJ-CSLL-PRESUMIDO` por trimestre, com tolerância e silêncio sem título de tributo na janela.

### 11. IMPORTANTE — `FR-FRACIONAMENTO` inerte e estreito
- Sem alçada cadastrada, devolve `[]`; com alçada, só títulos entre 80% e 100% do limite.
- **Mudar:** rodar com a sugestão P90 de `sugerirAlcadas` em severidade rebaixada enquanto não há alçada; testar "mesmo fornecedor, emissão em ±2 dias, N ≥ 2, soma > alçada".

### 12. IMPORTANTE — Cobertura de testes: 67 de 133 códigos de regra sem caso; sete agentes sem teste da função
- `auditarConciliacao`, `auditarFluxoCaixa`, `auditarCustos`, `auditarFiscal` (função principal), `auditarAdministrativo`, `auditarRentabilidade`, `auditarConformidade`, `contaBancariaAlterada`, `documentoInvalido`, `sugerirAlcadas` não são referenciados por nenhum script.
- **Mudar:** um caso positivo e um negativo por regra, começando pelas de FRAUDE e pelas de chave composta.

### 13. MELHORIA — Herança de "não se aplica" sem validade silencia famílias inteiras
- `supervisor.ts:259-267, 274-285`. Herança com prazo (ex.: 180 dias) e quebra quando a evidência cresce.

### 14. MELHORIA — `FR-CONTA-ALTERADA` usa a data do sync como data da troca e o valor cheio do título
- `omie/sync.ts:331`, `mapping.ts:290-303`. Ler `dAlt`/`uAlt` do parceiro; somar baixas com `dataBaixa ≥ alteração`.

### 15. MELHORIA — Feriados móveis ignorados
- `periodos.ts:131-138`. Calcular a Páscoa e derivar Carnaval, Sexta-feira Santa e Corpus Christi; lista de feriados municipais na configuração.

## 3. Lacunas de cobertura

| Teste de auditoria | Hoje | Dado que já existe | O que faltaria |
|---|---|---|---|
| Segregação de funções na Omie | `FR-EDITADO-APOS-BAIXA`, `FR-LANCAMENTO-MANUAL` | `usuarioInclusao/usuarioAlteracao` de título e contrato | Usuário da baixa e do cadastro do parceiro; papéis dos usuários Omie |
| Alçada de aprovação | `FR-FRACIONAMENTO` inerte; `OP-ALCADA` sugere | `limiteAlcadaCents` (nulo), distribuição dos pagamentos | Registro de aprovação |
| Fornecedor com contato de funcionário | Só CPF e conta compartilhada | `OmieParceiro.email/cidade/estado/contaBancariaHash` | Telefone/endereço/CEP do parceiro (a API devolve; `mapping.ts` não lê) |
| Partes relacionadas por sócio | `FR-CLIENTE-FORNECEDOR`; `FR-SOCIO-FUNCIONARIO` | `ParceiroReceita.socios`; `OmieConexao.cnpj` | Consultar os CNPJs do próprio grupo e cruzar sócios |
| Ativo imobilizado / venda de veículo | Nada (CFOP 5551/6551 excluído) | `OmieNota.cfop`, `Vehicle.status`, abastecimentos | Cadastro do ativo; viável: NF de venda sem título; veículo vendido ainda ATIVO ou abastecendo |
| Multas de trânsito por motorista | Nada | Títulos DETRAN/multa; escala | Data/placa da infração; desconto em folha |
| Combustível por km (uso real) | Só hodômetro do cupom | `usosDeVeiculo` já carregado | Nada: litros ÷ km do uso real |
| Pedágio | Nada | Títulos de pedágio por OS | Extrato por placa |
| Tributos retidos × recolhidos | `FI-ISS-RECOLHIDO-A-MENOR` (ISS próprio) | `retencao*Cents` em títulos a pagar | Achado 10 |
| Folha × fornecedores além de motoristas | Só `Driver` | — | Folha analítica/eSocial |
| Título cancelado depois de baixado | `FR-CANCELADO-COM-BAIXA` (só se a baixa permanece) | `OmieTituloVersao` | Versionar `cancelado`; detectar título que sumiu da listagem |

## 4. O que está bem feito

- `supervisor.ts` Controles 1, 2 e 7: suprimir família sem dado de base, descartar número impossível, escrever o porquê.
- `engine.ts` `podeFecharSozinho` separado, com quatro condições explícitas e testado; `agentesOk`; reabertura de OBSOLETO.
- `comum.ts` `chaveParceiro` por documento e `refTitulo` com conexão.
- `contasPagar.ts` `CP-PAGO-ACIMA` e `CP-DIVERGENCIA-BAIXA` calibradas com evidência.
- `contasReceber.ts` `CR-RETENCAO-PRESUMIDA`: aprende alíquotas da própria base.
- `antifraudeEstatistica.ts`: Benford de Nigrini; `FR-KICKBACK-CATEGORIA` com controle pela receita.
- `antifraudeFornecedor.ts`: raiz de CNPJ, exclusão de factoring/FIDC, "trocou, recebeu, voltou".
- `pessoal.ts`: condições de silêncio por cobertura de rastro; CPF sempre mascarado.
- `frota.ts`: cobertura de escala medida mês a mês; referência de preço sem o próprio posto.
- `fiscal.ts` CT-e por conexão; `contexto.ts`: título em aberto entra sempre; trilha append-only; credenciais fora do banco.

## 5. Ordem sugerida de implementação

1. Achado 1 (`FR-DOCUMENTO-INVALIDO`) — duas linhas + teste.
2. Achado 2 (EVENTO sem data / frota) — antes de qualquer "Auditar o passado".
3. Achado 3 (RESOLVIDO não reabre).
4. Achados 4 e 5 (conexão nas chaves) — uma passada só, com teste por regra.
5. Achado 6 (saldo) — antes de ligar o alerta por exceção.
6. Achados 7 + 8 (escala de fraude, materialidade por conexão, consolidação, teto de críticos).
7. Achado 9 (ESTADO com relógio próprio).
8. Achados 10 e 11 (regras novas com dado já espelhado).
9. Achado 12 (testes) em paralelo.
10. Achados 13–15 e as lacunas que dependem só de ler mais campos da API.
