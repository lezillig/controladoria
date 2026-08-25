"use client";

import { useState, useTransition } from "react";
import { fmtBRL, fmtData, fmtNumero } from "@/lib/controladoria/format";
import { inputClass, labelClass, primaryButtonClass } from "@/lib/ui";
import type { LinhaConferencia } from "@/lib/controladoria/cte";
import { Kpi, Secao, Tabela } from "../_componentes";
import { conferirListaDeCte, type EstadoConferencia } from "./actions";

// A CONFERÊNCIA INTEIRA NUMA TELA SÓ: cola, confere, lê.
//
// O resultado não é gravado e não navega para lugar nenhum — ele aparece
// embaixo do que foi colado. É de propósito: a pessoa vai corrigir na Omie com
// esta tela aberta ao lado, e mandar o resultado para outra rota a obrigaria a
// voltar para reconferir.

const ROTULO: Record<LinhaConferencia["tipo"], { texto: string; classe: string }> = {
  cancelado_com_titulo: { texto: "Cancelado, título vivo", classe: "bg-red-100 text-red-700" },
  valor_divergente: { texto: "Valor divergente", classe: "bg-orange-100 text-orange-700" },
  autorizado_sem_titulo: { texto: "Emitido, não cobrado", classe: "bg-amber-100 text-amber-800" },
  titulo_sem_cte: { texto: "Título sem CT-e na lista", classe: "bg-sky-100 text-sky-700" },
  casado: { texto: "Confere", classe: "bg-emerald-100 text-emerald-700" },
};

const EXEMPLO = `Data\tStatus\tCTE\tCFOP\tTipo\tTomador (CNPJ/CPF)\tTomador (Razão Social)\tTotal Frete
30/01/2026\tAutorizada\t1165\t5357\tNormal\t61.186.888/0002-74\tSPAL INDUSTRIA BRASILEIRA DE BEBIDAS S/A\t7.241,42`;

