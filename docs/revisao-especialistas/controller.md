# Parecer de controller — módulo de resultado e relatório

Revisão do sistema feita por um especialista de IA (Fable 5.1) no papel de controller, em 27/09/2026, somente leitura do código. Referências `arquivo:linha` apontam para o estado do repositório naquela data. Achados A1 e A3 foram conferidos no código por quem consolidou os pareceres.

## 1. Resumo executivo

O DRE de `/custos` é a peça mais bem construída do módulo: estrutura fixa do art. 187, classificação humana com autoria, "sem categoria" fora da demonstração, retenção como item nomeado e um teste diferencial que obriga a soma em SQL a bater com a soma em memória. Mas hoje ele **não é o número que chega à diretoria**: o e-mail diário, o painel e o BSC calculam "resultado do mês" como títulos a receber menos títulos a pagar, sem estrutura nenhuma, e é esse número que vai no assunto do e-mail. Há, portanto, três "resultados" no sistema, e o menos confiável é o mais visível.

Onde a leitura engana hoje, em ordem de gravidade: (1) a tela do DRE afirma que as retenções "não estão somadas" enquanto a configuração padrão as soma; (2) empréstimos, aportes, transferências entre contas e venda de veículos entram no resultado (não há linha "fora do resultado"); (3) no regime de caixa a retenção é subestimada e deduzida duas vezes; (4) categorias com os dois lados são somadas em módulo; (5) comparações mês parcial × mês cheio produzem quedas de calendário; (6) diversos rótulos ainda dizem "por vencimento" quando o cálculo já é por emissão. Sem provisão de 13º/férias, depreciação, PDD e IRPJ/CSLL mensalizado, o resultado mensal oscila por lançamento, não por operação.

Veredito: o DRE serve para **conferir classificação e ler tendência**, com as ressalvas escritas na tela; ainda não serve para a diretoria decidir margem, e o relatório diário não deveria carregar "resultado do mês" no assunto enquanto for a conta bruta.

## 2. Achados ranqueados

### A1. CRÍTICO — A tela do DRE diz que as retenções não estão somadas; a configuração padrão as soma
- **Onde:** `custos/page.tsx:386-425` ("Retido na fonte pelos clientes — não somado acima", "Ficam de fora das deduções de propósito"); `page.tsx` passa `somarRetencoes: config.retencoesNasDeducoes`; `schema.prisma` `retencoesNasDeducoes Boolean @default(true)`; `dre.ts:805-823` insere o item `RETENCAO_NA_FONTE` nas deduções quando ligado.
- **O que faz:** com a configuração de fábrica, a linha "(-) Deduções" já contém "Tributos retidos na fonte pelos clientes"; o quadro abaixo afirma o contrário. O campo `ResultadoDre.retencoesSomadas` existe para a tela dizer qual leitura está no ar e não é lido pela página.
- **Por que engana:** quem confere a carga tributária contra a guia vai somar retenção por cima de retenção e concluir que o sistema erra em centenas de milhares de reais.
- **O que mudar:** condicionar o texto a `dre.retencoesSomadas` (duas redações); trocar o "me diga" por link para a configuração; mostrar o mesmo aviso na visão anual. A planilha `api/exportar/dre/route.ts:87-89` já faz isso certo.

### A2. CRÍTICO — Movimentação patrimonial entra no resultado: empréstimo, aporte, transferência, adiantamento, venda de veículo
- **Onde:** `dre.ts:199-200` (`PADRAO_OUTRA_RECEITA` sem empréstimo, aporte, transferência, devolução, estorno), `dre.ts:246`, `dre.ts:197-198`, `dre.ts:280`. Contraste: `receitaFiscal.ts:212-215` já lista "transferência, aporte, empréstimo, devolução, estorno" como não operacionais — as duas listas divergem. `LINHAS_DRE` não tem nenhuma linha "fora do resultado".
- **O que faz:** captação de empréstimo lançada como título a receber vira receita bruta; a amortização vira "outras despesas operacionais" e reduz o EBIT; transferência entre contas do grupo infla receita e despesa; "Venda de Veículos" entra em `OUTRAS_RECEITAS` pelo valor bruto — no DRE contábil entra só o ganho/perda na alienação.
- **O que mudar:** acrescentar em `LINHAS_DRE` uma entrada `FORA_DO_RESULTADO` (sinal 0, ignorada por `calc`, exibida como memorando); estender os regex; mover venda/alienação para `FINANCIAMENTO_INVESTIMENTO` (mesma lógica do resgate de consórcio) ou para a linha patrimonial; unificar as duas listas de palavras.

