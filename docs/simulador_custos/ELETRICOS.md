# Elétricos e híbridos — pesquisa de mercado (out/2026)

Base das premissas de energia do simulador (`energia.ts`). Fontes oficiais
lidas pelas APIs/scripts das páginas; o que é conta nossa está marcado.

## Assinatura BYD (BYD Mais, operada pela Arval)

**Não vale para transporte de passageiros** (regulamento da página). Serve
de régua de preço para a locação sem motorista.

Inclui emplacamento, licenciamento, IPVA, gestão de multas, rastreador,
manutenção na rede e proteção com coparticipação; o Gold soma pneus (1 jogo
a cada 40 mil km), alinhamento e carro reserva por sinistro; o Platinum,
reserva em manutenção e abono de avarias. Reajuste IPCA. Wallbox não entra.

| Modelo | Preço | 36 m / 3.000 km (Silver) | % do preço/mês | km excedente |
|---|---|---|---|---|
| Dolphin Mini | 119.990 | 3.975 | 3,31% | 0,14 |
| Dolphin | 149.990 | 4.603 | 3,07% | 0,15 |
| Yuan Pro | 182.990 | 4.986 | 2,72% | 0,19 |
| King DM-i | 172.990 | 4.701 | 2,72% | 0,34 |
| Song Pro DM-i | 199.990 | 5.990 | 3,00% | 0,38 |

24 meses: 2,6–3,8%; 48 meses: 2,2–2,9%; Platinum +13 a 20%.
Coparticipação furto/roubo ≈ 4–5% do preço.

## Onde o elétrico e o híbrido ganham e perdem (3.000 km/mês, carro ~R$ 120 mil)

| Componente | Combustão | Híbrido plug-in | Elétrico |
|---|---|---|---|
| Energia (R$/mês) | ~1.730 | 663 (recarga diária) a 1.236 (sem) | 354–465 (recarga na garagem) |
| Revisões | 207–219 | **393–456** | 74–138 |
| Pneus | ~60 | ~65 | **72–90** |
| IPVA SP | ~400 | ~400 (isenção do híbrido flex até 2026) | ~100 (devolução municipal na capital, até 2030) |
| Depreciação | ? | ? | **~10% a.a.** (FIPE: Dolphin 2024 = 79,7% do 0 km em 2 anos) |
| Seguro | ? | ? | 3,2–3,7% a.a. |

- Recarga em carregador rápido público (R$ 2–4/kWh) tira quase toda a
  vantagem de energia.
- Garantia da bateria (8 anos / 150–160 mil km) acaba em ~2 anos a
  6.000 km/mês.

## Calculadoras

- **MG**: só energia (km ÷ km/l × gasolina − km × kWh/100 km × tarifa);
  R$ 6,92/l, R$ 0,618/kWh, MG4 17,6 kWh/100 km; revisões R$ 0,023–0,048/km.
- **Geely Energeely**: EX5 11,7–14,2 kWh/100 km, R$ 0,80/kWh (residencial
  SP 2025); a "economia de combustível" não desconta a energia (infla
  ~R$ 0,10/km); o EX5 EM-i (híbrido) sai com revisão MAIS cara que a combustão.
- **calculadoracarroeletrico.com.br**: 6 km/kWh, R$ 0,85/kWh, depreciação 5%
  (combustão) e 8% (elétrico) a.a.; sem seguro nem capital.
- **Estudo BYD para a Azul (jul/2026)**: compara só combustível (manutenção
  "–"); R$ 1,00/kWh; Dolphin Mini R$ 0,13/km, Dolphin GS 0,15, King GL 0,29
  (com recarga), Shark 0,56; sedan a gasolina 0,54.

## Premissas que o simulador usa

- Elétrico: consumo carro 6,5 km/kWh (com perdas de recarga), van 3,3,
  micro 1,6, ônibus 0,85; R$ 0,95/kWh; óleo/lavagem R$ 0,02/km; manutenção
  70% e pneus 120% da combustão; sem ARLA.
- Híbrido: combustível da categoria; consumo +45% (carro) / +20% (pesados)
  sem recarga; manutenção 135% da combustão; óleo continua.
