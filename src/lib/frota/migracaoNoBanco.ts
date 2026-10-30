import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { protegerRegistro } from "@/lib/auditoria/trilha";
import type { FinanciamentoMigrado, LeituraMigracao, VeiculoMigrado } from "./migracaoPlanilhas";

// A GRAVAÇÃO DA MIGRAÇÃO ÚNICA (a leitura está em migracaoPlanilhas.ts).
// Em duas etapas, cada uma numa chamada, para caber no tempo de uma
// requisição: a frota (veículos, documentos, consultas, apólices) e os
// contratos (financiamentos, giro, cotas, com os veículos ligados).
//
// A planilha é a fonte que está sendo aposentada: o que ela traz VALE sobre o
// que o cadastro já tinha das cargas automáticas (a gestão só sabia placa e
// modelo), e cada mudança vai para a trilha com o antes e o depois. Rodar de
// novo não duplica nada: veículo pela placa (ou chassi), documento por tipo,
// consulta por data, contrato pela chave da planilha.

const AGENTE = "migracao-planilhas";
type Campos = Record<string, unknown>;

const big = (v: number | null) => (v === null ? null : BigInt(v));

function camposDoVeiculo(v: VeiculoMigrado, apoliceId: string | null): Campos {
  return {
    placa: v.placa,
    chassi: v.chassi,
    renavam: v.renavam,
    prefixo: v.prefixo,
    tipo: v.tipo ?? "outro",
    eletrico: v.eletrico,
    marca: v.marca,
    modelo: v.modelo,
    cor: v.cor,
    anoFab: v.anoFab,
    anoMod: v.anoMod,
    capacidade: v.capacidade,
    adaptacao: v.adaptacao,
    categoriaUso: v.categoriaUso,
    categoriaRegistro: v.categoriaRegistro,
    alocacao: v.alocacao,
    dataCompra: v.dataCompra,
    valorCompraCents: big(v.valorCompraCents),
    notaFiscalCompra: v.notaFiscalCompra,
    vendedorNome: v.vendedorNome,
    ...(v.vidaUtilMeses ? { vidaUtilMeses: v.vidaUtilMeses } : {}),
    crlvExercicio: v.crlvExercicio,
    crvSituacao: v.crvSituacao,
    ipvaSituacao: v.ipvaSituacao,
    ipvaIsencaoInicio: v.ipvaIsencaoInicio,
    tagPedagio: v.tagPedagio,
    apoliceId,
    apoliceVencimento: v.apoliceVencimento,
    status: v.status,
    dataVenda: v.dataVenda,
    valorVendaCents: big(v.valorVendaCents),
    compradorNome: v.compradorNome,
    transferenciaSituacao: v.transferenciaSituacao,
  };
}

const igual = (a: unknown, b: unknown) => {
  const n = (x: unknown) => (x instanceof Date ? x.toISOString() : typeof x === "bigint" ? x.toString() : (x ?? null));
  return JSON.stringify(n(a)) === JSON.stringify(n(b));
};

