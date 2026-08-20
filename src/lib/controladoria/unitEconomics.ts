import type { OmieTitulo } from "@prisma/client";
import type { ContextoAuditoria } from "./types";
import type { Periodo } from "./periodos";
import { dentro } from "./periodos";
import { somar } from "./agents/comum";

// UNIT ECONOMICS — custo por contrato, por veiculo e por funcionario.
//
// Objetivo declarado pelo usuario: "conhecer a empresa pela analise
// financeira dela" e chegar ao custo por contrato/veiculo/funcionario para
// melhorar rentabilidade e geracao de caixa.
//
// Duas decisoes de projeto sustentam isso e valem estar escritas:
//
// 1. NADA e inventado. Um custo so e atribuido a um contrato/veiculo/
//    funcionario quando existe uma ligacao verificavel: um vinculo de centro
//    de custo CONFIRMADO por uma pessoa (OmieVinculoCentroCusto), uma placa
//    citada no proprio documento, ou um dado que ja nasce vinculado (o
//    abastecimento do cartao de frota, que tem veiculo e motorista). O que
//    nao se encaixa vai para "nao alocado" e aparece como tal.
//
// 2. A COBERTURA e um numero de primeira classe. Dizer "o contrato X custa R$
//    120 mil" escondendo que 40% do custo total nao foi alocado e pior do que
//    nao dizer nada — a decisao tomada em cima disso estaria errada por
//    construcao. Por isso toda saida deste modulo carrega a cobertura junto.

export type LinhaCusto = {
  id: string;
  nome: string;
  custoCents: number;
  receitaCents: number;
  margemCents: number;
  margemPercent: number | null;
  // De onde veio a alocacao, para o numero ser auditavel: "vinculo",
  // "placa-no-documento", "cartao-frota", "folha".
  origens: string[];
};

export type ResultadoRateio<T> = {
  linhas: T[];
  naoAlocadoCents: number;
  totalCents: number;
  // 0 a 100. Abaixo de ~70% qualquer ranking de rentabilidade e chute.
  coberturaPercent: number;
};

type Destino = { clienteId?: string; vehicleId?: string; driverId?: string; percentual: number; origem: string };

// Ordem de precedencia dos vinculos: do mais especifico para o mais generico.
// Projeto costuma representar um contrato individual; categoria e a dimensao
// mais grosseira e so entra quando nada melhor existe.
const PRECEDENCIA: string[] = ["PROJETO", "DEPARTAMENTO", "TEXTO", "PARCEIRO", "CATEGORIA"];

function valorDaOrigem(titulo: OmieTitulo, tipoOrigem: string): string | null {
  switch (tipoOrigem) {
    case "PROJETO":
      return titulo.projetoCodigo;
    case "DEPARTAMENTO":
      return titulo.departamentoCodigo;
    case "CATEGORIA":
      return titulo.categoriaCodigo;
    case "PARCEIRO":
      return titulo.parceiroCodigo;
    default:
      return null;
  }
}

