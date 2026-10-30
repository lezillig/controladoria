import { prisma } from "@/lib/prisma";
import { criarPendencia } from "@/lib/auditoria/pendencias";
import { enviarEmail } from "@/lib/email/send";
import { leiturasOpcionaisPendentes, lerAfastamentos, lerEscalas } from "@/lib/gestao/leitura";
import { aptidaoNaData, TIPO_DOCUMENTO_PESSOA } from "./documentos";
import { diasEntre, feriasNoDia, juntarFerias } from "./ferias";
import { listarMotoristas } from "./pessoasNoBanco";

// O AGENTE DIÁRIO DOS MOTORISTAS (docs/plataforma/docs/04-padrao-de-agentes.md),
// depois da sincronização, uma vez por dia:
//
//   1. traz as férias registradas na gestão (afastamentos "ferias", que vêm
//      do ponto) — os pedaços contíguos viram um bloco só;
//   2. completa a admissão vazia pela última lista de ativos da folha (o
//      mesmo nome, sem ambiguidade);
//   3. documento exigido vencido → pendência para o RH;
//   4. férias vencidas (em dobro) → pendência crítica para o RH; último dia
//      para começar as férias em até 60 dias → pendência para programar;
//   5. motorista escalado na gestão nos próximos 7 dias sem aptidão naquele
//      dia (documento vencido, férias) → pendência para a Operação;
//   6. e-mail ao RH quando um documento chega a 60, 30 ou 7 dias ou vence, e
//      quando o limite das férias chega a 60, 30 ou 7 dias.

const AGENTE = "agente-motoristas";
const MARCOS = [60, 30, 7, -1];
const ROTULO_AFASTAMENTOS = "os afastamentos dos motoristas (DriverLeave)";
const ROTULO_ESCALAS = "as escalas (Escala)";
const br = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join("/");
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z]+/g, " ").trim();

export type ResultadoAgenteMotoristas = { feriasImportadas: number; admissoesCompletadas: number; pendencias: number; aviso: string | null; avisosLeitura: string[]; jaRodouHoje?: boolean };

async function pendencia(p: Parameters<typeof criarPendencia>[0]) {
  const r = await criarPendencia(p);
  if (!r.nova) await prisma.audPendencia.update({ where: { id: r.id }, data: { titulo: p.titulo, descricao: p.descricao, evidencias: p.evidencias, severidade: p.severidade } });
  return r.nova ? 1 : 0;
}

// 1. As férias da gestão. Só mexe nos registros de origem "gestao" a partir
// da janela lida; o que o RH lançou à mão fica, e bloco da gestão que cruza
// um lançamento manual é deixado de fora (não conta duas vezes).
export async function importarFeriasDaGestao(companyId: string, hoje: Date): Promise<{ importadas: number; erro: string | null }> {
  const desde = new Date(Date.UTC(hoje.getUTCFullYear() - 3, hoje.getUTCMonth(), 1));
  const afastamentos = await lerAfastamentos(companyId, desde);
  if (leiturasOpcionaisPendentes().includes(ROTULO_AFASTAMENTOS)) return { importadas: 0, erro: "afastamentos da gestão indisponíveis — férias não atualizadas hoje" };
  const pessoas = await prisma.cadPessoa.findMany({ where: { companyId }, select: { id: true, origens: true } });
  const pessoaDoMotorista = new Map<string, string>();
  for (const p of pessoas) {
    const id = (p.origens as Record<string, string> | null)?.gestao;
    if (id) pessoaDoMotorista.set(id, p.id);
  }
  const porPessoa = new Map<string, { id: string; inicio: Date; fim: Date }[]>();
  for (const a of afastamentos) {
    if (semAcento(a.leaveType) !== "FERIAS") continue;
    const pessoaId = pessoaDoMotorista.get(a.driverId);
    if (!pessoaId) continue;
    porPessoa.set(pessoaId, [...(porPessoa.get(pessoaId) ?? []), { id: `${a.driverId}:${a.startDate.toISOString()}`, inicio: a.startDate, fim: a.endDate }]);
  }
  const atuais = await prisma.pesFerias.findMany({ where: { companyId, fim: { gte: desde } } });
  let importadas = 0;
  const manterGestao = new Set<string>();
  for (const [pessoaId, lista] of porPessoa) {
    const manuais = atuais.filter((f) => f.pessoaId === pessoaId && f.origem !== "gestao");
    for (const b of juntarFerias(lista)) {
      if (manuais.some((m) => m.inicio <= b.fim && b.inicio <= m.fim)) continue;
      const existente = atuais.find((f) => f.pessoaId === pessoaId && f.inicio.getTime() === b.inicio.getTime());
      if (existente && existente.origem !== "gestao") continue;
      manterGestao.add(`${pessoaId}|${b.inicio.getTime()}`);
      if (existente && existente.fim.getTime() === b.fim.getTime()) continue;
      await prisma.pesFerias.upsert({
        where: { pessoaId_inicio: { pessoaId, inicio: b.inicio } },
        create: { companyId, pessoaId, inicio: b.inicio, fim: b.fim, origem: "gestao", origemId: b.ids[0].slice(0, 120), registradoPor: AGENTE },
        update: { fim: b.fim },
      });
      importadas++;
    }
  }
  // Bloco da gestão que sumiu de lá (afastamento apagado ou corrigido) sai daqui.
  const sumiram = atuais.filter((f) => f.origem === "gestao" && f.inicio >= desde && !manterGestao.has(`${f.pessoaId}|${f.inicio.getTime()}`));
  if (sumiram.length) await prisma.pesFerias.deleteMany({ where: { id: { in: sumiram.map((f) => f.id) } } });
  return { importadas, erro: null };
}

