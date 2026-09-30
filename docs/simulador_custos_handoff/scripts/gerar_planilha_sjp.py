from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

OUT = "/mnt/user-data/outputs/Planilha_Custos_PE089-2026_SJPinhais_Transporte_SUS_AzulMob.xlsx"
F = "Arial"
fN = Font(name=F, size=10); fB = Font(name=F, size=10, bold=True)
fT = Font(name=F, size=13, bold=True, color="FFFFFF"); fH = Font(name=F, size=10, bold=True, color="FFFFFF")
fIn = Font(name=F, size=10, color="0000FF"); fLink = Font(name=F, size=10, color="008000")
fSec = Font(name=F, size=11, bold=True, color="1F3864"); f9 = Font(name=F, size=9)
fillT = PatternFill("solid", fgColor="1F3864"); fillH = PatternFill("solid", fgColor="2F5496")
fillY = PatternFill("solid", fgColor="FFFF00"); fillG = PatternFill("solid", fgColor="E2EFDA")
fillGr = PatternFill("solid", fgColor="F2F2F2"); fillR = PatternFill("solid", fgColor="FCE4D6")
thin = Side(style="thin", color="BFBFBF"); bd = Border(left=thin, right=thin, top=thin, bottom=thin)
BRL = 'R$ #,##0.00;[Red](R$ #,##0.00);-'; BRL4 = 'R$ #,##0.0000;[Red](R$ #,##0.0000);-'
PCT = '0.0%'; PCT2 = '0.00%'; NUM = '#,##0.00'; INT = '#,##0'; DPCT = '+0.0%;-0.0%;0.0%'
WRAP = Alignment(wrap_text=True, vertical="top")

wb = Workbook()

def title(ws, r, txt, span):
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=span)
    c = ws.cell(r, 1, txt); c.font = fT; c.fill = fillT; ws.row_dimensions[r].height = 22
def sec(ws, r, txt, span=4):
    c = ws.cell(r, 1, txt); c.font = fSec
    for col in range(1, span + 1): ws.cell(r, col).fill = fillG
def header(ws, r, hdrs, widths=None, h=32):
    for i, hd in enumerate(hdrs, 1):
        c = ws.cell(r, i, hd); c.font = fH; c.fill = fillH; c.border = bd
        c.alignment = Alignment(wrap_text=True, horizontal="center", vertical="center")
        if widths: ws.column_dimensions[get_column_letter(i)].width = widths[i - 1]
    ws.row_dimensions[r].height = h

# =============================================================== PREMISSAS
ws = wb.active; ws.title = "Premissas"
for col, w in zip("ABCD", [54, 18, 16, 74]): ws.column_dimensions[col].width = w
title(ws, 1, "PLANILHA DE CUSTOS — PREGÃO ELETRÔNICO 089/2026-SERMALI — SÃO JOSÉ DOS PINHAIS/PR — Transporte de pacientes SUS (hemodiálise) e servidores (vans ≥15 lug.)", 4)
ws.cell(2, 1, "Legenda: azul = entrada editável · amarelo = preencher · preto = fórmula · verde = link de outra aba. Premissas de custo são ESTIMATIVAS DE MERCADO (Curitiba/RMC, set/2026) — troque pelos números reais da Azul Mob. Sessão: 28/09/2026 09h (Comprasgov, UASG 987885). Preço máximo: R$ 11,11/km nos 2 itens. Lote único, menor preço por lote, disputa aberta, lance mínimo R$ 0,20.").font = f9
ws.merge_cells("A2:D2"); ws["A2"].alignment = WRAP; ws.row_dimensions[2].height = 42
header(ws, 4, ["Item", "Valor", "Unid.", "Observação / fonte / regra do edital"], h=20)

P = {}; r = [5]
def put(name, label, val, unit, note, fmt=None, fill=None):
    rr = r[0]
    ws.cell(rr, 1, label).font = fN
    c = ws.cell(rr, 2, val); c.font = fIn
    if fmt: c.number_format = fmt
    if fill: c.fill = fill
    ws.cell(rr, 3, unit).font = fN
    n = ws.cell(rr, 4, note); n.font = f9; n.alignment = WRAP
    for col in range(1, 5): ws.cell(rr, col).border = bd
    if name: P[name] = f"Premissas!$B${rr}"
    r[0] += 1
def formula_row(name, label, fx, unit, note, fmt):
    rr = r[0]
    ws.cell(rr, 1, label).font = fB
    c = ws.cell(rr, 2, fx); c.font = fB; c.number_format = fmt
    ws.cell(rr, 3, unit).font = fN
    n = ws.cell(rr, 4, note); n.font = f9; n.alignment = WRAP
    for col in range(1, 5): ws.cell(rr, col).border = bd
    P[name] = f"Premissas!$B${rr}"; r[0] += 1

sec(ws, r[0], "1. DADOS DO LICITANTE"); r[0] += 1
put("razao", "Razão social", "AZUL TRANSPORTES E TURISMO LTDA", "", "Nome fantasia Azul Mob.")
put("cnpj", "CNPJ", "10.764.533/0001-01", "", "")
put("endereco", "Endereço da sede", "", "", "PREENCHER (São Paulo/SP). Atenção: o edital exige certidão de tributos municipais de São José dos Pinhais também (TR 2.9).", fill=fillY)
put("resp", "Representante legal (nome / RG / CPF)", "", "", "PREENCHER — assina proposta, Anexo VI (vinculação dos motoristas) e declaração de rastreamento.", fill=fillY)

r[0] += 1; sec(ws, r[0], "2. PARÂMETROS DO CONTRATO (extraídos do edital / TR nº 225/2026)"); r[0] += 1
put("meses", "Vigência considerada", 12, "meses", "Ata 12 meses prorrogável; contrato 12 meses prorrogável até 10 anos (TR 4.6/4.7). Início após 05/12/2026 (TR 8.1).", INT)
put("dias_hd", "Dias de operação/mês — Item 01 hemodiálise", 26, "dias", "Segunda a SÁBADO, inclusive feriados (TR 8.2/8.16).", INT)
put("dias_sv", "Dias de operação/mês — Item 02 servidores", 22, "dias", "Segunda a sexta, 07h00–17h00 (TR 8.25).", INT)
put("util", "Utilização esperada do km máximo registrado", 0.85, "%", "RISCO-CHAVE: SRP paga só km útil validado (telemetria + presença). Fase 1 = só CDR local + UBS; rotas externas (Curitiba etc.) entram na Fase 2, gradualmente (TR 3.3–3.9). Sem indenização por ociosidade (TR 10.3). Use 0,7–1,0 para testar.", PCT)
put("km_morto", "Km improdutivo (garagem ↔ ponto de partida, retornos vazios)", 0.15, "% do km útil", "Km útil conta a partir da Central de Veículos (pacientes) ou Paço Municipal (servidores) — TR 8.14. Deslocamento da garagem própria até lá NÃO é pago; garagem pública é vedada (TR 8.27).", PCT)
put("reserva", "Reserva técnica de frota", 0.15, "% da frota", "Substituição em até 2 h por quebra (TR 8.4) e 48 h por avaria menor (TR 9.18) → 1 van reserva para cada ~7. Frota inicial mínima: 6 vans (TR 8.8).", PCT)

