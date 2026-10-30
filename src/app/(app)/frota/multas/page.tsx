import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { passosAbertos, prazoDeIndicacao, pontosEm12Meses, ROTULO_PASSO, ROTULO_RESPONSAVEL, type Passo } from "@/lib/frota/multas";
import { fmtBRL, fmtData, fmtNumero } from "@/lib/controladoria/format";
import { larguraPainel } from "@/lib/ui";
import { exigirPermissao, podeAcao } from "../../_dados";
import { Kpi, Secao, Tabela } from "../../_componentes";
import FormAcao from "../FormAcao";
import { lancarMulta } from "./actions";
import { SeloPasso, SeloPrazo } from "./_multas";
import { checklistDeFechamento, type ItemFechamento } from "@/lib/frota/fechamentoMultas";
import { titulosDeMultaSemMulta } from "@/lib/frota/fechamentoMultasNoBanco";

// MULTAS — o que fazer em cada multa (o próximo passo e o prazo de indicação),
// os motoristas com mais multas e pontos, e as NIC (custo evitável).

export const maxDuration = 60;
const ent = "rounded-md border border-slate-300 px-2 py-1.5 text-sm";
const VISTAS = [
  { chave: "afazer", rotulo: "A fazer" },
  { chave: "fechamento", rotulo: "Fechamento (folha e financeiro)" },
  { chave: "motoristas", rotulo: "Por motorista" },
  { chave: "todas", rotulo: "Todas" },
  { chave: "nic", rotulo: "NIC" },
] as const;
const ORDEM_PRAZO = { perdido: 0, urgente: 1, em_dia: 2, sem_prazo: 3, nao_se_aplica: 4 };

