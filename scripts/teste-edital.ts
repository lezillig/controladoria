// TESTES DA IMPORTAÇÃO DE EDITAL — `npm run teste:edital`.
//
// A leitura pela IA não roda aqui (precisa da chave e custa); o que se testa é
// tudo em volta dela: o formato que ela devolve (schema), a conversão do
// edital lido para o formulário de Novo estudo, as rotas e os monitores que o
// estudo cria, a assinatura dos arquivos enviados e a divisão de PDF grande.
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { editalParaEstudo, EditalSchema, SERVICOS_DO_EDITAL, DIAS_LETIVOS_PADRAO, type EditalLido } from "../src/lib/simulador/editalParaEstudo";
import { itensIniciais, MOTORISTAS_POR_VEICULO_ESCOLAR, TIPOS_SERVICO } from "../src/lib/simulador/estudos";
import { lerHabilitacaoDoEdital, lerItensNovos } from "../src/lib/simulador/formularioDoEstudo";
import { dividirPdf } from "../src/lib/simulador/dividirPdf";
import { montarHistorico, type EditalDoHistorico } from "../src/lib/simulador/historicoDeEditais";

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "  ok  " : "FALHA "} ${nome}` + (ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         obtido   ${JSON.stringify(real)}`));
}
const ok = (nome: string, passou: boolean, detalhe = "") => conferir(nome + (passou || !detalhe ? "" : ` — ${detalhe}`), passou, true);

const base: EditalLido = {
  resumo: "Transporte escolar rural da regional X, 3 rotas.",
  nomeSugerido: "Prefeitura X — escolar — PE 1/2026",
  esfera: "PUBLICO",
  tipoEstudo: "LICITACAO",
  orgao: "Prefeitura de X",
  municipio: "X",
  uf: "sp",
  numeroEdital: "PE 1/2026",
  modalidade: "Pregão eletrônico",
  plataforma: "BLL",
  dataSessao: "2026-11-05",
  objeto: "Transporte escolar com motorista e monitor.",
  tipoServico: "ESCOLAR",
  srp: false,
  criterioJulgamento: "LOTE",
  unidadePreco: "KM",
  abrangencia: "MUNICIPAL",
  vigenciaMeses: 12,
  prazoPagamentoDias: 30,
  valorTotalMaximo: null,
  indiceReajuste: "IPCA",
  diasLetivosAno: null,
  kmImprodutivoPagoPct: null,
  itens: [
    {
      descricao: "Lote 1 — rotas rurais",
      tipoVeiculo: null,
      veiculos: null,
      kmMes: null,
      kmDia: null,
      diasMes: null,
      precoMaximo: 6.5,
      monitorasPorVeiculo: 1,
      horarioInicio: null,
      horarioFim: null,
      turnos: null,
      rotas: [
        { nome: "R01", tipoVeiculo: "MICRO", veiculos: 1, kmDia: 120, horarioInicio: "4:40", horarioFim: "18:30", turnos: 2, monitorasPorVeiculo: null, fonte: "Anexo 1, p. 1" },
        { nome: "R02", tipoVeiculo: "VAN", veiculos: 2, kmDia: 80.5, horarioInicio: "06:00", horarioFim: "13:00", turnos: 1, monitorasPorVeiculo: 1, fonte: "Anexo 1, p. 1" },
        { nome: "R03", tipoVeiculo: "ONIBUS", veiculos: 1, kmDia: null, horarioInicio: null, horarioFim: "25:00", turnos: 7, monitorasPorVeiculo: 2, fonte: "Anexo 1, p. 2" },
      ],
      fonte: "Edital, item 1",
    },
  ],
  exigencias: [{ tema: "VEICULO", texto: "Idade máxima de 10 anos.", fonte: "TR, 5.2" }],
  habilitacao: [
    { grupo: "FISCAL", documento: "Certidão negativa de débitos federais (CND/RFB-PGFN)", exigencia: "Substituída pelo SICAF.", fonte: "Edital, 9.4" },
    { grupo: "CONTABIL", documento: "Balanço patrimonial do último exercício", exigencia: "LG, SG e LC > 1; senão PL ≥ 10% do valor estimado.", fonte: "Edital, 9.5" },
    { grupo: "TECNICA", documento: "Atestado de capacidade técnica", exigencia: "50% da frota, 12 meses.", fonte: "Edital, 9.6" },
    { grupo: "DECLARACAO", documento: "  ", exigencia: null, fonte: null },
  ],
  suposicoes: ["Tipo de veículo da R01 pela lotação (28 lugares)."],
};

