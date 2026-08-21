import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { listarEmpresasAtivas } from "@/lib/gestao/leitura";
import { dataReferenciaPadrao, executarPasso } from "@/lib/controladoria/ciclo";
import { existeAlgumaCredencialOmie } from "@/lib/omie/client";
import { dispararProximaInvocacao } from "@/lib/controladoria/encadear";
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
  if (!existeAlgumaCredencialOmie()) {
    return NextResponse.json(
      { error: "Nenhuma credencial da Omie configurada no ambiente." },
      { status: 200 }
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
