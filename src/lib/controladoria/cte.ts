import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tabela } from "@/lib/esquemaDoBanco";
import { competenciaSql } from "./competencia";
import type { Periodo } from "./periodos";

// CONFERÊNCIA DE CT-e — o documento fiscal que o espelho não alcança.
//
// A Omie não expõe listagem de CT-e emitido pela API; foram cinco grafias de
// método recusadas antes de eu parar de chutar. O que ela expõe é a TELA, e a
// tela exporta. Então a conferência entra pelo mesmo caminho da consultoria:
// a pessoa cola a relação, o sistema casa com o que está espelhado e aponta os
// dois lados.
//
// ISTO NÃO É UM REMENDO ATÉ SAIR O ENDPOINT. Mesmo com endpoint, a conferência
// seria a mesma: documento fiscal de um lado, cobrança do outro, e a pergunta
// "onde os dois não se encontram". O que mudaria é só quem digita.
//
// ---------------------------------------------------------------------------
// O QUE A CONFERÊNCIA À MÃO ACHOU, E QUE MOTIVA CADA REGRA DAQUI
//
// Cem CT-e de abril a agosto de 2026, cruzados com os títulos:
//
//   46 casaram certo.
//    5 CANCELADOS com título vivo — R$ 164.661,33. Todos seguem o mesmo
//      padrão: o CT-e foi cancelado e reemitido, e na Omie o título continuou
//      colado no documento morto. Num deles o substituto saiu R$ 7.617,65 mais
//      barato e o título ficou com o valor antigo — cobrança acima do que o
//      documento fiscal autoriza, na CAJAMAR, que já é o maior atraso da base.
//    4 AUTORIZADOS nunca cobrados — R$ 11.950,00, o mais antigo parado desde
//      abril. Documento emitido, imposto devido, cliente sem receber a fatura.
//
// Nada disso apareceu sozinho: apareceu porque o usuário colou uma lista no
// chat. É o tipo de achado que um módulo de auditoria existe para pegar e
// estava deixando passar todo mês.
// ---------------------------------------------------------------------------

export type CteDaLista = {
  numero: string;
  data: Date;
  valorCents: number;
  tomador: string;
  cancelado: boolean;
};

export type LinhaConferencia = {
  tipo:
    | "casado"
    | "cancelado_com_titulo"
    | "autorizado_sem_titulo"
    | "titulo_sem_cte"
    | "valor_divergente";
  numero: string | null;
  data: Date | null;
  valorCteCents: number | null;
  valorTituloCents: number | null;
  tomador: string;
  situacaoTitulo: string | null;
  // Como o casamento foi feito. "valor+data" é mais fraco que "número", e a
  // tela precisa dizer isso: 43% dos títulos de CT-e estão sem o número
  // preenchido na Omie, e dois CT-e de mesmo valor no mesmo dia são
  // indistinguíveis por esse caminho.
  casadoPor: "número" | "valor+data" | null;
};

export type ResultadoConferencia = {
  lidos: number;
  autorizados: number;
  cancelados: number;
  titulosNoPeriodo: number;
  casados: number;
  linhas: LinhaConferencia[];
  // Somas que a tela mostra em destaque: são elas que dizem se vale a pena
  // parar o que se está fazendo.
  canceladoComTituloCents: number;
  autorizadoSemTituloCents: number;
  divergenciaDeValorCents: number;
  // Quantos títulos do período estão sem o número do documento fiscal. É a
  // causa-raiz de a conferência precisar cair no casamento por valor.
  titulosSemNumero: number;
};

