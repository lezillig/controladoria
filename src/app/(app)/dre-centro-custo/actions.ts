"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { registrarEvento } from "@/lib/controladoria/trilha";
import { redigir } from "@/lib/controladoria/falhas";
import { lerListaDeEmpregados, normalizar, porEmpresa, tipoSugerido } from "@/lib/controladoria/quadroDePessoal";
import { TIPOS_ORIGEM } from "@/lib/controladoria/dreCentroCusto";
import { exigirPermissao } from "../_dados";

// OS AJUSTES DO DRE POR CENTRO DE CUSTO: o quadro de pessoal do mês, o tipo de
// cada centro (operacional ou apoio) e os vínculos com as origens da Omie.
// Quem ajusta é quem classifica o DRE — é a mesma decisão (para onde vai cada
// real), olhada por outro ângulo.

const ROTA = "/dre-centro-custo";
type Resultado = { erro?: string; ok?: string };

const competenciaDoTexto = (s: string) => {
  const m = s.match(/^(\d{4})-(\d{2})$/);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
};

export async function importarQuadro(formData: FormData): Promise<Resultado> {
  const session = await exigirPermissao("classificar-dre");
  const arquivo = formData.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) return { erro: "Escolha a planilha de empregados." };
  if (arquivo.size > 8_000_000) return { erro: "Planilha grande demais (máximo 8 MB)." };
  const competencia = competenciaDoTexto(String(formData.get("competencia") ?? ""));
  if (!competencia) return { erro: "Informe o mês da lista." };

  let lista;
  try {
    lista = await lerListaDeEmpregados(await arquivo.arrayBuffer());
  } catch (e) {
    return { erro: e instanceof Error ? redigir(e.message) : "Não consegui ler a planilha." };
  }
  const empresas = porEmpresa(lista.pessoas);
  if (empresas.size > 1) return { erro: `A planilha traz ${empresas.size} empresas da folha (Cód Emp ${[...empresas.keys()].join(", ")}). Envie uma lista por empresa.` };
  const [[empresaCodigo, pessoas]] = [...empresas.entries()];

  const conexoes = await prisma.omieConexao.findMany({ where: { companyId: session.companyId }, select: { id: true, nome: true, apelido: true, papelNoGrupo: true } });
  // A EMPRESA OMIE DA LISTA: a escolhida; senão a que já recebeu este "Cód
  // Emp" antes; senão a que dá nome ao "serviço" da maioria (a MCZ lança todo
  // mundo no serviço "MCZ TRANSPORTE…"; a Azul, nos clientes e em si mesma).
  let conexaoId = String(formData.get("conexaoId") ?? "");
  if (!conexaoId) {
    const anterior = await prisma.folhaQuadro.findFirst({ where: { companyId: session.companyId, empresaCodigo }, orderBy: { importadoEm: "desc" }, select: { conexaoId: true } });
    if (anterior) conexaoId = anterior.conexaoId;
    else {
      const contagem = conexoes.map((c) => {
        const chave = normalizar(c.apelido);
        return { id: c.id, n: pessoas.filter((p) => normalizar(p.servico ?? "").split(" ").includes(chave)).length };
      });
      const melhor = contagem.sort((a, b) => b.n - a.n)[0];
      if (!melhor || melhor.n === 0) return { erro: "Não consegui descobrir de qual empresa é a lista. Escolha a empresa." };
      conexaoId = melhor.id;
    }
  }
  const conexao = conexoes.find((c) => c.id === conexaoId);
  if (!conexao) return { erro: "Empresa não encontrada." };

  const salarioCents = pessoas.reduce((s, p) => s + p.salarioCents, 0);
  await prisma.$transaction(async (tx) => {
    await tx.folhaQuadro.deleteMany({ where: { conexaoId, competencia } });
    const quadro = await tx.folhaQuadro.create({
      data: {
        companyId: session.companyId,
        conexaoId,
        empresaCodigo,
        competencia,
        arquivoNome: arquivo.name.slice(0, 200),
        pessoas: pessoas.length,
        salarioCents,
        importadoPorNome: session.name,
      },
    });
    await tx.folhaPessoa.createMany({
      data: pessoas.map((p) => ({
        quadroId: quadro.id,
        matricula: p.matricula,
        nome: p.nome,
        cargo: p.cargo,
        categoria: p.categoria,
        admissao: p.admissao,
        salarioCents: p.salarioCents,
        centroCustoCodigo: p.centroCustoCodigo,
        centroCustoDescricao: p.centroCustoDescricao,
        servico: p.servico,
        departamento: p.departamento,
        sindicato: p.sindicato,
      })),
    });
    // Os centros de custo novos nascem com o tipo sugerido; os que já existem
    // ficam como a pessoa deixou (só a descrição acompanha a folha).
    const porCentro = new Map<string, typeof pessoas>();
    for (const p of pessoas) porCentro.set(p.centroCustoCodigo, [...(porCentro.get(p.centroCustoCodigo) ?? []), p]);
    const existentes = new Map((await tx.centroCusto.findMany({ where: { conexaoId }, select: { id: true, codigo: true, descricao: true } })).map((c) => [c.codigo, c]));
    for (const [codigo, doCentro] of porCentro) {
      const descricao = doCentro[0].centroCustoDescricao;
      const atual = existentes.get(codigo);
      if (!atual)
        await tx.centroCusto.create({
          data: { companyId: session.companyId, conexaoId, codigo, descricao, tipo: tipoSugerido({ conexaoCorporativa: conexao.papelNoGrupo === "CORPORATIVO", descricao, pessoas: doCentro }) },
        });
      else if (atual.descricao !== descricao) await tx.centroCusto.update({ where: { id: atual.id }, data: { descricao } });
    }
  }, { timeout: 60_000 });

  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "QUADRO_DE_PESSOAL",
    entidadeTipo: "FolhaQuadro",
    entidadeId: `${conexao.apelido}:${competencia.toISOString().slice(0, 7)}`,
    descricao: `Quadro de pessoal da ${conexao.apelido} de ${competencia.toISOString().slice(0, 7)} importado: ${pessoas.length} pessoas.`,
  });
  revalidatePath(ROTA);
  const mes = competencia.toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
  return { ok: `${conexao.apelido}, ${mes}: ${pessoas.length} pessoas em ${new Set(pessoas.map((p) => p.centroCustoCodigo)).size} centros de custo.${lista.avisos.length ? " " + lista.avisos.join(" ") : ""}` };
}

