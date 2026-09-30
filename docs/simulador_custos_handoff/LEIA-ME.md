# Pacote de migração — Simulador de Custos Azul Mob → sistema de controladoria (set/2026)

docs/ESPECIFICACAO_MODULO_SIMULADOR_CUSTOS.md  — modelo de dados, fórmulas do motor, telas, critérios de aceite
docs/PROMPT_CLAUDE_CODE.md                     — prompt pronto para o Claude Code implementar o módulo
seeds/premissas_holambra_pe036_2026.json       — todas as premissas usadas na planilha de Holambra (estimativas de mercado)
seeds/premissas_sjpinhais_pe089_2026.json      — idem para São José dos Pinhais
seeds/regras_edital_sjpinhais_pe089_2026.json  — regras do edital/TR com impacto no custo (formato de referência)
testes/casos_de_teste_esperados.json           — resultados esperados das duas simulações (para testes automatizados)
planilhas_referencia/                          — as 3 planilhas Excel originais (Holambra, SJP, Gabarito de dados)
scripts/                                       — scripts Python/openpyxl que geraram as planilhas (referência de layout e fórmulas)
