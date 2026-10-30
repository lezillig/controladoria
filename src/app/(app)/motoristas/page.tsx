import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { alertaDoDocumentoPessoa, TIPO_DOCUMENTO_PESSOA, TIPOS_DOCUMENTO_PESSOA } from "@/lib/pessoas/documentos";
import { listarMotoristas } from "@/lib/pessoas/pessoasNoBanco";
import type { Alerta } from "@/lib/frota/documentos";
import { fmtData, fmtNumero } from "@/lib/controladoria/format";
import { larguraPainel } from "@/lib/ui";
import { exigirPermissao, podeAcao } from "../_dados";
import { Kpi, Secao, Tabela } from "../_componentes";
import { SeloAlerta } from "../frota/_frota";
import FormAcao from "../frota/FormAcao";
import { salvarEmailsPessoas } from "./actions";
import { SeloAptidao, SeloPeriodo } from "./_motoristas";

// MOTORISTAS — quem pode entrar na escala hoje e por quê (todos que têm a
// tela veem: a Operação vê o apto/não apto e o motivo); os documentos por
// prazo e as férias (só quem tem "motoristas-documentos": RH e Diretoria).

export const maxDuration = 60;

const VISTAS = [
  { chave: "escala", rotulo: "Aptidão para a escala" },
  { chave: "documentos", rotulo: "Documentos por prazo" },
  { chave: "ferias", rotulo: "Férias" },
] as const;
const JANELAS: { chave: string; rotulo: string; alertas: Alerta[] }[] = [
  { chave: "vencidos", rotulo: "Vencidos", alertas: ["vencido"] },
  { chave: "30", rotulo: "Até 30 dias", alertas: ["7", "30"] },
  { chave: "60", rotulo: "31 a 60 dias", alertas: ["60"] },
  { chave: "sem_data", rotulo: "Sem data", alertas: ["sem_data"] },
];
const ORDEM_APTIDAO = ["nao_apto", "incompleto", "apto", "nao_se_aplica"];

