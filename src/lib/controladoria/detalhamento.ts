import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tabela } from "@/lib/esquemaDoBanco";
import { temColuna } from "./esquema";
import { competenciaSql } from "./competencia";
import { codigosDoTipoDocumento } from "./composicao";
import type { Periodo } from "./periodos";

// DETALHAMENTO — do total do painel até a linha que o compõe.
//
// O painel responde "quanto"; a composição responde "de onde vem"; isto
// responde "qual registro é". Sem este último degrau a investigação para no
// meio: descobre-se que os R$ 38.912,52 de perda do mês são todos desconto
// concedido a cliente, e continua sem saber a QUEM, em QUE título e por QUANTO
// cada um — que é exatamente a pergunta que faz alguém agir.
//
// A REGRA QUE SUSTENTA ESTE ARQUIVO: cada consulta aqui repete, literalmente, o
// filtro do número que ela abre. Mesma janela, mesma data, mesmo tratamento de
// cancelado. Uma tela de detalhe que soma diferente do total que abriu é pior
// que não existir — ela ensina a desconfiar do painel inteiro, e quem olha não
// tem como saber qual dos dois números está certo.
//
// Por isso os totais devolvidos aqui (`totalCents`, `quantidade`) vêm da MESMA
// consulta que as linhas, por função de janela, e a tela os mostra ao lado do
// valor do cartão. Divergiram? O erro está escrito na tela, não escondido.

export type LinhaDetalhe = {
  id: string;
  data: Date;
  empresa: string;
  documento: string | null;
  parceiro: string | null;
  descricao: string | null;
  valorCents: number;
};

export type Detalhamento = {
  titulo: string;
  // O que põe uma linha nesta lista, por extenso. Vai para a tela: sem isso,
  // "por que este título está aqui e aquele não" não tem resposta.
  criterio: string;
  rotuloData: string;
  rotuloValor: string;
  totalCents: number;
  quantidade: number;
  linhas: LinhaDetalhe[];
  limite: number;
};

// Teto de linhas por consulta. Uma tela de investigação não precisa de dez mil
// linhas: precisa das maiores e da contagem honesta do que ficou de fora — que
// é o que `quantidade` carrega.
const LIMITE_PADRAO = 300;

type LinhaBruta = {
  id: string;
  data: Date;
  empresa: string | null;
  documento: string | null;
  parceiro: string | null;
  descricao: string | null;
  valor: bigint;
  total_valor: bigint;
  total_linhas: bigint;
};

function montar(
  linhas: LinhaBruta[],
  base: { titulo: string; criterio: string; rotuloData: string; rotuloValor: string },
  limite: number
): Detalhamento {
  return {
    ...base,
    totalCents: Number(linhas[0]?.total_valor ?? 0),
    quantidade: Number(linhas[0]?.total_linhas ?? 0),
    limite,
    linhas: linhas.map((l) => ({
      id: l.id,
      data: l.data,
      empresa: l.empresa ?? "—",
      documento: l.documento,
      parceiro: l.parceiro,
      descricao: l.descricao,
      valorCents: Number(l.valor),
    })),
  };
}

// ---------------------------------------------------------------------------
// TÍTULOS — o que compõe "títulos a receber / a pagar do mês" e, por
// consequência, o resultado.
// ---------------------------------------------------------------------------

export type DimensaoTitulo = "tipo" | "categoria" | null;

