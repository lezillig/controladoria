import { prisma } from "@/lib/prisma";
import { criarPendencia } from "@/lib/auditoria/pendencias";
import { conciliarParcelasOmie } from "./parcelasOmie";
import { contratosComSituacao } from "./contratosDaGestao";

// O AGENTE DIÁRIO DOS FINANCIAMENTOS (docs/plataforma/docs/04-padrao-de-agentes.md):
// coleta → compara → aponta exceção → pendência para o Financeiro. Roda uma
// vez por dia, depois da sincronização da Omie:
//
//   1. liga as parcelas dos contratos da gestão aos títulos da Omie
//      (parcelasOmie.ts);
//   2. parcela vencida e não paga na Omie → pendência para o Financeiro;
//      parcela que vence em 60 dias e não foi lançada → pendência.
//
// A quitação (última parcela paga) não abre pendência aqui: vai para a gestão
// pela integração, e lá se encerra o contrato e se pede a baixa do gravame.
// A pendência é idempotente pela chave (contrato + tipo): reaparecer amanhã
// atualiza a mesma, não abre outra.

const AGENTE = "agente-frota";

// Os processos de veículo, motorista e multa passaram para a gestão. O que
// eles deixaram esperando decisão aqui é encerrado, com o motivo, para não
// ficar na fila de ninguém.
const TIPOS_QUE_FORAM_PARA_A_GESTAO = [
  "alocacao-com-impedimento",
  "apolice",
  "baixa-gravame",
  "checklist-saida",
  "compra-veiculo",
  "contrato-quitado",
  "desconto-multa",
  "documento-pessoa-vencido",
  "documento-vencido",
  "escala-sem-aptidao",
  "ferias-a-programar",
  "ferias-vencidas",
  "inclusao-veiculo",
  "ligar-contrato",
  "multa-indicacao",
  "multa-termo-recusado",
  "multas-conferencia-financeiro",
  "multas-conferencia-folha",
  "multas-eventos-folha",
  "multas-prazo-perdido",
  "saida-veiculo",
];

export type ResultadoAgenteFinanciamentos = { parcelasLigadas: number; pendencias: number; encerradas: number; gestaoIndisponivel?: boolean; jaRodouHoje?: boolean };

async function pendencia(p: Parameters<typeof criarPendencia>[0]) {
  const r = await criarPendencia(p);
  if (!r.nova) await prisma.audPendencia.update({ where: { id: r.id }, data: { titulo: p.titulo, descricao: p.descricao, evidencias: p.evidencias, severidade: p.severidade } });
  return r.nova ? 1 : 0;
}

export async function encerrarPendenciasQueForamParaAGestao(companyId: string): Promise<number> {
  const r = await prisma.audPendencia.updateMany({
    where: { companyId, status: "aguardando_aprovacao", tipo: { in: TIPOS_QUE_FORAM_PARA_A_GESTAO } },
    data: { status: "rejeitada", decididaPor: "sistema", decididaEm: new Date(), comentario: "Encerrada sem decisão: veículos, motoristas e multas passaram a ser tratados no sistema de gestão." },
  });
  return r.count;
}

export async function rodarAgenteFinanciamentos(companyId: string, hoje = new Date(), forcar = false): Promise<ResultadoAgenteFinanciamentos> {
  const marca = `frota:${hoje.toISOString().slice(0, 10)}`;
  if (!forcar && (await prisma.audLog.findFirst({ where: { companyId, tabela: "Agente", registroId: marca }, select: { id: true } }))) {
    return { parcelasLigadas: 0, pendencias: 0, encerradas: 0, jaRodouHoje: true };
  }
  const encerradas = await encerrarPendenciasQueForamParaAGestao(companyId);
  const conciliacao = await conciliarParcelasOmie(companyId);
  let pendencias = 0;
  const { contratos, gestaoDisponivel } = await contratosComSituacao(companyId, hoje);
  for (const c of contratos.filter((x) => !x.situacao.quitado)) {
    const nome = `${c.instituicao} ${c.contratoNumero ?? `${c.grupo}/${c.cota}`}`;
    const placas = c.veiculos.map((v) => v.veiculo.placa);
    if (c.situacao.atrasadas.quantidade > 0) {
      pendencias += await pendencia({
        companyId,
        agente: AGENTE,
        tipo: "parcela-atraso",
        titulo: `${nome}: ${c.situacao.atrasadas.quantidade} parcela(s) em atraso na Omie`,
        descricao: `Parcela(s) vencida(s) e não paga(s) nas contas a pagar: ${(c.situacao.atrasadas.valorCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}${placas.length ? ` (${placas.join(", ")})` : ""}. Atraso em financiamento com alienação arrisca a busca do veículo. Aprovar = ciente (pagamento providenciado ou baixa a lançar na Omie).`,
        severidade: "alta",
        evidencias: { financiamentoId: c.id, atrasadas: c.situacao.atrasadas, placas },
        perfilAprovador: "financeiro",
        chaveExcecao: `frota-parcela-atraso:${c.id}`,
      });
    }
    if (c.situacao.naoLancadas > 0) {
      pendencias += await pendencia({
        companyId,
        agente: AGENTE,
        tipo: "parcela-nao-lancada",
        titulo: `${nome}: ${c.situacao.naoLancadas} parcela(s) a vencer não lançada(s) na Omie`,
        descricao: "O contrato prevê parcela nos próximos 60 dias que não está nas contas a pagar da Omie — sem o lançamento, o fluxo de caixa não a enxerga. Lançar na Omie.",
        severidade: "media",
        evidencias: { financiamentoId: c.id, naoLancadas: c.situacao.naoLancadas, proximoVencimento: c.situacao.proximoVencimento },
        perfilAprovador: "financeiro",
        chaveExcecao: `frota-parcela-nao-lancada:${c.id}`,
      });
    }
  }
  const resultado = { parcelasLigadas: conciliacao.ligacoes, pendencias, encerradas, ...(gestaoDisponivel ? {} : { gestaoIndisponivel: true }) };
  // Com a gestão fora do ar, não marca o dia: a próxima rodada tenta de novo.
  if (gestaoDisponivel) await prisma.audLog.create({ data: { companyId, agente: AGENTE, tabela: "Agente", registroId: marca, operacao: "insert", depois: resultado } });
  return resultado;
}
