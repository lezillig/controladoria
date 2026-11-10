import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { inputClass, labelClass, larguraPainel, primaryButtonClass } from "@/lib/ui";
import { fmtDataHora, fmtNumero } from "@/lib/controladoria/format";
import { fmtUsd } from "@/lib/ia/precos";
import { ROTULO_DA_ORIGEM, situacaoDoTeto } from "@/lib/ia/uso";
import { chamadasDoUso, mesCorrente, mesValido, resumoDoUso, tokensPorParecer, type FiltroDoUso } from "@/lib/ia/painel";
import { exigirPermissao } from "../_dados";
import { Kpi, Secao, Tabela } from "../_componentes";
import { salvarConfiguracaoDaIa } from "./actions";

// USO DA IA — quanto custou, com o quê, e os freios do que roda sozinho.
//
// Cada chamada à API vira uma linha (src/lib/ia/uso.ts). Esta tela soma essas
// linhas por função, por modelo e por pessoa, e é onde se define o teto mensal
// que pausa a triagem automática e o parecer mensal. O custo é em dólar porque
// é em dólar que a API cobra; converter aqui esconderia o câmbio do dia da
// fatura.
export const maxDuration = 60;

const rotuloDaOrigem = (o: string) => ROTULO_DA_ORIGEM[o] ?? o;