console.log("CONTRATO DA LEITURA");
conferir("serviços do edital = serviços do estudo", [...SERVICOS_DO_EDITAL], [...TIPOS_SERVICO]);
{
  const formato = betaZodOutputFormat(EditalSchema) as { type: string; schema?: Record<string, unknown> };
  ok("o schema vira formato de saída estruturada", formato.type === "json_schema" && typeof formato.schema === "object");
  ok("o gabarito de teste passa no schema", EditalSchema.safeParse(base).success);
}

console.log("\nESCOLAR COM ROTAS → FORMULÁRIO");
{
  const e = editalParaEstudo(base);
  const [i] = e.itens;
  // Sem dias letivos no edital: 200. R01 120 × 200; R02 80,5 × 200; R03 sem km.
  conferir("km de cada rota no período = km/dia × 200 dias letivos", i.rotas.map((r) => r.km), [String(120 * DIAS_LETIVOS_PADRAO), String(80.5 * DIAS_LETIVOS_PADRAO), ""]);
  conferir("km do item = soma das rotas", i.km, String(120 * 200 + 80.5 * 200));
  conferir("veículos do item = soma das rotas", i.veiculos, "4");
  conferir("horário normalizado; inválido some", i.rotas.map((r) => [r.horarioInicio, r.horarioFim]), [["04:40", "18:30"], ["06:00", "13:00"], ["", ""]]);
  conferir("turnos fora de 1–4 viram 1", i.rotas.map((r) => r.turnos), ["2", "1", "1"]);
  conferir("monitores: o da rota, senão o do item", i.rotas.map((r) => r.monitoras), ["1", "1", "2"]);
  conferir("tipos na ordem em que aparecem", e.tipos, ["MICRO", "VAN", "ONIBUS"]);
  conferir("preço máximo por km vai ao item, com vírgula decimal", i.precoMaximoKm, "6,5");
  conferir("UF em maiúsculas", e.campos.uf, "SP");
  ok("a suposição dos dias letivos é registrada", e.regras.some((r) => r.tema === "SUPOSICAO" && r.texto.includes("200 dias")));
  ok("exigências e suposições do edital viram regras", e.regras.some((r) => r.tema === "VEICULO") && e.regras.some((r) => r.texto.includes("lotação")));
  const comDias = editalParaEstudo({ ...base, diasLetivosAno: 190 });
  conferir("com dias letivos do edital: 120 × 190", comDias.itens[0].rotas[0].km, String(120 * 190));
}

console.log("\nNÚMEROS DO EDITAL → FORMULÁRIO → SERVIDOR (sem erro de mil vezes)");
{
  // "5.172" com ponto seria lido como 5.172 reais (ponto de milhar): a
  // conversão escreve com vírgula, e o servidor lê o mesmo número.
  const e = editalParaEstudo({ ...base, itens: [{ ...base.itens[0], precoMaximo: 5.172, rotas: [{ ...base.itens[0].rotas[1], veiculos: 1, kmDia: 12.345 }] }] });
  conferir("no formulário", [e.itens[0].precoMaximoKm, e.itens[0].rotas[0].kmDia], ["5,172", "12,3"]);
  const lidos = lerItensNovos(JSON.stringify(e.itens));
  ok("o servidor aceita", typeof lidos !== "string", String(lidos));
  if (typeof lidos !== "string") conferir("e lê o mesmo número", [lidos[0].precoMaximoKm, lidos[0].rotas?.[0].kmDia], [5.172, 12.3]);
  const v = editalParaEstudo({ ...base, valorTotalMaximo: 1234.567 });
  conferir("valor total com vírgula", v.campos.valorTotalMaximo, "1234,57");
}

