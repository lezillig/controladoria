import Link from "next/link";
import { GRUPOS_DE_ENTRADA, GRUPOS_DE_SAIDA, type MesDeCaixa } from "@/lib/controladoria/caixaMensal";
import { caixaMensalNoBanco } from "@/lib/controladoria/caixaMensalNoBanco";
import { DESCRICAO_REGRA, type Achado, type Beneficiario, type MovimentoDaConta } from "@/lib/controladoria/auditoriaDeConta";
import { auditoriaDeContaNoBanco, contasCorrentes, pagamentosAoNome } from "@/lib/controladoria/auditoriaDeContaNoBanco";
import { fmtBRL, fmtData, fmtNumero, fmtPercent } from "@/lib/controladoria/format";
import { badgeClass, larguraPainel } from "@/lib/ui";
import { escopoDaPagina, podeAcao } from "../_dados";
import { Kpi, Secao, Tabela } from "../_componentes";

// CAIXA MÊS A MÊS — o passo a passo da análise mensal do caixa:
//   1. saldo inicial (o final do mês anterior);
//   2. entradas realizadas (extrato) × previstas (títulos a receber do mês);
//   3. saídas por tipo — variáveis, pessoal, fixos, impostos, financeiras… —
//      realizadas × previstas (títulos a pagar do mês);
//   4. geração de caixa = entradas − saídas;
//   5. saldo final = inicial + geração, que vira o inicial do mês seguinte.
// E os indicadores: análise horizontal (variação contra o mês anterior),
// margem de caixa (sobra ÷ entradas) e previsto × realizado.
//
// Com UMA CONTA escolhida, a tela abre também a AUDITORIA da conta — feita para
// a Omie.CASH da MCZ, que o dono não acessa: para quem saiu o dinheiro, o que
// não foi para funcionário da Azul ou da MCZ, e as checagens de fraude. E a
// busca por nome varre todas as contas das duas empresas.

// Doze meses de extrato das duas empresas, mais a auditoria da conta: com folga
// acima do limite padrão da hospedagem.
export const maxDuration = 60;

const OPCOES_MESES = [6, 12, 24];
const reais = (cents: number) => (Math.round(cents / 100) === 0 ? "—" : fmtBRL(Math.round(cents / 100) * 100).replace(/,00$/, ""));
const pct = (v: number | null) => (v === null ? "—" : fmtPercent(v * 100, 0));
const celula = "whitespace-nowrap px-2 py-1.5 text-right tabular-nums";
const NOME_MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotuloMes = (mes: string) => `${NOME_MES[Number(mes.slice(5)) - 1]}/${mes.slice(2, 4)}`;
const corGravidade = { alta: "bg-red-100 text-red-800", média: "bg-amber-100 text-amber-800", baixa: "bg-slate-100 text-slate-700" } as const;

