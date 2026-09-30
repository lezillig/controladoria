# Prompt para o Claude Code — implantar o módulo Simulador de Custos no sistema de controladoria

Copie o bloco abaixo no Claude Code, aberto na pasta do sistema de controladoria, com esta pasta `simulador_custos_handoff/` copiada para dentro do projeto (ex.: `docs/simulador_custos_handoff/`).

---

Você vai criar o módulo **Simulador de Custos** dentro deste sistema de controladoria da Azul Mob (transporte de passageiros: fretamento contínuo com van/micro/ônibus e transporte escolar), seguindo a especificação em `docs/simulador_custos_handoff/docs/ESPECIFICACAO_MODULO_SIMULADOR_CUSTOS.md`.

Antes de codar:
1. Leia a especificação inteira e os arquivos em `seeds/` e `testes/`.
2. Mapeie o que JÁ existe neste sistema (tabelas de frota/veículos, contratos, centros de custo, lançamentos, folha, fornecedores) e proponha como as entidades da seção 2.1 da especificação se ligam a elas — reaproveite tabelas existentes em vez de duplicar; onde faltar campo, crie migração.
3. Me apresente o plano (modelo de dados, endpoints/serviços, telas, migrações) e espere minha aprovação.

Depois de aprovado:
4. Implemente o motor de cálculo da seção 3 como um serviço puro e testável (sem UI), com as fórmulas exatamente como estão.
5. Escreva testes automatizados que carreguem `seeds/premissas_holambra_pe036_2026.json` e `seeds/premissas_sjpinhais_pe089_2026.json` e reproduzam os resultados de `testes/casos_de_teste_esperados.json` com tolerância de R$ 0,01 no preço/km e 0,1% nos totais. Os testes devem passar antes de qualquer tela.
6. Implemente a base de custos versionada (seção 2.1) com importador do arquivo `planilhas_referencia/Gabarito_Dados_Simulador_Custos_AzulMob.xlsx` (uma aba por entidade; linha 4 = cabeçalho, 5 = explicação, 6 = exemplo, dados a partir da 7).
7. Implemente as entidades de simulação (seção 2.2), com snapshot das premissas em cada versão e registro de lances e resultado.
8. Implemente os cenários (seção 3.2) e o julgamento por lote (3.3).
9. Implemente a exportação Excel no padrão das planilhas em `planilhas_referencia/` (use os scripts em `scripts/` como referência de layout: abas Regras do Edital, Premissas, Rotas/Linhas, Composição de Custo, Cenários, Proposta; fonte Arial; azul = entrada, preto = fórmula; a planilha exportada deve conter FÓRMULAS, não valores, para que continue recalculável no Excel).
10. Importe como dados históricos: as duas simulações (Holambra PE 036/2026 e São José dos Pinhais PE 089/2026) com suas premissas marcadas `fonte = "estimativa de mercado set/2026"`, as regras de edital de SJP, e os lances/resultados que eu informar.
11. Deixe um endpoint/serviço "realizado × previsto" pronto para receber km (Ituran) e custos por contrato, mesmo que a tela venha depois.

Regras:
- Nunca sobrescrever premissa: toda alteração cria nova vigência.
- Toda simulação precisa ser reexecutável a partir do seu snapshot.
- Valores monetários em decimal (não float) no banco.
- Documente as decisões de mapeamento em `docs/simulador_custos/DECISOES.md`.
