// TESTES DA PREVISÃO DE CAIXA POR CONTRATO — `npm run teste:previsao`.
//
// A regra é simples de enunciar e fácil de errar nas bordas: cada cliente é
// lido pelo próprio atraso típico; quem não tem amostra usa o do conjunto;
// título vencido além do padrão do cliente não entra na previsão. Errar aqui
// produz o pior tipo de número — uma previsão de caixa que parece precisa.
import {
  atrasoGlobal,
  comportamentoPorCliente,
  MINIMO_DE_AMOSTRA,
  preverRecebimentos,
  type BaixaParaPrevisao,
  type TituloParaPrevisao,
} from "../src/lib/controladoria/previsaoCaixa";

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(
    `${ok ? "  ok  " : "FALHA "} ${nome}${ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         obtido   ${JSON.stringify(real)}`}`
  );
}

const HOJE = new Date(2026, 8, 12); // 12/09/2026, local
const d = (dia: string) => {
  const [dd, mm, yyyy] = dia.split("/").map(Number);
  return new Date(yyyy, mm - 1, dd);
};

let seq = 0;
function titulo(cliente: string, vencimento: string, valor: number, liquidado = false): TituloParaPrevisao {
  seq++;
  return {
    id: `t${seq}`,
    natureza: "RECEBER",
    dataVencimento: d(vencimento),
    parceiroCodigo: cliente,
    parceiroNome: cliente,
    parceiroDocumento: null,
    conexaoApelido: "AZUL",
    saldoCents: liquidado ? 0 : valor,
    valorDocumentoCents: valor,
    valorPagoCents: liquidado ? valor : 0,
    liquidado,
    cancelado: false,
  };
}
function baixa(t: TituloParaPrevisao, data: string): BaixaParaPrevisao {
  return { tituloId: t.id, dataBaixa: d(data), valorCents: t.valorDocumentoCents };
}

// PREFEITURA: paga sempre ~60 dias depois do vencimento (4 baixas).
// CORPORATIVO: paga no dia (3 baixas).
// NOVO: nenhuma baixa — sem padrão próprio.
const pagos = [
  titulo("PREFEITURA", "01/01/2026", 1000, true),
  titulo("PREFEITURA", "01/02/2026", 1000, true),
  titulo("PREFEITURA", "01/03/2026", 1000, true),
  titulo("PREFEITURA", "01/04/2026", 1000, true),
  titulo("CORPORATIVO", "10/05/2026", 500, true),
  titulo("CORPORATIVO", "10/06/2026", 500, true),
  titulo("CORPORATIVO", "10/07/2026", 500, true),
];
const baixas = [
  baixa(pagos[0], "02/03/2026"), // 60 dias
  baixa(pagos[1], "01/04/2026"), // 59
  baixa(pagos[2], "31/05/2026"), // 91 — puxa para cima, mediana segura
  baixa(pagos[3], "31/05/2026"), // 60
  baixa(pagos[4], "10/05/2026"), // 0
  baixa(pagos[5], "11/06/2026"), // 1
  baixa(pagos[6], "10/07/2026"), // 0
];

console.log("\n1. O padrão de cada cliente");
const comp = comportamentoPorCliente(pagos, baixas);
const porNome = (nome: string) => [...comp.values()].find((c) => c.nome === nome)!;
{
  const p = porNome("PREFEITURA");
  conferir("prefeitura: mediana de atraso 60", p.atrasoMedianoDias, 60);
  conferir("prefeitura: pontualidade 0%", Math.round(p.pontualidadePercent), 0);
  const c = porNome("CORPORATIVO");
  conferir("corporativo: atraso 0", c.atrasoMedianoDias, 0);
  conferir("corporativo: pontualidade 100%", Math.round(c.pontualidadePercent), 100);
  conferir("amostra mínima é 3", MINIMO_DE_AMOSTRA, 3);
  conferir("atraso do conjunto = mediana dos clientes com amostra", atrasoGlobal(comp), 30);
}

console.log("\n2. Títulos em aberto, cliente a cliente");
const abertos = [
  // Prefeitura: venceu há 20 dias — pelo padrão dela (60), ainda vai pagar em ~40 dias.
  titulo("PREFEITURA", "23/08/2026", 10_000),
  // Prefeitura: venceu há 100 dias — passou do padrão: incerto.
  titulo("PREFEITURA", "04/06/2026", 7_000),
  // Corporativo: vence em 10 dias — entra em 10 dias.
  titulo("CORPORATIVO", "22/09/2026", 3_000),
  // Corporativo: venceu há 5 dias e o padrão é 0 — incerto (já deveria ter pago).
  titulo("CORPORATIVO", "07/09/2026", 2_000),
  // Novo, sem padrão: vence em 5 dias → usa o atraso do conjunto (30) → entra em 35 dias.
  titulo("NOVO", "17/09/2026", 1_000),
];
const prev = preverRecebimentos({ titulos: [...pagos, ...abertos], baixas, referencia: HOJE, horizontes: [7, 30, 45, 90] });
const linha = (nome: string) => prev.clientes.find((c) => c.nome === nome)!;
{
  const p = linha("PREFEITURA");
  conferir("prefeitura: em aberto 17.000", p.emAbertoCents, 17_000);
  conferir("prefeitura: tudo vencido", p.vencidoCents, 17_000);
  conferir("prefeitura: 7.000 incerto (além do padrão)", p.incertoCents, 7_000);
  conferir("prefeitura: 10.000 entra em 45 dias, não em 30", [p.previstoPorHorizonte[30], p.previstoPorHorizonte[45]], [0, 10_000]);
  conferir("prefeitura: padrão próprio 60 dias", p.atrasoMedianoDias, 60);
}
{
  const c = linha("CORPORATIVO");
  conferir("corporativo: 3.000 entra em 30 dias", c.previstoPorHorizonte[30], 3_000);
  conferir("corporativo: 2.000 vencido além do padrão = incerto", c.incertoCents, 2_000);
}
{
  const n = linha("NOVO");
  conferir("novo: sem padrão próprio", n.atrasoMedianoDias, null);
  conferir("novo: usa atraso do conjunto — entra em 45, não em 30", [n.previstoPorHorizonte[30], n.previstoPorHorizonte[45]], [0, 1_000]);
  conferir("um cliente sem padrão", prev.clientesSemPadrao, 1);
}

console.log("\n3. Contratual × realista por horizonte");
{
  const h30 = prev.porHorizonte.find((p) => p.dias === 30)!;
  // Contratual em 30 dias: só o que vence entre hoje e daqui a 30 — corporativo 3.000 e novo 1.000.
  conferir("contratual 30d = 4.000", h30.contratualCents, 4_000);
  conferir("realista 30d = 3.000 (só quem paga no prazo)", h30.realistaCents, 3_000);
  const h90 = prev.porHorizonte.find((p) => p.dias === 90)!;
  conferir("realista 90d = 14.000 (sem os 9.000 incertos)", h90.realistaCents, 14_000);
  conferir("incerto total 9.000", prev.incertoTotalCents, 9_000);
}

console.log("\n4. Bordas");
{
  const vazio = preverRecebimentos({ titulos: [], baixas: [], referencia: HOJE, horizontes: [30] });
  conferir("sem títulos: nada quebra", [vazio.clientes.length, vazio.porHorizonte[0].realistaCents, vazio.atrasoPadraoDias], [0, 0, 0]);
  // Título a PAGAR não entra na previsão de recebimentos.
  const pagar: TituloParaPrevisao = { ...titulo("FORNECEDOR", "20/09/2026", 999), natureza: "PAGAR" };
  const soPagar = preverRecebimentos({ titulos: [pagar], baixas: [], referencia: HOJE, horizontes: [30] });
  conferir("título a pagar ignorado", soPagar.clientes.length, 0);
}

console.log(falhas === 0 ? "\nTodos os testes passaram.\n" : `\n${falhas} FALHA(S).\n`);
process.exit(falhas === 0 ? 0 : 1);