r[0] += 1; sec(ws, r[0], "3. MÃO DE OBRA"); r[0] += 1
put("sal_mot", "Salário base — motorista de van (CNH D + EAR + curso coletivo)", 2950, "R$/mês", "ESTIMATIVA CCT SETRANSP/SINDIMOC Curitiba-RMC 2026 (motorista de micro/van). Exige curso CONTRAN transporte coletivo + primeiros socorros (TR 2.26/2.27).", BRL)
put("mot_por_van_hd", "Motoristas por van — Item 01 (3 turnos 06h–19h + coleta domiciliar)", 1.8, "motoristas/van", "Jornada útil ≈ 05h00–20h00 (15 h) → 2 motoristas por van ou 1 + escala. 1,8 = 2 motoristas com folgas compensadas por reserva. Sábado = jornada 44 h/sem.", NUM)
put("mot_por_van_sv", "Motoristas por van — Item 02 (07h–17h, ociosa no meio do dia)", 1.0, "motoristas/van", "1 motorista; horas de espera são jornada (TR 8.26 — veículo livre, mas pontualidade obrigatória).", NUM)
put("he", "Horas extras / adicional (média sobre salário)", 0.12, "%", "Sábados, feriados (TR 8.2), atrasos de clínica. Estimativa.", PCT)
put("encargos", "Encargos e provisões (INSS patronal, RAT, FGTS, férias+1/3, 13º, rescisão)", 0.70, "%", "Regime CLT, lucro presumido/real (não Simples). Folha deve ser apresentada com a NF (TR 10.16).", PCT)
put("benef", "Benefícios (VA/VR + cesta + seguro de vida + VT)", 950, "R$/mês por func.", "Curitiba/RMC: VA ~R$ 30/dia + VT (equipe local). Alimentação e fardamento são da contratada (TR 8.6).", BRL)
put("epi", "Uniforme, crachá, EPI, ASO, toxicológico, cursos", 90, "R$/mês por func.", "Uniforme + crachá obrigatórios (TR 9.19); curso primeiros socorros; toxicológico CNH D.", BRL)
put("supervisor", "Preposto / supervisor local + apoio administrativo", 7500, "R$/mês (total)", "Preposto formal obrigatório (TR 9.4). Relatórios mensais de telemetria + presença (TR 10.5). Salário + encargos.", BRL)

r[0] += 1; sec(ws, r[0], "4. VEÍCULO — van ≥15 lugares, ≤5 anos e ≤150.000 km (TR 8.8/8.10) — custo fixo mensal por van"); r[0] += 1
put("valor_van", "Valor da van (ex.: Sprinter 415/517, Master, Ducato — 2–3 anos)", 290000, "R$", "ESTIMATIVA FIPE set/2026. Vans com >5 anos ou >150 mil km ficam INELEGÍVEIS durante o contrato → renovação obrigatória.", BRL)
put("deprec", "Depreciação anual", 0.15, "% a.a.", "Van roda ~90–100 mil km/ano no Item 01 → atinge 150 mil km em ~18 meses se comprada usada. Considere veículo 0 km ou troca.", PCT)
put("capital", "Custo de capital / financiamento (CDC/consórcio)", 0.15, "% a.a.", "Taxa média dos contratos de financiamento da Azul.", PCT)
put("seguro", "Seguro casco + RCF-V (DM 40 mil / DC 100 mil / DMo 5 mil — TR 9.17)", 750, "R$/mês", "ESTIMATIVA. Apólice exigida antes do início.", BRL)
put("ipva", "IPVA + licenciamento + DPVAT (PR)", 3800, "R$/ano", "PR: micro-ônibus/transporte coletivo tem alíquota reduzida; conferir enquadramento da van.", BRL)
put("telemetria", "Telemetria HÍBRIDA (GPRS + satélite) + plataforma web", 260, "R$/mês por van", "Rastreamento GPRS no dia 1 e satélite/híbrido em 60 dias (TR 2.21–2.23, 9.24–9.26). Ituran/Onixsat/Sascar híbrido custa 2–3× o GPRS comum.", BRL)
put("embarque", "Sistema de controle de embarque (QR Code/biometria/app) + relatório de frequência", 90, "R$/mês por van", "Obrigatório e condição de pagamento (TR 9.27–9.31). App + tablet/celular embarcado.", BRL)
put("higien", "Higienização diária + desinfecção periódica", 320, "R$/mês por van", "TR 9.21. Produtos + mão de obra.", BRL)
put("acess", "Acessibilidade (barras, estribo/escada móvel) + identificação visual (adesivagem)", 45, "R$/mês por van", "R$ ~2.700 por van amortizado em 5 anos (TR 8.12, 9.20).", BRL)
put("laudo", "Laudo técnico anual de frota + vistorias", 600, "R$/ano por van", "Relatório assinado por profissional em 5 dias úteis (TR 5.7); CRLV anual (TR 8.11).", BRL)
put("garagem", "Garagem / base operacional em São José dos Pinhais (rateio)", 700, "R$/mês por van", "ESTIMATIVA: pátio + sala ~R$ 6.000/mês ÷ 8–9 vans. Sede da Azul é em SP → base local obrigatória; pátio público vedado (TR 8.27).", BRL)

r[0] += 1; sec(ws, r[0], "5. INSUMOS VARIÁVEIS (por km rodado)"); r[0] += 1
put("diesel", "Diesel S10 — preço bomba (Curitiba/RMC)", 6.05, "R$/litro", "ESTIMATIVA ANP PR set/2026. Reajuste só após 12 meses do orçamento (22/06/2026) pelo IPCA — variação de diesel entre 06/2026 e 06/2027 é risco da contratada.", BRL)
put("cons", "Consumo médio da van (urbano/rodoviário misto, ar-condicionado)", 8.5, "km/litro", "Sprinter/Master diesel com carga de passageiros: 8–9,5 km/l.", NUM)
put("arla", "ARLA 32 (uso obrigatório, notas arquivadas — TR 5.2)", 0.04, "R$/km", "~4% do diesel × R$ 4/l.", BRL4)
put("pneus", "Pneus (215/75 R16 — 6 unid. + reserva) e alinhamento", 0.13, "R$/km", "6 × R$ 1.100 ÷ 55.000 km + serviços.", BRL4)
put("manut", "Manutenção preventiva + corretiva (peças, óleo, freios, MO)", 0.48, "R$/km", "Van ≤5 anos, plano de manutenção preventiva obrigatório (TR 9.16). Inclui revisões de concessionária p/ garantia.", BRL4)
put("lub", "Lavagem externa, lubrificantes, pequenos consumíveis", 0.05, "R$/km", "", BRL4)

