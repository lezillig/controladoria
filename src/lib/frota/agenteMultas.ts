import { prisma } from "@/lib/prisma";
import { criarPendencia } from "@/lib/auditoria/pendencias";
import { competenciaDoDesconto, prazoDeIndicacao } from "./multas";
import { conciliarPagamentosOmie, sugerirCondutores } from "./multasNoBanco";
import { descontoDevido, valorDoDesconto } from "./fechamentoMultas";
import { conferirCompetencia, eventosParaContabilidade, finalizarFechadas, titulosDeMultaSemMulta } from "./fechamentoMultasNoBanco";

// O PASSO DAS MULTAS NO AGENTE DIÁRIO DA FROTA:
//   1. pagamento achado na Omie pelo AIT → multa paga;
//   2. condutor sugerido pela escala e pelo uso do veículo;
//   3. prazo de indicação em até 7 dias → pendência por multa (perfil
//      multas); prazos já perdidos → UMA pendência com a lista (risco de NIC);
//   4. termo assinado sem desconto → pendência do RH para aprovar o desconto
//      em folha (a aprovação grava a competência e o valor);
//   5. motorista recusou o termo → pendência para decidir (indicar mesmo
//      assim, ou a empresa assume);
//   6. FECHAMENTO: desconto que o RH rejeitou vira "sem desconto"; os
//      descontos da competência que não foram mandados à Contabilidade até o
//      dia 15 → pendência do RH; a conferência com a folha processada que não
//      bateu → pendência do RH; títulos de multa na Omie sem multa no sistema
//      e multas pagas sem título → pendência do Financeiro; o que fechou 100%
//      (condutor, indicação, pagamento e desconto conferidos) é finalizado.

const AGENTE = "agente-frota";
const br = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join("/");
const reais = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

async function pendencia(p: Parameters<typeof criarPendencia>[0]) {
  const r = await criarPendencia(p);
  if (!r.nova) await prisma.audPendencia.update({ where: { id: r.id }, data: { titulo: p.titulo, descricao: p.descricao, evidencias: p.evidencias, severidade: p.severidade } });
  return r.nova ? 1 : 0;
}

export type ResultadoMultasAgente = { pagas: number; sugeridas: number; pendencias: number; finalizadas?: number };

