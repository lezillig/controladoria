from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.comments import Comment
from openpyxl.utils import get_column_letter

OUT = "/mnt/user-data/outputs/Planilha_Custos_PE036-2026_Holambra_AzulMob.xlsx"

F = "Arial"
fN = Font(name=F, size=10)
fB = Font(name=F, size=10, bold=True)
fT = Font(name=F, size=14, bold=True, color="FFFFFF")
fH = Font(name=F, size=10, bold=True, color="FFFFFF")
fIn = Font(name=F, size=10, color="0000FF")          # input
fLink = Font(name=F, size=10, color="008000")        # link other sheet
fSec = Font(name=F, size=11, bold=True, color="1F3864")
fillT = PatternFill("solid", fgColor="1F3864")
fillH = PatternFill("solid", fgColor="2F5496")
fillY = PatternFill("solid", fgColor="FFFF00")
fillG = PatternFill("solid", fgColor="E2EFDA")
fillGr = PatternFill("solid", fgColor="F2F2F2")
thin = Side(style="thin", color="BFBFBF")
bd = Border(left=thin, right=thin, top=thin, bottom=thin)
BRL = 'R$ #,##0.00;[Red](R$ #,##0.00);-'
BRL4 = 'R$ #,##0.0000;[Red](R$ #,##0.0000);-'
PCT = '0.0%'
NUM = '#,##0.00'
INT = '#,##0'

wb = Workbook()

# ------------------------------------------------------------------ PREMISSAS
ws = wb.active
ws.title = "Premissas"
ws.column_dimensions["A"].width = 52
ws.column_dimensions["B"].width = 18
ws.column_dimensions["C"].width = 12
ws.column_dimensions["D"].width = 70

def title(ws, r, txt, span=4):
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=span)
    c = ws.cell(r, 1, txt); c.font = fT; c.fill = fillT
    c.alignment = Alignment(vertical="center")
    ws.row_dimensions[r].height = 22

def sec(ws, r, txt):
    c = ws.cell(r, 1, txt); c.font = fSec
    ws.cell(r, 1).fill = fillG
    for col in range(2, 5):
        ws.cell(r, col).fill = fillG

title(ws, 1, "PLANILHA DE CUSTOS — PREGÃO ELETRÔNICO 036/2026 — PREFEITURA DE HOLAMBRA/SP — Transporte escolar (ônibus 59 lugares)")
ws.cell(2, 1, "Legenda: azul = dado de entrada (edite à vontade) · fundo amarelo = preencher · preto = fórmula · verde = link de outra aba. Todas as premissas de custo são ESTIMATIVAS DE MERCADO (SP, set/2026) — substitua pelos números reais da Azul Mob.").font = Font(name=F, size=9, italic=True)
ws.merge_cells("A2:D2"); ws.row_dimensions[2].height = 30
ws["A2"].alignment = Alignment(wrap_text=True, vertical="top")

hdr = ["Item", "Valor", "Unid.", "Observação / fonte"]
for i, h in enumerate(hdr, 1):
    c = ws.cell(4, i, h); c.font = fH; c.fill = fillH; c.border = bd

P = {}  # name -> cell address
r = 5
def put(name, label, val, unit, note, fmt=None, fill=None, inp=True):
    global r
    ws.cell(r, 1, label).font = fN
    c = ws.cell(r, 2, val)
    c.font = fIn if inp else fN
    if fmt: c.number_format = fmt
    if fill: c.fill = fill
    ws.cell(r, 3, unit).font = fN
    n = ws.cell(r, 4, note); n.font = Font(name=F, size=9); n.alignment = Alignment(wrap_text=True, vertical="top")
    for col in range(1, 5):
        ws.cell(r, col).border = bd
    if name: P[name] = f"Premissas!$B${r}"
    r += 1

sec(ws, r, "1. DADOS DO LICITANTE (Anexo II)"); r += 1
put("razao", "Denominação", "AZUL TRANSPORTES E TURISMO LTDA", "", "Razão social conforme CNPJ (nome fantasia: Azul Mob).")
put("endereco", "Endereço", "", "", "PREENCHER — endereço completo da sede (São Paulo/SP).", fill=fillY)
put("cnpj", "CNPJ", "10.764.533/0001-01", "", "")
put("tel", "Telefone", "", "", "PREENCHER", fill=fillY)
put("email", "E-mail", "", "", "PREENCHER", fill=fillY)
put("resp", "Responsável pela assinatura do contrato (nome)", "", "", "PREENCHER", fill=fillY)
put("rg", "RG", "", "", "PREENCHER", fill=fillY)
put("cpf", "CPF", "", "", "PREENCHER", fill=fillY)
put("cargo", "Cargo", "", "", "PREENCHER (ex.: Sócio-administrador)", fill=fillY)
put("cidade_data", "Cidade, dia, mês e ano da proposta", "São Paulo, 28 de setembro de 2026", "", "Sessão do pregão: 28/09/2026 (título do arquivo enviado).")