r[0] += 1; sec(ws, r[0], "6. PEDÁGIO (por passagem; quantidades na aba Rotas)"); r[0] += 1
put("ped_277", "Pedágio BR-277 sentido Campo Largo (praça Campo Largo/Balsa Nova) — van cat. 2 eixos", 12.00, "R$/passagem", "CONFERIR tarifa vigente da nova concessão (Lote 2 – Via Araucária/EPR). Van 2 eixos (rodagem simples) costuma pagar tarifa de automóvel ×1 ou ×2 conforme classe.", BRL)
put("ped_116", "Pedágio BR-116 norte (Campina Grande do Sul)", 0.00, "R$/passagem", "Praça mais próxima fica após Campina Grande do Sul (Régis Bittencourt sentido SP); trajeto até clínicas no município normalmente NÃO paga. Ajuste se a clínica ficar além da praça.", BRL)
put("ped_376", "Pedágio BR-376 sul (km 620–632, rotas UBS Malhada/Córrego Fundo/Faxina)", 0.00, "R$/passagem", "Praça de pedágio de SJP na BR-376 (Litoral Sul) fica no km ~632; as UBS e PEDs listados estão no km 615–621. CONFERIR na vistoria se algum trecho cruza a praça. Curitiba: sem pedágio.", BRL)
put("ped_share", "% das viagens do Item 01 que vão a Campo Largo (com pedágio)", 0.10, "%", "Fase 2. Estimativa: maioria dos pacientes fica na CDR local e Curitiba (sem pedágio).", PCT)
put("ped_pass", "Passagens de pedágio por viagem a Campo Largo (ida+volta)", 2, "passagens", "", INT)

r[0] += 1; sec(ws, r[0], "7. INDIRETOS, TRIBUTOS E LUCRO"); r[0] += 1
put("adm", "Administração central (rateio SP: RH, contabilidade, TI, sistema de motoristas)", 0.07, "% s/ custo direto", "", PCT)
put("risco", "Contingência / risco (ociosidade Fase 1, multas 0,5–30%, sinistros)", 0.03, "% s/ custo direto", "Edital: multa de 0,5% a 30% sobre o valor do objeto; risco de demanda alocado à contratada.", PCT)
put("lucro", "Lucro líquido desejado", 0.09, "% s/ preço", "Ajuste para a estratégia de lance (ver aba Cenários).", PCT)
put("pis", "PIS", 0.0065, "% s/ fat.", "Lucro presumido (cumulativo).", PCT2)
put("cofins", "COFINS", 0.03, "% s/ fat.", "Lucro presumido (cumulativo).", PCT2)
put("irpj", "IRPJ (base 8% × 15% + adicional)", 0.0135, "% s/ fat.", "Serviços de transporte: base 8%; adicional 10% acima de R$ 20 mil/mês de lucro presumido → ~1,35% efetivo.", PCT2)
put("csll", "CSLL (base 12% × 9%)", 0.0108, "% s/ fat.", "", PCT2)
put("iss", "ISS — São José dos Pinhais (transporte MUNICIPAL de passageiros)", 0.03, "% s/ fat. municipal", "CONFERIR LC municipal 01/2003 (item 16.01/16.02): 2% a 5%. ISS é devido no município da prestação; empresa de SP recolhe para SJP (retenção na fonte provável).", PCT2)
put("icms", "ICMS — transporte INTERMUNICIPAL (Curitiba, Campo Largo, Campina G. do Sul)", 0.12, "% s/ fat. intermunicipal", "ATENÇÃO: transporte intermunicipal de passageiros é fato gerador de ICMS (não ISS). PR: 12% com possibilidade de crédito presumido/regime especial (RICMS-PR). Confirmar com contabilidade — pode exigir inscrição estadual no PR.", PCT2)
put("share_inter", "% do faturamento do Item 01 que é intermunicipal (Fase 2)", 0.35, "%", "Estimativa: rotas externas entram gradualmente. Item 02 é 100% municipal.", PCT)
formula_row("trib_mun", "Tributos totais — faturamento municipal", f"={P['pis']}+{P['cofins']}+{P['irpj']}+{P['csll']}+{P['iss']}", "%", "PIS+COFINS+IRPJ+CSLL+ISS", PCT2)
formula_row("trib_inter", "Tributos totais — faturamento intermunicipal", f"={P['pis']}+{P['cofins']}+{P['irpj']}+{P['csll']}+{P['icms']}", "%", "PIS+COFINS+IRPJ+CSLL+ICMS", PCT2)
formula_row("trib_hd", "Tributos médios — Item 01", f"={P['trib_mun']}*(1-{P['share_inter']})+{P['trib_inter']}*{P['share_inter']}", "%", "Ponderado pela parcela intermunicipal", PCT2)
formula_row("trib_sv", "Tributos médios — Item 02", f"={P['trib_mun']}", "%", "100% municipal", PCT2)
put("prazo_pgto", "Prazo de pagamento (custo financeiro do capital de giro)", 30, "dias", "Pagamento em até 30 dias da fatura correta (edital, cl. pagamento). Na prática, medição + documentos (6 certidões + folha) → 45–60 dias.", INT)
put("juros_cg", "Custo do capital de giro", 0.018, "% a.m.", "Taxa de desconto/antecipação de recebíveis.", '0.00%')
formula_row("fin", "Custo financeiro sobre faturamento", f"={P['juros_cg']}*{P['prazo_pgto']}/30", "% s/ fat.", "Juros × prazo médio de recebimento", PCT2)
ws.freeze_panes = "A5"