function rotuloDoMes(mes: string): string {
  const [ano, m] = mes.split("-").map(Number);
  return new Date(ano, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

export default async function UsoDaIaPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; origem?: string; modelo?: string; usuario?: string; lote?: string; salvo?: string }>;
}) {
  const session = await exigirPermissao("gerir-modelo");
  const sp = await searchParams;
  const mes = mesValido(sp.mes) ? sp.mes : mesCorrente();
  const doMes: FiltroDoUso = { companyId: session.companyId, mes };
  const filtro: FiltroDoUso = {
    ...doMes,
    ...(sp.origem ? { origem: sp.origem } : {}),
    ...(sp.modelo ? { modelo: sp.modelo } : {}),
    ...(sp.usuario ? { usuario: sp.usuario } : {}),
    ...(sp.lote === "1" ? { lote: true } : {}),
  };
  const filtrado = Boolean(sp.origem || sp.modelo || sp.usuario || sp.lote === "1");

  const [resumo, lista, teto, config, tokens] = await Promise.all([
    resumoDoUso(doMes),
    chamadasDoUso(filtro),
    situacaoDoTeto(session.companyId),
    prisma.controladoriaConfig.findUnique({
      where: { companyId: session.companyId },
      select: { iaTetoMensalUsdCents: true, iaTriagemAutomatica: true, iaTriagemPorDia: true, iaParecerMensalAutomatico: true, iaOrcamentoTokensParecer: true },
    }),
    tokensPorParecer(session.companyId),
  ]);

  // O link de um número leva à lista com o filtro daquele número, no mesmo mês.
  const para = (extra: Record<string, string>) => `/ia?${new URLSearchParams({ mes, ...extra }).toString()}#chamadas`;
  const meses = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    return mesCorrente(new Date(d.getFullYear(), d.getMonth() - i, 1));
  });
  const ehMesCorrente = mes === mesCorrente();
  const usoDoTeto = teto.tetoMicroUsd ? Math.round((teto.gastoMicroUsd / teto.tetoMicroUsd) * 100) : null;

  // Tabela própria, sem a largura mínima da `Tabela` das telas: são três
  // quadros lado a lado, e com 520px de mínimo a coluna do custo — a que
  // importa — ficava escondida atrás da rolagem.
  const quadro = (titulo: string, coluna: string, grupos: { chave: string; chamadas: number; microUsd: number }[], campo: "origem" | "modelo" | "usuario", rotulo: (c: string) => string) => (
    <Secao titulo={titulo} descricao={`Soma: ${fmtUsd(grupos.reduce((s, g) => s + g.microUsd, 0))} — a mesma do cartão "Gasto no mês".`}>
      {grupos.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">Nenhuma chamada neste mês.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <th className="py-2 pr-2">{coluna}</th>
              <th className="px-2 py-2 text-right">Chamadas</th>
              <th className="py-2 pl-2 text-right">Custo</th>
            </tr>
          </thead>
          <tbody>
            {grupos.map((g) => (
              <tr key={g.chave} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="py-2.5 pr-2">
                  <Link href={para({ [campo]: g.chave })} className="break-words text-blue-700 hover:underline">
                    {rotulo(g.chave)}
                  </Link>
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums text-slate-700">{fmtNumero(g.chamadas)}</td>
                <td className="whitespace-nowrap py-2.5 pl-2 text-right tabular-nums text-slate-700">{fmtUsd(g.microUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Secao>
  );

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Uso da IA</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Quanto cada chamada à IA custou, por função, modelo e pessoa, e os limites do que roda sozinho (triagem dos achados críticos e parecer
            mensal). O custo é em dólar, como a API cobra.
          </p>
        </div>
        <form className="flex items-end gap-2" action="/ia">
          <div>
            <label className={labelClass} htmlFor="mes">
              Mês
            </label>
            <select id="mes" name="mes" defaultValue={mes} className={inputClass}>
              {(meses.includes(mes) ? meses : [mes, ...meses]).map((m) => (
                <option key={m} value={m}>
                  {rotuloDoMes(m)}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className={primaryButtonClass}>
            Ver
          </button>
        </form>
      </div>

      {ehMesCorrente && teto.estourado && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          O teto mensal foi atingido: a triagem automática e o parecer mensal estão pausados até o mês virar (ou até o teto subir, abaixo). As
          perguntas feitas por pessoas continuam funcionando.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi rotulo="Gasto no mês" valor={fmtUsd(resumo.microUsd)} apoio={`${rotuloDoMes(mes)}${resumo.estimadas ? ` · ${resumo.estimadas} chamada(s) com preço estimado` : ""}`} href={para({})} />
        <Kpi rotulo="Chamadas" valor={fmtNumero(resumo.chamadas)} apoio={`${fmtNumero(resumo.entradaTokens + resumo.cacheLidoTokens)} tokens lidos · ${fmtNumero(resumo.saidaTokens)} escritos`} href={para({})} />
        <Kpi
          rotulo="Em lote (metade do preço)"
          valor={fmtUsd(resumo.loteMicroUsd)}
          apoio={`${fmtNumero(resumo.loteChamadas)} chamada(s) sem ninguém esperando`}
          href={para({ lote: "1" })}
        />
        <Kpi
          rotulo="Teto mensal"
          valor={teto.tetoMicroUsd === null ? "Sem teto" : fmtUsd(teto.tetoMicroUsd)}
          apoio={usoDoTeto === null ? "Nada pausa o que roda sozinho" : `${usoDoTeto}% usado neste mês`}
          tom={teto.estourado ? "ruim" : usoDoTeto !== null && usoDoTeto >= 80 ? "atencao" : "neutro"}
          // O teto é configuração, não soma: o que o consome está no cartão "Gasto no mês".
          href="#limites"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {quadro("Por função", "Função", resumo.porOrigem, "origem", rotuloDaOrigem)}
        {quadro("Por modelo", "Modelo", resumo.porModelo, "modelo", (c) => c)}
        {quadro("Por pessoa", "Pessoa", resumo.porUsuario, "usuario", (c) => c)}
      </div>

      <Secao
        id="chamadas"
        titulo="Chamadas"
        descricao={`${rotuloDoMes(mes)}${sp.origem ? ` · função: ${rotuloDaOrigem(sp.origem)}` : ""}${sp.modelo ? ` · modelo: ${sp.modelo}` : ""}${sp.usuario ? ` · pessoa: ${sp.usuario}` : ""}${sp.lote === "1" ? " · só em lote" : ""} — ${fmtNumero(lista.total)} chamada(s), soma ${fmtUsd(lista.microUsd)}${lista.total > lista.linhas.length ? ` (mostrando as ${lista.linhas.length} mais recentes)` : ""}.`}
        acao={
          filtrado ? (
            <Link href={`/ia?mes=${mes}#chamadas`} className="text-xs font-medium text-blue-700 hover:underline">
              Limpar filtro
            </Link>
          ) : undefined
        }
      >
        <Tabela
          colunas={["Quando", "Função", "Pessoa", "Modelo", "Lidos", "Do cache", "Escritos", "Custo"]}
          alinharDireita={[4, 5, 6, 7]}
          vazio="Nenhuma chamada com este filtro."
          linhas={lista.linhas.map((l) => [
            <span key="q" className="whitespace-nowrap text-xs text-slate-600">
              {fmtDataHora(l.criadoEm)}
            </span>,
            l.referenciaTipo === "Investigacao" && l.referenciaId ? (
              <Link key="f" href={`/auditoria/investigar?id=${l.referenciaId}`} className="text-blue-700 hover:underline">
                {rotuloDaOrigem(l.origem)}
              </Link>
            ) : (
              rotuloDaOrigem(l.origem)
            ),
            <span key="p" className="text-xs text-slate-600">
              {l.userNome ?? "automático"}
            </span>,
            <span key="m" className="whitespace-nowrap font-mono text-xs text-slate-600">
              {l.modelo}
              {l.lote ? " · lote" : ""}
              {l.precoEstimado ? " · preço estimado" : ""}
            </span>,
            fmtNumero(l.entradaTokens + l.cacheGravadoTokens),
            fmtNumero(l.cacheLidoTokens),
            fmtNumero(l.saidaTokens),
            fmtUsd(l.custoMicroUsd),
          ])}
        />
      </Secao>

      <Secao
        id="limites"
        titulo="Limites do que roda sozinho"
        descricao="A triagem dos achados críticos de antifraude e o parecer mensal custam dinheiro sem ninguém clicar. Aqui ficam os freios."
      >
        {sp.salvo === "1" && <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Limites salvos.</p>}
        <form action={salvarConfiguracaoDaIa} className="grid max-w-3xl grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="tetoMensalUsd">
              Teto mensal (US$)
            </label>
            <input
              id="tetoMensalUsd"
              name="tetoMensalUsd"
              inputMode="decimal"
              defaultValue={config?.iaTetoMensalUsdCents != null ? (config.iaTetoMensalUsdCents / 100).toLocaleString("pt-BR") : ""}
              placeholder="em branco = sem teto"
              className={inputClass}
            />
            <p className="mt-1 text-xs text-slate-500">Atingido, a triagem e o parecer mensal param até o mês virar. As perguntas feitas por pessoas não param.</p>
          </div>
          <div>
            <label className={labelClass} htmlFor="triagemPorDia">
              Triagens por dia
            </label>
            <input id="triagemPorDia" name="triagemPorDia" inputMode="numeric" defaultValue={config?.iaTriagemPorDia ?? 3} className={inputClass} />
            <p className="mt-1 text-xs text-slate-500">Quantos achados críticos de antifraude, no máximo, ganham investigação automática por dia (os de maior valor primeiro).</p>
          </div>
          <label className="flex items-start gap-2.5 text-sm text-slate-700">
            <input name="triagemAutomatica" type="checkbox" value="1" defaultChecked={config?.iaTriagemAutomatica ?? true} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-700" />
            <span>
              Triagem automática dos achados críticos de antifraude
              <span className="block text-xs text-slate-500">De madrugada, cada achado crítico novo de fraude é investigado e o e-mail da manhã traz a recomendação de segurar ou liberar.</span>
            </span>
          </label>
          <label className="flex items-start gap-2.5 text-sm text-slate-700">
            <input name="parecerMensalAutomatico" type="checkbox" value="1" defaultChecked={config?.iaParecerMensalAutomatico ?? true} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-700" />
            <span>
              Parecer mensal do controller pedido sozinho
              <span className="block text-xs text-slate-500">A partir do dia 6, o parecer do mês anterior é pedido em lote (metade do preço) e avisado por e-mail.</span>
            </span>
          </label>
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="orcamentoTokensParecer">
              Orçamento de tokens por parecer (opcional)
            </label>
            <input
              id="orcamentoTokensParecer"
              name="orcamentoTokensParecer"
              inputMode="numeric"
              defaultValue={config?.iaOrcamentoTokensParecer ?? ""}
              placeholder="em branco = desligado"
              className={`${inputClass} max-w-xs`}
            />
            <p className="mt-1 text-xs text-slate-500">
              Com um orçamento, o modelo vê quanto ainda tem e dosa as consultas para fechar a resposta. O valor certo sai do uso medido, não de palpite:{" "}
              {tokens.pareceres >= 5
                ? `nos últimos 90 dias, ${tokens.pareceres} pareceres escreveram ${fmtNumero(tokens.mediana)} tokens na mediana e ${fmtNumero(tokens.p90)} no percentil 90 — comece por este último.`
                : `ainda há só ${tokens.pareceres} parecer(es) medido(s); espere pelo menos cinco antes de ligar.`}{" "}
              Mínimo aceito pela API: 20.000.
            </p>
          </div>
          <div className="sm:col-span-2">
            <button type="submit" className={primaryButtonClass}>
              Salvar limites
            </button>
          </div>
        </form>
      </Secao>
    </div>
  );
}
