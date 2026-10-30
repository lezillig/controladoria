import { prisma } from "@/lib/prisma";
import { lerMotoristas, lerVeiculos } from "@/lib/gestao/leitura";
import type { Prisma } from "@prisma/client";
import { protegerRegistro, registrarAlteracao } from "@/lib/auditoria/trilha";
import { criarPendencia } from "@/lib/auditoria/pendencias";
import { normalizarCnpj, normalizarCpf, normalizarPlaca, tipoDeVeiculo } from "./normalizacao";

// A CARGA DO CADASTRO MESTRE a partir das fontes que o sistema já lê (spec 01):
//   fornecedor/cliente ... parceiros da Omie (as duas contas), por CNPJ;
//   pessoa ............... motoristas da gestão, por CPF;
//   veículo .............. veículos da gestão, por placa.
// As planilhas (CONTROLE INFORMAÇÕES GERAIS, Consórcios e Financiamentos) e a
// Ituran entram por importadores próprios.
//
// A REGRA DA CARGA: a fonte CRIA o que falta e COMPLETA campo vazio; nunca
// sobrescreve o que o cadastro já tem. Valor diferente entre o cadastro e a
// fonte vira DIVERGÊNCIA no relatório — a pessoa decide qual vale (spec 01:
// "divergências viram relatório, não bloqueio"). Rodar de novo não duplica
// nada: as chaves naturais são únicas.

export type Divergencia = { entidade: string; chave: string; campo: string; cadastro: string; fonte: string };
export type ResultadoCarga = {
  entidade: string;
  fonte: string;
  lidos: number;
  novos: number;
  completados: number;
  iguais: number;
  ignorados: Record<string, number>;
  divergencias: Divergencia[];
};

const MAX_DIVERGENCIAS = 300;
const AGENTE = "carga-cadastro";

type Campos = Record<string, unknown>;
const vazio = (v: unknown) => v === null || v === undefined || v === "";
const texto = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v));

// Compara o que o cadastro tem com o que a fonte trouxe: o que completar e o
// que diverge.
export function mesclar(atual: Campos, fonte: Campos, ignorarDivergencia: string[] = []): { completar: Campos; divergentes: { campo: string; cadastro: string; fonte: string }[] } {
  const completar: Campos = {};
  const divergentes: { campo: string; cadastro: string; fonte: string }[] = [];
  for (const [campo, valor] of Object.entries(fonte)) {
    if (vazio(valor)) continue;
    if (vazio(atual[campo])) completar[campo] = valor;
    else if (texto(atual[campo]) !== texto(valor) && !ignorarDivergencia.includes(campo)) divergentes.push({ campo, cadastro: texto(atual[campo]), fonte: texto(valor) });
  }
  return { completar, divergentes };
}

function novoResultado(entidade: string, fonte: string): ResultadoCarga {
  return { entidade, fonte, lidos: 0, novos: 0, completados: 0, iguais: 0, ignorados: {}, divergencias: [] };
}
const ignorar = (r: ResultadoCarga, motivo: string) => (r.ignorados[motivo] = (r.ignorados[motivo] ?? 0) + 1);