export async function detalharTitulos(params: {
  companyId: string;
  conexaoId?: string | null;
  periodo: Periodo;
  natureza: "PAGAR" | "RECEBER";
  dimensao: DimensaoTitulo;
  // O RÓTULO como o painel o mostra ("CT-e", "Manutenção de veículos"), não um
  // código. É o que estava na tela quando a pessoa clicou, e o filtro abaixo
  // repete a mesma expressão que produziu esse rótulo — é o que garante que a
  // soma daqui bate com a fatia de lá.
  valor?: string | null;
  limite?: number;
}): Promise<Detalhamento> {
  const { companyId, conexaoId, periodo, natureza, dimensao, valor, limite = LIMITE_PADRAO } = params;

  const filtroEmpresa = conexaoId ? Prisma.sql`AND t."conexaoId" = ${conexaoId}` : Prisma.empty;

  // A mesma resolução de nome de categoria da composição (ver composicao.ts):
  // a Omie devolve só o código, e o join condicional existe porque o banco de
  // produção pode estar numa versão sem a coluna.
  const podeJuntarCategoria = await temColuna("OmieCategoria", "conexaoId");
  const juncaoCategoria = podeJuntarCategoria
    ? Prisma.sql`
      LEFT JOIN ${tabela("OmieCategoria")} cat
        ON cat."companyId" = t."companyId"
       AND cat."conexaoId" = t."conexaoId"
       AND cat.codigo = t."categoriaCodigo"`
    : Prisma.empty;
  // Caractere por caractere a MESMA expressão da composição (composicao.ts).
  // É ela que produz o rótulo da fatia no painel; qualquer diferença aqui, até
  // um TRIM a menos, faz o detalhe somar diferente do número que o abriu.
  const nomeDaCategoria = podeJuntarCategoria
    ? Prisma.sql`COALESCE(NULLIF(TRIM(t."categoriaDescricao"), ''), NULLIF(TRIM(cat.descricao), ''), NULLIF(TRIM(t."categoriaCodigo"), ''))`
    : Prisma.sql`COALESCE(NULLIF(TRIM(t."categoriaDescricao"), ''), NULLIF(TRIM(t."categoriaCodigo"), ''))`;

  let filtroFatia: Prisma.Sql = Prisma.empty;
  let criterioFatia = "";
  if (dimensao === "categoria" && valor) {
    if (valor === "Sem categoria") {
      filtroFatia = Prisma.sql`AND ${nomeDaCategoria} IS NULL`;
      criterioFatia = " sem categoria preenchida";
    } else {
      filtroFatia = Prisma.sql`AND ${nomeDaCategoria} = ${valor}`;
      criterioFatia = ` na categoria "${valor}"`;
    }
  } else if (dimensao === "tipo" && valor) {
    if (valor === "Sem tipo") {
      filtroFatia = Prisma.sql`AND (t."tipoDocumento" IS NULL OR TRIM(t."tipoDocumento") = '')`;
      criterioFatia = " sem tipo de documento";
    } else {
      // Vários códigos da Omie viram o mesmo rótulo ("CTE", "CT-E" e "CTRC"
      // são todos CT-e). O filtro precisa aceitar todos, senão a soma daqui
      // fica menor que a fatia que a pessoa clicou.
      const codigos = codigosDoTipoDocumento(valor);
      filtroFatia = Prisma.sql`AND UPPER(TRIM(t."tipoDocumento")) IN (${Prisma.join(codigos)})`;
      criterioFatia = ` do tipo ${valor}`;
    }
  }

  const linhas = await prisma.$queryRaw<LinhaBruta[]>`
    SELECT t.id,
           ${competenciaSql("t")} AS data,
           t."conexaoApelido" AS empresa,
           t."numeroDocumento" AS documento,
           t."parceiroNome" AS parceiro,
           ${nomeDaCategoria} AS descricao,
           t."valorDocumentoCents" AS valor,
           SUM(t."valorDocumentoCents") OVER ()::bigint AS total_valor,
           COUNT(*) OVER ()::bigint AS total_linhas
      FROM ${tabela("OmieTitulo")} t
      ${juncaoCategoria}
     WHERE t."companyId" = ${companyId}
       AND t.cancelado = false
       AND t.natureza::text = ${natureza}
       AND ${competenciaSql("t")} >= ${periodo.inicio}
       AND ${competenciaSql("t")} <= ${periodo.fim}
       ${filtroEmpresa}
       ${filtroFatia}
     ORDER BY t."valorDocumentoCents" DESC
     LIMIT ${limite}
  `;

  const lado = natureza === "RECEBER" ? "a receber" : "a pagar";
  return montar(
    linhas,
    {
      titulo: `Títulos ${lado}${criterioFatia} — ${periodo.rotulo}`,
      criterio:
        `Título ${lado} não cancelado cuja competência (data de emissão, ou o vencimento quando não há emissão) ` +
        `cai em ${periodo.rotulo}${criterioFatia}. É o mesmo recorte do cartão do painel.`,
      rotuloData: "Competência",
      rotuloValor: "Valor do título",
    },
    limite
  );
}

// ---------------------------------------------------------------------------
// PERDAS DO MÊS — juros, multa, tarifa e desconto concedido, baixa a baixa.
// ---------------------------------------------------------------------------

// A natureza de cada componente NÃO é decoração: é a definição da perda, e
// repete a de resumoNoBanco.ts. Juros e multa são de quem PAGOU atrasado;
// desconto concedido é do que se RECEBEU a menos; tarifa é de toda baixa,
// porque o banco cobra dos dois lados.
const COMPONENTES = {
  juros: { campo: "jurosCents", natureza: "PAGAR", rotulo: "Juros por atraso" },
  multa: { campo: "multaCents", natureza: "PAGAR", rotulo: "Multa por atraso" },
  tarifa: { campo: "tarifaCents", natureza: null, rotulo: "Tarifa bancária" },
  desconto: { campo: "descontoCents", natureza: "RECEBER", rotulo: "Desconto concedido a cliente" },
} as const;

export type ComponenteDePerda = keyof typeof COMPONENTES;

export function ehComponenteDePerda(valor: string | undefined | null): valor is ComponenteDePerda {
  return valor === "juros" || valor === "multa" || valor === "tarifa" || valor === "desconto";
}