console.log("\nFROTA COMPARTILHADA E KM IMPRODUTIVO PAGO (o caso da TCB)");
{
  // 4 itinerários (2 de manhã, 2 à tarde) feitos por 2 ônibus; o edital soma
  // 5% de km improdutivo ao km pago e conta 220 dias no ano (20 × 11).
  const rota = (nome: string, kmDia: number) => ({ nome, tipoVeiculo: "ONIBUS" as const, veiculos: 1, kmDia, horarioInicio: null, horarioFim: null, turnos: 1, monitorasPorVeiculo: 1, fonte: null });
  const e = editalParaEstudo({
    ...base,
    diasLetivosAno: 220,
    kmImprodutivoPagoPct: 5,
    itens: [{ ...base.itens[0], tipoVeiculo: "ONIBUS", veiculos: 2, kmMes: (100 + 50 + 80 + 70) * 1.05 * 20, diasMes: 20, rotas: [rota("L1.M", 100), rota("L1.V", 50), rota("L2.M", 80), rota("L2.V", 70)] }],
  });
  const [i] = e.itens;
  conferir("cada rota fica com a sua fração da frota", i.rotas.map((r) => r.veiculos), ["0,5", "0,5", "0,5", "0,5"]);
  conferir("o item tem a frota, não a soma das rotas", i.veiculos, "2");
  conferir("km da rota = km/dia × 1,05 × 220", i.rotas.map((r) => r.km), ["23100", "11550", "18480", "16170"]);
  conferir("km do item = km do ano no edital (300 × 1,05 × 220)", i.km, "69300");
  ok("a repartição da frota vira suposição", e.regras.some((r) => r.tema === "SUPOSICAO" && r.texto.includes("0,5 da frota")));
  ok("o km improdutivo pago vira regra", e.regras.some((r) => r.tema === "CONTRATUAL" && r.texto.includes("5% de km improdutivo")));
  ok("km das rotas batendo com o km/mês do edital: sem alerta", !e.regras.some((r) => r.texto.includes("Confira qual vale")));
  const divergente = editalParaEstudo({ ...base, kmImprodutivoPagoPct: null, itens: [{ ...base.itens[0], kmMes: 99_999, diasMes: 20 }] });
  ok("km das rotas longe do km/mês do edital: alerta", divergente.regras.some((r) => r.texto.includes("Confira qual vale")));
  const lidos = lerItensNovos(JSON.stringify(i.rotas.length ? e.itens : []));
  if (typeof lidos === "string") ok("o servidor aceita", false, lidos);
  else {
    const { rotas } = itensIniciais({ nome: "TCB", tipoServico: "ESCOLAR", itens: lidos, tiposVeiculo: ["ONIBUS"] });
    const soma = (f: (r: (typeof rotas)[number]) => number) => Math.round(rotas.reduce((a, r) => a + f(r), 0) * 100) / 100;
    conferir("no estudo: frota = 2 ônibus", soma((r) => r.veiculos), 2);
    conferir("motoristas = frota × 1,07", soma((r) => r.motoristas), Math.round(2 * MOTORISTAS_POR_VEICULO_ESCOLAR * 100) / 100);
    conferir("monitores = frota × 1 × cobertura (1,07)", soma((r) => r.monitoras), Math.round(2 * MOTORISTAS_POR_VEICULO_ESCOLAR * 100) / 100);
  }
}

console.log("\nHABILITAÇÃO");
{
  const e = editalParaEstudo(base);
  conferir("documentos por grupo, sem linha vazia", e.habilitacao.map((d) => d.grupo), ["FISCAL", "CONTABIL", "TECNICA"]);
  conferir("exigência e fonte vão junto", [e.habilitacao[1].exigencia, e.habilitacao[1].fonte], ["LG, SG e LC > 1; senão PL ≥ 10% do valor estimado.", "Edital, 9.5"]);
  const lidos = lerHabilitacaoDoEdital(JSON.stringify([...e.habilitacao, { grupo: "INVENTADO", documento: "Alvará" }, { grupo: "FISCAL", documento: "" }, "lixo"]));
  conferir("no servidor: grupo desconhecido vira OUTRO; vazio e lixo caem", lidos.map((d) => d.grupo), ["FISCAL", "CONTABIL", "TECNICA", "OUTRO"]);
  conferir("JSON quebrado: nada", lerHabilitacaoDoEdital("{"), []);
}

console.log("\nFRETAMENTO SEM ROTAS, PREÇO POR VEÍCULO-MÊS");
{
  const e = editalParaEstudo({
    ...base,
    tipoServico: "FRETAMENTO",
    unidadePreco: "VEICULO_MES",
    criterioJulgamento: "ITEM",
    itens: [
      { ...base.itens[0], descricao: "Item 1 — van", tipoVeiculo: "VAN", veiculos: 3, kmMes: 9000, kmDia: null, diasMes: 22, precoMaximo: 30000, rotas: [] },
      { ...base.itens[0], descricao: "Item 2 — ônibus", tipoVeiculo: "ONIBUS", veiculos: 2, kmMes: null, kmDia: 400, diasMes: 21, precoMaximo: null, rotas: [] },
    ],
  });
  conferir("item com km/mês usa o km/mês", e.itens[0].km, "9000");
  conferir("item com km/dia: km/dia × dias do mês", e.itens[1].km, String(400 * 21));
  conferir("preço máximo por veículo-mês vai ao teto do item, na unidade do contrato", e.itens[0].precoMaximoKm, "30000");
  const bin = editalParaEstudo({ ...base, unidadePreco: "BINOMIA", itens: [{ ...base.itens[0], precoMaximo: 30000, rotas: [] }] });
  ok("na binômia o teto não tem campo e vira regra para conferir", bin.itens[0].precoMaximoKm === "" && bin.regras.some((r) => r.tema === "CONTRATUAL" && r.texto.includes("30.000")));
  const misto = editalParaEstudo({ ...base, abrangencia: "MISTO" });
  ok("abrangência mista avisa para ajustar o % intermunicipal", misto.regras.some((r) => r.texto.includes("% intermunicipal")));
  conferir("dias do mês do item", e.itens.map((i) => i.diasMes), ["22", "21"]);
}

