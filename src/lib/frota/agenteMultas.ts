import { prisma } from "@/lib/prisma";
import { criarPendencia } from "@/lib/auditoria/pendencias";
import { competenciaDoDesconto, prazoDeIndicacao } from "./multas";
import { conciliarPagamentosOmie, sugerirCondutores } from "./multasNoBanco";

// O PASSO DAS MULTAS NO AGENTE DIÁRIO DA FROTA:
//   1. pagamento achado na Omie pelo AIT → multa paga;
//   2. condutor sugerido pela escala e pelo uso do veículo;
//   3. prazo de indicação em até 7 dias → pendência por multa (perfil
//      multas); prazos já perdidos → UMA pendência com a lista (risco de NIC);
//   4. termo assinado sem desconto → pendência do RH para aprovar o desconto
//      em folha (a aprovação grava a competência e o valor);
//   5. motorista recusou o termo → pendência para decidir (indicar mesmo
//      assim, ou a empresa assume).

const AGENTE = "agente-frota";
const br = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join("/");
const reais = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

async function pendencia(p: Parameters<typeof criarPendencia>[0]) {
  const r = await criarPendencia(p);
  if (!r.nova) await prisma.audPendencia.update({ where: { id: r.id }, data: { titulo: p.titulo, descricao: p.descricao, evidencias: p.evidencias, severidade: p.severidade } });
  return r.nova ? 1 : 0;
}

export type ResultadoMultasAgente = { pagas: number; sugeridas: number; pendencias: number };

export async function rodarPassoMultas(companyId: string, hoje: Date): Promise<ResultadoMultasAgente> {
  if ((await prisma.frotaMulta.count({ where: { companyId } })) === 0) return { pagas: 0, sugeridas: 0, pendencias: 0 };
  const pagas = await conciliarPagamentosOmie(companyId);
  const sugeridas = await sugerirCondutores(companyId);
  const abertas = await prisma.frotaMulta.findMany({ where: { companyId, situacao: "aberta" }, include: { condutor: { select: { nome: true } } }, orderBy: { prazoIndicacao: "asc" } });
  let pendencias = 0;
  const perdidas: typeof abertas = [];
  for (const m of abertas) {
    const condutor = m.condutor?.nome ?? m.condutorNome;
    const prazo = prazoDeIndicacao(m, hoje);
    if (prazo.situacao === "perdido") perdidas.push(m);
    if (prazo.situacao === "urgente") {
      pendencias += await pendencia({
        companyId,
        agente: AGENTE,
        tipo: "multa-indicacao",
        titulo: `Indicar o condutor até ${br(m.prazoIndicacao!)}: AIT ${m.ait} (${m.placa})`,
        descricao: `${m.especificacao} · ${m.orgao} · ${reais(m.valorCents)}. ${condutor ? `Condutor: ${condutor}${m.termoAssinadoEm ? " (termo assinado)" : " — falta o termo"}.` : "Condutor ainda não identificado."} Sem a indicação no prazo, o órgão cobra a NIC. Aprovar = indicação enviada (lance a data na multa).`,
        severidade: "alta",
        evidencias: { multaId: m.id, ait: m.ait, prazo: m.prazoIndicacao, dias: prazo.dias },
        perfilAprovador: "multas",
        chaveExcecao: `multa-indicacao:${m.id}`,
      });
    }
    if (m.responsavel === "motorista" && m.termoAssinadoEm && !m.descontoCompetencia && !m.ehNic) {
      const competencia = competenciaDoDesconto(hoje);
      pendencias += await pendencia({
        companyId,
        agente: AGENTE,
        tipo: "desconto-multa",
        titulo: `Desconto em folha: ${condutor ?? "motorista"} · ${reais(m.valorCents)} (AIT ${m.ait})`,
        descricao: `Termo assinado em ${br(m.termoAssinadoEm)}. Proposta: descontar na folha de ${competencia.toISOString().slice(5, 7)}/${competencia.getUTCFullYear()}. Aprovar grava o desconto na multa; rejeitar (com o motivo) deixa sem desconto.`,
        severidade: "media",
        evidencias: { multaId: m.id, ait: m.ait, valorCents: m.valorCents, termoAssinadoEm: m.termoAssinadoEm },
        acaoProposta: { multaId: m.id, competencia: competencia.toISOString(), valorCents: m.valorCents },
        perfilAprovador: "rh",
        chaveExcecao: `desconto-multa:${m.id}`,
      });
    }
    if (m.termoRecusado && m.responsavel !== "empresa" && !m.indicadoEm) {
      pendencias += await pendencia({
        companyId,
        agente: AGENTE,
        tipo: "multa-termo-recusado",
        titulo: `Termo recusado: AIT ${m.ait} (${m.placa})`,
        descricao: `${condutor ?? "O motorista"} não assinou o termo. Decidir: indicar o condutor mesmo assim (o órgão notifica a pessoa) ou a empresa assume.${m.prazoIndicacao ? ` Prazo de indicação: ${br(m.prazoIndicacao)}.` : ""}`,
        severidade: "media",
        evidencias: { multaId: m.id, ait: m.ait },
        perfilAprovador: "multas",
        chaveExcecao: `multa-termo-recusado:${m.id}`,
      });
    }
  }
  // Prazos perdidos: uma pendência só, com a lista — uma por multa viraria
  // uma enxurrada no primeiro dia.
  if (perdidas.length) {
    pendencias += await pendencia({
      companyId,
      agente: AGENTE,
      tipo: "multas-prazo-perdido",
      titulo: `${perdidas.length} multa(s) com o prazo de indicação perdido — risco de NIC`,
      descricao: `Indicação não registrada depois do vencimento da notificação: ${reais(perdidas.reduce((s, m) => s + m.valorCents, 0))} em multas que podem gerar NIC. Para cada uma: se a indicação foi feita, lance a data; se não, a empresa assume e acompanha a NIC. A lista atualiza todo dia.`,
      severidade: "critica",
      evidencias: { multas: perdidas.slice(0, 60).map((m) => ({ id: m.id, ait: m.ait, placa: m.placa, prazo: m.prazoIndicacao })) },
      perfilAprovador: "multas",
      chaveExcecao: `multas-prazo-perdido:${companyId}`,
    });
  }
  return { pagas, sugeridas, pendencias };
}
