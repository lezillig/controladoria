import ExcelJS from "exceljs";
import { LINHAS_DRE } from "@/lib/controladoria/dre";
import type { BaseVigente } from "./baseDeCustos";
import { CATALOGO_PARAMETROS } from "./catalogo";
import type { DreDosMeses } from "./custosReais";
import { LINHAS_DOS_INDIRETOS, type FolhaDaOficina, type IndiretoDoDre, type PagamentosDoFornecedor } from "./indiretosDoDre";
import type { Premissas } from "./tipos";

// A COMPOSIÇÃO DA ADMINISTRAÇÃO CENTRAL, EM EXCEL — de onde sai o % que o
// estudo aplica sobre o custo direto.
//
// Aba "Resumo": cada custo de estrutura (R$/mês), o faturamento médio, o % da
// receita e a conversão para % do custo direto, em fórmulas — mudar o lucro
// alvo ou os tributos recalcula. Aba "Categorias por mês": cada categoria do
// Omie que forma cada custo, mês a mês, nos doze meses fechados, com o
// fornecedor da contabilidade e a folha da oficina à parte; a média usa só os
// meses com receita, como a conta do sistema (indiretosDoDre.ts).

export type DadosIndiretos = {
  dre: DreDosMeses;
  fornecedor: PagamentosDoFornecedor | null;
  oficina: FolhaDaOficina | null;
  doDre: Map<string, IndiretoDoDre>;
  base: BaseVigente | null;
  // Premissas de um estudo novo com esta base: lucro, tributos e giro da conversão.
  premissas: Premissas;
  empresa: string;
  geradoEm: Date;
};

export const INDIRETOS_DA_ADMINISTRACAO = ["folha_adm", "contabilidade", "sistemas", "sede_garagem_sp", "oficina", "gerais"] as const;

const BRL = '"R$" #,##0.00;[Red]-"R$" #,##0.00';
const PCT = "0.00%";
const AZUL = "FF1D4ED8";
const FUNDO_TITULO = "FFE2E8F0";
const FUNDO_ENTRADA = "FFFFF9C4";
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotuloMes = (chave: string) => {
  const [ano, mes] = chave.split("-");
  return `${MESES[Number(mes) - 1]}/${ano.slice(2)}`;
};
const letra = (n: number) => {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};
const rotuloDoIndireto = (chave: string) => CATALOGO_PARAMETROS.find((p) => p.chave === chave)?.rotulo ?? chave;
const rotuloDaLinha = (l: string) => LINHAS_DRE.find((x) => x.chave === l)?.rotulo.replace(/^\(-\) |^= /, "") ?? l;

// O valor que o estudo novo usa: o digitado na base vale acima do DRE.
function valorUsado(d: DadosIndiretos, chave: string): { valor: number; origem: string } {
  const digitado = d.base?.parametros.get(chave);
  if (digitado?.valor != null)
    return { valor: Number(digitado.valor), origem: `digitado na base (${digitado.fonte ?? "base"})` };
  const dre = d.doDre.get(chave);
  if (dre) return { valor: dre.valor, origem: dre.fonte };
  return { valor: 0, origem: "sem valor — não entra" };
}