r += 1; sec(ws, r, "2. PARÂMETROS DO CONTRATO"); r += 1
put("dias", "Dias letivos considerados no edital", 200, "dias", "Derivado do edital: em todas as 9 linhas, KM total ÷ KM por dia = 200 (ex.: Linha 01: 27.160 ÷ 135,8 = 200).", INT)
put("meses", "Meses de custo fixo (salários, veículo) no período", 12, "meses", "200 dias letivos ≈ ano letivo completo. A equipe e o veículo custam também nos meses sem aula (férias/recesso). Ajuste se o contrato for menor.", INT)
put("km_morto", "Km morto / deslocamento garagem ↔ ponto inicial", 0.10, "% do km", "Estimativa: 10% sobre o km pago. Depende de onde ficará a garagem de apoio em Holambra.", PCT)
put("reserva", "Reserva técnica de frota", 0.10, "% da frota", "1 ônibus reserva a cada 10 (edital costuma exigir veículo reserva). Aplicado sobre o custo fixo do veículo.", PCT)

r += 1; sec(ws, r, "3. PESSOAL (por funcionário)"); r += 1
put("sal_mot", "Salário base — motorista de ônibus (cat. D)", 3200, "R$/mês", "ESTIMATIVA. Conferir CCT vigente (SETPESP / Sindicato dos Motoristas) para transporte escolar/fretamento interior SP, 2026.", BRL)
put("sal_mon", "Salário base — monitora escolar", 1900, "R$/mês", "ESTIMATIVA (piso ≈ salário mínimo 2026 + acréscimo). Conferir CCT.", BRL)
put("encargos", "Encargos e provisões sobre salário", 0.70, "%", "INSS patronal + RAT + terceiros (~28,8%), FGTS 8%, provisão férias + 1/3, 13º, rescisão/multa FGTS — total típico 68–72% no regime CLT (não Simples).", PCT)
put("fator_not", "Fator jornada estendida — linhas com período NOTURNO", 1.35, "x", "Linhas 01, 04 e 06 rodam de 5h50 às 23h00: jornada excede 8h → horas extras (50%) + adicional noturno (20%) ou 2º motorista parcial. Fator sobre o custo do motorista.", NUM)
put("benef", "Benefícios — VR/VA + cesta + seguro de vida", 780, "R$/mês por func.", "ESTIMATIVA: VA R$ 26/dia × 22 + cesta R$ 200 + seguro/assist. R$ 8. Vale-transporte tende a zero (equipe local, rural).", BRL)
put("epi", "Uniforme / EPI / exames (ASO, toxicológico)", 60, "R$/mês por func.", "ESTIMATIVA rateada.", BRL)

r += 1; sec(ws, r, "4. VEÍCULO — ônibus mín. 59 lugares (custo fixo mensal por veículo)"); r += 1
put("valor_veic", "Valor do ônibus (usado, ~8 anos, 59 lug., adequado escolar)", 280000, "R$", "ESTIMATIVA de mercado set/2026. Se usar veículo já da frota Azul, informe o valor contábil/FIPE.", BRL)
put("deprec", "Depreciação anual", 0.12, "% a.a.", "Linear, vida útil restante ~8 anos com residual.", PCT)
put("capital", "Custo de capital / financiamento", 0.14, "% a.a.", "Frota Azul é financiada via CDC/consórcio — use a taxa média real dos contratos.", PCT)
put("seguro", "Seguro RC + casco (rateio mensal)", 1100, "R$/mês", "ESTIMATIVA. Apólice escolar Sombrero — conferir prêmio real/veículo.", BRL)
put("ipva", "IPVA + licenciamento + DPVAT (anual)", 4200, "R$/ano", "IPVA SP ônibus 1,5% s/ valor venal + taxas.", BRL)
put("rastreador", "Rastreamento / telemetria (Ituran)", 90, "R$/mês", "Valor contratual Azul (estimado).", BRL)
put("inspecao", "Inspeção escolar semestral + vistoria + tacógrafo (anual)", 900, "R$/ano", "ESTIMATIVA.", BRL)
put("garagem", "Garagem / ponto de apoio em Holambra (rateio por veículo)", 450, "R$/mês por veíc.", "ESTIMATIVA: aluguel de pátio ~R$ 4.500/mês ÷ 10 veículos. Necessário porque a sede é em São Paulo (≈140 km).", BRL)

