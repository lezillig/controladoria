# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Comandos

```bash
npm run dev                # Next.js local (precisa de DATABASE_URL e DIRECT_URL com ?schema=controladoria)
npx tsc --noEmit -p .      # tipos
npx eslint src scripts     # lint (npm run lint roda só `eslint`)
npx next build             # build de produção (o postinstall roda `prisma generate`)
npx prisma migrate deploy  # aplica migrações (usa DIRECT_URL; o build da Vercel faz isso antes do next build)
```

Testes são scripts `tsx` puros, sem framework e sem banco — cada um imprime `ok`/`FALHA` por caso e sai com código 1 se algo falhar. Rodar um conjunto: `npm run teste:calibragem` (idem `cte`, `acessos`, `antifraude`, `dre`, `engine`, `historico`, `padroes`, `alerta`, `previsao`, `limpeza`, `frota`). Não há "rodar um caso só": edite o script ou filtre a saída com `grep`. `teste:sql` e `teste:limpeza` precisam de um Postgres real em `TESTE_DATABASE_URL` e se auto-pulam sem ela (instruções no topo de `scripts/teste-sql.ts`). O GitHub Actions (`.github/workflows/testes.yml`) roda tipos, lint e todos os conjuntos a cada push em `main`.

Migrações são escritas à mão em `prisma/migrations/<timestamp>_<nome>/migration.sql` (não há banco de dev com `migrate dev`); edite `schema.prisma` junto e rode `npx prisma generate`.

## Arquitetura

Sistema de controladoria/auditoria de um grupo de transporte (duas empresas, duas contas Omie). Espelha o ERP Omie em D-1 no schema Postgres `controladoria`, roda agentes de auditoria determinísticos sobre o espelho, revisa os achados com um supervisor e os persiste como `AuditFinding`. Lê em somente-leitura o schema `public` do sistema irmão de gestão de motoristas (login, motoristas, veículos, abastecimentos) — só via `src/lib/gestao/leitura.ts`, nunca por modelo Prisma. `docs/controladoria.md` é a referência conceitual completa; `README.md` traz variáveis de ambiente e primeiros passos.

**Ciclo diário** (`src/lib/controladoria/ciclo.ts`): máquina de estados com cursor persistido em `OmieSyncRun`. Por conexão: `cadastros → titulos → movimentos → notas` (`src/lib/omie/sync.ts`, respostas normalizadas por `mapping.ts` com busca tolerante de nomes de campo). Depois que todas as conexões terminam, uma execução consolidada (`conexaoId = null`) roda `auditoria → relatorio`. Cada invocação trabalha ~40 s e se reencadeia (`encadear.ts`); o cron da Vercel (`vercel.json`, 06:10 UTC) e o botão "Sincronizar agora" chamam o mesmo `executarPasso`. `obterOuCriarRun` identifica a consolidação do dia por `janelaFim = fimDoDia(dataReferenciaPadrao())`; "Rodar a auditoria de novo" apaga exatamente essa linha.

**Contexto** (`contexto.ts`, `carregarContexto`): o único retrato dos dados que agentes, relatório e telas usam — telas passam por `contextoDaPagina` em `src/app/(app)/_dados.ts`, que também checa a permissão. Janela: `janelaDeAuditoria` (início do ano corrente, ou mês anterior em janeiro) para títulos por vencimento/emissão, mais todo título em aberto; as baixas acompanham os títulos carregados. Traz ainda a base de materialidade de 12 meses (`HistoricoMensal`) e a última execução por conexão.

**Agentes** (`agents/*.ts`, registrados em `registry.ts`): funções puras `ContextoAuditoria → AchadoNovo[]`, uma por área/dono. Cada achado tem `regra`, `tipo` (`ESTADO` some sozinho quando a condição some; `EVENTO` é fato consumado), `chave` determinística (`chaveAchado(regra, ...partes)`) que reencontra o achado na execução seguinte, e `evidencia` (JSON livre, renderizado por `Evidencia` em `_componentes.tsx` — chaves que casam `CHAVE_DE_DINHEIRO` viram R$; contagens usam nomes como `quantidade`). Helpers em `agents/comum.ts` (`materialidadeCents`, `chaveParceiro` por CNPJ/CPF entre empresas, `severidadePorValor`).

**Supervisor** (`supervisor.ts`): suprime regras sem dado de base, consolida regras equivalentes, herda tratativa humana por `chaveDeTratativa` (regra + entidade; regras em `REGRAS_AGREGADAS` herdam pela regra), rebaixa por volume (`MAXIMO_ACHADOS_POR_REGRA`, piso BAIXA) e atribui `confianca`.