// Resolve para onde o custo de um titulo vai. So vinculos CONFIRMADOS entram:
// sugestao automatica nunca move dinheiro sozinha (mesma regra da extracao de
// CCT por IA neste projeto — a maquina sugere, a pessoa confirma).
export function resolverDestinos(ctx: ContextoAuditoria, titulo: OmieTitulo): Destino[] {
  const confirmados = ctx.vinculos.filter((v) => !v.sugerido);

  for (const tipo of PRECEDENCIA) {
    if (tipo === "TEXTO") {
      const texto = `${titulo.observacao ?? ""} ${titulo.numeroDocumento ?? ""}`.toUpperCase();
      const porTexto = confirmados.filter(
        (v) => v.tipoOrigem === "TEXTO" && texto.includes(v.valorOrigem.toUpperCase())
      );
      if (porTexto.length > 0) {
        return porTexto.map((v) => ({
          clienteId: v.clienteId ?? undefined,
          vehicleId: v.vehicleId ?? undefined,
          driverId: v.driverId ?? undefined,
          percentual: v.percentual,
          origem: "vinculo",
        }));
      }
      continue;
    }

    const valor = valorDaOrigem(titulo, tipo);
    if (!valor) continue;
    const encontrados = confirmados.filter((v) => v.tipoOrigem === tipo && v.valorOrigem === valor);
    if (encontrados.length > 0) {
      return encontrados.map((v) => ({
        clienteId: v.clienteId ?? undefined,
        vehicleId: v.vehicleId ?? undefined,
        driverId: v.driverId ?? undefined,
        percentual: v.percentual,
        origem: "vinculo",
      }));
    }
  }

  // Sem vinculo: ultima tentativa objetiva — a placa de um veiculo da frota
  // citada no documento/observacao do titulo. Isso e verificavel (a placa
  // esta escrita la), diferente de adivinhar por semelhanca de nome.
  const texto = `${titulo.observacao ?? ""} ${titulo.numeroDocumento ?? ""}`.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  if (texto.length >= 7) {
    const veiculo = ctx.veiculos.find((v) => texto.includes(v.plate.replace(/[^A-Z0-9]/gi, "").toUpperCase()));
    if (veiculo) return [{ vehicleId: veiculo.id, percentual: 100, origem: "placa-no-documento" }];
  }

  return [];
}

function titulosDoPeriodo(ctx: ContextoAuditoria, periodo: Periodo, natureza: "PAGAR" | "RECEBER"): OmieTitulo[] {
  return ctx.titulos.filter(
    (t) => t.natureza === natureza && !t.cancelado && dentro(t.dataVencimento, periodo)
  );
}

// ---------- Custo e receita por contrato (Cliente) ----------

export function rentabilidadePorContrato(
  ctx: ContextoAuditoria,
  periodo: Periodo,
  nomesCliente: Map<string, string>
): ResultadoRateio<LinhaCusto> {
  const custos = new Map<string, { valor: number; origens: Set<string> }>();
  const receitas = new Map<string, number>();
  let naoAlocado = 0;
  let total = 0;

  for (const titulo of titulosDoPeriodo(ctx, periodo, "PAGAR")) {
    total += titulo.valorDocumentoCents;
    const destinos = resolverDestinos(ctx, titulo).filter((d) => d.clienteId);
    if (destinos.length === 0) {
      naoAlocado += titulo.valorDocumentoCents;
      continue;
    }
    let alocado = 0;
    for (const d of destinos) {
      const parcela = Math.round((titulo.valorDocumentoCents * d.percentual) / 100);
      alocado += parcela;
      const atual = custos.get(d.clienteId!) ?? { valor: 0, origens: new Set<string>() };
      atual.valor += parcela;
      atual.origens.add(d.origem);
      custos.set(d.clienteId!, atual);
    }
    // Rateio que nao fecha 100% (ver OmieVinculoCentroCusto.percentual): o
    // resto vira "nao alocado" em vez de o sistema completar por conta.
    naoAlocado += Math.max(0, titulo.valorDocumentoCents - alocado);
  }

  for (const titulo of titulosDoPeriodo(ctx, periodo, "RECEBER")) {
    const destinos = resolverDestinos(ctx, titulo).filter((d) => d.clienteId);
    for (const d of destinos) {
      const parcela = Math.round((titulo.valorDocumentoCents * d.percentual) / 100);
      receitas.set(d.clienteId!, (receitas.get(d.clienteId!) ?? 0) + parcela);
    }
  }

  // Custo de combustivel do cartao de frota, alocado pelo cliente do
  // motorista (Driver.clienteId ja existe no cadastro e e mantido pela
  // importacao da planilha de centro de custo).
  const clientePorMotorista = new Map(ctx.motoristas.map((m) => [m.id, m.clienteId]));
  for (const abastecimento of ctx.abastecimentos) {
    if (!dentro(abastecimento.dataHora, periodo)) continue;
    total += abastecimento.valorCents;
    const clienteId = abastecimento.driverId ? clientePorMotorista.get(abastecimento.driverId) : null;
    if (!clienteId) {
      naoAlocado += abastecimento.valorCents;
      continue;
    }
    const atual = custos.get(clienteId) ?? { valor: 0, origens: new Set<string>() };
    atual.valor += abastecimento.valorCents;
    atual.origens.add("cartao-frota");
    custos.set(clienteId, atual);
  }

  const ids = new Set([...custos.keys(), ...receitas.keys()]);
  const linhas: LinhaCusto[] = [...ids].map((id) => {
    const custo = custos.get(id)?.valor ?? 0;
    const receita = receitas.get(id) ?? 0;
    const margem = receita - custo;
    return {
      id,
      nome: nomesCliente.get(id) ?? "(contrato sem nome)",
      custoCents: custo,
      receitaCents: receita,
      margemCents: margem,
      margemPercent: receita > 0 ? (margem / receita) * 100 : null,
      origens: [...(custos.get(id)?.origens ?? [])],
    };
  });

  linhas.sort((a, b) => b.receitaCents - a.receitaCents);

  return {
    linhas,
    naoAlocadoCents: naoAlocado,
    totalCents: total,
    coberturaPercent: total > 0 ? ((total - naoAlocado) / total) * 100 : 0,
  };
}