r += 1; sec(ws, r, "5. CUSTOS VARIÁVEIS (por km rodado)"); r += 1
put("diesel", "Diesel S10 — preço médio bomba (SP)", 6.20, "R$/litro", "ESTIMATIVA (ANP, SP, set/2026). Atualize com a cotação do posto/fornecedor.", BRL)
put("cons_asf", "Consumo em ASFALTO — ônibus 59 lug.", 2.9, "km/litro", "ESTIMATIVA para ônibus urbano/rodoviário leve com paradas.", NUM)
put("cons_terra", "Consumo em TERRA (estrada rural)", 2.4, "km/litro", "ESTIMATIVA: piso de terra reduz ~15–20% o rendimento.", NUM)
put("arla", "ARLA 32", 0.07, "R$/km", "≈5% do volume de diesel × R$ 4,00/l.", BRL4)
put("pneus_asf", "Pneus (novos + recapagem) — asfalto", 0.24, "R$/km", "6 pneus × R$ 2.300 + 2 recapagens ÷ ~70.000 km.", BRL4)
put("pneus_terra", "Pneus — terra", 0.34, "R$/km", "Desgaste ~40% maior em terra.", BRL4)
put("manut_asf", "Manutenção (peças + mão de obra) — asfalto", 0.95, "R$/km", "ESTIMATIVA para veículo ~8 anos.", BRL4)
put("manut_terra", "Manutenção — terra", 1.35, "R$/km", "Suspensão, freios e filtros sofrem mais em terra (~40%).", BRL4)
put("lub", "Lubrificantes, filtros, lavagem", 0.09, "R$/km", "ESTIMATIVA.", BRL4)

r += 1; sec(ws, r, "6. INDIRETOS, TRIBUTOS E LUCRO (BDI)"); r += 1
put("adm", "Administração central / overhead", 0.08, "% s/ custo direto", "Gestão, RH, contabilidade, TI, sistema de motoristas, monitoramento de rota.", PCT)
put("lucro", "Lucro desejado", 0.10, "% s/ preço", "Margem líquida alvo — ajuste conforme estratégia de lance.", PCT)
put("pis", "PIS", 0.0065, "% s/ faturamento", "Lucro presumido (cumulativo).", '0.00%')
put("cofins", "COFINS", 0.03, "% s/ faturamento", "Lucro presumido (cumulativo).", '0.00%')
put("irpj", "IRPJ (presumido: 8% × 15%)", 0.012, "% s/ faturamento", "Lucro presumido — serviços de transporte, base 8%.", '0.00%')
put("csll", "CSLL (presumido: 12% × 9%)", 0.0108, "% s/ faturamento", "Lucro presumido — transporte, base 12%.", '0.00%')
put("iss", "ISS — Holambra", 0.05, "% s/ faturamento", "CONFERIR alíquota municipal para transporte escolar (LC 116, item 16). Pode ser 2% a 5%.", '0.00%')
ws.cell(r, 1, "Total de tributos sobre faturamento").font = fB
c = ws.cell(r, 2, f"={P['pis']}+{P['cofins']}+{P['irpj']}+{P['csll']}+{P['iss']}"); c.number_format = '0.00%'; c.font = fB
ws.cell(r, 3, "%").font = fN
ws.cell(r, 4, "Se a Azul estiver no Lucro Real ou Simples, substitua as linhas acima.").font = Font(name=F, size=9)
for col in range(1, 5): ws.cell(r, col).border = bd
P["trib"] = f"Premissas!$B${r}"; r += 1

ws.freeze_panes = "A5"

