import { prisma } from "@/lib/prisma";
import { redigir } from "./falhas";
import { invalidarContextoEmCache } from "./contextoEmCache";

// A OS CONFERIDA NA OMIE, TÍTULO A TÍTULO — "o custo desta OS é este mesmo?".
//
// A conferência de OS soma o que o espelho tem no projeto. O espelho de um
// título a pagar só é relido quando ele entra numa janela do ciclo (incluído
// ou alterado nos últimos dias, vencimento perto de hoje): título que mudou
// de projeto, de valor ou foi apagado na Omie há mais tempo pode ficar com a
// fotografia antiga — e a OS herda um custo que não é mais dela.
//
// Aqui cada título da OS é consultado na Omie (ConsultarContaPagar /
// ConsultarContaReceber, pelo código do lançamento) e o espelho é corrigido
// com o que a Omie responde AGORA:
//   não existe mais ... marcado como excluído (como na varredura de exclusões);
//   projeto ......... o da Omie (o título sai da OS, ou fica);
//   valor ........... o valor do documento da Omie;
//   vencimento ...... o da Omie (muda a competência do a pagar);
//   cancelado ....... o da Omie.
// Cada correção deixa rastro em OmieTituloVersao, como a sincronização.
// `mudancasDoTitulo` é pura; o resto busca e grava.

export type CampoConferido = "existencia" | "projeto" | "valor" | "vencimento" | "cancelado";
export type Mudanca = { campo: CampoConferido; sistema: string; omie: string };

export type EstadoDoTitulo = { projetoCodigo: string | null; valorDocumentoCents: number; dataVencimento: Date; cancelado: boolean };

export type TituloConferido = {
  id: string;
  situacao: "igual" | "corrigido" | "excluido" | "indeterminado";
  statusOmie: string | null;
  mudancas: Mudanca[];
  erro?: string;
};

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join("/");
const mesmoDia = (a: Date, b: Date) => a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);

// O projeto "0" ou vazio da Omie é sem projeto.
export function projetoDaOmie(codigo: string | null | undefined): string | null {
  if (codigo === undefined || codigo === null) return null;
  const c = String(codigo).trim();
  return c === "" || Number(c) === 0 ? null : c;
}

export function mudancasDoTitulo(sistema: EstadoDoTitulo, omie: EstadoDoTitulo, nomeDoProjeto: (codigo: string | null) => string): Mudanca[] {
  const m: Mudanca[] = [];
  if ((projetoDaOmie(sistema.projetoCodigo) ?? "") !== (projetoDaOmie(omie.projetoCodigo) ?? "")) {
    m.push({ campo: "projeto", sistema: nomeDoProjeto(projetoDaOmie(sistema.projetoCodigo)), omie: nomeDoProjeto(projetoDaOmie(omie.projetoCodigo)) });
  }
  if (sistema.valorDocumentoCents !== omie.valorDocumentoCents) m.push({ campo: "valor", sistema: brl(sistema.valorDocumentoCents), omie: brl(omie.valorDocumentoCents) });
  if (!mesmoDia(sistema.dataVencimento, omie.dataVencimento)) m.push({ campo: "vencimento", sistema: dia(sistema.dataVencimento), omie: dia(omie.dataVencimento) });
  if (sistema.cancelado !== omie.cancelado) m.push({ campo: "cancelado", sistema: sistema.cancelado ? "cancelado" : "vivo", omie: omie.cancelado ? "cancelado" : "vivo" });
  return m;
}

// ---- A consulta e a correção ----

export const TITULOS_POR_LEVA = 10;