// 2. A admissão pela lista de ativos da folha (o quadro mais recente de cada
// empresa), quando o cadastro não a tem. Nome repetido não completa nada.
export async function completarAdmissoes(companyId: string): Promise<number> {
  const semAdmissao = await prisma.cadPessoa.findMany({ where: { companyId, dataAdmissao: null, ativo: true }, select: { id: true, nome: true } });
  if (!semAdmissao.length) return 0;
  const quadros = await prisma.folhaQuadro.findMany({ where: { companyId }, orderBy: { competencia: "desc" }, select: { id: true, conexaoId: true } });
  const ultimos = [...new Map(quadros.map((q) => [q.conexaoId, q.id])).values()];
  if (!ultimos.length) return 0;
  const lista = await prisma.folhaPessoa.findMany({ where: { quadroId: { in: ultimos } }, select: { nome: true, admissao: true } });
  const porNome = new Map<string, Date | null>();
  for (const l of lista) {
    const k = semAcento(l.nome);
    porNome.set(k, porNome.has(k) ? null : l.admissao);
  }
  let n = 0;
  for (const p of semAdmissao) {
    const admissao = porNome.get(semAcento(p.nome));
    if (!admissao) continue;
    await prisma.cadPessoa.update({ where: { id: p.id }, data: { dataAdmissao: admissao } });
    await prisma.audLog.create({ data: { companyId, agente: AGENTE, tabela: "CadPessoa", registroId: p.id, operacao: "update", antes: { dataAdmissao: null }, depois: { dataAdmissao: admissao.toISOString().slice(0, 10), origem: "lista de ativos da folha" } } });
    n++;
  }
  return n;
}