export default async function MotoristasPage({ searchParams }: { searchParams: Promise<{ vista?: string; situacao?: string; q?: string; janela?: string }> }) {
  const sp = await searchParams;
  const session = await exigirPermissao("motoristas");
  const [veDocs, podeEditar] = await Promise.all([podeAcao(session, "motoristas-documentos"), podeAcao(session, "gerir-motoristas")]);
  const hoje = new Date();
  const vista = veDocs ? (VISTAS.find((v) => v.chave === sp.vista)?.chave ?? "escala") : "escala";
  const { linhas, controleDesde } = await listarMotoristas(session.companyId, hoje);
  const q = (sp.q ?? "").trim().toLowerCase();
  const conta = (s: string) => linhas.filter((l) => l.aptidao.situacao === s).length;
  const deFerias = linhas.filter((l) => l.resumoFerias.deFeriasAte).length;
  const feriasVencidas = linhas.filter((l) => l.resumoFerias.vencidos > 0).length;
  const feriasLimite60 = linhas.filter((l) => l.resumoFerias.limite && l.resumoFerias.limite.situacao === "a_gozar" && l.resumoFerias.limite.dias <= 60).length;
  const href = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, x] of Object.entries({ vista, ...extra })) if (x) p.set(k, x);
    return `/motoristas?${p}`;
  };
  const nome = (l: (typeof linhas)[number]) => (veDocs ? <Link key="n" href={`/motoristas/${l.id}`} className="font-medium text-blue-800 hover:underline">{l.nome}</Link> : <span key="n" className="font-medium text-slate-800">{l.nome}</span>);
  const emails = podeEditar ? ((await prisma.controladoriaConfig.findUnique({ where: { companyId: session.companyId }, select: { emailsPessoas: true } }))?.emailsPessoas ?? "") : "";

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Motoristas</h1>
        <p className="mt-1 max-w-4xl text-sm text-slate-500">
          Quem pode entrar na escala hoje: documento exigido vencido, CNH sem a categoria ou sem EAR, ou férias tiram da escala. O agente diário traz as férias do ponto, abre pendência para o RH e confere a escala da gestão dos próximos 7 dias.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi rotulo="Motoristas e monitores" valor={fmtNumero(linhas.length)} apoio="ativos" />
        <Kpi rotulo="Aptos" valor={fmtNumero(conta("apto"))} tom="bom" />
        <Kpi rotulo="Não aptos" valor={fmtNumero(conta("nao_apto"))} tom={conta("nao_apto") ? "ruim" : "bom"} />
        <Kpi rotulo="Documentos a lançar" valor={fmtNumero(conta("incompleto"))} tom={conta("incompleto") ? "atencao" : "bom"} apoio="sem registro de documento exigido" />
        <Kpi rotulo="De férias hoje" valor={fmtNumero(deFerias)} />
        {veDocs ? <Kpi rotulo="Férias vencidas" valor={fmtNumero(feriasVencidas)} tom={feriasVencidas ? "ruim" : "bom"} apoio={`${feriasLimite60} com limite em 60 dias`} /> : <Kpi rotulo="Situação" valor={fmtData(hoje)} apoio="aptidão de hoje" />}
      </div>

      {veDocs && (
        <div className="flex flex-wrap gap-1.5">
          {VISTAS.map((v) => (
            <Link key={v.chave} href={`/motoristas?vista=${v.chave}`} className={`rounded-full px-3 py-1 text-xs font-medium ${v.chave === vista ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
              {v.rotulo}
            </Link>
          ))}
        </div>
      )}

      {vista === "escala" && (
        <Secao
          titulo="Aptidão para a escala"
          descricao="Hoje. Não apto: algo trava (documento vencido, CNH, férias). Documentos a lançar: falta registrar documento exigido — nada vencido, mas o sistema ainda não consegue garantir."
          acao={
            <form action="/motoristas" className="flex gap-2 text-xs">
              <input type="hidden" name="vista" value="escala" />
              <select name="situacao" defaultValue={sp.situacao ?? ""} className="rounded-md border border-slate-300 px-2 py-1">
                <option value="">todas as situações</option>
                <option value="nao_apto">não aptos</option>
                <option value="incompleto">documentos a lançar</option>
                <option value="apto">aptos</option>
              </select>
              <input name="q" defaultValue={sp.q ?? ""} placeholder="Nome" className="w-40 rounded-md border border-slate-300 px-2 py-1" />
              <button className="rounded-md bg-slate-900 px-2 py-1 font-semibold text-white">Filtrar</button>
            </form>
          }
        >
          <Tabela
            colunas={["Nome", "Função", "Situação", "Motivo", "Atenção"]}
            linhas={linhas
              .filter((l) => (!sp.situacao || l.aptidao.situacao === sp.situacao) && (!q || l.nome.toLowerCase().includes(q)))
              .sort((a, b) => ORDEM_APTIDAO.indexOf(a.aptidao.situacao) - ORDEM_APTIDAO.indexOf(b.aptidao.situacao) || a.nome.localeCompare(b.nome, "pt-BR"))
              .map((l) => [
                nome(l),
                l.cargo === "monitor" ? "monitor(a)" : `motorista${l.transportaEscolar ? " · escolar" : ""}`,
                <SeloAptidao key="s" situacao={l.aptidao.situacao} />,
                <span key="m" className="text-xs text-slate-700">{l.aptidao.bloqueios.join("; ") || (l.aptidao.faltando.length ? `lançar: ${l.aptidao.faltando.join(", ")}` : "—")}</span>,
                <span key="a" className="text-xs text-amber-800">{l.aptidao.avisos.join("; ")}</span>,
              ])}
            vazio="Nenhum motorista nesta situação."
          />
        </Secao>
      )}

      {vista === "documentos" && veDocs && <Documentos linhas={linhas} hoje={hoje} janela={sp.janela} href={href} />}

      {vista === "ferias" && veDocs && (
        <Secao
          titulo="Férias"
          descricao={`Pelos períodos aquisitivo e concessivo desde a admissão, com as férias do ponto (gestão) e as lançadas pelo RH. ${controleDesde ? `O controle começa em ${fmtData(controleDesde)}, o primeiro registro de férias: período anterior não é cobrado, e o que atravessa essa data fica "a conferir".` : "Ainda não há férias registradas: só os prazos a partir de hoje valem."}`}
        >
          <Tabela
            colunas={["Nome", "Admissão", "Situação", "Saldo", "Começar até", "Próximas férias", "De férias até"]}
            alinharDireita={[3]}
            linhas={linhas
              .filter((l) => l.dataAdmissao)
              .map((l) => ({ l, r: l.resumoFerias, peso: l.resumoFerias.vencidos ? 0 : l.resumoFerias.limite ? 1 + l.resumoFerias.limite.dias / 1000 : 9 }))
              .sort((a, b) => a.peso - b.peso || a.l.nome.localeCompare(b.l.nome, "pt-BR"))
              .map(({ l, r }) => [
                nome(l),
                fmtData(l.dataAdmissao),
                r.vencidos ? <SeloPeriodo key="s" situacao="vencido" /> : r.limite ? <SeloPeriodo key="s" situacao={r.limite.situacao} /> : <SeloPeriodo key="s" situacao="em_aquisicao" />,
                r.vencidos ? `${r.saldoVencidoDias} dias vencidos` : r.limite ? `${r.limite.saldo} dias` : "—",
                r.limite ? <span key="l" className={r.limite.dias <= 30 ? "font-semibold text-red-700" : r.limite.dias <= 60 ? "font-semibold text-amber-700" : ""}>{fmtData(r.limite.inicioAte)}</span> : "—",
                r.proximas ? fmtData(r.proximas) : "—",
                r.deFeriasAte ? fmtData(r.deFeriasAte) : "—",
              ])}
            vazio="Nenhum motorista com admissão cadastrada."
          />
          {linhas.some((l) => !l.dataAdmissao) && <p className="mt-2 text-xs text-amber-700">{linhas.filter((l) => !l.dataAdmissao).length} sem admissão no cadastro: sem ela não há como contar as férias. O agente completa pela lista de ativos da folha; o RH pode lançar na ficha.</p>}
        </Secao>
      )}

      {podeEditar && (
        <Secao titulo="Quem recebe os avisos" descricao="E-mail quando um documento chega a 60, 30 ou 7 dias do vencimento ou vence, e quando o limite para começar as férias chega a 60, 30 ou 7 dias. Separe os endereços por vírgula.">
          <FormAcao acao={salvarEmailsPessoas} rotulo="Salvar destinatários" classe="text-xs">
            <input name="emails" defaultValue={emails} placeholder="rh@empresa.com.br" className="w-full rounded-md border border-slate-300 px-2 py-1.5" />
          </FormAcao>
        </Secao>
      )}
    </div>
  );
}

function Documentos({ linhas, hoje, janela: janelaParam, href }: { linhas: Awaited<ReturnType<typeof listarMotoristas>>["linhas"]; hoje: Date; janela?: string; href: (x: Record<string, string | undefined>) => string }) {
  const docs = linhas.flatMap((l) => l.documentos.map((d) => ({ l, d, alerta: alertaDoDocumentoPessoa(d, hoje) })));
  const janela = JANELAS.find((j) => j.chave === janelaParam) ?? JANELAS[0];
  const conta = (alertas: Alerta[]) => docs.filter((x) => alertas.includes(x.alerta)).length;
  const lista = docs.filter((x) => janela.alertas.includes(x.alerta)).sort((a, b) => (a.d.validade?.getTime() ?? 0) - (b.d.validade?.getTime() ?? 0));
  const cobertura = TIPOS_DOCUMENTO_PESSOA.filter((t) => ["cnh", "curso_coletivo", "toxicologico", "aso"].includes(t.chave)).map((t) => ({
    t,
    lancados: linhas.filter((l) => l.cargo === "motorista" && l.documentos.some((d) => d.tipo === t.chave)).length,
  }));
  const motoristas = linhas.filter((l) => l.cargo === "motorista").length;
  return (
    <Secao titulo="Documentos por prazo" descricao="Os documentos lançados dos motoristas e monitores ativos, pela validade.">
      <div className="mb-3 flex flex-wrap gap-1.5">
        {JANELAS.map((j) => (
          <Link key={j.chave} href={href({ janela: j.chave })} className={`rounded-full px-3 py-1 text-xs font-medium ${j.chave === janela.chave ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            {j.rotulo} ({conta(j.alertas)})
          </Link>
        ))}
      </div>
      <Tabela
        colunas={["Nome", "Documento", "Validade", "Categoria", "Situação"]}
        linhas={lista.map(({ l, d, alerta }) => [
          <Link key="n" href={`/motoristas/${l.id}`} className="font-medium text-blue-800 hover:underline">{l.nome}</Link>,
          TIPO_DOCUMENTO_PESSOA.get(d.tipo)?.rotulo ?? d.tipo,
          d.validade ? fmtData(d.validade) : "—",
          d.tipo === "cnh" ? `${d.categoria ?? "—"}${d.ear === true ? " · EAR" : d.ear === false ? " · sem EAR" : ""}` : "—",
          <SeloAlerta key="s" alerta={alerta} />,
        ])}
        vazio="Nada nesta janela."
      />
      <p className="mt-3 text-xs text-slate-500">
        Lançados, dos {motoristas} motoristas: {cobertura.map((c) => `${c.t.curto} ${c.lancados}`).join(" · ")}.
      </p>
    </Secao>
  );
}
