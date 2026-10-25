// O CAIXA MÊS A MÊS E A AUDITORIA DE CONTA — `npm run teste:caixa-mensal`.
//
// 1. A conta pura: saldo encadeado (final de um mês = inicial do seguinte),
//    geração, margem, horizontal, previsto × realizado; o grupo do fluxo.
// 2. A auditoria pura: funcionário por CPF e por nome, empresa do grupo,
//    salário para quem não é funcionário, duplicidade, saída sem título.
// 3. Com Postgres (TESTE_DATABASE_URL): a colheita no banco — transferência
//    entre contas pelo par, categoria herdada do título baixado, saldo inicial.
import { PrismaClient } from "@prisma/client";
import { caixaMesAMes, grupoDoFluxo } from "../src/lib/controladoria/caixaMensal";
import { auditarConta, type MovimentoDaConta } from "../src/lib/controladoria/auditoriaDeConta";

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "  ok  " : "FALHA "} ${nome}${ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         veio     ${JSON.stringify(real)}`}`);
}

function pura() {
  console.log("\nCaixa mês a mês");
  const meses = caixaMesAMes({
    saldoInicialCents: 1000_00,
    desde: "2026-11",
    ate: "2027-01",
    somas: [
      { mes: "2026-11", grupo: "Recebimentos de clientes", entrada: true, cents: 500_00 },
      { mes: "2026-11", grupo: "Pessoal", entrada: false, cents: -300_00 },
      { mes: "2026-11", grupo: "Transferências entre contas", entrada: false, cents: -100_00 },
      { mes: "2027-01", grupo: "Recebimentos de clientes", entrada: true, cents: 250_00 },
      { mes: "2027-01", grupo: "Impostos", entrada: false, cents: -500_00 },
    ],
    previsto: [
      { mes: "2026-11", natureza: "RECEBER", cents: 1000_00 },
      { mes: "2026-11", natureza: "PAGAR", cents: 400_00 },
    ],
  });
  conferir("meses do período, inclusive o vazio", meses.map((m) => m.mes), ["2026-11", "2026-12", "2027-01"]);
  conferir("saldo encadeado", meses.map((m) => [m.saldoInicialCents, m.saldoFinalCents]), [[1000_00, 1100_00], [1100_00, 1100_00], [1100_00, 850_00]]);
  conferir("geração e margem", [meses[0].geracaoCents, meses[0].margemCaixa], [100_00, 0.2]);
  conferir("saídas por grupo (positivas)", meses[0].saidasPorGrupo, { Pessoal: 300_00, "Transferências entre contas": 100_00 });
  conferir("previsto × realizado sem transferências", [meses[0].realizadoReceber, meses[0].realizadoPagar], [0.5, 0.75]);
  conferir("horizontal contra mês vazio é nula", [meses[1].variacaoEntradas, meses[2].variacaoEntradas], [-1, null]);

  console.log("\nGrupo do fluxo");
  conferir("transferência manda", grupoDoFluxo("RECEITA_BRUTA", true, true), "Transferências entre contas");
  conferir("receita", grupoDoFluxo("RECEITA_BRUTA", true, false), "Recebimentos de clientes");
  conferir("custo do serviço", grupoDoFluxo("CUSTO_SERVICO", false, false), "Custos variáveis (operação)");
  conferir("salários", grupoDoFluxo("DESPESA_SALARIOS", false, false), "Pessoal");
  conferir("sem categoria", grupoDoFluxo(null, false, false), "Sem categoria");

  console.log("\nAuditoria da conta");
  const d = (dia: number) => new Date(Date.UTC(2026, 8, dia));
  let n = 0;
  const mov = (x: Partial<MovimentoDaConta>): MovimentoDaConta => ({
    id: `m${++n}`, origem: "extrato", data: d(10), valorCents: -100_00, beneficiario: null, documento: null, categoria: null, observacao: null,
    tituloId: `t${n}`, tituloNumero: null, usuario: "ana", parceiroPrimeiraVez: null, parceiroContaAlteradaEm: null, alteracoesDepois: [], ...x,
  });
  const r = auditarConta({
    raizesDoGrupo: ["11111111"],
    funcionarios: [{ nome: "João da Silva", cpf: "123.456.789-01", empresa: "MCZ" }, { nome: "Maria Souza", cpf: null, empresa: "AZUL" }],
    movimentos: [
      mov({ beneficiario: "JOAO DA SILVA", documento: "12345678901", categoria: "Salários", valorCents: -2000_00 }),
      mov({ beneficiario: "Maria Souza", categoria: "Adiantamento salarial", valorCents: -500_00 }),
      mov({ beneficiario: "AZUL TRANSPORTES LTDA", documento: "11111111000191", valorCents: -5000_00 }),
      // Salário para quem não está no cadastro nem no quadro.
      mov({ beneficiario: "Fulano Externo", documento: "98765432100", categoria: "Salários", valorCents: -1500_00, data: d(3) }),
      mov({ beneficiario: "Fulano Externo", documento: "98765432100", categoria: "Salários", valorCents: -1500_00, data: d(8) }),
      // Saída do extrato sem título, valor redondo, num sábado (12/09/2026).
      mov({ beneficiario: "POSTO X LTDA", documento: "22222222000100", tituloId: null, valorCents: -1000_00, data: d(12) }),
      mov({ valorCents: 9000_00, beneficiario: "CLIENTE" }),
    ],
  });
  conferir("não funcionários (o grupo à parte pelo tipo)", r.naoFuncionarios.map((b) => [b.nome, b.tipo, b.totalCents]), [
    ["AZUL TRANSPORTES LTDA", "empresa do grupo", 5000_00],
    ["Fulano Externo", "pessoa física", 3000_00],
    ["POSTO X LTDA", "empresa", 1000_00],
  ]);
  conferir("funcionário por CPF e por nome", r.beneficiarios.filter((b) => b.tipo === "funcionário").map((b) => b.comoFuncionario), ["CPF no cadastro (MCZ)", "nome (AZUL)"]);
  const regras = (regra: string) => r.achados.filter((a) => a.regra === regra).map((a) => [a.beneficiario, a.valorCents]);
  conferir("salário para não funcionário", regras("PESSOAL_PARA_NAO_FUNCIONARIO"), [["Fulano Externo", 3000_00]]);
  conferir("duplicidade em 7 dias", regras("DUPLICIDADE"), [["Fulano Externo", 1500_00]]);
  conferir("saída sem título, redonda, no sábado", [regras("SAIDA_SEM_TITULO"), regras("VALOR_REDONDO"), regras("FIM_DE_SEMANA")], [[["POSTO X LTDA", 1000_00]], [["POSTO X LTDA", 1000_00]], [["POSTO X LTDA", 1000_00]]]);
  conferir("totais", [r.entradasCents, r.saidasCents], [9000_00, 11500_00]);
}

