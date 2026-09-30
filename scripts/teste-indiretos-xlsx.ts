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
import { indiretosDoDre, type FolhaDaOficina, type PagamentosDoFornecedor } from "../src/lib/simulador/indiretosDoDre";
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
  cat("3.01@corporativo", "Salários (MCZ)", "DESPESA_SALARIOS_CORPORATIVO", mes(8_000_000)),
  cat("3.02@corporativo", "Encargos (MCZ)", "DESPESA_SALARIOS_CORPORATIVO", mes(3_000_000)),
  cat("4.01", "Serviços contábeis e jurídicos", "DESPESA_ADMINISTRATIVA", mes(1_500_000)),
  cat("4.02", "Material de escritório", "DESPESA_ADMINISTRATIVA", mes(200_000)),
  cat("5.01", "Sistemas", "DESPESA_INFORMATICA", mes(900_000)),
  cat("6.01", "Aluguel da sede", "DESPESA_ESTRUTURA", mes(1_200_000)),
  cat("7.01", "Marketing", "DESPESA_COMERCIAL", mes(300_000)),
  cat("8.01", "Despesas gerais", "DESPESA_GERAL", mes(400_000)),
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
const doDre = indiretosDoDre(dre, fornecedor, oficina);

async function principal() {
  const soffice = ["soffice", "libreoffice"].find((c) => {
    const r = spawnSync(c, ["--version"], { stdio: "ignore" });
    return !r.error && r.status === 0;
  });
  const conteudo = await planilhaDosIndiretos({ dre, fornecedor, oficina, doDre, base: null, premissas: PREMISSAS_PADRAO, empresa: "Grupo teste", geradoEm: new Date(2026, 9, 4) });
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
    perto("folha sem a oficina", doDre.get("folha_adm")?.valor ?? NaN, 85_000);
    perto("contabilidade pelos pagamentos", doDre.get("contabilidade")?.valor ?? NaN, 12_000);
    perto("gerais com o resto das administrativas", doDre.get("gerais")?.valor ?? NaN, 12_000);

    console.log("\nRESUMO — total, % da receita e conversão");
    const total = [...["folha_adm", "contabilidade", "sistemas", "sede_garagem_sp", "oficina", "gerais"]].reduce((a, k) => a + (doDre.get(k)?.valor ?? 0), 0);
    perto("total da estrutura", celula("Resumo", "Total da estrutura", "B"), total);
    const a = total / 500_000;
    perto("a = total ÷ faturamento", celula("Resumo", "a —", "B"), a, 1e-9);
    const p = PREMISSAS_PADRAO.preco;
    const d = 1 - p.lucroAlvoPct - (p.pis + p.cofins + p.irpj + p.csll + Math.max(p.iss, p.icms)) - (p.custoCapitalGiroAm * p.prazoRecebimentoDias) / 30 - p.despesasSobrePrecoPct;
    perto("d = o que sobra do preço", celula("Resumo", "d —", "B"), d, 1e-9);
    perto("administração = a ÷ (d − a)", celula("Resumo", "Administração central, %", "B"), a / (d - a), 1e-9);
    perto("administração + contingência", celula("Resumo", "Administração + contingência", "B"), a / (d - a) + PREMISSAS_PADRAO.indiretos.contingenciaPct, 1e-9);
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