// Grava um registro do cadastro: completa ou só conta — sempre com trilha. O
// que é NOVO não é criado aqui: vai para o lote (`novos`), gravado de uma vez
// por `inserirLote` — a primeira carga traz milhares de parceiros da Omie, e
// um INSERT por linha não cabe no tempo de uma requisição.
type Reg = { id: string } & Campos;
async function gravar(p: {
  r: ResultadoCarga;
  companyId: string;
  usuario: string;
  tabela: string;
  chave: string;
  existente: Reg | null;
  campos: Campos;
  novos: Campos[];
  extrasDoNovo?: Campos;
  atualizar: (id: string, dados: Campos) => Promise<unknown>;
  origem: Record<string, string>;
  ignorarDivergencia?: string[];
}): Promise<void> {
  const { r } = p;
  if (!p.existente) {
    p.novos.push({ companyId: p.companyId, ...p.campos, ...(p.extrasDoNovo ?? {}), origens: p.origem });
    r.novos++;
    return;
  }
  const { completar, divergentes } = mesclar(p.existente, p.campos, p.ignorarDivergencia);
  for (const d of divergentes) if (r.divergencias.length < MAX_DIVERGENCIAS) r.divergencias.push({ entidade: r.entidade, chave: p.chave, ...d });
  const origensAtuais = (p.existente.origens as Record<string, string>) ?? {};
  const origens = { ...origensAtuais, ...p.origem };
  const origemNova = Object.entries(p.origem).some(([k, v]) => origensAtuais[k] !== v);
  if (Object.keys(completar).length > 0 || origemNova) {
    await p.atualizar(p.existente.id, { ...completar, ...(origemNova ? { origens } : {}) });
  }
  if (Object.keys(completar).length > 0) {
    const antes = Object.fromEntries(Object.keys(completar).map((k) => [k, p.existente![k] ?? null]));
    await registrarAlteracao(prisma, { companyId: p.companyId, usuario: p.usuario, agente: AGENTE, tabela: p.tabela, registroId: p.existente.id, operacao: "update", antes, depois: completar });
    r.completados++;
  } else r.iguais++;
}

type Modelo = { createMany: (a: { data: Campos[]; skipDuplicates: boolean }) => Promise<unknown>; findMany: (a: object) => Promise<Reg[]> };

// O lote dos novos: um INSERT para todos, e a trilha de cada um num segundo.
async function inserirLote(p: { companyId: string; usuario: string; tabela: string; modelo: Modelo; chaveCampo: string; novos: Campos[] }): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (let i = 0; i < p.novos.length; i += 500) {
    const lote = p.novos.slice(i, i + 500);
    await p.modelo.createMany({ data: lote, skipDuplicates: true });
    const criados = await p.modelo.findMany({ where: { companyId: p.companyId, [p.chaveCampo]: { in: lote.map((n) => n[p.chaveCampo]) } }, select: { id: true, [p.chaveCampo]: true } });
    for (const c of criados) ids.set(String(c[p.chaveCampo]), c.id);
    await prisma.audLog.createMany({
      data: lote
        .filter((n) => ids.has(String(n[p.chaveCampo])))
        .map((n) => {
          const { companyId: _c, origens: _o, ...campos } = n;
          void _c;
          void _o;
          return { companyId: p.companyId, usuario: p.usuario, agente: AGENTE, tabela: p.tabela, registroId: ids.get(String(n[p.chaveCampo]))!, operacao: "insert", depois: protegerRegistro(campos) as Prisma.InputJsonValue };
        }),
    });
  }
  return ids;
}

// ---- Parceiros da Omie → fornecedor e cliente ----

// Cliente que é órgão público, pelo nome (o tipo pode ser corrigido na tela).
const ORGAO_PUBLICO = /PREFEITURA|MUNICIPIO|ESTADO D|GOVERNO|SECRETARIA|FUNDACAO|FUNDAÇÃO|AUTARQUIA|CAMARA MUNICIPAL|C[ÂA]MARA MUNICIPAL|TRIBUNAL|UNIVERSIDADE|INSTITUTO FEDERAL|CONSORCIO INTERMUNICIPAL|CONS[ÓO]RCIO INTERMUNICIPAL/i;

