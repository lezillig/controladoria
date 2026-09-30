"""RECALCULA UMA PLANILHA SEM EXCEL — apoio de scripts/teste-exportar-xlsx.ts.

Uso:
  python3 scripts/recalcular-xlsx.py <entrada.xlsx> <saida.json>
      recalcula com o pacote `formulas` (pip install formulas) — o motor de
      reserva quando o LibreOffice não está instalado;
  python3 scripts/recalcular-xlsx.py --ler <recalculada.xlsx> <saida.json>
      só lê os valores que outro motor (o LibreOffice) gravou na planilha.

Nos dois casos grava o valor de cada célula num JSON {"ABA": {"B12": valor}}.
Nada do exportador é reaproveitado aqui: a conta é feita pelo motor de
planilha, a partir do texto das fórmulas. (A leitura usa openpyxl porque o
exceljs perde os resultados iguais a zero ao ler fórmulas.)
"""
import json
import math
import re
import sys


def normalizar(v):
    if hasattr(v, "item"):
        v = v.item()
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    if v is None or isinstance(v, (int, float, str, bool)):
        return v
    return str(v)


def ler(entrada):
    import openpyxl

    wb = openpyxl.load_workbook(entrada, data_only=True)
    valores = {}
    for ws in wb.worksheets:
        aba = valores.setdefault(ws.title.upper(), {})
        for linha in ws.iter_rows():
            for c in linha:
                if c.value is not None:
                    aba[c.coordinate] = normalizar(c.value)
                elif c.data_type in ("s", "str"):
                    aba[c.coordinate] = ""
    return valores


def recalcular(entrada):
    import formulas

    modelo = formulas.ExcelModel().loads(entrada).finish()
    solucao = modelo.calculate()
    valores = {}
    # Chaves como "'[sjp.xlsx]COMPOSIÇÃO DE CUSTO'!B12".
    padrao = re.compile(r"^'?\[[^\]]+\](.+?)'?!([A-Z]+\d+)$")
    for chave, valor in solucao.items():
        m = padrao.match(str(chave))
        if not m:
            continue
        v = getattr(valor, "value", valor)
        try:
            v = v[0][0]
        except (TypeError, IndexError, KeyError):
            pass
        valores.setdefault(m.group(1).upper(), {})[m.group(2)] = normalizar(v)
    return valores


if sys.argv[1] == "--ler":
    resultado = ler(sys.argv[2])
    saida = sys.argv[3]
else:
    resultado = recalcular(sys.argv[1])
    saida = sys.argv[2]
with open(saida, "w", encoding="utf-8") as f:
    json.dump(resultado, f, ensure_ascii=False)