# =============================================================== ROTAS
wr = wb.create_sheet("Rotas")
title(wr, 1, "ROTAS E QUANTITATIVOS — TR 225/2026 item 12.5 e Anexo II (itinerários)", 13)
wr.cell(2, 1, "Km/mês máximo registrado por rota (edital). Vans e motoristas dimensionados a partir do km/dia e da jornada. Preço máximo R$ 11,11/km nos dois itens (Anexo III).").font = f9
rh = ["Item", "Rota", "Km/mês máx. (edital)", "Km/ano máx.", "Dias/mês", "Km/dia", "Vans operacionais", "Motoristas", "Viagens/dia (est.)", "Passagens pedágio/mês", "Pedágio R$/mês", "Preço máx. (R$/km)", "Valor máx. anual (R$)"]
header(wr, 4, rh, [7, 30, 14, 13, 9, 10, 12, 11, 11, 13, 13, 12, 16], h=40)
rotas = [
    (1, "Hemodiálise — ROTA NORTE", 7800, "hd", 1, 6),
    (1, "Hemodiálise — ROTA SUL", 7800, "hd", 1, 6),
    (1, "Hemodiálise — ROTA CENTRO", 7800, "hd", 1, 6),
    (1, "Hemodiálise — ROTA SUDESTE", 7800, "hd", 1, 6),
    (2, "Servidores — ROTA 01 (UBS Campina do Taquaral, Cachoeira, Agaraú, Cotia, Marcelino)", 1800, "sv", 1, 1),
    (2, "Servidores — ROTA 02 (UBS Malhada, Córrego Fundo)", 2000, "sv", 1, 1),
    (2, "Servidores — ROTA 03 (UBS Faxina, Contenda, Campo Largo da Roseira)", 1800, "sv", 1, 1),
]
R0 = 5
for i, (item, nome, km, tipo, vans, viag) in enumerate(rotas):
    rr = R0 + i
    dias = P['dias_hd'] if tipo == "hd" else P['dias_sv']
    motv = P['mot_por_van_hd'] if tipo == "hd" else P['mot_por_van_sv']
    if tipo == "hd":
        ped_pass = f"=I{rr}*E{rr}*{P['ped_share']}*{P['ped_pass']}"
        ped_val = f"=J{rr}*{P['ped_277']}"
    else:
        ped_pass = f"=E{rr}*2"
        ped_val = f"=J{rr}*{P['ped_376']}"
    vals = [item, nome, km, f"=C{rr}*12", f"={dias}", f"=IF(E{rr}=0,0,C{rr}/E{rr})", vans, f"=G{rr}*{motv}", viag, ped_pass, ped_val, 11.11, f"=D{rr}*L{rr}"]
    for j, v in enumerate(vals, 1):
        c = wr.cell(rr, j, v); c.border = bd
        c.font = fIn if j in (1, 2, 3, 7, 9, 12) else fN
        if j == 2: c.alignment = WRAP
    wr.cell(rr, 3).number_format = INT; wr.cell(rr, 4).number_format = INT
    wr.cell(rr, 6).number_format = NUM; wr.cell(rr, 8).number_format = NUM
    wr.cell(rr, 10).number_format = NUM; wr.cell(rr, 11).number_format = BRL
    wr.cell(rr, 12).number_format = BRL; wr.cell(rr, 13).number_format = BRL
    wr.row_dimensions[rr].height = 30
REND = R0 + len(rotas) - 1
# subtotais por item
rt1 = REND + 1; rt2 = REND + 2; rt3 = REND + 3
for rr, lab, crit in ((rt1, "Subtotal Item 01 — pacientes", 1), (rt2, "Subtotal Item 02 — servidores", 2)):
    wr.cell(rr, 2, lab).font = fB
    for col in "CDGHJKM":
        wr[f"{col}{rr}"] = f"=SUMIF($A${R0}:$A${REND},{crit},{col}{R0}:{col}{REND})"
        wr[f"{col}{rr}"].number_format = BRL if col in "KM" else (NUM if col in "HJ" else INT)
    for col in range(1, 14): wr.cell(rr, col).font = fB; wr.cell(rr, col).border = bd; wr.cell(rr, col).fill = fillGr
wr.cell(rt3, 2, "TOTAL LOTE").font = fB
for col in "CDGHJKM":
    wr[f"{col}{rt3}"] = f"={col}{rt1}+{col}{rt2}"
    wr[f"{col}{rt3}"].number_format = BRL if col in "KM" else (NUM if col in "HJ" else INT)
for col in range(1, 14): wr.cell(rt3, col).font = fB; wr.cell(rt3, col).border = bd; wr.cell(rt3, col).fill = fillGr
wr.cell(rt3 + 2, 1, "Frota com reserva técnica (vans):").font = fB
wr.cell(rt3 + 2, 7, f"=ROUNDUP(G{rt3}*(1+{P['reserva']}),0)").font = fB
wr.cell(rt3 + 3, 1, "Leitura do edital: hemodiálise ≈ 1.200 km/dia no total (Anexo II) = 300 km/van/dia em 3 turnos (06h–19h). Servidores: 80/100/80 km/dia, saída 07h, retorno 17h. Vans ≥15 lugares, ≤5 anos, ≤150.000 km; mínimo 6 vans na frota inicial; substituição em 2 h.").font = f9
wr.merge_cells(start_row=rt3 + 3, start_column=1, end_row=rt3 + 3, end_column=13); wr.cell(rt3 + 3, 1).alignment = WRAP; wr.row_dimensions[rt3 + 3].height = 30
wr.freeze_panes = "C5"

# =============================================================== CUSTO
wc = wb.create_sheet("Composição de Custo")
title(wc, 1, "COMPOSIÇÃO DE CUSTO POR ITEM (mensal, na utilização esperada) → CUSTO/KM → PREÇO/KM", 5)
wc.cell(2, 1, "Custos fixos independem do km faturado; por isso o custo/km sobe quando a utilização cai (ver Cenários). Preço = custo ÷ (1 − lucro − tributos − custo financeiro).").font = f9
for col, w in zip("ABCDE", [58, 20, 20, 20, 60]): wc.column_dimensions[col].width = w
header(wc, 4, ["Componente", "Item 01 — Pacientes (R$/mês)", "Item 02 — Servidores (R$/mês)", "Lote (R$/mês)", "Memória de cálculo"], h=30)

RH = {"km": f"Rotas!C{rt1}", "vans": f"Rotas!G{rt1}", "mot": f"Rotas!H{rt1}", "ped": f"Rotas!K{rt1}", "trib": P['trib_hd']}
RS = {"km": f"Rotas!C{rt2}", "vans": f"Rotas!G{rt2}", "mot": f"Rotas!H{rt2}", "ped": f"Rotas!K{rt2}", "trib": P['trib_sv']}
rows = []  # (label, fB?, fH, fS, memo, fmt)
def add(label, fh, fs, memo, bold=False, fmt=BRL, key=None):
    rows.append((label, fh, fs, memo, bold, fmt, key))