export async function conferirTitulosNaOmie(params: { companyId: string; ids: string[]; prazo: number }): Promise<TituloConferido[]> {
  const { omieCall, OMIE_ENDPOINTS, OMIE_PACE_MS, sleep } = await import("@/lib/omie/client");
  const { normalizarTitulo } = await import("@/lib/omie/mapping");
  const { existenciaDaConsulta } = await import("@/lib/omie/sync");

  const titulos = await prisma.omieTitulo.findMany({
    where: { companyId: params.companyId, id: { in: params.ids.slice(0, TITULOS_POR_LEVA) } },
    select: {
      id: true, conexaoId: true, natureza: true, codigoLancamento: true, status: true,
      projetoCodigo: true, valorDocumentoCents: true, dataVencimento: true, cancelado: true,
      conexao: { select: { credencialRef: true } },
    },
  });
  const projetos = await prisma.omieProjeto.findMany({
    where: { companyId: params.companyId, conexaoId: { in: [...new Set(titulos.map((t) => t.conexaoId))] } },
    select: { conexaoId: true, codigo: true, nome: true },
  });
  const nome = new Map(projetos.map((p) => [`${p.conexaoId}|${p.codigo}`, p.nome]));

  const saida: TituloConferido[] = [];
  for (const t of titulos) {
    if (Date.now() > params.prazo) break;
    let resposta: Record<string, unknown> | null | undefined;
    let erro: unknown = null;
    try {
      resposta = await omieCall(
        t.natureza === "PAGAR" ? OMIE_ENDPOINTS.consultarPagar : OMIE_ENDPOINTS.consultarReceber,
        { codigo_lancamento_omie: Number(t.codigoLancamento) },
        { credencialRef: t.conexao.credencialRef, deadline: params.prazo + 8_000, toleraVazio: true }
      );
    } catch (e) {
      erro = e;
    }
    await sleep(OMIE_PACE_MS);
    const agora = new Date();
    const existencia = existenciaDaConsulta(resposta, erro, t.codigoLancamento);

    if (existencia === "nao_existe") {
      if (!t.cancelado || t.status !== "EXCLUÍDO NA OMIE") {
        await prisma.$transaction([
          prisma.omieTitulo.update({ where: { id: t.id }, data: { cancelado: true, status: "EXCLUÍDO NA OMIE", excluidoNaOmieEm: agora } }),
          prisma.omieTituloVersao.create({ data: { companyId: params.companyId, tituloId: t.id, campo: "exclusao", de: t.status, para: "EXCLUÍDO NA OMIE", vistoEm: agora } }),
        ]);
      }
      saida.push({ id: t.id, situacao: "excluido", statusOmie: null, mudancas: [{ campo: "existencia", sistema: "existe", omie: "não existe mais na Omie" }] });
      continue;
    }
    const lido = existencia === "existe" && resposta ? normalizarTitulo(resposta, t.natureza) : null;
    if (!lido) {
      saida.push({ id: t.id, situacao: "indeterminado", statusOmie: null, mudancas: [], erro: erro instanceof Error ? redigir(erro.message).slice(0, 160) : "a Omie não deu uma resposta clara" });
      continue;
    }

    // Resposta sem o campo do projeto não diz nada sobre ele: o do espelho
    // fica. Com o campo (0 = sem projeto), vale o da Omie.
    const trazProjeto = ["codigo_projeto", "cCodProjeto", "nCodProjeto"].some((k) => k in resposta!);
    const omie: EstadoDoTitulo = {
      projetoCodigo: trazProjeto ? projetoDaOmie(lido.projetoCodigo) : t.projetoCodigo,
      valorDocumentoCents: lido.valorDocumentoCents,
      dataVencimento: lido.dataVencimento,
      cancelado: lido.cancelado,
    };
    const mudancas = mudancasDoTitulo(t, omie, (c) => (c ? (nome.get(`${t.conexaoId}|${c}`) ?? c) : "sem projeto"));
    if (mudancas.length > 0) {
      await prisma.$transaction([
        prisma.omieTitulo.update({
          where: { id: t.id },
          data: {
            projetoCodigo: omie.projetoCodigo,
            valorDocumentoCents: omie.valorDocumentoCents,
            dataVencimento: omie.dataVencimento,
            cancelado: omie.cancelado,
            status: lido.status,
            excluidoNaOmieEm: null,
            ...(t.natureza === "PAGAR" ? { projetoConferidoEm: agora } : {}),
            sincronizadoEm: agora,
          },
        }),
        ...mudancas.map((m) => prisma.omieTituloVersao.create({ data: { companyId: params.companyId, tituloId: t.id, campo: m.campo, de: m.sistema, para: m.omie, vistoEm: agora } })),
      ]);
    } else if (t.natureza === "PAGAR") {
      await prisma.omieTitulo.update({ where: { id: t.id }, data: { projetoConferidoEm: agora } });
    }
    saida.push({ id: t.id, situacao: mudancas.length > 0 ? "corrigido" : "igual", statusOmie: lido.status, mudancas });
  }
  // A tela que mostra o resultado sai com o título já corrigido (o cache das
  // telas, contextoEmCache.ts, também vê a mudança pela versão dos títulos).
  if (saida.some((x) => x.situacao !== "igual")) invalidarContextoEmCache(params.companyId);
  return saida;
}
