import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { paraNumero } from "@/lib/simulador/baseDeCustos";
import { CATALOGO_PARAMETROS } from "@/lib/simulador/catalogo";
import { camposEditaveis, CONCEITO_DA_REGRA, padraoDoSimulador, USO_DA_BASE, type TipoTabela } from "@/lib/simulador/edicaoBase";
import { PERFIS_PADRAO, PREMISSAS_PADRAO } from "@/lib/simulador/premissas";
import { CATEGORIA_DO_TIPO, ROTULO_ENERGIA, ROTULO_TIPO_VEICULO, VARIANTE_DO_TIPO } from "@/lib/simulador/tipos";
import { funcaoAdministrativa, funcaoPelaConvencao } from "@/lib/simulador/convencoes";
import { energiaDoPerfil } from "@/lib/simulador/energia";
import { carregarDreDosMeses, despesasPorEmpresaEMes } from "@/lib/simulador/custosReais";
import type { RegraCompetencia } from "@/lib/controladoria/competencia";
import {
  CHAVE_FORNECEDOR_CONTABILIDADE,
  FORNECEDOR_CONTABILIDADE_PADRAO,
  folhaDaOficina,
  foraDaAdministracao,
  indiretosDoDre,
  pagamentosDoFornecedor,
  textosForaDaAdministracao,
  type IndiretoDoDre,
} from "@/lib/simulador/indiretosDoDre";
import { dataReferenciaPadrao } from "@/lib/controladoria/ciclo";
import { larguraPainel, secondaryButtonClass } from "@/lib/ui";
import { exigirPermissao, podeAcao } from "../../_dados";
import { Secao } from "../../_componentes";
import ImportarGabaritoForm from "./ImportarGabaritoForm";
import { ParametrosBase, TabelaRegistrosBase, type ParametroTela, type RegistroTela } from "./EditorBase";

// A BASE DE CUSTOS DO SIMULADOR — o que está valendo hoje, e ajustável.
//
// É daqui que todo estudo novo tira as premissas: diesel, tributos, salário
// por função, valor de cada modelo da frota, pedágios, margens da Azul Mob.
// Cada linha mostra de onde veio e desde quando vale, porque "de onde saiu
// esse número?" é a primeira pergunta de quem confere um orçamento. Ajustar
// aqui grava uma vigência nova, como a importação do Gabarito.
//
// Salário aqui é POR FUNÇÃO (convenção coletiva), nunca por pessoa.

type Linha = Record<string, unknown> & { id: string; vigenciaInicio: Date; fonte: string };

function paraTela(tipo: TipoTabela, linhas: Linha[]): RegistroTela[] {
  const campos = camposEditaveis(tipo);
  return linhas.map((l) => ({
    id: l.id,
    desde: l.vigenciaInicio.toISOString(),
    fonte: l.fonte,
    campos: Object.fromEntries(
      campos.map((c) => {
        const v = l[c.campo];
        return [c.campo, c.tipo === "texto" ? ((v as string | null) ?? null) : c.tipo === "simnao" ? ((v as boolean | null) ?? null) : paraNumero(v)];
      })
    ),
  }));
}

// O DRE dos doze meses é lido duas vezes (regra nova e antiga).
export const maxDuration = 60;

