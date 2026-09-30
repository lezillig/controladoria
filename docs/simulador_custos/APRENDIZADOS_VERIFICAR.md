# O que o roteiro VERIFICAR (kit externo de custeio) ensina para a nossa base

Fonte: `VERIFICAR.md`, roteiro de aceitação de outro kit de custeio de
transporte, com respostas "conferidas contra o motor deste kit em
30/09/2026". Os arquivos que ele cita (`kb/`, `lib/costing/`) **não vieram**;
só as perguntas e respostas. Os números abaixo são deles, não medidos por
nós — entram como referência e estimativa, nunca como base da Azul Mob sem
conferência.

## O que confirma o que o simulador já faz

| Tema | Kit externo | Simulador | Situação |
|---|---|---|---|
| PIS/COFINS no Lucro Real | 3,65% cumulativo, **sem crédito** (Lei 10.833/2003, art. 10, XII c/c art. 15, V) | Preset "Real — transporte de passageiros": 0,65% + 3% sem crédito | Confere |
| Carga do Presumido | 8,73% da receita (0,0365 + IRPJ e CSLL com adicional) | PIS 0,65 + COFINS 3 + IRPJ 4 + CSLL 1,08 = 8,73% | Confere (padrão de IRPJ 4% corrigido em set/2026) |
| Tributo por dentro | preço = custo ÷ (1 − carga); "× 1,1833 erra 3,4% para baixo" | divisor do preço (tributos por dentro) | Confere |
| Selo de confiança | ESTIMATED / medido | origem de cada premissa: estimativa, base, custo real, ajuste | Equivalente |
| Km morto e ociosidade | reduções multiplicativas (0,88 × 0,88) | km improdutivo sobre o km útil × utilização | Mesma lógica multiplicativa |

## O que acrescentar

1. **Pedágio pela categoria do veículo** (perguntas 3 e 4). A categoria segue
   os eixos e a rodagem do eixo traseiro, não a lotação:
   - Categoria 1, ×1,0: carro e **van de rodagem simples** (Master).
   - Categoria 2, ×2,0: 2 eixos de rodagem dupla — **van de rodagem dupla**
     (Sprinter 516; Daily 45S/70C a confirmar na praça), micro e ônibus.
   - Ônibus de 3 eixos: ×3,0.
   - Categoria 3 em SP (×1,5) é automóvel com semirreboque — aplicá-la ao
     ônibus deixa 25% do pedágio de fora.
   - Referência do kit: São Paulo–Santos (Imigrantes/Anchieta), praça de
     R$ 40,60 em categoria 1 por sentido; ônibus ida e volta R$ 162,40.
   → Tipo de veículo ganha a **categoria de pedágio**; a rota escolhe a
   **praça da base** e a tarifa por passagem sai da categoria.

2. **Margem de indiferença Presumido × Real** (pergunta 6):
   0,0365 + 0,34·m = 0,0873 → **m = 14,94%** de margem antes do IRPJ. Abaixo
   dela, o Lucro Real paga menos imposto. → mostrar na escolha do regime,
   calculada com as alíquotas do estudo.

3. **Reforma tributária** (pergunta 2): o **fretamento não tem redução** de
   IBS/CBS (tributação integral); a redução de 40% é do transporte coletivo
   de passageiros regular (LC 214/2025, art. 284, §1º, I e §4º; art. 286).
   Em 2026, CBS 0,9% e IBS 0,1% são compensáveis — carga adicional zero.
   → alerta da reforma passa a dizer isso.

4. **Registro de fretamento intermunicipal em SP** (pergunta 7): ARTESP,
   pelo SEI/SP; a EMTU foi extinta (funções na ARTESP em 2025). → textos da
   conformidade deixam de citar a EMTU como órgão vigente.

5. **Taxas municipais de turismo** (pergunta 10), importantes no fretamento
   eventual: Ubatuba cobra COMTUR **por entrada** de ônibus acima de 32
   lugares na alta temporada (R$ 5.428,38) e TPA **por dia** (R$ 98,03),
   cumulativas, com cadastro prévio. Cobrar por passageiro seria o erro mais
   caro possível. → **proposta**: taxa por viagem e por dia na rota
   (hoje dá para lançar como "pedágio" com a quantidade certa).

6. **Manutenção por km** (pergunta 8): peças do micro (R$ 0,866/km) acima
   das do ônibus rodoviário (R$ 0,750/km) e da van (R$ 0,556/km) — percurso
   médio menor (7.000 contra 9.000 km/mês) dilui pior o custo por tempo, e o
   ar-condicionado de teto pesa. São "peças" (ESTIMATED), não manutenção
   total. → referência para conferir os padrões do simulador (micro 0,70 e
   ônibus 0,95 R$/km de manutenção total) contra o custo real da frota.

## O que não adotar

- **Km excedente = CVk × 1,15**: o kit aplica um markup sobre o custo
  variável. O simulador cobra o km excedente pelo custo variável com
  indiretos, tributos por dentro e margem — tributo incide sobre qualquer
  receita, e um markup fixo sem tributo por dentro vende o excedente abaixo
  do custo quando a carga é alta. Mantido.
