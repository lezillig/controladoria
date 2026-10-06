// A PLANILHA DA ADMINISTRAÇÃO CENTRAL — recalculada no LibreOffice, ela tem de
// dar os mesmos números que o sistema usa (indiretosDoDre): cada custo de
// estrutura pela média dos meses com receita, o fornecedor da contabilidade e
// a oficina à parte, e o % do custo direto pela mesma conversão.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CategoriaReal, DreDosMeses } from "../src/lib/simulador/custosReais";
import { planilhaDosIndiretos } from "../src/lib/simulador/exportarIndiretos";
import { CHAVE_PRO_LABORE, PRO_LABORE_PADRAO, casaComPadrao, comFornecedoresSempreFora, comSempreFora, classificarTitulos, indiretosDoDre, padraoDoNome, type FolhaDaOficina, type PagamentosDoFornecedor, type TituloDoIndireto } from "../src/lib/simulador/indiretosDoDre";
import { PREMISSAS_PADRAO } from "../src/lib/simulador/premissas";

let falhas = 0;
function ok(nome: string, passou: boolean, detalhe = "") {
  if (!passou) falhas++;
  console.log(`  ${passou ? "ok  " : "FALHA"} ${nome}${passou || !detalhe ? "" : `\n         ${detalhe}`}`);
}
const perto = (nome: string, real: unknown, esperado: number, tol = 0.01) =>
  ok(nome, typeof real === "number" && Math.abs(real - esperado) <= tol, `esperado ${esperado}, planilha ${JSON.stringify(real)}`);

// Doze meses; os dois primeiros sem receita (não entram na média).
const meses = Array.from({ length: 12 }, (_, i) => `2025-${String(i + 10 > 12 ? i - 2 : i + 10).padStart(2, "0")}`).map((m, i) => (i < 3 ? m : m.replace("2025", "2026")));
const mes = (v: number, semReceita = false) => meses.map((_, i) => (semReceita && i < 2 ? 0 : v));
const cat = (codigo: string, descricao: string, linha: string, porMesCents: number[]): CategoriaReal => ({ codigo, descricao, linha, confirmada: true, porMesCents });
const categorias = [
  cat("3.01", "Salários (MCZ)", "DESPESA_SALARIOS_CORPORATIVO", mes(8_000_000)),
  cat("3.02", "Encargos (MCZ)", "DESPESA_SALARIOS_CORPORATIVO", mes(3_000_000)),
  // Apoio Administrativo, classificado INTEIRO no corporativo e pago pela Azul:
  // R$ 18 mil de repasse à MCZ (fora: a folha da MCZ já está acima) e R$ 7
  // mil de um PJ (entra).
  cat("2.08.98", "Apoio Administrativo", "DESPESA_SALARIOS_CORPORATIVO", mes(2_500_000)),
  cat("4.01", "Serviços contábeis e jurídicos", "DESPESA_ADMINISTRATIVA", mes(1_500_000)),
  cat("4.02", "Material de escritório", "DESPESA_ADMINISTRATIVA", mes(200_000)),
  cat("5.01", "Sistemas", "DESPESA_INFORMATICA", mes(900_000)),
  cat("6.01", "Aluguel da sede", "DESPESA_ESTRUTURA", mes(1_200_000)),
  cat("7.01", "Marketing", "DESPESA_COMERCIAL", mes(300_000)),
  cat("8.01", "Despesas gerais", "DESPESA_GERAL", mes(500_000)),
  // Fora da administração: a terceirização (categoria inteira) e o advogado
  // Manoel (R$ 1 mil por mês dentro de "Despesas gerais").
  cat("8.02", "Compra de Serviços", "DESPESA_GERAL", mes(5_000_000)),
];
const linhasDre: Record<string, number[]> = { RECEITA_BRUTA: mes(50_000_000, true) };
for (const c of categorias) linhasDre[c.linha] = (linhasDre[c.linha] ?? new Array(12).fill(0)).map((v, i) => v + c.porMesCents[i]);
const dre: DreDosMeses = { meses, linhasDre, categorias, naoConfirmadoCents: 0, semCategoriaCents: 0 };
// JL e Joel: R$ 12.000 por mês, na categoria 4.01; oficina: R$ 25.000 da folha MCZ.
const fornecedor: PagamentosDoFornecedor = {
  nome: "JL Business e Joel",
  porCategoria: new Map([["4.01", mes(1_200_000)]]),
  porNome: new Map([["JL Business", mes(900_000)], ["Joel", mes(300_000)]]),
};
const oficina: FolhaDaOficina = { centros: ["Oficina"], porMes: mes(2_500_000) };
const fora = {
  fornecedores: { nome: "Manoel e MCZ Transporte", porCategoria: new Map([["8.01", mes(100_000)], ["2.08.98", mes(1_800_000)]]) },
  categorias: ["Compra de Serviços"],
};
const doDre = indiretosDoDre(dre, fornecedor, oficina, fora);
const semExclusao = indiretosDoDre(dre, fornecedor, oficina);

