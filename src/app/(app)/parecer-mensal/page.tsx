import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { inputClass, labelClass, larguraPainel, primaryButtonClass } from "@/lib/ui";
import { fmtDataHora } from "@/lib/controladoria/format";
import { coletarLotes, isLoteDisponivel } from "@/lib/ia/lote";
import { competenciaAnterior, ParecerSchema, type Parecer } from "@/lib/controladoria/parecerMensal";
import { exigirPermissao, podeAcao } from "../_dados";
import { AvisoVazio, Secao, Tabela } from "../_componentes";
import { pedirParecer } from "./actions";

// PARECER MENSAL DO CONTROLLER (ver src/lib/controladoria/parecerMensal.ts).
//
// A tela não tem cartão de indicador de propósito: o parecer é texto, e todo
// número que ele cita está no briefing — mostrado abaixo do parecer, inteiro,
// como foi ao modelo. As somas vivem nas telas de origem (Custos e DRE,
// Títulos, Auditoria), que é para onde os links levam.
export const maxDuration = 60;

function rotuloDaCompetencia(c: string): string {
  const [ano, mes] = c.split("-").map(Number);
  return new Date(ano, mes - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

const STATUS: Record<string, { rotulo: string; classe: string }> = {
  AGUARDANDO: { rotulo: "Na fila", classe: "bg-amber-100 text-amber-800" },
  PRONTO: { rotulo: "Pronto", classe: "bg-emerald-100 text-emerald-700" },
  ERRO: { rotulo: "Falhou", classe: "bg-red-100 text-red-700" },
};

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-900">{titulo}</h3>
      <div className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{children}</div>
    </div>
  );
}

