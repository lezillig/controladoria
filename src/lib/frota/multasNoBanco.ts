import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { registrarAlteracao } from "@/lib/auditoria/trilha";
import { lerEscalas, lerUsosDeVeiculo } from "@/lib/gestao/leitura";
import { condutorPelosRegistros, type LeituraMultas } from "./multas";
import { responsabilidadePelaDescricao } from "./fechamentoMultas";

// AS MULTAS NO BANCO: a migração da planilha (uma vez; a segunda não duplica
// nem sobrescreve), o pagamento achado nas contas a pagar da Omie pelo número
// do AIT, e a sugestão do condutor pela escala e pelo uso do veículo.

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z]+/g, " ").trim();

export type ResultadoMultas = { novas: number; completadas: number; iguais: number; semVeiculo: number; condutorSemCadastro: number };

export async function gravarMultas(companyId: string, usuario: string, leitura: LeituraMultas): Promise<ResultadoMultas> {
  const r: ResultadoMultas = { novas: 0, completadas: 0, iguais: 0, semVeiculo: 0, condutorSemCadastro: 0 };
  const veiculos = new Map((await prisma.cadVeiculo.findMany({ where: { companyId, placa: { not: null } }, select: { id: true, placa: true } })).map((v) => [v.placa!, v.id]));
  const porNome = new Map<string, string | null>();
  for (const p of await prisma.cadPessoa.findMany({ where: { companyId }, select: { id: true, nome: true } })) {
    const k = semAcento(p.nome);
    porNome.set(k, porNome.has(k) ? null : p.id);
  }
  const atuais = new Map((await prisma.frotaMulta.findMany({ where: { companyId } })).map((m) => [m.ait, m]));
  for (const m of leitura.multas) {
    const veiculoId = veiculos.get(m.placa) ?? null;
    if (!veiculoId) r.semVeiculo++;
    const condutorPessoaId = m.condutorNome ? (porNome.get(semAcento(m.condutorNome)) ?? null) : null;
    if (m.condutorNome && !condutorPessoaId) r.condutorSemCadastro++;
    const campos = {
      veiculoId,
      placa: m.placa,
      orgao: m.orgao,
      dataInfracao: m.dataInfracao,
      especificacao: m.especificacao,
      pontos: m.pontos,
      valorCents: m.valorCents,
      incluidaEm: m.incluidaEm,
      condutorPessoaId,
      condutorNome: condutorPessoaId ? null : m.condutorNome,
      condutorFonte: m.condutorNome ? "planilha" : null,
      condutorNaoLocalizado: m.condutorNaoLocalizado,
      diarioSolicitadoEm: m.diarioSolicitadoEm,
      diarioRecebidoEm: m.diarioRecebidoEm,
      responsavel: m.responsavel,
      termoAssinadoEm: m.termoAssinadoEm,
      termoRecusado: m.termoRecusado,
      prazoIndicacao: m.prazoIndicacao,
      indicadoEm: m.indicadoEm,
      vencimentoBoleto: m.vencimentoBoleto,
      descontoCompetencia: m.descontoCompetencia,
      descontoValorCents: m.descontoValorCents,
      // Desconto que a planilha já registrou foi mandado à Contabilidade na
      // época; a conferência com a folha daquele mês é que diz se saiu.
      descontoEnviadoEm: m.descontoCompetencia,
      situacao: m.situacao,
      ehNic: m.ehNic,
      observacao: m.observacao,
    };
    const atual = atuais.get(m.ait);
    if (!atual) {
      const nova = await prisma.frotaMulta.create({ data: { companyId, ait: m.ait, origem: "planilha", responsabilidadeInfracao: m.ehNic ? "condutor" : responsabilidadePelaDescricao(m.especificacao), ...campos } });
      await registrarAlteracao(prisma, { companyId, usuario, agente: "migracao-planilhas", tabela: "FrotaMulta", registroId: nova.id, operacao: "insert", depois: { ait: m.ait, placa: m.placa, valorCents: m.valorCents, situacao: m.situacao } });
      atuais.set(m.ait, nova);
      r.novas++;
      continue;
    }
    // Já existe: só completa o vazio (o que se mudou no sistema vale).
    const completar: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(campos)) {
      const a = (atual as unknown as Record<string, unknown>)[k];
      if ((a === null || a === undefined) && v !== null && v !== undefined) completar[k] = v;
    }
    if (Object.keys(completar).length) {
      await prisma.frotaMulta.update({ where: { id: atual.id }, data: completar as Prisma.FrotaMultaUncheckedUpdateInput });
      await registrarAlteracao(prisma, { companyId, usuario, agente: "migracao-planilhas", tabela: "FrotaMulta", registroId: atual.id, operacao: "update", depois: Object.keys(completar).reduce((o, k) => ({ ...o, [k]: String(completar[k]) }), {}) });
      r.completadas++;
    } else r.iguais++;
  }
  // A NIC aponta para a multa que a originou.
  for (const m of leitura.multas.filter((x) => x.ehNic && x.nicDeAit)) {
    const nic = atuais.get(m.ait);
    const origem = atuais.get(m.nicDeAit!);
    if (nic && origem && !nic.nicDeId) await prisma.frotaMulta.update({ where: { id: nic.id }, data: { nicDeId: origem.id } });
  }
  return r;
}