// ---------- Custo por veiculo ----------

export function custoPorVeiculo(ctx: ContextoAuditoria, periodo: Periodo): ResultadoRateio<LinhaCusto> {
  const custos = new Map<string, { valor: number; origens: Set<string> }>();
  let naoAlocado = 0;
  let total = 0;

  const registrar = (vehicleId: string, valor: number, origem: string) => {
    const atual = custos.get(vehicleId) ?? { valor: 0, origens: new Set<string>() };
    atual.valor += valor;
    atual.origens.add(origem);
    custos.set(vehicleId, atual);
  };

  for (const titulo of titulosDoPeriodo(ctx, periodo, "PAGAR")) {
    total += titulo.valorDocumentoCents;
    const destinos = resolverDestinos(ctx, titulo).filter((d) => d.vehicleId);
    if (destinos.length === 0) {
      naoAlocado += titulo.valorDocumentoCents;
      continue;
    }
    let alocado = 0;
    for (const d of destinos) {
      const parcela = Math.round((titulo.valorDocumentoCents * d.percentual) / 100);
      alocado += parcela;
      registrar(d.vehicleId!, parcela, d.origem);
    }
    naoAlocado += Math.max(0, titulo.valorDocumentoCents - alocado);
  }

  // O abastecimento ja nasce com veiculo: e a fonte mais confiavel de custo
  // por veiculo que a empresa tem hoje.
  for (const abastecimento of ctx.abastecimentos) {
    if (!dentro(abastecimento.dataHora, periodo)) continue;
    total += abastecimento.valorCents;
    if (!abastecimento.vehicleId) {
      naoAlocado += abastecimento.valorCents;
      continue;
    }
    registrar(abastecimento.vehicleId, abastecimento.valorCents, "cartao-frota");
  }

  const nomes = new Map(ctx.veiculos.map((v) => [v.id, v.plate]));
  const linhas: LinhaCusto[] = [...custos.entries()].map(([id, dados]) => ({
    id,
    nome: nomes.get(id) ?? "(veículo removido)",
    custoCents: dados.valor,
    receitaCents: 0,
    margemCents: -dados.valor,
    margemPercent: null,
    origens: [...dados.origens],
  }));
  linhas.sort((a, b) => b.custoCents - a.custoCents);

  return {
    linhas,
    naoAlocadoCents: naoAlocado,
    totalCents: total,
    coberturaPercent: total > 0 ? ((total - naoAlocado) / total) * 100 : 0,
  };
}