export async function carregarParceiros(companyId: string, usuario: string): Promise<ResultadoCarga[]> {
  const parceiros = await prisma.omieParceiro.findMany({
    where: { companyId },
    select: { conexaoApelido: true, codigoOmie: true, nome: true, nomeFantasia: true, documento: true, ehCliente: true, ehFornecedor: true, inativo: true },
  });
  const forn = novoResultado("fornecedor", "Omie");
  const cli = novoResultado("cliente", "Omie");
  // Um CNPJ pode estar nas duas contas: um registro, com os dois códigos.
  const porCnpj = new Map<string, { nome: string; fantasia: string | null; ids: Record<string, string>; cliente: boolean; fornecedor: boolean; ativo: boolean }>();
  for (const p of parceiros) {
    if (p.ehFornecedor) forn.lidos++;
    if (p.ehCliente) cli.lidos++;
    const doc = (p.documento ?? "").replace(/\D/g, "");
    const cnpj = normalizarCnpj(doc);
    if (!cnpj) {
      const motivo = doc.length === 11 ? "pessoa física (CPF)" : doc ? "CNPJ inválido" : "sem documento";
      if (p.ehFornecedor) ignorar(forn, motivo);
      if (p.ehCliente) ignorar(cli, motivo);
      continue;
    }
    const g = porCnpj.get(cnpj) ?? { nome: p.nome, fantasia: p.nomeFantasia, ids: {}, cliente: false, fornecedor: false, ativo: false };
    g.ids[p.conexaoApelido] = p.codigoOmie;
    g.cliente ||= p.ehCliente;
    g.fornecedor ||= p.ehFornecedor;
    g.ativo ||= !p.inativo;
    porCnpj.set(cnpj, g);
  }
  const [fornAtuais, cliAtuais] = await Promise.all([
    prisma.cadFornecedor.findMany({ where: { companyId } }),
    prisma.cadCliente.findMany({ where: { companyId } }),
  ]);
  const fMap = new Map(fornAtuais.map((f) => [f.cnpj, f]));
  const cMap = new Map(cliAtuais.map((c) => [c.cnpj, c]));
  const novosForn: Campos[] = [];
  const novosCli: Campos[] = [];
  for (const [cnpj, g] of porCnpj) {
    const campos = { cnpj, razaoSocial: g.nome, nomeFantasia: g.fantasia };
    if (g.fornecedor) {
      const atual = fMap.get(cnpj) ?? null;
      await gravar({
        r: forn, companyId, usuario, tabela: "CadFornecedor", chave: cnpj, existente: atual as Reg | null, campos,
        novos: novosForn, extrasDoNovo: { idsOmie: g.ids, ativo: g.ativo },
        atualizar: (id, d) => prisma.cadFornecedor.update({ where: { id }, data: d }),
        origem: { omie: Object.keys(g.ids).join("+") },
        // A razão social da Omie muda de grafia à toa; não é divergência de cadastro.
        ignorarDivergencia: ["razaoSocial", "nomeFantasia"],
      });
      if (atual) await atualizarIdsOmie("fornecedor", atual.id, (atual.idsOmie as Record<string, string>) ?? {}, g.ids);
    }
    if (g.cliente) {
      const atual = cMap.get(cnpj) ?? null;
      await gravar({
        r: cli, companyId, usuario, tabela: "CadCliente", chave: cnpj, existente: atual as Reg | null, campos,
        novos: novosCli,
        extrasDoNovo: { idsOmie: g.ids, ativo: g.ativo, tipo: ORGAO_PUBLICO.test(g.nome) ? "publico" : "privado" },
        atualizar: (id, d) => prisma.cadCliente.update({ where: { id }, data: d }),
        origem: { omie: Object.keys(g.ids).join("+") },
        ignorarDivergencia: ["razaoSocial", "nomeFantasia"],
      });
      if (atual) await atualizarIdsOmie("cliente", atual.id, (atual.idsOmie as Record<string, string>) ?? {}, g.ids);
    }
  }
  await inserirLote({ companyId, usuario, tabela: "CadFornecedor", modelo: prisma.cadFornecedor as unknown as Modelo, chaveCampo: "cnpj", novos: novosForn });
  await inserirLote({ companyId, usuario, tabela: "CadCliente", modelo: prisma.cadCliente as unknown as Modelo, chaveCampo: "cnpj", novos: novosCli });
  return [forn, cli];
}