// Os títulos que formam o mesmo DRE: um por categoria e mês; a 4.01 dividida
// entre JL (R$ 9 mil), Joel (R$ 3 mil) e outro escritório (R$ 3 mil); a folha
// da MCZ com R$ 25 mil no centro de custo Oficina.
const titulo = (categoria: string, mesChave: string, cents: number, fornecedor: string, extra: Partial<TituloDoIndireto> = {}): TituloDoIndireto => ({
  empresa: "AZUL", categoria, categoriaDescricao: null, mes: mesChave, fornecedor, documento: "NF 1", parcela: null, centroDeCusto: null,
  emissao: null, vencimento: new Date(2026, 0, 10), natureza: "PAGAR", cents, corporativo: false, ...extra,
});
const titulos: TituloDoIndireto[] = [];
meses.forEach((m, i) => {
  titulos.push(titulo("3.01", m, 5_500_000, "Folha MCZ", { empresa: "MCZ", corporativo: true }));
  titulos.push(titulo("3.01", m, 2_500_000, "Folha MCZ", { empresa: "MCZ", corporativo: true, centroDeCusto: "Oficina" }));
  titulos.push(titulo("3.02", m, 3_000_000, "INSS", { empresa: "MCZ", corporativo: true }));
  titulos.push(titulo("2.08.98", m, 1_800_000, "MCZ TRANSPORTE E TURISMO EIRELI"));
  titulos.push(titulo("2.08.98", m, 700_000, "C CARDOSO PRESTADORA DE SERVICOS LTDA"));
  titulos.push(titulo("4.01", m, 900_000, "JL BUSSINESS LTDA"));
  titulos.push(titulo("4.01", m, 300_000, "Joel Advogados"));
  titulos.push(titulo("4.01", m, 300_000, "Outro Escritório"));
  titulos.push(titulo("4.02", m, 200_000, "Kalunga"));
  titulos.push(titulo("5.01", m, 900_000, "Sistema X"));
  titulos.push(titulo("6.01", m, 1_200_000, "Imobiliária"));
  titulos.push(titulo("7.01", m, 300_000, "Agência"));
  titulos.push(titulo("8.01", m, 400_000, "Diversos"));
  titulos.push(titulo("8.01", m, 100_000, "MANOEL SOCIEDADE DE ADVOGADOS"));
  titulos.push(titulo("8.02", m, 5_000_000, "Transportadora Parceira"));
  if (i === 0) titulos.push(titulo("8.01", "2024-01", 999_999, "Fora da janela"));
});
const lancamentos = classificarTitulos(titulos, dre, ["JL Business", "Joel"], { fornecedores: ["Manoel", "MCZ Transporte"], categorias: ["Compra de Serviços"] });