# ------------------------------------------------------------------ LINHAS
wl = wb.create_sheet("Linhas")
title(wl, 1, "DADOS DAS LINHAS — extraídos do Anexo II (Modelo de Proposta) do PE 036/2026 e da planilha de lances Licita+", 14)
wl.cell(2, 1, "Azul: dados do edital (não alterar salvo erro de leitura). Asfalto = km/dia − terra (fórmula). Preço de referência = planilha 'Licita+ Brasil - Planilha de Lances Iniciais'.").font = Font(name=F, size=9, italic=True)
lh = ["Linha", "KM total (edital)", "KM por dia", "KM terra / dia", "KM asfalto / dia", "% terra", "Períodos", "Noturno?", "Ônibus", "Motoristas", "Monitoras", "Vencimento (edital)", "Preço ref. (R$/km)", "Valor ref. total (R$)"]
widths = [8, 16, 12, 14, 15, 9, 22, 10, 9, 11, 11, 18, 16, 18]
for i, (h, w) in enumerate(zip(lh, widths), 1):
    c = wl.cell(4, i, h); c.font = fH; c.fill = fillH; c.border = bd
    c.alignment = Alignment(wrap_text=True, horizontal="center", vertical="center")
    wl.column_dimensions[get_column_letter(i)].width = w
wl.row_dimensions[4].height = 32

linhas = [
    # n, km_total, km_dia, terra, periodos, noturno, bus, mot, mon, venc, ref
    (1, 27160, 135.8, 44.10, "Matutino, Vespertino e Noturno", "S", 1, 1, 1, "10/12/2026", 23.54),
    (2, 21760, 108.8, 14.72, "Matutino e Vespertino",          "N", 1, 1, 0, "10/12/2026", 23.55),
    (3, 17520,  87.6, 33.08, "Matutino e Vespertino (2 itin.)","N", 2, 2, 2, "24/04/2027", 25.66),
    (4, 29120, 145.6, 30.64, "Matutino, Vespertino e Noturno", "S", 1, 1, 1, "10/12/2026", 27.60),
    (5, 20160, 100.8, 18.56, "Matutino e Vespertino",          "N", 1, 1, 1, "10/12/2026", 25.50),
    (6, 32920, 164.6, 49.02, "Matutino, Vespertino e Noturno", "S", 1, 1, 1, "10/12/2026", 26.36),
    (7, 16720,  83.6, 44.32, "Matutino e Vespertino",          "N", 1, 1, 1, "10/12/2026", 25.49),
    (8, 14880,  74.4, 23.74, "Matutino e Vespertino",          "N", 1, 1, 1, "24/04/2027", 27.80),
    (9, 11120,  55.6,  0.00, "Matutino e Vespertino",          "N", 1, 1, 1, "24/04/2027", 28.90),
]
L0 = 5
for i, ln in enumerate(linhas):
    rr = L0 + i
    n, kmt, kmd, terra, per, noc, bus, mot, mon, venc, ref = ln
    vals = [n, kmt, kmd, terra, f"=C{rr}-D{rr}", f"=IF(C{rr}=0,0,D{rr}/C{rr})", per, noc, bus, mot, mon, venc, ref, f"=B{rr}*M{rr}"]
    for j, v in enumerate(vals, 1):
        c = wl.cell(rr, j, v); c.border = bd
        c.font = fIn if j in (1, 2, 3, 4, 7, 8, 9, 10, 11, 12, 13) else fN
        c.alignment = Alignment(horizontal="center") if j in (1, 8, 9, 10, 11, 12) else Alignment()
    wl.cell(rr, 2).number_format = INT
    for j in (3, 4, 5): wl.cell(rr, j).number_format = NUM
    wl.cell(rr, 6).number_format = PCT
    wl.cell(rr, 13).number_format = BRL
    wl.cell(rr, 14).number_format = BRL
LEND = L0 + len(linhas) - 1
rt = LEND + 1
wl.cell(rt, 1, "TOTAL").font = fB
wl.cell(rt, 2, f"=SUM(B{L0}:B{LEND})").number_format = INT
wl.cell(rt, 9, f"=SUM(I{L0}:I{LEND})"); wl.cell(rt, 10, f"=SUM(J{L0}:J{LEND})"); wl.cell(rt, 11, f"=SUM(K{L0}:K{LEND})")
wl.cell(rt, 14, f"=SUM(N{L0}:N{LEND})").number_format = BRL
for col in range(1, 15):
    wl.cell(rt, col).font = fB; wl.cell(rt, col).border = bd; wl.cell(rt, col).fill = fillGr
