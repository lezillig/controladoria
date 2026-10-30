# 01 — Arquitetura

## Visão geral

```
┌──────────────────────────────────────────────────────────────┐
│                        FONTES EXTERNAS                       │
│   Omie (ERP)      Ituran (rastreamento)     Ponto (jornada)  │
│   PNCP (licitações)   E-mail contasapagar@   Planilhas legadas│
└───────┬──────────────────┬──────────────────────┬────────────┘
        │ MCP omie         │ MCP ituran           │ MCP ponto
        ▼                  ▼                      ▼
┌──────────────────────────────────────────────────────────────┐
│                    CAMADA DE INTEGRAÇÃO (mcp/)               │
│  Servidores MCP expõem tools; usados pela API, pelos agentes  │
│  e pelo Claude em conversa. Só leitura por padrão; escrita   │
│  explícita e logada.                                          │
└───────────────────────────┬──────────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                  POSTGRES ÚNICO (schemas por domínio)         │
│ cadastro │ compliance │ pessoas │ operacao │ frota │          │
│ financeiro │ comercial │ auditoria                            │
└───────┬───────────────────────┬──────────────────────┬───────┘
        ▼                       ▼                      ▼
┌───────────────┐   ┌───────────────────┐   ┌───────────────────┐
│ API (app/)    │   │ AGENTES (agents/) │   │ RELATÓRIOS        │
│ FastAPI, CRUD │   │ jobs agendados,   │   │ (reports/) SQL +  │
│ por módulo    │   │ regras + LLM só   │   │ dashboards HTML   │
│               │   │ para exceções     │   │                   │
└───────────────┘   └─────────┬─────────┘   └───────────────────┘
                              ▼
                    ┌───────────────────┐
                    │ PENDÊNCIAS        │  ← humano aprova/rejeita
                    │ + ALERTAS (e-mail)│
                    └───────────────────┘
```

## Componentes

| Componente | Responsabilidade | Onde |
|---|---|---|
| Banco | Fonte única da verdade; histórico; auditoria | `db/` |
| API | CRUD, validações, regras de negócio síncronas | `app/` |
| MCP | Adaptadores para sistemas externos, com contrato estável de tools | `mcp/` |
| Agentes | Rotinas periódicas: coletar → comparar → apontar exceção → pendência/alerta | `agents/` |
| Relatórios | KPIs e dashboards lidos do banco | `reports/` |
| Pendências | Fila única de decisões humanas (aprovação, correção, ciência) | `auditoria.pendencia` |

## Decisões de arquitetura (ADRs)

### ADR-001 — Um banco, vários schemas (não um banco por módulo)
**Contexto**: módulos atuais têm bancos separados; preocupação com performance ao unificar.
**Decisão**: um PostgreSQL com schema por domínio. Para ~200 veículos, ~300 pessoas e dezenas de contratos, o volume é pequeno (milhões de linhas só em telemetria, e essa fica em tabela própria particionada por mês). O custo real de bancos separados é não conseguir cruzar frota × pessoas × financeiro, que é exatamente o que gera gestão.
**Consequência**: módulos novos nascem no banco único; módulos existentes migram na Fase 0 (ou ficam como fonte externa via MCP até migrarem).

### ADR-002 — Stack Python/FastAPI, salvo se a controladoria existente impuser outra
**Contexto**: já existe conector PHP da Omie e um sistema de controladoria construído no Claude Code.
**Decisão**: a plataforma nova usa Python (FastAPI + SQLAlchemy + Alembic) porque servidores MCP e agentes já estão nessa linguagem. **Antes da Fase 0, verificar a stack da controladoria**: se viável, trazê-la para este repositório como módulo `financeiro`; se não, mantê-la como sistema externo lendo/escrevendo no mesmo Postgres.
**Consequência**: evitar duas stacks concorrentes para o mesmo domínio.

### ADR-003 — Integrações sempre via MCP
**Decisão**: nenhum módulo chama API externa diretamente; chama a tool do servidor MCP correspondente. O servidor encapsula autenticação, paginação, rate limit e normalização.
**Consequência**: o mesmo conector serve a API, os agentes e o Claude em conversa; trocar fornecedor (ex.: outro rastreador) muda um lugar só.

### ADR-004 — Regras são código; LLM só para exceção e redação
**Decisão**: comparar odômetro, detectar vencimento, validar NF contra OS, conferir jornada: tudo em SQL/Python determinístico e testável. O LLM entra para (a) interpretar documentos não estruturados (PDF de NF, e-mail), (b) classificar e priorizar exceções, (c) redigir mensagens e relatórios.
**Consequência**: resultados reproduzíveis, auditáveis e baratos.

### ADR-005 — Agentes nunca executam ação financeira ou trabalhista sem aprovação
**Decisão**: pagamento, lançamento na Omie, desconto em folha, indicação de condutor em multa, bloqueio de motorista → o agente cria `pendencia` com proposta e evidências; um humano aprova na interface; só então a ação executa (e é logada).
**Consequência**: a fila de pendências é a tela mais importante do sistema.

### ADR-006 — Chaves naturais e sem exclusão física
**Decisão**: placa, CPF, CNPJ e número de contrato são únicos e imutáveis; registros são desativados, nunca apagados.

### ADR-007 — Telemetria bruta separada de eventos de negócio
**Decisão**: posições da Ituran entram em `operacao.posicao` (particionada por mês, retenção 13 meses). Agentes derivam **eventos** (`operacao.evento_viagem`: início, fim, atraso, desvio) que são o que relatórios e SLA usam.

## Segurança e acesso

- Perfis: `admin`, `gestor`, `operacao`, `financeiro`, `rh`, `leitura`.
- Cada pendência tem perfil aprovador obrigatório (ex.: pagamento → `financeiro`).
- Segredos em `.env`; servidores MCP ligados a `127.0.0.1` por padrão.
- Toda escrita passa pelo helper de auditoria (`app/core/audit.py`).

## Ambientes

- `dev` (local, banco Docker), `prod` (servidor da empresa ou VPS; a definir). Backups diários do Postgres com retenção 30 dias; teste de restauração mensal (isto também é um controle).
