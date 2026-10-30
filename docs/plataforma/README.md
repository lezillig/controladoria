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
- [x] ~~Migração única das planilhas aqui~~ — passou para a gestão (Cadastros › Veículos, importação da frota e de "Consórcios e Financiamentos").
- [ ] Ituran: relação oficial de placas e divergências — **aguardando acesso à API**.
- [ ] Sistema de ponto (TiqueTaque, hoje na gestão) como segunda fonte de pessoas e matrícula.
- [ ] Contratos e linhas ativos → `CadContrato`/`CadLinha` (+ centro `C-<número>`).
- [x] Edição manual dos registros: ficha do veículo, contratos e motoristas são editados na gestão.
- [ ] Veículos do sistema de multas como fonte (quando o banco do multas for ligado).

## Divisão com a gestão (Opção A, 30/10/2026)

A operação é da gestão de motoristas (`lezillig/gestao-motoristas`):
veículos e a ficha deles, documentos e vencimentos, apólices, FIPE, compra e
venda, motoristas (documentos, férias, aptidão para a escala), multas (LW,
indicação, termo, desconto em folha) e o cadastro dos contratos de
financiamento e consórcio. A controladoria é dona do lado financeiro e da
Omie:

- [x] Financiamentos e consórcios **da gestão** conferidos nas contas a pagar
  da Omie (`src/lib/frota/contratosDaGestao.ts`, `parcelasOmie.ts`): parcelas
  pagas, em atraso, a vencer e não lançadas; saldo para quitação por placa;
  pendências de atraso e de parcela não lançada para o Financeiro.
- [x] Integração para a gestão (`src/lib/integracao/gestao.ts`), com o
  `INTEGRACAO_TOKEN` no cabeçalho: `GET /api/integracao/financiamentos`
  (situação de cada contrato, `quitadoNaOmie` para a gestão encerrar e pedir a
  baixa do gravame), `POST /api/integracao/multas` (pagamento de cada AIT na
  Omie e títulos de multa sem AIT conhecido) e
  `POST /api/integracao/notas-de-compra` (a nota de cada veículo comprado).
- [x] Custo de propriedade por veículo na Rentabilidade: compra + adaptações
  da ficha da gestão, saldo pela Omie e juros pela taxa do contrato.
- [x] Multas assumidas pela empresa no custo do veículo (a decisão "quem
  paga" do fechamento da multa na gestão).
- [x] Custo por km de cada veículo e da frota na Rentabilidade, pelos km das
  viagens da Ituran que a gestão importa (ou dos check-ins).
- [x] Nota fiscal de cada veículo comprado conferida nas contas a pagar
  (`POST /api/integracao/notas-de-compra`).
- [x] A semana em revista no relatório de segunda para a diretoria:
  pendências esperando decisão (e as paradas há mais de 7 dias), achados que
  entraram e saíram, financiamentos em atraso na Omie.
- [ ] Contratos e linhas — em espera, a pedido (lembrete agendado).

As telas de frota, motoristas e multas que chegaram a existir aqui foram
retiradas (estão no histórico do git, commit `eb00aff`); as tabelas ficaram,
sem uso, para não haver migração destrutiva.
