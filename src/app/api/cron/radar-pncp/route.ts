import { NextRequest, NextResponse } from "next/server";
import { autorizado } from "@/lib/controladoria/autorizacaoDoCiclo";
import { listarEmpresasAtivas } from "@/lib/gestao/leitura";
import { varrerPendentes } from "@/lib/radar/varrer";
import { enviarAvisoDoRadar } from "@/lib/radar/aviso";
import { redigir } from "@/lib/controladoria/falhas";

// Radar de licitações (spec 07): publicações do PNCP de ontem, das UFs e
// modalidades do radar, filtradas pelo objeto; depois, o e-mail do radar. Agendado no vercel.json para
// 10:50 UTC (07:50 de Brasília), antes do expediente comercial.
//
// Sem encadeamento: o dia normal cabe numa invocação. A carga inicial (30
// dias) e qualquer atraso vão sendo alcançados a cada execução e pelo botão
// "Varrer agora" da tela do radar.
export const maxDuration = 60;
const ORCAMENTO_MS = 45_000;

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const empresas = await listarEmpresasAtivas();
    const inicio = Date.now();
    const resultados = [];
    for (const e of empresas) {
      const resta = ORCAMENTO_MS - (Date.now() - inicio);
      if (resta < 5_000) break;
      const r = await varrerPendentes(e.id, resta / Math.max(1, empresas.length - resultados.length));
      // O e-mail sai mesmo com a varredura incompleta: o que já entrou e os
      // prazos perto não podem esperar a carga terminar.
      const aviso = await enviarAvisoDoRadar(e.id).catch((x) => ({ enviado: false, motivo: x instanceof Error ? x.message : String(x) }));
      resultados.push({ empresa: e.id, ...r, aviso });
    }
    const erros = resultados.flatMap((r) => r.erros);
    return NextResponse.json({ ok: erros.length === 0, resultados }, { status: erros.length && resultados.every((r) => r.diasVarridos.length === 0) ? 502 : 200 });
  } catch (e) {
    return NextResponse.json({ error: redigir(e instanceof Error ? e.message : String(e)) }, { status: 500 });
  }
}
