---
name: calibragem-por-evidencia
description: Ajusta uma regra de auditoria da Controladoria a partir de um achado real ("Ver evidência" colado pelo usuário), fixa o caso em teste e publica. Use quando o usuário colar um achado da tela de auditoria dizendo que está errado, ruidoso ou mal classificado, ou quando pedir para "calibrar", "reduzir falso positivo" ou "esse achado não faz sentido".
---

# Calibragem por evidência

Cada regra deste sistema é recalibrada a partir de um caso real, nunca de suposição. O fluxo é sempre o mesmo, e a ordem importa.

## 1. Ler a evidência antes de abrir o código

O usuário cola o cartão do achado: regra, título, descrição, "Ver evidência" (chave/valor ou tabela), entidade, chave. Antes de tocar em código, responda para si:

- **O que o dado diz de verdade?** Percentual fixo ao centavo é retenção; documento "QUITADO" é legenda; pago igual ao documento com desconto registrado é forma de registro da Omie; N parcelas idênticas para banco/DETRAN é frota; CPF e CNPJ com o mesmo nome é a pessoa e o MEI dela; título "PREVISÃO" é orçamento; "Freelancer" para gente da folha é pagamento por fora.
- **Qual é o padrão, não o caso?** A correção deve valer para a classe (por cliente, por categoria, por cobrador), com a assinatura que a evidência mostrou. Nunca hard-code o nome do fornecedor.
- **O que continua sendo achado?** Toda calibragem tem que preservar o caso real que a regra existe para achar (mesmo documento repetido, avulso grande antes do título, diferença sem padrão).

Se a evidência não basta, peça ao usuário mais um ou dois cartões da mesma regra, de preferência de entidades diferentes, antes de mudar a regra.

## 2. Onde mexer

- Regras: `src/lib/controladoria/agents/<agente>.ts`. Prefira `severidade: "INFO"` com a leitura provável escrita na descrição a suprimir o achado — informativo fica na tela sem contar como "a triar".
- Achado por conjunto (um por cliente/categoria/empresa): use `chaveAchado(regra, ...partes)` estável, `entidadeRef` legível, e inclua a regra em `REGRAS_AGREGADAS` (`supervisor.ts`) para o volume não rebaixar e a tratativa herdar.
- Evidência: chaves de dinheiro devem casar `CHAVE_DE_DINHEIRO` em `src/app/(app)/_componentes.tsx` (valor, devido, documento, soma…); contagens usam `quantidade`/`titulos`/`casos`. CPF nunca cru.
- Expressões regulares sobre nomes de categoria/fornecedor: sempre com `\b` em palavras curtas (`\bprocesso\b`, `\bextra\b`, `13[ºo°]`), e sem `\b` no fim de radicais (`segur`, `rastrea`) — o `\b` do JavaScript não entende acento.
- Mapeamento da Omie: se a evidência sugere campo errado, confirme em `src/lib/omie/mapping.ts` e no diagnóstico ("Testar integração") antes de mudar — os nomes de campo vêm da conta real, não da documentação.

## 3. Fixar em teste

Todo ajuste ganha casos em `scripts/teste-calibragem.ts`, com os fixtures `titulo()`, `baixa()`, `parceiro()`, `contexto()`: o caso real que motivou (com os valores reais, anonimizados) **e** o caso que continua sendo apontado. Rode:

```
npm run teste:calibragem && npm run teste:antifraude && npm run teste:engine
npx tsc --noEmit -p . && npx eslint src scripts
```

## 4. Documentar e publicar

Uma linha em `docs/controladoria.md`, seção "Calibragem pelas evidências", no mesmo formato das existentes (regra — evidência real — o que mudou). Commit com a evidência resumida no corpo. Push em `main` publica na Vercel.

## 5. Fechar o ciclo com o usuário

Peça, nesta ordem: aguardar o deploy ficar Ready; **Sincronização → Rodar a auditoria de novo → Sincronizar agora**; colar a linha do log "Auditoria: X novo(s), Y reincidente(s), Z fechado(s) automaticamente, W reaberto(s)"; colar a tabela "Concentração por regra". Achados do tipo EVENTO que a regra corrigida deixou de emitir fecham sozinhos dentro da janela de auditoria; se a contagem não cair, a causa é deploy antigo ou auditoria não reexecutada, não a regra.
