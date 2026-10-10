import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { fmtData } from "@/lib/controladoria/format";
import { paraNumero } from "@/lib/simulador/baseDeCustos";
import { ROTULO_STATUS_ESTUDO, ROTULO_TIPO_SERVICO, STATUS_ESTUDO, TIPOS_SERVICO } from "@/lib/simulador/estudos";
import { montarHistorico, type EditalDoHistorico } from "@/lib/simulador/historicoDeEditais";
import { unidadeDoTeto, type UnidadePreco } from "@/lib/simulador/tipos";
import { exigirPermissao } from "../../_dados";
import { AvisoVazio, Kpi, Secao, Tabela } from "../../_componentes";
import { larguraPainel, secondaryButtonClass } from "@/lib/ui";

// HISTÓRICO DE EDITAIS — tudo o que foi analisado, com o resultado.
//
// Cada estudo é um edital (ou proposta) que passou pelo simulador. Aqui ele
// aparece com o que aconteceu depois: em que pé está, quem venceu, a que
// preço, a que distância ficamos e quanto o vencedor deu de desconto sobre o
// teto. Embaixo, a taxa de vitória por serviço e os concorrentes — quem
// aparece, quem ganha e quanto cobra contra o nosso preço no mesmo edital.

const SERVICO = ROTULO_TIPO_SERVICO as Record<string, string>;
const STATUS = ROTULO_STATUS_ESTUDO as Record<string, string>;
const pct = (v: number | null, sinal = false) => (v === null ? "—" : `${sinal && v > 0 ? "+" : ""}${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
const reais = (v: number | null) => (v === null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: v < 100 ? 4 : 2 }));

export default async function HistoricoDeEditaisPage({ searchParams }: { searchParams: Promise<{ q?: string; servico?: string; situacao?: string; ano?: string; esfera?: string }> }) {
  const session = await exigirPermissao("simulador");
  const f = await searchParams;
  const q = (f.q ?? "").trim().slice(0, 80);
  const ano = /^\d{4}$/.test(f.ano ?? "") ? Number(f.ano) : null;
  const esfera = f.esfera === "PRIVADO" || f.esfera === "TODAS" ? f.esfera : "PUBLICO";

  const estudos = await prisma.simEstudo.findMany({
    where: {
      companyId: session.companyId,
      ...(esfera !== "TODAS" && { esfera }),
      ...((TIPOS_SERVICO as readonly string[]).includes(f.servico ?? "") && { tipoServico: f.servico }),
      ...((STATUS_ESTUDO as readonly string[]).includes(f.situacao ?? "") && { status: f.situacao }),
      ...(ano && { OR: [{ dataSessao: { gte: new Date(ano, 0, 1), lt: new Date(ano + 1, 0, 1) } }, { dataSessao: null, criadoEm: { gte: new Date(ano, 0, 1), lt: new Date(ano + 1, 0, 1) } }] }),
      ...(q && {
        AND: [{ OR: [{ nome: { contains: q, mode: "insensitive" as const } }, { orgao: { contains: q, mode: "insensitive" as const } }, { cliente: { contains: q, mode: "insensitive" as const } }, { numeroEdital: { contains: q, mode: "insensitive" as const } }, { municipio: { contains: q, mode: "insensitive" as const } }, { participantes: { some: { empresa: { contains: q, mode: "insensitive" as const } } } }] }],
      }),
    },
    orderBy: [{ dataSessao: { sort: "desc", nulls: "last" } }, { criadoEm: "desc" }],
    take: 500,
    select: {
      id: true,
      nome: true,
      orgao: true,
      cliente: true,
      numeroEdital: true,
      tipoServico: true,
      esfera: true,
      status: true,
      dataSessao: true,
      unidadePreco: true,
      resultadoVencedor: true,
      resultadoPrecoKm: true,
      resultadoPosicao: true,
      valorTotalMaximo: true,
      itens: { select: { precoMaximoKm: true } },
      participantes: { select: { empresa: true, preco: true, situacao: true, ehNossa: true, posicao: true }, orderBy: { ordem: "asc" } },
      simulacoes: { select: { status: true, precoKm: true }, orderBy: { versao: "desc" } },
      _count: { select: { arquivos: true } },
    },
  });

  const editais: EditalDoHistorico[] = estudos.map((e) => {
    const nossa = e.participantes.find((p) => p.ehNossa);
    const versao = e.simulacoes.find((s) => s.status === "LANCADA") ?? e.simulacoes[0];
    const tetos = e.itens.map((i) => paraNumero(i.precoMaximoKm)).filter((t): t is number => t !== null && t > 0);
    return {
      id: e.id,
      nome: e.nome,
      orgao: e.orgao ?? e.cliente,
      numeroEdital: e.numeroEdital,
      tipoServico: e.tipoServico,
      esfera: e.esfera,
      status: e.status,
      dataSessao: e.dataSessao,
      unidade: unidadeDoTeto(e.unidadePreco as UnidadePreco),
      nossoPreco: paraNumero(nossa?.preco) ?? paraNumero(versao?.precoKm) ?? null,
      precoVencedor: paraNumero(e.resultadoPrecoKm),
      vencedor: e.resultadoVencedor,
      posicao: nossa?.posicao ?? e.resultadoPosicao,
      teto: tetos.length > 0 ? Math.min(...tetos) : null,
      valorTotalMaximo: paraNumero(e.valorTotalMaximo),
      participantes: e.participantes.map((p) => ({ empresa: p.empresa, preco: paraNumero(p.preco), situacao: p.situacao, ehNossa: p.ehNossa })),
      arquivos: e._count.arquivos,
    };
  });
  const { linhas, resumo, porServico, concorrentes } = montarHistorico(editais);
  const filtrado = Boolean(q || f.servico || f.situacao || ano || esfera !== "PUBLICO");
  const campo = "rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm";

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs">
            <Link href="/simulador" className="text-blue-700 hover:underline">
              ← Simulador
            </Link>
          </p>
          <h1 className="text-xl font-semibold text-slate-900">Histórico de editais</h1>
          <p className="mt-1 max-w-[80ch] text-sm text-slate-500">
            Tudo o que foi analisado no simulador, com o que aconteceu depois: quem venceu, a que preço, a que distância ficamos e quanto o vencedor deu de desconto sobre o teto. O resultado de cada edital (participantes da sessão) se registra na aba Versões e resultado do estudo.
          </p>
        </div>
      </div>

      <form className="flex flex-wrap items-end gap-2" method="get">
        <label className="flex flex-col text-xs text-slate-600">
          Buscar
          <input name="q" defaultValue={q} placeholder="órgão, edital, município, concorrente" className={`${campo} w-72`} />
        </label>
        <label className="flex flex-col text-xs text-slate-600">
          Serviço
          <select name="servico" defaultValue={f.servico ?? ""} className={campo}>
            <option value="">Todos</option>
            {TIPOS_SERVICO.map((s) => (
              <option key={s} value={s}>
                {SERVICO[s] ?? s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-slate-600">
          Situação
          <select name="situacao" defaultValue={f.situacao ?? ""} className={campo}>
            <option value="">Todas</option>
            {STATUS_ESTUDO.map((s) => (
              <option key={s} value={s}>
                {STATUS[s] ?? s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-slate-600">
          Ano da sessão
          <input name="ano" defaultValue={ano ?? ""} inputMode="numeric" placeholder="2026" className={`${campo} w-24`} />
        </label>
        <label className="flex flex-col text-xs text-slate-600">
          Cliente
          <select name="esfera" defaultValue={esfera} className={campo}>
            <option value="PUBLICO">Público (licitações)</option>
            <option value="PRIVADO">Privado (propostas)</option>
            <option value="TODAS">Todos</option>
          </select>
        </label>
        <button type="submit" className={secondaryButtonClass}>
          Filtrar
        </button>
        {filtrado && (
          <Link href="/simulador/editais" className="px-2 py-1.5 text-sm text-blue-700 hover:underline">
            Limpar
          </Link>
        )}
      </form>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi rotulo="Editais analisados" valor={String(resumo.editais)} apoio={filtrado ? "no filtro" : undefined} />
        <Kpi rotulo="Taxa de vitória" valor={pct(resumo.taxa)} apoio={resumo.decididos > 0 ? `${resumo.ganhos} de ${resumo.decididos} decididos` : "nenhum decidido ainda"} tom={resumo.taxa === null ? "neutro" : resumo.taxa >= 0.3 ? "bom" : "atencao"} />
        <Kpi rotulo="Nosso preço × vencedor" valor={pct(resumo.nossoSobreVencedorMedio, true)} apoio="média nas disputas perdidas (+ = ficamos acima)" />
        <Kpi rotulo="Desconto do vencedor sobre o teto" valor={pct(resumo.descontoVencedorMedio)} apoio="média dos editais com teto publicado" />
      </div>

      <Secao titulo="Editais" descricao="Da sessão mais recente à mais antiga. Clique no edital para abrir o estudo (arquivos, versões, disputa).">
        {linhas.length === 0 ? (
          <AvisoVazio titulo={filtrado ? "Nada neste filtro" : "Nenhum edital analisado ainda"} descricao={filtrado ? "Mude ou limpe o filtro." : "Os estudos criados no simulador (pelo Importar edital ou à mão) aparecem aqui."} />
        ) : (
          <Tabela
            colunas={["Sessão", "Edital", "Serviço", "Situação", "Nosso preço", "Vencedor", "Preço vencedor", "Nosso × vencedor", "Teto", "Desconto s/ teto", "Arquivos"]}
            alinharDireita={[4, 6, 7, 8, 9, 10]}
            linhas={linhas.map((l) => [
              l.dataSessao ? fmtData(l.dataSessao) : "—",
              <Link key="e" href={`/simulador/${l.id}`} className="block min-w-[220px] max-w-[320px] font-medium text-blue-800 hover:underline" title={[l.orgao, l.nome].filter(Boolean).join(" — ")}>
                <span className="line-clamp-2">{l.orgao ?? l.nome}</span>
                <span className="block truncate text-xs font-normal text-slate-500">{[l.numeroEdital, l.unidade].filter(Boolean).join(" · ")}</span>
              </Link>,
              <span key="s" className="text-xs">
                {SERVICO[l.tipoServico] ?? l.tipoServico}
              </span>,
              <span key="st" className={`text-xs font-medium ${l.status === "GANHO" || l.status === "EM_EXECUCAO" ? "text-emerald-700" : l.status === "PERDIDO" ? "text-red-700" : "text-slate-700"}`}>
                {STATUS[l.status] ?? l.status}
                {l.posicao ? <span className="block font-normal text-slate-500">{l.posicao}º lugar</span> : null}
              </span>,
              reais(l.nossoPreco),
              <span key="v" className="text-xs">
                {l.vencedor ?? "—"}
              </span>,
              reais(l.precoVencedor),
              <span key="d" className={(l.nossoSobreVencedor ?? 0) > 0 ? "text-red-700" : undefined}>
                {pct(l.nossoSobreVencedor, true)}
              </span>,
              reais(l.teto),
              pct(l.descontoVencedor),
              l.arquivos > 0 ? String(l.arquivos) : "—",
            ])}
          />
        )}
      </Secao>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Secao titulo="Por serviço" descricao="Decididos = ganhos + perdidos (e os que viraram contrato).">
          <Tabela
            colunas={["Serviço", "Editais", "Decididos", "Ganhos", "Taxa de vitória", "Nosso × vencedor"]}
            alinharDireita={[1, 2, 3, 4, 5]}
            linhas={porServico.map((s) => [SERVICO[s.servico] ?? s.servico, String(s.editais), String(s.decididos), String(s.ganhos), pct(s.taxa), pct(s.nossoSobreVencedorMedio, true)])}
            vazio="Nenhum edital."
          />
        </Secao>
        <Secao titulo="Concorrentes" descricao="Das atas registradas. Preço × o nosso: o preço deles sobre o nosso no mesmo edital (− = mais barato que nós).">
          <Tabela
            colunas={["Empresa", "Disputas", "Vitórias", "Preço × o nosso", "Serviços", "Última sessão"]}
            alinharDireita={[1, 2, 3]}
            linhas={concorrentes.slice(0, 60).map((c) => [
              c.empresa,
              String(c.disputas),
              String(c.vitorias),
              <span key="p" className={(c.precoSobreONossoMedio ?? 0) < 0 ? "text-red-700" : undefined}>
                {pct(c.precoSobreONossoMedio, true)}
              </span>,
              <span key="s" className="text-xs">
                {c.servicos.map((s) => SERVICO[s] ?? s).join(", ")}
              </span>,
              c.ultimaSessao ? fmtData(c.ultimaSessao) : "—",
            ])}
            vazio="Registre os participantes da sessão na aba Versões e resultado de cada estudo."
          />
        </Secao>
      </div>
    </div>
  );
}
