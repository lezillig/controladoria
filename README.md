# Controladoria

Sistema de controladoria, auditoria e financeiro do grupo, integrado à Omie.

Espelha o ERP em D-1, roda onze agentes de auditoria sobre os dados, revisa os
achados com uma camada supervisora, mede um Balanced Scorecard e envia todo dia
um relatório gerencial e executivo por e-mail — que abre igual no computador e
no celular.

Recebe também os **relatórios de risco da consultoria** — basta encaminhar o
e-mail: o menu Conformidade lê o corpo e os anexos juntos, guarda o arquivo
original, transforma o conteúdo em apontamentos com base legal, prazo e
responsável, e cruza cada um com o que os agentes veem nos dados — mostrando o
que as duas leituras confirmam, o que se repete há meses e o que só a revisão
externa enxerga. Traz também o plano de **transição para o Lucro Real em
janeiro de 2027**, com o que muda na reforma tributária, o que a operação pode
creditar antes e depois, e por que fretamento é tratado de forma diferente do
transporte público.

Atende **mais de uma empresa** (mais de um CNPJ, cada uma com sua conta Omie):
os números aparecem consolidados, sempre com a empresa de origem identificada, e
dá para filtrar por uma delas.

## Stack

Next.js 16 + Prisma 6 (PostgreSQL) + Tailwind v4.

## Relação com o sistema de gestão de motoristas

São **sistemas independentes**: repositórios, deploys e logins separados. O que
compartilham é o banco Postgres — este sistema vive no schema `controladoria` e
lê, em **somente leitura**, algumas tabelas do schema `public` (motoristas,
veículos, contratos, abastecimentos, usuários).

Essa leitura é o que mantém vivos os cruzamentos que dão valor à auditoria:

- combustível pago na Omie contra o extrato do cartão de frota;
- fornecedor cujo CNPJ/CPF é de um funcionário da folha;
- custo por veículo e por funcionário.

Ela passa por um arquivo só (`src/lib/gestao/leitura.ts`), com consultas
explícitas — nunca por modelo do Prisma. Modelar aqui uma tabela de que este
sistema não é dono seria convite para o dia em que uma migração daqui tentasse
alterá-la.

O login também vem de lá: mesmo usuário e senha da gestão. Ganha-se credencial
única e, principalmente, **desligamento único** — quem é desativado lá perde o
acesso ao financeiro no mesmo ato.

## Desenvolvimento local

```bash
npm install
npx prisma migrate dev
npm run dev
```

Requer `DATABASE_URL` apontando para o Postgres **com o schema no fim**:

```
postgresql://usuario:senha@host/banco?schema=controladoria
```

Se a URL já tiver parâmetros (ex.: `?sslmode=require`), use `&schema=controladoria`.

## Variáveis de ambiente

| Variável | Obrigatória | Para quê |
|---|---|---|
| `DATABASE_URL` | sim | Postgres, com `schema=controladoria` |
| `JWT_SECRET` | sim | assina a sessão (pode ser o mesmo da gestão) |
| `CRON_SECRET` | sim | autentica a rota agendada |
| `OMIE_APP_KEY_<APELIDO>` | por conexão | credencial da conta Omie daquela empresa |
| `OMIE_APP_SECRET_<APELIDO>` | por conexão | idem |
| `RESEND_API_KEY` | para enviar | envio do relatório diário |
| `EMAIL_REMETENTE` | não | remetente; o domínio precisa estar verificado no Resend |
| `ANTHROPIC_API_KEY` | não | leitura executiva por IA no relatório |
| `APP_URL` | não | link do e-mail para o painel |
| `OMIE_DATA_INICIO_BASE` | não | início da carga histórica (padrão `2025-01-01`) |
| `RELATORIO_EMAILS` | não | destinatário padrão na primeira execução |
| `OMIE_PACE_MS` | não | espaçamento entre chamadas à Omie (padrão 350 ms) |

O `<APELIDO>` é o que se cadastra na tela **Conexões Omie**: a conexão `AZUL`
procura `OMIE_APP_KEY_AZUL` e `OMIE_APP_SECRET_AZUL`. A chave em si **nunca** é
gravada no banco — o cadastro guarda apenas o nome da variável.

## Deploy

Publicado na Vercel. O `vercel.json` roda `prisma migrate deploy` antes do
build, então a migração é aplicada a cada push — inclusive a criação do schema
`controladoria` na primeira vez.

Um agendamento diário: `10 6 * * *` UTC (03:10 de Brasília) roda o ciclo —
sincroniza cada empresa e audita o grupo. A geração do relatório é a última
etapa e só acontece com **Relatório diário automático** ligado no modelo de
gestão; ele nasce desligado, para a fase de integração espelhar e conferir sem
produzir documento com data sobre uma base ainda incompleta.

## Primeiros passos depois do deploy

1. Entrar com o mesmo login da gestão de motoristas
2. **Conexões Omie** → cadastrar uma conexão por empresa do grupo
3. **Conexões Omie → Testar a integração** — consulta cada endpoint sem gravar nada e mostra, por endpoint, se respondeu, quantos registros vieram e quais campos o mapeamento não conseguiu preencher. É onde um nome de campo divergente aparece antes de virar coluna vazia no relatório.
4. **Sincronização → Sincronizar agora** — a carga histórica roda em segundo plano
5. Conferir **Sincronização → Preenchimento dos campos** (ver `docs/controladoria.md`, seção 10)
6. **Modelo de gestão** → cadastrar a alçada de aprovação (a tela sugere valores a partir dos próprios pagamentos)
7. **Conformidade** → enviar o relatório da consultoria do último mês (opcional, mas é a partir do segundo que a reincidência aparece)
8. Quando os números fecharem, ligar **Modelo de gestão → Relatório diário automático** — ele nasce desligado, para não gerar histórico sobre uma base ainda incompleta

## Documentação

[`docs/controladoria.md`](docs/controladoria.md) — estrutura dos agentes,
conceitos de auditoria aplicados, unit economics, segurança e trilha, e o que
validar na primeira execução real contra a Omie.

[`prisma/seguranca-banco.sql`](prisma/seguranca-banco.sql) — script opcional
para dar a este sistema um usuário Postgres próprio, com escrita apenas no
schema dele e leitura apenas nas tabelas de que precisa.
