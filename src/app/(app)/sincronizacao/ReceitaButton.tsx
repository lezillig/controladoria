"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Landmark } from "lucide-react";
import { secondaryButtonClass } from "@/lib/ui";
import { consultarReceitaAgora } from "./actions";

// A ABA CONDUZ A CONSULTA, rodada a rodada — o mesmo desenho do recálculo do
// resumo mensal (ResumoMensalButton), e pelo mesmo motivo: a fila não cabe
// numa função só. Cada rodada consulta o que cabe em ~55 s e diz quantos
// faltam; a aba chama de novo até zerar ou até a pessoa mandar parar.
//
// Para quando a API pública pede para tentar depois: insistir em laço seria
// exatamente o que um serviço gratuito não merece.

export default function ReceitaButton({ pendentesIniciais }: { pendentesIniciais: number }) {
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [rodadas, setRodadas] = useState(0);
  const [consultadosNoTotal, setConsultadosNoTotal] = useState(0);
  const [processando, iniciar] = useTransition();
  const continuar = useRef(true);
  const router = useRouter();

  const rodar = () => {
    continuar.current = true;
    setMensagem(null);
    setRodadas(0);
    setConsultadosNoTotal(0);

    const passo = () =>
      iniciar(async () => {
        try {
          const r = await consultarReceitaAgora();
          setRodadas((n) => n + 1);
          setConsultadosNoTotal((n) => n + r.consultados);
          setMensagem(r.mensagem);
          // Continua só enquanto a rodada rendeu: rodada sem consulta com
          // pendência sobrando é a API pedindo pausa, e o laço respeita.
          if (r.pendentes > 0 && r.consultados > 0 && r.parouPor !== "api" && continuar.current) {
            passo();
            return;
          }
          router.refresh();
        } catch (e) {
          setMensagem("A consulta parou: " + (e instanceof Error ? e.message.slice(0, 200) : String(e)));
        }
      });

    passo();
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={processando} onClick={rodar} className={`${secondaryButtonClass} inline-flex items-center gap-2`}>
          <Landmark className="h-4 w-4" />
          {processando
            ? `Consultando... (rodada ${rodadas + 1}${consultadosNoTotal > 0 ? `, ${consultadosNoTotal} já consultados` : ""})`
            : pendentesIniciais > 0
              ? `Consultar Receita agora (${pendentesIniciais} pendentes)`
              : "Consultar Receita agora"}
        </button>
        {processando && (
          <button
            type="button"
            onClick={() => {
              continuar.current = false;
            }}
            className="text-xs font-medium text-slate-500 hover:underline"
          >
            parar depois desta rodada
          </button>
        )}
      </div>
      {mensagem && <p className="mt-2 text-xs text-slate-600">{mensagem}</p>}
    </div>
  );
}
