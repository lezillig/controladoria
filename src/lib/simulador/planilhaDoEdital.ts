import ExcelJS from "exceljs";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { cliente, comFallback, ESFORCO_EDITAL, isLeituraDeEditalDisponivel, mensagemDeErro, MODELO_EDITAL, MODELO_PLANILHA } from "./importarEdital";
import type { EntradaSimulacao, ResultadoSimulacao } from "./tipos";
import { ROTULO_UNIDADE } from "./tipos";

// A PLANILHA DE CUSTOS DO EDITAL, PREENCHIDA COM O ESTUDO.
//
// Muitos editais trazem o modelo da planilha de custos que vai com a proposta
// (a TCB manda o Excel com as fórmulas do órgão e as células amarelas para a
// licitante preencher). Aqui o modelo vira proposta em três passos:
//
//   1. INVENTÁRIO (sem IA): as células que a licitante preenche são as que as
//      fórmulas do órgão leem e não são fórmula — mais as amarelas. Cada uma
//      com o rótulo da linha.
//   2. MAPA (IA): para cada uma, qual número do estudo vai nela (o catálogo
//      abaixo), com um multiplicador para a unidade (R$/dia × 22 = R$/mês).
//      O que o estudo não tem fica PENDENTE — nunca inventado.
//   3. PREENCHIMENTO (sem IA): os números entram nas células, as fórmulas do
//      órgão ficam intactas, e uma aba "Conferência" lista o que foi
//      preenchido, de onde veio, o que falta e o preço do órgão ao lado do
//      preço do simulador (o Excel recalcula ao abrir).

export type CelulaDeEntrada = { aba: string; celula: string; valor: number | string | null; amarela: boolean; rotulo: string };
export type ValorDoEstudo = { chave: string; descricao: string; valor: number; unidade: string };

const MAX_CELULAS = 400;
// Referência numa fórmula: aba opcional ('Com espaço'! ou Simples!), célula e,
// se for intervalo, o fim (G2:G16).
const REF = /(?:(?:'((?:[^']|'')+)'|([A-Za-z_\u00C0-\u017F][\w.\u00C0-\u017F]*))!)?\$?([A-Z]{1,3})\$?(\d{1,7})(?::\$?([A-Z]{1,3})\$?(\d{1,7}))?/g;
const coluna = (l: string) => [...l].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
const letra = (n: number): string => (n <= 0 ? "" : letra(Math.floor((n - 1) / 26)) + String.fromCharCode(65 + ((n - 1) % 26)));
// As células de uma referência (intervalo expandido até 400 células).
function celulasDaReferencia(m: RegExpMatchArray): string[] {
  const [c1, l1] = [coluna(m[3]), Number(m[4])];
  if (!m[5]) return [`${m[3]}${m[4]}`];
  const [c2, l2] = [coluna(m[5]), Number(m[6])];
  if ((Math.abs(c2 - c1) + 1) * (Math.abs(l2 - l1) + 1) > 400) return [];
  const r: string[] = [];
  for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) for (let l = Math.min(l1, l2); l <= Math.max(l1, l2); l++) r.push(`${letra(c)}${l}`);
  return r;
}

// O texto da fórmula de uma célula do ExcelJS (fórmula própria ou compartilhada).
function formulaDe(c: ExcelJS.Cell): string | null {
  const v = c.value as unknown;
  if (v && typeof v === "object") {
    const o = v as { formula?: string; sharedFormula?: string };
    if (typeof o.formula === "string") return o.formula;
    if (typeof o.sharedFormula === "string") return o.sharedFormula;
  }
  return null;
}

// O texto de uma célula: simples, formatado (richText) ou resultado de fórmula.
function textoDe(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const o = v as { richText?: { text: string }[]; result?: unknown; text?: unknown };
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text).join("");
    if (typeof o.result === "string") return o.result;
    if (typeof o.text === "string") return o.text;
  }
  return null;
}

