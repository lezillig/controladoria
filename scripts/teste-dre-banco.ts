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
  const { montarDre, montarDreAnual, LINHAS_DRE } = await import("../src/lib/controladoria/dre");
  const LINHAS_DRE_ROTULOS: string[] = LINHAS_DRE.map((l) => l.rotulo);
  const { montarDreNoBanco, montarDreAnualNoBanco } = await import("../src/lib/controladoria/dreNoBanco");
  const { montarJanelas } = await import("../src/lib/controladoria/periodos");
  const { ranking } = await import("../src/lib/controladoria/analytics");
  const { rankingNoBanco } = await import("../src/lib/controladoria/resumoNoBanco");
  const { analisarEstrategiaDeCusto } = await import("../src/lib/controladoria/estrategiaCusto");
  const { analisarEstrategiaNoBanco, linhaPorCategoriaDoBanco } = await import("../src/lib/controladoria/estrategiaCustoNoBanco");

  await limpar();

  const cx1 = await prisma.omieConexao.create({
    // O CNPJ das duas empresas: é a raiz dele que identifica a operação entre
    // elas, eliminada na visão do grupo.
    data: { companyId: EMPRESA, nome: "Azul DRE", apelido: "AZ", credencialRef: "AZ", cnpj: "11111111000191" },
  });
  const cx2 = await prisma.omieConexao.create({
    // A MCZ é a empresa CORPORATIVA: a folha dela vai para "Despesas com
    // pessoas — corporativo".
    data: { companyId: EMPRESA, nome: "MCZ DRE", apelido: "MC", credencialRef: "MC", cnpj: "22.222.222/0001-91", papelNoGrupo: "CORPORATIVO" },
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
      // Folha, sem classificação manual: a proposta automática a põe em
      // pessoas, e a EMPRESA do título decide qual das duas linhas.
      { companyId: EMPRESA, conexaoId: cx1.id, conexaoApelido: "AZ", codigo: "D5", descricao: "Folha de pagamento", contaDespesa: true },
      { companyId: EMPRESA, conexaoId: cx2.id, conexaoApelido: "MC", codigo: "D5", descricao: "Folha de pagamento", contaDespesa: true },
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
    // O ISS de agosto: a estratégia de custo só olha meses FECHADOS, então o
    // D3 de setembro (A5) não entra nela — este é o que a lista "fora do corte".
    { ...comum(cx1, "AZ"), codigoLancamento: "A16", natureza: "PAGAR" as const, categoriaCodigo: "D3",
      dataEmissao: new Date(2026, 7, 8), dataVencimento: new Date(2026, 7, 28), valorDocumentoCents: 36_200,
      liquidado: true },

    // --- setembro/2025, o mesmo mês do ano anterior ---
    { ...comum(cx1, "AZ"), codigoLancamento: "A13", natureza: "RECEBER" as const, categoriaCodigo: "R1",
      dataEmissao: new Date(2025, 8, 4), dataVencimento: new Date(2025, 8, 24), valorDocumentoCents: 700_500,
      retencaoIssCents: 14_000, liquidado: true },
    { ...comum(cx1, "AZ"), codigoLancamento: "A14", natureza: "PAGAR" as const, categoriaCodigo: "D1",
      dataEmissao: new Date(2025, 8, 5), dataVencimento: new Date(2025, 8, 25), valorDocumentoCents: 190_600,
      liquidado: true },

    // --- OPERAÇÃO ENTRE AS EMPRESAS DO GRUPO ---
    // A MCZ fatura a Azul (o caso da tela: "Clientes — Serviços Prestados" do
    // grupo com a Azul como cliente) e a Azul paga a MCZ, por outro
    // estabelecimento (filial 0002) — a raiz é que decide. Na visão do grupo
    // os dois somem; na da Azul, o pagamento fica.
    { ...comum(cx2, "MC"), codigoLancamento: "IC1", natureza: "RECEBER" as const, categoriaCodigo: "R1",
      parceiroCodigo: "PAZ", parceiroNome: "AZUL TRANSPORTES E TURISMO LTDA", parceiroDocumento: "11111111000191",
      dataEmissao: new Date(2026, 8, 12), dataVencimento: new Date(2026, 8, 30), valorDocumentoCents: 450_000 },
    { ...comum(cx1, "AZ"), codigoLancamento: "IC2", natureza: "PAGAR" as const, categoriaCodigo: "D1",
      parceiroCodigo: "PMC", parceiroNome: "MCZ LTDA", parceiroDocumento: "22222222000272",
      dataEmissao: new Date(2026, 8, 13), dataVencimento: new Date(2026, 8, 14), valorDocumentoCents: 200_000,
      liquidado: true },
    // CPF que começa pelos mesmos oito dígitos de uma raiz: NÃO é empresa do
    // grupo (a raiz só vale para documento de 14 dígitos).
    { ...comum(cx1, "AZ"), codigoLancamento: "IC3", natureza: "PAGAR" as const, categoriaCodigo: "D2",
      parceiroCodigo: "PCPF", parceiroNome: "Pessoa Física", parceiroDocumento: "11111111099",
      dataEmissao: new Date(2026, 8, 14), dataVencimento: new Date(2026, 8, 15), valorDocumentoCents: 12_300 },

    // --- PESSOAS: a mesma categoria nas duas empresas ---
    { ...comum(cx1, "AZ"), codigoLancamento: "P1", natureza: "PAGAR" as const, categoriaCodigo: "D5",
      dataEmissao: new Date(2026, 8, 5), dataVencimento: new Date(2026, 8, 5), valorDocumentoCents: 150_100 },
    { ...comum(cx2, "MC"), codigoLancamento: "P2", natureza: "PAGAR" as const, categoriaCodigo: "D5",
      dataEmissao: new Date(2026, 8, 6), dataVencimento: new Date(2026, 8, 6), valorDocumentoCents: 60_700, liquidado: true },
    { ...comum(cx2, "MC"), codigoLancamento: "P3", natureza: "PAGAR" as const, categoriaCodigo: "D5",
      dataEmissao: new Date(2026, 7, 7), dataVencimento: new Date(2026, 7, 7), valorDocumentoCents: 55_500, liquidado: true },

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
      // A folha corporativa paga: no caixa ela também vai para a linha dela.
      { companyId: EMPRESA, conexaoId: conexaoDe("P2"), tituloId: idDe("P2"), chave: "K12",
        dataBaixa: new Date(2026, 8, 6), valorCents: 60_700 },
      // O pagamento da Azul à MCZ: no caixa do grupo também some.
      { companyId: EMPRESA, conexaoId: conexaoDe("IC2"), tituloId: idDe("IC2"), chave: "K11",
        dataBaixa: new Date(2026, 8, 14), valorCents: 200_000, jurosCents: 1_500 },
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
    // A classificação do DRE entra nos dois lados: é ela que tira
    // financiamento, tributo e receita da fila e define a receita de serviço.
    const estrategiaNoBanco = await analisarEstrategiaNoBanco(escopo, REFERENCIA);
    conferir(
      `estratégia de custo idêntica — ${alvo}`,
      estrategiaNoBanco,
      analisarEstrategiaDeCusto(ctx, await linhaPorCategoriaDoBanco(escopo))
    );
    // D3 ("ISS sobre faturamento") é proposto como DEDUCOES pela regex, e a
    // classificação manual manda D1 e D2 para CUSTO_SERVICO: o ISS sai da fila
    // e é listado à parte.
    conferir(`o tributo sai da fila de corte — ${alvo}`, estrategiaNoBanco.foraDoCorte.map((f) => f.codigo), ["D3"]);
  }

  // ------------------------------------------- planilha de conferência
  // A PLANILHA E A TELA PEDEM O MESMO RECORTE (`recorteMensalDoDre`). A
  // planilha montava o dela: contexto a partir de 1º de setembro, mês inteiro
  // contra agosto inteiro. O "mês anterior" dela perdia A12 (folha de agosto,
  // já liquidada, fora da janela de um mês) — a coluna que a tela mostrava com
  // R$ 2.107,00 saía zerada no arquivo.
  {
    const { recorteMensalDoDre } = await import("../src/lib/controladoria/dreNoBanco");
    const recorte = recorteMensalDoDre({ companyId: EMPRESA, conexaoId: null, dataReferencia: REFERENCIA });
    conferir("recorte da planilha: janela de treze meses", recorte.escopo.janela.desde, desdeMensal);
    conferir("recorte da planilha: mês até a referência", recorte.periodo, janelas.mesAtual);
    conferir("recorte da planilha: anterior é o mês fechado", recorte.periodoAnterior, janelas.mesAnterior);
    const dre = await montarDreNoBanco(recorte.escopo, recorte.periodo, recorte.periodoAnterior, classificacoes, {
      regime: "competencia",
      incluirTitulos: false,
    });
    conferir(
      // Agosto FECHADO: A12 (já liquidado) e o título emitido em 28/08.
      "o mês anterior da planilha é agosto inteiro, com o título já liquidado",
      dre.linhas.find((l) => l.chave === "CUSTO_SERVICO")?.valorAnteriorCents,
      210_700 + 91_100
    );
  }

  // --------------------------------------- operação entre as empresas
  // ELIMINADA NA VISÃO DO GRUPO, MANTIDA NA DE UMA EMPRESA. O teste diferencial
  // acima já exige que memória e SQL eliminem igual (IC1, IC2 e IC3 estão na
  // base); aqui, os valores que provam que a eliminação aconteceu — e que o
  // detalhe, a composição e o resumo do painel somam o mesmo que a linha.
  {
    const { resumoDoPeriodo } = await import("../src/lib/controladoria/analytics");
    const { resumoDoPeriodoNoBanco } = await import("../src/lib/controladoria/resumoNoBanco");
    const { detalharTitulos, detalharPerdas } = await import("../src/lib/controladoria/detalhamento");
    const { composicaoDoPeriodo } = await import("../src/lib/controladoria/composicao");
    const { intercompanyEliminado } = await import("../src/lib/controladoria/dreNoBanco");
    const mes = janelas.mesAtual;

    for (const conexaoId of [null, cx1.id]) {
      const alvo = conexaoId ? "uma empresa" : "grupo";
      const escopo = { companyId: EMPRESA, conexaoId, janela: { desde: desdeMensal, ate: null } };
      const ctx = await carregarContexto(EMPRESA, REFERENCIA, conexaoId ?? undefined, { desde: desdeMensal });
      const dre = await montarDreNoBanco(escopo, mes, janelas.mesAnterior, classificacoes, { regime: "competencia" });
      const dreCaixa = await montarDreNoBanco(escopo, mes, janelas.mesAnterior, classificacoes, { regime: "caixa" });
      const item = (r: typeof dre, codigo: string) =>
        r.linhas.flatMap((l) => l.itens).find((i) => i.categoriaCodigo === codigo)?.valorCents ?? 0;

      if (!conexaoId) {
        conferir("grupo: receita da MCZ contra a Azul não é receita", item(dre, "R1"), 900_100 + 450_200);
        conferir("grupo: pagamento da Azul à MCZ não é custo", item(dre, "D1"), 310_300 - 15_800);
        // No caixa até o dia 22: A3 (18/09); o estorno A9 é baixado dia 24.
        conferir("grupo: nem no caixa", item(dreCaixa, "D1"), 310_300);
        conferir("grupo: CPF com os mesmos 8 dígitos não é empresa do grupo", item(dre, "D2") >= 12_300, true);
        conferir("grupo: o que foi eliminado é dito", await intercompanyEliminado(escopo, mes, "competencia"), {
          receitaCents: 450_000,
          despesaCents: 200_000,
          titulos: 2,
        });
        conferir("grupo: o eliminado no caixa", await intercompanyEliminado(escopo, mes, "caixa"), {
          receitaCents: 0,
          despesaCents: 200_000,
          titulos: 1,
        });
      } else {
        conferir("uma empresa: o pagamento à MCZ é custo da Azul", item(dre, "D1"), 310_300 - 15_800 + 200_000);
        conferir("uma empresa: nada eliminado", await intercompanyEliminado(escopo, mes, "competencia"), {
          receitaCents: 0,
          despesaCents: 0,
          titulos: 0,
        });
      }

      // O resumo do painel: gêmeos iguais, e o detalhe que o cartão abre soma
      // o mesmo que o cartão.
      const resumoSql = await resumoDoPeriodoNoBanco({ companyId: EMPRESA, conexaoId, periodo: mes });
      conferir(`resumo do painel idêntico nos dois gêmeos — ${alvo}`, resumoSql, resumoDoPeriodo(ctx, mes));
      for (const natureza of ["RECEBER", "PAGAR"] as const) {
        const detalhe = await detalharTitulos({ companyId: EMPRESA, conexaoId, periodo: mes, natureza, dimensao: null });
        const composicao = await composicaoDoPeriodo({ companyId: EMPRESA, conexaoId, periodo: mes, natureza });
        const doCartao = natureza === "RECEBER" ? resumoSql.receitaCents : resumoSql.despesaCents;
        conferir(`detalhe ${natureza} soma o cartão — ${alvo}`, detalhe.totalCents, doCartao);
        conferir(`composição ${natureza} soma o cartão — ${alvo}`, composicao.totalCents, doCartao);
      }
      const juros = await detalharPerdas({ companyId: EMPRESA, conexaoId, periodo: mes, componente: "juros" });
      conferir(`detalhe dos juros soma o cartão — ${alvo}`, juros.totalCents, resumoSql.jurosCents);
      conferir(`juros pagos à MCZ ${conexaoId ? "contam" : "não contam"} — ${alvo}`, resumoSql.jurosCents, conexaoId ? 1_500 : 0);

      // O drill-down da categoria no DRE soma a linha da categoria.
      const r1 = dre.linhas.flatMap((l) => l.itens).find((i) => i.categoriaCodigo === "R1");
      conferir(
        `drill-down de R1 soma o item — ${alvo}`,
        (r1?.titulos ?? []).reduce((a, t) => a + t.valorCents, 0),
        r1?.valorCents ?? 0
      );
    }
  }

  // ------------------------------------------ pessoas: operação × corporativo
  // A LINHA GENÉRICA NÃO EXISTE MAIS. No grupo, as duas linhas; numa empresa
  // só, a dela — e a outra, sem item, fica vazia (a tela esconde). A mesma
  // categoria D5 aparece nas duas, cada parte com os seus títulos.
  {
    const linha = (r: { linhas: { chave: string; valorCents: number; valorAnteriorCents: number; itens: { categoriaCodigo: string; titulos: { id: string }[]; totalDeTitulos: number }[] }[] }, chave: string) =>
      r.linhas.find((l) => l.chave === chave)!;
    conferir("não há mais linha genérica de pessoas", LINHAS_DRE_ROTULOS.includes("(-) Despesas com pessoas"), false);
    for (const conexaoId of [null, cx1.id, cx2.id]) {
      const alvo = conexaoId === null ? "grupo" : conexaoId === cx1.id ? "Azul" : "MCZ";
      const escopo = { companyId: EMPRESA, conexaoId, janela: { desde: desdeMensal, ate: null } };
      const ctx = await carregarContexto(EMPRESA, REFERENCIA, conexaoId ?? undefined, { desde: desdeMensal });
      for (const regime of ["competencia", "caixa"] as const) {
        const banco = await montarDreNoBanco(escopo, janelas.mesAtual, janelas.mesAnterior, classificacoes, { regime });
        conferir(`pessoas: gêmeos iguais — ${alvo}, ${regime}`, banco, montarDre(ctx, janelas.mesAtual, janelas.mesAnterior, classificacoes, { regime }));
        if (regime === "caixa") continue;
        const operacao = linha(banco, "DESPESA_SALARIOS");
        const corporativo = linha(banco, "DESPESA_SALARIOS_CORPORATIVO");
        const esperado = {
          grupo: { op: 150_100, corp: 60_700, corpAnterior: 55_500 },
          Azul: { op: 150_100, corp: 0, corpAnterior: 0 },
          MCZ: { op: 0, corp: 60_700, corpAnterior: 55_500 },
        }[alvo]!;
        conferir(`pessoas — operação — ${alvo}`, operacao.valorCents, esperado.op);
        conferir(`pessoas — corporativo — ${alvo}`, corporativo.valorCents, esperado.corp);
        conferir(`pessoas — corporativo, mês anterior — ${alvo}`, corporativo.valorAnteriorCents, esperado.corpAnterior);
        conferir(
          `a linha da outra empresa fica sem item — ${alvo}`,
          [operacao.itens.length > 0, corporativo.itens.length > 0],
          [esperado.op !== 0, esperado.corp !== 0 || esperado.corpAnterior !== 0]
        );
        const d5corp = corporativo.itens.find((i) => i.categoriaCodigo === "D5");
        if (d5corp) {
          conferir(`drill-down corporativo só com títulos da MCZ — ${alvo}`, d5corp.titulos.map((t) => t.id), [idDe("P2")]);
          conferir(`contagem do drill-down corporativo — ${alvo}`, d5corp.totalDeTitulos, 1);
        }
      }
    }
    // OS CUSTOS REAIS DO SIMULADOR (e os indiretos da base) leem o mesmo DRE:
    // agosto fechado, no grupo, com a folha da MCZ na linha corporativa — e a
    // parte corporativa da categoria numa entrada própria.
    {
      const { carregarDreDosMeses } = await import("../src/lib/simulador/custosReais");
      const doze = await carregarDreDosMeses(EMPRESA, null, REFERENCIA);
      const agosto = doze.meses.indexOf("2026-08");
      conferir("custos reais: agosto é o último mês fechado", agosto, 11);
      conferir("custos reais: pessoas — corporativo de agosto igual ao DRE", doze.linhasDre.DESPESA_SALARIOS_CORPORATIVO[agosto], 55_500);
      // D5 só tem títulos da MCZ: a entrada é a corporativa, e a folha da
      // operação não recebe nada dela.
      const d5 = doze.categorias.filter((c) => c.codigo === "D5");
      conferir("custos reais: a categoria da MCZ fica na linha corporativa", d5.map((c) => [c.linha, c.porMesCents[agosto]]), [["DESPESA_SALARIOS_CORPORATIVO", 55_500]]);
    }

    // A LINHA CORPORATIVA POR CENTRO DE CUSTO: P2 (setembro) no departamento
    // Oficina da MCZ, P3 (agosto) sem departamento. A soma bate com a linha, e
    // a folha da Azul não entra.
    {
      const { pessoasCorporativoPorCentroDeCusto } = await import("../src/lib/controladoria/dreNoBanco");
      await prisma.omieDepartamento.create({ data: { companyId: EMPRESA, conexaoId: cx2.id, conexaoApelido: "MC", codigo: "OF", descricao: "Oficina" } });
      await prisma.omieTitulo.update({ where: { id: idDe("P2") }, data: { departamentoCodigo: "OF" } });
      const escopoGrupo = { companyId: EMPRESA, conexaoId: null, janela: { desde: desdeMensal, ate: null } };
      const centros = await pessoasCorporativoPorCentroDeCusto(escopoGrupo, janelas.mesAtual, janelas.mesAnterior, ["D5"], "competencia");
      conferir(
        "centro de custo: oficina no mês, sem centro no anterior",
        centros.map((c) => [c.descricao, c.atualCents, c.anteriorCents]),
        [["Oficina", 60_700, 0], ["Sem centro de custo", 0, 55_500]]
      );
      const grupo = await montarDreNoBanco(escopoGrupo, janelas.mesAtual, janelas.mesAnterior, classificacoes, { regime: "competencia" });
      const corp = grupo.linhas.find((l) => l.chave === "DESPESA_SALARIOS_CORPORATIVO")!;
      conferir(
        "centro de custo: a soma é a linha corporativa",
        [centros.reduce((a, c) => a + c.atualCents, 0), centros.reduce((a, c) => a + c.anteriorCents, 0)],
        [corp.valorCents, corp.valorAnteriorCents]
      );
      conferir(
        "centro de custo: a Azul não entra",
        (await pessoasCorporativoPorCentroDeCusto({ ...escopoGrupo, conexaoId: cx1.id }, janelas.mesAtual, janelas.mesAnterior, ["D5"], "competencia")).length,
        0
      );
      const caixa = await pessoasCorporativoPorCentroDeCusto(escopoGrupo, janelas.mesAtual, janelas.mesAnterior, ["D5"], "caixa");
      const corpCaixa = (await montarDreNoBanco(escopoGrupo, janelas.mesAtual, janelas.mesAnterior, classificacoes, { regime: "caixa" })).linhas.find((l) => l.chave === "DESPESA_SALARIOS_CORPORATIVO")!;
      conferir("centro de custo no caixa: a soma é a linha corporativa", caixa.reduce((a, c) => a + c.atualCents, 0), corpCaixa.valorCents);
      // O simulador: a oficina nos doze meses FECHADOS — P2 é de setembro
      // (fora); com P3 (agosto) na oficina, agosto entra.
      const { folhaDaOficina } = await import("../src/lib/simulador/indiretosDoDre");
      const { carregarDreDosMeses } = await import("../src/lib/simulador/custosReais");
      const doze = await carregarDreDosMeses(EMPRESA, null, REFERENCIA);
      conferir("oficina no simulador: setembro ainda não fechou", await folhaDaOficina(EMPRESA, REFERENCIA, doze), null);
      await prisma.omieTitulo.update({ where: { id: idDe("P3") }, data: { departamentoCodigo: "OF" } });
      const oficina = await folhaDaOficina(EMPRESA, REFERENCIA, doze);
      conferir("oficina no simulador: agosto na oficina", [oficina?.centros, oficina?.porMes[11], oficina?.porMes.slice(0, 11).every((v) => v === 0)], [["Oficina"], 55_500, true]);
      // Os lançamentos da planilha da administração: P3 (agosto, MCZ, centro
      // Oficina) cai na oficina, com o valor do título.
      const { lancamentosDosIndiretos } = await import("../src/lib/simulador/indiretosDoDre");
      const lancs = await lancamentosDosIndiretos(EMPRESA, REFERENCIA, doze, "");
      conferir(
        "lançamentos: a oficina de agosto é o título P3",
        lancs.filter((l) => l.indireto === "oficina").map((l) => [l.mes, l.centroDeCusto, Math.round(l.valor * 100)]),
        [["2026-08", "Oficina", 55_500]]
      );
      conferir("lançamentos: nada de setembro (mês aberto)", lancs.every((l) => l.mes <= "2026-08"), true);
      await prisma.omieTitulo.update({ where: { id: idDe("P3") }, data: { departamentoCodigo: null } });
      await prisma.omieTitulo.update({ where: { id: idDe("P2") }, data: { departamentoCodigo: null } });
    }

    // O resultado não muda com a separação: as duas linhas somam o que a
    // antiga somava, e o EBIT desconta as duas.
    const grupo = await montarDreNoBanco(
      { companyId: EMPRESA, conexaoId: null, janela: { desde: desdeMensal, ate: null } },
      janelas.mesAtual, janelas.mesAnterior, classificacoes, { regime: "competencia" }
    );
    const v = (c: string) => grupo.linhas.find((l) => l.chave === c)!.valorCents;
    conferir(
      "EBIT desconta as duas linhas de pessoas",
      v("EBIT"),
      v("LUCRO_BRUTO") - ["DESPESA_VEICULOS", "DESPESA_SALARIOS", "DESPESA_SERVICOS_TERCEIROS", "DESPESA_SALARIOS_CORPORATIVO", "DESPESA_SOCIOS",
        "DESPESA_ESTRUTURA", "DESPESA_INFORMATICA", "DESPESA_COMERCIAL", "DESPESA_ADMINISTRATIVA", "DESPESA_GERAL"]
        .reduce((a, c) => a + v(c), 0)
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

  // ------------------------------------------------------------ projeção
  // A base da projeção sai do MESMO DRE anual, ano a ano, e para no último
  // mês fechado: agosto, na referência de 22 de setembro. O número de que a
  // projeção parte é o número que a tela mostra como realizado.
  const { baseHistoricaNoBanco, classificacoesDoDre } = await import("../src/lib/controladoria/projecaoNoBanco");
  for (const conexaoId of [null, cx1.id]) {
    const alvo = conexaoId ? "uma empresa" : "consolidado";
    const baseProjecao = await baseHistoricaNoBanco({ companyId: EMPRESA, conexaoId }, REFERENCIA);
    const anualDaTela = await montarDreAnualNoBanco(
      { companyId: EMPRESA, conexaoId, janela: { desde: desdeAnual, ate: null } },
      2026,
      REFERENCIA,
      await classificacoesDoDre(EMPRESA),
      { regime: "competencia", somarRetencoes: false }
    );
    conferir(`base da projeção termina em ago/26 — ${alvo}`, baseProjecao.ultimaCompetenciaFechada, "2026-08");
    conferir(`setembro, parcial, fica fora da base — ${alvo}`, baseProjecao.competencias.includes("2026-09"), false);
    conferir(`setembro de 2025 está na base — ${alvo}`, baseProjecao.competencias.includes("2025-09"), true);
    for (const chave of ["RECEITA_BRUTA", "DEDUCOES", "CUSTO_SERVICO", "EBIT", "RESULTADO_LIQUIDO"] as const) {
      conferir(
        `${chave} de ago/26 na base = DRE anual da tela — ${alvo}`,
        baseProjecao.porLinha.get(chave)?.get("2026-08") ?? 0,
        anualDaTela.linhas.find((l) => l.chave === chave)!.porMes[7]
      );
    }
  }

  // ------------------------------------------------ o mês se formando
  // A montagem inteira roda no banco (sem erro de SQL) e a classificação do
  // mês em curso bate com o DRE da tela no mesmo recorte.
  {
    const { montarMesEmFormacao } = await import("../src/lib/controladoria/mesEmFormacao");
    const { classificacoesDoDre } = await import("../src/lib/controladoria/projecaoNoBanco");
    const gravadas = await classificacoesDoDre(EMPRESA);
    for (const conexaoId of [null, cx1.id]) {
      const alvo = conexaoId === null ? "grupo" : "Azul";
      const ctx = await carregarContexto(EMPRESA, REFERENCIA, conexaoId ?? undefined, { desde: desdeMensal });
      const mes = await montarMesEmFormacao(ctx);
      const dreDaTela = await montarDreNoBanco(
        { companyId: EMPRESA, conexaoId, janela: { desde: desdeMensal, ate: null } },
        mes.fechamento.periodo,
        janelas.mesAnterior,
        gravadas,
        { regime: "competencia", somarRetencoes: true }
      );
      const itens = dreDaTela.linhas.filter((l) => l.tipo === "GRUPO").flatMap((l) => l.itens).filter((i) => i.categoriaCodigo !== "RETENCAO_NA_FONTE");
      const movimento = itens.reduce((a, i) => a + Math.abs(i.valorCents), 0) + Math.abs(dreDaTela.semCategoriaCents);
      const naoConfirmado = itens.filter((i) => !i.confirmada).reduce((a, i) => a + Math.abs(i.valorCents), 0) + Math.abs(dreDaTela.semCategoriaCents);
      const esperado = movimento > 0 ? 1 - naoConfirmado / movimento : null;
      conferir(`mês em formação: base sem classificação confirmada dá 0% — ${alvo}`, esperado, gravadas.size === 0 ? 0 : esperado);
      const classificacao = mes.fechamento.itens.find((i) => i.chave === "CLASSIFICACAO")!.pronto;
      conferir(`mês em formação: setembro em curso — ${alvo}`, [mes.fechamento.periodo.rotulo, mes.fechamento.momento], ["set/26", "EM_CURSO"]);
      conferir(`mês em formação: classificação bate com o DRE da tela — ${alvo}`, classificacao === null ? null : Math.round(classificacao * 1e6), esperado === null ? null : Math.round(esperado * 1e6));
      conferir(`mês em formação: previsão de setembro montada — ${alvo}`, mes.previsao?.mes ?? null, "set/26");
      conferir(`mês em formação: cobrança sem título de outra empresa do grupo — ${alvo}`, mes.cobranca.every((c) => !/MCZ|Azul/i.test(c.cliente)), true);
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
