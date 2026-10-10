import { diferenca } from "./disputa";

// O HISTÓRICO DE EDITAIS — a conta, sem banco (a tela busca, aqui se soma).
//
// Cada estudo é um edital (ou proposta) analisado. Do resultado saem as três
// perguntas do histórico: quanto ganhamos (taxa de vitória por serviço), a
// que distância do vencedor ficamos (nosso preço ÷ vencedor) e quem são os
// concorrentes (quantas vezes aparecem, quantas ganham, e o preço deles
// contra o nosso no mesmo edital — razão sem unidade, comparável entre
// serviços pagos por km, veículo-mês ou diária).

export type EditalDoHistorico = {
  id: string;
  nome: string;
  orgao: string | null;
  numeroEdital: string | null;
  tipoServico: string;
  esfera: string;
  status: string;
  dataSessao: Date | null;
  unidade: string;
  // O nosso preço: o da linha da Azul na disputa, senão o da versão lançada
  // (ou da última).
  nossoPreco: number | null;
  precoVencedor: number | null;
  vencedor: string | null;
  posicao: number | null;
  // O menor preço máximo dos itens (na unidade do contrato).
  teto: number | null;
  valorTotalMaximo: number | null;
  participantes: { empresa: string; preco: number | null; situacao: string; ehNossa: boolean }[];
  arquivos: number;
};

export type LinhaDoHistorico = EditalDoHistorico & {
  // Nosso preço ÷ vencedor − 1 (positivo = ficamos acima).
  nossoSobreVencedor: number | null;
  // Desconto do vencedor sobre o teto (positivo = abaixo do teto).
  descontoVencedor: number | null;
};

export type ResumoPorServico = { servico: string; editais: number; decididos: number; ganhos: number; taxa: number | null; nossoSobreVencedorMedio: number | null };
export type Concorrente = { empresa: string; disputas: number; vitorias: number; ultimaSessao: Date | null; servicos: string[]; precoSobreONossoMedio: number | null };

const DECIDIDOS = new Set(["GANHO", "PERDIDO", "EM_EXECUCAO", "ENCERRADO"]);
const GANHOS = new Set(["GANHO", "EM_EXECUCAO", "ENCERRADO"]);
const media = (l: number[]) => (l.length > 0 ? l.reduce((a, x) => a + x, 0) / l.length : null);
// A mesma empresa escrita de jeitos diferentes na ata ("Viação X Ltda." e
// "VIACAO X LTDA") conta como uma só.
export const chaveDaEmpresa = (nome: string) =>
  nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\b(LTDA|EIRELI|ME|EPP|S\/?A|SA)\b\.?/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();

export function montarHistorico(editais: EditalDoHistorico[]) {
  const linhas: LinhaDoHistorico[] = editais.map((e) => ({
    ...e,
    // Só quando outro venceu: na vitória a distância é zero e não diz nada.
    nossoSobreVencedor: e.vencedor && e.posicao !== 1 && !GANHOS.has(e.status) ? diferenca(e.nossoPreco, e.precoVencedor) : null,
    descontoVencedor: e.teto && e.precoVencedor ? -(diferenca(e.precoVencedor, e.teto) ?? 0) : null,
  }));

  const decididos = linhas.filter((l) => DECIDIDOS.has(l.status));
  const ganhos = decididos.filter((l) => GANHOS.has(l.status));
  const resumo = {
    editais: linhas.length,
    decididos: decididos.length,
    ganhos: ganhos.length,
    taxa: decididos.length > 0 ? ganhos.length / decididos.length : null,
    nossoSobreVencedorMedio: media(linhas.map((l) => l.nossoSobreVencedor).filter((x): x is number => x !== null)),
    descontoVencedorMedio: media(linhas.map((l) => l.descontoVencedor).filter((x): x is number => x !== null)),
  };

  const servicos = [...new Set(linhas.map((l) => l.tipoServico))];
  const porServico: ResumoPorServico[] = servicos.map((s) => {
    const doServico = linhas.filter((l) => l.tipoServico === s);
    const d = doServico.filter((l) => DECIDIDOS.has(l.status));
    const g = d.filter((l) => GANHOS.has(l.status));
    return {
      servico: s,
      editais: doServico.length,
      decididos: d.length,
      ganhos: g.length,
      taxa: d.length > 0 ? g.length / d.length : null,
      nossoSobreVencedorMedio: media(doServico.map((l) => l.nossoSobreVencedor).filter((x): x is number => x !== null)),
    };
  });

  // Concorrentes: cada empresa que não é a Azul, somada pela chave do nome.
  const mapa = new Map<string, Concorrente & { razoes: number[] }>();
  for (const l of linhas) {
    for (const p of l.participantes) {
      if (p.ehNossa || !p.empresa.trim()) continue;
      const k = chaveDaEmpresa(p.empresa);
      const c = mapa.get(k) ?? { empresa: p.empresa.trim(), disputas: 0, vitorias: 0, ultimaSessao: null, servicos: [], precoSobreONossoMedio: null, razoes: [] };
      c.disputas++;
      if (p.situacao === "VENCEDORA") c.vitorias++;
      if (l.dataSessao && (!c.ultimaSessao || l.dataSessao > c.ultimaSessao)) c.ultimaSessao = l.dataSessao;
      if (!c.servicos.includes(l.tipoServico)) c.servicos.push(l.tipoServico);
      const r = diferenca(p.preco, l.nossoPreco);
      if (r !== null) c.razoes.push(r);
      mapa.set(k, c);
    }
  }
  const concorrentes: Concorrente[] = [...mapa.values()]
    .map(({ razoes, ...c }) => ({ ...c, precoSobreONossoMedio: media(razoes) }))
    .sort((a, b) => b.vitorias - a.vitorias || b.disputas - a.disputas || a.empresa.localeCompare(b.empresa));

  return { linhas, resumo, porServico, concorrentes };
}