async function principal() {
  console.log("PRÓ-LABORE FIXO NA ADMINISTRAÇÃO; DESPESAS COM SÓCIOS FORA");
  {
    const { premissasDaBase } = await import("../src/lib/simulador/premissas");
    const base = (parametros: [string, number][]) => ({
      em: new Date(2026, 9, 1),
      parametros: new Map(parametros.map(([k, v]) => [k, { valor: v, texto: null, fonte: "teste", vigenciaInicio: new Date(2026, 0, 1) }])),
      veiculos: [], funcoes: [], pedagios: [],
    });
    const escolhas = { clientePublico: false, escolar: false, baseLocal: false };
    const adm = (parametros: [string, number][]) => premissasDaBase(base(parametros) as never, escolhas).premissas.indiretos.administracaoPct;
    const p = premissasDaBase(base([["faturamento_medio", 100_000]]) as never, escolhas).premissas.preco;
    const dv = 1 - p.lucroAlvoPct - p.pis - p.cofins - p.irpj - p.csll - Math.max(p.iss, p.icms) - (p.custoCapitalGiroAm * p.prazoRecebimentoDias) / 30 - p.despesasSobrePrecoPct;
    const x = (a: number) => a / (dv - a);
    perto("pró-labore padrão de R$ 180 mil (10 mil gerais + 180 mil, sobre 2 milhões)", adm([["faturamento_medio", 2_000_000], ["gerais", 10_000]]), x(190_000 / 2_000_000), 1e-9);
    perto("pró-labore digitado na base: 50 mil", adm([["faturamento_medio", 2_000_000], ["gerais", 10_000], [CHAVE_PRO_LABORE, 50_000]]), x(60_000 / 2_000_000), 1e-9);
    perto("pró-labore zero (digitado como 0)", adm([["faturamento_medio", 2_000_000], ["gerais", 10_000], [CHAVE_PRO_LABORE, 0]]), x(10_000 / 2_000_000), 1e-9);
    perto("despesas com sócios do DRE não entram", adm([["faturamento_medio", 2_000_000], ["gerais", 10_000], [CHAVE_PRO_LABORE, 0], ["socios", 700_000]]), x(10_000 / 2_000_000), 1e-9);
    ok("padrão de R$ 180 mil", PRO_LABORE_PADRAO === 180_000);
    const fora = comSempreFora(["Compra de Serviços"]);
    ok("os sempre fora vêm junto do que a base diz", fora[0] === "Compra de Serviços" && ["Parcelamento", "Empréstimo", "Uber", "PLR", "Seguro Garantia", "PCC - 5952"].every((x) => fora.includes(x)), fora.join("|"));
    const sempre = comSempreFora([]).length;
    ok("campo da base em branco: continuam fora", sempre === 17, String(sempre));
    ok("sem repetir o que a base já tem", comSempreFora(["parcelamento"]).length === sempre);
  }

  const soffice = ["soffice", "libreoffice"].find((c) => {
    const r = spawnSync(c, ["--version"], { stdio: "ignore" });
    return !r.error && r.status === 0;
  });
  console.log("LANÇAMENTOS — cada título no seu custo, somando o mesmo que o DRE");
  ok("padrão do nome: JL Business acha JL BUSSINESS LTDA", casaComPadrao("JL BUSSINESS LTDA", padraoDoNome("JL Business")!));
  ok("Joel acha Joel Advogados", casaComPadrao("Joel Advogados", padraoDoNome("Joel")!));
  ok("título fora da janela não entra", !lancamentos.some((x) => x.fornecedor === "Fora da janela"));
  const mesesComReceita = new Set(meses.filter((_, i) => i >= 2));
  for (const chave of ["folha_adm", "contabilidade", "sistemas", "sede_garagem_sp", "oficina", "gerais"]) {
    const media = lancamentos.filter((x) => x.indireto === chave && mesesComReceita.has(x.mes)).reduce((a, x) => a + x.valor, 0) / mesesComReceita.size;
    perto(`${chave}: média dos lançamentos = valor do sistema`, media, doDre.get(chave)?.valor ?? NaN);
  }
  ok("JL e Joel na contabilidade; o outro escritório em gerais", lancamentos.filter((x) => x.indireto === "contabilidade").every((x) => /JL|Joel/.test(x.fornecedor)) && lancamentos.some((x) => x.indireto === "gerais" && x.fornecedor === "Outro Escritório"));
  ok("oficina pelo centro de custo", lancamentos.filter((x) => x.indireto === "oficina").every((x) => x.centroDeCusto === "Oficina"));

  console.log("\nFORA DA ADMINISTRAÇÃO — Compra de Serviços e o advogado Manoel");
  perto("sem exclusão, gerais teria R$ 51 mil a mais", (semExclusao.get("gerais")?.valor ?? 0) - (doDre.get("gerais")?.valor ?? 0), 51_000);
  perto("com exclusão, gerais fica nos R$ 12 mil", doDre.get("gerais")?.valor ?? NaN, 12_000);
  ok("a fonte diz o que saiu", /sem Compra de Serviços e Manoel/.test(doDre.get("gerais")?.fonte ?? ""), doDre.get("gerais")?.fonte);
  ok("composição sem a Compra de Serviços", !doDre.get("gerais")?.composicao.some((c) => c.descricao === "Compra de Serviços"));
  ok(
    "lançamentos excluídos marcados, fora das somas",
    lancamentos.filter((x) => x.indireto === "fora_da_administracao").map((x) => x.fornecedor).every((f) => /MANOEL|Transportadora|MCZ TRANSPORTE/.test(f)) &&
      lancamentos.some((x) => x.fornecedor === "Transportadora Parceira" && x.indireto === "fora_da_administracao")
  );

  const conteudo = await planilhaDosIndiretos({ dre, fornecedor, oficina, fora, doDre, base: { em: new Date(2026, 9, 1), parametros: new Map([[CHAVE_PRO_LABORE, { valor: 20_000, texto: null, fonte: "teste", vigenciaInicio: new Date(2026, 0, 1) }]]), veiculos: [], funcoes: [], pedagios: [] } as never, premissas: PREMISSAS_PADRAO, empresa: "Grupo teste", geradoEm: new Date(2026, 9, 4), lancamentos });
  ok("gera um .xlsx", conteudo.subarray(0, 2).toString() === "PK");
  if (!soffice) {
    ok("LibreOffice para recalcular", false, "instale o LibreOffice (soffice): sem recálculo o teste não prova nada");
    return;
  }
  const dir = mkdtempSync(path.join(tmpdir(), "indiretos-"));
  try {
    const arquivo = path.join(dir, "indiretos.xlsx");
    writeFileSync(arquivo, conteudo);
    const saida = path.join(dir, "lo");
    const r = spawnSync(soffice, [`-env:UserInstallation=file://${path.join(dir, "perfil")}`, "--headless", "--calc", "--convert-to", "xlsx", "--outdir", saida, arquivo], { encoding: "utf8", timeout: 300_000 });
    if (r.status !== 0) throw new Error(`LibreOffice falhou: ${r.stderr}`);
    const json = path.join(dir, "valores.json");
    const py = spawnSync("python3", [path.join(__dirname, "recalcular-xlsx.py"), "--ler", path.join(saida, "indiretos.xlsx"), json], { encoding: "utf8" });
    if (py.status !== 0) throw new Error(py.stderr);
    const valores = JSON.parse(readFileSync(json, "utf8")) as Record<string, Record<string, unknown>>;
    const aba = (nome: string) => valores[nome.toUpperCase()] ?? valores[nome] ?? {};
    // A linha cujo rótulo (coluna A) começa com o texto, e a célula da coluna pedida.
    const celula = (nomeAba: string, rotulo: string, coluna: string) => {
      const a = aba(nomeAba);
      const endereco = Object.keys(a).find((k) => /^A\d+$/.test(k) && String(a[k] ?? "").startsWith(rotulo));
      return endereco ? a[`${coluna}${endereco.slice(1)}`] : undefined;
    };
    const colunaMedia = "P"; // D..O são os 12 meses; P é a média

    console.log("\nCATEGORIAS POR MÊS — a média de cada custo é a do sistema");
    for (const [chave, rotulo] of [
      ["folha_adm", "Subtotal — Folha administrativa"],
      ["contabilidade", "Subtotal — Contabilidade"],
      ["sistemas", "Subtotal — Sistemas"],
      ["sede_garagem_sp", "Subtotal — Aluguel"],
      ["oficina", "Subtotal — Oficina"],
      ["gerais", "Subtotal — Marketing"],
    ] as const) {
      perto(`${rotulo.replace("Subtotal — ", "")}: média = ${doDre.get(chave)?.valor}`, celula("Categorias por mês", rotulo, colunaMedia), doDre.get(chave)?.valor ?? NaN);
    }
    perto("faturamento médio só dos meses com receita", celula("Categorias por mês", "Faturamento", colunaMedia), 500_000);
    // Folha: 110 mil − 25 mil de oficina; contabilidade: 12 mil dos pagamentos;
    // gerais: 3 mil de escritório + 3 mil de marketing + 4 mil + 3 mil que sobram da 4.01.
    // 80 mil de salários + 30 mil de encargos − 25 mil da oficina + 7 mil do
    // PJ do apoio (os 18 mil do repasse à MCZ saem).
    perto("folha sem a oficina e sem o repasse à MCZ", doDre.get("folha_adm")?.valor ?? NaN, 92_000);
    ok("o repasse à MCZ fica fora nos lançamentos", lancamentos.filter((x) => /MCZ TRANSPORTE/.test(x.fornecedor)).every((x) => x.indireto !== "folha_adm") && lancamentos.some((x) => /C CARDOSO/.test(x.fornecedor) && x.indireto === "folha_adm"));
    ok("MCZ Transporte, Tributtax, Valestra e Freitas Junior sempre fora, junto do que a base diz", comFornecedoresSempreFora(["Manoel"]).join("|") === "Manoel|MCZ Transporte|Tributtax|Valestra|Freitas Junior");
    ok("Freitas Junior casa com o nome no Omie", casaComPadrao("FREITAS JUNIOR SOCIEDADE INDIVIDUAL DE ADVOCACIA", padraoDoNome("Freitas Junior")!));
    perto("contabilidade pelos pagamentos", doDre.get("contabilidade")?.valor ?? NaN, 12_000);
    perto("gerais com o resto das administrativas", doDre.get("gerais")?.valor ?? NaN, 12_000);

    console.log("\nRESUMO — total, % da receita e conversão");
    // Os seis custos do DRE + o pró-labore fixo digitado na base (20 mil).
    const total = [...["folha_adm", "contabilidade", "sistemas", "sede_garagem_sp", "oficina", "gerais"]].reduce((a, k) => a + (doDre.get(k)?.valor ?? 0), 0) + 20_000;
    perto("total da estrutura", celula("Resumo", "Total da estrutura", "B"), total);
    const a = total / 500_000;
    perto("a = total ÷ faturamento", celula("Resumo", "a —", "B"), a, 1e-9);
    const p = PREMISSAS_PADRAO.preco;
    const d = 1 - p.lucroAlvoPct - (p.pis + p.cofins + p.irpj + p.csll + Math.max(p.iss, p.icms)) - (p.custoCapitalGiroAm * p.prazoRecebimentoDias) / 30 - p.despesasSobrePrecoPct;
    perto("d = o que sobra do preço", celula("Resumo", "d —", "B"), d, 1e-9);
    perto("administração = a ÷ (d − a)", celula("Resumo", "Administração central, %", "B"), a / (d - a), 1e-9);
    perto("administração + contingência", celula("Resumo", "Administração + contingência", "B"), a / (d - a) + PREMISSAS_PADRAO.indiretos.contingenciaPct, 1e-9);

    console.log("\nPOR FORNECEDOR — a diferença para o DRE é zero quando tudo é título");
    const pf = aba("Por fornecedor");
    const difs = Object.keys(pf).filter((k) => /^B\d+$/.test(k) && String(pf[k]).startsWith("Diferença")).map((k) => pf[`D${k.slice(1)}`]);
    ok("seis custos, diferença zero em todos", difs.length === 6 && difs.every((v) => typeof v === "number" && Math.abs(v) < 0.01), JSON.stringify(difs));
    const lancs = aba("Lançamentos");
    ok("aba Lançamentos com um título por linha", Object.keys(lancs).filter((k) => /^J\d+$/.test(k)).length === lancamentos.length + 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

principal()
  .catch((e) => {
    falhas++;
    console.error("O teste não completou:", e);
  })
  .finally(() => {
    console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
    process.exit(falhas === 0 ? 0 : 1);
  });