export async function rodarAgenteMotoristas(companyId: string, hoje = new Date(), forcar = false): Promise<ResultadoAgenteMotoristas> {
  const marca = `motoristas:${hoje.toISOString().slice(0, 10)}`;
  if (!forcar && (await prisma.audLog.findFirst({ where: { companyId, tabela: "Agente", registroId: marca }, select: { id: true } }))) {
    return { feriasImportadas: 0, admissoesCompletadas: 0, pendencias: 0, aviso: null, avisosLeitura: [], jaRodouHoje: true };
  }
  const avisosLeitura: string[] = [];
  const ferias = await importarFeriasDaGestao(companyId, hoje);
  if (ferias.erro) avisosLeitura.push(ferias.erro);
  const admissoesCompletadas = await completarAdmissoes(companyId);
  const { linhas } = await listarMotoristas(companyId, hoje);
  let pendencias = 0;
  const avisos: string[] = [];

  for (const p of linhas) {
    // 3. Documento exigido vencido.
    const vencidos = p.aptidao.bloqueios.filter((b) => / vencid[oa] em /.test(b));
    if (vencidos.length) {
      pendencias += await pendencia({
        companyId,
        agente: AGENTE,
        tipo: "documento-pessoa-vencido",
        titulo: `${p.nome}: ${vencidos.join("; ")}`,
        descricao: `${p.cargo === "monitor" ? "Monitor(a)" : "Motorista"} sem aptidão para a escala até renovar. Aprovar = ciente e providenciando a renovação (lance a nova validade na ficha).`,
        severidade: "alta",
        evidencias: { pessoaId: p.id, bloqueios: vencidos },
        perfilAprovador: "rh",
        chaveExcecao: `pessoa-doc-vencido:${p.id}`,
      });
    }
    for (const d of p.documentos) {
      if (d.situacao !== "vigente" || !d.validade) continue;
      const dias = diasEntre(hoje, d.validade);
      if (MARCOS.includes(dias)) avisos.push(`${p.nome} — ${TIPO_DOCUMENTO_PESSOA.get(d.tipo)?.rotulo ?? d.tipo}: ${dias < 0 ? "venceu ontem" : `vence em ${dias} dias`} (${br(d.validade)})`);
    }
    // 4. Férias.
    const r = p.resumoFerias;
    if (r.vencidos > 0) {
      pendencias += await pendencia({
        companyId,
        agente: AGENTE,
        tipo: "ferias-vencidas",
        titulo: `${p.nome}: ${r.vencidos} período(s) de férias vencido(s)`,
        descricao: `${r.saldoVencidoDias} dia(s) de férias fora do período concessivo — devidas em dobro (art. 137 da CLT). Programar já; se já foram gozadas e não estão registradas, lançar na ficha.`,
        severidade: "critica",
        evidencias: { pessoaId: p.id, vencidos: r.vencidos, saldoVencidoDias: r.saldoVencidoDias },
        perfilAprovador: "rh",
        chaveExcecao: `pessoa-ferias-vencidas:${p.id}`,
      });
    }
    if (r.limite && r.limite.situacao === "a_gozar" && r.limite.dias <= 60 && !r.proximas) {
      pendencias += await pendencia({
        companyId,
        agente: AGENTE,
        tipo: "ferias-a-programar",
        titulo: `${p.nome}: férias a começar até ${br(r.limite.inicioAte)}`,
        descricao: `${r.limite.saldo} dia(s) de saldo; depois de ${br(r.limite.inicioAte)} o que faltar é pago em dobro. Programar as férias (e o substituto na escala).`,
        severidade: r.limite.dias <= 15 ? "alta" : "media",
        evidencias: { pessoaId: p.id, inicioAte: r.limite.inicioAte, saldo: r.limite.saldo },
        perfilAprovador: "rh",
        chaveExcecao: `pessoa-ferias-limite:${p.id}`,
      });
    }
    if (r.limite && r.limite.situacao === "a_gozar" && [60, 30, 7].includes(r.limite.dias)) avisos.push(`${p.nome} — férias: começar até ${br(r.limite.inicioAte)} (${r.limite.saldo} dias de saldo)`);
  }

  // 5. Escala × aptidão, nos próximos 7 dias.
  const ate = new Date(hoje.getTime() + 7 * 86_400_000);
  const escalas = (await lerEscalas(companyId, new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate())))).filter((e) => e.date <= ate);
  if (leiturasOpcionaisPendentes().includes(ROTULO_ESCALAS)) avisosLeitura.push("escalas da gestão indisponíveis — escala × aptidão não conferida hoje");
  if (escalas.length) {
    const porMotorista = new Map(linhas.map((p) => [(p.origens as Record<string, string> | null)?.gestao ?? "", p]));
    const inaptos = new Map<string, { p: (typeof linhas)[number]; dias: string[] }>();
    for (const e of escalas) {
      const p = porMotorista.get(e.driverId);
      if (!p) continue;
      const a = aptidaoNaData(p, p.documentos, feriasNoDia(p.ferias, e.date), e.date);
      if (a.situacao !== "nao_apto") continue;
      const item = inaptos.get(p.id) ?? { p, dias: [] };
      item.dias.push(`${br(e.date)}: ${a.bloqueios.join(", ")}`);
      inaptos.set(p.id, item);
    }
    for (const { p, dias } of inaptos.values()) {
      pendencias += await pendencia({
        companyId,
        agente: AGENTE,
        tipo: "escala-sem-aptidao",
        titulo: `${p.nome} escalado(a) sem aptidão`,
        descricao: `Na escala da gestão: ${[...new Set(dias)].slice(0, 7).join("; ")}. Trocar o motorista nesses dias ou regularizar antes. Aprovar = escala corrigida.`,
        severidade: "alta",
        evidencias: { pessoaId: p.id, dias: [...new Set(dias)].slice(0, 7) },
        perfilAprovador: "operacao",
        chaveExcecao: `escala-sem-aptidao:${p.id}`,
      });
    }
  }

  let aviso: string | null = null;
  if (avisos.length) {
    const config = await prisma.controladoriaConfig.findUnique({ where: { companyId }, select: { emailsPessoas: true } });
    const para = (config?.emailsPessoas ?? "").split(/[,;\s]+/).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
    if (para.length) {
      const e = await enviarEmail({
        para,
        assunto: `Motoristas: ${avisos.length} vencimento(s) de documentos e férias`,
        texto: `Vencimentos dos motoristas\n\n${avisos.join("\n")}\n\nDetalhes em Pessoas › Motoristas.`,
        html: `<p><strong>Vencimentos dos motoristas</strong></p><ul>${avisos.map((a) => `<li>${a.replace(/[<>&]/g, "")}</li>`).join("")}</ul><p>Detalhes em Pessoas › Motoristas.</p>`,
      });
      aviso = e.enviado ? `e-mail com ${avisos.length} aviso(s) para ${para.length} destinatário(s)` : `e-mail não enviado: ${e.erro}`;
    } else aviso = `${avisos.length} aviso(s) sem destinatário configurado`;
  }
  await prisma.audLog.create({ data: { companyId, agente: AGENTE, tabela: "Agente", registroId: marca, operacao: "insert", depois: { feriasImportadas: ferias.importadas, admissoesCompletadas, pendencias, avisos: avisos.length, aviso, avisosLeitura } } });
  return { feriasImportadas: ferias.importadas, admissoesCompletadas, pendencias, aviso, avisosLeitura };
}
