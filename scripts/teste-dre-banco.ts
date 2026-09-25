// AS DUAS COLHEITAS DO DRE, LADO A LADO — `npm run teste:dre-banco`.
//
// A tela de Custos e DRE parou de carregar treze meses de títulos para somar
// quarenta linhas: as somas passaram a sair de GROUP BY no banco. A conta é a
// mesma função dos dois lados (`montarDreDeInsumos`), mas a COLHEITA tem duas
// implementações — memória e SQL —, e duas implementações da mesma leitura
// divergem com o tempo.
//
// Este teste é o que impede a divergência: ele semeia uma base com os casos que
// costumam separar as duas (título cancelado, categoria nula, competência que
// não é o vencimento, pagamento parcial com retenção, categoria que só tem
// movimento fora do mês, título fora da janela, duas empresas) e exige que as
// DUAS demonstrações sejam idênticas, campo a campo, nos dois regimes.
//
// Precisa de um Postgres real em TESTE_DATABASE_URL — instruções no topo de
// scripts/teste-sql.ts. Sem a variável, avisa e sai com sucesso.
import { PrismaClient } from "@prisma/client";

const url = process.env.TESTE_DATABASE_URL;
if (!url) {
  console.log(
    "\nTESTE_DATABASE_URL não definida — pulando o teste diferencial do DRE.\n" +
      "Ele precisa de um Postgres real; as instruções estão no topo de scripts/teste-sql.ts.\n"
  );
  process.exit(0);
}

