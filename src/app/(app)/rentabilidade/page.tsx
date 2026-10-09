import { fmtBRL, fmtData, fmtNumero, fmtPercent } from "@/lib/controladoria/format";
import { montarComparativo } from "@/lib/controladoria/analytics";
import { ultimoMesFechado } from "@/lib/controladoria/periodos";
import { custoPorFuncionario, custoPorVeiculo, rentabilidadePorContrato } from "@/lib/controladoria/unitEconomics";
import { faturadoVersusContratado, margemPorClienteOmie, margemPorOs } from "@/lib/controladoria/margemOmie";
import { competenciasDisponiveis, contextoDaPagina, podeAcao } from "../_dados";
import { AvisoVazio, Barra, Kpi, Secao, Tabela } from "../_componentes";
import Filtros from "../Filtros";
import VinculoForm, { type OpcaoDestino, type OpcaoOrigem } from "./VinculoForm";
import { removerVinculo } from "./actions";
import { larguraPainel } from "@/lib/ui";

// RENTABILIDADE POR CONTRATO, VEÍCULO E FUNCIONÁRIO.
//
// A tela mostra a COBERTURA do rateio antes de qualquer ranking, e não depois:
// um ranking de rentabilidade construído sobre 40% do custo é uma conclusão
// sobre a minoria dos números com toda a aparência de rigor. Enquanto a
// cobertura for baixa, o topo da tela diz isso em vez de esconder.

