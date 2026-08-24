# Separar Controladoria e Gestão em bancos diferentes

Passo a passo operacional. Não é código: são comandos de banco e mudanças de
variável de ambiente, executados por uma pessoa com acesso ao Neon e à Vercel.

---

## Situação de hoje

O diagnóstico da tela de Sincronização mostrou o arranjo real:

```
banco: neondb
  ├── public          38 tabelas   gestão de motoristas + sobras antigas da Controladoria
  ├── controladoria   24 tabelas   Controladoria (46.014 títulos)
  └── neon_auth        9 tabelas
```

Os dois sistemas estão **no mesmo banco**, separados por schema. A separação é
lógica, não física: a credencial de um alcança o schema do outro, a menos que o
papel do banco restrinja — e hoje não restringe.

O objetivo aqui é ter **dois bancos**, cada sistema no seu.

---

## Duas decisões antes de começar

### 1. Qual lado se move?

**Move a Controladoria.** A gestão é o sistema operacional — tem gente usando
todo dia, e é a frota. A Controladoria é um espelho somente-leitura do Omie
mais os achados de auditoria: se algo der errado no meio do caminho, o pior
caso é ressincronizar.

Não é indolor — a carga histórica são 38 janelas, horas de sincronização — mas
é recuperável, e a gestão não é. Por isso o procedimento abaixo copia em vez de
ressincronizar: achados de auditoria, documentos de conformidade, metas do BSC e
configuração **não** vêm do Omie e não se recuperam sozinhos.

### 2. Banco novo no mesmo projeto Neon, ou projeto novo?

| | Mesmo projeto, banco novo | Projeto novo |
|---|---|---|
| Esforço | Baixo | Médio |
| Cross-database | Impossível (é o que se quer) | Impossível |
| Papéis / credenciais | Compartilhados no projeto — exigem `REVOKE CONNECT` | Separados por construção |
| Compute e faturamento | Compartilhados | Separados |

**Recomendo o banco novo no mesmo projeto** como primeiro passo: resolve a
mistura de dados, é reversível, e o isolamento de credencial se obtém com um
`REVOKE`. Projeto separado é mais forte e pode vir depois, sem refazer nada
disto.

---

## O que NÃO muda

A Controladoria **continua lendo dados da gestão** — motoristas, veículos,
clientes, abastecimentos — para o custo por contrato e por veículo, e para
autenticar o login. Isso não é um problema: o sistema já tem um cliente de banco
separado para a gestão (`GESTAO_DATABASE_URL`). Depois da separação ele passa a
apontar para o banco da gestão, com um papel somente-leitura.

Ou seja: **dois bancos, duas conexões, nenhum JOIN entre eles.** É assim que o
código já está escrito.

---

## Antes de começar

- [ ] A carga histórica está **concluída** (Sincronização mostra 38 de 38).
- [ ] Escolha uma janela **fora do ciclo diário** — ele roda às 6h10.
- [ ] Ninguém vai clicar em *Sincronizar agora* durante a cópia. Dado gravado
      depois do dump se perde na virada.
- [ ] Você tem acesso ao console do Neon e às variáveis de ambiente do projeto
      `controladoria` na Vercel.
- [ ] `pg_dump` e `pg_restore` instalados na máquina que vai rodar (versão 16 ou
      superior).

> **Não cole string de conexão em chat, e-mail ou ticket.** Use variáveis de
> ambiente locais, como nos comandos abaixo.

---

## Fase 1 — Criar o banco novo

No console do Neon, no projeto que hoje contém `neondb`:

1. **Databases** → **New Database**
2. Nome: `controladoria`
3. Owner: crie um papel novo, `controladoria_app` (não reaproveite o papel da
   gestão — reaproveitar é o que faz a separação não separar nada)

Guarde a string de conexão do banco novo. Ela vai ser usada nas fases 2 e 4.

---

## Fase 2 — Copiar o schema

Na sua máquina, com as duas strings em variáveis de ambiente:

```bash
export ORIGEM="postgresql://...neondb..."          # banco atual
export DESTINO="postgresql://...controladoria..."  # banco novo

# Dump só do schema da Controladoria, sem dono e sem permissões:
# o papel do banco novo é outro, e carregar as permissões antigas junto faria
# o restore falhar em cascata por papel inexistente.
pg_dump "$ORIGEM" \
  --schema=controladoria \
  --no-owner --no-privileges \
  --format=custom \
  --file=controladoria.dump

# Confira que o arquivo não saiu vazio antes de seguir.
ls -lh controladoria.dump

pg_restore \
  --no-owner --no-privileges \
  --dbname="$DESTINO" \
  controladoria.dump
```

**O nome do schema continua `controladoria` no banco novo.** É de propósito:
assim a URL da aplicação mantém `?schema=controladoria` e nada no código muda.
Renomear para `public` seria uma mudança a mais para dar errado, sem ganho.

Guarde o arquivo `controladoria.dump` até a fase 7 terminar.

---

## Fase 3 — Conferir antes de virar a chave

Rode **nos dois bancos** e compare linha a linha:

```sql
SELECT 'OmieTitulo'    AS tabela, count(*) FROM controladoria."OmieTitulo"
UNION ALL SELECT 'OmieBaixa',              count(*) FROM controladoria."OmieBaixa"
UNION ALL SELECT 'OmieNota',               count(*) FROM controladoria."OmieNota"
UNION ALL SELECT 'OmieParceiro',           count(*) FROM controladoria."OmieParceiro"
UNION ALL SELECT 'OmieSyncRun',            count(*) FROM controladoria."OmieSyncRun"
UNION ALL SELECT 'AuditFinding',           count(*) FROM controladoria."AuditFinding"
UNION ALL SELECT 'ConformidadeDocumento',  count(*) FROM controladoria."ConformidadeDocumento"
UNION ALL SELECT 'BscMeta',                count(*) FROM controladoria."BscMeta"
UNION ALL SELECT 'ControladoriaConfig',    count(*) FROM controladoria."ControladoriaConfig"
ORDER BY 1;
```