console.log("\nO ESTUDO QUE NASCE DAS ROTAS");
{
  const e = editalParaEstudo(base);
  const itens = lerItensNovos(JSON.stringify(e.itens));
  if (typeof itens === "string") throw new Error(itens);
  const { rotas } = itensIniciais({ nome: "E", tipoServico: "ESCOLAR", itens, tiposVeiculo: ["MICRO", "VAN", "ONIBUS"] });
  // R03 não tem km nem horário válido: não nasce rota (vai na Operação).
  conferir("uma rota por linha com km ou horário", rotas.map((r) => r.nome), ["R01", "R02"]);
  conferir("km/dia do edital preservado", rotas.map((r) => r.kmDia), [120, 80.5]);
  const f = MOTORISTAS_POR_VEICULO_ESCOLAR;
  conferir("monitores = veículos × monitores/veículo × turnos × cobertura", rotas.map((r) => r.monitoras), [Math.round(1 * 1 * 2 * f * 1e4) / 1e4, Math.round(2 * 1 * 1 * f * 1e4) / 1e4]);
  conferir("escolar: motoristas = veículos × 1,07 × turnos", rotas.map((r) => r.motoristas), [Math.round(1 * MOTORISTAS_POR_VEICULO_ESCOLAR * 2 * 100) / 100, Math.round(2 * MOTORISTAS_POR_VEICULO_ESCOLAR * 100) / 100]);
  conferir("tipo de veículo por rota", rotas.map((r) => r.perfilVeiculo), ["MICRO", "VAN"]);
  conferir("horário da rota e noturno", rotas.map((r) => [r.horarioInicio, r.horarioFim, r.noturno]), [["04:40", "18:30", true], ["06:00", "13:00", false]]);
  conferir("ordem das rotas é contínua", rotas.map((r) => r.ordem), [0, 1]);
}

async function assinatura() {
  console.log("\nARQUIVOS ASSINADOS PELA EMPRESA");
  process.env.JWT_SECRET = "segredo-de-teste-0123456789";
  const { assinarArquivo, arquivosAssinadosValidos } = await import("../src/lib/simulador/importarEdital");
  const a = assinarArquivo("empresa-a", { fileId: "file_011CTesteAbc123", nome: "edital.pdf", bloco: "documento" });
  conferir("assinado pela empresa: aceito", arquivosAssinadosValidos("empresa-a", [a])?.map((x) => x.fileId), ["file_011CTesteAbc123"]);
  conferir("outra empresa: recusado", arquivosAssinadosValidos("empresa-b", [a]), null);
  conferir("identificador trocado: recusado", arquivosAssinadosValidos("empresa-a", [{ ...a, fileId: "file_011COutroArquivo9" }]), null);
  conferir("bloco trocado: recusado", arquivosAssinadosValidos("empresa-a", [{ ...a, bloco: "imagem" }]), null);
  conferir("lista vazia: recusada", arquivosAssinadosValidos("empresa-a", []), null);
  conferir("identificador fora do padrão: recusado", arquivosAssinadosValidos("empresa-a", [{ ...a, fileId: "../x" }]), null);

  const { lerEdital, isLeituraDeEditalDisponivel } = await import("../src/lib/simulador/importarEdital");
  const chave = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  conferir("sem chave da IA: indisponível", isLeituraDeEditalDisponivel(), false);
  const r = await lerEdital([{ fileId: "file_011CTesteAbc123", nome: "x.pdf", bloco: "documento" }], { empresa: "Azul" });
  ok("sem chave da IA: erro claro, sem chamar a API", !r.ok && r.erro.includes("ANTHROPIC_API_KEY"));
  if (chave) process.env.ANTHROPIC_API_KEY = chave;
}

