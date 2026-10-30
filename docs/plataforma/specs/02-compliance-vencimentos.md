# Spec 02 — Compliance documental e vencimentos (Fase 1)

## Objetivo
Nenhum veículo roda e nenhum motorista é escalado com documento obrigatório vencido — e ninguém descobre isso na blitz ou no pregão.

## Catálogo `tipo_documento` (carga inicial)
| Código | Aplica a | Obrigatório para | Antecedência (dias) |
|---|---|---|---|
| CNH (cat. D/E) | pessoa | todos motoristas | 60 |
| EAR (exerce atividade remunerada) | pessoa | todos motoristas | 60 |
| Curso transporte escolar | pessoa | escolar | 60 |
| Curso transporte coletivo | pessoa | fretamento | 60 |
| Exame toxicológico | pessoa | motoristas (CNH C/D/E) | 60 |
| ASO | pessoa | todos | 30 |
| CRLV / licenciamento | veiculo | todos | 45 |
| Autorização ARTESP | veiculo | fretamento intermunicipal | 90 |
| Cadastro EMTU | veiculo | fretamento região metropolitana | 90 |
| Registro ANTT | veiculo | interestadual | 90 |
| Vistoria escolar (CVS/DETRAN) | veiculo | escolar | 30 (semestral) |
| Aferição tacógrafo | veiculo | todos | 45 |
| Extintor | veiculo | todos | 30 |
| Inspeção veicular (quando exigida) | veiculo | conforme edital | 45 |
| Apólice RC | empresa/veiculo | por segmento | 45 |
| Certidões (CND federal, FGTS, trabalhista, estadual, municipal) | empresa | licitações | 20 |

## Regras
1. Status calculado diariamente: `vigente` (> antecedência), `a_vencer` (≤ antecedência), `vencido`.
2. Documento `vencido` e `obrigatorio_para` o segmento do veículo/motorista → exceção **crítica**.
3. Escala (`pessoas.escala`) consulta este módulo: escalar motorista/veículo com documento crítico vencido gera pendência para `operacao` (não bloqueia sozinho — ADR-005).
4. Apólice vinculada a veículos via `apolice_veiculo`; veículo ativo sem apólice vigente = crítico.
5. Certidões da empresa alimentam o módulo comercial (habilitação em licitação).

## Agente `vencimentos`
- **Periodicidade**: diário, 06:30.
- **Coletar**: `compliance.documento` + `apolice` + status de veículo/pessoa.
- **Regras**: calcula dias para vencer; aplica antecedências `[60, 30, 7]` e vencidos.
- **Agir**: alerta por e-mail consolidado (um por responsável: RH para pessoas, frota para veículos, financeiro para apólices/certidões); pendência por documento vencido crítico.
- **Idempotência**: mesmo documento no mesmo degrau de antecedência não repete alerta.

## Relatórios
- Documentos a vencer nos próximos 90 dias, por segmento e responsável.
- Veículos/motoristas "aptos" por segmento (todos os obrigatórios vigentes) — útil para montar frota de uma proposta.

## Critérios de pronto
- [ ] Catálogo carregado e 100% dos veículos ativos com CRLV, apólice e licenças do seu segmento cadastrados.
- [ ] Agente roda diariamente e envia e-mail consolidado; log em `execucao_agente`.
- [ ] Teste: documento vence em 7 dias → alerta; vencido → pendência; rodar 2x → sem duplicata.
- [ ] Relatório "aptos por segmento" bate com a planilha operacional (amostra de 20 veículos).