const ehAmarela = (c: ExcelJS.Cell) => {
  const f = c.fill as { type?: string; fgColor?: { argb?: string } } | undefined;
  const argb = f?.type === "pattern" ? (f.fgColor?.argb ?? "") : "";
  return /^(FF)?FFFF(00|66|99|CC)$/i.test(argb);
};

// Rótulo longo: o começo (o que é) e o fim (a unidade).
const encurtar = (t: string) => (t.length <= 320 ? t : `${t.slice(0, 240)} … ${t.slice(-70)}`);

// PASSO 1 — as células de entrada do modelo.
export async function inventariarPlanilha(conteudo: Buffer): Promise<{ abas: string[]; celulas: CelulaDeEntrada[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(conteudo as unknown as ArrayBuffer);
  // Cada célula que alguma fórmula lê (com a aba).
  const lidas = new Set<string>();
  wb.eachSheet((ws) => {
    ws.eachRow((row) =>
      row.eachCell((c) => {
        const f = formulaDe(c);
        if (!f) return;
        // Sem os textos entre aspas duplas ("R$/km" não é referência).
        const semTextos = f.replace(/"[^"]*"/g, "");
        for (const m of semTextos.matchAll(REF)) {
          const aba = (m[1]?.replace(/''/g, "'") ?? m[2] ?? ws.name).trim();
          for (const end of celulasDaReferencia(m)) lidas.add(`${aba}!${end}`);
        }
      })
    );
  });
  const celulas: CelulaDeEntrada[] = [];
  wb.eachSheet((ws) => {
    const vistas = new Set<string>();
    const avaliar = (c: ExcelJS.Cell) => {
      if (celulas.length >= MAX_CELULAS || vistas.has(c.address)) return;
      vistas.add(c.address);
      if (formulaDe(c)) return;
      const v = c.value;
      const numeroOuVazio = v === null || v === undefined || typeof v === "number";
      if (!numeroOuVazio) return;
      const amarela = ehAmarela(c);
      if (!amarela && !lidas.has(`${ws.name}!${c.address}`)) return;
      // O rótulo: os textos à esquerda na mesma linha.
      const textos: string[] = [];
      const linha = ws.getRow(Number(c.row));
      for (let k = 1; k < Number(c.col); k++) {
        const t = textoDe(linha.getCell(k).value)?.trim().replace(/\s+/g, " ");
        // Célula mesclada repete o texto em cada coluna: uma vez só.
        if (t && textos[textos.length - 1] !== t) textos.push(t);
      }
      // E o que vem logo à direita (unidade, explicação), se for texto.
      const direita = textoDe(linha.getCell(Number(c.col) + 1).value)?.trim().replace(/\s+/g, " ");
      if (direita) textos.push(`[${direita.slice(0, 80)}]`);
      celulas.push({ aba: ws.name, celula: c.address, valor: typeof v === "number" ? v : null, amarela, rotulo: encurtar(textos.join(" | ")) });
    };
    ws.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: true }, avaliar));
    // Células vazias lidas por fórmula podem não existir na linha: busca direta.
    for (const ref of lidas) {
      const [aba, end] = ref.split("!");
      if (aba === ws.name) avaliar(ws.getCell(end));
    }
  });
  return { abas: wb.worksheets.map((w) => w.name), celulas };
}