add("A. KM", None, None, "", True)
add("Km útil faturável no mês (máx. edital × utilização)", f"={RH['km']}*{P['util']}", f"={RS['km']}*{P['util']}", "Rotas × Premissas.utilização", fmt=INT, key="kmfat")
add("Km rodado total (útil + km improdutivo)", "=B{kmfat}*(1+%s)" % P['km_morto'], "=C{kmfat}*(1+%s)" % P['km_morto'], "× (1 + km morto)", fmt=INT, key="kmrod")
add("Vans operacionais / com reserva", f"={RH['vans']}", f"={RS['vans']}", "Rotas (reserva rateada no custo do veículo)", fmt=NUM, key="vans")
add("Motoristas", f"={RH['mot']}", f"={RS['mot']}", "Rotas", fmt=NUM, key="mot")
add("B. MÃO DE OBRA (fixo)", None, None, "", True)
add("Salários motoristas c/ horas extras", "=B{mot}*%s*(1+%s)" % (P['sal_mot'], P['he']), "=C{mot}*%s*(1+%s)" % (P['sal_mot'], P['he']), "motoristas × salário × (1+HE)", key="sal")
add("Encargos e provisões", "=B{sal}*%s" % P['encargos'], "=C{sal}*%s" % P['encargos'], "× encargos", key="enc")
add("Benefícios + uniforme/EPI/cursos", "=B{mot}*(%s+%s)" % (P['benef'], P['epi']), "=C{mot}*(%s+%s)" % (P['benef'], P['epi']), "motoristas × (benefícios + EPI)", key="ben")
add("Preposto / supervisão local (rateio por km)", "=%s*B{kmfat}/(B{kmfat}+C{kmfat})" % P['supervisor'], "=%s*C{kmfat}/(B{kmfat}+C{kmfat})" % P['supervisor'], "rateado proporcional ao km", key="sup")
add("Subtotal mão de obra", "=SUM(B{sal}:B{sup})", "=SUM(C{sal}:C{sup})", "", True, key="mo")
add("C. VEÍCULOS (fixo, por van, com reserva técnica)", None, None, "", True)
add("Depreciação + custo de capital", "=B{vans}*(1+%s)*%s*(%s+%s)/12" % (P['reserva'], P['valor_van'], P['deprec'], P['capital']), "=C{vans}*(1+%s)*%s*(%s+%s)/12" % (P['reserva'], P['valor_van'], P['deprec'], P['capital']), "vans × (1+reserva) × valor × (deprec.+capital) ÷ 12", key="dep")
add("Seguro casco + RCF-V", "=B{vans}*(1+%s)*%s" % (P['reserva'], P['seguro']), "=C{vans}*(1+%s)*%s" % (P['reserva'], P['seguro']), "", key="seg")
add("IPVA / licenciamento + laudo anual", "=B{vans}*(1+%s)*(%s+%s)/12" % (P['reserva'], P['ipva'], P['laudo']), "=C{vans}*(1+%s)*(%s+%s)/12" % (P['reserva'], P['ipva'], P['laudo']), "", key="ipva")
add("Telemetria híbrida + sistema de embarque", "=B{vans}*(1+%s)*(%s+%s)" % (P['reserva'], P['telemetria'], P['embarque']), "=C{vans}*(1+%s)*(%s+%s)" % (P['reserva'], P['telemetria'], P['embarque']), "exigência TR 2.21–2.23 / 9.27", key="tel")
add("Higienização + acessibilidade/identificação", "=B{vans}*(%s+%s)" % (P['higien'], P['acess']), "=C{vans}*(%s+%s)" % (P['higien'], P['acess']), "", key="hig")
add("Garagem / base local", "=B{vans}*(1+%s)*%s" % (P['reserva'], P['garagem']), "=C{vans}*(1+%s)*%s" % (P['reserva'], P['garagem']), "", key="gar")
add("Subtotal veículos", "=SUM(B{dep}:B{gar})", "=SUM(C{dep}:C{gar})", "", True, key="veic")
add("D. INSUMOS VARIÁVEIS (por km rodado)", None, None, "", True)
add("Diesel", "=B{kmrod}/%s*%s" % (P['cons'], P['diesel']), "=C{kmrod}/%s*%s" % (P['cons'], P['diesel']), "km rodado ÷ km/l × R$/l", key="die")
add("ARLA 32", "=B{kmrod}*%s" % P['arla'], "=C{kmrod}*%s" % P['arla'], "", key="arla")
add("Pneus", "=B{kmrod}*%s" % P['pneus'], "=C{kmrod}*%s" % P['pneus'], "", key="pn")
add("Manutenção", "=B{kmrod}*%s" % P['manut'], "=C{kmrod}*%s" % P['manut'], "", key="man")
add("Lavagem / lubrificantes", "=B{kmrod}*%s" % P['lub'], "=C{kmrod}*%s" % P['lub'], "", key="lub")
add("Pedágio", f"={RH['ped']}", f"={RS['ped']}", "aba Rotas × tarifas", key="pedg")
add("Subtotal variáveis", "=SUM(B{die}:B{pedg})", "=SUM(C{die}:C{pedg})", "", True, key="var")
add("E. TOTAIS", None, None, "", True)
add("Custo direto", "=B{mo}+B{veic}+B{var}", "=C{mo}+C{veic}+C{var}", "B + C + D", key="dir")
add("Administração central + contingência", "=B{dir}*(%s+%s)" % (P['adm'], P['risco']), "=C{dir}*(%s+%s)" % (P['adm'], P['risco']), "× (adm + risco)", key="ind")
add("CUSTO TOTAL / MÊS", "=B{dir}+B{ind}", "=C{dir}+C{ind}", "", True, key="tot")
add("Custo por km útil (R$/km)", "=IF(B{kmfat}=0,0,B{tot}/B{kmfat})", "=IF(C{kmfat}=0,0,C{tot}/C{kmfat})", "custo ÷ km faturável", True, BRL4, key="ckm")
add("  do qual: custo fixo por km", "=IF(B{kmfat}=0,0,(B{mo}+B{veic})/B{kmfat})", "=IF(C{kmfat}=0,0,(C{mo}+C{veic})/C{kmfat})", "", fmt=BRL4, key="cfix")
add("  do qual: custo variável por km", "=IF(B{kmfat}=0,0,(B{var}+B{ind})/B{kmfat})", "=IF(C{kmfat}=0,0,(C{var}+C{ind})/C{kmfat})", "", fmt=BRL4, key="cvar")
add("F. PREÇO", None, None, "", True)
add("Tributos sobre faturamento (média do item)", f"={RH['trib']}", f"={RS['trib']}", "Premissas (ISS municipal / ICMS intermunicipal)", fmt=PCT2, key="trb")
add("Custo financeiro (prazo de pagamento)", f"={P['fin']}", f"={P['fin']}", "Premissas", fmt=PCT2, key="fin")
add("Lucro líquido alvo", f"={P['lucro']}", f"={P['lucro']}", "Premissas", fmt=PCT, key="luc")
add("PREÇO/KM CALCULADO (R$/km)", "=ROUNDUP(B{ckm}/(1-B{luc}-B{trb}-B{fin}),2)", "=ROUNDUP(C{ckm}/(1-C{luc}-C{trb}-C{fin}),2)", "custo/km ÷ (1 − lucro − tributos − financeiro), 2 casas", True, key="pkm")
add("Preço máximo do edital (R$/km)", 11.11, 11.11, "Anexo III", fmt=BRL, key="pmax")
add("Folga vs. preço máximo", "=IF(B{pmax}=0,0,B{pkm}/B{pmax}-1)", "=IF(C{pmax}=0,0,C{pkm}/C{pmax}-1)", "negativo = abaixo do teto", fmt=DPCT, key="folga")
add("Preço mínimo para lucro zero (R$/km)", "=B{ckm}/(1-B{trb}-B{fin})", "=C{ckm}/(1-C{trb}-C{fin})", "piso de exequibilidade", fmt=BRL4, key="pmin")
add("Faturamento mensal ao preço calculado", "=B{pkm}*B{kmfat}", "=C{pkm}*C{kmfat}", "", key="fat")
add("Lucro líquido mensal", "=B{fat}*(1-B{trb}-B{fin})-B{tot}", "=C{fat}*(1-C{trb}-C{fin})-C{tot}", "", True, key="lucm")
add("Faturamento anual (12 meses)", "=B{fat}*%s" % P['meses'], "=C{fat}*%s" % P['meses'], "", key="fata")
add("Lucro líquido anual", "=B{lucm}*%s" % P['meses'], "=C{lucm}*%s" % P['meses'], "", True, key="luca")