E confirme que o histórico de migrações veio junto — sem ele, a próxima
publicação tenta aplicar tudo de novo:

```sql
SELECT count(*) FROM controladoria._prisma_migrations WHERE finished_at IS NOT NULL;
```

**Se qualquer contagem divergir, pare aqui.** Nada foi trocado ainda; refaça a
fase 2.

---

## Fase 4 — Virar a chave

Na Vercel, projeto **controladoria** → Settings → Environment Variables:

| Variável | Novo valor |
|---|---|
| `DATABASE_URL` | banco novo, **com** `?schema=controladoria` |
| `DIRECT_URL` | banco novo, **com** `?schema=controladoria` |

**As duas.** `DIRECT_URL` é a que o `prisma migrate deploy` usa na publicação.
Trocar só `DATABASE_URL` faz as migrações continuarem indo para o banco antigo
enquanto a aplicação lê o novo — e o resultado é um banco que fica para trás em
silêncio, que é exatamente o defeito que custou uma semana aqui.

Se `DATABASE_URL` usar a URL *pooled* do Neon, mantenha o padrão: `DIRECT_URL`
aponta para a *unpooled*, do mesmo banco novo.

Depois: **Redeploy**.

---

## Fase 5 — Acesso de leitura à gestão

Agora a Controladoria precisa de uma porta para o banco da gestão. No banco
**antigo** (`neondb`), rode o script que já está no repositório:

```
docs/papel-leitura-gestao.sql
```

Ele cria o papel `controladoria_leitura` com `GRANT SELECT` em exatamente seis
tabelas — `User`, `Company`, `Driver`, `Vehicle`, `Cliente`, `FuelTransaction` —
e revoga o resto, inclusive para tabelas criadas no futuro. Traz uma consulta de
verificação no fim.

Depois, na Vercel, projeto **controladoria**:

| Variável | Valor |
|---|---|
| `GESTAO_DATABASE_URL` | `neondb`, com o papel `controladoria_leitura` |

Redeploy.

> **Não toque nas variáveis do projeto da gestão.** Elas são gerenciadas pela
> integração do Neon: *Rotate Integration Secrets* e *Delete* ali derrubam o
> sistema de gestão.

---

## Fase 6 — Validar

Na Controladoria, em ordem:

1. **Login** — se entra, a leitura da gestão está funcionando. É o teste mais
   direto: a autenticação confere o usuário no cadastro da gestão.
2. **Sincronização → "Onde o banco está olhando"** — deve mostrar o banco novo,
   e os dois caminhos de consulta lendo a mesma tabela.
3. **Sincronização → volume espelhado** — os números batem com a fase 3.
4. **Resultado mês a mês**, julho/2026, AZUL — faturamento por emissão perto de
   R$ 7,02 milhões.
5. **Custos e DRE** — se abrir com dados, a leitura da gestão está completa.
6. **Sincronizar agora** — uma rodada, para confirmar que a gravação funciona no
   banco novo.

Se algo falhar, a volta é imediata: reponha os valores antigos de
`DATABASE_URL` e `DIRECT_URL` e faça redeploy. O banco antigo continua intacto
até a fase 7.

---

## Fase 7 — Limpar (só depois de alguns dias rodando)

Espere pelo menos **uma semana** com o ciclo diário fechando no banco novo. Aí:

### 7a. Remover o schema antigo da Controladoria

```sql
-- No banco ANTIGO (neondb). Confira o nome do banco antes de rodar.
DROP SCHEMA controladoria CASCADE;
```

### 7b. Remover as sobras em `public`

A tela de Sincronização lista quais são, com a estimativa de linhas de cada uma.
**Não rode um `DROP` genérico**: `public` é onde vive a gestão de motoristas, e
apagar a tabela errada ali não é um susto — é a frota.

Peça a lista da tela e apague **uma por uma**, conferindo o nome:

```sql
DROP TABLE public."OmieTitulo";
DROP TABLE public."OmieBaixa";
-- ... só as que a tela listar
```

### 7c. Fechar a porta

```sql
-- No banco da GESTÃO: o papel da Controladoria não precisa conectar nele
-- para nada além da leitura já concedida.
REVOKE CONNECT ON DATABASE neondb FROM controladoria_app;

-- No banco da CONTROLADORIA: o papel da gestão não tem o que fazer ali.
REVOKE CONNECT ON DATABASE controladoria FROM <papel_da_gestao>;
```

É este passo que transforma "dois bancos" em "dois bancos separados". Sem ele, a
divisão é de arrumação, não de segurança.

---

## Resumo do que muda

| | Antes | Depois |
|---|---|---|
| Banco da Controladoria | `neondb`, schema `controladoria` | banco próprio |
| Banco da gestão | `neondb`, schema `public` | inalterado |
| Leitura da gestão | mesma conexão | `GESTAO_DATABASE_URL`, papel somente-leitura |
| Credencial cruzada | possível | revogada |
| Código da aplicação | — | **nenhuma mudança** |

A última linha é o ponto: o sistema já foi escrito para isso. O cliente da
gestão é separado, as consultas são qualificadas por schema, e a URL de cada
banco vem do ambiente. A separação é de infraestrutura, não de código.