export async function detalharPerdas(params: {
  companyId: string;
  conexaoId?: string | null;
  periodo: Periodo;
  componente: ComponenteDePerda;
  limite?: number;
}): Promise<Detalhamento> {
  const { companyId, conexaoId, periodo, componente, limite = LIMITE_PADRAO } = params;
  const { campo, natureza, rotulo } = COMPONENTES[componente];

  // `Prisma.raw` com valor de fora só é seguro porque `campo` vem da tabela
  // fechada acima e o tipo de `componente` não admite outra coisa — nunca da
  // querystring direto.
  const coluna = Prisma.raw(`b."${campo}"`);
  const filtroEmpresa = conexaoId ? Prisma.sql`AND b."conexaoId" = ${conexaoId}` : Prisma.empty;
  const filtroNatureza = natureza ? Prisma.sql`AND t.natureza::text = ${natureza}` : Prisma.empty;

  const linhas = await prisma.$queryRaw<LinhaBruta[]>`
    SELECT b.id,
           b."dataBaixa" AS data,
           t."conexaoApelido" AS empresa,
           t."numeroDocumento" AS documento,
           t."parceiroNome" AS parceiro,
           COALESCE(NULLIF(TRIM(t."categoriaDescricao"), ''), NULLIF(TRIM(b.observacao), '')) AS descricao,
           ${coluna} AS valor,
           SUM(${coluna}) OVER ()::bigint AS total_valor,
           COUNT(*) OVER ()::bigint AS total_linhas
      FROM ${tabela("OmieBaixa")} b
      LEFT JOIN ${tabela("OmieTitulo")} t ON t.id = b."tituloId"
     WHERE b."companyId" = ${companyId}
       AND b."dataBaixa" >= ${periodo.inicio}
       AND b."dataBaixa" <= ${periodo.fim}
       AND ${coluna} <> 0
       ${filtroNatureza}
       ${filtroEmpresa}
     ORDER BY ${coluna} DESC
     LIMIT ${limite}
  `;

  const deQuem =
    natureza === "PAGAR"
      ? "em baixa de título A PAGAR (é o que a empresa pagou a mais por atraso)"
      : natureza === "RECEBER"
        ? "em baixa de título A RECEBER (é o que a empresa deixou de receber)"
        : "em qualquer baixa do período — o banco cobra dos dois lados";

  return montar(
    linhas,
    {
      titulo: `${rotulo} — ${periodo.rotulo}`,
      criterio: `Baixa com data em ${periodo.rotulo} e ${rotulo.toLowerCase()} diferente de zero, ${deQuem}.`,
      rotuloData: "Data da baixa",
      rotuloValor: rotulo,
    },
    limite
  );
}

// ---------------------------------------------------------------------------
// CAIXA — o extrato de uma conta corrente até a data de referência.
// ---------------------------------------------------------------------------

export async function detalharConta(params: {
  companyId: string;
  conexaoId: string;
  contaCorrenteCodigo: string;
  ate: Date;
  limite?: number;
}): Promise<Detalhamento & { conta: string | null; saldoInicialCents: number; inativa: boolean }> {
  const { companyId, conexaoId, contaCorrenteCodigo, ate, limite = LIMITE_PADRAO } = params;

  const [conta, linhas] = await Promise.all([
    prisma.omieContaCorrente.findFirst({
      where: { companyId, conexaoId, codigo: contaCorrenteCodigo },
      select: { descricao: true, saldoInicialCents: true, inativa: true, conexaoApelido: true },
    }),
    prisma.$queryRaw<LinhaBruta[]>`
      SELECT m.id,
             m.data AS data,
             m."conexaoApelido" AS empresa,
             m.documento AS documento,
             m."parceiroNome" AS parceiro,
             COALESCE(NULLIF(TRIM(m.observacao), ''), NULLIF(TRIM(m.tipo), '')) AS descricao,
             m."valorCents" AS valor,
             SUM(m."valorCents") OVER ()::bigint AS total_valor,
             COUNT(*) OVER ()::bigint AS total_linhas
        FROM ${tabela("OmieMovimento")} m
       WHERE m."companyId" = ${companyId}
         AND m."conexaoId" = ${conexaoId}
         AND m."contaCorrenteCodigo" = ${contaCorrenteCodigo}
         AND m.data <= ${ate}
       ORDER BY m.data DESC
       LIMIT ${limite}
    `,
  ]);

  const base = montar(
    linhas,
    {
      titulo: `Extrato — ${conta?.descricao ?? contaCorrenteCodigo}`,
      criterio:
        `Movimento desta conta corrente com data até a referência da auditoria. O saldo do cartão é o saldo ` +
        `inicial cadastrado mais a soma destes movimentos` +
        (conta?.inativa
          ? " — e a conta está INATIVA, então o saldo inicial dela não entra no total do painel, só o movimento."
          : "."),
      rotuloData: "Data",
      rotuloValor: "Valor",
    },
    limite
  );

  return {
    ...base,
    conta: conta?.descricao ?? null,
    saldoInicialCents: conta?.inativa ? 0 : (conta?.saldoInicialCents ?? 0),
    inativa: conta?.inativa ?? false,
  };
}