# resolve keys → rows
C0 = 5; keymap = {}
for i, rw in enumerate(rows):
    if rw[6]: keymap[rw[6]] = C0 + i
for i, (label, fh, fs, memo, bold, fmt, key) in enumerate(rows):
    rr = C0 + i
    if fh is None:
        c = wc.cell(rr, 1, label); c.font = fSec
        for col in range(1, 6): wc.cell(rr, col).fill = fillG
        continue
    wc.cell(rr, 1, label).font = fB if bold else fN
    for col, fx in ((2, fh), (3, fs)):
        v = fx.format(**keymap) if isinstance(fx, str) else fx
        c = wc.cell(rr, col, v); c.number_format = fmt; c.border = bd
        c.font = fB if bold else (fIn if not isinstance(fx, str) else fN)
    if fmt in (PCT, PCT2, DPCT):
        d = wc.cell(rr, 4, f"=IF((B{keymap['fat']}+C{keymap['fat']})=0,0,(B{rr}*B{keymap['fat']}+C{rr}*C{keymap['fat']})/(B{keymap['fat']}+C{keymap['fat']}))")
        d.number_format = fmt
    elif key in ("ckm", "cfix", "cvar", "pkm", "pmax", "pmin"):
        base = {"ckm": "tot", "cfix": None, "cvar": None, "pkm": "fat", "pmin": None, "pmax": None}
        if key == "ckm": d = wc.cell(rr, 4, f"=IF((B{keymap['kmfat']}+C{keymap['kmfat']})=0,0,D{keymap['tot']}/(B{keymap['kmfat']}+C{keymap['kmfat']}))")
        elif key == "pkm": d = wc.cell(rr, 4, f"=IF((B{keymap['kmfat']}+C{keymap['kmfat']})=0,0,D{keymap['fat']}/(B{keymap['kmfat']}+C{keymap['kmfat']}))")
        else: d = wc.cell(rr, 4, "")
        d.number_format = fmt
    else:
        d = wc.cell(rr, 4, f"=B{rr}+C{rr}"); d.number_format = fmt
    d.border = bd; d.font = fB if bold else fN
    m = wc.cell(rr, 5, memo); m.font = f9; m.alignment = WRAP; m.border = bd
    wc.cell(rr, 1).border = bd
    if key == "pkm":
        for col in (2, 3): wc.cell(rr, col).fill = fillY
wc.freeze_panes = "B5"
K = keymap

# =============================================================== CENÁRIOS
wz = wb.create_sheet("Cenários")
title(wz, 1, "CENÁRIOS — sensibilidade do preço/km à utilização do km registrado e lucro obtido em cada lance", 9)
wz.cell(2, 1, "Como o SRP só paga km útil e as rotas externas entram na Fase 2, o custo fixo pode ficar diluído em menos km. A tabela mostra o preço/km necessário (lucro alvo) e o lucro real ao preço escolhido, por utilização. Fórmulas usam os custos fixos e variáveis da aba Composição.").font = f9
wz.merge_cells("A2:I2"); wz["A2"].alignment = WRAP; wz.row_dimensions[2].height = 30
for col, w in zip("ABCDEFGHI", [26, 14, 14, 14, 14, 14, 14, 14, 14]): wz.column_dimensions[col].width = w
wz.cell(4, 1, "Preço/km a lançar (teste)").font = fB
wz.cell(4, 2, 9.90).font = fIn; wz.cell(4, 2).number_format = BRL; wz.cell(4, 2).fill = fillY
wz.cell(4, 3, "← edite para simular seu lance (lote único: mesmo preço nos 2 itens, teto R$ 11,11; lances de R$ 0,20)").font = f9
utils = [0.6, 0.7, 0.8, 0.85, 0.9, 1.0]
header(wz, 6, ["Utilização do km máximo"] + [f"{int(u*100)}%" for u in utils], h=20)
for j, u in enumerate(utils): wz.cell(6, 2 + j, u).number_format = '0%'
kmmax = f"(Rotas!C{rt3})"
fixo = f"(('Composição de Custo'!D{K['mo']}+'Composição de Custo'!D{K['veic']}))"
varkm = f"(('Composição de Custo'!D{K['var']}-'Composição de Custo'!D{K['pedg']})/'Composição de Custo'!D{K['kmrod']})"
pedm = f"('Composição de Custo'!D{K['pedg']})"
adm = f"({P['adm']}+{P['risco']})"
trib = f"('Composição de Custo'!D{K['trb']})"
fin = f"({P['fin']})"
lucro = f"({P['lucro']})"
lines = [
    ("Km útil faturável / mês", lambda c: f"={kmmax}*{c}6", INT),
    ("Custo total / mês (R$)", lambda c: f"=({fixo}+{varkm}*{c}7*(1+{P['km_morto']})+{pedm}*{c}6)*(1+{adm})", BRL),
    ("Custo por km útil (R$/km)", lambda c: f"=IF({c}7=0,0,{c}8/{c}7)", BRL4),
    ("Preço/km p/ lucro alvo (R$/km)", lambda c: f"=ROUNDUP({c}9/(1-{lucro}-{trib}-{fin}),2)", BRL),
    ("Preço/km lucro zero (R$/km)", lambda c: f"={c}9/(1-{trib}-{fin})", BRL4),
    ("— Ao preço de teste (B4) —", None, None),
    ("Faturamento / mês (R$)", lambda c: f"=$B$4*{c}7", BRL),
    ("Lucro líquido / mês (R$)", lambda c: f"={c}13*(1-{trib}-{fin})-{c}8", BRL),
    ("Margem líquida", lambda c: f"=IF({c}13=0,0,{c}14/{c}13)", DPCT),
    ("Lucro líquido / ano (R$)", lambda c: f"={c}14*{P['meses']}", BRL),
    ("Lucro / van / mês (R$)", lambda c: f"=IF(Rotas!G{rt3}=0,0,{c}14/Rotas!G{rt3})", BRL),
]
for i, (lab, fn, fmt) in enumerate(lines):
    rr = 7 + i
    wz.cell(rr, 1, lab).font = fB if fn is None or "Lucro" in lab or "Preço" in lab else fN
    wz.cell(rr, 1).border = bd
    if fn is None:
        for col in range(1, 8): wz.cell(rr, col).fill = fillG
        continue
    for j in range(len(utils)):
        col = get_column_letter(2 + j)
        c = wz.cell(rr, 2 + j, fn(col)); c.number_format = fmt; c.border = bd
        if lab.startswith("Lucro líquido / mês"): c.font = fB
