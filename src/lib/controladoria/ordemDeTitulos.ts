import type { OmieTitulo } from "@prisma/client";
import { emAberto, saldoAberto } from "./agents/comum";

// A ORDEM E A BUSCA DA LISTA DE TÍTULOS (contas a pagar e a receber).
//
// A lista vinha sempre por vencimento, e mostra no máximo 300 linhas. Com o
// filtro "Com encargos" isso punha no topo o título mais antigo — encargo de
// um centavo — e deixava o maior, que é o que interessa, perdido no meio ou
// fora das 300. Quem lê quer escolher: maior ou menor, por qual coluna, e
// achar um cliente pelo nome. A ordem vem ANTES do corte das 300, para o
// "maior primeiro" mostrar de fato os maiores.
//
// Tudo pela URL (`ordem`, `dir`, `busca`), como os demais filtros da tela:
// o endereço copiado abre a mesma lista.

export const COLUNAS_DE_ORDEM = ["parceiro", "documento", "vencimento", "valor", "saldo", "encargos", "situacao"] as const;
export type ColunaDeOrdem = (typeof COLUNAS_DE_ORDEM)[number];
export type Direcao = "asc" | "desc";
export type Ordem = { coluna: ColunaDeOrdem; direcao: Direcao };

// A direção do primeiro clique em cada coluna: dinheiro começa do maior (é a
// pergunta de quem clica em "Encargos"); data e texto, do começo.
export const DIRECAO_INICIAL: Record<ColunaDeOrdem, Direcao> = {
  parceiro: "asc",
  documento: "asc",
  vencimento: "asc",
  valor: "desc",
  saldo: "desc",
  encargos: "desc",
  situacao: "asc",
};

export const ORDEM_PADRAO: Ordem = { coluna: "vencimento", direcao: "asc" };

/** A ordem pedida na URL; o que não for uma coluna conhecida cai na padrão. */
export function lerOrdem(ordem: string | undefined, dir: string | undefined): Ordem {
  const coluna = COLUNAS_DE_ORDEM.find((c) => c === ordem);
  if (!coluna) return ORDEM_PADRAO;
  return { coluna, direcao: dir === "asc" || dir === "desc" ? dir : DIRECAO_INICIAL[coluna] };
}

/** O clique no título de uma coluna: a que já ordena inverte; outra começa na direção dela. */
export function proximaOrdem(atual: Ordem, coluna: ColunaDeOrdem): Ordem {
  if (atual.coluna !== coluna) return { coluna, direcao: DIRECAO_INICIAL[coluna] };
  return { coluna, direcao: atual.direcao === "asc" ? "desc" : "asc" };
}

export const encargosDoTitulo = (t: Pick<OmieTitulo, "jurosCents" | "multaCents" | "tarifaCents">) => t.jurosCents + t.multaCents + t.tarifaCents;

const texto = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

// O valor que cada coluna ordena. `null` é o que a tela mostra como "—"
// (título pago não tem saldo; título sem encargo não tem encargo) e vai
// SEMPRE para o fim, nas duas direções: "menor encargo primeiro" quer o menor
// encargo que existe, não uma página de travessões.
function chave(t: OmieTitulo, coluna: ColunaDeOrdem): number | string | null {
  switch (coluna) {
    case "parceiro":
      return t.parceiroNome?.trim() || null;
    case "documento":
      return t.numeroDocumento?.trim() || null;
    case "vencimento":
      return t.dataVencimento.getTime();
    case "valor":
      return t.valorDocumentoCents;
    case "saldo":
      return emAberto(t) ? saldoAberto(t) : null;
    case "encargos":
      return encargosDoTitulo(t) > 0 ? encargosDoTitulo(t) : null;
    case "situacao":
      return t.status?.trim() || null;
  }
}

export function ordenarTitulos<T extends OmieTitulo>(lista: T[], ordem: Ordem): T[] {
  const sinal = ordem.direcao === "asc" ? 1 : -1;
  return [...lista].sort((a, b) => {
    const ka = chave(a, ordem.coluna);
    const kb = chave(b, ordem.coluna);
    if (ka === null || kb === null) {
      if (ka !== kb) return ka === null ? 1 : -1;
    } else {
      const c = typeof ka === "number" && typeof kb === "number" ? ka - kb : texto.compare(String(ka), String(kb));
      if (c !== 0) return c * sinal;
    }
    // Empate: o vencimento mais antigo primeiro, e o id para a ordem não
    // mudar de uma carga da página para a outra.
    return a.dataVencimento.getTime() - b.dataVencimento.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const soDigitos = (s: string) => s.replace(/\D/g, "");

/** A busca aparada e limitada, como vai para a URL e para a tela. */
export function lerBusca(busca: string | undefined): string {
  return (busca ?? "").trim().slice(0, 80);
}

/**
 * Os títulos cujo cliente ou fornecedor (nome ou CNPJ/CPF) ou número do
 * documento contém o que foi digitado. Nome sem acento e sem caixa; o CNPJ
 * casa com ou sem pontuação. Busca vazia devolve a lista inteira.
 */
export function filtrarPorBusca<T extends OmieTitulo>(lista: T[], busca: string): T[] {
  const termo = semAcento(lerBusca(busca));
  if (!termo) return lista;
  const digitos = soDigitos(termo);
  // Só trata como documento o que foi digitado só com número e pontuação:
  // "posto 7" não pode casar com todo CNPJ que tenha um 7.
  const pareceDocumento = digitos.length >= 3 && /^[\d.\-/\s]+$/.test(termo);
  return lista.filter((t) => {
    if (t.parceiroNome && semAcento(t.parceiroNome).includes(termo)) return true;
    if (t.numeroDocumento && semAcento(t.numeroDocumento).includes(termo)) return true;
    return pareceDocumento && Boolean(t.parceiroDocumento) && soDigitos(t.parceiroDocumento as string).includes(digitos);
  });
}

export const ROTULO_DA_ORDEM: Record<ColunaDeOrdem, Record<Direcao, string>> = {
  parceiro: { asc: "nome, de A a Z", desc: "nome, de Z a A" },
  documento: { asc: "documento, do menor ao maior", desc: "documento, do maior ao menor" },
  vencimento: { asc: "vencimento, do mais antigo ao mais novo", desc: "vencimento, do mais novo ao mais antigo" },
  valor: { asc: "valor, do menor ao maior", desc: "valor, do maior ao menor" },
  saldo: { asc: "saldo, do menor ao maior", desc: "saldo, do maior ao menor" },
  encargos: { asc: "encargos, do menor ao maior", desc: "encargos, do maior ao menor" },
  situacao: { asc: "situação, de A a Z", desc: "situação, de Z a A" },
};
