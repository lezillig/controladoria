import type { OmieTitulo } from "@prisma/client";
import { fmtBRL, fmtPercent } from "../format";
import type { AchadoNovo, ContextoAuditoria } from "../types";
import { agrupar, chaveAchado, chaveMes, chaveParceiro, mediana, nomeParceiro, somar, titulosAtivos } from "./comum";

// ANTIFRAUDE — OS TESTES ESTATÍSTICOS
//
// Benford pelo método de Nigrini e a concentração de fornecedor por
// categoria. Os dois apontam ONDE olhar, não um fato: por isso a descrição de
// cada achado diz o que a estatística sustenta e o que ela não sustenta.

// ---------------------------------------------------------------------------
// FR-BENFORD — Lei de Benford pelo método de Nigrini (MAD + qui-quadrado)
// ---------------------------------------------------------------------------
// A versão anterior olhava só o primeiro dígito, em 150 valores, e acusava
// quando um dígito desviava 8 pontos percentuais. Com 150 valores o erro-
// padrão da proporção do dígito 1 é ~3,7 p.p.; 8 p.p. é ~2 desvios num
// único dígito, testado nove vezes — falso alarme perto de 1 em 4.
//
// Nigrini (Benford's Law, 2012) mede a conformidade pela MÉDIA DOS DESVIOS
// ABSOLUTOS (MAD) e classifica: primeiro dígito, MAD > 0,015 é não
// conformidade; dois primeiros dígitos, MAD > 0,0022. O qui-quadrado (df 8 e
// 89) confirma que não é acaso. Os dois têm de acusar juntos, e a amostra
// tem de ser grande (500 para F1D, 300 para F2D — abaixo disso a MAD é
// instável). Valores fixos recorrentes (o mesmo aluguel doze vezes) saem da
// amostra: contrato quebra Benford legitimamente.
//
// O teste roda POR EMPRESA e por grupo de categoria (raiz da árvore), não
// sobre a base inteira: uma acusação sobre "todos os pagamentos" não é
// acionável; sobre "manutenção da MCZ" é. E a evidência lista os fornecedores
// que mais contribuem para os dígitos em excesso — é neles que se olha.
const MINIMO_F1D = 500;
const MINIMO_F2D = 300;
const MAD_LIMITE_F1D = 0.015;
const MAD_LIMITE_F2D = 0.0022;
// Qui-quadrado crítico a 1%: df 8 = 20,09; df 89 = 122,9.
const QUI2_LIMITE_F1D = 20.09;
const QUI2_LIMITE_F2D = 122.9;
// Valor que se repete assim tantas vezes é contrato/parcela, não valor
// "natural" — sai da amostra.
const REPETICOES_DE_VALOR_FIXO = 3;
const VALOR_MINIMO_CENTS = 1_000; // R$ 10

export type ResultadoNigrini = {
  digitos: 1 | 2;
  amostra: number;
  mad: number;
  qui2: number;
  naoConforme: boolean;
  excessos: { digito: number; observado: number; esperado: number; desvio: number }[];
};

export function testeBenfordNigrini(valoresCents: number[], digitos: 1 | 2): ResultadoNigrini | null {
  const n = digitos === 1 ? 9 : 90;
  const base = digitos === 1 ? 1 : 10;
  const esperado = Array.from({ length: n }, (_, i) => Math.log10(1 + 1 / (base + i)));
  const observado = new Array<number>(n).fill(0);
  let amostra = 0;
  for (const v of valoresCents) {
    const abs = Math.abs(v);
    if (abs < VALOR_MINIMO_CENTS) continue;
    const s = String(abs);
    if (s.length < digitos) continue;
    const d = Number(s.slice(0, digitos));
    if (d < base) continue;
    observado[d - base]++;
    amostra++;
  }
  if (amostra === 0) return null;
  const proporcao = observado.map((o) => o / amostra);
  const mad = proporcao.reduce((acc, p, i) => acc + Math.abs(p - esperado[i]), 0) / n;
  const qui2 = observado.reduce((acc, o, i) => acc + (o - amostra * esperado[i]) ** 2 / (amostra * esperado[i]), 0);
  const madLimite = digitos === 1 ? MAD_LIMITE_F1D : MAD_LIMITE_F2D;
  const qui2Limite = digitos === 1 ? QUI2_LIMITE_F1D : QUI2_LIMITE_F2D;
  return {
    digitos,
    amostra,
    mad,
    qui2,
    naoConforme: mad > madLimite && qui2 > qui2Limite,
    excessos: proporcao
      .map((p, i) => ({ digito: base + i, observado: p, esperado: esperado[i], desvio: p - esperado[i] }))
      .sort((a, b) => b.desvio - a.desvio)
      .slice(0, 5),
  };
}