export default function ConferenciaForm({
  conexoes,
}: {
  conexoes: { id: string; apelido: string; nome: string }[];
}) {
  const [estado, setEstado] = useState<EstadoConferencia | null>(null);
  const [processando, iniciar] = useTransition();

  const r = estado?.resultado;

  return (
    <div className="space-y-6">
      <Secao
        titulo="Colar a relação de CT-e"
        descricao="Na Omie, abra a relação de CT-e do período, selecione as linhas e cole aqui — com o cabeçalho das colunas."
      >
        <form
          className="space-y-4"
          action={(formData) => {
            setEstado(null);
            iniciar(async () => setEstado(await conferirListaDeCte(formData)));
          }}
        >
          <div>
            <label className={labelClass} htmlFor="lista">
              Relação colada *
            </label>
            <textarea
              id="lista"
              name="lista"
              required
              rows={10}
              spellCheck={false}
              placeholder={EXEMPLO}
              className={`${inputClass} font-mono text-xs`}
            />
            <p className="mt-1 text-xs text-slate-500">
              Aceita tabulação, ponto e vírgula ou vírgula como separador, e as duas telas da Omie. O período é
              descoberto pelas datas da lista — pode colar um mês ou o ano inteiro.
            </p>
          </div>

          {conexoes.length > 1 && (
            <div className="max-w-sm">
              <label className={labelClass} htmlFor="empresa">
                Empresa
              </label>
              <select id="empresa" name="empresa" defaultValue="" className={inputClass}>
                <option value="">Grupo (as duas empresas)</option>
                {conexoes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.apelido} — {c.nome}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">
                Escolha a empresa que emitiu os CT-e. No grupo, um CT-e da MCZ poderia casar com um título da Azul de
                mesmo valor.
              </p>
            </div>
          )}

          <button type="submit" disabled={processando} className={primaryButtonClass}>
            {processando ? "Conferindo..." : "Conferir"}
          </button>
        </form>

        {estado?.erro && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{estado.erro}</p>}
      </Secao>

      {r && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi
              rotulo="Cancelado com título vivo"
              valor={fmtBRL(r.canceladoComTituloCents)}
              apoio={`${r.linhas.filter((l) => l.tipo === "cancelado_com_titulo").length} CT-e — receita sem documento fiscal válido`}
              tom={r.canceladoComTituloCents > 0 ? "ruim" : "bom"}
            />
            <Kpi
              rotulo="Emitido e não cobrado"
              valor={fmtBRL(r.autorizadoSemTituloCents)}
              apoio={`${r.linhas.filter((l) => l.tipo === "autorizado_sem_titulo").length} CT-e — imposto devido, cliente sem fatura`}
              tom={r.autorizadoSemTituloCents > 0 ? "ruim" : "bom"}
            />
            <Kpi
              rotulo="Divergência de valor"
              valor={fmtBRL(r.divergenciaDeValorCents)}
              apoio={`${r.linhas.filter((l) => l.tipo === "valor_divergente").length} CT-e — cobrança fora do documento`}
              tom={r.divergenciaDeValorCents > 0 ? "atencao" : "bom"}
            />
            <Kpi
              rotulo="Conferem"
              valor={fmtNumero(r.casados)}
              apoio={`de ${fmtNumero(r.lidos)} lidos (${fmtNumero(r.autorizados)} autorizados, ${fmtNumero(r.cancelados)} cancelados)`}
              tom={r.casados === r.lidos ? "bom" : "neutro"}
            />
          </div>

          <Secao
            titulo="Diferenças"
            descricao={
              `${fmtNumero(r.titulosNoPeriodo)} títulos de CT-e espelhados` +
              (estado?.periodo ? ` entre ${estado.periodo.inicio} e ${estado.periodo.fim}` : "") +
              `. O conserto é na Omie — esta tela não altera nada.`
            }
          >
            {r.titulosSemNumero > 0 && (
              <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <strong>{fmtNumero(r.titulosSemNumero)}</strong> dos {fmtNumero(r.titulosNoPeriodo)} títulos estão sem o
                número do documento fiscal preenchido na Omie. Esses só dão para casar por valor e data — e dois CT-e de
                mesmo valor no mesmo dia ficam indistinguíveis. A coluna &quot;casado por&quot; diz quais são.
              </p>
            )}

            <Tabela
              colunas={["", "CT-e", "Data", "Tomador", "Valor do CT-e", "Valor do título", "Situação", "Casado por"]}
              alinharDireita={[4, 5]}
              vazio="Nenhuma diferença: todos os CT-e da lista casaram com títulos, e nenhum título ficou sobrando."
              linhas={r.linhas
                .filter((l) => l.tipo !== "casado")
                .map((l) => [
                  <span key="t" className={`rounded-full px-2 py-0.5 text-xs font-medium ${ROTULO[l.tipo].classe}`}>
                    {ROTULO[l.tipo].texto}
                  </span>,
                  l.numero ?? <span key="s" className="text-slate-400">sem número</span>,
                  fmtData(l.data),
                  l.tomador,
                  l.valorCteCents === null ? "—" : fmtBRL(l.valorCteCents),
                  l.valorTituloCents === null ? "—" : fmtBRL(l.valorTituloCents),
                  l.situacaoTitulo ?? "—",
                  l.casadoPor ?? "—",
                ])}
            />
          </Secao>

          {estado?.ignoradas && estado.ignoradas.length > 0 && (
            <Secao
              titulo={`${estado.ignoradas.length} linha(s) não entendida(s)`}
              descricao="Normalmente são linhas de total, de filtro ou de rodapé. Confira se alguma é CT-e de verdade — se for, o cabeçalho não bateu."
            >
              <ul className="space-y-1 font-mono text-xs text-slate-600">
                {estado.ignoradas.slice(0, 20).map((l, i) => (
                  <li key={i} className="truncate">
                    {l}
                  </li>
                ))}
              </ul>
            </Secao>
          )}
        </>
      )}
    </div>
  );
}
