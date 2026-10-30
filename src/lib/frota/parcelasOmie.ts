import { prisma } from "@/lib/prisma";
import { lerNumeroParcela } from "./financiamentos";
import { lerContratos } from "./contratosDaGestao";

// AS PARCELAS DOS CONTRATOS NA OMIE — cada título das contas a pagar do banco
// ou da administradora ligado ao contrato ou à cota a que pertence. Com a
// ligação, as parcelas pagas (e a data da baixa), as em aberto e o saldo de
// cada contrato — e de cada veículo — passam a vir da Omie, sem ninguém
// atualizar planilha. Os contratos são os da gestão (contratosDaGestao.ts);
// a ligação fica aqui, pelo id do contrato lá.
//
// QUEM É O BANCO NA OMIE: o parceiro (fornecedor) cujo nome tem a palavra da
// instituição (MONEO, RCI, SANTANDER, ITAU, STELLANTIS, BRADESCO, BRASIL,
// MERCABENCO, CNP/CAIXA) e é administradora de consórcio quando o contrato é
// consórcio (e não é, quando é banco). A sugestão é gravada; o financeiro
// confirma ou corrige na tela.
//
// COMO UM TÍTULO ACHA O CONTRATO, nesta ordem:
//   1. o número do contrato no número do documento do título;
//   2. o grupo e a cota no documento (consórcio);
//   3. o valor da parcela (±1% ou R$ 1) e o dia do vencimento (±5 dias),
//      dentro do prazo do contrato. Cotas iguais (mesmo valor, mesmo dia)
//      recebem um título cada por mês — para contar parcelas pagas, dá no
//      mesmo qual cota recebeu qual.
// O que foi ligado à mão (criterio = manual) não é refeito.

const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
const PALAVRAS_GENERICAS = new Set(["BANCO", "BCO", "SA", "S/A", "S.A", "S.A.", "DE", "DO", "DA", "DOS", "E", "CONSORCIO", "CONSORCIOS", "FINANCIAMENTOS", "FINANCIAMENTO", "ADMINISTRADORA", "ADM", "LTDA", "BRASIL", "CREDITO", "FINANCEIRA", "ARRENDAMENTO", "MERCANTIL", "(CAIXA)", "CAIXA"]);
const ALIAS: Record<string, string[]> = { ITAUCARD: ["ITAU"], BB: ["BRASIL"], CNP: ["CNP", "CAIXA"], "BB CONSÓRCIOS": ["BRASIL"] };

export function palavrasDaInstituicao(instituicao: string): string[] {
  const n = sem(instituicao);
  if (/\bBB\b|BANCO DO BRASIL/.test(n)) return ["BB", "BRASIL"];
  if (/CNP|CAIXA/.test(n)) return ["CNP", "CAIXA"];
  const palavras = n.split(/[^A-Z0-9]+/).filter((p) => p.length >= 2 && !PALAVRAS_GENERICAS.has(p));
  return [...new Set(palavras.flatMap((p) => ALIAS[p] ?? [p]))];
}

const EH_ADMINISTRADORA = /CONSORC|ADMINISTRADORA DE CONS/;
// "STELLANTIS AUTOMÓVEIS", "RENAULT DO BRASIL": quem vendeu o veículo, não o banco.
const EH_REVENDA = /AUTOMOVE|VEICULO|MOTORS|DISTRIBUI|CONCESSION|COMERCIO|PECAS|IMPORTAD/;

export function parceiroCombina(nome: string, palavras: string[], consorcio: boolean): boolean {
  const n = sem(nome);
  if (!palavras.some((p) => new RegExp(`\\b${p}`).test(n))) return false;
  if (consorcio) return EH_ADMINISTRADORA.test(n) || /CNP|MERCABENCO/.test(n);
  return !EH_ADMINISTRADORA.test(n) && !EH_REVENDA.test(n);
}

type Contrato = {
  id: string;
  instituicao: string;
  produto: string;
  contratoNumero: string | null;
  grupo: string | null;
  cota: string | null;
  valorParcelaCents: bigint | number | null;
  vencimentoDia: number | null;
  parcelas: number | null;
  dataInicio: Date | null;
  dataFinal: Date | null;
};
type Titulo = { id: string; numeroDocumento: string | null; numeroParcela: string | null; dataVencimento: Date; valorDocumentoCents: number };
export type Ligacao = { tituloId: string; financiamentoId: string; numeroParcela: number | null; criterio: "contrato" | "cota" | "valor" };