// "FRETAMENTO - 1002806001249", "CARGAS - 1002806000524 - SOMBRERO",
// "VEÍCULO LEVE - SUHAI RCF (TERCEIROS)" → segmento, número, seguradora.
export function lerApolice(descricao: string): { segmento: string | null; numero: string | null; seguradora: string | null } {
  const partes = descricao.split(/\s+-\s+/).map((p) => p.trim());
  const seg = (partes[0] ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const segmento = /fretamento/.test(seg) ? "fretamento" : /escolar/.test(seg) ? "escolar" : /carga/.test(seg) ? "cargas" : /antt/.test(seg) ? "antt" : /leve/.test(seg) ? "veiculo_leve" : "outro";
  const numero = partes.find((p) => /^\d{6,}$/.test(p)) ?? null;
  const seguradora = /SOMBRERO/i.test(descricao) ? "Sombrero" : /SUHAI/i.test(descricao) ? "Suhai" : /BRADESCO/i.test(descricao) ? "Bradesco" : /ESSOR/i.test(descricao) ? "Essor" : null;
  return { segmento, numero, seguradora };
}

export type ResultadoGravacao = { etapa: string; novos: number; atualizados: number; iguais: number; detalhes: string[] };

// ---- Etapa 1: a frota ----

export async function gravarFrota(companyId: string, usuario: string, leitura: LeituraMigracao): Promise<ResultadoGravacao> {
  const r: ResultadoGravacao = { etapa: "frota", novos: 0, atualizados: 0, iguais: 0, detalhes: [] };
  const agora = new Date();

  // Apólices: uma por descrição, com o vencimento mais comum entre os veículos.
  const porApolice = new Map<string, Map<string, number>>();
  for (const v of leitura.veiculos) {
    if (!v.apoliceDescricao) continue;
    const m = porApolice.get(v.apoliceDescricao) ?? new Map<string, number>();
    const k = v.apoliceVencimento?.toISOString() ?? "";
    m.set(k, (m.get(k) ?? 0) + 1);
    porApolice.set(v.apoliceDescricao, m);
  }
  const apolices = new Map<string, string>();
  for (const [descricao, vencs] of porApolice) {
    const maisComum = [...vencs.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const a = await prisma.frotaApolice.upsert({
      where: { companyId_descricao: { companyId, descricao } },
      create: { companyId, descricao, ...lerApolice(descricao), vigenciaFim: maisComum ? new Date(maisComum) : null },
      update: {},
      select: { id: true },
    });
    apolices.set(descricao, a.id);
  }
  r.detalhes.push(`${apolices.size} apólice(s)`);

  // Veículos: pela placa; o não emplacado, pelo chassi.
  const existentes = await prisma.cadVeiculo.findMany({ where: { companyId } });
  const porPlaca = new Map(existentes.filter((v) => v.placa).map((v) => [v.placa as string, v]));
  const porChassi = new Map(existentes.filter((v) => v.chassi).map((v) => [v.chassi as string, v]));
  const novos: Campos[] = [];
  const logs: Prisma.AudLogCreateManyInput[] = [];
  const idDoVeiculo = new Map<string, string>();
  for (const v of leitura.veiculos) {
    const campos = camposDoVeiculo(v, v.apoliceDescricao ? (apolices.get(v.apoliceDescricao) ?? null) : null);
    const atual = (v.placa ? porPlaca.get(v.placa) : undefined) ?? (v.chassi ? porChassi.get(v.chassi) : undefined);
    if (!atual) {
      novos.push({ companyId, ...campos, origens: { planilha: v.origens.join(", ") } });
      continue;
    }
    idDoVeiculo.set(v.chave, atual.id);
    // O que a planilha não sabe (nulo) não apaga o que o cadastro tem.
    const mudou = Object.fromEntries(Object.entries(campos).filter(([k, x]) => x !== null && x !== undefined && !igual((atual as Campos)[k], x)));
    // Chassi de outro veículo já cadastrado: não troca (a chave é única).
    if (mudou.chassi && porChassi.get(mudou.chassi as string) && porChassi.get(mudou.chassi as string)!.id !== atual.id) delete mudou.chassi;
    if (Object.keys(mudou).length === 0) {
      r.iguais++;
      continue;
    }
    await prisma.cadVeiculo.update({ where: { id: atual.id }, data: { ...mudou, origens: { ...((atual.origens as Campos) ?? {}), planilha: v.origens.join(", ") } } as Prisma.CadVeiculoUpdateInput });
    logs.push({ companyId, usuario, agente: AGENTE, tabela: "CadVeiculo", registroId: atual.id, operacao: "update", antes: protegerRegistro(Object.fromEntries(Object.keys(mudou).map((k) => [k, (atual as Campos)[k] ?? null]))) as Prisma.InputJsonValue, depois: protegerRegistro(mudou) as Prisma.InputJsonValue });
    r.atualizados++;
  }
  for (let i = 0; i < novos.length; i += 200) {
    await prisma.cadVeiculo.createMany({ data: novos.slice(i, i + 200) as Prisma.CadVeiculoCreateManyInput[], skipDuplicates: true });
  }
  r.novos = novos.length;
  const todos = await prisma.cadVeiculo.findMany({ where: { companyId }, select: { id: true, placa: true, chassi: true } });
  const idPorPlaca = new Map(todos.filter((v) => v.placa).map((v) => [v.placa as string, v.id]));
  const idPorChassi = new Map(todos.filter((v) => v.chassi).map((v) => [v.chassi as string, v.id]));
  for (const v of leitura.veiculos) {
    const id = (v.placa ? idPorPlaca.get(v.placa) : undefined) ?? (v.chassi ? idPorChassi.get(v.chassi) : undefined);
    if (id) idDoVeiculo.set(v.chave, id);
  }
  for (const n of novos) {
    const id = (n.placa ? idPorPlaca.get(n.placa as string) : undefined) ?? (n.chassi ? idPorChassi.get(n.chassi as string) : undefined);
    if (id) logs.push({ companyId, usuario, agente: AGENTE, tabela: "CadVeiculo", registroId: id, operacao: "insert", depois: protegerRegistro(n) as Prisma.InputJsonValue });
  }

  // Centro de custo de cada veículo emplacado (V-<placa>).
  const comCentro = new Set((await prisma.cadCentroCusto.findMany({ where: { companyId, tipo: "veiculo" }, select: { veiculoId: true } })).map((c) => c.veiculoId));
  const centros = todos.filter((v) => v.placa && !comCentro.has(v.id)).map((v) => ({ companyId, codigo: `V-${v.placa}`, tipo: "veiculo", veiculoId: v.id }));
  await prisma.cadCentroCusto.createMany({ data: centros, skipDuplicates: true });

  // Documentos: um por tipo e veículo; só grava o que mudou.
  const docsAtuais = await prisma.frotaDocumento.findMany({ where: { companyId } });
  const docPorChave = new Map(docsAtuais.map((d) => [`${d.veiculoId}|${d.tipo}`, d]));
  const docsNovos: Prisma.FrotaDocumentoCreateManyInput[] = [];
  let docsAtualizados = 0;
  for (const v of leitura.veiculos) {
    const veiculoId = idDoVeiculo.get(v.chave);
    if (!veiculoId) continue;
    for (const d of v.documentos) {
      const atual = docPorChave.get(`${veiculoId}|${d.tipo}`);
      const dados = { numero: d.numero, validade: d.validade, situacao: d.situacao, observacao: d.observacao };
      if (!atual) docsNovos.push({ companyId, veiculoId, tipo: d.tipo, ...dados, atualizadoPor: usuario });
      else if (Object.entries(dados).some(([k, x]) => !igual((atual as Campos)[k], x))) {
        await prisma.frotaDocumento.update({ where: { id: atual.id }, data: { ...dados, atualizadoPor: usuario } });
        logs.push({ companyId, usuario, agente: AGENTE, tabela: "FrotaDocumento", registroId: atual.id, operacao: "update", antes: protegerRegistro({ numero: atual.numero, validade: atual.validade, situacao: atual.situacao }) as Prisma.InputJsonValue, depois: protegerRegistro(dados) as Prisma.InputJsonValue });
        docsAtualizados++;
      }
    }
  }
  for (let i = 0; i < docsNovos.length; i += 500) await prisma.frotaDocumento.createMany({ data: docsNovos.slice(i, i + 500), skipDuplicates: true });
  r.detalhes.push(`${docsNovos.length} documento(s) novo(s), ${docsAtualizados} atualizado(s)`);

  // Consultas de placa (LW, Fazenda).
  const consultas: Prisma.FrotaConsultaCreateManyInput[] = [];
  for (const v of leitura.veiculos) {
    const veiculoId = idDoVeiculo.get(v.chave);
    if (veiculoId) for (const c of v.consultas) consultas.push({ companyId, veiculoId, fonte: c.fonte, consultadoEm: c.data, registradoPor: usuario });
  }
  const gravadas = await prisma.frotaConsulta.createMany({ data: consultas, skipDuplicates: true });
  r.detalhes.push(`${gravadas.count} consulta(s) de placa`);

  logs.push({ companyId, usuario, agente: AGENTE, tabela: "Migracao", registroId: "frota", operacao: "insert", depois: { veiculosNovos: r.novos, atualizados: r.atualizados, iguais: r.iguais, em: agora.toISOString() } });
  for (let i = 0; i < logs.length; i += 500) await prisma.audLog.createMany({ data: logs.slice(i, i + 500) });
  return r;
}

// ---- Etapa 2: os contratos ----

function camposDoContrato(f: FinanciamentoMigrado, informadoEm: Date): Campos {
  return {
    produto: f.produto,
    modalidade: f.modalidade,
    instituicao: f.instituicao,
    contratoNumero: f.contratoNumero,
    celulaCredito: f.celulaCredito,
    grupo: f.grupo,
    cota: f.cota,
    dataInicio: f.dataInicio,
    dataFinal: f.dataFinal,
    valorBensCents: big(f.valorBensCents),
    entradaCents: big(f.entradaCents),
    valorFinanciadoCents: big(f.valorFinanciadoCents),
    valorCreditadoCents: big(f.valorCreditadoCents),
    lanceCents: big(f.lanceCents),
    lancePlanejadoPct: f.lancePlanejadoPct,
    taxaPct: f.taxaPct,
    vencimentoDia: f.vencimentoDia,
    parcelas: f.parcelas,
    parcelasPagas: f.parcelasPagas,
    valorParcelaCents: big(f.valorParcelaCents),
    valorPagoCents: big(f.valorPagoCents),
    saldoQuitacaoCents: big(f.saldoQuitacaoCents),
    saldoInformadoEm: informadoEm,
    situacaoConsorcio: f.situacaoConsorcio,
    dataContemplacao: f.dataContemplacao,
    ativo: !f.quitado,
    dataQuitacao: f.quitado ? (f.dataFinal ?? null) : null,
    motivoEncerramento: f.quitado ? "quitado (planilha)" : null,
    garantia: f.produto === "consorcio" ? null : f.alienado ? "alienação fiduciária" : null,
    observacoes: f.observacoes,
    origem: `planilha:${f.chave}`,
  };
}

// A data a que a planilha se refere: a do "Acumulado Geral" (Controle Geral)
// quando a tela a informar; senão, a da migração.
export async function gravarContratos(companyId: string, usuario: string, leitura: LeituraMigracao, informadoEm: Date): Promise<ResultadoGravacao> {
  const r: ResultadoGravacao = { etapa: "contratos", novos: 0, atualizados: 0, iguais: 0, detalhes: [] };
  const existentes = await prisma.frotaFinanciamento.findMany({ where: { companyId, origem: { startsWith: "planilha:" } } });
  const porOrigem = new Map(existentes.map((f) => [f.origem as string, f]));
  const logs: Prisma.AudLogCreateManyInput[] = [];
  const novos: Prisma.FrotaFinanciamentoCreateManyInput[] = [];
  for (const f of leitura.financiamentos) {
    const campos = camposDoContrato(f, informadoEm);
    const atual = porOrigem.get(campos.origem as string);
    if (!atual) {
      novos.push({ companyId, ...(campos as Omit<Prisma.FrotaFinanciamentoCreateManyInput, "companyId">) });
      continue;
    }
    // Rodar de novo: só o que a planilha mudou (e nunca o que a Omie já
    // atualizou depois — parcelas e saldo ficam se a planilha é mais velha).
    const mudou = Object.fromEntries(Object.entries(campos).filter(([k, x]) => !["saldoInformadoEm", "parcelasPagas", "saldoQuitacaoCents"].includes(k) && x !== null && !igual((atual as Campos)[k], x)));
    if (Object.keys(mudou).length === 0) {
      r.iguais++;
      continue;
    }
    await prisma.frotaFinanciamento.update({ where: { id: atual.id }, data: mudou as Prisma.FrotaFinanciamentoUpdateInput });
    logs.push({ companyId, usuario, agente: AGENTE, tabela: "FrotaFinanciamento", registroId: atual.id, operacao: "update", antes: protegerRegistro(Object.fromEntries(Object.keys(mudou).map((k) => [k, (atual as Campos)[k] ?? null]))) as Prisma.InputJsonValue, depois: protegerRegistro(mudou) as Prisma.InputJsonValue });
    r.atualizados++;
  }
  for (let i = 0; i < novos.length; i += 200) await prisma.frotaFinanciamento.createMany({ data: novos.slice(i, i + 200) });
  r.novos = novos.length;

  // Os veículos de cada contrato.
  const contratos = await prisma.frotaFinanciamento.findMany({ where: { companyId, origem: { startsWith: "planilha:" } }, select: { id: true, origem: true } });
  const idDoContrato = new Map(contratos.map((c) => [c.origem as string, c.id]));
  for (const c of contratos) if (!porOrigem.has(c.origem as string)) logs.push({ companyId, usuario, agente: AGENTE, tabela: "FrotaFinanciamento", registroId: c.id, operacao: "insert", depois: { origem: c.origem } });
  const veiculos = await prisma.cadVeiculo.findMany({ where: { companyId }, select: { id: true, placa: true, chassi: true } });
  const idPorChave = new Map<string, string>();
  for (const v of veiculos) {
    if (v.placa) idPorChave.set(`P:${v.placa}`, v.id);
    if (v.chassi) idPorChave.set(`C:${v.chassi}`, v.id);
  }
  const vinculos: Prisma.FrotaFinanciamentoVeiculoCreateManyInput[] = [];
  let semVeiculo = 0;
  for (const f of leitura.financiamentos) {
    const financiamentoId = idDoContrato.get(`planilha:${f.chave}`);
    if (!financiamentoId) continue;
    for (const v of f.veiculos) {
      const veiculoId = idPorChave.get(v.chave);
      if (!veiculoId) {
        semVeiculo++;
        continue;
      }
      vinculos.push({ companyId, financiamentoId, veiculoId, parcelaCents: big(v.parcelaCents), saldoCents: big(v.saldoCents), alienado: f.alienado && !f.quitado });
    }
  }
  const ligados = await prisma.frotaFinanciamentoVeiculo.createMany({ data: vinculos, skipDuplicates: true });
  r.detalhes.push(`${ligados.count} vínculo(s) veículo × contrato`);
  if (semVeiculo) r.detalhes.push(`${semVeiculo} vínculo(s) sem o veículo no cadastro — rode a etapa da frota antes`);
  logs.push({ companyId, usuario, agente: AGENTE, tabela: "Migracao", registroId: "contratos", operacao: "insert", depois: { contratosNovos: r.novos, atualizados: r.atualizados, iguais: r.iguais, informadoEm: informadoEm.toISOString() } });
  for (let i = 0; i < logs.length; i += 500) await prisma.audLog.createMany({ data: logs.slice(i, i + 500) });
  return r;
}
