import { prisma } from "@/lib/prisma";
import { registrarAlteracao } from "@/lib/auditoria/trilha";
import { chavePorNome, conferirDescontos, descontoDevido, fechada100, valorDoDesconto, type LinhaEventoFolha } from "./fechamentoMultas";

// O FECHAMENTO DAS MULTAS NO BANCO: o lado do Financeiro (títulos de multa na
// Omie), o lado do RH (eventos da folha processada) e a finalização do que
// fechou 100%.

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z]+/g, " ").trim();
export const CATEGORIA_MULTA = /MULTA|INFRA[CÇ][AÃ]O DE TR[AÂ]NSITO/i;

// Títulos a pagar de multa (pela categoria) que nenhuma multa do sistema
// explica: o Financeiro pagou algo que o processo não conhece.
export async function titulosDeMultaSemMulta(companyId: string, desde: Date) {
  const ligados = new Set((await prisma.frotaMulta.findMany({ where: { companyId, tituloOmieId: { not: null } }, select: { tituloOmieId: true } })).map((m) => m.tituloOmieId));
  const titulos = await prisma.omieTitulo.findMany({
    where: { companyId, natureza: "PAGAR", cancelado: false, dataVencimento: { gte: desde }, categoriaDescricao: { contains: "MULTA", mode: "insensitive" } },
    select: { id: true, conexaoApelido: true, numeroDocumento: true, parceiroNome: true, dataVencimento: true, valorDocumentoCents: true, valorPagoCents: true, liquidado: true, dataUltimaBaixa: true, observacao: true, categoriaDescricao: true },
    orderBy: { dataVencimento: "desc" },
  });
  return titulos.filter((t) => !ligados.has(t.id) && CATEGORIA_MULTA.test(t.categoriaDescricao ?? ""));
}

// A pessoa de cada linha da folha: pela matrícula (lista de ativos da folha)
// ou pelo nome, no cadastro.
async function pessoasDaFolha(companyId: string) {
  const pessoas = await prisma.cadPessoa.findMany({ where: { companyId }, select: { id: true, nome: true } });
  const porNome = new Map<string, string | null>();
  for (const p of pessoas) {
    const k = semAcento(p.nome);
    porNome.set(k, porNome.has(k) ? null : p.id);
  }
  const quadros = await prisma.folhaQuadro.findMany({ where: { companyId }, orderBy: { competencia: "desc" }, select: { id: true, conexaoId: true } });
  const ultimos = [...new Map(quadros.map((q) => [q.conexaoId, q.id])).values()];
  const nomePorMatricula = new Map((await prisma.folhaPessoa.findMany({ where: { quadroId: { in: ultimos } }, select: { matricula: true, nome: true } })).map((f) => [f.matricula, f.nome]));
  const matriculaPorNome = new Map([...nomePorMatricula.entries()].map(([m, n]) => [semAcento(n), m]));
  return {
    pessoaDe: (matricula: string | null, nome: string) => porNome.get(semAcento((matricula && nomePorMatricula.get(matricula)) || nome)) ?? null,
    matriculaDe: (nome: string) => matriculaPorNome.get(semAcento(nome)) ?? null,
  };
}

export async function gravarEventosDaFolha(companyId: string, competencia: Date, linhas: LinhaEventoFolha[], arquivoNome: string, usuario: string) {
  const { pessoaDe } = await pessoasDaFolha(companyId);
  await prisma.pesFolhaEventoMulta.deleteMany({ where: { companyId, competencia } });
  await prisma.pesFolhaEventoMulta.createMany({
    data: linhas.map((l) => ({ companyId, competencia, matricula: l.matricula, nome: l.nome, pessoaId: pessoaDe(l.matricula, l.nome), evento: l.evento, valorCents: l.valorCents, arquivoNome: arquivoNome.slice(0, 120), importadoPor: usuario })),
  });
  await prisma.audLog.create({ data: { companyId, usuario, tabela: "PesFolhaEventoMulta", registroId: competencia.toISOString().slice(0, 7), operacao: "insert", depois: { linhas: linhas.length, arquivo: arquivoNome.slice(0, 120) } } });
  return conferirCompetencia(companyId, competencia);
}