export async function rodarPassoMultas(companyId: string, hoje: Date): Promise<ResultadoMultasAgente> {
  if ((await prisma.frotaMulta.count({ where: { companyId } })) === 0) return { pagas: 0, sugeridas: 0, pendencias: 0 };
  const pagas = await conciliarPagamentosOmie(companyId);
  const sugeridas = await sugerirCondutores(companyId);
  // O RH rejeitou o desconto: a multa fica "sem desconto", com o motivo.
  const rejeitados = await prisma.audPendencia.findMany({ where: { companyId, tipo: "desconto-multa", status: "rejeitada" }, select: { evidencias: true, comentario: true, decididaPor: true } });
  for (const r of rejeitados) {
    const multaId = (r.evidencias as { multaId?: string } | null)?.multaId;
    if (!multaId) continue;
    await prisma.frotaMulta.updateMany({ where: { id: multaId, companyId, semDesconto: false, descontoCompetencia: null }, data: { semDesconto: true, semDescontoMotivo: `RH (${r.decididaPor ?? "?"}): ${r.comentario ?? "rejeitado"}`.slice(0, 300) } });
  }
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
    if (descontoDevido(m) && m.termoAssinadoEm && !m.descontoCompetencia && !m.semDesconto) {
      const competencia = competenciaDoDesconto(hoje);
      const valor = valorDoDesconto(m);
      pendencias += await pendencia({
        companyId,
        agente: AGENTE,
        tipo: "desconto-multa",
        titulo: `Desconto em folha: ${condutor ?? "motorista"} · ${reais(valor)} (AIT ${m.ait})`,
        descricao: `Termo assinado em ${br(m.termoAssinadoEm)} (CLT, art. 462, §1º). Proposta: descontar ${m.valorPagoCents !== null ? "o valor pago" : "o valor da multa"} na folha de ${competencia.toISOString().slice(5, 7)}/${competencia.getUTCFullYear()}. Aprovar grava o desconto na multa e ele entra nos eventos para a Contabilidade; rejeitar (com o motivo) deixa a multa sem desconto.`,
        severidade: "media",
        evidencias: { multaId: m.id, ait: m.ait, valorCents: valor, termoAssinadoEm: m.termoAssinadoEm },
        acaoProposta: { multaId: m.id, competencia: competencia.toISOString(), valorCents: valor },
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
  pendencias += await pendenciasDeFechamento(companyId, hoje);
  const finalizadas = await finalizarFechadas(companyId);
  return { pagas, sugeridas, pendencias, finalizadas };
}

async function pendenciasDeFechamento(companyId: string, hoje: Date): Promise<number> {
  let n = 0;
  const mesDe = (d: Date) => `${d.toISOString().slice(5, 7)}/${d.getUTCFullYear()}`;
  // RH: descontos da competência ainda não mandados à Contabilidade (o
  // fluxograma da folha leva os eventos até o dia 20; cobra-se a partir do 15).
  const competencias = await prisma.frotaMulta.groupBy({ by: ["descontoCompetencia"], where: { companyId, descontoCompetencia: { not: null }, descontoEnviadoEm: null, semDesconto: false }, _count: true });
  for (const c of competencias) {
    const comp = c.descontoCompetencia!;
    const prazo = new Date(Date.UTC(comp.getUTCFullYear(), comp.getUTCMonth(), 15));
    if (hoje < prazo) continue;
    const eventos = await eventosParaContabilidade(companyId, comp);
    const faltam = eventos.filter((e) => !e.enviado);
    if (!faltam.length) continue;
    n += await pendencia({
      companyId,
      agente: AGENTE,
      tipo: "multas-eventos-folha",
      titulo: `Descontos de multa da folha de ${mesDe(comp)}: mandar à Contabilidade`,
      descricao: `${faltam.length} motorista(s), ${reais(faltam.reduce((s, e) => s + e.valorCents, 0))}. Baixe os eventos em Multas › Desconto em folha e inclua na planilha da Contabilidade (até o dia 20); depois marque como enviados.`,
      severidade: "alta",
      evidencias: { competencia: comp.toISOString().slice(0, 7), motoristas: faltam.length },
      perfilAprovador: "rh",
      chaveExcecao: `multas-eventos-folha:${comp.toISOString().slice(0, 7)}`,
    });
  }
  // RH: a folha processada não bateu com os descontos aprovados.
  const comFolha = await prisma.pesFolhaEventoMulta.groupBy({ by: ["competencia"], where: { companyId }, _count: true });
  for (const c of comFolha) {
    const { resultado } = await conferirCompetencia(companyId, c.competencia);
    const erradas = resultado.filter((r) => r.situacao !== "ok");
    if (!erradas.length) continue;
    n += await pendencia({
      companyId,
      agente: AGENTE,
      tipo: "multas-conferencia-folha",
      titulo: `Folha de ${mesDe(c.competencia)}: ${erradas.length} desconto(s) de multa não batem`,
      descricao: `${erradas.map((r) => `${r.nome}: aprovado ${reais(r.esperadoCents)}, na folha ${reais(r.descontadoCents)}`).slice(0, 12).join("; ")}. Corrigir na folha seguinte (ou registrar a decisão na multa).`,
      severidade: "alta",
      evidencias: { competencia: c.competencia.toISOString().slice(0, 7), divergencias: erradas.map((r) => ({ nome: r.nome, esperado: r.esperadoCents, descontado: r.descontadoCents, situacao: r.situacao })) },
      perfilAprovador: "rh",
      chaveExcecao: `multas-conferencia-folha:${c.competencia.toISOString().slice(0, 7)}`,
    });
  }
  // Financeiro: título de multa na Omie que o processo não conhece, e multa
  // paga sem título.
  const semMulta = await titulosDeMultaSemMulta(companyId, new Date(hoje.getTime() - 400 * 86_400_000));
  const pagasSemTitulo = await prisma.frotaMulta.count({ where: { companyId, situacao: "aberta", pagoEm: { not: null }, tituloOmieId: null } });
  if (semMulta.length || pagasSemTitulo) {
    n += await pendencia({
      companyId,
      agente: AGENTE,
      tipo: "multas-conferencia-financeiro",
      titulo: `Multas × contas a pagar: ${semMulta.length} pagamento(s) sem multa, ${pagasSemTitulo} multa(s) paga(s) sem título`,
      descricao: `${semMulta.length ? `Títulos de multa na Omie que nenhuma multa do sistema explica (${reais(semMulta.reduce((s, t) => s + t.valorDocumentoCents, 0))}): lançar a multa ou ligar o título a ela. ` : ""}${pagasSemTitulo ? "Multas marcadas como pagas sem o título da Omie: ligar o título na multa." : ""} Detalhes em Multas › Fechamento.`,
      severidade: "media",
      evidencias: { titulos: semMulta.slice(0, 40).map((t) => ({ id: t.id, documento: t.numeroDocumento, valor: t.valorDocumentoCents, vencimento: t.dataVencimento })), pagasSemTitulo },
      perfilAprovador: "financeiro",
      chaveExcecao: `multas-conferencia-financeiro:${companyId}`,
    });
  }
  return n;
}