// ---------- Custo por funcionario ----------
// Combina o que ja existe neste sistema (abastecimento vinculado ao
// motorista) com o que vier da Omie por vinculo. O custo de FOLHA em si
// (salario, encargos) so entra quando a folha estiver classificada por
// funcionario na Omie — enquanto nao estiver, isto e explicitamente parcial,
// e a cobertura mostra isso em vez de fingir um numero completo.
export function custoPorFuncionario(ctx: ContextoAuditoria, periodo: Periodo): ResultadoRateio<LinhaCusto> {
  const custos = new Map<string, { valor: number; origens: Set<string> }>();
  let naoAlocado = 0;
  let total = 0;

  const registrar = (driverId: string, valor: number, origem: string) => {
    const atual = custos.get(driverId) ?? { valor: 0, origens: new Set<string>() };
    atual.valor += valor;
    atual.origens.add(origem);
    custos.set(driverId, atual);
  };

  for (const titulo of titulosDoPeriodo(ctx, periodo, "PAGAR")) {
    total += titulo.valorDocumentoCents;
    const destinos = resolverDestinos(ctx, titulo).filter((d) => d.driverId);
    if (destinos.length === 0) {
      naoAlocado += titulo.valorDocumentoCents;
      continue;
    }
    for (const d of destinos) {
      registrar(d.driverId!, Math.round((titulo.valorDocumentoCents * d.percentual) / 100), d.origem);
    }
  }

  for (const abastecimento of ctx.abastecimentos) {
    if (!dentro(abastecimento.dataHora, periodo)) continue;
    total += abastecimento.valorCents;
    if (!abastecimento.driverId) {
      naoAlocado += abastecimento.valorCents;
      continue;
    }
    registrar(abastecimento.driverId, abastecimento.valorCents, "cartao-frota");
  }

  const nomes = new Map(ctx.motoristas.map((m) => [m.id, m.name]));
  const linhas: LinhaCusto[] = [...custos.entries()].map(([id, dados]) => ({
    id,
    nome: nomes.get(id) ?? "(funcionário removido)",
    custoCents: dados.valor,
    receitaCents: 0,
    margemCents: -dados.valor,
    margemPercent: null,
    origens: [...dados.origens],
  }));
  linhas.sort((a, b) => b.custoCents - a.custoCents);

  return {
    linhas,
    naoAlocadoCents: naoAlocado,
    totalCents: total,
    coberturaPercent: total > 0 ? ((total - naoAlocado) / total) * 100 : 0,
  };
}

// Sugestao automatica de vinculo por semelhanca de nome entre a dimensao da
// Omie (departamento/projeto) e o cadastro de contrato deste sistema.
// Devolve SUGESTOES — quem confirma e uma pessoa, na tela de rentabilidade.
export function sugerirVinculos(
  ctx: ContextoAuditoria,
  clientes: { id: string; nome: string }[]
): { tipoOrigem: string; valorOrigem: string; rotuloOrigem: string; clienteId: string; clienteNome: string }[] {
  const normalizar = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");

  const jaVinculados = new Set(ctx.vinculos.map((v) => `${v.tipoOrigem}:${v.valorOrigem}`));
  const sugestoes: ReturnType<typeof sugerirVinculos> = [];

  const dimensoes = [
    ...ctx.departamentos.filter((d) => !d.inativo).map((d) => ({ tipo: "DEPARTAMENTO", codigo: d.codigo, rotulo: d.descricao })),
  ];

  for (const dim of dimensoes) {
    if (jaVinculados.has(`${dim.tipo}:${dim.codigo}`)) continue;
    const alvo = normalizar(dim.rotulo);
    if (alvo.length < 4) continue;

    const cliente = clientes.find((c) => {
      const nome = normalizar(c.nome);
      return nome.length >= 4 && (alvo.includes(nome) || nome.includes(alvo));
    });
    if (!cliente) continue;

    sugestoes.push({
      tipoOrigem: dim.tipo,
      valorOrigem: dim.codigo,
      rotuloOrigem: dim.rotulo,
      clienteId: cliente.id,
      clienteNome: cliente.nome,
    });
  }

  return sugestoes;
}

// Total de custo do periodo, usado pelo BSC e pelo agente de rentabilidade
// para calcular cobertura sem repetir a montagem do rateio.
export function custoTotalPeriodo(ctx: ContextoAuditoria, periodo: Periodo): number {
  return (
    somar(titulosDoPeriodo(ctx, periodo, "PAGAR"), (t) => t.valorDocumentoCents) +
    somar(
      ctx.abastecimentos.filter((a) => dentro(a.dataHora, periodo)),
      (a) => a.valorCents
    )
  );
}