// O CATÁLOGO: os números do estudo que podem ir para a planilha do órgão.
export function catalogoDoEstudo(entrada: EntradaSimulacao, resultado: ResultadoSimulacao): ValorDoEstudo[] {
  const p = entrada.premissas;
  // O perfil da maior parte das rotas (o veículo do contrato).
  const contagem = new Map<string, number>();
  for (const r of entrada.rotas) contagem.set(r.perfilVeiculo ?? "", (contagem.get(r.perfilVeiculo ?? "") ?? 0) + r.veiculos);
  const codigo = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  const perfil = p.perfis?.find((x) => x.codigo === codigo);
  const veiculo = perfil?.veiculo ?? p.veiculo;
  const variaveis = perfil?.variaveis ?? p.variaveis;
  const t = resultado.totais;
  const unidade = entrada.unidadePreco ?? "KM";
  const precoUnidade = resultado.lote ? resultado.lote.precoPropostaUnidade : (resultado.itens[0]?.precoUnidade ?? 0);
  const linhas: [string, string, number | null | undefined, string][] = [
    ["frota_operante", "Veículos em operação (sem reserva)", t.veiculos, "veículos"],
    ["frota_com_reserva", "Veículos com a reserva técnica", t.veiculosComReserva, "veículos"],
    ["reserva_tecnica_pct", "Reserva técnica sobre a frota", p.contrato.reservaTecnicaPct, "fração"],
    ["motoristas", "Motoristas (com a cobertura de faltas e férias)", t.motoristas, "pessoas"],
    ["monitores", "Monitores", t.monitoras, "pessoas"],
    ["km_util_apuracao", `Km útil no ${p.contrato.modo === "MENSAL" ? "mês" : "período de apuração"}`, t.kmUtil, "km"],
    ["km_improdutivo_pct", "Km improdutivo não pago sobre o km útil", p.contrato.kmMortoPct, "fração"],
    ["diesel_litro", "Preço do litro do diesel", variaveis.dieselLitro, "R$/litro"],
    ["consumo_km_por_litro", "Consumo de diesel", variaveis.consumoAsfaltoKmL, "km/litro"],
    ["arla_por_km", "ARLA 32 por km", variaveis.arlaKm, "R$/km"],
    ["lubrificacao_lavagem_por_km", "Óleo, lubrificação e lavagem por km", variaveis.oleoLavagemKm, "R$/km"],
    ["pneus_por_km", "Pneus e recapagem por km", variaveis.pneusAsfaltoKm, "R$/km"],
    ["manutencao_por_km", "Manutenção (peças e serviços) por km", variaveis.manutencaoAsfaltoKm, "R$/km"],
    ["veiculo_valor", veiculo.idadeInicialAnos === 0 ? "Valor do veículo novo (zero km)" : `Valor do veículo (${veiculo.idadeInicialAnos} anos)`, veiculo.valor, "R$/veículo"],
    ["veiculo_idade_anos", "Idade do veículo no início", veiculo.idadeInicialAnos, "anos"],
    ["veiculo_vida_util_anos", "Vida útil", veiculo.vidaUtilAnos, "anos"],
    ["veiculo_residual_pct", "Valor residual", veiculo.valorResidualPct, "fração"],
    ["taxa_capital_aa", "Custo de capital ao ano", veiculo.custoCapitalAa, "fração ao ano"],
    ["seguro_veiculo_ano", "Seguro por veículo no ano", veiculo.seguroMes * 12, "R$/veículo/ano"],
    ["ipva_licenciamento_ano", "IPVA, licenciamento e vistoria por veículo no ano", veiculo.ipvaLicenciamentoAno + veiculo.laudoVistoriaAno, "R$/veículo/ano"],
    ["rastreamento_mes", "Rastreamento, telemetria e controle de embarque por veículo", veiculo.rastreadorMes + veiculo.telemetriaExtraMes + veiculo.controleEmbarqueMes, "R$/veículo/mês"],
    ["garagem_mes", "Garagem por veículo", veiculo.garagemMes, "R$/veículo/mês"],
    ["salario_motorista", "Salário-base do motorista", perfil?.motorista.salario ?? p.pessoal.salarioMotorista, "R$/mês"],
    ["salario_monitor", "Salário-base do monitor", p.pessoal.salarioMonitora, "R$/mês"],
    ["encargos_sociais_pct", "Encargos sociais sobre a folha", p.pessoal.encargosPct, "fração"],
    ["vale_refeicao_dia", "Vale-refeição por dia trabalhado", p.pessoal.valeRefeicaoDia ?? null, "R$/dia"],
    ["beneficios_por_funcionario_mes", "Benefícios por funcionário (plano de saúde, cesta, seguro de vida…)", p.pessoal.beneficiosPorFuncionario, "R$/funcionário/mês"],
    ["uniforme_epi_por_funcionario_mes", "Uniforme e EPI por funcionário", p.pessoal.uniformeEpiPorFuncionario, "R$/funcionário/mês"],
    ["administracao_pct", "Administração central sobre o custo direto", p.indiretos.administracaoPct, "fração"],
    ["lucro_alvo_pct", "Lucro sobre o preço", p.preco.lucroAlvoPct, "fração"],
    ["iss_pct", "ISS", p.preco.iss, "fração"],
    ["pis_pct", "PIS", p.preco.pis, "fração"],
    ["cofins_pct", "COFINS", p.preco.cofins, "fração"],
    ["icms_pct", "ICMS (intermunicipal)", p.preco.icms, "fração"],
    ["preco_proposto", `Preço proposto pelo simulador (${ROTULO_UNIDADE[unidade]})`, precoUnidade, ROTULO_UNIDADE[unidade]],
    ["custo_por_km", "Custo total por km útil (simulador)", t.custoTotal / (t.kmUtil || 1), "R$/km"],
  ];
  return linhas
    .filter((l): l is [string, string, number, string] => typeof l[2] === "number" && Number.isFinite(l[2]))
    .map(([chave, descricao, valor, unidadeValor]) => ({ chave, descricao, valor: Math.round(valor * 1e6) / 1e6, unidade: unidadeValor }));
}