export async function excluirQuadro(id: string): Promise<Resultado> {
  const session = await exigirPermissao("classificar-dre");
  const q = await prisma.folhaQuadro.findFirst({ where: { id, companyId: session.companyId }, select: { id: true, competencia: true, pessoas: true } });
  if (!q) return { erro: "Quadro não encontrado." };
  await prisma.folhaQuadro.delete({ where: { id: q.id } });
  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "QUADRO_DE_PESSOAL_EXCLUIDO",
    entidadeTipo: "FolhaQuadro",
    entidadeId: q.id,
    descricao: `Quadro de pessoal de ${q.competencia.toISOString().slice(0, 7)} (${q.pessoas} pessoas) excluído.`,
  });
  revalidatePath(ROTA);
  return { ok: "Excluído." };
}

export async function salvarCentro(id: string, dados: { tipo?: string; observacao?: string | null }): Promise<Resultado> {
  const session = await exigirPermissao("classificar-dre");
  if (dados.tipo !== undefined && !["OPERACIONAL", "APOIO"].includes(dados.tipo)) return { erro: "Tipo inválido." };
  const c = await prisma.centroCusto.findFirst({ where: { id, companyId: session.companyId }, select: { id: true, descricao: true, tipo: true } });
  if (!c) return { erro: "Centro de custo não encontrado." };
  await prisma.centroCusto.update({
    where: { id },
    data: { ...(dados.tipo ? { tipo: dados.tipo } : {}), ...(dados.observacao !== undefined ? { observacao: dados.observacao?.slice(0, 500) || null } : {}) },
  });
  if (dados.tipo && dados.tipo !== c.tipo)
    await registrarEvento({
      companyId: session.companyId,
      userId: session.userId,
      userNome: session.name,
      userEmail: session.email,
      acao: "CENTRO_CUSTO_TIPO",
      entidadeTipo: "CentroCusto",
      entidadeId: id,
      descricao: `Centro de custo ${c.descricao}: ${c.tipo} → ${dados.tipo}.`,
    });
  revalidatePath(ROTA);
  return { ok: "Salvo." };
}