**Motor** (`engine.ts`, `executarAuditoria`): persiste por upsert em `chave` sem tocar status/tratativa; fecha como `OBSOLETO` o que não reapareceu (`podeFecharSozinho`: ESTADO sempre, EVENTO só quando a data do fato cai na janela `[janelaDesde, janelaAte]` que a auditoria acabou de reavaliar, exceto `REGRAS_SEM_FECHAMENTO_AUTOMATICO`); reabre OBSOLETO re-emitido. Só a referência do dia persiste — `relatorios/actions.ts` não roda a auditoria para data passada. **Auditoria retroativa** (`retroativa.ts`, botão na tela de sincronização): carrega um ano fechado (`carregarContexto` com `ate` e `operacaoCompleta`) e roda o motor com `{ retroativa: true }` — só EVENTO é persistido, ESTADO não é gravado nem fechado.

**Frota** (`agents/frota.ts`): antifraude do combustível sobre o extrato do cartão da gestão, cruzado com escala, uso real e ANP (leituras opcionais em `leitura.ts` — `lerOpcional` não derruba a disponibilidade da gestão quando falta GRANT; a tela de sincronização lista o que falta). Achados por veículo e mês; a janela é a do contexto (400 dias no ciclo, o ano pedido na retroativa).

**Receita Federal** (`src/lib/receita/`): `cliente.ts` consulta o cadastro público de CNPJ pela BrasilAPI (sem chave; 400 ms entre chamadas, 10 s de timeout, 404 = não encontrado, 429/5xx = tentar depois; o JSON bruto nunca vai ao log) e `enriquecer.ts` preenche `ParceiroReceita` aos poucos — fornecedores PJ ativos com título a pagar em 400 dias, em ordem de maior valor pago, reconsulta a cada 30 dias (1 dia após erro). Roda como fase `receita` da consolidação (antes de `auditoria`, ~15 s) e pelo botão "Consultar Receita agora" da tela de sincronização (60 s por rodada, em laço). `ParceiroReceita` não tem `companyId` de propósito (dado público por CNPJ, como `AnpPrecoReferencia` na gestão). O contexto expõe `ctx.receita` (só os CNPJs de `ctx.parceiros`); as regras em `agents/antifraudeReceita.ts` (FR-CNPJ-IRREGULAR, FR-CNPJ-RECENTE, FR-CNAE-INCOMPATIVEL, FR-SOCIO-FUNCIONARIO, FR-MEI-ACIMA-DO-TETO) ficam caladas sem consulta; testes em `teste:receita`.

**Calibragem** é feita por evidência real: cada ajuste de regra nasce de um "Ver evidência" e ganha um caso em `scripts/teste-calibragem.ts` (fixtures `titulo()`, `baixa()`, `parceiro()`, `contexto()`). Regras que agregam por entidade entram em `REGRAS_AGREGADAS`.

**IA**: `aiAnalyst.ts` (narrativa do relatório, `claude-fable-5-1`, saída estruturada), `investigador.ts` (perguntas com ferramentas somente-leitura, `claude-sonnet-5`, rodadas persistidas em `Investigacao`; `propor_tratativa` só propõe — a pessoa aplica pela ação `tratarAchado`), `conformidade/analise.ts`. Consulte a skill `claude-api` antes de mexer em chamadas ao modelo.

**Segurança**: toda página e toda função exportada de `actions.ts` começa por `exigirPermissao(<permissao>)` (catálogo em `src/lib/acessos.ts`); toda consulta por id vinda de formulário é escopada por `companyId`. Arquivos `"use server"` só exportam ações — a trilha (`registrarEvento`) mora em `src/lib/controladoria/trilha.ts`. Credenciais da Omie ficam só em variáveis de ambiente (`OMIE_APP_KEY_<APELIDO>`); o banco guarda o nome (`credencialRef`), única na instalação. CPF sempre mascarado (`fmtDocumento`); dados bancários só como hash; erros passam por `sanitizeErro`/`redigir` antes de persistir ou exibir. SQL cru só com template tag parametrizado. O cron valida `CRON_SECRET` com `timingSafeEqual`; `/api/ciclo/continuar` autentica por sessão.

**Convenções**: código e comentários em português; comentários explicam o *porquê* e o caso real que motivou a decisão. Datas são gravadas à meia-noite local do servidor (UTC na Vercel) — `dataReferenciaPadrao` é D-1 em Brasília com deslocamento fixo de −3 h. Valores monetários são inteiros em centavos (`*Cents`). Achados e telas mostram sempre a empresa de origem (`conexaoApelido`).

## Validação completa

`.claude/agents/validacao-sistema.md` descreve a conferência de ponta a ponta (testes, build, revisão de segurança, auditoria do motor, QA funcional local com Playwright e um Postgres em `55432`).
