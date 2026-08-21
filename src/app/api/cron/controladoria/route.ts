import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { disponibilidadeGestao, listarEmpresasAtivas } from "@/lib/gestao/leitura";
import { dataReferenciaPadrao, executarPasso } from "@/lib/controladoria/ciclo";
import { existeAlgumaCredencialOmie } from "@/lib/omie/client";
import { anotarNaExecucao, dispararProximaInvocacao } from "@/lib/controladoria/encadear";
import { parseLocalDate } from "@/lib/date";

// Ciclo diário da Controladoria: sincroniza a Omie, roda os agentes de
// auditoria, mede o BSC e envia o relatório gerencial por e-mail.
//
// Agendado no vercel.json para 06:10 UTC (03:10 de Brasília) — depois do
// fechamento bancário do dia anterior e antes do expediente, para o relatório
// já estar na caixa de entrada às 6h.
//
// UMA rota, e não duas (sync + relatório), por uma restrição concreta da
// plataforma: o plano Hobby da Vercel permite poucos agendamentos, e este
// projeto já usa um para o import do TiqueTaque. Encadear as etapas numa
// máquina de estados resolve isso e, de quebra, garante a ordem certa — o
// relatório nunca sai antes da sincronização terminar.
//
// Auto-encadeamento: cada invocação trabalha dentro de um orçamento seguro e,
// se sobrar trabalho, dispara uma nova invocação de si mesma (ver encadear.ts)
// (que garante o disparo antes de a instância congelar). Mesmo desenho já
// validado em produção pelo import do TiqueTaque.
export const maxDuration = 60;

const ORCAMENTO_MS = 42_000;
const DEADLINE_MS = 50_000;
// Teto de encadeamentos por execução. Existe para o backfill (dezenas de
// janelas mensais) não virar um laço infinito caso alguma fase pare de
// avançar: sem isso, um bug de cursor consumiria invocações indefinidamente.
const MAX_CICLOS = 120;

function autorizado(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const recebido = req.headers.get("authorization") ?? "";
  const esperado = `Bearer ${secret}`;
  // Comparação em tempo constante: `===` em string vaza, pelo tempo de
  // resposta, o tamanho do prefixo correto — o suficiente para descobrir o
  // segredo caractere a caractere com requisições repetidas.
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // 503, não 200. Quem chama esta rota é o próprio ciclo, e ele decide se
  // continua olhando o código HTTP. Responder 200 com um erro no corpo faz uma
  // parada por falta de configuração parecer um ciclo que terminou bem — foi
  // assim que a carga ficou parada sem ninguém entender por quê.
  if (!existeAlgumaCredencialOmie()) {
    return NextResponse.json(
      { error: "Nenhuma credencial da Omie configurada no ambiente." },
      { status: 503 }
    );
  }

  const iniciado = Date.now();
  const ciclo = Number(req.nextUrl.searchParams.get("ciclo") ?? "0");
  const dataParam = req.nextUrl.searchParams.get("data");
  const dataReferencia = dataParam ? parseLocalDate(dataParam) : dataReferenciaPadrao();

  if (Number.isNaN(dataReferencia.getTime())) {
    return NextResponse.json({ error: "Parâmetro `data` inválido (use AAAA-MM-DD)." }, { status: 400 });
  }

  // Multiempresa: o ciclo roda para cada tenant ativo. Uma empresa que falhe
  // não pode impedir as demais — cada uma tem o seu próprio OmieSyncRun.
  const empresas = await listarEmpresasAtivas();

  // Lista vazia tem DUAS causas com consequências opostas: ou não há empresa
  // ativa (nada a fazer, ciclo termina), ou a leitura do banco da gestão
  // falhou e a lista veio vazia por engano — porque `ler()` degrada para lista
  // vazia de propósito, para que uma tela continue abrindo sem a gestão.
  //
  // Aqui isso não serve: sem distinguir as duas, uma falha de leitura vira um
  // ciclo silenciosamente encerrado, com HTTP 200, no meio de uma carga de 38
  // janelas. É preciso responder erro para quem encadeou saber que não
  // terminou.
  if (empresas.length === 0) {
    const gestao = disponibilidadeGestao();
    if (!gestao.disponivel) {
      return NextResponse.json({ error: gestao.erro ?? "Sistema de gestão indisponível." }, { status: 503 });
    }
    return NextResponse.json(
      { error: "Nenhuma empresa ativa no sistema de gestão — o ciclo não tem sobre o que rodar." },
      { status: 503 }
    );
  }

  const resultados: unknown[] = [];
  let continua = false;

  for (const empresa of empresas) {
    if (Date.now() - iniciado > ORCAMENTO_MS) {
      continua = true;
      break;
    }
    try {
      const passo = await executarPasso({
        companyId: empresa.id,
        fimDoOrcamento: iniciado + ORCAMENTO_MS,
        deadline: iniciado + DEADLINE_MS,
        dataReferencia,
      });
      resultados.push({ empresa: empresa.name, ...passo });
      if (passo.continua) continua = true;
    } catch (e) {
      const mensagem = e instanceof Error ? e.message : "erro desconhecido";
      resultados.push({ empresa: empresa.name, erro: mensagem });
      // Marca a execução em andamento como falha, para a próxima invocação
      // abrir uma nova em vez de retomar indefinidamente uma que quebra.
      await prisma.omieSyncRun.updateMany({
        where: { companyId: empresa.id, status: "EXECUTANDO" },
        data: { status: "ERRO", finalizadoEm: new Date(), erro: mensagem.slice(0, 2000) },
      });
    }
  }

  // O que ESTA invocação fez, gravado na própria execução.
  //
  // Até aqui o sistema registrava apenas se a chamada de encadeamento foi
  // aceita. Aceita e sem trabalho é indistinguível de aceita e trabalhando —
  // e foi exatamente esse o estado que travou a carga por horas, respondendo
  // 200 sem avançar nada. Aceitar um "OK" sem olhar o que veio dentro é o
  // mesmo erro de engolir exceção, repetido numa camada acima.
  //
  // Fica em `detalhes`, mesclado, para conviver com a anotação do disparo: uma
  // conta se a chamada saiu, a outra conta o que aconteceu do outro lado.
  await anotarNaExecucao(undefined, {
    invocacaoAutomatica: {
      em: new Date().toISOString(),
      ciclo,
      empresas: empresas.length,
      duracaoMs: Date.now() - iniciado,
      continua,
      resultados,
    },
  });

  if (continua && ciclo < MAX_CICLOS) {
    dispararProximaInvocacao({ ciclo: ciclo + 1, data: dataParam });
  }

  return NextResponse.json({
    dataReferencia: dataReferencia.toISOString().slice(0, 10),
    ciclo,
    duracaoMs: Date.now() - iniciado,
    encadeou: continua && ciclo < MAX_CICLOS,
    limiteDeCiclosAtingido: continua && ciclo >= MAX_CICLOS,
    resultados,
  });
}