export async function ligarOrigem(dados: { centroCustoId: string; tipoOrigem: string; conexaoId: string; valorOrigem: string; rotuloOrigem?: string | null; percentual?: number }): Promise<Resultado> {
  const session = await exigirPermissao("classificar-dre");
  if (!(TIPOS_ORIGEM as string[]).includes(dados.tipoOrigem)) return { erro: "Origem inválida." };
  const valorOrigem = dados.tipoOrigem === "PARCEIRO" && /^[\d.\-/\s]+$/.test(dados.valorOrigem) ? dados.valorOrigem.replace(/\D/g, "") : dados.valorOrigem.trim();
  if (!valorOrigem) return { erro: "Informe a origem." };
  const percentual = dados.percentual ?? 100;
  if (!Number.isFinite(percentual) || percentual <= 0 || percentual > 100) return { erro: "O percentual precisa estar entre 1 e 100." };
  const centro = await prisma.centroCusto.findFirst({ where: { id: dados.centroCustoId, companyId: session.companyId }, select: { id: true, descricao: true, conexaoId: true } });
  if (!centro) return { erro: "Centro de custo não encontrado." };
  const conexao = await prisma.omieConexao.findFirst({ where: { id: dados.conexaoId, companyId: session.companyId }, select: { id: true } });
  if (!conexao) return { erro: "Empresa da origem não encontrada." };
  await prisma.centroCustoVinculo.upsert({
    where: { centroCustoId_tipoOrigem_conexaoId_valorOrigem: { centroCustoId: centro.id, tipoOrigem: dados.tipoOrigem, conexaoId: conexao.id, valorOrigem } },
    create: { companyId: session.companyId, centroCustoId: centro.id, tipoOrigem: dados.tipoOrigem, conexaoId: conexao.id, valorOrigem, rotuloOrigem: dados.rotuloOrigem?.slice(0, 200) ?? null, percentual, criadoPorNome: session.name },
    update: { percentual, rotuloOrigem: dados.rotuloOrigem?.slice(0, 200) ?? undefined },
  });
  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "CENTRO_CUSTO_VINCULO",
    entidadeTipo: "CentroCustoVinculo",
    entidadeId: `${dados.tipoOrigem}:${valorOrigem}`,
    descricao: `${dados.rotuloOrigem ?? `${dados.tipoOrigem} ${valorOrigem}`} → ${centro.descricao} (${percentual}%).`,
  });
  revalidatePath(ROTA);
  return { ok: "Ligado." };
}

export async function desligarOrigem(id: string): Promise<Resultado> {
  const session = await exigirPermissao("classificar-dre");
  const v = await prisma.centroCustoVinculo.findFirst({ where: { id, companyId: session.companyId }, select: { id: true, rotuloOrigem: true, tipoOrigem: true, valorOrigem: true } });
  if (!v) return { erro: "Vínculo não encontrado." };
  await prisma.centroCustoVinculo.delete({ where: { id: v.id } });
  await registrarEvento({
    companyId: session.companyId,
    userId: session.userId,
    userNome: session.name,
    userEmail: session.email,
    acao: "CENTRO_CUSTO_VINCULO_REMOVIDO",
    entidadeTipo: "CentroCustoVinculo",
    entidadeId: v.id,
    descricao: `Vínculo removido: ${v.rotuloOrigem ?? `${v.tipoOrigem} ${v.valorOrigem}`}.`,
  });
  revalidatePath(ROTA);
  return { ok: "Removido." };
}
