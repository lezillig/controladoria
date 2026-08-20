import { canManageControladoria } from "@/lib/permissions";
import { fmtBRL, fmtData, fmtNumero, fmtPercent } from "@/lib/controladoria/format";
import { montarComparativo } from "@/lib/controladoria/analytics";
import { custoPorFuncionario, custoPorVeiculo, rentabilidadePorContrato } from "@/lib/controladoria/unitEconomics";
import { contextoDaPagina } from "../_dados";
import { AvisoVazio, Barra, Kpi, Secao, SeletorEmpresa, Tabela } from "../_componentes";
import VinculoForm, { type OpcaoDestino, type OpcaoOrigem } from "./VinculoForm";
import { removerVinculo } from "./actions";

// RENTABILIDADE POR CONTRATO, VEÍCULO E FUNCIONÁRIO.
//
// A tela mostra a COBERTURA do rateio antes de qualquer ranking, e não depois:
// um ranking de rentabilidade construído sobre 40% do custo é uma conclusão
// sobre a minoria dos números com toda a aparência de rigor. Enquanto a
// cobertura for baixa, o topo da tela diz isso em vez de esconder.

export default async function RentabilidadePage({ searchParams }: { searchParams: Promise<{ empresa?: string }> }) {
  const { session, ctx, escopo } = await contextoDaPagina((await searchParams).empresa);
  const podeEditar = canManageControladoria(session.role);

  const comparativo = montarComparativo(ctx);
  const periodo = comparativo.janelas.mesAtual;

  const nomesCliente = new Map(ctx.clientes.map((c) => [c.id, c.nome]));
  const contratos = rentabilidadePorContrato(ctx, periodo, nomesCliente);
  const veiculos = custoPorVeiculo(ctx, periodo);
  const funcionarios = custoPorFuncionario(ctx, periodo);

  const vinculos = ctx.vinculos;
  const confirmados = vinculos.filter((v) => !v.sugerido);

  const origens: OpcaoOrigem[] = [
    ...ctx.departamentos
      .filter((d) => !d.inativo)
      .map((d) => ({ tipo: "DEPARTAMENTO", codigo: d.codigo, rotulo: `Departamento · ${d.descricao}` })),
    ...ctx.categorias
      .filter((c) => !c.inativa && !c.totalizadora)
      .slice(0, 200)
      .map((c) => ({ tipo: "CATEGORIA", codigo: c.codigo, rotulo: `Categoria · ${c.descricao}` })),
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
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Rentabilidade por contrato</h1>
        <p className="mt-1 text-sm text-slate-500">
          {periodo.rotulo} até {fmtData(ctx.dataReferencia)}. Custo é atribuído apenas quando existe ligação verificável —
          um de-para confirmado, uma placa citada no documento ou um abastecimento já vinculado. O resto aparece como não
          alocado.
        </p>
      </div>

      <SeletorEmpresa conexoes={ctx.conexoes} ativa={escopo.conexaoId} rota="/rentabilidade" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Kpi
          rotulo="Cobertura do rateio"
          valor={fmtPercent(contratos.coberturaPercent)}
          apoio={`${fmtBRL(contratos.naoAlocadoCents)} não alocados`}
          tom={contratos.coberturaPercent >= 70 ? "bom" : contratos.coberturaPercent >= 40 ? "atencao" : "ruim"}
        />
        <Kpi rotulo="Custo total do mês" valor={fmtBRL(contratos.totalCents)} apoio="Títulos a pagar + cartão de frota" />
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