export const MapaSchema = z.object({
  preenchimentos: z
    .array(
      z.object({
        aba: z.string(),
        celula: z.string().describe("Endereço, ex.: D3."),
        chave: z.string().describe("A chave do catálogo do estudo."),
        multiplicador: z.number().describe("Converte a unidade do estudo para a da célula (1 se igual; 22 para R$/dia → R$/mês de 22 dias; 100 se a célula pede percentual inteiro)."),
        observacao: z.string().nullable(),
      })
    ),
  pendentes: z
    .array(z.object({ aba: z.string(), celula: z.string(), rotulo: z.string().describe("O que a célula pede, em poucas palavras."), motivo: z.string().describe("Por que o estudo não tem esse número.") }))
    .describe("Células que a licitante deve preencher e que o estudo não tem como dar."),
  resultado: z
    .object({ aba: z.string(), celula: z.string(), descricao: z.string() })
    .nullable()
    .describe("A célula com o preço unitário final da planilha do órgão (R$/km, R$/veículo-mês…), para comparar com o simulador. Nulo se não houver uma só."),
});
export type MapaDaPlanilha = z.infer<typeof MapaSchema>;

const SYSTEM_MAPA = `Você recebe o inventário das células de entrada de uma planilha de custos que acompanha um edital de transporte de passageiros (as células que as fórmulas do órgão leem e não são fórmula; "amarela" marca as que o órgão destaca para a licitante preencher) e o catálogo de números de um estudo de custo da empresa licitante.

Decida, para cada célula que a LICITANTE deve preencher (normalmente as amarelas), qual número do catálogo vai nela:
- Use só chaves do catálogo. Se o catálogo não tem o número que a célula pede (preço do pneu, do lubrificante por litro, aluguel da garagem, salário do administrativo, vale-transporte…), ponha a célula em "pendentes" com o motivo. Nunca invente valor.
- O multiplicador converte a unidade: R$/dia para R$/mês de 22 dias é 22; fração para percentual inteiro é 100; mês para ano é 12. Confira a unidade no rótulo.
- Não preencha parâmetros que o órgão fixa (coeficientes de consumo, fatores de utilização, alíquotas já preenchidas, km, frota): esses já vêm com valor e não são da licitante.
- Se uma célula pede um número que corresponde só aproximadamente ao do catálogo (ex.: "diesel + ARLA por litro" e o catálogo tem o diesel), preencha e explique na observação.
- Indique em "resultado" a célula do preço unitário final da planilha, se houver.

Responda em português do Brasil.`;

