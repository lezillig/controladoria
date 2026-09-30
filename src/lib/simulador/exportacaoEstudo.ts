import { prisma } from "@/lib/prisma";
import { simular } from "./motor";
import { gerarPlanilhaSimulacao, type DadosExportacao } from "./exportarXlsx";
import { validarEntrada } from "./estudos";
import { ROTULO_TIPO_ESTUDO, ROTULO_TIPO_SERVICO } from "./estudos";
import type { EntradaSimulacao } from "./tipos";

// A PLANILHA DE UM ESTUDO — da versão salva ou do rascunho que está na tela.
//
// Quem monta um orçamento quer levá-lo para fora antes de salvar ("manda para
// o diretor dar uma olhada"). Por isso há dois caminhos: a versão gravada
// (reexecutada do snapshot, a mesma conta de quando foi salva) e a entrada
// que o navegador envia, conferida pela mesma validação de salvar. Nenhum dos
// dois grava nada.
//
// O licitante é a conexão Omie ativa da empresa com CNPJ: é a empresa que
// assina a proposta. Sem conexão, a planilha sai com o campo em branco para
// preencher — nunca com um CNPJ inventado.

export type ArquivoExportado = { nome: string; conteudo: Buffer };

function nomeSeguro(texto: string) {
  return (
    texto
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "estudo"
  );
}

function formatarCnpj(c: string | null | undefined) {
  const d = (c ?? "").replace(/\D/g, "");
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : (c ?? "");
}

// "São Paulo, 4 de outubro de 2026" — no fuso de Brasília, que é o dia em
// que a proposta foi gerada para quem a assina.
export function localEData(cidade: string | null | undefined, quando: Date): string {
  const data = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Sao_Paulo" }).format(quando);
  return cidade?.trim() ? `${cidade.trim()}, ${data}` : data;
}

// Os dados da proponente para o cabeçalho e a assinatura da proposta, do
// cadastro da empresa (Conexões → Dados para propostas).
export function dadosDoLicitante(
  c: {
    nome: string;
    cnpj: string | null;
    endereco?: string | null;
    cidade?: string | null;
    representanteNome?: string | null;
    representanteRg?: string | null;
    representanteCpf?: string | null;
    representanteCargo?: string | null;
  } | null,
  geradoEm: Date
): DadosExportacao["licitante"] {
  const representante = c?.representanteNome?.trim()
    ? [c.representanteNome.trim(), c.representanteRg && `RG ${c.representanteRg}`, c.representanteCpf && `CPF ${c.representanteCpf}`, c.representanteCargo]
        .filter(Boolean)
        .join(" / ")
    : null;
  return {
    razaoSocial: c?.nome ?? "",
    cnpj: formatarCnpj(c?.cnpj),
    endereco: c?.endereco?.trim() || null,
    representante,
    localData: localEData(c?.cidade, geradoEm),
    localInformado: Boolean(c?.cidade?.trim()),
  };
}

export async function exportarEstudo(
  companyId: string,
  estudoId: string,
  fonte: { simulacaoId: string } | { entrada: EntradaSimulacao }
): Promise<{ erro: string } | ArquivoExportado> {
  const estudo = await prisma.simEstudo.findFirst({
    where: { id: estudoId, companyId },
    include: { regras: { orderBy: { ordem: "asc" } } },
  });
  if (!estudo) return { erro: "Estudo não encontrado." };

  let entrada: EntradaSimulacao;
  let versao = 0;
  if ("simulacaoId" in fonte) {
    const sim = await prisma.simSimulacao.findFirst({ where: { id: fonte.simulacaoId, estudoId } });
    if (!sim) return { erro: "Versão não encontrada." };
    entrada = sim.entrada as unknown as EntradaSimulacao;
    versao = sim.versao;
  } else {
    const problema = validarEntrada(fonte.entrada);
    if (problema) return { erro: problema };
    entrada = fonte.entrada;
  }
  const resultado = simular(entrada);

  // A empresa da OPERAÇÃO assina a proposta (a Azul); a corporativa só se
  // for a única com CNPJ.
  const conexoes = await prisma.omieConexao.findMany({
    where: { companyId, ativa: true, cnpj: { not: null } },
    orderBy: { nome: "asc" },
    select: { nome: true, cnpj: true, papelNoGrupo: true, endereco: true, cidade: true, representanteNome: true, representanteRg: true, representanteCpf: true, representanteCargo: true },
  });
  const conexao = conexoes.find((c) => c.papelNoGrupo !== "CORPORATIVO") ?? conexoes[0] ?? null;
  const geradoEm = new Date();

  const dados: DadosExportacao = {
    edital: {
      numero: estudo.numeroEdital ?? estudo.nome,
      orgao: estudo.orgao ?? estudo.cliente ?? "",
      municipio: estudo.municipio ?? "",
      uf: estudo.uf ?? "",
      objeto:
        estudo.descricao ??
        `${ROTULO_TIPO_ESTUDO[estudo.tipo as keyof typeof ROTULO_TIPO_ESTUDO] ?? estudo.tipo} — ${ROTULO_TIPO_SERVICO[estudo.tipoServico as keyof typeof ROTULO_TIPO_SERVICO] ?? estudo.tipoServico}`,
      dataSessao: estudo.dataSessao ? estudo.dataSessao.toISOString().slice(0, 10) : null,
      plataforma: estudo.plataforma,
    },
    licitante: dadosDoLicitante(conexao, geradoEm),
    esfera: estudo.esfera === "PRIVADO" ? "PRIVADO" : "PUBLICO",
    comercial: {
      cliente: estudo.cliente,
      validadeProposta: estudo.validadeProposta?.toISOString() ?? null,
      inicioPrevisto: estudo.inicioPrevisto?.toISOString() ?? null,
      indiceReajuste: estudo.indiceReajuste,
      formaFaturamento: estudo.formaFaturamento,
      avisoRescisaoDias: estudo.avisoRescisaoDias,
    },
    regras: estudo.regras.map((r) => ({ tema: r.tema, texto: r.texto, impacto: r.impacto ?? "", campo: r.campoAfetado })),
    entrada,
    resultado,
    versao,
    geradoEm,
  };
  const conteudo = await gerarPlanilhaSimulacao(dados);
  const sufixo = versao > 0 ? `v${versao}` : "rascunho";
  return { nome: `Orcamento_${nomeSeguro(estudo.numeroEdital ?? estudo.nome)}_${sufixo}.xlsx`, conteudo };
}