export async function planilhaDosIndiretos(d: DadosIndiretos): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Controladoria Azul Mob";
  wb.created = d.geradoEm;
  const meses = d.dre.meses;
  const n = meses.length;
  const receita = d.dre.linhasDre.RECEITA_BRUTA ?? [];

  // O Resumo vem primeiro no arquivo, mas é preenchido depois: ele aponta
  // para os subtotais da outra aba.
  const ws = wb.addWorksheet("Resumo");

  // ------------------------------------------------ Categorias por mês
  const wc = wb.addWorksheet("Categorias por mês");
  const C0 = 4; // primeira coluna de mês (D)
  const colMedia = C0 + n;
  const L = (i: number) => letra(C0 + i);
  wc.columns = [{ width: 26 }, { width: 44 }, { width: 30 }, ...meses.map(() => ({ width: 13 })), { width: 15 }];
  wc.getCell("A1").value = `Composição da administração central — ${d.empresa}`;
  wc.getCell("A1").font = { bold: true, size: 13 };
  wc.getCell("A2").value =
    "Valores do DRE consolidado (Azul + MCZ, sem operações entre elas) por mês de competência, em R$. A média usa só os meses com receita (linha 5), como o sistema.";
  wc.getCell("A2").font = { italic: true, size: 9 };
  const cab = wc.getRow(4);
  ["Custo de estrutura", "Categoria do Omie", "Linha do DRE", ...meses.map(rotuloMes), "Média/mês"].forEach((t, i) => (cab.getCell(i + 1).value = t));
  cab.font = { bold: true };
  cab.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FUNDO_TITULO } }));

  // Linha 5: o mês entra na média? Linha 6: receita bruta.
  const flag = (i: number) => `${L(i)}$5`;
  const media = (row: number) => `SUMPRODUCT(${L(0)}${row}:${L(n - 1)}${row},${flag(0)}:${flag(n - 1)})/MAX(1,SUM(${flag(0)}:${flag(n - 1)}))`;
  const r5 = wc.getRow(5);
  r5.getCell(1).value = "Mês entra na média (1 = teve receita)";
  meses.forEach((_, i) => (r5.getCell(C0 + i).value = { formula: `IF(${L(i)}6>0,1,0)` }));
  const r6 = wc.getRow(6);
  r6.getCell(1).value = "Faturamento (receita bruta)";
  r6.getCell(3).value = rotuloDaLinha("RECEITA_BRUTA");
  meses.forEach((_, i) => (r6.getCell(C0 + i).value = (receita[i] ?? 0) / 100));
  r6.getCell(colMedia).value = { formula: media(6) };
  r6.font = { bold: true };

  let linha = 8;
  const subtotalDe = new Map<string, number>(); // indireto → linha do subtotal
  const escreverLinha = (indireto: string, categoria: string, linhaDre: string, valores: number[], negrito = false) => {
    const r = wc.getRow(linha);
    r.getCell(1).value = indireto;
    r.getCell(2).value = categoria;
    r.getCell(3).value = linhaDre;
    valores.forEach((v, i) => (r.getCell(C0 + i).value = Math.round(v) / 100));
    r.getCell(colMedia).value = { formula: media(linha) };
    if (negrito) r.font = { bold: true };
    return linha++;
  };
  const comFornecedor = d.doDre.get("contabilidade")?.linhas.some((l) => l.startsWith("Pagamentos a")) ?? false;
  const doFornecedor = d.fornecedor?.porCategoria ?? new Map<string, number[]>();
  const mapa: Record<string, string[]> = comFornecedor
    ? { ...LINHAS_DOS_INDIRETOS, contabilidade: [], gerais: ["DESPESA_ADMINISTRATIVA", "DESPESA_COMERCIAL", "DESPESA_GERAL"] }
    : LINHAS_DOS_INDIRETOS;

  for (const chave of INDIRETOS_DA_ADMINISTRACAO) {
    const nome = rotuloDoIndireto(chave);
    const primeira = linha;
    if (chave === "contabilidade" && comFornecedor) {
      for (const [fornecedor, porMes] of d.fornecedor?.porNome ?? []) escreverLinha(nome, `Pagamentos a ${fornecedor}`, "por fornecedor, onde estiver classificado", porMes.map(Math.abs));
    } else if (chave === "oficina") {
      if (d.oficina) escreverLinha(nome, `Folha no centro de custo ${d.oficina.centros.join(", ")}`, rotuloDaLinha("DESPESA_SALARIOS_CORPORATIVO"), d.oficina.porMes);
    } else {
      for (const l of mapa[chave] ?? []) {
        for (const c of d.dre.categorias.filter((x) => x.linha === l)) {
          const tirar = comFornecedor && !c.codigo.includes("@") ? (doFornecedor.get(c.codigo) ?? []) : [];
          const valores = c.porMesCents.map((v, i) => v - (tirar[i] ?? 0));
          if (valores.every((v) => Math.abs(v) < 1)) continue;
          escreverLinha(nome, `${c.descricao}${tirar.some((x) => x) ? " (sem a contabilidade/jurídico)" : ""}`, rotuloDaLinha(l), valores);
        }
      }
      if (chave === "folha_adm" && d.oficina) escreverLinha(nome, `(−) Oficina: centro de custo ${d.oficina.centros.join(", ")}`, "vai para a linha Oficina", d.oficina.porMes.map((v) => -v));
    }
    if (linha === primeira) {
      escreverLinha(nome, "(sem lançamentos na janela)", "", new Array(n).fill(0));
    }
    const ultima = linha - 1;
    const r = wc.getRow(linha);
    r.getCell(1).value = `Subtotal — ${nome}`;
    meses.forEach((_, i) => (r.getCell(C0 + i).value = { formula: `SUM(${L(i)}${primeira}:${L(i)}${ultima})` }));
    r.getCell(colMedia).value = { formula: media(linha) };
    r.font = { bold: true };
    r.eachCell((c) => (c.border = { top: { style: "thin" } }));
    subtotalDe.set(chave, linha);
    linha += 2;
  }
  const rTot = wc.getRow(linha);
  rTot.getCell(1).value = "TOTAL DA ESTRUTURA";
  meses.forEach((_, i) => (rTot.getCell(C0 + i).value = { formula: [...subtotalDe.values()].map((r) => `${L(i)}${r}`).join("+") }));
  rTot.getCell(colMedia).value = { formula: media(linha) };
  rTot.font = { bold: true };
  for (let r = 6; r <= linha; r++) for (let c = C0; c <= colMedia; c++) wc.getRow(r).getCell(c).numFmt = BRL;
  wc.views = [{ state: "frozen", xSplit: 3, ySplit: 4 }];

  // ------------------------------------------------ Resumo
  ws.columns = [{ width: 46 }, { width: 18 }, { width: 14 }, { width: 70 }];
  ws.getCell("A1").value = `Administração central — como se chega ao %`;
  ws.getCell("A1").font = { bold: true, size: 13 };
  ws.getCell("A2").value = `${d.empresa} · gerado em ${d.geradoEm.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })} · meses: ${meses.length ? `${rotuloMes(meses[0])} a ${rotuloMes(meses[n - 1])}` : "—"}`;
  ws.getCell("A2").font = { italic: true, size: 9 };
  const cabR = ws.getRow(4);
  ["Custo de estrutura (média por mês)", "R$/mês usado", "% da receita", "De onde vem"].forEach((t, i) => (cabR.getCell(i + 1).value = t));
  cabR.font = { bold: true };
  cabR.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FUNDO_TITULO } }));
  let lr = 5;
  const fat = valorUsado(d, "faturamento_medio");
  const linhaFat = 5 + INDIRETOS_DA_ADMINISTRACAO.length + 1;
  const primeiraR = lr;
  for (const chave of INDIRETOS_DA_ADMINISTRACAO) {
    const u = valorUsado(d, chave);
    const r = ws.getRow(lr);
    r.getCell(1).value = rotuloDoIndireto(chave);
    r.getCell(2).value = u.valor;
    r.getCell(3).value = { formula: `IF($B$${linhaFat}>0,B${lr}/$B$${linhaFat},0)` };
    r.getCell(4).value = `${u.origem}${subtotalDe.has(chave) ? ` — detalhe na aba Categorias por mês, linha ${subtotalDe.get(chave)}` : ""}`;
    lr++;
  }
  const rTotal = ws.getRow(lr);
  rTotal.getCell(1).value = "Total da estrutura por mês";
  rTotal.getCell(2).value = { formula: `SUM(B${primeiraR}:B${lr - 1})` };
  rTotal.getCell(3).value = { formula: `IF($B$${linhaFat}>0,B${lr}/$B$${linhaFat},0)` };
  rTotal.font = { bold: true };
  const linhaTotal = lr++;
  const rFat = ws.getRow(lr);
  rFat.getCell(1).value = "Faturamento médio por mês";
  rFat.getCell(2).value = fat.valor;
  rFat.getCell(4).value = fat.origem;
  rFat.font = { bold: true };
  lr += 2;

  const p = d.premissas.preco;
  const entrada = (rotulo: string, valor: number, obs: string) => {
    const r = ws.getRow(lr);
    r.getCell(1).value = rotulo;
    r.getCell(2).value = valor;
    r.getCell(2).numFmt = PCT;
    r.getCell(2).font = { color: { argb: AZUL } };
    r.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: FUNDO_ENTRADA } };
    r.getCell(4).value = obs;
    return lr++;
  };
  const derivada = (rotulo: string, formula: string, obs: string, negrito = false) => {
    const r = ws.getRow(lr);
    r.getCell(1).value = rotulo;
    r.getCell(2).value = { formula };
    r.getCell(2).numFmt = PCT;
    r.getCell(4).value = obs;
    if (negrito) r.font = { bold: true };
    return lr++;
  };
  ws.getRow(lr++).getCell(1).value = "CONVERSÃO PARA % DO CUSTO DIRETO (o que o estudo aplica)";
  ws.getRow(lr - 1).font = { bold: true };
  const a = derivada("a — estrutura em % da receita", `C${linhaTotal}`, "Total da estrutura ÷ faturamento médio.");
  const lucro = entrada("Lucro alvo", p.lucroAlvoPct, "Das Regras da Azul Mob. Mude aqui para ver o efeito (azul = editável).");
  const trib = entrada("Tributos sobre o faturamento", p.pis + p.cofins + p.irpj + p.csll + Math.max(p.iss, p.icms), "PIS + COFINS + IRPJ + CSLL + o maior entre ISS e ICMS.");
  const giro = entrada("Capital de giro", (p.custoCapitalGiroAm * p.prazoRecebimentoDias) / 30, "Custo do capital de giro × prazo de recebimento ÷ 30 (cliente privado).");
  const desp = entrada("Despesas sobre o preço", p.despesasSobrePrecoPct, "Seguro-garantia e afins.");
  const dv = derivada("d — o que sobra do preço para pagar o custo", `1-B${lucro}-B${trib}-B${giro}-B${desp}`, "1 − lucro − tributos − giro − despesas.");
  const x = derivada(
    "Administração central, % do custo direto",
    `IF(B${dv}>B${a},B${a}/(B${dv}-B${a}),B${a})`,
    "x = a ÷ (d − a): aplicado sobre o custo direto, dá a no preço final. É o valor do campo 'Administração central' do estudo.",
    true
  );
  const cont = entrada("Contingência / risco, % do custo direto", d.premissas.indiretos.contingenciaPct, "Regras da Azul Mob (ou padrão do simulador).");
  derivada("Administração + contingência, % do custo direto", `B${x}+B${cont}`, "O total que aparece nos custos do estudo.", true);
  lr++;
  ws.getRow(lr).getCell(1).value =
    "Observação: cada estudo tem o seu lucro alvo, tributos (ISS × ICMS) e prazo; com eles o % do estudo muda um pouco. Valores digitados na base de custos valem acima do DRE.";
  ws.getRow(lr).getCell(1).font = { italic: true, size: 9 };
  for (let r = 5; r <= linhaTotal + 1; r++) {
    ws.getRow(r).getCell(2).numFmt = BRL;
    ws.getRow(r).getCell(3).numFmt = PCT;
  }
  ws.getColumn(4).alignment = { wrapText: true, vertical: "top" };

  return Buffer.from(await wb.xlsx.writeBuffer());
}