// PASSO 2 — o mapa, pela IA.
export async function mapearPlanilha(
  inventario: { abas: string[]; celulas: CelulaDeEntrada[] },
  catalogo: ValorDoEstudo[],
  contexto: { estudo: string; arquivo: string }
): Promise<{ ok: true; mapa: MapaDaPlanilha } | { ok: false; erro: string }> {
  if (!isLeituraDeEditalDisponivel()) return { ok: false, erro: "Leitura automática indisponível (ANTHROPIC_API_KEY não configurada)." };
  if (inventario.celulas.length === 0) return { ok: false, erro: "A planilha não tem células de entrada lidas por fórmulas: não parece um modelo de planilha de custos." };
  const inv = inventario.celulas.map((c) => `${c.aba}!${c.celula}${c.amarela ? " (amarela)" : ""} = ${c.valor ?? "vazia"} — ${c.rotulo || "(sem rótulo)"}`).join("\n");
  const cat = catalogo.map((v) => `${v.chave}: ${v.descricao} = ${v.valor} ${v.unidade}`).join("\n");
  // O modelo barato primeiro; recusa, corte ou formato errado → o padrão.
  let ultimoErro = "";
  for (const modelo of [...new Set([MODELO_PLANILHA, MODELO_EDITAL])]) {
    try {
      const message = await cliente().beta.messages.create(
        {
          model: modelo,
          max_tokens: 24000,
          output_config: { effort: ESFORCO_EDITAL, format: betaZodOutputFormat(MapaSchema) },
          ...comFallback(modelo),
          system: SYSTEM_MAPA,
          messages: [
            {
              role: "user",
              content: `Estudo: ${contexto.estudo}\nPlanilha: ${contexto.arquivo} (abas: ${inventario.abas.join(", ")})\n\n<inventario>\n${inv}\n</inventario>\n\n<catalogo>\n${cat}\n</catalogo>`,
            },
          ],
        },
        { timeout: 120_000, maxRetries: 0 }
      );
      if (message.stop_reason === "refusal") {
        ultimoErro = "O mapeamento foi recusado pelo modelo. Preencha a planilha à mão.";
        continue;
      }
      if (message.stop_reason === "max_tokens") {
        ultimoErro = "A planilha tem células demais para mapear de uma vez.";
        continue;
      }
      const texto = message.content
        .filter((b): b is Extract<(typeof message.content)[number], { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("");
      const lido = MapaSchema.safeParse((() => {
        try {
          return JSON.parse(texto);
        } catch {
          return null;
        }
      })());
      if (lido.success) return { ok: true, mapa: lido.data };
      ultimoErro = "A resposta não veio no formato esperado.";
    } catch (e) {
      ultimoErro = mensagemDeErro(e);
      // Conta sem crédito ou chave recusada: o outro modelo também não passaria.
      if (/sem crédito|foi recusada/.test(ultimoErro)) break;
    }
  }
  return { ok: false, erro: ultimoErro };
}

// PASSO 3 — o preenchimento. Só escreve em célula do inventário que não é
// fórmula; chave fora do catálogo ou célula fora do inventário vira pendente.
export async function preencherPlanilha(
  conteudo: Buffer,
  inventario: { celulas: CelulaDeEntrada[] },
  mapa: MapaDaPlanilha,
  catalogo: ValorDoEstudo[],
  contexto: { estudo: string; versao: number | null; unidade: string; preco: number }
): Promise<{ conteudo: Buffer; preenchidas: number; pendentes: { aba: string; celula: string; rotulo: string; motivo: string }[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(conteudo as unknown as ArrayBuffer);
  const doCatalogo = new Map(catalogo.map((v) => [v.chave, v]));
  const permitidas = new Map(inventario.celulas.map((c) => [`${c.aba}!${c.celula}`, c]));
  const feitos: { aba: string; celula: string; rotulo: string; valor: number; origem: string; observacao: string | null }[] = [];
  const pendentes = [...mapa.pendentes];
  for (const m of mapa.preenchimentos) {
    const alvo = permitidas.get(`${m.aba}!${m.celula}`);
    const v = doCatalogo.get(m.chave);
    const ws = wb.getWorksheet(m.aba);
    if (!alvo || !v || !ws || formulaDe(ws.getCell(m.celula))) {
      pendentes.push({ aba: m.aba, celula: m.celula, rotulo: alvo?.rotulo ?? "", motivo: !v ? `chave "${m.chave}" fora do catálogo` : "célula não é de entrada" });
      continue;
    }
    const mult = Number.isFinite(m.multiplicador) && m.multiplicador > 0 ? m.multiplicador : 1;
    const valor = Math.round(v.valor * mult * 1e6) / 1e6;
    ws.getCell(m.celula).value = valor;
    feitos.push({ aba: m.aba, celula: m.celula, rotulo: alvo.rotulo, valor, origem: `${v.descricao}${mult !== 1 ? ` × ${mult}` : ""}`, observacao: m.observacao });
  }

  // A conferência: o que entrou, de onde, o que falta e o preço do órgão ao
  // lado do simulador (fórmula: o Excel calcula ao abrir).
  const nome = "Conferência (simulador)";
  const anterior = wb.getWorksheet(nome);
  if (anterior) wb.removeWorksheet(anterior.id);
  const wc = wb.addWorksheet(nome);
  wc.columns = [{ width: 30 }, { width: 10 }, { width: 60 }, { width: 16 }, { width: 50 }, { width: 40 }];
  wc.getCell("A1").value = `Planilha preenchida com o estudo "${contexto.estudo}"${contexto.versao ? ` (versão ${contexto.versao})` : ""}`;
  wc.getCell("A1").font = { bold: true, size: 12 };
  wc.getCell("A2").value = "As fórmulas do órgão não foram alteradas: só as células abaixo receberam números. Confira cada uma e preencha as pendentes antes de enviar.";
  let l = 4;
  const cab = (t: string[]) => {
    t.forEach((x, k) => {
      const c = wc.getCell(l, k + 1);
      c.value = x;
      c.font = { bold: true };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
    });
    l++;
  };
  if (mapa.resultado && wb.getWorksheet(mapa.resultado.aba)) {
    cab(["Comparação", "", "", "Valor", "", ""]);
    const ref = `'${mapa.resultado.aba.replace(/'/g, "''")}'!${mapa.resultado.celula}`;
    wc.getCell(l, 1).value = "Preço da planilha do órgão";
    wc.getCell(l, 3).value = mapa.resultado.descricao;
    wc.getCell(l, 4).value = { formula: ref } as ExcelJS.CellFormulaValue;
    wc.getCell(l, 4).numFmt = "#,##0.0000";
    const lOrgao = l++;
    wc.getCell(l, 1).value = `Preço do simulador (${contexto.unidade})`;
    wc.getCell(l, 4).value = contexto.preco;
    wc.getCell(l, 4).numFmt = "#,##0.0000";
    const lSim = l++;
    wc.getCell(l, 1).value = "Diferença (órgão ÷ simulador − 1)";
    wc.getCell(l, 4).value = { formula: `IFERROR(D${lOrgao}/D${lSim}-1,"")` } as ExcelJS.CellFormulaValue;
    wc.getCell(l, 4).numFmt = "0.0%";
    l += 2;
  }
  cab(["Aba", "Célula", "O que a célula pede", "Valor", "De onde veio (estudo)", "Observação"]);
  for (const f of feitos) {
    [f.aba, f.celula, f.rotulo, f.valor, f.origem, f.observacao ?? ""].forEach((x, k) => (wc.getCell(l, k + 1).value = x));
    l++;
  }
  l++;
  cab(["PENDENTES — preencher à mão", "Célula", "O que a célula pede", "", "Por que o estudo não tem", ""]);
  for (const p of pendentes) {
    [p.aba, p.celula, p.rotulo, null, p.motivo, ""].forEach((x, k) => (wc.getCell(l, k + 1).value = x));
    wc.getRow(l).font = { color: { argb: "FFB45309" } };
    l++;
  }
  wb.calcProperties = { ...(wb.calcProperties ?? {}), fullCalcOnLoad: true };
  const bytes = await wb.xlsx.writeBuffer();
  return { conteudo: Buffer.from(bytes as ArrayBuffer), preenchidas: feitos.length, pendentes };
}
