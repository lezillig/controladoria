"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inputClass, labelClass, primaryButtonClass } from "@/lib/ui";
import { salvarConfiguracao } from "./actions";

export type ValoresConfig = {
  emails: string;
  dataInicioBase: string;
  limiteAlcada: string;
  saldoMinimo: string;
  metaMargem: string;
  toleranciaVariacao: string;
  diasAtrasoCritico: string;
  limiteConcentracao: string;
  relatorioAutomatico: boolean;
  retencoesNasDeducoes: boolean;
};

export default function ConfiguracaoForm({
  valores,
  alcadaSugerida,
}: {
  valores: ValoresConfig;
  alcadaSugerida: { operacional: string; gerencial: string; diretoria: string; amostra: number } | null;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [processando, iniciar] = useTransition();
  const router = useRouter();

  return (
    <form
      className="space-y-6"
      action={(formData) => {
        setErro(null);
        setSalvo(false);
        iniciar(async () => {
          const resultado = await salvarConfiguracao(formData);
          if (resultado.erro) {
            setErro(resultado.erro);
            return;
          }
          setSalvo(true);
          router.refresh();
        });
      }}
    >
      <Campo
        rotulo="Relatório diário automático"
        ajuda="Enquanto estiver desligado, o ciclo da madrugada sincroniza a Omie e roda a auditoria, mas não gera relatório. É o modo certo durante a integração: relatório gerado sobre uma base ainda incompleta vira histórico enganoso — documento com data, com números que ninguém validou. A geração manual em Relatórios continua funcionando."
      >
        <label className="flex items-center gap-2.5 text-sm text-slate-700">
          <input
            name="relatorioAutomatico"
            type="checkbox"
            value="1"
            defaultChecked={valores.relatorioAutomatico}
            className="h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
          />
          Gerar o relatório diário ao fim de cada ciclo
        </label>
      </Campo>

      <Campo
        rotulo="Tributos retidos na fonte no DRE"
        ajuda="Ligado, os tributos que os clientes retiveram entram nas deduções da receita bruta como item próprio, somados aos títulos de imposto — é a leitura certa quando o retido NÃO vira título a pagar, porque aí os dois se completam. Desligado, ficam de fora: é a leitura certa quando a empresa lança o imposto cheio e abate a retenção na hora de recolher, porque aí o título já contém o valor e somar contaria o mesmo imposto duas vezes. O dado sozinho não distingue os dois arranjos — a diferença está na prática de lançamento, e por isso a escolha é sua. Para confirmar: pegue um título de imposto do mês e veja se o valor é o imposto cheio sobre o faturamento (desligue) ou só o saldo depois da retenção (mantenha ligado)."
      >
        <label className="flex items-center gap-2.5 text-sm text-slate-700">
          <input
            name="retencoesNasDeducoes"
            type="checkbox"
            value="1"
            defaultChecked={valores.retencoesNasDeducoes}
            className="h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
          />
          Somar as retenções às deduções da receita bruta
        </label>
      </Campo>

      <Campo
        rotulo="Destinatários do relatório diário"
        ajuda="Separados por vírgula. Quem recebe relatório gerencial muda com o tempo — por isso fica aqui, e não no código."
      >
        <input name="emails" defaultValue={valores.emails} className={inputClass} />
      </Campo>

      <Campo
        rotulo="Início da base histórica"
        ajuda="A partir de que data a carga da Omie é feita. Recuar esta data dispara a carga dos meses anteriores em segundo plano, e é o que dá comparação ano contra ano."
      >
        <input name="dataInicioBase" type="date" defaultValue={valores.dataInicioBase} className={inputClass} />
      </Campo>

      <Campo
        rotulo="Alçada de aprovação de pagamentos (R$)"
        ajuda="Valor acima do qual um pagamento exige aprovação de nível superior. É o que liga a detecção de fracionamento — vários pagamentos logo abaixo do teto para evitar a aprovação."
      >
        <input name="limiteAlcada" inputMode="decimal" defaultValue={valores.limiteAlcada} className={inputClass} placeholder="ex.: 10000" />
        {alcadaSugerida && (
          <div className="mt-2 rounded-lg bg-blue-50 p-3 text-xs text-blue-900">
            <p className="font-medium">Sugestão calculada sobre {alcadaSugerida.amostra} pagamentos reais desta operação:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              <li>
                Até <strong>{alcadaSugerida.operacional}</strong> — aprovação do financeiro (cobre a rotina)
              </li>
              <li>
                Até <strong>{alcadaSugerida.gerencial}</strong> — dupla aprovação: financeiro + gestor
              </li>
              <li>
                Acima disso — aprovação da diretoria; acima de <strong>{alcadaSugerida.diretoria}</strong>, também contrato
                formal e conferência da conta bancária do fornecedor
              </li>
            </ul>
            <p className="mt-2">
              Regra que sustenta o resto, independentemente dos valores: quem cadastra o título nunca pode ser quem aprova o
              pagamento.
            </p>
          </div>
        )}
      </Campo>

      <Campo
        rotulo="Saldo mínimo de caixa (R$)"
        ajuda="Colchão de segurança. Abaixo dele, o sistema abre um alerta antes que a falta de saldo vire juros de conta garantida. Em branco, a verificação não roda — o sistema não inventa um número."
      >
        <input name="saldoMinimo" inputMode="decimal" defaultValue={valores.saldoMinimo} className={inputClass} />
      </Campo>

      <Campo
        rotulo="Meta de margem por contrato (%)"
        ajuda="Usada para apontar contratos abaixo do esperado. Em branco, o sistema só aponta margem negativa — não arbitra qual margem positiva é 'boa'."
      >
        <input name="metaMargem" inputMode="decimal" defaultValue={valores.metaMargem} className={inputClass} />
      </Campo>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Campo rotulo="Tolerância de variação de custo (%)" ajuda="Acima disso, a alta de uma categoria vira achado.">
          <input name="toleranciaVariacao" inputMode="decimal" defaultValue={valores.toleranciaVariacao} className={inputClass} />
        </Campo>
        <Campo rotulo="Atraso crítico (dias)" ajuda="A partir de quantos dias um título vencido sobe de severidade.">
          <input name="diasAtrasoCritico" inputMode="numeric" defaultValue={valores.diasAtrasoCritico} className={inputClass} />
        </Campo>
        <Campo rotulo="Limite de concentração (%)" ajuda="Participação de um único cliente ou fornecedor a partir da qual vira risco.">
          <input name="limiteConcentracao" inputMode="decimal" defaultValue={valores.limiteConcentracao} className={inputClass} />
        </Campo>
      </div>

      {erro && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p>}
      {salvo && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Parâmetros salvos.</p>}

      <button type="submit" disabled={processando} className={primaryButtonClass}>
        {processando ? "Salvando..." : "Salvar parâmetros"}
      </button>
      <p className="text-xs text-slate-500">
        Toda alteração aqui fica registrada com autor, data e valores anterior e novo — o módulo audita também quem mexe
        nele.
      </p>
    </form>
  );
}

function Campo({ rotulo, ajuda, children }: { rotulo: string; ajuda: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={labelClass}>{rotulo}</label>
      {children}
      <p className="mt-1 text-xs text-slate-500">{ajuda}</p>
    </div>
  );
}