// A CONFERÊNCIA DE UMA COMPETÊNCIA: os descontos aprovados para ela × os
// eventos de multa da folha processada. Quem bate tem as multas marcadas como
// conferidas; quem não bate, desmarcadas (rodar de novo refaz tudo).
export async function conferirCompetencia(companyId: string, competencia: Date) {
  const multas = await prisma.frotaMulta.findMany({
    where: { companyId, descontoCompetencia: competencia, semDesconto: false },
    include: { condutor: { select: { id: true, nome: true } } },
  });
  const devidas = multas.filter((m) => descontoDevido(m));
  const eventos = await prisma.pesFolhaEventoMulta.findMany({ where: { companyId, competencia } });
  const temFolha = eventos.length > 0 || (await prisma.audLog.count({ where: { companyId, tabela: "PesFolhaEventoMulta", registroId: competencia.toISOString().slice(0, 7) } })) > 0;
  const chave = (pessoaId: string | null, nome: string) => (pessoaId ? `pessoa:${pessoaId}` : chavePorNome(nome));
  const resultado = conferirDescontos(
    devidas.map((m) => ({ multaId: m.id, chave: chave(m.condutorPessoaId, m.condutor?.nome ?? m.condutorNome ?? "?"), nome: m.condutor?.nome ?? m.condutorNome ?? "?", valorCents: valorDoDesconto(m) })),
    eventos.map((e) => ({ chave: chave(e.pessoaId, e.nome), nome: e.nome, valorCents: e.valorCents }))
  );
  if (temFolha) {
    const agora = new Date();
    for (const r of resultado) {
      for (const id of r.multaIds) {
        const m = devidas.find((x) => x.id === id)!;
        const conferido = r.situacao === "ok" ? valorDoDesconto(m) : null;
        if ((m.descontoConferidoValorCents ?? null) === conferido && (conferido === null) === (m.descontoConferidoEm === null)) continue;
        await prisma.frotaMulta.update({ where: { id }, data: { descontoConferidoEm: conferido !== null ? agora : null, descontoConferidoValorCents: conferido } });
        await registrarAlteracao(prisma, { companyId, agente: "conferencia-folha", tabela: "FrotaMulta", registroId: id, operacao: "update", depois: { descontoConferido: conferido, competencia: competencia.toISOString().slice(0, 7), situacao: r.situacao } });
      }
    }
  }
  return { temFolha, resultado };
}

// Os eventos de desconto de multa da competência, para a planilha da
// Contabilidade (o RH manda até o dia 20): matrícula, nome, valor e os AIT.
export async function eventosParaContabilidade(companyId: string, competencia: Date) {
  const { matriculaDe } = await pessoasDaFolha(companyId);
  const multas = await prisma.frotaMulta.findMany({ where: { companyId, descontoCompetencia: competencia, semDesconto: false }, include: { condutor: { select: { id: true, nome: true } } }, orderBy: { dataInfracao: "asc" } });
  const porPessoa = new Map<string, { nome: string; matricula: string | null; valorCents: number; aits: string[]; ids: string[]; enviado: boolean }>();
  for (const m of multas.filter((x) => descontoDevido(x))) {
    const nome = m.condutor?.nome ?? m.condutorNome ?? "?";
    const k = m.condutorPessoaId ?? semAcento(nome);
    const g = porPessoa.get(k) ?? { nome, matricula: matriculaDe(nome), valorCents: 0, aits: [], ids: [], enviado: true };
    g.valorCents += valorDoDesconto(m);
    g.aits.push(m.ait);
    g.ids.push(m.id);
    if (!m.descontoEnviadoEm) g.enviado = false;
    porPessoa.set(k, g);
  }
  return [...porPessoa.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

// O que fechou 100% e ainda está aberto: o agente finaliza, com trilha.
export async function finalizarFechadas(companyId: string): Promise<number> {
  const abertas = await prisma.frotaMulta.findMany({ where: { companyId, situacao: "aberta" }, include: { _count: { select: { nics: true } } } });
  let n = 0;
  for (const m of abertas) {
    if (!fechada100({ ...m, temNic: m._count.nics > 0 })) continue;
    await prisma.frotaMulta.update({ where: { id: m.id }, data: { situacao: "finalizada" } });
    await registrarAlteracao(prisma, { companyId, agente: "agente-frota", tabela: "FrotaMulta", registroId: m.id, operacao: "update", antes: { situacao: "aberta" }, depois: { situacao: "finalizada", motivo: "fechada 100%: condutor, indicação, pagamento e desconto conferidos" } });
    n++;
  }
  return n;
}
