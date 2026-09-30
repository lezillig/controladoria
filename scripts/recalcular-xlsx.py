"""RECALCULA UMA PLANILHA SEM EXCEL — apoio de scripts/teste-exportar-xlsx.ts.

Uso: python3 scripts/recalcular-xlsx.py <entrada.xlsx> <saida.json>

Motor de reserva quando o LibreOffice não está instalado: o pacote `formulas`
(pip install formulas) lê as fórmulas da pasta, calcula tudo e este script
grava o valor de cada célula num JSON {"Aba": {"B12": valor, ...}}. Nada do
exportador é reaproveitado aqui: a conta é feita pelo motor do `formulas`, a
partir do texto das fórmulas.
"""
import json
import math
import re
import sys

import formulas

entrada, saida = sys.argv[1], sys.argv[2]
modelo = formulas.ExcelModel().loads(entrada).finish()
solucao = modelo.calculate()

valores = {}
# Chaves como "'[sjp.xlsx]COMPOSIÇÃO DE CUSTO'!B12" ou "'[sjp.xlsx]ROTAS'!P5:P11".
padrao = re.compile(r"^'?\[[^\]]+\](.+?)'?!([A-Z]+\d+)$")
for chave, valor in solucao.items():
    m = padrao.match(str(chave))
    if not m:
        continue
    aba, celula = m.group(1), m.group(2)
    v = getattr(valor, "value", valor)
    try:
        v = v[0][0]
    except (TypeError, IndexError, KeyError):
        pass
    if hasattr(v, "item"):
        v = v.item()
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        v = None
    elif not isinstance(v, (int, float, str, bool)) and v is not None:
        v = str(v)
    valores.setdefault(aba.upper(), {})[celula] = v

with open(saida, "w", encoding="utf-8") as f:
    json.dump(valores, f, ensure_ascii=False)
