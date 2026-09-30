from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

OUT = "/mnt/user-data/outputs/Gabarito_Dados_Simulador_Custos_AzulMob.xlsx"
F = "Arial"
fN = Font(name=F, size=10); fB = Font(name=F, size=10, bold=True); f9 = Font(name=F, size=9)
fT = Font(name=F, size=13, bold=True, color="FFFFFF"); fH = Font(name=F, size=10, bold=True, color="FFFFFF")
fEx = Font(name=F, size=10, italic=True, color="7F7F7F"); fSec = Font(name=F, size=11, bold=True, color="1F3864")
fillT = PatternFill("solid", fgColor="1F3864"); fillH = PatternFill("solid", fgColor="2F5496")
fillY = PatternFill("solid", fgColor="FFF2CC"); fillG = PatternFill("solid", fgColor="E2EFDA"); fillGr = PatternFill("solid", fgColor="F2F2F2")
fillEss = PatternFill("solid", fgColor="F8CBAD")
thin = Side(style="thin", color="BFBFBF"); bd = Border(left=thin, right=thin, top=thin, bottom=thin)
WRAP = Alignment(wrap_text=True, vertical="top"); CEN = Alignment(wrap_text=True, horizontal="center", vertical="center")
BRL = 'R$ #,##0.00'; PCT = '0.0%'; NUM = '#,##0.00'; INT = '#,##0'

wb = Workbook()

def title(ws, r, txt, span):
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=span)
    c = ws.cell(r, 1, txt); c.font = fT; c.fill = fillT; ws.row_dimensions[r].height = 24

def intro(ws, r, txt, span, h=44):
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=span)
    c = ws.cell(r, 1, txt); c.font = f9; c.alignment = WRAP; ws.row_dimensions[r].height = h

def table_sheet(name, ttl, desc, cols, example, n_rows=25, widths=None):
    """cols: list of (header, explanation, essential(bool), fmt). Row 4 = header, row 5 = explanation, row 6 = example, rows 7.. = fill."""
    ws = wb.create_sheet(name)
    span = len(cols)
    title(ws, 1, ttl, span)
    intro(ws, 2, desc, span)
    for i, (h, expl, ess, fmt) in enumerate(cols, 1):
        c = ws.cell(4, i, h); c.font = fH; c.fill = fillH; c.border = bd; c.alignment = CEN
        e = ws.cell(5, i, ("★ " if ess else "") + expl); e.font = f9; e.alignment = WRAP; e.border = bd
        e.fill = fillEss if ess else fillGr
        x = ws.cell(6, i, example[i - 1]); x.font = fEx; x.border = bd; x.alignment = WRAP
        if fmt and isinstance(example[i - 1], (int, float)): x.number_format = fmt
        ws.column_dimensions[get_column_letter(i)].width = (widths[i - 1] if widths else 20)
        for rr in range(7, 7 + n_rows):
            cc = ws.cell(rr, i); cc.border = bd; cc.fill = fillY; cc.font = fN
            if fmt: cc.number_format = fmt
    ws.row_dimensions[4].height = 34; ws.row_dimensions[5].height = 120; ws.row_dimensions[6].height = 30
    ws.cell(3, 1, "Linha 5 = explicação de cada coluna (★ = essencial; cinza = pode vir depois). Linha 6 = EXEMPLO ilustrativo (apague/sobrescreva). Preencha a partir da linha 7 (células amarelas).").font = f9
    ws.freeze_panes = "B7"
    return ws