const digitos = (s: string | null) => (s ?? "").replace(/\D/g, "");
const DIA = 86_400_000;

// A ligação, pura: títulos de UMA instituição e produto × os contratos dela.
export function ligarTitulos(contratos: Contrato[], titulos: Titulo[]): { ligacoes: Ligacao[]; sobras: number } {
  const ligacoes: Ligacao[] = [];
  const livres: Titulo[] = [];
  for (const t of titulos) {
    const doc = digitos(t.numeroDocumento);
    let achado: { c: Contrato; criterio: Ligacao["criterio"] } | null = null;
    if (doc.length >= 5) {
      const porContrato = contratos.filter((c) => {
        const n = digitos(c.contratoNumero);
        return n.length >= 5 && (doc.includes(n) || n.includes(doc));
      });
      if (porContrato.length === 1) achado = { c: porContrato[0], criterio: "contrato" };
    }
    if (!achado && t.numeroDocumento) {
      const nums = (t.numeroDocumento.match(/\d+/g) ?? []).map(Number);
      const porCota = contratos.filter((c) => c.grupo && c.cota && nums.includes(Number(c.grupo)) && nums.includes(Number(c.cota)));
      if (porCota.length === 1) achado = { c: porCota[0], criterio: "cota" };
    }
    if (achado) ligacoes.push({ tituloId: t.id, financiamentoId: achado.c.id, numeroParcela: lerNumeroParcela(t.numeroParcela)?.n ?? null, criterio: achado.criterio });
    else livres.push(t);
  }
  // Pelo valor e pelo dia, mês a mês.
  const ocupado = new Set(ligacoes.map((l) => `${l.financiamentoId}|${mesDe(titulos.find((t) => t.id === l.tituloId)!.dataVencimento)}`));
  const candidatos = (t: Titulo) =>
    contratos
      .filter((c) => {
        if (c.valorParcelaCents === null) return false;
        const p = Number(c.valorParcelaCents);
        if (Math.abs(t.valorDocumentoCents - p) > Math.max(100, Math.round(p * 0.01))) return false;
        if (c.vencimentoDia !== null) {
          const dia = t.dataVencimento.getUTCDate();
          const fimDoMes = new Date(Date.UTC(t.dataVencimento.getUTCFullYear(), t.dataVencimento.getUTCMonth() + 1, 0)).getUTCDate();
          const esperado = Math.min(c.vencimentoDia, fimDoMes);
          // Vencimento em fim de semana/feriado rola alguns dias.
          if (Math.abs(dia - esperado) > 5 && Math.abs(dia - esperado) < fimDoMes - 5) return false;
        }
        if (c.dataInicio && t.dataVencimento.getTime() < c.dataInicio.getTime() - 45 * DIA) return false;
        if (c.dataFinal && t.dataVencimento.getTime() > c.dataFinal.getTime() + 45 * DIA) return false;
        const np = lerNumeroParcela(t.numeroParcela);
        if (np?.total && c.parcelas && np.total !== c.parcelas) return false;
        return true;
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  let sobras = 0;
  for (const t of livres.sort((a, b) => a.dataVencimento.getTime() - b.dataVencimento.getTime() || a.id.localeCompare(b.id))) {
    const mes = mesDe(t.dataVencimento);
    const c = candidatos(t).find((x) => !ocupado.has(`${x.id}|${mes}`));
    if (!c) {
      sobras++;
      continue;
    }
    ocupado.add(`${c.id}|${mes}`);
    ligacoes.push({ tituloId: t.id, financiamentoId: c.id, numeroParcela: lerNumeroParcela(t.numeroParcela)?.n ?? null, criterio: "valor" });
  }
  return { ligacoes, sobras };
}
const mesDe = (d: Date) => `${d.getUTCFullYear()}-${d.getUTCMonth()}`;

export type ResultadoConciliacao = {
  grupos: { instituicao: string; produto: string; parceiros: string[]; contratos: number; titulos: number; ligados: number; sobras: number }[];
  semParceiro: string[];
  ligacoes: number;
  // A gestão não respondeu: nada foi refeito (as ligações de ontem ficam).
  gestaoIndisponivel?: boolean;
};

export async function conciliarParcelasOmie(companyId: string): Promise<ResultadoConciliacao> {
  const resultado: ResultadoConciliacao = { grupos: [], semParceiro: [], ligacoes: 0 };
  const lidos = await lerContratos(companyId);
  if (!lidos) return { ...resultado, gestaoIndisponivel: true };
  const contratos: Contrato[] = lidos;
  if (contratos.length === 0) return resultado;

  // 1. Quem é cada instituição na Omie: sugere o que falta.
  const grupos = new Map<string, Contrato[]>();
  for (const c of contratos) grupos.set(`${c.instituicao}|${c.produto}`, [...(grupos.get(`${c.instituicao}|${c.produto}`) ?? []), c]);
  const parceiros = await prisma.omieParceiro.findMany({ where: { companyId, ehFornecedor: true }, select: { conexaoId: true, codigoOmie: true, nome: true, nomeFantasia: true } });
  const vinculos = await prisma.frotaInstituicaoParceiro.findMany({ where: { companyId } });
  const sugestoes = [];
  for (const chave of grupos.keys()) {
    const [instituicao, produto] = chave.split("|");
    if (vinculos.some((v) => v.instituicao === instituicao && v.produto === produto)) continue;
    const palavras = palavrasDaInstituicao(instituicao);
    for (const p of parceiros) {
      if (parceiroCombina(`${p.nome} ${p.nomeFantasia ?? ""}`, palavras, produto === "consorcio")) {
        sugestoes.push({ companyId, instituicao, produto, conexaoId: p.conexaoId, parceiroCodigo: p.codigoOmie, parceiroNome: p.nome, confirmado: false });
      }
    }
  }
  if (sugestoes.length) await prisma.frotaInstituicaoParceiro.createMany({ data: sugestoes, skipDuplicates: true });
  const todos = await prisma.frotaInstituicaoParceiro.findMany({ where: { companyId } });

  // 2. Os títulos de cada instituição, ligados aos contratos dela.
  const manuais = new Set((await prisma.frotaParcelaOmie.findMany({ where: { companyId, criterio: "manual" }, select: { tituloId: true } })).map((m) => m.tituloId));
  const novas: Ligacao[] = [];
  for (const [chave, lista] of grupos) {
    const [instituicao, produto] = chave.split("|");
    const deles = todos.filter((v) => v.instituicao === instituicao && v.produto === produto && !v.rejeitado);
    if (deles.length === 0) {
      resultado.semParceiro.push(`${instituicao} (${produto})`);
      continue;
    }
    const inicio = lista.reduce<Date | null>((m, c) => (c.dataInicio && (!m || c.dataInicio < m) ? c.dataInicio : m), null);
    const titulos = await prisma.omieTitulo.findMany({
      where: {
        companyId,
        natureza: "PAGAR",
        cancelado: false,
        OR: deles.map((d) => ({ conexaoId: d.conexaoId, parceiroCodigo: d.parceiroCodigo })),
        ...(inicio ? { dataVencimento: { gte: new Date(inicio.getTime() - 60 * DIA) } } : {}),
      },
      select: { id: true, numeroDocumento: true, numeroParcela: true, dataVencimento: true, valorDocumentoCents: true },
    });
    const { ligacoes, sobras } = ligarTitulos(lista, titulos.filter((t) => !manuais.has(t.id)));
    novas.push(...ligacoes);
    resultado.grupos.push({ instituicao, produto, parceiros: [...new Set(deles.map((d) => d.parceiroNome ?? d.parceiroCodigo))], contratos: lista.length, titulos: titulos.length, ligados: ligacoes.length, sobras });
  }

  // 3. Grava: refaz as automáticas, mantém as manuais.
  await prisma.$transaction([
    prisma.frotaParcelaOmie.deleteMany({ where: { companyId, criterio: { not: "manual" } } }),
    prisma.frotaParcelaOmie.createMany({ data: novas.map((l) => ({ companyId, ...l })), skipDuplicates: true }),
  ]);
  resultado.ligacoes = novas.length;
  return resultado;
}