export default async function MultasPage({ searchParams }: { searchParams: Promise<{ vista?: string; passo?: string; q?: string; nova?: string }> }) {
  const sp = await searchParams;
  const session = await exigirPermissao("multas");
  const [podeEditar, veMotorista] = await Promise.all([podeAcao(session, "gerir-multas"), podeAcao(session, "motoristas-documentos")]);
  const hoje = new Date();
  const vista = VISTAS.find((v) => v.chave === sp.vista)?.chave ?? "afazer";
  const multas = await prisma.frotaMulta.findMany({
    where: { companyId: session.companyId },
    include: { condutor: { select: { id: true, nome: true } }, veiculo: { select: { id: true, modelo: true } }, _count: { select: { nics: true } } },
    orderBy: { dataInfracao: "desc" },
  });
  const sugeridos = new Map(
    (await prisma.cadPessoa.findMany({ where: { id: { in: multas.map((m) => m.sugeridoPessoaId).filter((x): x is string => !!x) } }, select: { id: true, nome: true } })).map((p) => [p.id, p.nome])
  );
  const linhas = multas.map((m) => ({ m, passos: passosAbertos(m), prazo: prazoDeIndicacao(m, hoje) }));
  const abertas = linhas.filter((l) => l.m.situacao === "aberta");
  const conta = (p: Passo) => abertas.filter((l) => l.passos.includes(p)).length;
  const anoAtual = hoje.getUTCFullYear();
  const doAno = multas.filter((m) => m.dataInfracao.getUTCFullYear() === anoAtual && m.situacao !== "cancelada");
  const nics = multas.filter((m) => m.ehNic);
  const q = (sp.q ?? "").trim().toUpperCase();
  const condutorDe = (m: (typeof multas)[number]) =>
    m.condutor ? (
      veMotorista ? <Link key="c" href={`/motoristas/${m.condutor.id}`} className="text-blue-800 hover:underline">{m.condutor.nome}</Link> : m.condutor.nome
    ) : m.condutorNome ? (
      <span key="c">{m.condutorNome} <span className="text-[11px] text-amber-700">(sem cadastro)</span></span>
    ) : m.sugeridoPessoaId ? (
      <span key="c" className="text-slate-500">sugerido: {sugeridos.get(m.sugeridoPessoaId)} ({m.sugeridoFonte})</span>
    ) : m.condutorNaoLocalizado ? (
      <span key="c" className="text-orange-700">não localizado</span>
    ) : (
      "—"
    );

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/frota" className="text-xs text-slate-500 hover:text-slate-800">← Frota</Link>
          <h1 className="mt-1 text-xl font-semibold text-slate-900">Multas</h1>
          <p className="mt-1 max-w-4xl text-sm text-slate-500">
            Da consulta de placa ao desconto em folha: quem dirigia (escala e uso do veículo da gestão; sem eles, o diário de bordo), o termo, a indicação do condutor no prazo — perder o prazo gera a NIC —, o pagamento (achado na Omie pelo AIT) e o desconto, que o RH aprova.
          </p>
        </div>
        {podeEditar && !sp.nova && <Link href="/frota/multas?nova=1" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-700">Lançar multa</Link>}
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi rotulo="Abertas" valor={fmtNumero(abertas.length)} apoio={fmtBRL(abertas.reduce((s, l) => s + l.m.valorCents, 0))} />
        <Kpi rotulo="Indicar em até 7 dias" valor={fmtNumero(abertas.filter((l) => l.prazo.situacao === "urgente").length)} tom={abertas.some((l) => l.prazo.situacao === "urgente") ? "atencao" : "bom"} />
        <Kpi rotulo="Prazo perdido" valor={fmtNumero(abertas.filter((l) => l.prazo.situacao === "perdido").length)} tom={abertas.some((l) => l.prazo.situacao === "perdido") ? "ruim" : "bom"} apoio="risco de NIC" />
        <Kpi rotulo="Condutor a identificar" valor={fmtNumero(conta("identificar_condutor") + conta("aguardando_diario") + conta("nao_localizado"))} apoio={`${conta("aguardando_diario")} aguardando diário`} />
        <Kpi rotulo={`Multas em ${anoAtual}`} valor={fmtBRL(doAno.reduce((s, m) => s + m.valorCents, 0))} apoio={`${doAno.length} · descontado ${fmtBRL(doAno.reduce((s, m) => s + (m.descontoValorCents ?? 0), 0))}`} />
        <Kpi rotulo="NIC" valor={fmtBRL(nics.reduce((s, m) => s + m.valorCents, 0))} apoio={`${nics.length} multa(s) por não indicação`} tom={nics.length ? "ruim" : "bom"} />
      </div>

      {podeEditar && sp.nova && (
        <Secao titulo="Lançar multa" descricao="A multa achada na consulta de placa ou na notificação. O agente sugere quem dirigia pela escala e pelo uso do veículo na hora.">
          <FormAcao acao={lancarMulta} rotulo="Lançar" irPara="/frota/multas/{id}" classe="grid gap-3 text-xs md:grid-cols-4">
            <label className="flex flex-col gap-1">Placa<input name="placa" className={ent} /></label>
            <label className="flex flex-col gap-1">AIT<input name="ait" className={ent} /></label>
            <label className="flex flex-col gap-1">Órgão<input name="orgao" placeholder="DER - SP, CET - SP…" className={ent} /></label>
            <label className="flex flex-col gap-1">Infração<input name="especificacao" placeholder="velocidade, rodízio…" className={ent} /></label>
            <label className="flex flex-col gap-1">Data<input type="date" name="data" className={ent} /></label>
            <label className="flex flex-col gap-1">Hora<input name="hora" placeholder="14:35" className={ent} /></label>
            <label className="flex flex-col gap-1">Valor (R$)<input name="valor" inputMode="decimal" className={ent} /></label>
            <label className="flex flex-col gap-1">Pontos<input name="pontos" inputMode="numeric" className={ent} /></label>
            <label className="flex flex-col gap-1">Prazo para indicar o condutor<input type="date" name="prazoIndicacao" className={ent} /></label>
            <label className="flex flex-col gap-1">Código da infração<input name="codigo" className={ent} /></label>
            <label className="flex flex-col gap-1">Achada em
              <select name="origem" defaultValue="consulta" className={ent}><option value="consulta">consulta de placa</option><option value="manual">notificação recebida</option></select>
            </label>
          </FormAcao>
        </Secao>
      )}

      <div className="flex flex-wrap gap-1.5">
        {VISTAS.map((v) => (
          <Link key={v.chave} href={`/frota/multas?vista=${v.chave}`} className={`rounded-full px-3 py-1 text-xs font-medium ${v.chave === vista ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            {v.rotulo}
          </Link>
        ))}
      </div>

      {vista === "afazer" && (
        <Secao
          titulo="A fazer"
          descricao="As abertas, pelo prazo de indicação. O passo mostrado é o primeiro que falta."
          acao={
            <div className="flex flex-wrap gap-1">
              {(["identificar_condutor", "aguardando_diario", "colher_termo", "indicar_condutor", "pagar", "descontar"] as Passo[]).map((p) => (
                <Link key={p} href={`/frota/multas?vista=afazer${sp.passo === p ? "" : `&passo=${p}`}`} className={`rounded-full px-2 py-0.5 text-[11px] ${sp.passo === p ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>
                  {ROTULO_PASSO[p]} ({conta(p)})
                </Link>
              ))}
            </div>
          }
        >
          <Tabela
            colunas={["Infração", "Placa", "AIT", "O quê", "Valor", "Condutor", "Próximo passo", "Prazo de indicação"]}
            alinharDireita={[4]}
            linhas={abertas
              .filter((l) => !sp.passo || l.passos.includes(sp.passo as Passo))
              .sort((a, b) => ORDEM_PRAZO[a.prazo.situacao] - ORDEM_PRAZO[b.prazo.situacao] || (a.m.prazoIndicacao?.getTime() ?? 0) - (b.m.prazoIndicacao?.getTime() ?? 0))
              .map(({ m, passos, prazo }) => [
                fmtData(m.dataInfracao),
                <span key="p" className="font-mono">{m.placa}</span>,
                <Link key="a" href={`/frota/multas/${m.id}`} className="font-mono text-blue-800 hover:underline">{m.ait}</Link>,
                <span key="o" className="text-xs">{m.especificacao} · {m.orgao}</span>,
                fmtBRL(m.valorCents),
                condutorDe(m),
                <SeloPasso key="s" passo={passos[0]} />,
                <span key="z" className="flex flex-col gap-0.5 text-xs">{m.prazoIndicacao ? fmtData(m.prazoIndicacao) : ""}<SeloPrazo situacao={prazo.situacao} dias={prazo.dias} /></span>,
              ])}
            vazio="Nada a fazer."
          />
        </Secao>
      )}

      {vista === "fechamento" && <Fechamento multas={multas} companyId={session.companyId} hoje={hoje} />}

      {vista === "motoristas" && <PorMotorista multas={multas} hoje={hoje} comLink={veMotorista} />}

      {(vista === "todas" || vista === "nic") && (
        <Secao
          titulo={vista === "nic" ? "NIC — multas por não indicação do condutor" : "Todas as multas"}
          acao={
            vista === "todas" ? (
              <form action="/frota/multas" className="flex gap-2 text-xs">
                <input type="hidden" name="vista" value="todas" />
                <input name="q" defaultValue={sp.q ?? ""} placeholder="Placa, AIT ou condutor" className="w-48 rounded-md border border-slate-300 px-2 py-1" />
                <button className="rounded-md bg-slate-900 px-2 py-1 font-semibold text-white">Buscar</button>
              </form>
            ) : undefined
          }
        >
          <Tabela
            colunas={["Infração", "Placa", "AIT", "O quê", "Valor", "Condutor", "Quem paga", "Situação"]}
            alinharDireita={[4]}
            linhas={linhas
              .filter(({ m }) => (vista === "nic" ? m.ehNic : true))
              .filter(({ m }) => !q || m.placa.includes(q) || m.ait.includes(q) || (m.condutor?.nome ?? m.condutorNome ?? "").toUpperCase().includes(q))
              .slice(0, 400)
              .map(({ m, passos }) => [
                fmtData(m.dataInfracao),
                <span key="p" className="font-mono">{m.placa}</span>,
                <Link key="a" href={`/frota/multas/${m.id}`} className="font-mono text-blue-800 hover:underline">{m.ait}</Link>,
                <span key="o" className="text-xs">{m.especificacao} · {m.orgao}</span>,
                fmtBRL(m.valorCents),
                condutorDe(m),
                ROTULO_RESPONSAVEL[m.responsavel] ?? m.responsavel,
                m.situacao === "aberta" ? <SeloPasso key="s" passo={passos[0]} /> : <span key="s" className="text-xs text-slate-500">{m.situacao}</span>,
              ])}
            vazio={vista === "nic" ? "Nenhuma NIC — bom sinal." : "Nenhuma multa lançada. Migre a planilha em Configurações › Migração das planilhas."}
          />
        </Secao>
      )}
    </div>
  );
}