def param_sheet(name, ttl, desc, sections):
    """sections: list of (section_title, [(item, unit, explanation, essential, fmt, example)])"""
    ws = wb.create_sheet(name)
    for col, w in zip("ABCDE", [50, 14, 20, 70, 26]): ws.column_dimensions[col].width = w
    title(ws, 1, ttl, 5); intro(ws, 2, desc, 5)
    hdr = ["Item", "Unidade", "SEU VALOR (preencher)", "O que é / como obter", "Exemplo"]
    for i, h in enumerate(hdr, 1):
        c = ws.cell(4, i, h); c.font = fH; c.fill = fillH; c.border = bd; c.alignment = CEN
    r = 5
    for st, items in sections:
        c = ws.cell(r, 1, st); c.font = fSec
        for col in range(1, 6): ws.cell(r, col).fill = fillG
        r += 1
        for item, unit, expl, ess, fmt, ex in items:
            ws.cell(r, 1, ("★ " if ess else "") + item).font = fB if ess else fN
            ws.cell(r, 2, unit).font = fN
            v = ws.cell(r, 3); v.fill = fillY; v.font = fN
            if fmt: v.number_format = fmt
            e = ws.cell(r, 4, expl); e.font = f9; e.alignment = WRAP
            x = ws.cell(r, 5, ex); x.font = fEx; x.alignment = WRAP
            if fmt and isinstance(ex, (int, float)): x.number_format = fmt
            for col in range(1, 6): ws.cell(r, col).border = bd
            ws.cell(r, 1).alignment = WRAP
            ws.row_dimensions[r].height = max(30, 15 * (len(expl) // 75 + 1))
            r += 1
        r += 1
    ws.freeze_panes = "A5"
    return ws

# ================================================================ LEIA-ME
ws = wb.active; ws.title = "Leia-me"
ws.column_dimensions["A"].width = 30; ws.column_dimensions["B"].width = 100
title(ws, 1, "GABARITO DE DADOS — SIMULADOR DE CUSTOS AZUL MOB (fretamento contínuo e transporte escolar: van, micro-ônibus e ônibus)", 2)
texto = [
    ("Para que serve", "Este arquivo reúne os dados REAIS da Azul que alimentam o simulador de custos. Preenchido uma vez e atualizado periodicamente, ele substitui as premissas de mercado usadas nas planilhas de Holambra e São José dos Pinhais: cada novo edital passa a entrar só com suas variáveis (rotas, km, jornada, exigências) e o simulador calcula custo/km, custo por veículo-mês, preço e margem com os números da empresa."),
    ("Como preencher", "Células AMARELAS são para preencher. Em cada aba, a linha 5 explica cada coluna e a linha 6 traz um exemplo ilustrativo (não é dado real — sobrescreva). Itens marcados com ★ são essenciais para a primeira versão funcionar; os demais melhoram a precisão e podem vir depois. Se não souber um número, deixe em branco e anote na coluna 'Observações' de onde ele pode ser obtido (contabilidade, Ituran, oficina, RH)."),
    ("Ordem sugerida", "1) Frota  2) Mão de obra + Jornada  3) Tributos e financeiro  4) Insumos  5) Indiretos  6) Regras da Azul  7) Histórico de contratos  8) Mercado. As abas 1 a 6 bastam para simular; 7 e 8 calibram e afinam o lance."),
    ("Fontes internas prováveis", "Frota: Planilha Operacional (FROTA ATIVA), planilha Consórcios e Financiamentos, apólices Sombrero/ESSOR, base Ituran, tabela FIPE. Mão de obra: folha/DP, CCT do sindicato, planilha de VT. Tributos: contabilidade. Insumos: cartão-frota/abastecimento, pedidos de compra da oficina (Paraoficina), FOB pneus. Histórico: faturamento por contrato (Omie) × custo alocado."),
    ("Unidades", "Valores em R$ sem centavos arredondados; percentuais como número (ex.: 70 para 70%, ou 0,70 — a célula formata); consumo em km/litro; km em km/mês; prazos em dias."),
    ("Sigilo", "O arquivo contém dados sensíveis da empresa (salários, margens, taxas). Não anexe salários nominais de funcionários — só valores por função."),
    ("Abas", "1_Frota · 2_MaoDeObra · 3_Jornada · 4_Indiretos · 5_Tributos_Financeiro · 6_Insumos · 7_Pedagios_Rotas · 8_Regras_Azul · 9_Historico_Contratos · 10_Mercado · Checklist"),
]
for i, (a, b) in enumerate(texto):
    r = 3 + i
    ws.cell(r, 1, a).font = fB; ws.cell(r, 1).alignment = WRAP
    c = ws.cell(r, 2, b); c.font = fN; c.alignment = WRAP
    ws.row_dimensions[r].height = max(30, 16 * (len(b) // 110 + 1))
    for col in (1, 2): ws.cell(r, col).border = bd

# ================================================================ 1 FROTA
table_sheet("1_Frota",
    "1. FROTA — uma linha por MODELO/CONFIGURAÇÃO que a Azul opera ou pode alocar (não por placa)",
    "Agrupe placas iguais (mesmo modelo, ano aproximado, configuração) numa linha e informe a quantidade. O simulador usa estes dados para calcular o custo fixo mensal do veículo (depreciação, capital, seguro, IPVA, licenças, rastreador) e o custo variável por km (combustível, manutenção, pneus). Fonte: Planilha Operacional (FROTA ATIVA), Consórcios e Financiamentos, apólices, Ituran, FIPE.",
    [
        ("Tipo", "Van / Micro-ônibus / Ônibus urbano / Ônibus rodoviário / Ônibus escolar / Carro-executivo. O simulador filtra por tipo conforme o edital.", True, None),
        ("Modelo / marca", "Ex.: Sprinter 517, Master L3H2, Volare W9, Marcopolo Torino, Mascarello Gran Micro.", True, None),
        ("Ano fab./modelo", "Ano médio do grupo. Define elegibilidade (editais limitam idade: 5, 8, 10, 15 anos).", True, None),
        ("Qtde na frota", "Quantas unidades deste grupo existem hoje (base Ituran ~197 placas).", True, INT),
        ("Lotação (lugares)", "Passageiros sentados, sem motorista.", True, INT),
        ("Acessível (PCD)?", "Sim/Não. Elevador/plataforma para cadeirante. Editais escolares e de saúde costumam exigir % da frota acessível.", False, None),
        ("Km atual médio", "Odômetro médio do grupo (Ituran). Define elegibilidade por km máximo (ex.: 150 mil km).", True, INT),
        ("Valor de compra (R$)", "Preço pago por unidade (média do grupo).", True, BRL),
        ("Valor FIPE atual (R$)", "Valor de mercado hoje. Base da depreciação e do custo de capital.", True, BRL),
        ("Forma de aquisição", "À vista / CDC / Consórcio / Leasing. Nome do banco ajuda (Moneo, Santander, Itaú, Stellantis, Bradesco, RCI, CNP, BB, Mercabenco).", True, None),
        ("Parcela mensal (R$)", "Prestação do financiamento/consórcio por unidade. Se quitado, 0.", True, BRL),
        ("Taxa efetiva (% a.a.)", "Juros do contrato de financiamento. Para consórcio: taxa de administração anualizada.", True, PCT),
        ("Parcelas restantes", "Meses até quitar.", False, INT),
        ("Consumo real (km/l)", "Média real do grupo: km Ituran ÷ litros abastecidos (últimos 6–12 meses). É o dado mais importante do custo variável.", True, NUM),
        ("Combustível", "Diesel S10 / Gasolina / Etanol / GNV / Elétrico.", True, None),
        ("Manutenção (R$/km)", "Peças + mão de obra de oficina ÷ km rodado no período (12 meses). Fonte: pedidos de compra da oficina / Paraoficina + folha da oficina rateada.", True, NUM),
        ("Pneus: qtde × preço (R$)", "Número de pneus e preço unitário do modelo usado (FOB XBRI/Linglong).", True, None),
        ("Vida útil pneu (km)", "Km até troca, considerando recapagens (informe quantas recapagens faz).", True, INT),
        ("Seguro anual (R$)", "Prêmio anual por unidade: casco + RC (Sombrero fretamento 1002806001249 / escolar 1002806001248, ESSOR ANTT). Informe também a franquia.", True, BRL),
        ("IPVA + licenciamento (R$/ano)", "Total anual por unidade (IPVA, DPVAT/taxas, licenciamento).", True, BRL),
        ("Licenças/registros (R$/ano)", "ARTESP, EMTU, ANTT (fretamento), registro escolar CVS/CET/Detran, inspeção semestral escolar, tacógrafo, vistoria. Some tudo por ano e liste na coluna Observações.", True, BRL),
        ("Rastreador (R$/mês)", "Mensalidade Ituran por veículo (LORA/SMART). Informe se tem telemetria/satélite disponível.", True, BRL),
        ("Idade de venda (anos)", "Com quantos anos a Azul costuma vender esse tipo de veículo.", False, INT),
        ("Valor de revenda típico (% FIPE)", "Percentual da FIPE que consegue na venda (ex.: 90%).", False, PCT),
        ("Reserva técnica usual (%)", "Quantos veículos reserva por 10 operacionais neste tipo.", False, PCT),
        ("Observações", "Configuração especial (ar, poltrona, cinto 3 pontos, câmera, monitoramento), restrições, etc.", False, None),
    ],
    ["Van", "Sprinter 517 CDI 19+1", 2023, 12, 19, "Não", 95000, 320000, 285000, "CDC Santander", 6800, 0.18, 22, 8.7, "Diesel S10", 0.42, "6 × R$ 1.150", 60000, 7800, 3900, 1800, 95, 6, 0.9, 0.1, "Ar-condicionado, cinto 3 pontos"],
    widths=[12, 22, 10, 9, 9, 10, 11, 14, 14, 16, 12, 10, 10, 10, 11, 11, 16, 11, 12, 13, 14, 11, 10, 12, 11, 30])

# ================================================================ 2 MÃO DE OBRA
table_sheet("2_MaoDeObra",
    "2. MÃO DE OBRA — uma linha por FUNÇÃO × CONVENÇÃO/REGIÃO",
    "Valores por função, nunca por pessoa. Repita a função se o piso muda por região (capital, interior, outro estado) ou por sindicato (fretamento × escolar × urbano). O simulador calcula custo mensal do posto = salário × (1 + encargos) + benefícios + EPI, ajustado pela jornada da aba 3. Fonte: DP/folha, CCT vigente, planilha de VT.",
    [
        ("Função", "Motorista van / Motorista micro / Motorista ônibus / Monitora escolar / Cobrador / Auxiliar / Supervisor / Preposto / Mecânico.", True, None),
        ("CCT / sindicato", "Convenção que rege (ex.: SETPESP × Sindicato dos Condutores; escolar SP; SETRANSP-PR). Informe vigência (mês-base).", True, None),
        ("Região", "SP capital / Grande SP / interior SP / outro estado (qual).", True, None),
        ("Salário base (R$/mês)", "Piso praticado pela Azul (não o mínimo da CCT, se paga acima).", True, BRL),
        ("Adicionais fixos (R$/mês)", "Gratificações, quebra de caixa, adicional de função, periculosidade quando houver.", False, BRL),
        ("Horas extras médias (%)", "% médio do salário pago em HE nos últimos 12 meses para essa função.", True, PCT),
        ("Adicional noturno médio (%)", "% médio do salário quando há operação noturna (22h–5h).", False, PCT),
        ("Encargos sociais (%)", "Percentual que a contabilidade aplica sobre o salário: INSS patronal + RAT/FAP + terceiros + FGTS + provisões (férias, 1/3, 13º, rescisão, aviso). Informe o número real (ex.: 68%).", True, PCT),
        ("VR/VA (R$/mês)", "Vale-refeição/alimentação por pessoa (valor/dia × dias).", True, BRL),
        ("Cesta básica (R$/mês)", "", False, BRL),
        ("Vale-transporte líquido (R$/mês)", "Custo médio da empresa por pessoa já descontados os 6% (planilha de VT).", True, BRL),
        ("Plano de saúde/odonto (R$/mês)", "Custo empresa por pessoa, se houver.", False, BRL),
        ("Seguro de vida (R$/mês)", "", False, BRL),
        ("Uniforme + EPI (R$/mês)", "Custo anual ÷ 12.", True, BRL),
        ("Exames e cursos (R$/mês)", "ASO, toxicológico (CNH C/D/E), curso transporte coletivo/escolar (CONTRAN), primeiros socorros, reciclagens — anualizado ÷ 12.", True, BRL),
        ("Absenteísmo/folguista (%)", "Percentual extra de pessoal para cobrir faltas, férias e folgas (ex.: 1 folguista para 5 motoristas = 20%).", True, PCT),
        ("Rotatividade anual (%)", "Desligamentos ÷ quadro. Alimenta a provisão de rescisão.", False, PCT),
        ("Custo total do posto (R$/mês)", "Se o DP já tem esse número consolidado, informe — serve para conferir a fórmula.", False, BRL),
        ("Observações", "", False, None),
    ],
    ["Motorista ônibus", "SETPESP/Sind. Condutores SP — 2026", "SP capital", 3450, 0, 0.14, 0.03, 0.68, 660, 210, 190, 0, 12, 55, 45, 0.18, 0.25, 8900, "Escala 5x2"],
    widths=[18, 26, 14, 13, 13, 11, 12, 12, 11, 11, 13, 13, 11, 11, 12, 12, 12, 14, 24])

# ================================================================ 3 JORNADA
param_sheet("3_Jornada",
    "3. JORNADA E DIMENSIONAMENTO DE PESSOAL — regras que a Azul pratica",
    "Transforma os horários do edital em número de motoristas por veículo. Preencha como a empresa realmente opera hoje; o simulador aplica estas regras a cada rota (início/fim, turnos, dias da semana).",
    [("Regras gerais", [
        ("Jornada semanal contratual", "horas", "44 h é o padrão CLT; algumas CCTs praticam 40/42 h.", True, INT, 44),
        ("Escalas praticadas", "texto", "Ex.: 5x2, 6x1, 12x36; seg–sex, seg–sáb, ter–sáb, dom–sex (conforme RH).", True, None, "5x2 e 6x1"),
        ("Horas/dia a partir das quais paga HE (ou usa banco)", "horas", "Normalmente 8 h (com intrajornada 1 h). Informe se usa banco de horas e como compensa.", True, NUM, 8),
        ("Percentual de HE praticado", "%", "50% dias úteis; 100% domingos/feriados — confirme a CCT.", True, PCT, 0.5),
        ("Adicional noturno", "%", "20% sobre a hora entre 22h e 5h (hora reduzida 52m30s).", True, PCT, 0.2),
        ("Intervalo intrajornada considerado", "horas", "1 h padrão; algumas CCTs permitem fracionar (Lei 13.103).", False, NUM, 1),
        ("Tempo de espera remunerado?", "Sim/Não", "Lei 13.103: tempo de espera pode ser pago a 30% — informe a prática da Azul.", False, None, "Não"),
    ]),
    ("Motoristas por veículo (padrão da Azul)", [
        ("Escolar 2 períodos (manhã + tarde, ~5h às 18h)", "motoristas/veículo", "Quantos motoristas você aloca por veículo nessa jornada (1 com HE, 1,2 com folguista, 2 turnos…).", True, NUM, 1.2),
        ("Escolar 3 períodos (manhã, tarde, noite até 23h)", "motoristas/veículo", "", True, NUM, 1.8),
        ("Fretamento contínuo 2 picos (entrada/saída de turno)", "motoristas/veículo", "Ex.: 05h–09h e 16h–20h.", True, NUM, 1.2),
        ("Fretamento 3 turnos / 24h", "motoristas/veículo", "", True, NUM, 2.6),
        ("Van saúde/regulação (06h–19h, seg–sáb)", "motoristas/veículo", "", False, NUM, 1.8),
        ("Monitora por veículo escolar", "monitoras/veículo", "1 por período ou 1 por veículo?", True, NUM, 1),
    ]),
    ("Deslocamentos", [
        ("Km morto padrão (garagem ↔ ponto inicial)", "% do km pago", "Percentual que você considera quando o contrato paga por km (ex.: 10–15%).", True, PCT, 0.12),
        ("Tempo de deslocamento pago ao motorista", "min/dia", "Minutos diários de garagem até o início da rota que entram na jornada.", False, INT, 40),
    ]),
])

# ================================================================ 4 INDIRETOS
param_sheet("4_Indiretos",
    "4. CUSTOS INDIRETOS E ESTRUTURA — administração central, garagem, supervisão",
    "Custos que não são de um veículo nem de um motorista específico, mas que precisam entrar no preço. Informe o valor mensal total e a base de rateio que a Azul usa (por veículo, por faturamento ou por km).",
    [("Administração central (mensal)", [
        ("Folha administrativa + encargos", "R$/mês", "Diretoria, RH/DP, financeiro, comercial/licitações, TI, compras. Sem oficina e sem operação.", True, BRL, 95000),
        ("Contabilidade, jurídico, certificados digitais, certidões", "R$/mês", "", True, BRL, 9000),
        ("Sistemas (gestão de motoristas, ERP Omie, Ituran plataforma, telefonia, internet)", "R$/mês", "Só a parte de plataforma/licença; o rastreador por veículo está na aba 1.", True, BRL, 7500),
        ("Aluguel/IPTU/energia/água da sede e garagem SP", "R$/mês", "", True, BRL, 32000),
        ("Oficina própria: folha + estrutura (se não já rateada em R$/km na aba 1)", "R$/mês", "Evite contar duas vezes: se a manutenção R$/km da aba 1 já inclui a folha da oficina, coloque 0 aqui.", True, BRL, 0),
        ("Marketing, viagens, despesas gerais", "R$/mês", "", False, BRL, 6000),
        ("Total de veículos ativos (base de rateio)", "veículos", "Frota operacional média.", True, INT, 190),
        ("Faturamento mensal médio (base de rateio)", "R$/mês", "Últimos 12 meses ÷ 12.", True, BRL, 3200000),
        ("Base de rateio preferida", "texto", "Por veículo / por faturamento (%) / por km. O simulador calcula das três formas e você escolhe.", True, None, "por veículo"),
    ]),
    ("Estrutura por contrato (fora da sede)", [
        ("Garagem/pátio em outra cidade — custo típico", "R$/mês", "Aluguel de pátio + vigilância + energia para 8–10 veículos (média do que já pagou em contratos fora de SP).", True, BRL, 6000),
        ("Supervisor/preposto local — custo do posto", "R$/mês", "Salário + encargos + benefícios + veículo de apoio.", True, BRL, 9500),
        ("Veículo de apoio (R$/mês)", "R$/mês", "Carro do supervisor/socorro, combustível incluso.", False, BRL, 3500),
        ("Implantação de contrato (uma vez)", "R$", "Adesivagem, treinamento, mudança de veículos, documentação — média por contrato.", False, BRL, 25000),
    ]),
])

# ================================================================ 5 TRIBUTOS
param_sheet("5_Tributos_Financeiro",
    "5. TRIBUTOS E FINANCEIRO — pedir à contabilidade",
    "Alíquotas EFETIVAS que a contabilidade aplica ao faturamento e às condições de recebimento. O simulador precisa distinguir transporte municipal (ISS) de intermunicipal/interestadual (ICMS) e conhecer o custo do dinheiro entre prestar o serviço e receber.",
    [("Regime e alíquotas sobre faturamento", [
        ("Regime tributário", "texto", "Lucro Presumido / Lucro Real / Simples Nacional (anexo).", True, None, "Lucro Presumido"),
        ("PIS", "%", "0,65% presumido / 1,65% real (com créditos — informe efetivo).", True, '0.00%', 0.0065),
        ("COFINS", "%", "3% presumido / 7,6% real (efetivo após créditos).", True, '0.00%', 0.03),
        ("IRPJ efetivo sobre faturamento", "%", "Presumido: 8% base × 15% (+10% adicional). Informe o efetivo dos últimos 12 meses.", True, '0.00%', 0.012),
        ("CSLL efetivo sobre faturamento", "%", "Presumido: 12% base × 9%.", True, '0.00%', 0.0108),
        ("ISS — São Paulo capital (transporte municipal)", "%", "Alíquota do código de serviço usado (16.01/16.02).", True, '0.00%', 0.05),
        ("ISS — outros municípios onde atua (listar)", "texto", "Cidade: alíquota. Ex.: Marília 3%, Holambra 3%, SJ dos Pinhais ?%. ISS é devido onde o serviço é prestado.", True, None, "Marília 3%; Holambra 3%"),
        ("ICMS transporte intermunicipal — SP", "%", "12% em SP; informe se usa crédito outorgado/regime especial (ex.: crédito de 20%).", True, '0.00%', 0.12),
        ("ICMS interestadual / outros estados", "%", "Ex.: PR 12%; informar regimes especiais.", False, '0.00%', 0.12),
        ("Retenções na fonte típicas de órgãos públicos", "%", "IRRF 1,5%–4,8%, CSRF 4,65%, ISS retido, INSS 11% quando há cessão de mão de obra. Retenção não é custo, mas afeta caixa.", False, None, "IRRF 1,5% + CSRF 4,65%"),
        ("Desoneração da folha / CPRB", "Sim/Não e %", "Se a empresa está na CPRB (transporte de passageiros), informe alíquota sobre receita e o INSS patronal que deixa de pagar.", False, None, "Não"),
    ]),
    ("Prazo e custo financeiro", [
        ("Prazo médio real de recebimento — prefeituras", "dias", "Da prestação do serviço ao crédito em conta (medição + NF + 30 dias contratuais + atrasos). Média real.", True, INT, 55),
        ("Prazo médio real de recebimento — empresas (fretamento)", "dias", "", True, INT, 35),
        ("Custo do capital de giro", "% a.m.", "Taxa de antecipação de recebíveis / conta garantida / capital próprio (custo de oportunidade).", True, '0.00%', 0.018),
        ("Inadimplência/glosas médias em contratos públicos", "%", "Percentual do faturamento glosado ou não pago (últimos 2 anos).", False, PCT, 0.01),
        ("Garantia contratual — custo do seguro-garantia", "% a.a. sobre valor garantido", "Quando o edital exige 5% de garantia, quanto custa a apólice.", False, PCT, 0.01),
    ]),
])

# ================================================================ 6 INSUMOS
param_sheet("6_Insumos",
    "6. INSUMOS VARIÁVEIS — combustível e consumíveis por km",
    "Preços que a Azul efetivamente paga. O consumo (km/l) e a manutenção (R$/km) por modelo estão na aba 1; aqui ficam os preços dos insumos e os itens por km que não dependem do modelo.",
    [("Combustível", [
        ("Diesel S10 — preço pago", "R$/litro", "Preço médio dos últimos 3 meses (cartão-frota/nota do posto/tanque próprio). Informe a fonte.", True, BRL, 6.15),
        ("Gasolina / etanol (se opera veículos leves)", "R$/litro", "", False, BRL, 6.3),
        ("Forma de abastecimento", "texto", "Tanque próprio / cartão-frota (qual) / posto conveniado. Desconto médio obtido.", True, None, "Cartão-frota, 3% desc."),
        ("Reajuste médio anual do diesel considerado", "%", "Para contratos com reajuste só após 12 meses.", False, PCT, 0.06),
        ("ARLA 32", "R$/litro e % do diesel", "Preço e proporção de consumo (≈4–5% do diesel em Euro 5/6).", True, None, "R$ 4,20; 4,5%"),
    ]),
    ("Consumíveis por km (média da frota)", [
        ("Óleo lubrificante + filtros", "R$/km", "Custo anual ÷ km, se NÃO estiver dentro da manutenção da aba 1.", True, NUM, 0.06),
        ("Lavagem e higienização", "R$/km ou R$/veículo-mês", "Interna/terceirizada.", True, None, "R$ 320/veículo-mês"),
        ("Pneus — recapagem (preço e quantas vezes)", "R$ por recapagem", "", True, None, "R$ 480, 2 recapagens"),
        ("Alinhamento/balanceamento/rodízio", "R$/km", "", False, NUM, 0.01),
        ("Multas de trânsito (média)", "R$/veículo-mês", "Fonte: CONTROLE MULTAS 2026. Parte não repassada ao motorista.", False, BRL, 45),
        ("Sinistros/franquias (média)", "R$/veículo-mês", "Franquias pagas ÷ frota ÷ 12.", False, BRL, 120),
    ]),
])

# ================================================================ 7 PEDÁGIOS E ROTAS
table_sheet("7_Pedagios_Rotas",
    "7. PEDÁGIOS E ROTAS TÍPICAS — uma linha por praça/trecho que a operação cruza",
    "Nos editais o pedágio raramente é reembolsado. Cadastre as praças das rodovias onde a Azul opera ou pretende operar, com tarifa por categoria de veículo. O simulador multiplica passagens/dia × tarifa. Fonte: extrato da tag (Sem Parar/ConectCar) e sites das concessionárias.",
    [
        ("Rodovia / praça", "Ex.: SP-330 Anhanguera km 46 (CCR AutoBAn); BR-277 Campo Largo.", True, None),
        ("Concessionária", "", False, None),
        ("Tarifa carro / van 2 eixos (R$)", "", True, BRL),
        ("Tarifa micro-ônibus (R$)", "Normalmente = 2 eixos rodagem dupla.", True, BRL),
        ("Tarifa ônibus 2 eixos (R$)", "", True, BRL),
        ("Tarifa ônibus 3 eixos (R$)", "", False, BRL),
        ("Desconto tag / DUF (%)", "Desconto de usuário frequente ou de tag, se houver.", False, PCT),
        ("Usado em quais operações", "Contratos/cidades que cruzam essa praça.", False, None),
        ("Data da tarifa", "", True, None),
        ("Observações", "", False, None),
    ],
    ["SP-330 Anhanguera km 46 (Perus)", "CCR AutoBAn", 13.9, 27.8, 27.8, 41.7, 0.05, "Fretamento Jundiaí", "set/2026", ""],
    n_rows=25, widths=[34, 18, 14, 14, 14, 14, 12, 26, 12, 24])

# ================================================================ 8 REGRAS AZUL
param_sheet("8_Regras_Azul",
    "8. REGRAS E PADRÕES DA AZUL — decisões de gestão que o simulador deve respeitar",
    "Parâmetros de política comercial. Definem margem mínima, reservas, limites de frota e como você quer ver o resultado.",
    [("Margem e preço", [
        ("Margem líquida mínima aceitável (após tributos)", "%", "Abaixo disso o simulador sinaliza 'não lançar'.", True, PCT, 0.07),
        ("Margem líquida alvo", "%", "Usada para calcular o preço de abertura.", True, PCT, 0.12),
        ("Contingência/risco padrão sobre custo direto", "%", "Cobre multas, glosas, sinistros, imprevistos.", True, PCT, 0.03),
        ("Administração central padrão (se não usar rateio real)", "%", "", False, PCT, 0.07),
        ("Passo mínimo de lance que você usa", "R$ ou %", "", False, None, "R$ 0,10/km"),
    ]),
    ("Frota e operação", [
        ("Reserva técnica — van / micro / ônibus", "%", "Ex.: 10% / 10% / 15%.", True, None, "10% / 10% / 15%"),
        ("Idade máxima de veículo que aloca em contrato novo", "anos", "Mesmo quando o edital permite mais.", True, INT, 10),
        ("Km máximo por veículo/ano que considera saudável", "km/ano", "Para decidir entre 1 ou 2 veículos por rota.", False, INT, 90000),
        ("Distância máxima da sede para operar sem base local", "km", "Acima disso exige garagem e supervisor locais (aba 4).", True, INT, 100),
        ("Utilização esperada em SRP / contratos por demanda", "%", "% do km máximo do edital que você assume como faturável.", True, PCT, 0.85),
        ("Meses de custo fixo em contrato escolar (200 dias letivos)", "meses", "Se mantém equipe e veículo nas férias.", True, INT, 12),
    ]),
    ("Saída desejada", [
        ("Como quer ver o resultado", "texto", "Por km / por veículo-mês / por posto (motorista) / por aluno — pode marcar todos.", True, None, "km e veículo-mês"),
        ("Moeda e arredondamento", "texto", "2 casas no preço unitário (regra comum de edital).", False, None, "2 casas"),
        ("Quem aprova o preço final", "texto", "Nome/cargo — para o fluxo de aprovação do simulador.", False, None, ""),
    ]),
])

# ================================================================ 9 HISTÓRICO
table_sheet("9_Historico_Contratos",
    "9. HISTÓRICO DE CONTRATOS — previsto × realizado (5 a 10 contratos recentes, escolar e fretamento)",
    "É o que CALIBRA o simulador: comparando o que você orçou com o que gastou, descobrimos onde as premissas erram (km morto, HE, manutenção, ociosidade). Fonte: Omie (faturamento), folha alocada, abastecimento por placa, oficina por placa.",
    [
        ("Contrato / cliente", "Órgão ou empresa + número do contrato/pregão.", True, None),
        ("Tipo", "Escolar / Fretamento contínuo / Saúde / Locação c/ motorista / Locação s/ motorista / Eventual.", True, None),
        ("Cidade/UF", "", True, None),
        ("Vigência (início–fim)", "", True, None),
        ("Veículos alocados (tipo × qtde)", "Ex.: 3 ônibus 44 lug + 1 micro.", True, None),
        ("Motoristas / monitores alocados", "Cabeças, incluindo folguistas.", True, None),
        ("Km/mês previsto na proposta", "", True, INT),
        ("Km/mês realizado (média)", "Ituran.", True, INT),
        ("Faturamento mensal médio (R$)", "", True, BRL),
        ("Preço unitário contratado", "R$/km, R$/veículo-mês ou R$/dia — informe a unidade.", True, None),
        ("Custo mensal previsto na proposta (R$)", "Se tiver a planilha original.", False, BRL),
        ("Custo mensal realizado (R$)", "Folha alocada + combustível + manutenção + veículo + rateios.", True, BRL),
        ("Resultado mensal (R$)", "Faturamento − custo − tributos.", True, BRL),
        ("Margem líquida realizada (%)", "", True, PCT),
        ("Pedágio mensal (R$)", "", False, BRL),
        ("HE mensal (R$)", "Horas extras pagas na operação.", False, BRL),
        ("Principais desvios", "O que saiu diferente do orçado (km morto, atrasos de pagamento, glosas, quebra, demanda menor).", True, None),
        ("Concorrentes que disputaram / vencedor e preço", "Se souber.", False, None),
    ],
    ["PE 086/2026 Marília (não vencido)", "Escolar", "Marília/SP", "—", "6 ônibus 46 lug", "7 mot + 6 mon", 42000, "", "", "R$ 5.100.000/ano", "", "", "", "", "", "", "Ficou 2º; Futura 0,5% abaixo", "Futura Transportes R$ 5.074.500"],
    n_rows=20, widths=[26, 14, 14, 16, 22, 16, 12, 12, 14, 18, 14, 14, 13, 11, 11, 11, 32, 30])

# ================================================================ 10 MERCADO
table_sheet("10_Mercado",
    "10. MERCADO — preços de referência e concorrentes (o que você já sabe; eu complemento pelo PNCP)",
    "Preços vencedores recentes em objetos parecidos e concorrentes recorrentes. Alimenta a 'inteligência de lance': desconto médio sobre o teto e piso praticado por região/objeto.",
    [
        ("Edital / órgão", "", True, None),
        ("Objeto", "Escolar ônibus / escolar van / fretamento / saúde / locação.", True, None),
        ("UF / cidade", "", True, None),
        ("Data", "", True, None),
        ("Unidade de preço", "R$/km, R$/veículo-mês, R$/dia, R$/aluno.", True, None),
        ("Preço máximo do edital", "", True, NUM),
        ("Preço vencedor", "", True, NUM),
        ("Desconto sobre o teto (%)", "1 − vencedor ÷ teto.", False, PCT),
        ("Vencedor", "", True, None),
        ("2º colocado e preço", "", False, None),
        ("Azul participou? posição e preço", "", True, None),
        ("Observações", "Exigências que pesaram (idade de frota, acessibilidade, garantia…).", False, None),
    ],
    ["PE 036/2026 Holambra", "Escolar ônibus 59 lug", "SP / Holambra", "28/09/2026", "R$/km", 25.5, "", "", "", "", "Sim", "9 linhas, 200 dias letivos"],
    n_rows=30, widths=[26, 22, 16, 12, 14, 14, 14, 12, 22, 22, 22, 30])

# ================================================================ CHECKLIST
wk = wb.create_sheet("Checklist")
wk.column_dimensions["A"].width = 6; wk.column_dimensions["B"].width = 60; wk.column_dimensions["C"].width = 14; wk.column_dimensions["D"].width = 40
title(wk, 1, "CHECKLIST DE PREENCHIMENTO", 4)
for i, h in enumerate(["#", "Bloco", "Status", "Responsável / onde buscar"], 1):
    c = wk.cell(3, i, h); c.font = fH; c.fill = fillH; c.border = bd; c.alignment = CEN
itens = [
    ("1_Frota — modelos, valores, consumo, manutenção, seguro, licenças", "Frota / financeiro / oficina / Ituran"),
    ("2_MaoDeObra — funções, pisos, encargos, benefícios", "DP / contabilidade / CCT"),
    ("3_Jornada — regras e motoristas por veículo", "Operação / RH"),
    ("4_Indiretos — administração, garagem, supervisão", "Financeiro"),
    ("5_Tributos_Financeiro — alíquotas efetivas, prazos, capital de giro", "Contabilidade / financeiro"),
    ("6_Insumos — diesel, ARLA, consumíveis", "Compras / frota"),
    ("7_Pedagios_Rotas — praças e tarifas", "Operação / extrato da tag"),
    ("8_Regras_Azul — margens, reservas, limites", "Diretoria"),
    ("9_Historico_Contratos — previsto × realizado", "Financeiro / licitações"),
    ("10_Mercado — preços vencedores e concorrentes", "Licitações (+ levantamento PNCP pelo Claude)"),
]
dv = DataValidation(type="list", formula1='"Não iniciado,Parcial,Completo"', allow_blank=True)
wk.add_data_validation(dv)
for i, (b, resp) in enumerate(itens):
    r = 4 + i
    wk.cell(r, 1, i + 1).font = fN; wk.cell(r, 2, b).font = fN
    s = wk.cell(r, 3, "Não iniciado"); s.fill = fillY; dv.add(s)
    wk.cell(r, 4, resp).font = f9
    for col in range(1, 5): wk.cell(r, col).border = bd
wk.cell(15, 2, "Quando as abas 1–6 e 8 estiverem pelo menos 'Parcial', já dá para montar a versão 1 do simulador; 9 e 10 entram na calibração.").font = f9

wb.save(OUT); print("ok")