async function divisao() {
  console.log("\nPDF GRANDE DIVIDIDO EM PARTES");
  // 24 páginas de texto pseudoaleatório (o pdf-lib comprime o conteúdo; texto
  // repetido viraria poucos KB): ~90 KB por página, ~2 MB no total.
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Courier);
  let semente = 12345;
  const letra = () => ((semente = (Math.imul(semente, 1664525) + 1013904223) >>> 0), String.fromCharCode(65 + (semente >>> 16) % 26));
  for (let p = 0; p < 24; p++) doc.addPage([300, 300]).drawText(`${p + 1} ${Array.from({ length: 150_000 }, letra).join("")}`, { x: 0, y: 150, size: 4, font: fonte });
  const bytes = await doc.save({ useObjectStreams: false });
  const limite = 1_000_000;
  const partes = await dividirPdf(bytes, "grande.pdf", limite);
  ok("mais de uma parte", partes.length > 1, `${partes.length} parte(s) de ${bytes.byteLength} bytes`);
  ok("cada parte abaixo do limite", partes.every((x) => x.bytes.byteLength <= limite), partes.map((x) => x.bytes.byteLength).join(","));
  conferir("as partes cobrem todas as páginas, em ordem e sem buraco", partes.map((x) => [x.de, x.ate]).flat().filter((_, k, l) => k === 0 || k === l.length - 1), [0, 24]);
  ok("intervalos contíguos", partes.every((x, k) => k === 0 || x.de === partes[k - 1].ate));
  const paginas = await Promise.all(partes.map(async (x) => (await PDFDocument.load(x.bytes)).getPageCount()));
  conferir("páginas de cada parte batem com o intervalo", paginas, partes.map((x) => x.ate - x.de));
  let erro = "";
  try {
    await dividirPdf(bytes, "grande.pdf", 50_000);
  } catch (e) {
    erro = e instanceof Error ? e.message : "";
  }
  ok("página sozinha acima do limite: erro que diz a página", erro.includes("página 1"), erro);
  const pequeno = await dividirPdf(bytes, "grande.pdf", 10_000_000);
  conferir("PDF abaixo do limite: uma parte só", pequeno.map((x) => [x.de, x.ate]), [[0, 24]]);
}

console.log("\nHISTÓRICO DE EDITAIS");
{
  const ed = (o: Partial<EditalDoHistorico>): EditalDoHistorico => ({ id: "x", nome: "E", orgao: "Órgão", numeroEdital: null, tipoServico: "ESCOLAR", esfera: "PUBLICO", status: "PERDIDO", dataSessao: new Date(2026, 9, 1), unidade: "R$/km", nossoPreco: 10, precoVencedor: 9, vencedor: "Viação X", posicao: 2, teto: 12, valorTotalMaximo: null, participantes: [], arquivos: 0, ...o });
  const h = montarHistorico([
    ed({ participantes: [{ empresa: "Viação X Ltda.", preco: 9, situacao: "VENCEDORA", ehNossa: false }, { empresa: "Azul", preco: 10, situacao: "CLASSIFICADA", ehNossa: true }] }),
    ed({ status: "GANHO", vencedor: "Azul", precoVencedor: 10, posicao: 1, participantes: [{ empresa: "VIACAO X LTDA", preco: 11, situacao: "CLASSIFICADA", ehNossa: false }] }),
    ed({ status: "EM_ESTUDO", tipoServico: "FRETAMENTO", vencedor: null, precoVencedor: null, posicao: null }),
  ]);
  conferir("taxa de vitória = ganhos ÷ decididos", [h.resumo.decididos, h.resumo.ganhos, h.resumo.taxa], [2, 1, 0.5]);
  ok("nosso × vencedor só na perdida: 10 ÷ 9 − 1", Math.abs((h.linhas[0].nossoSobreVencedor ?? 0) - (10 / 9 - 1)) < 1e-12 && h.linhas[1].nossoSobreVencedor === null);
  ok("desconto do vencedor sobre o teto: 1 − 9 ÷ 12", Math.abs((h.linhas[0].descontoVencedor ?? 0) - (1 - 9 / 12)) < 1e-12);
  conferir("o mesmo concorrente escrito de dois jeitos conta como um", h.concorrentes.map((c) => [c.disputas, c.vitorias]), [[2, 1]]);
  ok("preço do concorrente × o nosso: média de −10% e +10%", Math.abs(h.concorrentes[0].precoSobreONossoMedio ?? 1) < 1e-12);
  conferir("por serviço", h.porServico.map((s) => [s.servico, s.editais, s.decididos]), [["ESCOLAR", 2, 2], ["FRETAMENTO", 1, 0]]);
}

(async () => {
  await assinatura();
  await divisao();
  console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
  process.exit(falhas === 0 ? 0 : 1);
})();