function PorMotorista({ multas, hoje, comLink }: { comLink: boolean; multas: { condutor: { id: string; nome: string } | null; condutorPessoaId: string | null; dataInfracao: Date; pontos: number | null; situacao: string; responsavel: string; ehNic: boolean; valorCents: number; descontoValorCents: number | null; termoAssinadoEm: Date | null; descontoCompetencia: Date | null }[]; hoje: Date }) {
  const pessoas = new Map<string, string>();
  for (const m of multas) if (m.condutor) pessoas.set(m.condutor.id, m.condutor.nome);
  const desde = hoje.getTime() - 365 * 86_400_000;
  const linhas = [...pessoas.entries()]
    .map(([id, nome]) => {
      const minhas = multas.filter((m) => m.condutorPessoaId === id && m.situacao !== "cancelada" && !m.ehNic);
      const ano = minhas.filter((m) => m.dataInfracao.getTime() > desde);
      return { id, nome, ano: ano.length, valor: ano.reduce((s, m) => s + m.valorCents, 0), pontos: pontosEm12Meses(multas, id, hoje), descontado: ano.reduce((s, m) => s + (m.descontoValorCents ?? 0), 0), aDescontar: minhas.filter((m) => m.responsavel === "motorista" && m.termoAssinadoEm && !m.descontoCompetencia).length };
    })
    .filter((l) => l.ano > 0)
    .sort((a, b) => b.pontos.pontos - a.pontos.pontos || b.ano - a.ano);
  return (
    <Secao titulo="Por motorista (12 meses)" descricao="Pontos das multas não assumidas pela empresa. Motorista com EAR suspende com 40 pontos; o aviso começa em 30 e aparece também na aptidão para a escala.">
      <Tabela
        colunas={["Motorista", "Multas", "Valor", "Pontos", "Descontado", "A descontar"]}
        alinharDireita={[1, 2, 3, 4, 5]}
        linhas={linhas.map((l) => [
          comLink ? <Link key="n" href={`/motoristas/${l.id}`} className="text-blue-800 hover:underline">{l.nome}</Link> : l.nome,
          fmtNumero(l.ano),
          fmtBRL(l.valor),
          <span key="p" className={l.pontos.pontos >= 30 ? "font-semibold text-red-700" : ""}>{l.pontos.pontos}{l.pontos.semPontos ? ` (+${l.pontos.semPontos} sem pontos lançados)` : ""}</span>,
          fmtBRL(l.descontado),
          l.aDescontar ? fmtNumero(l.aDescontar) : "—",
        ])}
        vazio="Nenhuma multa com condutor do cadastro nos últimos 12 meses."
      />
    </Secao>
  );
}