wl.cell(rt + 2, 1, "Observações de leitura do edital:").font = fB
obs = [
    "• Linha 02: o Anexo II não menciona monitora (apenas 1 motorista por período) — confirmar no Termo de Referência; se houver monitora, altere a coluna K.",
    "• Linha 03: 2 itinerários simultâneos → 2 ônibus, 2 motoristas e 2 monitoras (87,6 km/dia somados).",
    "• Linhas 01, 04 e 06: período noturno até 23h00 — custo de pessoal recebe o fator de jornada estendida (Premissas).",
    "• Linha 04 e 06/08: no edital a soma terra + asfalto não bate exatamente com o total do dia; adotou-se terra do edital e asfalto = total − terra.",
    "• Linha 09: 100% asfalto. Linha 06: maior km terra (49 km/dia), o que eleva combustível, pneus e manutenção.",
    "• Vencimentos diferentes (10/12/2026 e 24/04/2027) — o edital mesmo assim quantifica 200 dias letivos em todas as linhas.",
]
for k, o in enumerate(obs):
    wl.cell(rt + 3 + k, 1, o).font = Font(name=F, size=9)
wl.freeze_panes = "B5"

# ------------------------------------------------------------------ CUSTO POR LINHA
wc = wb.create_sheet("Custo por Linha")
title(wc, 1, "COMPOSIÇÃO DE CUSTO E PREÇO POR LINHA (todas as células são fórmulas — altere apenas Premissas e Linhas)", 22)
wc.cell(2, 1, "Preço/km proposto = custo total ÷ (1 − lucro − tributos) ÷ km do edital, arredondado em 2 casas (exigência do edital).").font = Font(name=F, size=9, italic=True)
ch = ["Linha", "KM edital", "KM rodado c/ km morto", "Pessoal /mês (R$)", "Veículo /mês (R$)", "Custo fixo total (R$)",
      "Diesel (R$/km)", "Outros variáveis (R$/km)", "Variável total (R$/km)", "Custo variável total (R$)",
      "Custo direto (R$)", "Overhead (R$)", "Custo total (R$)", "Custo /km (R$)",
      "Preço /km PROPOSTO (R$)", "Valor total proposto (R$)", "Lucro líquido (R$)", "Preço ref. (R$/km)", "Δ vs. referência", "Valor ref. total (R$)", "Fixo /km", "Variável /km"]
cw = [7, 11, 13, 14, 14, 15, 11, 12, 12, 15, 15, 13, 15, 11, 13, 16, 14, 12, 11, 16, 10, 10]
for i, (h, w) in enumerate(zip(ch, cw), 1):
    c = wc.cell(4, i, h); c.font = fH; c.fill = fillH; c.border = bd
    c.alignment = Alignment(wrap_text=True, horizontal="center", vertical="center")
    wc.column_dimensions[get_column_letter(i)].width = w
wc.row_dimensions[4].height = 45

C0 = 5
for i in range(len(linhas)):
    rr = C0 + i; lr = L0 + i
    L = lambda col: f"Linhas!{col}{lr}"
    f = {}
    f["A"] = f"={L('A')}"
    f["B"] = f"={L('B')}"
    f["C"] = f"=B{rr}*(1+{P['km_morto']})"
    # pessoal mensal
    f["D"] = (f"={L('J')}*{P['sal_mot']}*(1+{P['encargos']})*IF({L('H')}=\"S\",{P['fator_not']},1)"
              f"+{L('K')}*{P['sal_mon']}*(1+{P['encargos']})"
              f"+({L('J')}+{L('K')})*({P['benef']}+{P['epi']})")
    # veiculo mensal
    f["E"] = (f"={L('I')}*(1+{P['reserva']})*({P['valor_veic']}*({P['deprec']}+{P['capital']})/12"
              f"+{P['seguro']}+{P['ipva']}/12+{P['rastreador']}+{P['inspecao']}/12)+{L('I')}*{P['garagem']}")
    f["F"] = f"=(D{rr}+E{rr})*{P['meses']}"
    # diesel por km ponderado
    f["G"] = f"={P['diesel']}*((1-{L('F')})/{P['cons_asf']}+{L('F')}/{P['cons_terra']})"
    f["H"] = (f"={P['arla']}+{P['lub']}+(1-{L('F')})*({P['pneus_asf']}+{P['manut_asf']})"
              f"+{L('F')}*({P['pneus_terra']}+{P['manut_terra']})")
    f["I"] = f"=G{rr}+H{rr}"
    f["J"] = f"=I{rr}*C{rr}"
    f["K"] = f"=F{rr}+J{rr}"
    f["L"] = f"=K{rr}*{P['adm']}"
    f["M"] = f"=K{rr}+L{rr}"
    f["N"] = f"=IF(B{rr}=0,0,M{rr}/B{rr})"
    f["O"] = f"=IF(B{rr}=0,0,ROUNDUP(M{rr}/(1-{P['lucro']}-{P['trib']})/B{rr},2))"
    f["P"] = f"=O{rr}*B{rr}"
    f["Q"] = f"=P{rr}*(1-{P['trib']})-M{rr}"
    f["R"] = f"={L('M')}"
    f["S"] = f"=IF(R{rr}=0,0,O{rr}/R{rr}-1)"
    f["T"] = f"={L('N')}"
    f["U"] = f"=IF(B{rr}=0,0,F{rr}/B{rr})"
    f["V"] = f"=IF(B{rr}=0,0,J{rr}/B{rr})"
    for col, val in f.items():
        c = wc[f"{col}{rr}"]; c.value = val; c.border = bd; c.font = fN
    for col in ("A", "B", "R", "T"): wc[f"{col}{rr}"].font = fLink
    wc[f"A{rr}"].alignment = Alignment(horizontal="center")
    wc[f"B{rr}"].number_format = INT; wc[f"C{rr}"].number_format = INT
    for col in "DEFJKLMPQT": wc[f"{col}{rr}"].number_format = BRL
    for col in "GHINRUV": wc[f"{col}{rr}"].number_format = BRL4
    wc[f"O{rr}"].number_format = BRL; wc[f"O{rr}"].font = fB; wc[f"O{rr}"].fill = fillG
    wc[f"S{rr}"].number_format = '+0.0%;-0.0%;0.0%'
