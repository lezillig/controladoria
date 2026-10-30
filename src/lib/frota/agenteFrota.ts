import { prisma } from "@/lib/prisma";
import { criarPendencia } from "@/lib/auditoria/pendencias";
import { enviarEmail } from "@/lib/email/send";
import { alertaDoDocumento, TIPO_DOCUMENTO } from "./documentos";
import { coberturaDeApolice, EM_OPERACAO, ROTULO_COBERTURA } from "./controles";
import { conciliarParcelasOmie } from "./parcelasOmie";
import { contratosComSituacao } from "./frotaNoBanco";
import { atualizarFipeDoMes, type ResultadoFipeMensal } from "./fipeMensal";

// O AGENTE DIÁRIO DA FROTA (docs/plataforma/docs/04-padrao-de-agentes.md):
// coleta → compara → aponta exceção → pendência (para uma pessoa decidir) e
// aviso por e-mail. Roda uma vez por dia, depois da sincronização da Omie:
//
//   1. liga as parcelas dos contratos aos títulos da Omie (parcelasOmie.ts);
//   2. documento vencido em veículo em operação → pendência para a Operação;
//   3. veículo em operação sem apólice ativa → pendência crítica; apólice de
//      outro segmento → pendência para conferir;
//   4. parcela vencida e não paga na Omie → pendência para o Financeiro;
//      parcela que vence em 60 dias e não foi lançada → pendência;
//   5. e-mail aos destinatários da frota quando algum documento ou apólice
//      chega hoje a 60, 30 ou 7 dias, ou venceu ontem — não todo dia;
//   6. quando sai a tabela FIPE do mês, relê o valor dos modelos escolhidos.
// A pendência é idempotente pela chave (veículo/contrato + tipo): reaparecer
// amanhã atualiza a mesma, não abre outra.

const AGENTE = "agente-frota";
const MARCOS = [60, 30, 7, -1];
const diasAte = (d: Date, hoje: Date) => Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate())) / 86_400_000);

export type ResultadoAgenteFrota = { parcelasLigadas: number; pendencias: number; aviso: string | null; fipe?: ResultadoFipeMensal; jaRodouHoje?: boolean };

async function pendencia(p: Parameters<typeof criarPendencia>[0]) {
  const r = await criarPendencia(p);
  if (!r.nova) await prisma.audPendencia.update({ where: { id: r.id }, data: { titulo: p.titulo, descricao: p.descricao, evidencias: p.evidencias, severidade: p.severidade } });
  return r.nova ? 1 : 0;
}