// Os códigos da Omie se somam (uma conta nova aparece); não é dado de negócio.
async function atualizarIdsOmie(qual: "fornecedor" | "cliente", id: string, atuais: Record<string, string>, novos: Record<string, string>) {
  const ordenado = (o: Record<string, string>) => JSON.stringify(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  const juntos = { ...atuais, ...novos };
  if (ordenado(juntos) === ordenado(atuais)) return;
  if (qual === "fornecedor") await prisma.cadFornecedor.update({ where: { id }, data: { idsOmie: juntos } });
  else await prisma.cadCliente.update({ where: { id }, data: { idsOmie: juntos } });
}

// ---- Motoristas da gestão → pessoa ----

export function cargoDaFuncao(funcao: string | null | undefined): string {
  const f = String(funcao ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/monitor/.test(f)) return "monitor";
  if (/mecanic|oficina|eletricista|funileir/.test(f)) return "mecanico";
  if (/gerente|gestor|coordenador|supervisor/.test(f)) return "gestor";
  if (/motorista|condutor/.test(f) || !f) return "motorista";
  return "adm";
}

export async function carregarPessoas(companyId: string, usuario: string): Promise<ResultadoCarga> {
  const r = novoResultado("pessoa", "gestão de motoristas");
  const motoristas = await lerMotoristas(companyId);
  const atuais = new Map((await prisma.cadPessoa.findMany({ where: { companyId } })).map((p) => [p.cpf, p]));
  const vistos = new Set<string>();
  const novos: Campos[] = [];
  for (const m of motoristas) {
    r.lidos++;
    const cpf = normalizarCpf(m.cpf);
    if (!cpf) {
      ignorar(r, "CPF inválido");
      continue;
    }
    if (vistos.has(cpf)) {
      ignorar(r, "CPF repetido na gestão");
      continue;
    }
    vistos.add(cpf);
    const campos = { cpf, nome: m.name.trim(), cargo: cargoDaFuncao(m.funcao), dataAdmissao: m.admissao };
    const atual = atuais.get(cpf) ?? null;
    await gravar({
      r, companyId, usuario, tabela: "CadPessoa", chave: `pessoa ${m.name.trim()}`, existente: atual as Reg | null, campos,
      novos, extrasDoNovo: { ativo: m.active },
      atualizar: (id, d) => prisma.cadPessoa.update({ where: { id }, data: d }),
      origem: { gestao: m.id },
      ignorarDivergencia: ["nome"],
    });
  }
  await inserirLote({ companyId, usuario, tabela: "CadPessoa", modelo: prisma.cadPessoa as unknown as Modelo, chaveCampo: "cpf", novos });
  return r;
}

// ---- Veículos da gestão → veículo (+ centro de custo V-<placa>) ----

const STATUS_DA_GESTAO: Record<string, string> = { ATIVO: "ativo", MANUTENCAO: "manutencao", INATIVO: "baixado", VENDIDO: "vendido", RESERVA: "reserva" };

export async function carregarVeiculos(companyId: string, usuario: string): Promise<ResultadoCarga> {
  const r = novoResultado("veiculo", "gestão de motoristas");
  const veiculos = await lerVeiculos(companyId);
  const atuais = new Map((await prisma.cadVeiculo.findMany({ where: { companyId } })).map((v) => [v.placa, v]));
  const vistos = new Set<string>();
  const novos: Campos[] = [];
  for (const v of veiculos) {
    r.lidos++;
    const placa = normalizarPlaca(v.plate);
    if (!placa) {
      ignorar(r, "placa inválida");
      continue;
    }
    if (vistos.has(placa)) {
      ignorar(r, "placa repetida na gestão");
      continue;
    }
    vistos.add(placa);
    const extra = v as unknown as { model?: string | null; type?: string | null; year?: number | null };
    const campos = {
      placa,
      modelo: extra.model ?? null,
      tipo: tipoDeVeiculo(`${extra.type ?? ""} ${extra.model ?? ""}`),
      anoFab: extra.year && extra.year > 1950 ? extra.year : null,
      status: STATUS_DA_GESTAO[String(v.status).toUpperCase()] ?? "ativo",
    };
    const atual = atuais.get(placa) ?? null;
    await gravar({
      r, companyId, usuario, tabela: "CadVeiculo", chave: placa, existente: atual as Reg | null, campos, novos,
      atualizar: (id, d) => prisma.cadVeiculo.update({ where: { id }, data: d }),
      origem: { gestao: v.id },
      // "outro" é a falta de informação, não um dado: não diverge.
      ignorarDivergencia: atual?.tipo === "outro" || campos.tipo === "outro" ? ["tipo"] : [],
    });
  }
  await inserirLote({ companyId, usuario, tabela: "CadVeiculo", modelo: prisma.cadVeiculo as unknown as Modelo, chaveCampo: "placa", novos });
  await garantirCentrosDosVeiculos(companyId, usuario);
  return r;
}

// Spec 01, regra 4: todo veículo tem o seu centro de custo (V-<placa>) — os
// que faltarem, de uma vez.
export async function garantirCentrosDosVeiculos(companyId: string, usuario: string) {
  const semCentro = await prisma.cadVeiculo.findMany({ where: { companyId, centrosCusto: { none: {} } }, select: { id: true, placa: true } });
  const novos = semCentro.map((v) => ({ companyId, codigo: `V-${v.placa}`, tipo: "veiculo", veiculoId: v.id }));
  await inserirLote({ companyId, usuario, tabela: "CadCentroCusto", modelo: prisma.cadCentroCusto as unknown as Modelo, chaveCampo: "codigo", novos });
}

// Spec 01, regra 4: veículo e contrato nascem com o seu centro de custo.
export async function garantirCentroDeCusto(companyId: string, usuario: string, cc: { codigo: string; tipo: "veiculo" | "contrato" | "administrativo"; veiculoId?: string; contratoId?: string }) {
  const existe = await prisma.cadCentroCusto.findUnique({ where: { companyId_codigo: { companyId, codigo: cc.codigo } }, select: { id: true } });
  if (existe) return;
  const novo = await prisma.cadCentroCusto.create({ data: { companyId, ...cc } });
  await registrarAlteracao(prisma, { companyId, usuario, agente: AGENTE, tabela: "CadCentroCusto", registroId: novo.id, operacao: "insert", depois: cc });
}

// Os centros de custo que ainda não existem na Omie viram UMA pendência para o
// financeiro (spec 01, regra 4): criar lá é escrita na Omie, e escrita na
// Omie não acontece sem alguém aprovar.
export async function pendenciaDeCentrosNaOmie(companyId: string): Promise<{ id: string; nova: boolean; quantos: number } | null> {
  // Veículo vendido ou baixado não precisa de centro na Omie.
  const semOmie = await prisma.cadCentroCusto.findMany({
    where: { companyId, ativo: true, idsOmie: { equals: {} }, NOT: { veiculo: { status: { in: ["vendido", "baixado"] } } } },
    select: { codigo: true },
    orderBy: { codigo: "asc" },
  });
  if (semOmie.length === 0) return null;
  const p = await criarPendencia({
    companyId,
    agente: AGENTE,
    tipo: "centro-custo-omie",
    titulo: `Criar na Omie ${semOmie.length} centro(s) de custo do cadastro`,
    descricao: "Cada veículo (V-<placa>) e cada contrato (C-<número>) tem um centro de custo no cadastro mestre. Para os lançamentos da Omie caírem nele, o centro precisa existir lá (como departamento ou projeto). Aprovar registra a decisão; a criação na Omie entra quando a integração de escrita estiver pronta.",
    severidade: "baixa",
    evidencias: { codigos: semOmie.slice(0, 500).map((c) => c.codigo), total: semOmie.length },
    perfilAprovador: "financeiro",
    chaveExcecao: "carga-cadastro:centro-custo-omie",
  });
  if (!p.nova) {
    await prisma.audPendencia.update({ where: { id: p.id }, data: { titulo: `Criar na Omie ${semOmie.length} centro(s) de custo do cadastro`, evidencias: { codigos: semOmie.slice(0, 500).map((c) => c.codigo), total: semOmie.length } } });
  }
  return { ...p, quantos: semOmie.length };
}