### A3. CRÍTICO — O "Resultado do mês" que a diretoria recebe não é o DRE
- **Onde:** `analytics.ts:51-53` (`resultado = receita − despesa`, todos os títulos), `relatorio.ts:112-114`, `reportHtml.ts:245` (assunto do e-mail), `:317-322`, `aiAnalyst.ts:124-135`, `bsc.ts:54-73` (`FIN-MARGEM`), painel. O DRE estruturado não é chamado em `relatorio.ts`; `panorama.dre` é calculado e não aparece no HTML nem no briefing.
- **Por que engana:** o número inclui financiamento, consórcio, IRPJ, transferências, aportes e "sem categoria"; a "margem" do BSC e do e-mail não é margem de nada reconhecível; o diretor lê um valor no assunto e outro ao abrir `/custos`.
- **O que mudar:** em `relatorio.ts`, chamar `montarDreNoBanco` e levar ao relatório e ao briefing Receita líquida, EBIT, Resultado antes dos investimentos, Resultado líquido, não confirmado e sem categoria; no assunto, usar o EBIT do mês fechado anterior ou o saldo de caixa; alinhar `FIN-MARGEM` ao EBIT/receita líquida.

### A4. CRÍTICO — Regime de caixa: retenção proporcional subestimada e deduzida duas vezes
- **Onde:** `dre.ts:414-437` e `dreNoBanco.ts:217-253` (`fracao = pago / valorDocumento`); `dre.ts:558-575` (receita bruta no caixa = soma das baixas); `dre.ts:805-823`.
- **O que faz:** quando o cliente paga líquido, um título D com retenção R totalmente recebido tem `pago = D − R`, logo `fracao < 1` e a retenção contada é `R × (D − R)/D`. E a receita bruta do caixa já é o líquido recebido; somar a retenção às deduções subtrai R duas vezes.
- **O que mudar:** fração = `min(1, pago / (D − retenções − desconto))`; no caixa, quando `somarRetencoes`, acrescentar a retenção proporcional também a `RECEITA_BRUTA` (gross-up), ou não somar às deduções no caixa. Cobrir com caso em `teste-dre.ts`.

### A5. IMPORTANTE — Categoria usada nos dois lados é somada em módulo
- **Onde:** `dre.ts:577-583`, `dreNoBanco.ts:115-131`, `dre.ts:766-772`.
- **O que faz:** categoria com 100 a receber e 30 a pagar vira 130 do lado majoritário; o correto é 70 líquido. Casos típicos: adiantamento a funcionário, multa e reembolso do motorista, convênio médico e coparticipação.
- **O que mudar:** somar com sinal por natureza em `porCategoria` e nas consultas SQL; acrescentar caso de teste com categoria mista.

### A6. IMPORTANTE — Competência pela data de emissão: correta para receita, com riscos não tratados
- **Riscos:** parcelas de financiamento/consórcio com a emissão do contrato caem todas no mês do contrato; títulos sem nota entram na receita antes do serviço; faturamento antecipado desloca receita contra custo; IRPJ/CSLL trimestral cai inteiro num mês; o lado a pagar não foi conferido contra nada; nota cancelada com título vivo continua contando (já medido em `receitaFiscal.ts:160-174`).
- **O que mudar:** para PAGAR com tipo/categoria de financiamento, consórcio ou parcelamento, usar `dataVencimento` como competência — exceção explícita; regra de auditoria "emissão mais de 60 dias antes do vencimento" por mês; memorando "receita sem nota no mês" no DRE.

### A7. IMPORTANTE — IRPJ/CSLL dentro das deduções: defensável no Presumido, mas precisa de provisão mensal, sinalização dinâmica e regex mais estreito
- **Onde:** `dre.ts:249-268`, `dre.ts:150` (`PADRAO_TRIBUTO_LUCRO` captura "imposto de renda" — inclusive IRRF sobre folha e terceiros), `custos/page.tsx:437-442` (rodapé estático), `agents/fiscal.ts:21-32`.
- **Contras:** diverge do art. 187 e do CPC; o adicional de 10% não é proporcional; a DARF trimestral entra num só mês; o regex joga IRRF de folha para deduções; o rodapé afirma o que pode não estar classificado.
- **O que mudar:** configuração explícita (`irpjCsllNasDeducoes`); excluir "retid|fonte|irrf|folha|terceiros" do regex; item mensal "IRPJ/CSLL estimado (Presumido)" pelo mesmo mecanismo do item de retenção; linha memorando "Receita líquida contábil (sem IRPJ/CSLL)"; rodapé condicionado.

### A8. IMPORTANTE — Rótulos e duas consultas ficaram no vencimento depois da migração para emissão
- **Onde:** `resultados/page.tsx:325-336, 386-393, 511, 533`; painel `page.tsx:513`; `reportHtml.ts:379`; `analytics.ts:22`; consultas ainda no vencimento: `receitaFiscal.ts:239-240` (`receitaNaoOperacional`) e `agents/contasPagar.ts:471-473` (`CP-SEM-CATEGORIA`).
- **O que mudar:** usar `CRITERIO_COMPETENCIA` em todos esses lugares; trocar `dataVencimento` por `competenciaSql` em `receitaNaoOperacional`; renomear a linha "Diferença" para "Títulos emitidos sem documento fiscal".

### A9. IMPORTANTE — Mês parcial comparado a mês cheio, e ano a ano com bases diferentes entre telas
- **Onde:** `periodos.ts:104` e `analytics.ts:168-169`; painel, e-mail, `custos/page.tsx:141-151` + `TabelaDre.tsx:125-133`; visão anual sem marca de mês parcial; `/custos` usa mês inteiro do ano anterior enquanto o painel usa até o mesmo dia.
- **O que mudar:** comparar mês em curso com o anterior até o mesmo dia, ou suprimir a variação e escrever "dia X de N"; na visão anual rotular "(parcial até dd/mm)"; alinhar o ano a ano.