async function banco() {
  const url = process.env.TESTE_DATABASE_URL;
  if (!url) {
    console.log("\nTESTE_DATABASE_URL não definida — pulando a colheita no banco.");
    return;
  }
  console.log("\nNo banco");
  process.env.DATABASE_URL = url;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const { caixaMensalNoBanco } = await import("../src/lib/controladoria/caixaMensalNoBanco");
  const { auditoriaDeContaNoBanco, contasCorrentes, pagamentosAoNome } = await import("../src/lib/controladoria/auditoriaDeContaNoBanco");
  const E = "empresa-caixa-mensal";
  const limpar = async () => {
    await prisma.omieMovimento.deleteMany({ where: { companyId: E } });
    await prisma.omieTitulo.deleteMany({ where: { companyId: E } });
    await prisma.omieContaCorrente.deleteMany({ where: { companyId: E } });
    await prisma.omieCategoria.deleteMany({ where: { companyId: E } });
    await prisma.omieConexao.deleteMany({ where: { companyId: E } });
  };
  await limpar();
  try {
    const az = await prisma.omieConexao.create({ data: { companyId: E, nome: "Azul", apelido: "AZ", credencialRef: "AZ", cnpj: "11111111000191" } });
    const mc = await prisma.omieConexao.create({ data: { companyId: E, nome: "MCZ", apelido: "MC", credencialRef: "MC", cnpj: "22222222000191", papelNoGrupo: "CORPORATIVO" } });
    await prisma.omieContaCorrente.createMany({
      data: [
        { companyId: E, conexaoId: az.id, conexaoApelido: "AZ", codigo: "1", descricao: "Itaú", saldoInicialCents: 1000_00 },
        { companyId: E, conexaoId: mc.id, conexaoApelido: "MC", codigo: "9", descricao: "Omie.CASH", saldoInicialCents: 0 },
      ],
    });
    await prisma.omieCategoria.createMany({
      data: [
        { companyId: E, conexaoId: az.id, conexaoApelido: "AZ", codigo: "1.01", descricao: "Clientes - Serviços Prestados", contaReceita: true },
        { companyId: E, conexaoId: mc.id, conexaoApelido: "MC", codigo: "2.01", descricao: "Salários", contaDespesa: true },
      ],
    });
    await prisma.dreClassificacao.deleteMany({ where: { companyId: E } });
    await prisma.dreClassificacao.createMany({
      data: [
        { companyId: E, categoriaCodigo: "1.01", linha: "RECEITA_BRUTA", origem: "CONFIRMADA" },
        { companyId: E, categoriaCodigo: "2.01", linha: "DESPESA_SALARIOS", origem: "CONFIRMADA" },
      ],
    });
    const titulo = await prisma.omieTitulo.create({
      data: { companyId: E, conexaoId: mc.id, conexaoApelido: "MC", codigoLancamento: "T1", natureza: "PAGAR", status: "PAGO", categoriaCodigo: "2.01", parceiroNome: "Fulano Externo", valorDocumentoCents: 300_00, valorPagoCents: 300_00, dataVencimento: new Date(Date.UTC(2026, 8, 10)), contaCorrenteCodigo: "9" },
    });
    await prisma.omieTitulo.create({
      data: { companyId: E, conexaoId: az.id, conexaoApelido: "AZ", codigoLancamento: "R1", natureza: "RECEBER", status: "ABERTO", categoriaCodigo: "1.01", parceiroNome: "Cliente", valorDocumentoCents: 1000_00, dataVencimento: new Date(Date.UTC(2026, 8, 15)), contaCorrenteCodigo: "1" },
    });
    await prisma.omieBaixa.create({ data: { companyId: E, conexaoId: mc.id, tituloId: titulo.id, chave: "B1", dataBaixa: new Date(Date.UTC(2026, 8, 10)), valorCents: 300_00, contaCorrenteCodigo: "9", lancamentoCCCodigo: "X3" } });
    let n = 0;
    const m = (x: { conexaoId: string; conexaoApelido: string; contaCorrenteCodigo: string; data: Date; valorCents: number } & Record<string, unknown>) => ({ companyId: E, codigoLancamento: `X${++n}`, ...x });
    await prisma.omieMovimento.createMany({
      data: [
        // Antes do período: entra no saldo inicial.
        m({ conexaoId: az.id, conexaoApelido: "AZ", contaCorrenteCodigo: "1", data: new Date(Date.UTC(2026, 7, 20)), valorCents: 200_00, categoriaCodigo: "1.01" }),
        // Recebimento de cliente.
        m({ conexaoId: az.id, conexaoApelido: "AZ", contaCorrenteCodigo: "1", data: new Date(Date.UTC(2026, 8, 5)), valorCents: 800_00, categoriaCodigo: "1.01" }),
        // A saída da Omie.CASH que baixou o título de salário (sem categoria na linha).
        m({ conexaoId: mc.id, conexaoApelido: "MC", contaCorrenteCodigo: "9", data: new Date(Date.UTC(2026, 8, 10)), valorCents: -300_00, parceiroNome: "Fulano Externo" }),
        // Transferência Azul Itaú → MCZ Omie.CASH, as duas pontas sem categoria.
        m({ conexaoId: az.id, conexaoApelido: "AZ", contaCorrenteCodigo: "1", data: new Date(Date.UTC(2026, 8, 7)), valorCents: -400_00 }),
        m({ conexaoId: mc.id, conexaoApelido: "MC", contaCorrenteCodigo: "9", data: new Date(Date.UTC(2026, 8, 8)), valorCents: 400_00 }),
        // Saída sem categoria e sem par: "sem categoria".
        m({ conexaoId: mc.id, conexaoApelido: "MC", contaCorrenteCodigo: "9", data: new Date(Date.UTC(2026, 8, 20)), valorCents: -50_00, parceiroNome: "Posto X", observacao: "abastecimento" }),
      ],
    });
    const desde = new Date(Date.UTC(2026, 8, 1));
    const ate = new Date(Date.UTC(2026, 9, 31, 23, 59, 59));
    const g = await caixaMensalNoBanco({ companyId: E, conexaoId: null, contaCodigo: null, desde, ate });
    const set = g.meses[0];
    conferir("saldo inicial do grupo", g.saldoInicialCents, 1200_00);
    conferir("entradas do grupo por grupo", set.entradasPorGrupo, { "Recebimentos de clientes": 800_00, "Transferências entre contas": 400_00 });
    conferir("saídas do grupo por grupo (categoria herdada do título)", set.saidasPorGrupo, { "Transferências entre contas": 400_00, Pessoal: 300_00, "Sem categoria": 50_00 });
    conferir("saldo final encadeado", [set.saldoFinalCents, g.meses[1].saldoInicialCents], [1650_00, 1650_00]);
    conferir("previsto", [set.previstoReceberCents, set.previstoPagarCents], [1000_00, 300_00]);

    const c = await caixaMensalNoBanco({ companyId: E, conexaoId: mc.id, contaCodigo: "9", desde, ate });
    conferir("só a Omie.CASH", [c.saldoInicialCents, c.meses[0].entradasCents, c.meses[0].saidasCents, c.meses[0].previstoReceberCents], [0, 400_00, 350_00, 0]);

    const { padrao } = await contasCorrentes(E);
    conferir("conta padrão é a Omie.CASH da corporativa", padrao?.descricao, "Omie.CASH");
    const a = await auditoriaDeContaNoBanco({ companyId: E, conexaoId: mc.id, contaCodigo: "9", desde, ate });
    conferir("auditoria: beneficiários da Omie.CASH", a.naoFuncionarios.map((b) => [b.nome, b.totalCents, b.categorias]), [["Fulano Externo", 300_00, ["Salários"]], ["Posto X", 50_00, []]]);
    conferir("auditoria: salário a não funcionário", a.achados.filter((x) => x.regra === "PESSOAL_PARA_NAO_FUNCIONARIO").map((x) => x.beneficiario), ["Fulano Externo"]);
    const p = await pagamentosAoNome({ companyId: E, nome: "fulano", desde, ate });
    conferir("pagamentos ao nome", [p.titulos.map((t) => [t.valorPagoCents, t.contas]), p.extrato.length], [[[300_00, ["Omie.CASH"]]], 1]);
  } finally {
    await prisma.dreClassificacao.deleteMany({ where: { companyId: E } });
    await limpar();
    await prisma.$disconnect();
  }
}

(async () => {
  pura();
  await banco();
  console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
})();
