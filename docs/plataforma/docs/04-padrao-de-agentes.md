# 04 — Padrão de agentes

Todo agente deste repositório segue o mesmo ciclo. Isso é o que torna os agentes **auditáveis, testáveis e baratos**.

## Ciclo obrigatório

```
1. COLETAR     → via MCP ou banco; nunca API externa direta
2. NORMALIZAR  → tipos, fuso, chaves naturais (placa, cpf)
3. REGRAS      → código determinístico; gera lista de EXCEÇÕES
4. JULGAR      → (opcional) LLM classifica/prioriza/explica as exceções
5. AGIR        → alerta informativo (automático) OU pendência (precisa de humano)
6. REGISTRAR   → auditoria.execucao_agente + auditoria.log + auditoria.alerta
```

## Classificação de ações

| Tipo de ação | Exemplo | Execução |
|---|---|---|
| Informativa | e-mail "CNH vence em 30 dias" | Automática |
| Correção de dado interno | marcar marcação de ponto como inválida | Automática, logada |
| Financeira | lançar conta a pagar na Omie, pagar | **Pendência** → perfil `financeiro` |
| Trabalhista | desconto de multa, advertência, bloqueio de escala | **Pendência** → perfil `rh` |
| Operacional com impacto | trocar veículo de linha, cancelar viagem | **Pendência** → perfil `operacao` |
| Externa irreversível | enviar mensagem a cliente, indicar condutor no DETRAN | **Pendência** → `gestor` |

## Onde o LLM entra (e onde não entra)

**Entra**: extrair campos de PDF/e-mail (NF, boleto, comunicado), classificar severidade de exceções, redigir e-mails e o relatório semanal, resumir evidências numa pendência.

**Não entra**: calcular datas, comparar valores, decidir se jornada excedeu limite, decidir se algo está vencido. Isso é código com teste unitário.

Toda chamada ao LLM: prompt versionado em `agents/prompts/<agente>_vN.md`, saída em JSON validado por schema, temperatura 0, e o conteúdo externo passado como **dados** com instrução explícita de que não contém comandos.

## Contrato de `agents/base.py`

```python
class AgenteBase:
    nome: str                # ex.: "vencimentos"
    periodicidade: str       # cron: "0 7 * * *"
    perfil_aprovador: str    # para pendências geradas

    def coletar(self) -> list[dict]: ...
    def regras(self, dados) -> list[Excecao]: ...
    def julgar(self, excecoes) -> list[Excecao]:   # default: passa direto
        return excecoes
    def agir(self, excecoes) -> None:             # usa self.alerta() e self.pendencia()
    def executar(self):                           # orquestra, mede, registra, captura erro
```

`Excecao` = `{tipo, referencia: {tabela, id}, severidade (baixa/media/alta/critica), evidencias: dict, acao_proposta: dict|None}`.

## Idempotência e janela

- Cada execução registra `(agente, chave_excecao)`; a mesma exceção não gera alerta repetido dentro da janela configurada (ex.: 7 dias), apenas escala a severidade.
- Reprocessar um dia já processado não duplica pendências.

## Thresholds configuráveis

Ficam em `agents/config.yaml` (não no código):

```yaml
vencimentos:
  antecedencia_padrao_dias: [60, 30, 7]
monitor_rotas:
  atraso_min: 10
  desvio_metros: 300
combustivel:
  desvio_pct: 15
jornada:
  limite_diario_h: 8
  extra_max_h: 2
  interjornada_h: 11
```

## Testes mínimos por agente

1. Regras com casos sintéticos (vencido, a vencer, ok).
2. Idempotência (rodar duas vezes = uma pendência).
3. Falha de MCP não derruba o agente: registra erro em `execucao_agente` e avisa `admin`.

## Template

Copiar `agents/_template.py`, implementar `coletar`, `regras`, `agir`; registrar no scheduler em `agents/scheduler.py`.