### A10. IMPORTANTE — Sem provisões, depreciação e PDD, o resultado mensal oscila por lançamento
- **O que distorce:** 13º e férias; depreciação da frota; IPVA e seguro anual em um mês; PDD; IRPJ/CSLL trimestral.
- **O que mudar:** tabela `DreAjuste` (competência, linha, descrição, valor, origem) alimentada pela configuração e injetada em `montarDreDeInsumos` como itens nomeados marcados "estimativa" — reutilizando o caminho do item de retenção. PDD sugerida a partir de `CR-PERDA-PROVAVEL`.

### A11. IMPORTANTE — Financiamento e consórcio abaixo do resultado: decisão válida, com três vazamentos
- A parcela costuma ser um título só (principal + juros) → despesa financeira subestimada; venda de veículo pelo bruto entra no EBIT; sem depreciação, a linha é proxy de caixa e a tela não diz isso.

### A12. IMPORTANTE — A planilha de conferência do DRE diverge da tela
- **Onde:** `api/exportar/dre/route.ts:40-44` (`carregarContexto(..., { desde: mes.inicio })`) e `:62-65`.
- **O que faz:** com a janela começando no próprio mês, `movimentoPorCategoria` só enxerga o mês (defeito já corrigido na tela) e a coluna "Mês anterior" sai quase zerada.
- **O que mudar:** usar `montarDreNoBanco` com o mesmo escopo da tela; incluir `retencoesSomadas`, não confirmado e regime.

### A13. IMPORTANTE — Regime de caixa diverge entre telas e mistura encargos na categoria do título
- DRE exclui baixas de título cancelado; série, composição e resumo do painel incluem. Juros, multa e tarifa pagos na baixa não vão para `DESPESA_FINANCEIRA`.

### A14. MELHORIA — "Por classificar" mistura dois problemas; a chave de classificação assume códigos iguais nas duas contas
- Dois KPIs separados; mensagem por lado; conferir colisão de código entre AZUL e MCZ.

### A15. MELHORIA — O relatório diário: o que diz e o que deveria dizer
- Deveria: caixa primeiro; resultado do mês fechado por linha e acumulado do mês corrente rotulado "dia X de N"; faturamento por nota × títulos; qualidade do número; três decisões. DRE semanal e no fechamento, não no assunto de todo e-mail.

## 3. O que falta para um fechamento mensal de verdade

**Já existe:** competência validada; DRE com classificação humana e autoria; regimes lado a lado; retenções por tributo; faturamento fiscal × títulos; regras-checklist (`CP-SEM-CATEGORIA`, `FI-RECEITA-SEM-NOTA`, `FI-NOTA-SEM-TITULO`, `FI-ISS-RECOLHIDO-A-MENOR`, `CR-PERDA-PROVAVEL`); snapshots do relatório e do BSC; histórico mensal; trilha; testes diferenciais; exportações; conformidade.

**Precisaria:** (1) snapshot do DRE fechado por competência com responsável; (2) checklist de fechamento com farol; (3) ajustes gerenciais; (4) linha "fora do resultado"; (5) ponte para a contabilidade; (6) competência a pagar por tipo de documento; (7) trava de reabertura (`DRE-MES-FECHADO-ALTERADO`); (8) unificar o "resultado"; (9) marcação de mês parcial; (10) relatório de fechamento (D+5).

## 4. O que está bem feito

- `competencia.ts:3-29`: decisão contábil registrada com evidência e com o que **não** muda.
- `dre.ts:132-143` e `teste-dre.ts:331-393`: a proposta automática nunca toca `CUSTO_SERVICO`.
- `dre.ts:703-709`: título sem categoria fica fora e nomeado.
- `dre.ts:364-382, 799-823`: retenção como item nomeado, dois regimes explicados.
- `dre.ts:232-244`: resgate de consórcio reduz a linha do desembolso.
- `dreNoBanco.ts` e `scripts/teste-dre-banco.ts`: uma função de cálculo, duas colheitas, teste diferencial.
- `analytics.ts:105-108` e `periodos.ts:81-84`: "sem base" em vez de −100%.
- `resultados/page.tsx:340-429`: faturamento por nota × por título lado a lado.
- `aiAnalyst.ts:11-27`: fronteira da IA.
- `agents/contasReceber.ts:209-264` e `agents/fiscal.ts:616-682`: regras que falam a língua do fechamento.

## 5. Ordem sugerida de implementação

1. Coerência do que já está no ar (1–2 dias): A1, A8, A12, A9 mínima.
2. Correções de conta (2–3 dias, com testes): A5, A4, A13.
3. Fronteira do resultado (3–4 dias): A2, A11, A7.
4. O número que a diretoria recebe (2–3 dias): A3, A15.
5. Fechamento (1–2 semanas): A10, A6, snapshot + checklist + ponte contábil, A14.