export default async function RentabilidadePage({
  searchParams,
}: {
  searchParams: Promise<{ empresa?: string; competencia?: string }>;
}) {
  const params = await searchParams;
  const { session, ctx, escopo, periodo: competenciaEscolhida } = await contextoDaPagina(
    "rentabilidade",
    params.empresa,
    params.competencia
  );
  const podeEditar = await podeAcao(session, "gerir-rentabilidade");

  const comparativo = await montarComparativo(ctx);
  // O ÚLTIMO MÊS FECHADO. Contrato fatura uma vez por mês e incorre custo todo
  // dia: no mês em curso, até o dia do faturamento toda margem é negativa, e a
  // tela mostrava isso como se fosse resultado. Com uma competência fechada
  // escolhida no seletor, o mês é ela mesma.
  const periodo = comparativo.janelas.mesParcial ? ultimoMesFechado(ctx.dataReferencia) : comparativo.janelas.mesAtual;

  const nomesCliente = new Map(ctx.clientes.map((c) => [c.id, c.nome]));
  const contratos = rentabilidadePorContrato(ctx, periodo, nomesCliente);
  const veiculos = custoPorVeiculo(ctx, periodo);
  const funcionarios = custoPorFuncionario(ctx, periodo);

  // O QUE A OMIE JÁ SABE SOZINHA, sem de-para: a margem de cada OS (projeto),
  // as OS somadas pelo cliente cobrado e o faturado contra o contratado. A
  // leitura por OS cobre a janela inteira carregada, porque uma OS custa num
  // mês e fatura no seguinte; contrato é mensal e olha o mês do rateio.
  const porOs = margemPorOs(ctx);
  const porClienteOmie = margemPorClienteOmie(porOs);
  const contratosOmie = faturadoVersusContratado(ctx, periodo);
  const OS_NA_TELA = 25;
  const margemClasse = (cents: number) => (cents < 0 ? "font-semibold text-red-700" : "font-semibold text-emerald-700");

  const vinculos = ctx.vinculos;
  const confirmados = vinculos.filter((v) => !v.sugerido);

  // A CONEXÃO VAI JUNTO com a origem: departamento "1" da Azul e "1" da MCZ
  // são coisas diferentes, e um vínculo gravado só pelo código caía nos dois —
  // o custo de uma empresa aparecia no contrato da outra, que é exatamente o
  // erro que esta tela diz evitar.
  const origens: OpcaoOrigem[] = [
    ...ctx.departamentos
      .filter((d) => !d.inativo)
      .map((d) => ({ tipo: "DEPARTAMENTO", codigo: d.codigo, conexaoId: d.conexaoId, rotulo: `Departamento · ${d.descricao} (${d.conexaoApelido})` })),
    ...ctx.categorias
      .filter((c) => !c.inativa && !c.totalizadora)
      .slice(0, 200)
      .map((c) => ({ tipo: "CATEGORIA", codigo: c.codigo, conexaoId: c.conexaoId, rotulo: `Categoria · ${c.descricao} (${c.conexaoApelido})` })),
  ];

  const destinos: OpcaoDestino[] = [
    ...ctx.clientes.filter((c) => c.active).map((c) => ({ valor: `cliente:${c.id}`, rotulo: c.nome, grupo: "Contratos" })),
    ...ctx.veiculos.map((v) => ({ valor: `veiculo:${v.id}`, rotulo: v.plate, grupo: "Veículos" })),
    ...ctx.motoristas
      .filter((m) => m.active)
      .map((m) => ({ valor: `motorista:${m.id}`, rotulo: m.name, grupo: "Funcionários" })),
  ];

  const nomeOrigem = (tipo: string, valor: string) => {
    if (tipo === "DEPARTAMENTO") return ctx.departamentos.find((d) => d.codigo === valor)?.descricao ?? valor;
    if (tipo === "CATEGORIA") return ctx.categorias.find((c) => c.codigo === valor)?.descricao ?? valor;
    return valor;
  };

  const nomeDestino = (v: (typeof vinculos)[number]) => {
    if (v.clienteId) return `Contrato · ${nomesCliente.get(v.clienteId) ?? v.clienteId}`;
    if (v.vehicleId) return `Veículo · ${ctx.veiculos.find((x) => x.id === v.vehicleId)?.plate ?? v.vehicleId}`;
    if (v.driverId) return `Funcionário · ${ctx.motoristas.find((x) => x.id === v.driverId)?.name ?? v.driverId}`;
    return "—";
  };

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Rentabilidade por contrato</h1>
        <p className="mt-1 text-sm text-slate-500">
          {comparativo.janelas.mesParcial
            ? `${periodo.rotulo}, o último mês fechado (o mês em curso só entra quando terminar, porque contrato fatura uma vez por mês e incorre custo todo dia). `
            : `${periodo.rotulo} até ${fmtData(ctx.dataReferencia)}. `}
          Custo é atribuído apenas quando existe ligação verificável —
          um de-para confirmado, uma placa citada no documento ou um abastecimento já vinculado. O resto aparece como não
          alocado.
        </p>
      </div>

      <Filtros
        conexoes={ctx.conexoes}
        empresaAtiva={escopo.conexaoId}
        competencias={competenciasDisponiveis(ctx.config.dataInicioBase)}
        competenciaAtiva={competenciaEscolhida.competencia}
        rota="/rentabilidade"
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Kpi
          rotulo="Cobertura do rateio"
          valor={fmtPercent(contratos.coberturaPercent)}
          apoio={`${fmtBRL(contratos.naoAlocadoCents)} não alocados`}
          tom={contratos.coberturaPercent >= 70 ? "bom" : contratos.coberturaPercent >= 40 ? "atencao" : "ruim"}
        />
        <Kpi
          rotulo="Custo total do mês"
          valor={fmtBRL(contratos.totalCents)}
          apoio={[
            contratos.combustivelDescontadoCents > 0
              ? `Títulos a pagar + cartão de frota; ${fmtBRL(contratos.combustivelDescontadoCents)} de combustível na Omie fora da soma, já contados pelo extrato do cartão`
              : "Títulos a pagar + cartão de frota",
            (contratos.foraDoCustoCents ?? 0) > 0
              ? `${fmtBRL(contratos.foraDoCustoCents ?? 0)} fora por não ser custo de operação (investimento, financiamento, sócios, IR/CSLL, operações entre as empresas)`
              : null,
          ]
            .filter(Boolean)
            .join(". ")}
        />
        <Kpi rotulo="Contratos com custo alocado" valor={fmtNumero(contratos.linhas.length)} apoio={`${fmtNumero(confirmados.length)} vínculo(s) confirmado(s)`} />
      </div>

      {contratos.coberturaPercent < 70 && contratos.totalCents > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-900">O ranking de rentabilidade ainda não é confiável</p>
          <p className="mt-1 text-xs leading-relaxed text-amber-800">
            Com {fmtPercent(contratos.coberturaPercent)} do custo alocado, comparar a margem de um contrato com a de outro
            leva a conclusão errada. Comece pelo de-para dos departamentos de maior valor — normalmente uma dúzia deles
            resolve a maior parte da diferença.
          </p>
        </div>
      )}

      <Secao titulo="Por contrato" descricao="Receita e custo alocados no mês, com a origem de cada alocação.">
        {contratos.linhas.length === 0 ? (
          <AvisoVazio
            titulo="Nenhum custo alocado a contrato ainda"
            descricao="Cadastre o de-para abaixo, ligando os departamentos e projetos da Omie aos contratos deste sistema."
          />
        ) : (
          <Tabela
            colunas={["Contrato", "Receita", "Custo", "Margem", "% margem", "Origem"]}
            alinharDireita={[1, 2, 3, 4]}
            linhas={contratos.linhas.map((l) => [
              <span key="n" className="font-medium text-slate-800">
                {l.nome}
              </span>,
              fmtBRL(l.receitaCents),
              fmtBRL(l.custoCents),
              <span key="m" className={l.margemCents < 0 ? "font-semibold text-red-700" : "font-semibold text-emerald-700"}>
                {fmtBRL(l.margemCents)}
              </span>,
              fmtPercent(l.margemPercent),
              <span key="o" className="text-xs text-slate-500">
                {l.origens.join(", ") || "—"}
              </span>,
            ])}
          />
        )}
      </Secao>

      <Secao
        titulo="Por OS (projeto)"
        descricao={`Receita e custo lançados no mesmo projeto da Omie desde ${fmtData(ctx.janelaDesde)}, sem de-para — a viagem custa num mês e fatura no seguinte, por isso a janela inteira. Do movimento mais recente ao mais antigo.`}
      >
        {porOs.os.length === 0 ? (
          <AvisoVazio
            titulo="Nenhum título com projeto informado"
            descricao="A margem por OS depende do código de projeto no lançamento da Omie. Sem ele, o custo e a receita não têm como se encontrar."
          />
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <div>
                <span className="block text-slate-500">Receita nas OS</span>
                <span className="tabular-nums font-semibold text-slate-800">{fmtBRL(porOs.receitaCents)}</span>
              </div>
              <div>
                <span className="block text-slate-500">Custo nas OS</span>
                <span className="tabular-nums font-semibold text-slate-800">{fmtBRL(porOs.custoCents)}</span>
              </div>
              <div>
                <span className="block text-slate-500">Margem das OS</span>
                <span className={`tabular-nums ${margemClasse(porOs.receitaCents - porOs.custoCents)}`}>{fmtBRL(porOs.receitaCents - porOs.custoCents)}</span>
              </div>
              <div>
                <span className="block text-slate-500">Fora das OS (sem projeto)</span>
                <span className="tabular-nums font-semibold text-slate-800">
                  {fmtBRL(porOs.custoForaDeOsCents)} <span className="font-normal text-slate-500">de custo</span>
                </span>
              </div>
            </div>
            <p className="text-xs text-slate-500">
              {fmtNumero(porOs.os.length)} OS com movimento, {fmtNumero(porOs.semFaturamento)} sem nenhuma cobrança e {fmtNumero(porOs.semCusto)} sem
              custo lançado. O custo sem projeto ({fmtBRL(porOs.custoForaDeOsCents)}) e a receita sem projeto ({fmtBRL(porOs.receitaForaDeOsCents)}) não
              entram em OS nenhuma — esta leitura explica só o que veio classificado da origem.
            </p>
            <Tabela
              colunas={["OS", "Cliente cobrado", "Último movimento", "Receita", "Custo", "Margem", "% margem"]}
              alinharDireita={[3, 4, 5, 6]}
              linhas={porOs.os.slice(0, OS_NA_TELA).map((o) => [
                <span key="n">
                  <span className="font-medium text-slate-800">{o.nome}</span>
                  <span className="block text-xs text-slate-400">
                    {o.projeto !== o.nome ? `${o.projeto} · ` : ""}
                    {o.conexaoApelido} · {fmtNumero(o.titulosDeCusto)} custo(s), {fmtNumero(o.titulosDeReceita)} cobrança(s)
                  </span>
                </span>,
                o.clienteNome ? (
                  <span key="c" className="text-slate-700">
                    {o.clienteNome}
                    {o.clientesDistintos > 1 ? <span className="text-xs text-slate-400"> (+{o.clientesDistintos - 1})</span> : null}
                  </span>
                ) : (
                  <span key="c" className="text-xs font-medium text-amber-700">
                    sem cobrança
                  </span>
                ),
                fmtData(o.ultimoMovimento),
                fmtBRL(o.receitaCents),
                fmtBRL(o.custoCents),
                <span key="m" className={margemClasse(o.margemCents)}>
                  {fmtBRL(o.margemCents)}
                </span>,
                fmtPercent(o.margemPercent),
              ])}
            />
            {porOs.os.length > OS_NA_TELA && (
              <p className="text-xs text-slate-500">
                Mostrando as {OS_NA_TELA} OS mais recentes de {fmtNumero(porOs.os.length)}. A margem por cliente abaixo soma todas.
              </p>
            )}
          </div>
        )}
      </Secao>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Secao titulo="Por cliente Omie" descricao="As OS somadas pelo cliente que foi cobrado nelas. Não passa pelo cadastro de contratos deste sistema.">
          <Tabela
            colunas={["Cliente", "OS", "Receita", "Custo", "Margem", "%"]}
            alinharDireita={[1, 2, 3, 4, 5]}
            vazio="Sem OS com movimento na janela."
            linhas={porClienteOmie.map((c) => [
              <span key="n" className={c.clienteCodigo ? "font-medium text-slate-800" : "font-medium text-amber-700"}>
                {c.clienteNome}
              </span>,
              fmtNumero(c.ordens),
              fmtBRL(c.receitaCents),
              fmtBRL(c.custoCents),
              <span key="m" className={margemClasse(c.margemCents)}>
                {fmtBRL(c.margemCents)}
              </span>,
              fmtPercent(c.margemPercent),
            ])}
          />
        </Secao>
        <Secao
          titulo="Faturado × contratado"
          descricao={`Contratos de serviço da Omie em ${periodo.rotulo}: o valor mensal contratado contra os títulos a receber ligados ao contrato no mês.`}
        >
          <Tabela
            colunas={["Contrato", "Contratado/mês", "Faturado", "Diferença", "%"]}
            alinharDireita={[1, 2, 3, 4]}
            vazio="Nenhum contrato de serviço sincronizado da Omie, ou nenhum ativo. A sincronização de contratos traz a lista."
            linhas={contratosOmie.map((l) => [
              <span key="n">
                <span className="font-medium text-slate-800">
                  {l.rotulo} · {l.clienteNome ?? "cliente não identificado"}
                </span>
                <span className="block text-xs text-slate-400">
                  {l.conexaoApelido} · {l.situacao} · {l.periodicidade}
                  {l.titulos > 0 ? ` · ${fmtNumero(l.titulos)} título(s)` : ""}
                </span>
              </span>,
              fmtBRL(l.contratadoCents),
              fmtBRL(l.faturadoCents),
              l.diferencaCents === null ? (
                <span key="d" className="text-xs text-slate-400">
                  —
                </span>
              ) : (
                <span key="d" className={l.diferencaCents < 0 ? "font-semibold text-red-700" : l.diferencaCents > 0 && !l.ativo ? "font-semibold text-amber-700" : "text-slate-700"}>
                  {fmtBRL(l.diferencaCents)}
                </span>
              ),
              fmtPercent(l.faturadoPercent, 0),
            ])}
          />
        </Secao>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Secao titulo="Custo por veículo" descricao={`Cobertura: ${fmtPercent(veiculos.coberturaPercent)}`}>
          <Tabela
            colunas={["Veículo", "Custo no mês"]}
            alinharDireita={[1]}
            vazio="Sem custo alocado a veículo no período."
            linhas={veiculos.linhas.slice(0, 15).map((l) => [l.nome, fmtBRL(l.custoCents)])}
          />
        </Secao>
        <Secao titulo="Custo por funcionário" descricao={`Cobertura: ${fmtPercent(funcionarios.coberturaPercent)}`}>
          <Tabela
            colunas={["Funcionário", "Custo no mês"]}
            alinharDireita={[1]}
            vazio="Sem custo alocado a funcionário no período. A folha só entra aqui quando estiver classificada por pessoa na Omie."
            linhas={funcionarios.linhas.slice(0, 15).map((l) => [l.nome, fmtBRL(l.custoCents)])}
          />
        </Secao>
      </div>

      <Secao
        titulo="De-para de centro de custo"
        descricao="Liga a dimensão de custo da Omie aos contratos, veículos e funcionários cadastrados aqui."
      >
        {podeEditar && <VinculoForm origens={origens} destinos={destinos} />}

        <div className="mt-4">
          <Tabela
            colunas={["Origem (Omie)", "Destino", "%", "Confirmado", ...(podeEditar ? [""] : [])]}
            alinharDireita={[2]}
            vazio="Nenhum vínculo cadastrado. Sem eles, o custo fica todo em 'não alocado'."
            linhas={vinculos.map((v) => [
              <span key="o">
                <span className="text-xs uppercase text-slate-400">{v.tipoOrigem.toLowerCase()}</span>
                <span className="block text-slate-800">{v.rotuloOrigem ?? nomeOrigem(v.tipoOrigem, v.valorOrigem)}</span>
              </span>,
              nomeDestino(v),
              fmtPercent(v.percentual, 0),
              v.sugerido ? (
                <span key="s" className="text-xs text-amber-700">
                  sugestão (não entra no cálculo)
                </span>
              ) : (
                <span key="s" className="text-xs text-slate-500">
                  {v.confirmadoEm ? fmtData(v.confirmadoEm) : "sim"}
                </span>
              ),
              ...(podeEditar
                ? [
                    <form key="f" action={removerVinculo}>
                      <input type="hidden" name="id" value={v.id} />
                      <button type="submit" className="text-xs font-medium text-red-700 hover:underline">
                        remover
                      </button>
                    </form>,
                  ]
                : []),
            ])}
          />
        </div>
      </Secao>

      <Secao titulo="O que falta alocar" descricao="Os maiores valores sem centro de custo — é por onde a cobertura sobe mais rápido.">
        <div className="space-y-3">
          <div>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="font-medium text-slate-700">Custo alocado</span>
              <span className="tabular-nums text-slate-600">
                {fmtBRL(contratos.totalCents - contratos.naoAlocadoCents)} de {fmtBRL(contratos.totalCents)}
              </span>
            </div>
            <Barra percentual={contratos.coberturaPercent} tom={contratos.coberturaPercent >= 70 ? "verde" : "ambar"} />
          </div>
          <p className="text-xs text-slate-500">
            Títulos sem departamento nem projeto informado na Omie não podem ser alocados por de-para nenhum — para esses,
            a solução é preencher o centro de custo no lançamento. O agente de contas a pagar abre um achado com o valor
            total desses casos a cada execução.
          </p>
        </div>
      </Secao>
    </div>
  );
}