export default async function ParecerMensalPage({ searchParams }: { searchParams: Promise<{ id?: string; erro?: string }> }) {
  const session = await exigirPermissao("relatorios");
  const { id, erro } = await searchParams;
  const podePedir = await podeAcao(session, "investigar");

  // Recolhe o que estiver pronto na fila antes de listar: quem abre a tela
  // para ver se o parecer chegou não precisa esperar a próxima passada do ciclo.
  if (isLoteDisponivel()) await coletarLotes({ companyId: session.companyId, tipo: "parecer_mensal" }).catch(() => undefined);

  const [lista, conexoes] = await Promise.all([
    prisma.parecerMensal.findMany({
      where: { companyId: session.companyId },
      orderBy: [{ competencia: "desc" }, { criadoEm: "desc" }],
      take: 36,
      select: { id: true, competencia: true, empresa: true, status: true, criadoEm: true, concluidoEm: true, pedidoPor: true },
    }),
    prisma.omieConexao.findMany({ where: { companyId: session.companyId, ativa: true }, orderBy: { ordem: "asc" }, select: { id: true, apelido: true, nome: true } }),
  ]);
  const aberto = await prisma.parecerMensal.findFirst({
    where: { companyId: session.companyId, ...(id ? { id } : { status: "PRONTO" }) },
    orderBy: [{ competencia: "desc" }, { criadoEm: "desc" }],
  });
  const lido = aberto?.status === "PRONTO" ? ParecerSchema.safeParse(aberto.parecer) : null;
  const parecer: Parecer | null = lido?.success ? lido.data : null;

  // Os doze meses fechados mais recentes.
  const meses = Array.from({ length: 12 }, (_, i) => {
    const d = new Date();
    return competenciaAnterior(new Date(d.getFullYear(), d.getMonth() - i, 1));
  });

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Parecer mensal do controller</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          O mês fechado em uma leitura: o resultado contra os meses anteriores, o caixa, o que a auditoria apontou e continua aberto, e até três
          decisões para a diretoria. Os números vêm das mesmas somas das telas e ficam guardados junto do parecer, para conferência.
        </p>
      </div>

      {erro && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p>}

      {podePedir &&
        (isLoteDisponivel() ? (
          <Secao
            titulo="Pedir um parecer"
            descricao="Vai em lote, pela metade do preço: fica pronto em geral em menos de uma hora, e chega por e-mail a quem recebe o relatório. A partir do dia 6, o do mês anterior (grupo) é pedido sozinho."
          >
            <form action={pedirParecer} className="flex flex-wrap items-end gap-3">
              <div>
                <label className={labelClass} htmlFor="competencia">
                  Mês
                </label>
                <select id="competencia" name="competencia" defaultValue={meses[0]} className={inputClass}>
                  {meses.map((m) => (
                    <option key={m} value={m}>
                      {rotuloDaCompetencia(m)}
                    </option>
                  ))}
                </select>
              </div>
              {conexoes.length > 1 && (
                <div>
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
                </div>
              )}
              <label className="flex items-center gap-2 pb-2 text-xs text-slate-600">
                <input type="checkbox" name="refazer" value="1" className="h-4 w-4 rounded border-slate-300" />
                Refazer se já existir
              </label>
              <button type="submit" className={primaryButtonClass}>
                Pedir parecer
              </button>
            </form>
          </Secao>
        ) : (
          <AvisoVazio
            titulo="Parecer indisponível"
            descricao="A chave da API de IA (ANTHROPIC_API_KEY) não está configurada na hospedagem. As demais telas continuam funcionando."
          />
        ))}

      {aberto && (
        <Secao
          titulo={`${rotuloDaCompetencia(aberto.competencia)} — ${aberto.empresa}`}
          descricao={`Pedido por ${aberto.pedidoPor ?? "—"} em ${fmtDataHora(aberto.criadoEm)}${aberto.concluidoEm ? ` · pronto em ${fmtDataHora(aberto.concluidoEm)}` : ""}${aberto.modelo ? ` · modelo ${aberto.modelo}` : ""}`}
        >
          {aberto.status === "AGUARDANDO" && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Na fila da API (lote). Costuma ficar pronto em menos de uma hora; esta tela recolhe o resultado ao ser aberta, e o aviso chega por e-mail.
            </p>
          )}
          {aberto.status === "ERRO" && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">O parecer não completou: {aberto.erro ?? "erro não informado"}</p>}
          {aberto.status === "PRONTO" && !parecer && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">O parecer guardado não está no formato esperado. Peça de novo marcando “Refazer”.</p>
          )}
          {parecer && (
            <div className="space-y-5">
              <Bloco titulo="Resumo">{parecer.resumoExecutivo}</Bloco>
              {parecer.decisoes.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Decisões propostas</h3>
                  <ol className="mt-2 space-y-2">
                    {parecer.decisoes.map((d, i) => (
                      <li key={i} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
                        <span className="font-semibold text-slate-900">
                          {i + 1}. {d.decisao}
                        </span>
                        <div className="mt-1">{d.porque}</div>
                        <div className="mt-1 text-xs text-slate-500">Dado que sustenta: {d.dadoQueSustenta}</div>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {parecer.resultado.map((r, i) => (
                <Bloco key={i} titulo={r.titulo}>
                  {r.texto}
                </Bloco>
              ))}
              <Bloco titulo="Caixa e títulos em aberto">{parecer.caixa}</Bloco>
              <Bloco titulo="Apontado pela auditoria e não corrigido">{parecer.achadosNaoCorrigidos}</Bloco>
              <Bloco titulo="Achados do mês">{parecer.achadosDoMes}</Bloco>
              {parecer.limitacoes.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">O que a base não permitiu concluir</h3>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
                    {parecer.limitacoes.map((l, i) => (
                      <li key={i}>{l}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-xs text-slate-500">
                Para abrir os números: <Link href="/custos" className="text-blue-700 hover:underline">Custos e DRE</Link> ·{" "}
                <Link href="/titulos" className="text-blue-700 hover:underline">Contas a pagar e receber</Link> ·{" "}
                <Link href="/auditoria" className="text-blue-700 hover:underline">Auditoria e achados</Link>.
              </p>
            </div>
          )}
          <details className="mt-5">
            <summary className="cursor-pointer text-xs font-medium text-blue-700">Os números que foram ao modelo (o briefing inteiro)</summary>
            <pre className="mt-2 max-h-[480px] overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">{aberto.briefing}</pre>
          </details>
        </Secao>
      )}

      <Secao titulo="Pareceres" descricao="Um por mês e por recorte (grupo ou empresa).">
        <Tabela
          colunas={["Mês", "Recorte", "Pedido por", "Pedido em", "Situação"]}
          vazio="Nenhum parecer ainda."
          linhas={lista.map((p) => [
            <Link key="m" href={`/parecer-mensal?id=${p.id}`} className="text-blue-700 hover:underline">
              {rotuloDaCompetencia(p.competencia)}
            </Link>,
            p.empresa,
            <span key="u" className="text-xs text-slate-600">
              {p.pedidoPor ?? "—"}
            </span>,
            <span key="q" className="whitespace-nowrap text-xs text-slate-600">
              {fmtDataHora(p.criadoEm)}
            </span>,
            <span key="s" className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[p.status]?.classe ?? "bg-slate-100 text-slate-600"}`}>
              {STATUS[p.status]?.rotulo ?? p.status}
            </span>,
          ])}
        />
      </Secao>
    </div>
  );
}