// Sem valores fixos recorrentes: o mesmo valor 3+ vezes no segmento.
function semValoresFixos(titulos: OmieTitulo[]): OmieTitulo[] {
  const contagem = new Map<number, number>();
  for (const t of titulos) contagem.set(t.valorDocumentoCents, (contagem.get(t.valorDocumentoCents) ?? 0) + 1);
  return titulos.filter((t) => (contagem.get(t.valorDocumentoCents) ?? 0) < REPETICOES_DE_VALOR_FIXO);
}

function raizDaCategoria(ctx: ContextoAuditoria): (conexaoId: string, codigo: string | null) => string {
  const porChave = new Map(ctx.categorias.map((c) => [`${c.conexaoId}|${c.codigo}`, c]));
  return (conexaoId, codigo) => {
    if (!codigo) return "(sem categoria)";
    let atual = porChave.get(`${conexaoId}|${codigo}`);
    let guarda = 0;
    while (atual?.categoriaSuperior && guarda++ < 10) {
      const acima = porChave.get(`${conexaoId}|${atual.categoriaSuperior}`);
      if (!acima) break;
      atual = acima;
    }
    return atual?.descricao ?? codigo;
  };
}

export function desvioDeBenford(ctx: ContextoAuditoria): AchadoNovo[] {
  const achados: AchadoNovo[] = [];
  const pagos = titulosAtivos(ctx, "PAGAR").filter((t) => t.valorDocumentoCents >= VALOR_MINIMO_CENTS);
  const raiz = raizDaCategoria(ctx);
  const segmentos = agrupar(pagos, (t) => `${t.conexaoApelido}|${raiz(t.conexaoId, t.categoriaCodigo)}`);

  for (const [chave, doSegmento] of segmentos) {
    const [empresa, grupo] = chave.split("|");
    const amostra = semValoresFixos(doSegmento);
    const valores = amostra.map((t) => t.valorDocumentoCents);
    const f1 = valores.length >= MINIMO_F1D ? testeBenfordNigrini(valores, 1) : null;
    const f2 = valores.length >= MINIMO_F2D ? testeBenfordNigrini(valores, 2) : null;
    const disparou = [f1, f2].filter((r): r is ResultadoNigrini => r !== null && r.naoConforme);
    if (disparou.length === 0) continue;

    // Quem mais contribui para os dígitos em excesso do teste mais fino.
    const teste = disparou[disparou.length - 1];
    const digitosEmExcesso = new Set(teste.excessos.filter((e) => e.desvio > 0).slice(0, 3).map((e) => e.digito));
    const contribuintes = agrupar(
      amostra.filter((t) => digitosEmExcesso.has(Number(String(t.valorDocumentoCents).slice(0, teste.digitos)))),
      chaveParceiro
    );
    const principais = [...contribuintes.entries()]
      .map(([, lista]) => ({ fornecedor: nomeParceiro(ctx, lista[0]), titulos: lista.length, valor: somar(lista, (t) => t.valorDocumentoCents) }))
      .sort((a, b) => b.titulos - a.titulos)
      .slice(0, 8);

    achados.push({
      regra: "FR-BENFORD",
      tipo: "ESTADO",
      severidade: "MEDIA",
      categoria: "FRAUDE",
      titulo: `${empresa} · ${grupo}: valores fogem da Lei de Benford (${disparou.map((r) => (r.digitos === 1 ? "1º dígito" : "2 dígitos")).join(" e ")})`,
      descricao:
        `Em ${teste.amostra} títulos do grupo "${grupo}" (sem os valores fixos recorrentes), a distribuição dos ` +
        `${teste.digitos === 1 ? "primeiros dígitos" : "dois primeiros dígitos"} tem MAD ${teste.mad.toFixed(4)} ` +
        `(não conformidade acima de ${teste.digitos === 1 ? MAD_LIMITE_F1D : MAD_LIMITE_F2D}) e qui-quadrado ${teste.qui2.toFixed(1)}. ` +
        `Dígitos em excesso: ${teste.excessos.filter((e) => e.desvio > 0).slice(0, 3).map((e) => `${e.digito} (${fmtPercent(e.observado * 100)} contra ${fmtPercent(e.esperado * 100)})`).join(", ")}. ` +
        `Valores medidos seguem Benford; valores escolhidos, não. A estatística aponta o grupo; os fornecedores da evidência são por onde começar.`,
      recomendacao:
        "Abrir os títulos dos fornecedores listados com os dígitos em excesso e conferir nota, contrato e aprovação. " +
        "Se a explicação for tabela de preço ou parcela fixa, registrar; o teste não considera valores repetidos 3+ vezes, " +
        "então o que sobrou tem outra explicação.",
      dataReferencia: ctx.dataReferencia,
      entidadeTipo: "Categoria",
      entidadeId: chave,
      entidadeRef: `${empresa} · ${grupo}`,
      evidencia: {
        empresa,
        grupo,
        amostra: teste.amostra,
        testes: disparou.map((r) => ({ digitos: r.digitos, mad: Number(r.mad.toFixed(4)), qui2: Number(r.qui2.toFixed(1)) })),
        digitosEmExcesso: teste.excessos.map((e) => ({
          digito: e.digito,
          observadoPercent: Number((e.observado * 100).toFixed(2)),
          esperadoPercent: Number((e.esperado * 100).toFixed(2)),
        })),
        fornecedoresNosDigitosEmExcesso: principais,
      },
      chave: chaveAchado("FR-BENFORD", empresa, grupo, chaveMes(ctx.dataReferencia)),
    });
  }
  return achados;
}