// LEITURA TOLERANTE DA LISTA COLADA.
//
// Duas formas já apareceram, das duas telas da Omie:
//
//   Data | Status | CTE | CFOP | Tipo | Tomador (CNPJ/CPF) | Tomador (Razão Social) | Total Frete
//   Nº | Data | Tomador | Valor | Status
//
// Exigir um formato exigiria que a pessoa arrumasse a planilha antes — e quem
// arruma planilha à mão erra, ou desiste. O leitor descobre as colunas pelo
// cabeçalho, aceita tabulação, ponto e vírgula ou vírgula como separador, e
// diz o que não entendeu em vez de engolir.
const COLUNAS: Record<keyof Omit<CteDaLista, "cancelado"> | "status", string[]> = {
  numero: ["cte", "ct-e", "no", "n", "numero", "número", "num", "documento"],
  data: ["data", "emissao", "emissão", "dataemissao", "datadeemissao"],
  valorCents: ["valor", "totalfrete", "total", "valortotal", "vlr", "valordoct-e"],
  tomador: ["tomador", "tomadorrazaosocial", "razaosocial", "cliente", "destinatario"],
  status: ["status", "situacao", "situação"],
};

function normalizar(cabecalho: string): string {
  return cabecalho
    .normalize("NFD")
    // \u0300-\u036f: as marcas de acento que o NFD separa da letra. Por
    // código, nunca por caractere literal — combinante solto dentro de classe
    // depende de como o arquivo foi salvo, e vira SyntaxError em execução.
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

function separador(linha: string): string {
  if (linha.includes("\t")) return "\t";
  if (linha.includes(";")) return ";";
  return ",";
}

// Valor em formato brasileiro. "209.582,10" -> 20958210 centavos.
function paraCentavos(texto: string): number | null {
  const limpo = texto.replace(/[^\d.,-]/g, "").trim();
  if (limpo === "") return null;
  const n = Number(limpo.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function paraData(texto: string): Date | null {
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(texto.trim());
  if (br) return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto.trim());
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  return null;
}

export function lerListaDeCte(texto: string): { itens: CteDaLista[]; ignoradas: string[] } {
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (linhas.length === 0) return { itens: [], ignoradas: [] };

  // O cabeçalho é a primeira linha que reconhece pelo menos número e valor.
  // Procurar em vez de assumir a primeira: a tela da Omie costuma vir com
  // linhas de filtro antes ("01/01/2026", "Todos") que não são dado nem
  // cabeçalho.
  let indiceCabecalho = -1;
  let mapa: Partial<Record<keyof typeof COLUNAS, number>> = {};
  for (let i = 0; i < Math.min(linhas.length, 10); i++) {
    const partes = linhas[i].split(separador(linhas[i])).map(normalizar);
    const tentativa: Partial<Record<keyof typeof COLUNAS, number>> = {};
    for (const [campo, nomes] of Object.entries(COLUNAS) as [keyof typeof COLUNAS, string[]][]) {
      const pos = partes.findIndex((p) => p !== "" && nomes.includes(p));
      if (pos >= 0) tentativa[campo] = pos;
    }
    if (tentativa.numero !== undefined && tentativa.valorCents !== undefined) {
      indiceCabecalho = i;
      mapa = tentativa;
      break;
    }
  }
  if (indiceCabecalho < 0) return { itens: [], ignoradas: ["Não encontrei o cabeçalho com as colunas de número e valor."] };

  const sep = separador(linhas[indiceCabecalho]);
  const itens: CteDaLista[] = [];
  const ignoradas: string[] = [];

  for (const linha of linhas.slice(indiceCabecalho + 1)) {
    const partes = linha.split(sep).map((p) => p.trim().replace(/^"|"$/g, ""));
    const pegar = (campo: keyof typeof COLUNAS) => {
      const pos = mapa[campo];
      return pos === undefined ? "" : (partes[pos] ?? "");
    };

    const numero = pegar("numero").trim();
    const data = paraData(pegar("data"));
    const valorCents = paraCentavos(pegar("valorCents"));
    if (soDigitos(numero) === "" || !data || valorCents === null) {
      // Linha de rodapé, de total ou de filtro. Reportada, não engolida: uma
      // linha de dado descartada em silêncio vira um CT-e que "não existe".
      ignoradas.push(linha.slice(0, 120));
      continue;
    }

    itens.push({
      numero,
      data,
      valorCents,
      tomador: pegar("tomador") || "(sem tomador)",
      // Mesma lição do status da NFS-e: "Cancelamento Rejeitado" contém a
      // palavra e significa o contrário. Ver `notaCancelada` em mapping.ts.
      cancelado: /cancel/i.test(pegar("status")) && !/rejeitad|negad|recusad/i.test(pegar("status")),
    });
  }

  return { itens, ignoradas };
}

export type TituloCte = {
  id: string;
  numero: string | null;
  data: Date;
  valorCents: number;
  situacao: string;
  cancelado: boolean;
  parceiro: string | null;
  tipo: string | null;
};

// O TIPO DO DOCUMENTO NA OMIE NÃO É CONFIÁVEL, E ISSO MUDA O DESENHO.
//
// A primeira versão desta consulta filtrava `tipoDocumento IN ('CTE','CT-E',
// 'CTRC')`. O usuário derrubou a regra com uma tela: o CT-e 1279 tem título na
// Omie, e mesmo assim a conferência o apontou como não cobrado — porque o tipo
// do título não dizia CT-e. No mesmo cliente, mês a mês, o mesmo frete de
// R$ 26.627,09 aparece ora com o número em "Número do Documento", ora em "Nota
// Fiscal", ora em nenhum dos dois.
//
// Filtrar por um campo assim é decidir de antemão o que não vai ser conferido —
// e o que escapa do filtro escapa em silêncio, parecendo achado. Então o tipo
// deixou de ser filtro e virou preferência: ele desempata o casamento fraco e
// decide quais títulos podem sobrar como "sem CT-e", mas nunca esconde um
// título de um casamento por número.
export function ehTipoCte(tipo: string | null): boolean {
  return ["CTE", "CT-E", "CTRC"].includes((tipo ?? "").trim().toUpperCase());
}

// Janela do casamento fraco: um título emitido dias depois do CT-e ainda é o
// mesmo frete. Sete dias é o que a conferência à mão precisou — abaixo disso
// casos reais desta base ficavam de fora, acima disso começam a casar fretes
// diferentes do mesmo cliente pelo mesmo valor.
export const DIAS_DE_TOLERANCIA = 7;

export async function conferirCte(params: {
  companyId: string;
  conexaoId?: string | null;
  periodo: Periodo;
  lista: CteDaLista[];
}): Promise<ResultadoConferencia> {
  const { companyId, conexaoId, periodo, lista } = params;
  if (lista.length === 0) return cruzarCte([], []);

  // Sem o filtro de tipo, "todos os títulos a receber do período" seriam
  // dezenas de milhares num ano. O recorte que substitui o filtro é o da
  // própria lista: interessa o título que É CT-e, o que carrega um dos números
  // colados, ou o que tem exatamente um dos valores colados. Fora disso não há
  // como casar com nada mesmo.
  //
  // `substring(... from '[0-9]+')` + `ltrim('0')` reproduz em SQL o mesmo
  // `soDigitos` do casamento: "CTE 001279" e "1279/2" precisam virar "1279" dos
  // dois lados, ou o recorte deixaria de fora justamente o título que se quer
  // achar.
  const numeros = [...new Set(lista.map((c) => soDigitos(c.numero)).filter((n) => n !== ""))];
  const valores = [...new Set(lista.map((c) => c.valorCents))];

  const titulos = await prisma.$queryRaw<TituloCte[]>`
    SELECT t.id,
           NULLIF(TRIM(t."numeroDocumento"), '') AS numero,
           ${competenciaSql("t")} AS data,
           t."valorDocumentoCents" AS "valorCents",
           t.status AS situacao,
           t.cancelado,
           t."parceiroNome" AS parceiro,
           t."tipoDocumento" AS tipo
      FROM ${tabela("OmieTitulo")} t
     WHERE t."companyId" = ${companyId}
       AND t.natureza::text = 'RECEBER'
       AND ${competenciaSql("t")} >= ${periodo.inicio}
       AND ${competenciaSql("t")} <= ${periodo.fim}
       ${conexaoId ? Prisma.sql`AND t."conexaoId" = ${conexaoId}` : Prisma.empty}
       AND (
         UPPER(COALESCE(TRIM(t."tipoDocumento"), '')) IN ('CTE', 'CT-E', 'CTRC')
         ${
           numeros.length > 0
             ? Prisma.sql`OR LTRIM(COALESCE(SUBSTRING(t."numeroDocumento" FROM '[0-9]+'), ''), '0') IN (${Prisma.join(numeros)})`
             : Prisma.empty
         }
         OR t."valorDocumentoCents" IN (${Prisma.join(valores)})
       )
     ORDER BY 3
  `;

  return cruzarCte(lista, titulos);
}

// O CRUZAMENTO, separado da consulta de propósito: é ele que carrega a regra —
// e regra que só dá para exercitar com banco em pé é regra que ninguém
// exercita. Assim o teste roda com a lista real do usuário e os títulos em
// memória, e prova que o resultado reproduz a conferência feita à mão.
export function cruzarCte(lista: CteDaLista[], titulos: TituloCte[]): ResultadoConferencia {
  const usados = new Set<string>();
  const linhas: LinhaConferencia[] = [];

  // Casamento em duas passadas, e nesta ordem: primeiro TODOS os que têm
  // número, depois os que só dá para casar por valor e data. Invertido, um
  // casamento fraco consumiria o título que pertencia a um casamento forte —
  // dois CT-e de R$ 52.000,00 no mesmo dia é caso real desta base.
  const casar = (c: CteDaLista, porNumero: boolean): { t: TituloCte; como: "número" | "valor+data" } | null => {
    if (porNumero) {
      const alvo = soDigitos(c.numero);
      if (alvo === "") return null;
      const t = titulos.find((x) => !usados.has(x.id) && soDigitos(x.numero) === alvo);
      return t ? { t, como: "número" } : null;
    }
    // Desempate do casamento fraco, nesta ordem: (1) título que É CT-e; (2)
    // título SEM número — o que carrega um número que não é o deste CT-e quase
    // sempre é outro documento; (3) o mais próximo na data.
    const candidatos = titulos
      .filter(
        (x) =>
          !usados.has(x.id) &&
          x.valorCents === c.valorCents &&
          Math.abs(dias(x.data, c.data)) <= DIAS_DE_TOLERANCIA
      )
      .sort(
        (a, b) =>
          Number(ehTipoCte(b.tipo)) - Number(ehTipoCte(a.tipo)) ||
          Number(soDigitos(a.numero) === "") - Number(soDigitos(b.numero) === "") ||
          Math.abs(dias(a.data, c.data)) - Math.abs(dias(b.data, c.data))
      );
    return candidatos[0] ? { t: candidatos[0], como: "valor+data" } : null;
  };

  const pendentes: CteDaLista[] = [];
  for (const c of lista) {
    const achado = casar(c, true);
    if (achado) {
      usados.add(achado.t.id);
      linhas.push(montar(c, achado.t, achado.como));
    } else {
      pendentes.push(c);
    }
  }
  for (const c of pendentes) {
    const achado = casar(c, false);
    if (achado) {
      usados.add(achado.t.id);
      linhas.push(montar(c, achado.t, achado.como));
    } else if (!c.cancelado) {
      // CT-e cancelado e sem título é o caso CERTO: documento anulado, cobrança
      // inexistente. Não vira linha para não afogar o que importa.
      linhas.push({
        tipo: "autorizado_sem_titulo",
        numero: c.numero,
        data: c.data,
        valorCteCents: c.valorCents,
        valorTituloCents: null,
        tomador: c.tomador,
        situacaoTitulo: null,
        casadoPor: null,
      });
    }
  }

  // Aqui o tipo VOLTA a ser filtro, e só aqui. A consulta traz também títulos
  // de outros documentos que casariam por valor — sem este recorte, cada NFS-e
  // do mês com valor coincidente viraria uma linha "título sem CT-e", e a lista
  // de diferenças ficaria mais longa que a lista conferida.
  const titulosCte = titulos.filter((t) => ehTipoCte(t.tipo));
  for (const t of titulosCte) {
    if (usados.has(t.id) || t.cancelado) continue;
    linhas.push({
      tipo: "titulo_sem_cte",
      numero: t.numero,
      data: t.data,
      valorCteCents: null,
      valorTituloCents: t.valorCents,
      tomador: t.parceiro ?? "(sem parceiro)",
      situacaoTitulo: t.situacao,
      casadoPor: null,
    });
  }

  const somar = (tipo: LinhaConferencia["tipo"], campo: "valorCteCents" | "valorTituloCents") =>
    linhas.filter((l) => l.tipo === tipo).reduce((a, l) => a + (l[campo] ?? 0), 0);

  return {
    lidos: lista.length,
    autorizados: lista.filter((c) => !c.cancelado).length,
    cancelados: lista.filter((c) => c.cancelado).length,
    titulosNoPeriodo: titulosCte.length,
    casados: linhas.filter((l) => l.tipo === "casado").length,
    // Ordem de leitura: o que custa dinheiro primeiro, o que está certo por
    // último. Uma lista de conferência que começa pelos acertos é uma lista
    // que ninguém rola até o fim.
    linhas: linhas.sort((a, b) => ordem(a.tipo) - ordem(b.tipo) || (b.valorCteCents ?? 0) - (a.valorCteCents ?? 0)),
    canceladoComTituloCents: somar("cancelado_com_titulo", "valorTituloCents"),
    autorizadoSemTituloCents: somar("autorizado_sem_titulo", "valorCteCents"),
    divergenciaDeValorCents: linhas
      .filter((l) => l.tipo === "valor_divergente")
      .reduce((a, l) => a + Math.abs((l.valorTituloCents ?? 0) - (l.valorCteCents ?? 0)), 0),
    titulosSemNumero: titulosCte.filter((t) => soDigitos(t.numero) === "").length,
  };
}

function montar(c: CteDaLista, t: TituloCte, como: "número" | "valor+data"): LinhaConferencia {
  const base = {
    numero: c.numero,
    data: c.data,
    valorCteCents: c.valorCents,
    valorTituloCents: t.valorCents,
    tomador: c.tomador,
    situacaoTitulo: t.situacao,
    casadoPor: como,
  };
  // A ordem dos testes é a ordem da gravidade. Um CT-e cancelado com título
  // vivo é receita sem documento válido; um valor divergente é cobrança fora
  // do que o documento autoriza. O primeiro engole o segundo de propósito:
  // conserta-se o título antes de discutir centavos.
  if (c.cancelado && !t.cancelado) return { ...base, tipo: "cancelado_com_titulo" };
  if (!t.cancelado && t.valorCents !== c.valorCents) return { ...base, tipo: "valor_divergente" };
  return { ...base, tipo: "casado" };
}

function ordem(tipo: LinhaConferencia["tipo"]): number {
  return { cancelado_com_titulo: 0, valor_divergente: 1, autorizado_sem_titulo: 2, titulo_sem_cte: 3, casado: 4 }[tipo];
}

function dias(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

// O número do documento nos dois lados quase nunca vem igual: a lista traz
// "1284", a Omie traz "CTE 1284", "001284" ou "1284/1". Comparar o texto cru
// faria o casamento forte falhar e cair no fraco (valor+data) — que é
// justamente o que não distingue dois CT-e de mesmo valor no mesmo dia.
// Só o PRIMEIRO grupo de dígitos, sem zeros à esquerda: "CTE 001284" e
// "1284/2" (a parcela, que a Omie às vezes cola no número) precisam dar o mesmo
// "1284". Juntar todos os dígitos transformaria "1284/2" em "12842" — um
// número que não existe, e o casamento silenciosamente erra.
function soDigitos(numero: string | null): string {
  const grupo = /\d+/.exec(numero ?? "");
  return grupo ? grupo[0].replace(/^0+/, "") : "";
}