const MARCA = (i: ItemFechamento) => (i.ok === null ? <span key={i.chave} className="text-xs text-slate-400" title={i.detalhe}>—</span> : i.ok ? <span key={i.chave} className="text-xs font-semibold text-emerald-700" title={i.detalhe}>✓</span> : <span key={i.chave} className="text-xs font-semibold text-red-700">✗ {i.detalhe}</span>);

// O FECHAMENTO: cada multa só fecha com condutor, indicação, pagamento
// (conferido na Omie) e desconto (conferido na folha). Mais os títulos de
// multa que o Financeiro pagou e o processo não conhece.
async function Fechamento({ multas, companyId, hoje }: { multas: (Parameters<typeof checklistDeFechamento>[0] & { id: string; ait: string; placa: string; dataInfracao: Date; valorCents: number; _count: { nics: number } })[]; companyId: string; hoje: Date }) {
  const ano = multas.filter((m) => m.dataInfracao.getUTCFullYear() === hoje.getUTCFullYear());
  const linhas = multas.map((m) => ({ m, itens: checklistDeFechamento({ ...m, temNic: m._count.nics > 0 }) }));
  const fechadas = linhas.filter((l) => l.itens.every((i) => i.ok !== false));
  const abertas = linhas.filter((l) => l.m.situacao === "aberta" && l.itens.some((i) => i.ok === false));
  // Finalizadas sem os quatro conferidos: o histórico da planilha (ou fechada
  // à mão). Confere-se subindo as folhas daqueles meses e com a Omie.
  const legado = linhas.filter((l) => l.m.situacao === "finalizada" && l.itens.some((i) => i.ok === false));
  const falta = (c: ItemFechamento["chave"]) => abertas.filter((l) => l.itens.find((i) => i.chave === c)?.ok === false).length;
  const semMulta = await titulosDeMultaSemMulta(companyId, new Date(hoje.getTime() - 400 * 86_400_000));
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi rotulo="Fechadas 100%" valor={`${fechadas.length} de ${multas.length}`} apoio={multas.length ? `${Math.round((fechadas.length / multas.length) * 100)}%` : ""} tom={abertas.length ? "atencao" : "bom"} />
        <Kpi rotulo="Falta o condutor" valor={fmtNumero(falta("condutor"))} apoio={legado.length ? `${legado.length} finalizada(s) sem conferência` : "nas abertas"} />
        <Kpi rotulo="Falta a indicação" valor={fmtNumero(falta("indicacao"))} />
        <Kpi rotulo="Pagamento não conferido" valor={fmtNumero(falta("pagamento"))} apoio="sem título pago na Omie" />
        <Kpi rotulo="Desconto não conferido" valor={fmtNumero(falta("desconto"))} apoio="sem desconto na folha" />
        <Kpi rotulo="Pagos sem multa" valor={fmtNumero(semMulta.length)} apoio={fmtBRL(semMulta.reduce((s, t) => s + t.valorDocumentoCents, 0))} tom={semMulta.length ? "ruim" : "bom"} />
      </div>
      <Secao
        titulo="O que falta para fechar"
        descricao={`Cada multa fecha quando os quatro estão resolvidos; o agente diário finaliza sozinho. ${ano.length} multa(s) neste ano.`}
        acao={<Link href="/frota/multas/folha" className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">Desconto em folha</Link>}
      >
        <Tabela
          colunas={["AIT", "Placa", "Infração", "Valor", "Condutor", "Indicação", "Pagamento", "Desconto"]}
          alinharDireita={[3]}
          linhas={abertas.slice(0, 300).map(({ m, itens }) => [
            <Link key="a" href={`/frota/multas/${m.id}`} className="font-mono text-blue-800 hover:underline">{m.ait}</Link>,
            <span key="p" className="font-mono">{m.placa}</span>,
            fmtData(m.dataInfracao),
            fmtBRL(m.valorCents),
            ...itens.map(MARCA),
          ])}
          vazio="Todas as multas estão fechadas."
        />
      </Secao>
      {legado.length > 0 && (
        <Secao titulo={`Finalizadas sem conferência completa (${legado.length})`} descricao="Vieram finalizadas da planilha (ou foram fechadas à mão) sem pagamento conferido na Omie ou desconto conferido na folha. O agente liga os títulos pelo AIT; para os descontos, suba a folha processada daqueles meses em Desconto em folha.">
          <Tabela
            colunas={["AIT", "Placa", "Infração", "Valor", "Condutor", "Indicação", "Pagamento", "Desconto"]}
            alinharDireita={[3]}
            linhas={legado.slice(0, 200).map(({ m, itens }) => [
              <Link key="a" href={`/frota/multas/${m.id}`} className="font-mono text-blue-800 hover:underline">{m.ait}</Link>,
              <span key="p" className="font-mono">{m.placa}</span>,
              fmtData(m.dataInfracao),
              fmtBRL(m.valorCents),
              ...itens.map(MARCA),
            ])}
          />
        </Secao>
      )}
      <Secao titulo="Pagamentos de multa na Omie sem multa no sistema" descricao="Títulos a pagar da categoria de multas que nenhuma multa explica: lance a multa ou ligue o título na ficha dela (passo Pagamento).">
        <Tabela
          colunas={["Vencimento", "Empresa", "Documento", "Favorecido", "Valor", "Pago"]}
          alinharDireita={[4, 5]}
          linhas={semMulta.slice(0, 200).map((t) => [fmtData(t.dataVencimento), t.conexaoApelido, t.numeroDocumento ?? "—", t.parceiroNome ?? "—", fmtBRL(t.valorDocumentoCents), t.valorPagoCents ? fmtBRL(t.valorPagoCents) : "—"])}
          vazio="Nenhum — todo pagamento de multa tem a multa no sistema."
        />
      </Secao>
    </>
  );
}