wz.cell(19, 1, "Leitura: a coluna 100% é o cenário do edital; 60–70% representa a Fase 1 (só CDR local + UBS, sem rotas externas). Se o lucro/mês ficar negativo na coluna de 60–70%, o lance está exposto ao risco de ociosidade que o TR 10.3 aloca à contratada.").font = f9
wz.merge_cells("A19:I19"); wz["A19"].alignment = WRAP; wz.row_dimensions[19].height = 30
wz.freeze_panes = "B7"

# =============================================================== REGRAS DO EDITAL
we = wb.create_sheet("Regras do Edital")
title(we, 1, "REGRAS DO EDITAL / TR COM IMPACTO NO CUSTO E NA PARTICIPAÇÃO — PE 089/2026-SERMALI", 4)
header(we, 3, ["Tema", "Regra (fonte)", "Impacto no custo / risco", "Onde está na planilha"], [22, 70, 55, 26], h=20)
regras = [
    ("Sessão / plataforma", "28/09/2026 09h, Comprasgov (UASG 987885). Lote único com 2 itens; menor preço por lote; disputa ABERTA; lance mínimo R$ 0,20; lance por valor unitário com 2 casas.", "Mesmo preço/km nos dois itens é o mais simples; o julgamento é pelo valor do lote.", "Cenários!B4"),
    ("Preço máximo", "R$ 11,11/km em ambos os itens; valor total R$ 4.906.176 (374.400 + 67.200 km/ano). Cotações de referência: R$ 10,71 a R$ 11,44 (Chapecó, Rondonópolis, Alto Garças).", "Proposta acima do teto é desclassificada; abaixo do piso de custo pode sofrer diligência de exequibilidade (edital 70).", "Composição!B/C pmax"),
    ("Pagamento só por km útil", "SRP: paga-se exclusivamente km útil rodado e validado por telemetria + lista de presença eletrônica (TR 3.6, 8.22, 9.31, 10.2–10.7). Sem indenização por ociosidade (TR 3.9, 10.3).", "Custos fixos (folha, vans) não têm garantia de diluição. Fase 1 = só CDR local + UBS; rotas externas na Fase 2.", "Premissas.utilização; Cenários"),
    ("Ponto de partida do km útil", "Pacientes: Central de Veículos (R. Francisco Dal Negro, 2684). Servidores: Paço Municipal (TR 8.14). Garagem pública vedada (TR 8.27).", "Km garagem→ponto de partida e retorno vazio não são pagos → km morto + base própria em SJP.", "Premissas.km_morto / garagem"),
    ("Frota", "Vans ≥15 lugares, ≤5 anos E ≤150.000 km, mínimo 6 vans na frota inicial, ajuste dinâmico de frota (TR 8.8–8.10); substituição em 2 h (quebra) / 48 h (avaria menor).", "Item 01 roda ~300 km/van/dia → ~94 mil km/ano: van usada estoura 150 mil km em 1–2 anos. Reserva técnica obrigatória na prática.", "Premissas.valor_van, deprec, reserva"),
    ("Jornada", "Hemodiálise: 3 turnos 06h–19h, seg. a SÁBADO, inclusive feriados (TR 8.2, 8.16); coleta domiciliar antes e entrega depois. Servidores: 07h–17h seg. a sex. (TR 8.25).", "Item 01 exige ~2 motoristas por van ou banco de horas; sábados e feriados = HE/adicional.", "Premissas.mot_por_van_hd, he"),
    ("Motoristas", "CNH D + EAR + curso CONTRAN transporte coletivo + curso primeiros socorros (TR 2.26–2.27); declaração de vinculação futura assinada pelos motoristas (Anexo VI); uniforme e crachá (TR 9.19); substituição em 2 h.", "Recrutamento LOCAL (RMC) antes da sessão para assinar o Anexo VI; custos de cursos e toxicológico.", "Premissas.sal_mot, epi"),
    ("Telemetria", "Rastreamento GPRS em 100% da frota no dia 1 + sistema HÍBRIDO GPRS/satélite em 60 dias (TR 2.21–2.23, 9.24–9.26); acesso web/app para fiscalização; relatório mensal de telemetria.", "Rastreador híbrido custa 2–3× o convencional; Ituran atual da Azul pode precisar de upgrade satelital.", "Premissas.telemetria"),
    ("Controle de embarque", "Registro biométrico/QR Code/app por passageiro integrado ao rastreador; Relatório Consolidado de Frequência mensal; sem registro não há pagamento do km (TR 9.27–9.31).", "Custo de app/dispositivo por van + treinamento; risco de glosa se o motorista não registrar.", "Premissas.embarque"),
    ("Seguro", "RCF-V mínimo: R$ 40 mil DM, R$ 100 mil DC, R$ 5 mil DMo (TR 9.17). Laudo técnico de frota em 5 dias úteis (TR 5.7).", "Apólice específica por van vinculada ao contrato.", "Premissas.seguro, laudo"),
    ("Insumos por conta da contratada", "Combustível, ARLA (notas arquivadas), lubrificantes, pneus, manutenção, seguros, taxas, licenciamento, alimentação e fardamento (TR 5.2, 8.6).", "Todos os insumos estão na composição; ARLA é obrigatório e fiscalizado.", "Premissas seção 5"),
    ("Pedágio", "Edital NÃO prevê reembolso de pedágio. Rotas externas: Curitiba (sem pedágio), Campo Largo (BR-277 — praça da nova concessão), Campina Grande do Sul (BR-116, praça normalmente após a cidade). Rotas UBS: BR-376 km 615–621 (praça de SJP no km ~632).", "Pedágio entra no custo; confirmar na vistoria (facultativa — TR 5.4–5.6) quais trajetos cruzam praças.", "Premissas seção 6; Rotas col. J–K"),
    ("Reajuste", "Preços fixos por 12 meses contados de 22/06/2026 (data do orçamento); depois IPCA a pedido (cl. 7ª). Início da execução após 05/12/2026.", "Diesel e CCT 2027 sobem antes do 1º reajuste (só em 06/2027) → embutir na margem.", "Premissas.diesel, risco"),
    ("Pagamento", "Mensal, até 30 dias da fatura correta, com 6 certidões + folha de pagamento dos empregados do contrato (TR 10.8–10.16); atraso corrigido por IPCA.", "Capital de giro de ~2 meses de custo; certidão de tributos de SJP é exigida (empresa de fora precisa de inscrição/ certidão de não contribuinte).", "Premissas.prazo_pgto, juros_cg"),
    ("Tributos", "Serviço prestado em SJP: ISS devido ao município da prestação (transporte municipal). Viagens intermunicipais (Curitiba, Campo Largo, Campina G. do Sul) = ICMS (PR), não ISS.", "Definir com a contabilidade o enquadramento (ISS × ICMS, retenção na fonte, inscrição estadual PR). Diferença de até ~9 p.p. no preço.", "Premissas seção 7"),
    ("Habilitação", "Atestados somando ≥25% de 441.600 km/ano (=110.400 km/ano) em transporte coletivo de passageiros em vans/similares com rotas e monitoramento (TR 2.16–2.17); aceita escolar/funcionários. Certidões: federal, estadual, municipal da sede E de SJP, FGTS, CNDT, falência (≤90 dias), declaração TCE/PR.", "Azul atende com atestados de fretamento/escolar; providenciar certidão de SJP.", "—"),
    ("Sanções", "Multa de 0,5% a 30% sobre o valor do objeto; impedimento de licitar. Vedada subcontratação do objeto principal (TR 5.3).", "Contingência de 3% sobre custo direto.", "Premissas.risco"),
]
for i, (t, rg, imp, onde) in enumerate(regras):
    rr = 4 + i
    for j, v in enumerate((t, rg, imp, onde), 1):
        c = we.cell(rr, j, v); c.font = fB if j == 1 else f9; c.alignment = WRAP; c.border = bd
    we.row_dimensions[rr].height = 62