CEND = C0 + len(linhas) - 1
rt = CEND + 1
wc.cell(rt, 1, "TOTAL").font = fB
for col in "BCFJKLMPQT":
    wc[f"{col}{rt}"] = f"=SUM({col}{C0}:{col}{CEND})"
    wc[f"{col}{rt}"].number_format = INT if col in "BC" else BRL
wc[f"N{rt}"] = f"=IF(B{rt}=0,0,M{rt}/B{rt})"; wc[f"N{rt}"].number_format = BRL4
wc[f"O{rt}"] = f"=IF(B{rt}=0,0,P{rt}/B{rt})"; wc[f"O{rt}"].number_format = BRL4
wc[f"S{rt}"] = f"=IF(T{rt}=0,0,P{rt}/T{rt}-1)"; wc[f"S{rt}"].number_format = '+0.0%;-0.0%;0.0%'
for col in range(1, 23):
    wc.cell(rt, col).font = fB; wc.cell(rt, col).border = bd; wc.cell(rt, col).fill = fillGr

# resumo
rs = rt + 2
wc.cell(rs, 1, "RESUMO").font = fSec
items = [
    ("Valor total da proposta (9 linhas)", f"=P{rt}", BRL),
    ("Valor total de referência (Licita+)", f"=T{rt}", BRL),
    ("Proposta vs. referência", f"=S{rt}", '+0.0%;-0.0%;0.0%'),
    ("Custo total estimado", f"=M{rt}", BRL),
    ("Lucro líquido estimado (após tributos)", f"=Q{rt}", BRL),
    ("Margem líquida sobre faturamento", f"=IF(P{rt}=0,0,Q{rt}/P{rt})", PCT),
    ("Preço médio proposto (R$/km)", f"=O{rt}", BRL4),
    ("Preço mínimo p/ empatar custo (R$/km, lucro zero)", f"=IF(B{rt}=0,0,M{rt}/(1-{P['trib']})/B{rt})", BRL4),
    ("Frota necessária (ônibus, sem reserva)", f"=Linhas!I{LEND+1}", INT),
    ("Motoristas / Monitoras", f"=Linhas!J{LEND+1}&\" / \"&Linhas!K{LEND+1}", None),
]
for k, (lab, fx, fmt) in enumerate(items):
    wc.cell(rs + 1 + k, 1, lab).font = fN
    wc.merge_cells(start_row=rs + 1 + k, start_column=1, end_row=rs + 1 + k, end_column=5)
    c = wc.cell(rs + 1 + k, 6, fx); c.font = fB
    if fmt: c.number_format = fmt
    c.border = bd
wc.freeze_panes = "B5"

# ------------------------------------------------------------------ PROPOSTA
wp = wb.create_sheet("Proposta (Anexo II)")
for col, w in zip("ABCDEF", [8, 12, 8, 60, 16, 18]):
    wp.column_dimensions[col].width = w