// Reais, sem centavos (os indiretos da base são R$/mês).
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export default async function BaseDeCustosPage() {
  const session = await exigirPermissao("simulador");
  const podeEditar = await podeAcao(session, "gerir-simulador");
  const vigente = { companyId: session.companyId, vigenciaFim: null };
  const [parametros, encerrados, veiculos, funcoes, pedagios] = await Promise.all([
    prisma.simParametro.findMany({ where: vigente }),
    prisma.simParametro.findMany({ where: { companyId: session.companyId, vigenciaFim: { not: null } }, orderBy: { vigenciaFim: "desc" }, take: 500 }),
    prisma.simVeiculoModelo.findMany({ where: vigente, orderBy: [{ tipo: "asc" }, { modelo: "asc" }] }),
    prisma.simFuncao.findMany({ where: vigente, orderBy: [{ funcao: "asc" }] }),
    prisma.simPedagioPraca.findMany({ where: vigente, orderBy: [{ praca: "asc" }] }),
  ]);
  const vazia = parametros.length + veiculos.length + funcoes.length + pedagios.length === 0;
  // Os indiretos do DRE consolidado: o padrão de cada custo indireto que a
  // base não tem digitado (ver indiretosDoDre.ts). Sem o DRE, a tela segue.
  // Os indiretos pelas duas regras de competência (a atual — despesa pelo
  // vencimento — e a antiga, tudo pela emissão), para separar o que mudou por
  // causa da regra do que mudou nos dados; e as despesas por empresa e mês,
  // para ver se falta dado de alguma.
  const referencia = dataReferenciaPadrao();
  const nomeContabilidade = parametros.find((p) => p.chave === CHAVE_FORNECEDOR_CONTABILIDADE)?.texto?.trim() ?? FORNECEDOR_CONTABILIDADE_PADRAO;
  const textos = textosForaDaAdministracao((chave) => parametros.find((p) => p.chave === chave)?.texto);
  const calcular = async (regra: RegraCompetencia) => {
    const dre = await carregarDreDosMeses(session.companyId, null, referencia, regra);
    const [fornecedor, oficina, fora] = await Promise.all([
      pagamentosDoFornecedor(session.companyId, nomeContabilidade, referencia, dre.meses, regra),
      folhaDaOficina(session.companyId, referencia, dre, regra),
      foraDaAdministracao(session.companyId, referencia, dre.meses, textos, regra),
    ]);
    return { dre, indiretos: indiretosDoDre(dre, fornecedor, oficina, fora) };
  };
  let doDre = new Map<string, IndiretoDoDre>();
  let pelaEmissao = new Map<string, IndiretoDoDre>();
  let meses: string[] = [];
  let porEmpresa: Awaited<ReturnType<typeof despesasPorEmpresaEMes>> = [];
  try {
    const [atual, antiga] = await Promise.all([calcular("atual"), calcular("emissao")]);
    doDre = atual.indiretos;
    pelaEmissao = antiga.indiretos;
    meses = atual.dre.meses;
    porEmpresa = await despesasPorEmpresaEMes(session.companyId, meses);
  } catch (e) {
    console.warn("[simulador] base: DRE indisponível para os indiretos", e instanceof Error ? e.message.slice(0, 200) : e);
  }
  const comparacao = [...doDre.entries()].map(([chave, v]) => ({
    rotulo: CATALOGO_PARAMETROS.find((d) => d.chave === chave)?.rotulo ?? chave,
    atual: v.valor,
    antiga: pelaEmissao.get(chave)?.valor ?? null,
  }));
  const atualPorChave = new Map(parametros.map((p) => [p.chave, p]));
  const anteriorPorChave = new Map<string, (typeof encerrados)[number]>();
  for (const e of encerrados) if (!anteriorPorChave.has(e.chave)) anteriorPorChave.set(e.chave, e);

  const telaParametros: ParametroTela[] = CATALOGO_PARAMETROS.map((d) => {
    const a = atualPorChave.get(d.chave);
    const ant = anteriorPorChave.get(d.chave);
    return {
      chave: d.chave,
      entidade: d.entidade,
      rotulo: d.rotulo,
      tipo: d.tipo,
      essencial: d.essencial,
      unidade: a?.unidade ?? USO_DA_BASE[d.chave]?.unidade ?? null,
      atual: a ? { valor: paraNumero(a.valor), texto: a.texto, desde: a.vigenciaInicio.toISOString(), fonte: a.fonte, autor: a.atualizadoPorNome } : null,
      anterior: ant && ant.vigenciaFim ? { valor: paraNumero(ant.valor), texto: ant.texto, ate: ant.vigenciaFim.toISOString() } : null,
      padrao: padraoDoSimulador(d.chave),
      doDre: doDre.get(d.chave) ?? null,
      unidadePadrao: USO_DA_BASE[d.chave]?.unidadePadrao ?? null,
      uso: USO_DA_BASE[d.chave]?.como ?? null,
      conceito: CONCEITO_DA_REGRA[d.chave] ?? null,
    };
  });

  // Os padrões do simulador por tipo de veículo, prontos para trazer à base e
  // ajustar — é o que os estudos usam enquanto a frota não estiver cadastrada.
  const sugestoesVeiculo = PERFIS_PADRAO.map((p) => {
    const v = { ...PREMISSAS_PADRAO.veiculo, ...p.veiculo };
    const va = { ...PREMISSAS_PADRAO.variaveis, ...p.variaveis };
    return {
      rotulo: ROTULO_TIPO_VEICULO[p.tipo],
      campos: {
        tipo: ROTULO_TIPO_VEICULO[p.tipo],
        modelo: p.descricao,
        lotacao: p.lotacao ?? null,
        acessivel: VARIANTE_DO_TIPO[p.tipo] === "ADAPTADO" ? true : null,
        combustivel: ROTULO_ENERGIA[energiaDoPerfil(p)],
        valorCompra: v.valor,
        consumoKmL: va.consumoAsfaltoKmL,
        manutencaoKm: va.manutencaoAsfaltoKm,
        seguroAnual: v.seguroMes * 12,
        ipvaLicenciamentoAnual: v.ipvaLicenciamentoAno,
        licencasAnual: v.laudoVistoriaAno,
        rastreadorMensal: v.rastreadorMes,
        reservaTecnicaPct: PREMISSAS_PADRAO.contrato.reservaTecnicaPct,
      },
    };
  });
  // Salário por CATEGORIA (a van adaptada paga o motorista de van, salvo
  // função própria cadastrada).
  // Cada sugestão já vem com o sindicato do tipo de veículo: TRANSFRETUR para
  // van, micro e ônibus; SINDILOCADESP para carro (ver convencoes.ts).
  const sugestoesFuncao = PERFIS_PADRAO.filter((p) => VARIANTE_DO_TIPO[p.tipo] === "PADRAO").map((p) => {
    const { convencao, campos } = funcaoPelaConvencao(CATEGORIA_DO_TIPO[p.tipo], p.motorista.salario);
    return {
      rotulo: `Motorista de ${ROTULO_TIPO_VEICULO[p.tipo].toLowerCase()} · ${convencao.chave}`,
      campos: { funcao: `Motorista de ${ROTULO_TIPO_VEICULO[p.tipo].toLowerCase()}`, encargosPct: PREMISSAS_PADRAO.pessoal.encargosPct, ...campos },
    };
  });
  const adm = funcaoAdministrativa();
  sugestoesFuncao.push({ rotulo: `Auxiliar administrativo · ${adm.convencao.chave}`, campos: { funcao: "Auxiliar administrativo", encargosPct: PREMISSAS_PADRAO.pessoal.encargosPct, ...adm.campos } });

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/simulador" className="text-xs font-medium text-blue-700 hover:underline">
            ← Simulador
          </Link>
          <h1 className="mt-2 text-xl font-semibold text-slate-900">Custos base</h1>
          <p className="mt-1 max-w-[85ch] text-sm text-slate-500">
            Os custos que todo estudo novo usa como ponto de partida — veja o valor de cada um, de onde veio e para que serve na conta, e ajuste
            aqui mesmo. Ajustar não apaga nada: o valor anterior fica no histórico, e estudos já salvos continuam com a base do dia deles.
          </p>
        </div>
        {/* Download de arquivo (rota de API), não navegação: <Link> pré-carregaria o Excel. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/api/simulador/gabarito" className={secondaryButtonClass}>
          Baixar Gabarito em branco
        </a>
      </div>

      <details className="rounded-xl border border-slate-200 bg-white px-4 py-3" open={vazia}>
        <summary className="cursor-pointer text-sm font-semibold text-slate-900">Como funciona a base de custos</summary>
        <div className="mt-3">
      <div>
        <p className="mb-3 text-sm text-slate-600">É a tabela de custos da Azul Mob que todo estudo novo usa como ponto de partida: preço do diesel, encargos, salário do motorista por função, valor e consumo de cada modelo da frota, pedágios e as margens mínima e alvo da empresa. Ela entra pelo Gabarito, uma planilha Excel com uma aba por assunto.</p>
        <div className="grid gap-4 text-sm text-slate-700 lg:grid-cols-2">
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>
              <strong>Para um ajuste pontual</strong> (o diesel subiu, o dissídio saiu), edite o valor direto nas tabelas desta página e salve.
            </li>
            <li>
              <strong>Baixe o Gabarito em branco</strong> (botão no alto da página).
            </li>
            <li>
              <strong>Preencha</strong> com os números da empresa. Não precisa preencher tudo: o que ficar vazio continua com o padrão do simulador,
              marcado como “estimativa”.
            </li>
            <li>
              <strong>Importe</strong> aqui. Os estudos novos passam a abrir com esses valores, marcados como “base Azul Mob”. Estudos já salvos não
              mudam.
            </li>
            <li>
              Quando um custo mudar (diesel, dissídio), importe de novo: o valor anterior fica guardado com a data em que deixou de valer.
            </li>
          </ol>
          <ul className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-[13px]">
            <li><strong>Frota</strong> — modelos, valor, consumo, manutenção por km, pneus, seguro, IPVA.</li>
            <li><strong>Mão de obra</strong> — piso e benefícios por função (motorista de carro, van, ônibus; monitor). Nunca salário de pessoas.</li>
            <li><strong>Jornada</strong> — horas, motoristas por veículo, km improdutivo, reserva técnica.</li>
            <li><strong>Indiretos</strong> — administração, escritório, sistemas, contabilidade, e o faturamento médio para o rateio.</li>
            <li><strong>Tributos e financeiro</strong> — PIS, COFINS, IRPJ, CSLL, ISS, ICMS, capital de giro, prazos.</li>
            <li><strong>Insumos</strong> — diesel, ARLA, óleo.</li>
            <li><strong>Pedágios</strong> — praças e tarifas por categoria.</li>
            <li><strong>Regras da Azul Mob</strong> — margem mínima e margem alvo.</li>
          </ul>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Outra fonte, sem planilha: na aba Premissas de cada estudo, “Custos reais da Azul Mob” mostra o que a empresa gastou de fato nos últimos
          doze meses (DRE da Omie, cartão de combustível, frota) para você escolher o que usar.
        </p>
      </div>

        </div>
      </details>

      {(comparacao.length > 0 || porEmpresa.length > 0) && (
        <Secao
          titulo="Indiretos: regra nova × regra antiga"
          descricao={`Média mensal dos doze meses fechados (${meses[0] ?? ""} a ${meses[meses.length - 1] ?? ""}). Regra nova: despesa no mês do vencimento (desde 27/10/2026). Regra antiga: tudo pelo mês da emissão/lançamento. A diferença entre as duas é só efeito da regra; buraco de dados aparece na tabela de despesas por empresa logo abaixo.`}
        >
          {comparacao.length === 0 && <p className="text-sm text-slate-500">Sem indiretos calculados do DRE (categorias ainda não classificadas ou sem meses fechados).</p>}
          <div className={`overflow-x-auto ${comparacao.length === 0 ? "hidden" : ""}`}>
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="py-2 pr-3 text-left font-medium">Indireto</th>
                  <th className="px-2 py-2 text-right font-medium">Regra nova (R$/mês)</th>
                  <th className="px-2 py-2 text-right font-medium">Regra antiga (R$/mês)</th>
                  <th className="px-2 py-2 text-right font-medium">Diferença</th>
                </tr>
              </thead>
              <tbody>
                {comparacao.map((c) => {
                  const dif = c.antiga === null ? null : c.atual - c.antiga;
                  return (
                    <tr key={c.rotulo} className="border-b border-slate-100">
                      <td className="py-1.5 pr-3 text-slate-700">{c.rotulo}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{brl(c.atual)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{c.antiga === null ? "—" : brl(c.antiga)}</td>
                      <td className={`px-2 py-1.5 text-right tabular-nums ${dif !== null && dif < 0 ? "text-emerald-700" : dif ? "text-red-700" : ""}`}>
                        {dif === null ? "—" : `${brl(dif)}${c.antiga ? ` (${((dif / c.antiga) * 100).toFixed(1).replace(".", ",")}%)` : ""}`}
                      </td>
                    </tr>
                  );
                })}
                <tr className="font-semibold">
                  <td className="py-1.5 pr-3">Total</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{brl(comparacao.reduce((a, c) => a + c.atual, 0))}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{brl(comparacao.reduce((a, c) => a + (c.antiga ?? 0), 0))}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{brl(comparacao.reduce((a, c) => a + c.atual - (c.antiga ?? c.atual), 0))}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {porEmpresa.length > 0 && (
            <div className="mt-5 overflow-x-auto">
              <p className="mb-2 text-sm font-medium text-slate-700">Despesas (títulos a pagar) por empresa e mês — regra nova</p>
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-1.5 pr-3 text-left font-medium">Empresa</th>
                    {meses.map((m) => (
                      <th key={m} className="px-2 py-1.5 text-right font-medium">
                        {m.slice(5)}/{m.slice(2, 4)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {porEmpresa.map((e) => {
                    const valores = e.porMes.map((x) => x.cents).filter((v) => v > 0).sort((a, b) => a - b);
                    const mediana = valores.length ? valores[Math.floor(valores.length / 2)] : 0;
                    return (
                      <tr key={e.empresa} className="border-b border-slate-100">
                        <td className="py-1.5 pr-3 font-medium text-slate-700">{e.empresa}</td>
                        {e.porMes.map((x, i) => (
                          <td key={i} className={`px-2 py-1.5 text-right tabular-nums ${mediana > 0 && x.cents < mediana * 0.5 ? "bg-red-50 font-semibold text-red-700" : "text-slate-700"}`} title={`${x.titulos} título(s)`}>
                            {brl(x.cents / 100)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-slate-500">Em vermelho, mês com menos da metade da mediana da empresa: provável falta de dado (sincronização), não economia.</p>
            </div>
          )}
        </Secao>
      )}

      <Secao titulo="Parâmetros" descricao="Diesel, tributos, prazos, jornada, administração e margens. “Estimativa” é o padrão do simulador enquanto a empresa não informa o seu número.">
        <p className="mb-3 text-sm text-slate-600">
          De onde sai a administração central (folha corporativa, contabilidade, sistemas, sede, oficina, despesas gerais) e o % que o estudo aplica:{" "}
          {/* Download de arquivo (rota de API), não navegação: <Link> pré-carregaria o Excel. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/api/simulador/indiretos" className="font-medium text-blue-700 hover:underline">
            baixar a composição em Excel
          </a>{" "}
          — cada categoria do Omie mês a mês e a conta em fórmulas.
        </p>
        <ParametrosBase parametros={telaParametros} podeEditar={podeEditar} />
      </Secao>

      <Secao titulo="Frota (modelos)" descricao="Um modelo por linha: valor, consumo, manutenção por km, pneus, seguro, IPVA. Viram os tipos de veículo dos estudos novos (carro, van, micro, ônibus, reconhecidos pelo texto do tipo).">
        <TabelaRegistrosBase
          tipo="veiculo"
          campos={camposEditaveis("veiculo")}
          registros={paraTela("veiculo", veiculos as unknown as Linha[])}
          sugestoes={sugestoesVeiculo}
          podeEditar={podeEditar}
          vazio="Nenhum modelo na base: os estudos usam os tipos padrão do simulador. Traga um padrão abaixo para ajustar com os números da frota."
        />
      </Secao>

      <Secao titulo="Mão de obra (por função)" descricao="Piso, adicionais, encargos e benefícios da convenção coletiva por função. O salário do motorista de cada tipo de veículo sai daqui (“Motorista de van”, “Motorista de ônibus”…). Nunca salário de pessoas.">
        <TabelaRegistrosBase
          tipo="funcao"
          campos={camposEditaveis("funcao")}
          registros={paraTela("funcao", funcoes as unknown as Linha[])}
          sugestoes={sugestoesFuncao}
          completarPelaSugestao
          podeEditar={podeEditar}
          vazio="Nenhuma função na base: os estudos usam o salário padrão de cada tipo de veículo."
        />
      </Secao>

      <Secao titulo="Pedágios" descricao="Praças e tarifas por categoria de veículo.">
        <TabelaRegistrosBase tipo="pedagio" campos={camposEditaveis("pedagio")} registros={paraTela("pedagio", pedagios as unknown as Linha[])} podeEditar={podeEditar} vazio="Nenhuma praça na base." />
      </Secao>

      {podeEditar && (
        <Secao titulo="Atualizar tudo de uma vez pelo Gabarito" descricao="Para muitas mudanças, preencha o Gabarito e envie. Campos vazios não apagam o que já está na base.">
          <ImportarGabaritoForm />
        </Secao>
      )}
    </div>
  );
}
