# Plataforma única — Azul Mob

Gestão de motoristas + gestão de multas + controladoria + o plano do
repositório `lezillig/azul-gestao`, num sistema só. **A base é este
repositório** (decisão de 30/10/2026): mesmo deploy, domínio e banco da
controladoria, para a unificação não parar a sincronização da Omie.

Os documentos do azul-gestao estão copiados aqui, como vieram:

| Arquivo | Conteúdo |
|---|---|
| `visao-original.md` | O CLAUDE.md do azul-gestao: objetivo, regras de ouro, contexto de negócio |
| `docs/01-arquitetura.md` | Arquitetura e ADRs |
| `docs/02-modelo-de-dados.md` | Entidades por domínio |
| `docs/03-backlog-por-fase.md` | As 7 fases e os critérios de pronto |
| `docs/04-padrao-de-agentes.md` | Como todo agente é construído |
| `specs/01..08-*.md` | Uma spec por módulo |
| `schema-referencia.sql` | A DDL de referência (não é aplicada; o banco é migrado pelo Prisma) |

## Decisões tomadas na adaptação

- **ADR-002 (stack): resolvido pela regra do próprio ADR.** A controladoria
  existente é Next.js 16 + TypeScript + Prisma + Postgres (Neon) na Vercel,
  com ~60 migrações em produção e ~20 agentes de auditoria. A plataforma herda
  essa stack; não há FastAPI/Python.
- **Domínios como prefixo de tabela, não schema Postgres** (`Cad*`, `Frota*`,
  `Aud*`…). O Prisma deste projeto opera no schema da URL de conexão; mover
  para schemas reais fica para quando os bancos da gestão e do multas forem
  migrados para este. O que o ADR-001 pede — um banco, cruzamento entre frota,
  pessoas e financeiro — vale desde já.
- **Convenções do código existente**: campos em camelCase (`dataVencimento`,
  não `data_vencimento`), dinheiro em centavos (`BigInt`/`Int`), `companyId`
  em toda tabela (o sistema é multiempresa: AZUL e MCZ no mesmo grupo).
- **Integrações (ADR-003)**: os adaptadores ficam em `src/lib/` (Omie em
  `src/lib/omie`, gestão em `src/lib/gestao`, PNCP em `src/lib/radar`), com
  rate limit, retentativa e normalização. Expor como servidor MCP é um passo
  posterior, sobre os mesmos adaptadores.
- **Trilha de auditoria** (`AudLog`, `src/lib/auditoria/trilha.ts`): CPF vai
  mascarado — a trilha é lida por mais gente que o cadastro de pessoas.
- **Pendências** (`AudPendencia`, `src/lib/auditoria/pendencias.ts`): perfil
  aprovador ↔ acesso: ADMIN decide tudo; GESTOR decide `gestor`/`operacao`;
  CONTROLADORIA decide `financeiro`; FOLHA decide `rh`; ou um perfil de
  acesso com o nome do perfil aprovador (ex.: "Financeiro"), sempre com a
  permissão "Aprovar ou rejeitar pendências".

## Fase 0 — situação

- [x] Decidir stack definitiva (ADR-002).
- [x] Modelo do cadastro mestre, `FrotaFinanciamento`, `AudLog`, `AudPendencia` (migração `20261030120000_cadastro_mestre`, só tabelas novas).
- [x] Normalização de placa/CPF/CNPJ com dígito verificador (`src/lib/cadastro/normalizacao.ts`).
- [x] Carga a partir das fontes já ligadas: parceiros da Omie (as duas empresas) → cliente/fornecedor; motoristas da gestão → pessoa; veículos da gestão → veículo (`src/lib/cadastro/carga.ts`). Cria e completa; divergência vira relatório.
- [x] Centro de custo `V-<placa>` para cada veículo; pendência única para o financeiro criar na Omie.
- [x] Telas: Cadastro mestre, Pessoas (CPF mascarado), Pendências (aprovar/rejeitar com trilha).
- [ ] Importar planilha "CONTROLE INFORMAÇÕES GERAIS" (FROTA ATIVA + VENDIDOS) → veículo — **aguardando a planilha**.
- [ ] Importar "Consórcios e Financiamentos" → `FrotaFinanciamento` — **aguardando a planilha**.
- [ ] Ituran: relação oficial de placas e divergências — **aguardando acesso à API**.
- [ ] Sistema de ponto (TiqueTaque, hoje na gestão) como segunda fonte de pessoas e matrícula.
- [ ] Contratos e linhas ativos → `CadContrato`/`CadLinha` (+ centro `C-<número>`).
- [ ] Edição manual dos registros na tela (com trilha).
- [ ] Veículos do sistema de multas como fonte (quando o banco do multas for ligado).