title(wp, 1, "ANEXO II — MODELO DE PROPOSTA — PREGÃO ELETRÔNICO N° 036/2026 — PREFEITURA MUNICIPAL DA ESTÂNCIA TURÍSTICA DE HOLAMBRA", 6)
wp.cell(2, 1, "Objeto: Contratação de pessoas jurídicas (empresa especializada em transporte escolar) para a prestação de serviços de transporte escolar para zona rural e urbana para os alunos do Município de Holambra, veículos utilizados: ônibus, conforme condições estabelecidas no Termo de Referência.").font = Font(name=F, size=9)
wp.merge_cells("A2:F2"); wp["A2"].alignment = Alignment(wrap_text=True, vertical="top"); wp.row_dimensions[2].height = 40
wp.cell(4, 1, "DADOS DO LICITANTE").font = fSec
dados = [("DENOMINAÇÃO:", P["razao"]), ("ENDEREÇO:", P["endereco"]), ("CNPJ:", P["cnpj"]), ("TELEFONE:", P["tel"]), ("E-MAIL:", P["email"])]
for k, (lab, ref) in enumerate(dados):
    wp.cell(5 + k, 1, lab).font = fB
    c = wp.cell(5 + k, 2, f"={ref}"); c.font = fLink
    wp.merge_cells(start_row=5 + k, start_column=2, end_row=5 + k, end_column=6)
wp.cell(11, 1, "RESPONSÁVEL PELA ASSINATURA DO CONTRATO").font = fSec
dados2 = [("NOME:", P["resp"]), ("RG:", P["rg"]), ("CPF:", P["cpf"]), ("E-MAIL:", P["email"]), ("CARGO:", P["cargo"])]
for k, (lab, ref) in enumerate(dados2):
    wp.cell(12 + k, 1, lab).font = fB
    c = wp.cell(12 + k, 2, f"={ref}"); c.font = fLink
    wp.merge_cells(start_row=12 + k, start_column=2, end_row=12 + k, end_column=6)

wp.cell(18, 1, "LINHAS/ROTAS E SEU ITINERÁRIO").font = fSec
ph = ["LINHA/ ROTA", "QTD.", "UNID.", "DESCRIÇÃO DA LINHA", "PREÇO POR KM RODADO", "VALOR TOTAL DA LINHA"]
for i, h in enumerate(ph, 1):
    c = wp.cell(19, i, h); c.font = fH; c.fill = fillH; c.border = bd
    c.alignment = Alignment(wrap_text=True, horizontal="center", vertical="center")
wp.row_dimensions[19].height = 30
desc = {
    1: "LINHA 01 – Matutino, Vespertino e Noturno – 135,8 km/dia – veículo mín. 59 lugares – 1 motorista, 1 monitora – seg. a sex. – venc. 10/12/2026",
    2: "LINHA 02 – Matutino e Vespertino – 108,8 km/dia – veículo mín. 59 lugares – 1 motorista – seg. a sex. – venc. 10/12/2026",
    3: "LINHA 03 – Itinerários 1 e 2 – Matutino e Vespertino – 87,6 km/dia – 2 veículos mín. 59 lugares – 2 motoristas, 2 monitoras – seg. a sex. – venc. 24/04/2027",
    4: "LINHA 04 – Matutino, Vespertino e Noturno – 145,6 km/dia – veículo mín. 59 lugares – 1 motorista, 1 monitora – seg. a sex. – venc. 10/12/2026",
    5: "LINHA 05 – Matutino e Vespertino – 100,8 km/dia – veículo mín. 59 lugares – 1 motorista, 1 monitora – seg. a sex. – venc. 10/12/2026",
    6: "LINHA 06 – Matutino, Vespertino e Noturno – 164,6 km/dia – veículo mín. 59 lugares – 1 motorista, 1 monitora – seg. a sex. – venc. 10/12/2026",
    7: "LINHA 07 – Matutino e Vespertino – 83,6 km/dia – veículo mín. 59 lugares – 1 motorista, 1 monitora – seg. a sex. – venc. 10/12/2026",
    8: "LINHA 08 – Matutino e Vespertino – 74,4 km/dia – veículo mín. 59 lugares – 1 motorista, 1 monitora – seg. a sex. – venc. 24/04/2027",
    9: "LINHA 09 – Matutino e Vespertino – 55,6 km/dia – veículo mín. 59 lugares – 1 motorista, 1 monitora – seg. a sex. – venc. 24/04/2027",
}
P0 = 20
for i in range(len(linhas)):
    rr = P0 + i; cr = C0 + i
    vals = [f"='Custo por Linha'!A{cr}", f"='Custo por Linha'!B{cr}", "KM", desc[i + 1], f"='Custo por Linha'!O{cr}", f"=B{rr}*E{rr}"]
    for j, v in enumerate(vals, 1):
        c = wp.cell(rr, j, v); c.border = bd
        c.font = fLink if j in (1, 2, 5) else fN
        c.alignment = Alignment(wrap_text=True, vertical="top", horizontal="center" if j in (1, 3) else "left")
    wp.cell(rr, 2).number_format = INT
    wp.cell(rr, 5).number_format = BRL; wp.cell(rr, 6).number_format = BRL
    wp.row_dimensions[rr].height = 42