export async function rodarAgenteFrota(companyId: string, hoje = new Date(), forcar = false): Promise<ResultadoAgenteFrota> {
  const marca = `frota:${hoje.toISOString().slice(0, 10)}`;
  if (!forcar && (await prisma.audLog.findFirst({ where: { companyId, tabela: "Agente", registroId: marca }, select: { id: true } }))) {
    return { parcelasLigadas: 0, pendencias: 0, aviso: null, jaRodouHoje: true };
  }
  const veiculos = await prisma.cadVeiculo.findMany({ where: { companyId, status: { in: EM_OPERACAO } }, include: { documentos: true, apolice: true } });
  let pendencias = 0;
  let parcelasLigadas = 0;
  if ((await prisma.frotaFinanciamento.count({ where: { companyId } })) > 0) parcelasLigadas = (await conciliarParcelasOmie(companyId)).ligacoes;

  const avisos: string[] = [];
  for (const v of veiculos) {
    const nome = v.placa ?? `chassi …${(v.chassi ?? "").slice(-6)}`;
    const docs = v.documentos.map((d) => ({ d, alerta: alertaDoDocumento(d, hoje) }));
    const vencidos = docs.filter((x) => x.alerta === "vencido");
    if (vencidos.length) {
      pendencias += await pendencia({
        companyId,
        agente: AGENTE,
        tipo: "documento-vencido",
        titulo: `${nome}: ${vencidos.length} documento(s) vencido(s)`,
        descricao: `${vencidos.map((x) => `${TIPO_DOCUMENTO.get(x.d.tipo)?.rotulo ?? x.d.tipo} venceu em ${x.d.validade?.toISOString().slice(0, 10).split("-").reverse().join("/")}`).join("; ")}. Veículo ${v.alocacao ? `rodando em ${v.alocacao}` : "em operação"}: renovar ou tirar de operação. Aprovar = ciente e providenciando.`,
        severidade: "alta",
        evidencias: { veiculoId: v.id, placa: v.placa, documentos: vencidos.map((x) => ({ tipo: x.d.tipo, validade: x.d.validade })) },
        perfilAprovador: "operacao",
        chaveExcecao: `frota-doc-vencido:${v.id}`,
      });
    }
    for (const { d } of docs) {
      if (!d.validade || d.situacao === "nao_se_aplica") continue;
      const dias = diasAte(d.validade, hoje);
      if (MARCOS.includes(dias)) avisos.push(`${nome} — ${TIPO_DOCUMENTO.get(d.tipo)?.rotulo ?? d.tipo}: ${dias < 0 ? "venceu ontem" : `vence em ${dias} dias`} (${d.validade.toISOString().slice(0, 10).split("-").reverse().join("/")})`);
    }
    const cobertura = coberturaDeApolice(v, v.apolice, hoje);
    if (["sem_apolice", "vencida", "segmento_incompativel", "sem_vencimento"].includes(cobertura)) {
      pendencias += await pendencia({
        companyId,
        agente: AGENTE,
        tipo: "apolice",
        titulo: `${nome}: ${ROTULO_COBERTURA[cobertura as keyof typeof ROTULO_COBERTURA]}`,
        descricao: `Veículo em operação${v.alocacao ? ` (${v.alocacao})` : ""} ${cobertura === "segmento_incompativel" ? `com apólice ${v.apolice?.descricao} para uso ${v.categoriaUso}` : "sem cobertura de APP/RCF"}. Incluir na apólice certa ou tirar de operação.`,
        severidade: cobertura === "segmento_incompativel" || cobertura === "sem_vencimento" ? "media" : "critica",
        evidencias: { veiculoId: v.id, placa: v.placa, apolice: v.apolice?.descricao ?? null, cobertura },
        perfilAprovador: "operacao",
        chaveExcecao: `frota-apolice:${v.id}`,
      });
    }
    const fimApolice = v.apoliceVencimento ?? v.apolice?.vigenciaFim ?? null;
    if (fimApolice && [45, 15, -1].includes(diasAte(fimApolice, hoje))) avisos.push(`${nome} — apólice ${v.apolice?.descricao ?? ""}: ${diasAte(fimApolice, hoje) < 0 ? "venceu ontem" : `vence em ${diasAte(fimApolice, hoje)} dias`}`);
  }

  const contratos = await contratosComSituacao(companyId, hoje);
  for (const c of contratos.filter((x) => !x.situacao.quitado)) {
    const nome = `${c.instituicao} ${c.contratoNumero ?? `${c.grupo}/${c.cota}`}`;
    if (c.situacao.atrasadas.quantidade > 0) {
      pendencias += await pendencia({
        companyId,
        agente: AGENTE,
        tipo: "parcela-atraso",
        titulo: `${nome}: ${c.situacao.atrasadas.quantidade} parcela(s) em atraso na Omie`,
        descricao: `Parcela(s) vencida(s) e não paga(s) nas contas a pagar: ${(c.situacao.atrasadas.valorCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}. Atraso em financiamento com alienação arrisca a busca do veículo. Aprovar = ciente (pagamento providenciado ou baixa a lançar na Omie).`,
        severidade: "alta",
        evidencias: { financiamentoId: c.id, atrasadas: c.situacao.atrasadas },
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

  let aviso: string | null = null;
  if (avisos.length) {
    const config = await prisma.controladoriaConfig.findUnique({ where: { companyId }, select: { emailsFrota: true } });
    const para = (config?.emailsFrota ?? "").split(/[,;\s]+/).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
    if (para.length) {
      const r = await enviarEmail({
        para,
        assunto: `Frota: ${avisos.length} vencimento(s) para acompanhar`,
        texto: `Vencimentos da frota\n\n${avisos.join("\n")}\n\nDetalhes em Frota › Vencimentos e apólices.`,
        html: `<p><strong>Vencimentos da frota</strong></p><ul>${avisos.map((a) => `<li>${a.replace(/[<>&]/g, "")}</li>`).join("")}</ul><p>Detalhes em Frota › Vencimentos e apólices.</p>`,
      });
      aviso = r.enviado ? `e-mail com ${avisos.length} aviso(s) para ${para.length} destinatário(s)` : `e-mail não enviado: ${r.erro}`;
    } else aviso = `${avisos.length} aviso(s) sem destinatário configurado`;
  }
  const fipe = await atualizarFipeDoMes(companyId, AGENTE);
  await prisma.audLog.create({ data: { companyId, agente: AGENTE, tabela: "Agente", registroId: marca, operacao: "insert", depois: { parcelasLigadas, pendencias, avisos: avisos.length, aviso, fipe } } });
  return { parcelasLigadas, pendencias, aviso, fipe };
}