we.freeze_panes = "A4"

# =============================================================== PROPOSTA
wp = wb.create_sheet("Proposta")
for col, w in zip("ABCDEF", [8, 62, 14, 14, 16, 18]): wp.column_dimensions[col].width = w
title(wp, 1, "PROPOSTA DE PREÇOS — PREGÃO ELETRÔNICO Nº 089/2026-SERMALI — Prefeitura Municipal de São José dos Pinhais/PR — LOTE 01", 6)
wp.cell(3, 1, "Licitante:").font = fB; c = wp.cell(3, 2, f"={P['razao']}&\"  —  CNPJ \"&{P['cnpj']}"); c.font = fLink
wp.cell(4, 1, "Endereço:").font = fB; c = wp.cell(4, 2, f"={P['endereco']}"); c.font = fLink
wp.cell(5, 1, "Representante:").font = fB; c = wp.cell(5, 2, f"={P['resp']}"); c.font = fLink
header(wp, 7, ["Item", "Descrição do serviço", "Quant. km/ano", "Preço máx. (R$/km)", "Preço proposto (R$/km)", "Valor total (R$)"], h=30)
itens = [
    (1, "SERVIÇO DE TRANSPORTE DE PACIENTES – DIÁLISE (rotas Norte, Sul, Centro e Sudeste — 7.800 km/mês cada)", f"=Rotas!D{rt1}", f"=ROUNDUP('Composição de Custo'!D{K['pkm']},2)"),
    (2, "SERVIÇO DE TRANSPORTE C/ VAN – SERVIDORES (rotas 01, 02 e 03 — UBS rurais)", f"=Rotas!D{rt2}", f"=ROUNDUP('Composição de Custo'!D{K['pkm']},2)"),
]
for i, (n, d, q, pk) in enumerate(itens):
    rr = 8 + i
    vals = [n, d, q, 11.11, pk, f"=C{rr}*E{rr}"]
    for j, v in enumerate(vals, 1):
        c = wp.cell(rr, j, v); c.border = bd; c.alignment = WRAP
        c.font = fLink if j in (3, 5) else (fIn if j == 4 else fN)
    wp.cell(rr, 3).number_format = INT; wp.cell(rr, 4).number_format = BRL
    wp.cell(rr, 5).number_format = BRL; wp.cell(rr, 5).fill = fillY; wp.cell(rr, 6).number_format = BRL
    wp.row_dimensions[rr].height = 32
wp.cell(10, 2, "VALOR TOTAL DO LOTE 01 (12 meses)").font = fB; wp.cell(10, 2).alignment = Alignment(horizontal="right")
wp.cell(10, 6, "=F8+F9").number_format = BRL; wp.cell(10, 6).font = fB
wp.cell(11, 2, "Valor máximo do edital").font = fN; wp.cell(11, 2).alignment = Alignment(horizontal="right")
wp.cell(11, 6, "=C8*D8+C9*D9").number_format = BRL
wp.cell(12, 2, "Desconto sobre o valor máximo").font = fN; wp.cell(12, 2).alignment = Alignment(horizontal="right")
wp.cell(12, 6, "=IF(F11=0,0,1-F10/F11)").number_format = PCT
for rr in (10, 11, 12):
    for col in range(1, 7): wp.cell(rr, col).border = bd; wp.cell(rr, col).fill = fillGr
wp.cell(14, 1, "Nota: em lote único com disputa aberta, o lance é dado sobre o valor unitário; o preço proposto aqui é o preço médio ponderado do lote (mesmo valor nos dois itens), pois o Item 02 isolado custa mais que o teto de R$ 11,11 e só fecha subsidiado pelo Item 01 e confira o lucro na aba Cenários. Os preços incluem todos os custos diretos e indiretos, tributos, pedágios, telemetria, seguros e lucro. Validade: conforme edital. Pagamento: 30 dias. Reajuste: IPCA após 12 meses de 22/06/2026.").font = f9
wp.merge_cells("A14:F14"); wp["A14"].alignment = WRAP; wp.row_dimensions[14].height = 55

wb.move_sheet("Regras do Edital", offset=-4)
wb.save(OUT); print("saved")