// O PAGAMENTO NA OMIE: título a pagar com o número do AIT no documento ou na
// observação, liquidado (ou pago no valor) → a multa está paga.
export async function conciliarPagamentosOmie(companyId: string): Promise<number> {
  let pagas = 0;
  // Já ligadas a um título que ainda não estava pago: confere se pagou.
  // Abertas e finalizadas (a finalizada sem título é histórico a conferir).
  const ligadas = await prisma.frotaMulta.findMany({ where: { companyId, situacao: { in: ["aberta", "finalizada"] }, pagoEm: null, tituloOmieId: { not: null } }, select: { id: true, tituloOmieId: true } });
  if (ligadas.length) {
    const titulos = new Map((await prisma.omieTitulo.findMany({ where: { id: { in: ligadas.map((m) => m.tituloOmieId!) } }, select: { id: true, numeroDocumento: true, liquidado: true, valorPagoCents: true, valorDocumentoCents: true, dataUltimaBaixa: true } })).map((t) => [t.id, t]));
    for (const m of ligadas) {
      const t = titulos.get(m.tituloOmieId!);
      if (!t || !(t.liquidado || (t.valorPagoCents > 0 && t.valorPagoCents >= t.valorDocumentoCents - 100))) continue;
      await prisma.frotaMulta.update({ where: { id: m.id }, data: { pagoEm: t.dataUltimaBaixa ?? new Date(), valorPagoCents: t.valorPagoCents || t.valorDocumentoCents } });
      await registrarAlteracao(prisma, { companyId, agente: "agente-frota", tabela: "FrotaMulta", registroId: m.id, operacao: "update", depois: { pagoEm: t.dataUltimaBaixa, tituloOmie: t.numeroDocumento } });
      pagas++;
    }
  }
  const abertas = await prisma.frotaMulta.findMany({ where: { companyId, situacao: { in: ["aberta", "finalizada"] }, tituloOmieId: null }, select: { id: true, ait: true, valorCents: true, dataInfracao: true } });
  for (let i = 0; i < abertas.length; i += 40) {
    const lote = abertas.slice(i, i + 40).filter((m) => m.ait.length >= 6);
    if (!lote.length) continue;
    const desde = new Date(Math.min(...lote.map((m) => m.dataInfracao.getTime())));
    const titulos = await prisma.omieTitulo.findMany({
      where: {
        companyId,
        natureza: "PAGAR",
        cancelado: false,
        dataVencimento: { gte: desde },
        OR: lote.flatMap((m) => [{ numeroDocumento: { contains: m.ait, mode: "insensitive" as const } }, { observacao: { contains: m.ait, mode: "insensitive" as const } }]),
      },
      select: { id: true, numeroDocumento: true, observacao: true, liquidado: true, valorPagoCents: true, valorDocumentoCents: true, dataUltimaBaixa: true },
    });
    for (const m of lote) {
      const t = titulos.find((x) => `${x.numeroDocumento ?? ""} ${x.observacao ?? ""}`.toUpperCase().includes(m.ait));
      if (!t) continue;
      const pago = t.liquidado || (t.valorPagoCents > 0 && t.valorPagoCents >= t.valorDocumentoCents - 100);
      const data: Prisma.FrotaMultaUpdateInput = { tituloOmieId: t.id, ...(pago ? { pagoEm: t.dataUltimaBaixa ?? new Date(), valorPagoCents: t.valorPagoCents || t.valorDocumentoCents } : {}) };
      await prisma.frotaMulta.update({ where: { id: m.id }, data });
      if (pago) {
        await registrarAlteracao(prisma, { companyId, agente: "agente-frota", tabela: "FrotaMulta", registroId: m.id, operacao: "update", depois: { pagoEm: t.dataUltimaBaixa, tituloOmie: t.numeroDocumento } });
        pagas++;
      }
    }
  }
  return pagas;
}

// QUEM DIRIGIA: para as multas abertas sem condutor, o uso do veículo e a
// escala da gestão na hora da infração. Grava como SUGESTÃO — confirmar é
// de uma pessoa.
export async function sugerirCondutores(companyId: string): Promise<number> {
  const multas = await prisma.frotaMulta.findMany({
    where: { companyId, situacao: "aberta", ehNic: false, condutorPessoaId: null, condutorNome: null, sugeridoPessoaId: null, veiculoId: { not: null } },
    select: { id: true, dataInfracao: true, veiculo: { select: { origens: true } } },
  });
  const comGestao = multas.filter((m) => (m.veiculo?.origens as Record<string, string> | null)?.gestao);
  if (!comGestao.length) return 0;
  const desde = new Date(Math.min(...comGestao.map((m) => m.dataInfracao.getTime())) - 86_400_000);
  const [usos, escalas, pessoas] = await Promise.all([
    lerUsosDeVeiculo(companyId, desde),
    lerEscalas(companyId, new Date(Date.UTC(desde.getUTCFullYear(), desde.getUTCMonth(), desde.getUTCDate()))),
    prisma.cadPessoa.findMany({ where: { companyId }, select: { id: true, origens: true } }),
  ]);
  const pessoaDoMotorista = new Map(pessoas.map((p) => [(p.origens as Record<string, string> | null)?.gestao ?? "", p.id]));
  let n = 0;
  for (const m of comGestao) {
    const gid = (m.veiculo!.origens as Record<string, string>).gestao;
    const r = condutorPelosRegistros(m.dataInfracao, usos.filter((u) => u.vehicleId === gid), escalas.filter((e) => e.vehicleId === gid));
    if (!r || !("driverId" in r)) continue;
    const pessoaId = pessoaDoMotorista.get(r.driverId);
    if (!pessoaId) continue;
    await prisma.frotaMulta.update({ where: { id: m.id }, data: { sugeridoPessoaId: pessoaId, sugeridoFonte: r.fonte } });
    n++;
  }
  return n;
}