export default async function CaixaMensalPage({
  searchParams,
}: {
  searchParams: Promise<{ empresa?: string; conta?: string; meses?: string; busca?: string }>;
}) {
  const params = await searchParams;
  const { session, escopo, conexoes } = await escopoDaPagina("fluxo-caixa", params.empresa);
  const podeAuditar = await podeAcao(session, "auditoria");
  const { contas, padrao } = await contasCorrentes(session.companyId);

  // A conta vem como "conexão:código"; com ela, a empresa é a da conta.
  const [contaConexao, contaCodigo] = (params.conta ?? "").split(":");
  const conta = contas.find((c) => c.conexaoId === contaConexao && c.codigo === contaCodigo) ?? null;
  const conexaoId = conta?.conexaoId ?? escopo.conexaoId;
  const meses = OPCOES_MESES.includes(Number(params.meses)) ? Number(params.meses) : 12;

  // Do primeiro dia de (n−1) meses atrás até hoje: o mês corrente entra, em formação.
  const hoje = new Date();
  const desde = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - (meses - 1), 1));
  const ate = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate(), 23, 59, 59));
  const mesCorrente = `${hoje.getUTCFullYear()}-${String(hoje.getUTCMonth() + 1).padStart(2, "0")}`;

  const busca = (params.busca ?? "").trim();
  const [caixa, auditoria, pagamentos] = await Promise.all([
    caixaMensalNoBanco({ companyId: session.companyId, conexaoId, contaCodigo: conta?.codigo ?? null, desde, ate }),
    conta && podeAuditar ? auditoriaDeContaNoBanco({ companyId: session.companyId, conexaoId: conta.conexaoId, contaCodigo: conta.codigo, desde, ate }) : null,
    busca && podeAuditar ? pagamentosAoNome({ companyId: session.companyId, nome: busca, desde, ate }) : null,
  ]);
  const m = caixa.meses;
  const fechados = m.filter((x) => x.mes !== mesCorrente);
  const total = (f: (x: MesDeCaixa) => number) => m.reduce((a, x) => a + f(x), 0);
  const entradas = total((x) => x.entradasCents);
  const saidas = total((x) => x.saidasCents);
  const geracao = entradas - saidas;
  const ultimo = m[m.length - 1];
  const margemMedia = fechados.length ? fechados.reduce((a, x) => a + (x.margemCaixa ?? 0), 0) / fechados.length : null;
  const mesesNegativos = fechados.filter((x) => x.geracaoCents < 0).length;

  const linkCom = (mudar: Record<string, string | null>) => {
    const q = new URLSearchParams();
    if (params.empresa) q.set("empresa", params.empresa);
    if (params.conta) q.set("conta", params.conta);
    if (meses !== 12) q.set("meses", String(meses));
    if (busca) q.set("busca", busca);
    for (const [k, v] of Object.entries(mudar)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    return `/caixa-mensal${q.toString() ? `?${q}` : ""}`;
  };
  const gruposUsados = (grupos: readonly string[], lado: "entradasPorGrupo" | "saidasPorGrupo") => grupos.filter((g) => m.some((x) => (x[lado][g] ?? 0) !== 0));
  const titulo = conta ? `${conta.conexaoApelido} · ${conta.descricao}` : escopo.apelido ? `${escopo.apelido} · todas as contas` : "Grupo · todas as contas";

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Caixa mês a mês</h1>
        <p className="mt-1 text-sm text-slate-500">
          Saldo inicial, entradas e saídas realizadas (pelo extrato das contas), geração de caixa e saldo final, mês a mês — com o previsto
          (títulos que venciam no mês) ao lado do realizado. {titulo}.
        </p>
      </div>

      <form method="get" action="/caixa-mensal" className="flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col text-xs text-slate-500">
          Empresa
          <select name="empresa" defaultValue={params.empresa ?? ""} className="mt-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800">
            <option value="">Grupo (todas)</option>
            {conexoes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.apelido}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-slate-500">
          Conta
          <select name="conta" defaultValue={conta ? `${conta.conexaoId}:${conta.codigo}` : ""} className="mt-1 max-w-[18rem] rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800">
            <option value="">Todas as contas</option>
            {contas.map((c) => (
              <option key={`${c.conexaoId}:${c.codigo}`} value={`${c.conexaoId}:${c.codigo}`}>
                {c.conexaoApelido} · {c.descricao}
                {c.inativa ? " (inativa)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-slate-500">
          Período
          <select name="meses" defaultValue={String(meses)} className="mt-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800">
            {OPCOES_MESES.map((n) => (
              <option key={n} value={n}>
                últimos {n} meses
              </option>
            ))}
          </select>
        </label>
        {busca && <input type="hidden" name="busca" value={busca} />}
        <button type="submit" className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700">
          Aplicar
        </button>
        {padrao && podeAuditar && !conta && (
          <Link href={linkCom({ conta: `${padrao.conexaoId}:${padrao.codigo}`, empresa: null })} className="ml-auto rounded-md border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-100">
            Auditar a {padrao.descricao} ({padrao.conexaoApelido}) →
          </Link>
        )}
      </form>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <Kpi rotulo="Saldo inicial" valor={reais(m[0]?.saldoInicialCents ?? caixa.saldoInicialCents)} apoio={`em ${fmtData(desde)}`} />
        <Kpi rotulo="Entradas" valor={reais(entradas)} apoio={`${meses} meses`} />
        <Kpi rotulo="Saídas" valor={reais(saidas)} apoio={`${meses} meses`} />
        <Kpi rotulo="Geração de caixa" valor={reais(geracao)} apoio={`${mesesNegativos} mês(es) fechado(s) negativo(s)`} tom={geracao >= 0 ? "bom" : "ruim"} />
        <Kpi rotulo="Saldo final" valor={reais(ultimo?.saldoFinalCents ?? 0)} apoio="hoje, pelo extrato" tom={(ultimo?.saldoFinalCents ?? 0) >= 0 ? "neutro" : "ruim"} />
        <Kpi rotulo="Margem de caixa" valor={pct(margemMedia)} apoio="média dos meses fechados" tom={(margemMedia ?? 0) >= 0 ? "neutro" : "atencao"} />
      </div>

      <Secao
        titulo="Movimentação mês a mês"
        descricao="Realizado pelo extrato. Transferência entre contas fica em linha própria: soma o dinheiro que trocou de conta, e no grupo uma ponta anula a outra. O mês corrente está em formação."
      >
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="sticky left-0 bg-white px-2 py-1.5 text-left font-medium">&nbsp;</th>
                {m.map((x) => (
                  <th key={x.mes} className={`${celula} font-medium ${x.mes === mesCorrente ? "italic text-slate-400" : ""}`}>
                    {rotuloMes(x.mes)}
                    {x.mes === mesCorrente ? "*" : ""}
                  </th>
                ))}
                <th className={`${celula} font-semibold text-slate-700`}>Total</th>
              </tr>
            </thead>
            <tbody>
              <Linha rotulo="Saldo inicial" valores={m.map((x) => x.saldoInicialCents)} forte />
              <Linha rotulo="(+) Entradas" valores={m.map((x) => x.entradasCents)} total={entradas} forte cor="text-emerald-800" />
              {gruposUsados(GRUPOS_DE_ENTRADA, "entradasPorGrupo").map((g) => (
                <Linha key={`e-${g}`} rotulo={g} valores={m.map((x) => x.entradasPorGrupo[g] ?? 0)} recuo />
              ))}
              <Linha rotulo="(−) Saídas" valores={m.map((x) => x.saidasCents)} total={saidas} forte cor="text-red-800" />
              {gruposUsados(GRUPOS_DE_SAIDA, "saidasPorGrupo").map((g) => (
                <Linha key={`s-${g}`} rotulo={g} valores={m.map((x) => x.saidasPorGrupo[g] ?? 0)} recuo />
              ))}
              <Linha rotulo="(=) Geração de caixa" valores={m.map((x) => x.geracaoCents)} total={geracao} forte sinal />
              <Linha rotulo="Saldo final" valores={m.map((x) => x.saldoFinalCents)} forte sinal />
              <tr>
                <td colSpan={m.length + 2} className="pt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Indicadores
                </td>
              </tr>
              <LinhaTexto rotulo="Margem de caixa (geração ÷ entradas)" valores={m.map((x) => pct(x.margemCaixa))} />
              <LinhaTexto rotulo="Entradas × mês anterior" valores={m.map((x) => (x.mes === mesCorrente ? "—" : pct(x.variacaoEntradas)))} />
              <LinhaTexto rotulo="Saídas × mês anterior" valores={m.map((x) => (x.mes === mesCorrente ? "—" : pct(x.variacaoSaidas)))} />
              <tr>
                <td colSpan={m.length + 2} className="pt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Previsto × realizado
                </td>
              </tr>
              <Linha rotulo="A receber previsto (vencendo no mês)" valores={m.map((x) => x.previstoReceberCents)} total={total((x) => x.previstoReceberCents)} />
              <Linha rotulo="Recebido de clientes" valores={m.map((x) => x.entradasPorGrupo["Recebimentos de clientes"] ?? 0)} total={total((x) => x.entradasPorGrupo["Recebimentos de clientes"] ?? 0)} />
              <LinhaTexto rotulo="Realizado ÷ previsto (receber)" valores={m.map((x) => pct(x.realizadoReceber))} />
              <Linha rotulo="A pagar previsto (vencendo no mês)" valores={m.map((x) => x.previstoPagarCents)} total={total((x) => x.previstoPagarCents)} />
              <Linha rotulo="Pago (sem transferências)" valores={m.map((x) => x.saidasCents - (x.saidasPorGrupo["Transferências entre contas"] ?? 0))} total={total((x) => x.saidasCents - (x.saidasPorGrupo["Transferências entre contas"] ?? 0))} />
              <LinhaTexto rotulo="Realizado ÷ previsto (pagar)" valores={m.map((x) => pct(x.realizadoPagar))} />
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          * mês em formação. Saldo inicial = saldo de abertura das contas + todo o extrato antes do período. Grupos pela classificação das
          categorias no DRE (a mesma da tela de Custos e DRE); linha do extrato sem categoria herda a do título que ela baixou.
        </p>
      </Secao>

      {conta && !podeAuditar && <p className="text-sm text-slate-500">A auditoria da conta exige a permissão “Auditoria e achados”.</p>}
      {auditoria && <AuditoriaDaConta a={auditoria} />}

      {podeAuditar && (
        <Secao titulo="Todos os pagamentos a um nome" descricao={`Em todas as contas da Azul e da MCZ, nos últimos ${meses} meses: os títulos a pagar do beneficiário (com de qual conta saiu) e as linhas de extrato que citam o nome.`}>
          <form method="get" action="/caixa-mensal" className="flex flex-wrap gap-2">
            {params.empresa && <input type="hidden" name="empresa" value={params.empresa} />}
            {params.conta && <input type="hidden" name="conta" value={params.conta} />}
            {meses !== 12 && <input type="hidden" name="meses" value={meses} />}
            <input name="busca" defaultValue={busca} placeholder="Nome do beneficiário (mín. 3 letras)" className="w-72 rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
            <button type="submit" className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700">
              Buscar
            </button>
            {busca && (
              <Link href={linkCom({ busca: null })} className="self-center text-xs text-slate-500 hover:underline">
                limpar
              </Link>
            )}
          </form>
          {pagamentos && <PagamentosAoNome p={pagamentos} />}
        </Secao>
      )}
    </div>
  );
}

function Linha({ rotulo, valores, total, forte, recuo, cor, sinal }: { rotulo: string; valores: number[]; total?: number; forte?: boolean; recuo?: boolean; cor?: string; sinal?: boolean }) {
  const corDe = (v: number) => (sinal ? (v < 0 ? "text-red-700" : "text-slate-800") : (cor ?? "text-slate-700"));
  return (
    <tr className={`border-b border-slate-100 ${forte ? "font-semibold" : ""}`}>
      <td className={`sticky left-0 whitespace-nowrap bg-white py-1.5 pr-3 text-left ${recuo ? "pl-5 font-normal text-slate-500" : "pl-2 text-slate-800"}`}>{rotulo}</td>
      {valores.map((v, i) => (
        <td key={i} className={`${celula} ${recuo ? "text-slate-500" : corDe(v)}`}>
          {reais(v)}
        </td>
      ))}
      <td className={`${celula} ${total !== undefined ? corDe(total) : ""}`}>{total !== undefined ? reais(total) : ""}</td>
    </tr>
  );
}

function LinhaTexto({ rotulo, valores }: { rotulo: string; valores: string[] }) {
  return (
    <tr className="border-b border-slate-100">
      <td className="sticky left-0 whitespace-nowrap bg-white py-1.5 pl-2 pr-3 text-left text-slate-600">{rotulo}</td>
      {valores.map((v, i) => (
        <td key={i} className={`${celula} text-slate-600`}>
          {v}
        </td>
      ))}
      <td />
    </tr>
  );
}

function Movimentos({ lista }: { lista: MovimentoDaConta[] }) {
  return (
    <Tabela
      colunas={["Data", "Valor", "Categoria", "Título", "Observação", "Lançado por", "Origem"]}
      alinharDireita={[1]}
      linhas={lista.map((x) => [
        fmtData(x.data),
        fmtBRL(x.valorCents),
        x.categoria ?? "—",
        x.tituloNumero ?? "—",
        <span key="o" className="line-clamp-2 max-w-xs text-xs text-slate-500">
          {x.observacao ?? "—"}
        </span>,
        x.usuario ?? "—",
        x.origem === "extrato" ? "extrato" : "baixa de título",
      ])}
    />
  );
}

function AuditoriaDaConta({ a }: { a: Awaited<ReturnType<typeof auditoriaDeContaNoBanco>> }) {
  const naoFunc = a.naoFuncionarios.filter((b) => b.tipo !== "empresa do grupo");
  const doGrupo = a.naoFuncionarios.filter((b) => b.tipo === "empresa do grupo");
  const funcionarios = a.beneficiarios.filter((b) => b.tipo === "funcionário");
  const altas = a.achados.filter((x) => DESCRICAO_REGRA[x.regra].gravidade === "alta");
  const porRegra = new Map<string, Achado[]>();
  for (const x of a.achados) porRegra.set(x.regra, [...(porRegra.get(x.regra) ?? []), x]);
  const soma = (l: Beneficiario[]) => l.reduce((s, b) => s + b.totalCents, 0);

  return (
    <>
      <div>
        <h2 className="text-lg font-semibold text-slate-900">
          Auditoria da conta — {a.empresa} · {a.conta}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {fmtNumero(a.lancamentos)} lançamentos ({a.temExtrato ? "extrato da conta" : "sem extrato importado: só as baixas de títulos nesta conta"}). Funcionários
          cruzados: {fmtNumero(a.funcionariosConhecidos.cadastro)} do cadastro da gestão (CPF e nome) e {fmtNumero(a.funcionariosConhecidos.quadro)} dos
          quadros de pessoal da Azul e da MCZ (nome).
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi rotulo="Saídas da conta" valor={reais(a.saidasCents)} apoio={`entradas ${reais(a.entradasCents)}`} />
        <Kpi rotulo="Para funcionários" valor={reais(soma(funcionarios))} apoio={`${funcionarios.length} pessoa(s)`} />
        <Kpi rotulo="Para quem não é funcionário" valor={reais(soma(naoFunc))} apoio={`${naoFunc.length} beneficiário(s)`} tom={naoFunc.length ? "atencao" : "bom"} />
        <Kpi rotulo="Achados de gravidade alta" valor={fmtNumero(altas.length)} apoio={`${a.achados.length} achado(s) no total`} tom={altas.length ? "ruim" : "bom"} />
      </div>

      <Secao titulo="Saídas para quem não é funcionário da Azul ou da MCZ" descricao="Por beneficiário, do maior para o menor. Clique para ver cada pagamento. Empresas do grupo ficam em lista à parte, logo abaixo.">
        <ListaDeBeneficiarios lista={naoFunc} />
        {doGrupo.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-medium text-slate-700">
              Para empresas do grupo — {reais(soma(doGrupo))} em {doGrupo.reduce((s, b) => s + b.vezes, 0)} saída(s)
            </summary>
            <div className="mt-2">
              <ListaDeBeneficiarios lista={doGrupo} />
            </div>
          </details>
        )}
      </Secao>

      <Secao titulo="Achados de auditoria" descricao="As checagens rodam sobre todas as saídas do período. Gravidade alta primeiro.">
        {a.achados.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">Nenhum achado.</p>
        ) : (
          <div className="space-y-2">
            {[...porRegra.entries()].map(([regra, lista]) => {
              const d = DESCRICAO_REGRA[regra as keyof typeof DESCRICAO_REGRA];
              return (
                <details key={regra} className="rounded-lg border border-slate-200 p-3">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                    <span className={`${badgeClass} ${corGravidade[d.gravidade]}`}>{d.gravidade}</span>
                    <span className="font-medium text-slate-800">{d.titulo}</span>
                    <span className="text-slate-500">
                      — {lista.length} caso(s), {reais(lista.reduce((s, x) => s + x.valorCents, 0))}
                    </span>
                  </summary>
                  <p className="mt-2 text-xs text-slate-500">{d.porque}</p>
                  <div className="mt-2 space-y-2">
                    {lista.slice(0, 100).map((x, i) => (
                      <details key={i} className="rounded border border-slate-100 px-2 py-1">
                        <summary className="cursor-pointer text-xs text-slate-700">
                          <span className="font-medium">{x.beneficiario}</span> · {fmtBRL(x.valorCents)} · {x.detalhe}
                        </summary>
                        <div className="mt-1">
                          <Movimentos lista={x.movimentos} />
                        </div>
                      </details>
                    ))}
                    {lista.length > 100 && <p className="text-xs text-slate-500">… e mais {lista.length - 100}.</p>}
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </Secao>

      <Secao titulo="Quem lançou as saídas" descricao="Usuário da Omie que incluiu ou alterou por último o título pago. Saída sem título não tem usuário registrado.">
        <Tabela colunas={["Usuário", "Saídas", "Valor"]} alinharDireita={[1, 2]} linhas={a.usuarios.map((u) => [u.usuario, fmtNumero(u.saidas), fmtBRL(u.saidasCents)])} />
      </Secao>
    </>
  );
}

function ListaDeBeneficiarios({ lista }: { lista: Beneficiario[] }) {
  if (lista.length === 0) return <p className="py-4 text-center text-sm text-slate-500">Nenhuma saída.</p>;
  return (
    <div className="divide-y divide-slate-100">
      {lista.map((b) => (
        <details key={b.chave} className="py-2">
          <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 text-sm">
            <span className="font-medium text-slate-800">{b.nome}</span>
            <span className="text-xs text-slate-500">{b.tipo}</span>
            {b.tipo !== "pessoa física" && b.documento && <span className="text-xs text-slate-400">{b.documento}</span>}
            <span className="ml-auto tabular-nums text-slate-800">{fmtBRL(b.totalCents)}</span>
            <span className="w-full text-xs text-slate-500">
              {b.vezes} saída(s), de {fmtData(b.primeira)} a {fmtData(b.ultima)}
              {b.categorias.length ? ` · ${b.categorias.slice(0, 4).join(", ")}${b.categorias.length > 4 ? "…" : ""}` : " · sem categoria"}
            </span>
          </summary>
          <div className="mt-2">
            <Movimentos lista={b.movimentos} />
          </div>
        </details>
      ))}
    </div>
  );
}

function PagamentosAoNome({ p }: { p: Awaited<ReturnType<typeof pagamentosAoNome>> }) {
  if (p.titulos.length === 0 && p.extrato.length === 0) return <p className="mt-4 text-sm text-slate-500">Nada encontrado com esse nome no período.</p>;
  const pago = p.titulos.reduce((s, t) => s + t.valorPagoCents, 0);
  const aberto = p.titulos.reduce((s, t) => s + Math.max(0, t.valorDocumentoCents - t.valorPagoCents), 0);
  const extrato = p.extrato.reduce((s, m) => s - Math.min(0, m.valorCents), 0);
  return (
    <div className="mt-4 space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi rotulo="Pago (títulos)" valor={reais(pago)} apoio={`${p.titulos.length} título(s)`} />
        <Kpi rotulo="Em aberto" valor={reais(aberto)} />
        <Kpi rotulo="Saídas no extrato" valor={reais(extrato)} apoio={`${p.extrato.length} linha(s)`} />
        <Kpi rotulo="Nomes encontrados" valor={fmtNumero(p.nomes.length)} apoio="confira se é a mesma pessoa" tom={p.nomes.length > 1 ? "atencao" : "neutro"} />
      </div>
      {p.titulos.length > 0 && (
        <Tabela
          colunas={["Empresa", "Beneficiário", "Documento", "Categoria", "Vencimento", "Valor", "Pago", "Conta(s)", "Lançado por"]}
          alinharDireita={[5, 6]}
          linhas={p.titulos.map((t) => [
            t.conexaoApelido,
            t.parceiroNome ?? "—",
            t.numeroDocumento ?? "—",
            t.categoriaDescricao ?? "—",
            fmtData(t.dataVencimento),
            fmtBRL(t.valorDocumentoCents),
            fmtBRL(t.valorPagoCents),
            t.contas.join(", ") || "—",
            t.usuarioInclusao ?? "—",
          ])}
        />
      )}
      {p.extrato.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-medium text-slate-700">Linhas de extrato que citam o nome ({p.extrato.length})</summary>
          <div className="mt-2">
            <Tabela
              colunas={["Empresa", "Conta", "Data", "Valor", "Nome no extrato", "Documento", "Observação"]}
              alinharDireita={[3]}
              linhas={p.extrato.map((x) => [x.conexaoApelido, x.conta, fmtData(x.data), fmtBRL(x.valorCents), x.parceiroNome ?? "—", x.documento ?? "—", x.observacao ?? "—"])}
            />
          </div>
        </details>
      )}
    </div>
  );
}