process.env.DATABASE_URL = url;
const prisma = new PrismaClient({ datasources: { db: { url } } });

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "  ok  " : "FALHA "} ${nome}`);
  if (!ok) {
    const a = JSON.stringify(esperado);
    const b = JSON.stringify(real);
    // A demonstração inteira em uma linha é ilegível; o que importa é ONDE as
    // duas se separam.
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    console.log(`         divergem a partir do caractere ${i}`);
    console.log(`         memória: ...${a.slice(Math.max(0, i - 120), i + 160)}`);
    console.log(`         banco:   ...${b.slice(Math.max(0, i - 120), i + 160)}`);
  }
}

const EMPRESA = "empresa-dre-banco";
const REFERENCIA = new Date(2026, 8, 22);

async function limpar() {
  await prisma.omieBaixa.deleteMany({ where: { companyId: EMPRESA } });
  await prisma.omieTitulo.deleteMany({ where: { companyId: EMPRESA } });
  await prisma.omieCategoria.deleteMany({ where: { companyId: EMPRESA } });
  await prisma.omieParceiro.deleteMany({ where: { companyId: EMPRESA } });
  await prisma.omieConexao.deleteMany({ where: { companyId: EMPRESA } });
  await prisma.controladoriaConfig.deleteMany({ where: { companyId: EMPRESA } });
}

async function principal() {
  const { carregarContexto } = await import("../src/lib/controladoria/contexto");
  const { montarDre, montarDreAnual } = await import("../src/lib/controladoria/dre");
  const { montarDreNoBanco, montarDreAnualNoBanco } = await import("../src/lib/controladoria/dreNoBanco");
  const { montarJanelas } = await import("../src/lib/controladoria/periodos");
  const { ranking } = await import("../src/lib/controladoria/analytics");
  const { rankingNoBanco } = await import("../src/lib/controladoria/resumoNoBanco");
  const { analisarEstrategiaDeCusto } = await import("../src/lib/controladoria/estrategiaCusto");
  const { analisarEstrategiaNoBanco } = await import("../src/lib/controladoria/estrategiaCustoNoBanco");

  await limpar();

  const cx1 = await prisma.omieConexao.create({
    data: { companyId: EMPRESA, nome: "Azul DRE", apelido: "AZ", credencialRef: "AZ" },
  });
  const cx2 = await prisma.omieConexao.create({
    data: { companyId: EMPRESA, nome: "MCZ DRE", apelido: "MC", credencialRef: "MC" },
  });
  await prisma.controladoriaConfig.create({
    data: { companyId: EMPRESA, dataInicioBase: new Date(2025, 0, 1), retencoesNasDeducoes: false },
  });

  // O cadastro de categorias: uma de receita, três de despesa que caem em
  // linhas diferentes da demonstração, e uma que NÃO existe no cadastro (some
  // dele de propósito, para exercitar o caminho "categoria excluída na Omie
  // depois de usada").
  await prisma.omieCategoria.createMany({
    data: [
      { companyId: EMPRESA, conexaoId: cx1.id, conexaoApelido: "AZ", codigo: "R1", descricao: "Clientes — Serviços Prestados", contaReceita: true },
      { companyId: EMPRESA, conexaoId: cx1.id, conexaoApelido: "AZ", codigo: "D1", descricao: "Combustível e diesel", contaDespesa: true },
      { companyId: EMPRESA, conexaoId: cx1.id, conexaoApelido: "AZ", codigo: "D2", descricao: "Salários e folha", contaDespesa: true },
      { companyId: EMPRESA, conexaoId: cx1.id, conexaoApelido: "AZ", codigo: "D3", descricao: "ISS sobre faturamento", contaDespesa: true },
      { companyId: EMPRESA, conexaoId: cx2.id, conexaoApelido: "MC", codigo: "D4", descricao: "Aluguel da garagem", contaDespesa: true },
    ],
  });

  // Um parceiro no cadastro com nome DIFERENTE do que está gravado nos
  // títulos: é ele que prova que o ranking resolve o nome pelo cadastro, e não
  // pelo texto do título.
  await prisma.omieParceiro.create({
    data: {
      companyId: EMPRESA,
      conexaoId: cx1.id,
      conexaoApelido: "AZ",
      codigoOmie: "P1",
      nome: "Parceiro Um S/A (cadastro)",
      documento: "12345678000199",
    },
  });

  const comum = (conexao: { id: string }, apelido: string) => ({
    companyId: EMPRESA,
    conexaoId: conexao.id,
    conexaoApelido: apelido,
    status: "ABERTO",
    parceiroCodigo: "P1",
    parceiroNome: "Parceiro Um",
  });

  // Valores TODOS DISTINTOS em módulo: a lista do drill-down ordena por valor,
  // e empate exato deixaria a ordem ao critério de cada colheita — o que este
  // teste não quer medir.
  const dados = [
    // --- setembro/2026, o mês da tela (referência dia 22) ---
    { ...comum(cx1, "AZ"), codigoLancamento: "A1", natureza: "RECEBER" as const, categoriaCodigo: "R1",
      dataEmissao: new Date(2026, 8, 3), dataVencimento: new Date(2026, 9, 10), valorDocumentoCents: 900_100,
      retencaoIssCents: 18_000, retencaoPisCents: 5_800, retencaoCofinsCents: 27_000, retencaoIrCents: 13_500,
      numeroDocumento: "NF 900" },
    { ...comum(cx1, "AZ"), codigoLancamento: "A2", natureza: "RECEBER" as const, categoriaCodigo: "R1",
      dataEmissao: new Date(2026, 8, 9), dataVencimento: new Date(2026, 8, 20), valorDocumentoCents: 450_200,
      retencaoIssCents: 9_000, liquidado: true, numeroDocumento: "NF 450" },
    { ...comum(cx1, "AZ"), codigoLancamento: "A3", natureza: "PAGAR" as const, categoriaCodigo: "D1",
      dataEmissao: new Date(2026, 8, 4), dataVencimento: new Date(2026, 8, 18), valorDocumentoCents: 310_300 },
    { ...comum(cx1, "AZ"), codigoLancamento: "A4", natureza: "PAGAR" as const, categoriaCodigo: "D2",
      dataEmissao: new Date(2026, 8, 5), dataVencimento: new Date(2026, 8, 19), valorDocumentoCents: 220_400 },
    { ...comum(cx1, "AZ"), codigoLancamento: "A5", natureza: "PAGAR" as const, categoriaCodigo: "D3",
      dataEmissao: new Date(2026, 8, 6), dataVencimento: new Date(2026, 8, 25), valorDocumentoCents: 40_500 },
    // Cancelado: não é resultado, e nenhuma das duas colheitas pode contá-lo.
    { ...comum(cx1, "AZ"), codigoLancamento: "A6", natureza: "PAGAR" as const, categoriaCodigo: "D1",
      dataEmissao: new Date(2026, 8, 7), dataVencimento: new Date(2026, 8, 21), valorDocumentoCents: 777_700,
      cancelado: true },
    // Sem categoria: fica FORA da demonstração e aparece no aviso.
    { ...comum(cx1, "AZ"), codigoLancamento: "A7", natureza: "PAGAR" as const, categoriaCodigo: null,
      dataEmissao: new Date(2026, 8, 8), dataVencimento: new Date(2026, 8, 22), valorDocumentoCents: 60_600 },
    // Categoria que NÃO está no cadastro, e parceiro SEM CÓDIGO: no ranking,
    // ele se agrupa pelo nome.
    { ...comum(cx1, "AZ"), codigoLancamento: "A8", natureza: "PAGAR" as const, categoriaCodigo: "DX",
      parceiroCodigo: null, parceiroNome: "Fornecedor Sem Código",
      dataEmissao: new Date(2026, 8, 10), dataVencimento: new Date(2026, 8, 23), valorDocumentoCents: 70_700 },
    // Estorno: valor negativo dentro de uma linha de despesa.
    { ...comum(cx1, "AZ"), codigoLancamento: "A9", natureza: "PAGAR" as const, categoriaCodigo: "D1",
      dataEmissao: new Date(2026, 8, 11), dataVencimento: new Date(2026, 8, 24), valorDocumentoCents: -15_800 },
    // Outra empresa, mesmo mês: entra no consolidado e sai no filtro por empresa.
    { ...comum(cx2, "MC"), codigoLancamento: "B1", natureza: "PAGAR" as const, categoriaCodigo: "D4",
      dataEmissao: new Date(2026, 8, 12), dataVencimento: new Date(2026, 8, 26), valorDocumentoCents: 130_900 },
    // EMISSÃO EM SETEMBRO, VENCIMENTO EM OUTUBRO já está em A1; aqui o inverso:
    // emitido em agosto e vencendo em setembro, pertence a AGOSTO.
    { ...comum(cx1, "AZ"), codigoLancamento: "A10", natureza: "PAGAR" as const, categoriaCodigo: "D1",
      dataEmissao: new Date(2026, 7, 28), dataVencimento: new Date(2026, 8, 15), valorDocumentoCents: 91_100 },

    // --- agosto/2026, o mês anterior ---
    { ...comum(cx1, "AZ"), codigoLancamento: "A11", natureza: "RECEBER" as const, categoriaCodigo: "R1",
      dataEmissao: new Date(2026, 7, 5), dataVencimento: new Date(2026, 7, 25), valorDocumentoCents: 800_300,
      retencaoIssCents: 16_000, liquidado: true },
    { ...comum(cx1, "AZ"), codigoLancamento: "A12", natureza: "PAGAR" as const, categoriaCodigo: "D2",
      dataEmissao: new Date(2026, 7, 6), dataVencimento: new Date(2026, 7, 26), valorDocumentoCents: 210_700,
      liquidado: true },

    // --- setembro/2025, o mesmo mês do ano anterior ---
    { ...comum(cx1, "AZ"), codigoLancamento: "A13", natureza: "RECEBER" as const, categoriaCodigo: "R1",
      dataEmissao: new Date(2025, 8, 4), dataVencimento: new Date(2025, 8, 24), valorDocumentoCents: 700_500,
      retencaoIssCents: 14_000, liquidado: true },
    { ...comum(cx1, "AZ"), codigoLancamento: "A14", natureza: "PAGAR" as const, categoriaCodigo: "D1",
      dataEmissao: new Date(2025, 8, 5), dataVencimento: new Date(2025, 8, 25), valorDocumentoCents: 190_600,
      liquidado: true },

    // --- fora de qualquer mês da tela, dentro da janela: só movimento ---
    { ...comum(cx1, "AZ"), codigoLancamento: "A15", natureza: "RECEBER" as const, categoriaCodigo: "R9",
      dataEmissao: new Date(2026, 5, 10), dataVencimento: new Date(2026, 5, 20), valorDocumentoCents: 555_400,
      liquidado: true },
  ];

  for (const d of dados) await prisma.omieTitulo.create({ data: d });

  const porCodigo = new Map(
    (
      await prisma.omieTitulo.findMany({
        where: { companyId: EMPRESA },
        select: { id: true, codigoLancamento: true, conexaoId: true },
      })
    ).map((t) => [t.codigoLancamento, t])
  );
  const idDe = (codigo: string) => porCodigo.get(codigo)!.id;
  const conexaoDe = (codigo: string) => porCodigo.get(codigo)!.conexaoId;

  // AS BAIXAS — o regime de caixa. Inclui um PAGAMENTO PARCIAL de título com
  // retenção (é ele que exercita a proporção), baixas do mês anterior e do
  // ano anterior, e uma baixa de título cancelado, que não pode contar.
  await prisma.omieBaixa.createMany({
    data: [
      { companyId: EMPRESA, conexaoId: conexaoDe("A2"), tituloId: idDe("A2"), chave: "K1",
        dataBaixa: new Date(2026, 8, 20), valorCents: 450_200 },
      // Parcial: 40% de A1 (que vence em outubro e tem as quatro retenções).
      { companyId: EMPRESA, conexaoId: conexaoDe("A1"), tituloId: idDe("A1"), chave: "K2",
        dataBaixa: new Date(2026, 8, 15), valorCents: 360_040 },
      { companyId: EMPRESA, conexaoId: conexaoDe("A3"), tituloId: idDe("A3"), chave: "K3",
        dataBaixa: new Date(2026, 8, 18), valorCents: 310_300 },
      { companyId: EMPRESA, conexaoId: conexaoDe("A9"), tituloId: idDe("A9"), chave: "K4",
        dataBaixa: new Date(2026, 8, 24), valorCents: -15_800 },
      { companyId: EMPRESA, conexaoId: conexaoDe("A6"), tituloId: idDe("A6"), chave: "K5",
        dataBaixa: new Date(2026, 8, 21), valorCents: 777_700 },
      { companyId: EMPRESA, conexaoId: conexaoDe("B1"), tituloId: idDe("B1"), chave: "K6",
        dataBaixa: new Date(2026, 8, 26), valorCents: 130_900 },
      { companyId: EMPRESA, conexaoId: conexaoDe("A11"), tituloId: idDe("A11"), chave: "K7",
        dataBaixa: new Date(2026, 7, 25), valorCents: 800_300 },
      { companyId: EMPRESA, conexaoId: conexaoDe("A12"), tituloId: idDe("A12"), chave: "K8",
        dataBaixa: new Date(2026, 7, 26), valorCents: 210_700 },
      { companyId: EMPRESA, conexaoId: conexaoDe("A13"), tituloId: idDe("A13"), chave: "K9",
        dataBaixa: new Date(2025, 8, 24), valorCents: 700_500 },
      { companyId: EMPRESA, conexaoId: conexaoDe("A14"), tituloId: idDe("A14"), chave: "K10",
        dataBaixa: new Date(2025, 8, 25), valorCents: 190_600 },
    ],
  });

  // A classificação manual de duas categorias — uma com subgrupo, para o
  // subtotal de subgrupo entrar na comparação.
  const classificacoes = new Map([
    ["D1", { linha: "CUSTO_SERVICO", subgrupo: "Frota", confirmada: true }],
    ["D2", { linha: "CUSTO_SERVICO", subgrupo: "Pessoal operacional", confirmada: false }],
  ]);

  const janelas = montarJanelas(REFERENCIA);
  const anoAnterior = {
    inicio: new Date(2025, 8, 1, 0, 0, 0, 0),
    fim: new Date(2025, 8, 30, 23, 59, 59, 999),
    rotulo: "2025",
  };
  // A MESMA JANELA DOS DOIS LADOS: treze meses, como a tela de Custos pede.
  const desdeMensal = new Date(2025, 8, 1);

  for (const conexaoId of [null, cx1.id]) {
    const ctx = await carregarContexto(EMPRESA, REFERENCIA, conexaoId ?? undefined, { desde: desdeMensal });
    const escopo = { companyId: EMPRESA, conexaoId, janela: { desde: desdeMensal, ate: null } };
    const alvo = conexaoId ? "uma empresa" : "consolidado";

    for (const regime of ["competencia", "caixa"] as const) {
      for (const somarRetencoes of [false, true]) {
        const opcoes = { regime, somarRetencoes, periodoAnoAnterior: anoAnterior };
        const memoria = montarDre(ctx, janelas.mesAtual, janelas.mesAnterior, classificacoes, opcoes);
        const banco = await montarDreNoBanco(escopo, janelas.mesAtual, janelas.mesAnterior, classificacoes, opcoes);
        conferir(
          `DRE do mês idêntico — ${alvo}, ${regime}${somarRetencoes ? ", retenções somadas" : ""}`,
          banco,
          memoria
        );
      }
    }

    // SEM O ANO ANTERIOR: a coluna some, e "some" é null, não zero.
    const semAno = { regime: "competencia" as const };
    conferir(
      `DRE do mês idêntico sem comparação anual — ${alvo}`,
      await montarDreNoBanco(escopo, janelas.mesAtual, janelas.mesAnterior, classificacoes, semAno),
      montarDre(ctx, janelas.mesAtual, janelas.mesAnterior, classificacoes, semAno)
    );

    // O RANKING DE PARCEIROS, que a mesma tela exibe logo abaixo do DRE.
    for (const natureza of ["PAGAR", "RECEBER"] as const) {
      conferir(
        `ranking de ${natureza === "PAGAR" ? "fornecedores" : "clientes"} idêntico — ${alvo}`,
        await rankingNoBanco(escopo, janelas.mesAtual, natureza, 15),
        ranking(ctx, janelas.mesAtual, natureza, 15)
      );
    }

    // A ESTRATÉGIA DE CUSTO: doze meses de série por categoria.
    conferir(
      `estratégia de custo idêntica — ${alvo}`,
      await analisarEstrategiaNoBanco(escopo, REFERENCIA),
      analisarEstrategiaDeCusto(ctx)
    );
  }

  // ------------------------------------------------------------------ anual
  // A visão anual tem janela própria: o ano inteiro, como a tela carrega.
  const desdeAnual = new Date(2026, 0, 1);
  for (const conexaoId of [null, cx1.id]) {
    const ctxAno = await carregarContexto(EMPRESA, REFERENCIA, conexaoId ?? undefined, { desde: desdeAnual });
    const escopoAno = { companyId: EMPRESA, conexaoId, janela: { desde: desdeAnual, ate: null } };
    const alvo = conexaoId ? "uma empresa" : "consolidado";

    for (const regime of ["competencia", "caixa"] as const) {
      for (const somarRetencoes of [false, true]) {
        const opcoes = { regime, somarRetencoes };
        conferir(
          `DRE anual idêntico — ${alvo}, ${regime}${somarRetencoes ? ", retenções somadas" : ""}`,
          await montarDreAnualNoBanco(escopoAno, 2026, REFERENCIA, classificacoes, opcoes),
          montarDreAnual(ctxAno, 2026, classificacoes, opcoes)
        );
      }
    }
  }

  await limpar();
}

principal()
  .then(async () => {
    await prisma.$disconnect();
    console.log(falhas === 0 ? "\nTodos os casos passaram.\n" : `\n${falhas} FALHA(S).\n`);
    process.exit(falhas === 0 ? 0 : 1);
  })
  .catch(async (e) => {
    await prisma.$disconnect();
    console.error("\nO teste não completou:", e);
    process.exit(1);
  });
