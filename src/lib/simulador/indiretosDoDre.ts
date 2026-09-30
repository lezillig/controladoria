import { LINHAS_DRE } from "@/lib/controladoria/dre";
import type { BaseValor, BaseVigente } from "./baseDeCustos";
import type { DreDosMeses } from "./custosReais";

// OS CUSTOS INDIRETOS DA BASE, VINDOS DO DRE CONSOLIDADO. Enquanto a base não
// tem o valor digitado, cada indireto da aba 4 (administração central) é a
// média mensal da linha do DRE que o representa, nos doze meses fechados, na
// visão do grupo — Azul + MCZ, sem as operações entre elas, com a folha da
// empresa corporativa na linha própria. O que se classifica no DRE passa a
// ser o padrão do simulador; digitar um valor na base continua valendo acima.
//
// Oficina própria não tem linha no DRE (a manutenção está em Despesas com
// veículos, que é custo direto) e fica como está.

export const LINHAS_DOS_INDIRETOS: Record<string, string[]> = {
  folha_adm: ["DESPESA_SALARIOS_CORPORATIVO"],
  contabilidade: ["DESPESA_ADMINISTRATIVA"],
  sistemas: ["DESPESA_INFORMATICA"],
  sede_garagem_sp: ["DESPESA_ESTRUTURA"],
  gerais: ["DESPESA_COMERCIAL", "DESPESA_GERAL"],
  faturamento_medio: ["RECEITA_BRUTA"],
};

export type IndiretoDoDre = {
  // R$ por mês (a unidade da base), média dos meses com receita.
  valor: number;
  fonte: string;
  // As categorias que compõem o valor, as maiores primeiro.
  composicao: { descricao: string; valorMes: number }[];
  linhas: string[];
};

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotuloMes = (chave: string) => {
  const [ano, mes] = chave.split("-");
  return `${MESES[Number(mes) - 1]}/${ano.slice(2)}`;
};

// Média dos meses COM RECEITA: mês antes do início da base (sem título
// nenhum) não pode puxar a média para baixo.
export function indiretosDoDre(dre: DreDosMeses): Map<string, IndiretoDoDre> {
  const resultado = new Map<string, IndiretoDoDre>();
  const receita = dre.linhasDre.RECEITA_BRUTA ?? [];
  const meses = dre.meses.map((_, i) => i).filter((i) => (receita[i] ?? 0) > 0);
  if (meses.length === 0) return resultado;
  const periodo =
    meses.length === 1 ? rotuloMes(dre.meses[meses[0]]) : `${rotuloMes(dre.meses[meses[0]])} a ${rotuloMes(dre.meses[meses[meses.length - 1]])}`;
  const fonte = `DRE consolidado — média de ${meses.length} ${meses.length === 1 ? "mês fechado" : "meses fechados"} (${periodo})`;
  const mediaCents = (valores: number[]) => meses.reduce((a, i) => a + Math.abs(valores[i] ?? 0), 0) / meses.length;

  for (const [chave, linhas] of Object.entries(LINHAS_DOS_INDIRETOS)) {
    const cents = linhas.reduce((a, l) => a + mediaCents(dre.linhasDre[l] ?? []), 0);
    if (!(cents > 0)) continue;
    const composicao = dre.categorias
      .filter((c) => linhas.includes(c.linha))
      .map((c) => ({ descricao: c.descricao, valorMes: Math.round(mediaCents(c.porMesCents)) / 100 }))
      .filter((c) => c.valorMes > 0)
      .sort((a, b) => b.valorMes - a.valorMes);
    resultado.set(chave, {
      valor: Math.round(cents) / 100,
      fonte,
      composicao,
      linhas: linhas.map((l) => LINHAS_DRE.find((x) => x.chave === l)?.rotulo.replace(/^\(-\) |^= /, "") ?? l),
    });
  }
  return resultado;
}

// A base com os indiretos do DRE onde ela não tem valor. Não grava nada: é a
// leitura com que o estudo novo abre. Sem base nenhuma, nasce uma só com eles.
export function baseComIndiretosDoDre(base: BaseVigente, doDre: Map<string, IndiretoDoDre>): BaseVigente;
export function baseComIndiretosDoDre(base: BaseVigente | null, doDre: Map<string, IndiretoDoDre>): BaseVigente | null;
export function baseComIndiretosDoDre(base: BaseVigente | null, doDre: Map<string, IndiretoDoDre>): BaseVigente | null {
  if (doDre.size === 0) return base;
  const parametros = new Map<string, BaseValor>(base?.parametros ?? []);
  for (const [chave, v] of doDre) {
    if (parametros.get(chave)?.valor != null) continue;
    parametros.set(chave, { valor: v.valor, texto: null, fonte: v.fonte, vigenciaInicio: new Date() });
  }
  return base ? { ...base, parametros } : { em: new Date(), parametros, veiculos: [], funcoes: [], pedagios: [] };
}