PEND = P0 + len(linhas) - 1
rt = PEND + 1
wp.cell(rt, 4, "VALOR GLOBAL DA PROPOSTA").font = fB
wp.cell(rt, 4).alignment = Alignment(horizontal="right")
wp.cell(rt, 6, f"=SUM(F{P0}:F{PEND})").number_format = BRL
wp.cell(rt, 6).font = fB
for col in range(1, 7): wp.cell(rt, col).border = bd; wp.cell(rt, col).fill = fillGr

txt = [
    "CONDIÇÃO DE PAGAMENTO: 30 (trinta) dias, após a liquidação e aceite pelos gestores do contrato.",
    "VALIDADE DA PROPOSTA: 60 (SESSENTA) DIAS",
    "Os valores que ultrapassarem 02 (duas) casas decimais após a vírgula serão desconsiderados para fins de apuração do preço final.",
    "DECLARAMOS QUE estamos de acordo com os termos do Edital, e acatamos suas determinações, bem como informamos que nos preços propostos estão inclusos todos os custos diretos e indiretos, lucros e demais contribuições pertinentes de nossa responsabilidade, sem qualquer exceção, constituindo-se os referidos preços unitários nas únicas contraprestações da PREFEITURA MUNICIPAL DE HOLAMBRA pelas efetivas prestações de serviços de transporte de alunos, sob nossa conta e risco.",
    "DECLARAMOS QUE os serviços ofertados atendem a todas as condições fixadas nas normas técnicas especificadas no edital.",
    "DECLARAMOS QUE nenhum direito a indenização ou a reembolso de quaisquer despesas nos será devido, caso nossa proposta não seja aceita pela PREFEITURA MUNICIPAL DE HOLAMBRA.",
    "DECLARAMOS QUE CONCORDAMOS integralmente com as condições estipuladas na presente licitação e, que caso vencedores, nos submeteremos ao cumprimento de seus termos.",
]
rr = rt + 2
for t in txt:
    wp.cell(rr, 1, t).font = Font(name=F, size=9)
    wp.merge_cells(start_row=rr, start_column=1, end_row=rr, end_column=6)
    wp.cell(rr, 1).alignment = Alignment(wrap_text=True, vertical="top")
    wp.row_dimensions[rr].height = 15 if len(t) < 120 else 42
    rr += 1
rr += 1
c = wp.cell(rr, 1, f"={P['cidade_data']}"); c.font = fLink
wp.merge_cells(start_row=rr, start_column=1, end_row=rr, end_column=6); c.alignment = Alignment(horizontal="center")
rr += 2
wp.cell(rr, 1, "_____________________________________").alignment = Alignment(horizontal="center")
wp.merge_cells(start_row=rr, start_column=1, end_row=rr, end_column=6)
rr += 1
c = wp.cell(rr, 1, f"={P['resp']}&\" — \"&{P['cargo']}"); c.font = fLink
wp.merge_cells(start_row=rr, start_column=1, end_row=rr, end_column=6); c.alignment = Alignment(horizontal="center")
rr += 1
c = wp.cell(rr, 1, f"={P['razao']}&\" — CNPJ \"&{P['cnpj']}"); c.font = fLink
wp.merge_cells(start_row=rr, start_column=1, end_row=rr, end_column=6); c.alignment = Alignment(horizontal="center")
wp.page_setup.orientation = "portrait"; wp.page_setup.fitToWidth = 1
wp.sheet_properties.pageSetUpPr.fitToPage = True

wb.save(OUT)
print("saved", OUT)