// ---------------------------------------------------------------------------
// FR-KICKBACK-CATEGORIA — um fornecedor toma a categoria enquanto o custo sobe
// ---------------------------------------------------------------------------
// Concentração sem cotação + preço subindo mais que a operação é o desenho
// clássico da comissão por fora: alguém direciona a compra a um fornecedor
// que devolve parte. Comparado em dois trimestres (os 3 primeiros meses e os
// 3 últimos meses inteiros da janela): a fatia do maior fornecedor passa de
// ≤ 40% para ≥ 75% e o total da categoria sobe ≥ 25% enquanto a receita não
// acompanha (cresce menos que a metade disso).
const FATIA_INICIAL_MAXIMA = 0.4;
const FATIA_FINAL_MINIMA = 0.75;
const CRESCIMENTO_MINIMO_DA_CATEGORIA = 0.25;
const MINIMO_DE_FORNECEDORES = 3;

function competencia(d: Date): string {
  return chaveMes(d);
}

export function kickbackPorCategoria(ctx: ContextoAuditoria, materialidade: number): AchadoNovo[] {
  const achados: AchadoNovo[] = [];
  const mesAtual = competencia(ctx.dataReferencia);
  const mesInicial = competencia(ctx.janelaDesde);
  const inteiros = (t: OmieTitulo) => {
    const c = competencia(t.dataEmissao ?? t.dataVencimento);
    return c >= mesInicial && c < mesAtual ? c : null;
  };
  const pagar = titulosAtivos(ctx, "PAGAR").filter((t) => t.parceiroCodigo && inteiros(t));
  const meses = [...new Set(pagar.map((t) => inteiros(t) as string))].sort();
  if (meses.length < 6) return [];
  const primeiros = new Set(meses.slice(0, 3));
  const ultimos = new Set(meses.slice(-3));

  // Receita nos mesmos trimestres, para separar "comprou mais" de "pagou mais caro".
  const receber = titulosAtivos(ctx, "RECEBER").filter((t) => inteiros(t));
  const receitaAntes = somar(receber.filter((t) => primeiros.has(inteiros(t) as string)), (t) => t.valorDocumentoCents);
  const receitaDepois = somar(receber.filter((t) => ultimos.has(inteiros(t) as string)), (t) => t.valorDocumentoCents);
  const crescimentoDaReceita = receitaAntes > 0 ? (receitaDepois - receitaAntes) / receitaAntes : null;

  for (const [chave, doGrupo] of agrupar(pagar, (t) => `${t.conexaoApelido}|${t.categoriaCodigo ?? "-"}|${t.departamentoCodigo ?? "-"}`)) {
    const fornecedores = new Set(doGrupo.map(chaveParceiro));
    if (fornecedores.size < MINIMO_DE_FORNECEDORES) continue;
    const antes = doGrupo.filter((t) => primeiros.has(inteiros(t) as string));
    const depois = doGrupo.filter((t) => ultimos.has(inteiros(t) as string));
    const totalAntes = somar(antes, (t) => t.valorDocumentoCents);
    const totalDepois = somar(depois, (t) => t.valorDocumentoCents);
    if (totalAntes <= 0 || totalDepois < materialidade * 2) continue;
    if ((totalDepois - totalAntes) / totalAntes < CRESCIMENTO_MINIMO_DA_CATEGORIA) continue;

    const fatia = (lista: OmieTitulo[], total: number) => {
      const porFornecedor = [...agrupar(lista, chaveParceiro).entries()].map(([k, l]) => ({ k, valor: somar(l, (t) => t.valorDocumentoCents), t: l[0] }));
      porFornecedor.sort((a, b) => b.valor - a.valor);
      const lider = porFornecedor[0];
      return lider ? { ...lider, fatia: lider.valor / total } : null;
    };
    const liderDepois = fatia(depois, totalDepois);
    if (!liderDepois || liderDepois.fatia < FATIA_FINAL_MINIMA) continue;
    const fatiaAntesDoLider = somar(antes.filter((t) => chaveParceiro(t) === liderDepois.k), (t) => t.valorDocumentoCents) / totalAntes;
    if (fatiaAntesDoLider > FATIA_INICIAL_MAXIMA) continue;
    const crescimentoDaCategoria = (totalDepois - totalAntes) / totalAntes;
    if (crescimentoDaReceita !== null && crescimentoDaReceita >= crescimentoDaCategoria / 2) continue;

    const [empresa] = chave.split("|");
    const categoria = doGrupo[0].categoriaDescricao ?? doGrupo[0].categoriaCodigo ?? "(sem categoria)";
    const nome = nomeParceiro(ctx, liderDepois.t);
    achados.push({
      regra: "FR-KICKBACK-CATEGORIA",
      tipo: "ESTADO",
      severidade: totalDepois >= materialidade * 6 ? "ALTA" : "MEDIA",
      categoria: "FRAUDE",
      titulo: `${nome} passou de ${fmtPercent(fatiaAntesDoLider * 100, 0)} para ${fmtPercent(liderDepois.fatia * 100, 0)} de "${categoria}" (${empresa}) enquanto o custo subiu ${fmtPercent(crescimentoDaCategoria * 100, 0)}`,
      descricao:
        `Nos três primeiros meses da janela a categoria custou ${fmtBRL(totalAntes)} entre ${fornecedores.size} fornecedores; nos três últimos, ` +
        `${fmtBRL(totalDepois)}, com ${fmtPercent(liderDepois.fatia * 100, 0)} num só fornecedor. ` +
        (crescimentoDaReceita === null
          ? "Não há receita na janela para comparar. "
          : `A receita do grupo variou ${fmtPercent(crescimentoDaReceita * 100, 0)} no mesmo período. `) +
        `Concentração sem cotação com o custo subindo mais que a operação é o desenho de comissão por fora — ou de uma consolidação decidida e não registrada.`,
      recomendacao:
        "Localizar a cotação ou a decisão que concentrou a categoria neste fornecedor, e comparar o preço unitário dele com o dos " +
        "fornecedores que saíram. Sem cotação registrada, refazer a cotação agora.",
      valorCents: totalDepois,
      dataReferencia: ctx.dataReferencia,
      entidadeTipo: "OmieParceiro",
      entidadeRef: nome,
      evidencia: {
        empresa,
        categoria,
        departamento: doGrupo[0].departamentoCodigo ?? "—",
        fornecedores: fornecedores.size,
        trimestreInicial: [...primeiros].join(", "),
        trimestreFinal: [...ultimos].join(", "),
        custoAntes: totalAntes,
        custoDepois: totalDepois,
        fatiaDoLiderAntes: fmtPercent(fatiaAntesDoLider * 100, 0),
        fatiaDoLiderDepois: fmtPercent(liderDepois.fatia * 100, 0),
        crescimentoDaReceita: crescimentoDaReceita === null ? "sem base" : fmtPercent(crescimentoDaReceita * 100, 0),
      },
      chave: chaveAchado("FR-KICKBACK-CATEGORIA", chave, liderDepois.k),
    });
  }
  return achados;
}

// Exposto para o teste: mediana é a do comum, reexportada por conveniência.
export { mediana };
