import type { OmieConexao, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { urlDoSistema } from "@/lib/appUrl";
import { buscarEmpresa } from "@/lib/gestao/leitura";
import { montarPanoramaConformidade } from "@/lib/conformidade/panorama";
import { enviarEmail, isEnvioDisponivel } from "@/lib/email/send";
import { gerarNarrativa } from "./aiAnalyst";
import { montarPanorama } from "./analytics";
import { gravarSnapshotBsc, medirBsc } from "./bsc";
import { destinatarios } from "./contexto";
import { avaliarQualidadeDaBase } from "./supervisor";
import { montarAssunto, montarHtml, montarTexto, type DadosRelatorio } from "./reportHtml";
import type { ContextoAuditoria } from "./types";

// Geração e envio do relatório diário.
//
// Ordem deliberada: gerar -> PERSISTIR -> enviar. O relatorio e gravado antes
// da tentativa de envio, e nao depois, porque o produto e o relatorio; o
// e-mail e so o canal. Provedor de e-mail fora do ar as 6h nao pode significar
// que o retrato daquele dia deixou de existir — ele fica no sistema, com o
// erro registrado, e pode ser reenviado sem recalcular nada (o que produziria
// outros numeros, ver o comentario em RelatorioDiario no schema).

export type ResultadoRelatorio = {
  relatorioId: string;
  assunto: string;
  enviado: boolean;
  destinatarios: string[];
  erro: string | null;
  achadosTotal: number;
  achadosCriticos: number;
  narrativaGerada: boolean;
};

export async function gerarEEnviarRelatorio(
  ctx: ContextoAuditoria,
  opcoes: { enviar: boolean; conexao?: OmieConexao } = { enviar: true }
): Promise<ResultadoRelatorio> {
  const conexao = opcoes.conexao ?? null;
  // Nome da empresa: o da conexão quando o relatório é de uma empresa só, o do
  // cadastro da gestão quando é o consolidado do grupo.
  const empresa = conexao ? { name: conexao.nome } : await buscarEmpresa(ctx.companyId);

  const panorama = montarPanorama(ctx);

  // Somente achados EM ABERTO entram no relatorio: o que ja foi tratado,
  // ignorado ou fechado automaticamente cumpriu o seu papel e reaparecer todo
  // dia so treinaria o leitor a ignorar a lista inteira.
  const achados = await prisma.auditFinding.findMany({
    where: {
      companyId: ctx.companyId,
      status: { in: ["ABERTO", "EM_ANALISE"] },
      // Relatório de uma empresa traz os achados dela E os do grupo (conexão
      // nula): a projeção de caixa consolidada interessa aos dois relatórios,
      // e omiti-la faria o de cada empresa parecer mais tranquilo do que é.
      ...(conexao ? { OR: [{ conexaoId: conexao.id }, { conexaoId: null }] } : {}),
    },
    orderBy: [{ severidade: "asc" }, { impactoCents: "desc" }],
  });

  const bsc = await medirBsc(ctx);
  await gravarSnapshotBsc(ctx, bsc);

  const qualidadeDaBase = avaliarQualidadeDaBase(ctx);
  const conformidade = montarPanoramaConformidade(ctx.conformidade, ctx.dataReferencia);

  // A narrativa recebe apenas os achados de maior confianca: abaixo do piso,
  // o supervisor ja sinalizou que o achado depende de verificacao — e nao faz
  // sentido a leitura executiva construir raciocinio em cima disso.
  const achadosParaIa = achados.filter((a) => a.confianca >= 60);
  const narrativa = await gerarNarrativa({
    dataReferencia: ctx.dataReferencia,
    panorama,
    achados: achadosParaIa.map((a) => ({
      severidade: a.severidade,
      categoria: a.categoria,
      titulo: a.titulo,
      valorCents: a.valorCents,
      impactoCents: a.impactoCents,
      recomendacao: a.recomendacao,
    })),
    bsc,
    limitacoesDaBase: qualidadeDaBase.limitacoes,
    conformidade,
  });

  const dados: DadosRelatorio = {
    empresa: empresa?.name ?? "Empresa",
    dataReferencia: ctx.dataReferencia,
    panorama,
    achados,
    bsc,
    narrativa,
    qualidadeDaBase,
    conformidade,
    urlSistema: urlDoSistema(),
  };

  const assunto = montarAssunto(dados);
  const html = montarHtml(dados);
  const texto = montarTexto(dados);
  const para = destinatarios(ctx.config);

  const criticos = achados.filter((a) => a.severidade === "CRITICA").length;

  const resumo = {
    receitaMes: panorama.comparativo.mesAtual.receitaCents,
    despesaMes: panorama.comparativo.mesAtual.despesaCents,
    resultadoMes: panorama.comparativo.mesAtual.resultadoCents,
    receitaAno: panorama.comparativo.ano.receitaCents,
    resultadoAno: panorama.comparativo.ano.resultadoCents,
    saldoCaixa: panorama.saldoAtualCents,
    perdasMes: panorama.comparativo.mesAtual.perdaTotalCents,
    economiaIdentificada: achados
      .filter((a) => a.categoria === "OPORTUNIDADE")
      .reduce((acc, a) => acc + (a.impactoCents ?? 0), 0),
    qualidadeBase: qualidadeDaBase.score,
    conformidadeAbertos: conformidade.abertos,
    conformidadeGraves: conformidade.criticos,
    conformidadeVencidos: conformidade.vencidos,
    conformidadeReincidentes: conformidade.reincidentes,
    bsc: bsc.map((i) => ({ codigo: i.indicador.codigo, valor: i.valor, farol: i.farol })),
  } satisfies Prisma.InputJsonObject;

  // Sem upsert por chave composta: `conexaoId` é anulável (nulo = relatório
  // consolidado do grupo) e o Prisma não aceita nulo dentro de uma chave
  // composta de `where`. findFirst + create/update expressa a mesma intenção
  // sem contornar o tipo.
  const existente = await prisma.relatorioDiario.findFirst({
    where: {
      companyId: ctx.companyId,
      dataReferencia: ctx.dataReferencia,
      conexaoId: conexao?.id ?? null,
    },
    select: { id: true },
  });

  const camposRelatorio = {
    destinatarios: para.join(", "),
    assunto,
    html,
    resumo,
    narrativaIa: (narrativa ?? undefined) as Prisma.InputJsonValue | undefined,
    achadosTotal: achados.length,
    achadosCriticos: criticos,
    status: "GERADO" as const,
  };

  const relatorio = existente
    ? await prisma.relatorioDiario.update({
        where: { id: existente.id },
        data: { ...camposRelatorio, geradoEm: new Date(), erro: null },
      })
    : await prisma.relatorioDiario.create({
        data: {
          companyId: ctx.companyId,
          dataReferencia: ctx.dataReferencia,
          conexaoId: conexao?.id ?? null,
          conexaoApelido: conexao?.apelido ?? null,
          ...camposRelatorio,
        },
      });

  if (!opcoes.enviar) {
    return {
      relatorioId: relatorio.id,
      assunto,
      enviado: false,
      destinatarios: para,
      erro: null,
      achadosTotal: achados.length,
      achadosCriticos: criticos,
      narrativaGerada: narrativa !== null,
    };
  }

  // Envio de e-mail não configurado: o relatório fica GERADO, não "com erro".
  // A distinção importa porque o sistema pode operar meses assim de propósito
  // (o e-mail é uma fase posterior) — e uma lista que exibe "falha" todo dia
  // por uma escolha deliberada treina o usuário a ignorar o status, que é
  // justamente o que ele precisa enxergar quando a falha for real.
  if (!isEnvioDisponivel()) {
    return {
      relatorioId: relatorio.id,
      assunto,
      enviado: false,
      destinatarios: para,
      erro: null,
      achadosTotal: achados.length,
      achadosCriticos: criticos,
      narrativaGerada: narrativa !== null,
    };
  }

  const envio = await enviarEmail({ para, assunto, html, texto });

  await prisma.relatorioDiario.update({
    where: { id: relatorio.id },
    data: envio.enviado
      ? { status: "ENVIADO", enviadoEm: new Date(), erro: null }
      : { status: "ERRO_ENVIO", erro: envio.erro },
  });

  return {
    relatorioId: relatorio.id,
    assunto,
    enviado: envio.enviado,
    destinatarios: para,
    erro: envio.erro,
    achadosTotal: achados.length,
    achadosCriticos: criticos,
    narrativaGerada: narrativa !== null,
  };
}


