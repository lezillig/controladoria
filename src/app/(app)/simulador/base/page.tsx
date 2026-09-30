import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { paraNumero } from "@/lib/simulador/baseDeCustos";
import { fmtData } from "@/lib/controladoria/format";
import { larguraPainel, secondaryButtonClass } from "@/lib/ui";
import { exigirPermissao, podeAcao } from "../../_dados";
import { AvisoVazio, Secao, Tabela } from "../../_componentes";
import ImportarGabaritoForm from "./ImportarGabaritoForm";

// A BASE DE CUSTOS DO SIMULADOR — o que está valendo hoje.
//
// É daqui que todo estudo novo tira as premissas: diesel, encargos, salário
// por função, valor de cada modelo da frota, pedágios, margens da Azul. Cada
// linha mostra de onde veio e desde quando vale, porque "de onde saiu esse
// número?" é a primeira pergunta de quem confere um orçamento.
//
// Salário aqui é POR FUNÇÃO (convenção coletiva), nunca por pessoa.

const ROTULO_ENTIDADE: Record<string, string> = {
  JORNADA: "Jornada e operação",
  INDIRETO: "Custos indiretos",
  TRIBUTO: "Tributos",
  FINANCEIRO: "Financeiro",
  INSUMO: "Insumos",
  REGRA_AZUL: "Regras da Azul (margens)",
};

const reais = (v: unknown, casas = 2) => {
  const n = paraNumero(v);
  return n === null ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: casas, maximumFractionDigits: casas });
};
const numero = (v: unknown, casas = 0) => {
  const n = paraNumero(v);
  return n === null ? "—" : n.toLocaleString("pt-BR", { maximumFractionDigits: casas });
};
const percentual = (v: unknown) => {
  const n = paraNumero(v);
  return n === null ? "—" : `${(n * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
};

export default async function BaseDeCustosPage() {
  const session = await exigirPermissao("simulador");
  const podeEditar = await podeAcao(session, "gerir-simulador");
  const vigente = { companyId: session.companyId, vigenciaFim: null };
  const [parametros, veiculos, funcoes, pedagios, historico] = await Promise.all([
    prisma.simParametro.findMany({ where: vigente, orderBy: [{ entidade: "asc" }, { rotulo: "asc" }] }),
    prisma.simVeiculoModelo.findMany({ where: vigente, orderBy: [{ tipo: "asc" }, { modelo: "asc" }] }),
    prisma.simFuncao.findMany({ where: vigente, orderBy: [{ funcao: "asc" }] }),
    prisma.simPedagioPraca.findMany({ where: vigente, orderBy: [{ praca: "asc" }] }),
    prisma.simParametro.count({ where: { companyId: session.companyId, vigenciaFim: { not: null } } }),
  ]);
  const vazia = parametros.length + veiculos.length + funcoes.length + pedagios.length === 0;
  const grupos = new Map<string, typeof parametros>();
  for (const p of parametros) grupos.set(p.entidade, [...(grupos.get(p.entidade) ?? []), p]);

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/simulador" className="text-xs font-medium text-blue-700 hover:underline">
            ← Simulador
          </Link>
          <h1 className="mt-2 text-xl font-semibold text-slate-900">Base de custos</h1>
          <p className="mt-1 max-w-[80ch] text-sm text-slate-500">
            Os valores que os estudos novos usam como premissa. Nada é sobrescrito: quando um valor muda, o anterior fica guardado com a
            vigência encerrada{historico > 0 ? ` (${historico} ${historico === 1 ? "parâmetro" : "parâmetros"} no histórico)` : ""}, e cada estudo salvo lembra a base do dia.
          </p>
        </div>
        <a href="/api/simulador/gabarito" className={secondaryButtonClass}>
          Baixar Gabarito em branco
        </a>
      </div>

      {podeEditar && (
        <Secao titulo="Atualizar a base" descricao="Preencha o Gabarito (só valores por função — nunca salários de pessoas) e envie. Campos vazios não apagam o que já está na base.">
          <ImportarGabaritoForm />
        </Secao>
      )}

      {vazia ? (
        <AvisoVazio
          titulo="A base de custos está vazia"
          descricao="Enquanto isso, os estudos usam os valores padrão do simulador, marcados como “estimativa” em cada premissa. Importe o Gabarito para trocar os padrões pelos custos da Azul."
        />
      ) : (
        <>
          {[...grupos.entries()].map(([entidade, linhas]) => (
            <Secao key={entidade} titulo={ROTULO_ENTIDADE[entidade] ?? entidade}>
              <Tabela
                colunas={["Parâmetro", "Valor", "Unidade", "Desde", "Fonte"]}
                alinharDireita={[1]}
                linhas={linhas.map((p) => [
                  p.rotulo,
                  p.texto ?? (p.unidade?.includes("%") ? percentual(p.valor) : numero(p.valor, 4)),
                  p.unidade ?? "",
                  fmtData(p.vigenciaInicio),
                  <span key="f" className="text-xs text-slate-500">
                    {p.fonte}
                  </span>,
                ])}
              />
            </Secao>
          ))}
          <Secao titulo="Frota (modelos)" descricao="Valor, consumo, manutenção e custos anuais de cada modelo. Alimentam os tipos de veículo dos estudos.">
            <Tabela
              colunas={["Tipo", "Modelo", "Ano", "Qtde", "Lotação", "Valor de compra", "Consumo (km/l)", "Manutenção (R$/km)", "Seguro/ano", "Desde"]}
              alinharDireita={[2, 3, 4, 5, 6, 7, 8]}
              linhas={veiculos.map((v) => [v.tipo, v.modelo, v.ano ?? "—", numero(v.quantidade), numero(v.lotacao), reais(v.valorCompra, 0), numero(v.consumoKmL, 2), reais(v.manutencaoKm, 4), reais(v.seguroAnual, 0), fmtData(v.vigenciaInicio)])}
              vazio="Nenhum modelo cadastrado."
            />
          </Secao>
          <Secao titulo="Mão de obra (por função)" descricao="Piso e custos da convenção coletiva por função — o salário de cada tipo de veículo sai daqui.">
            <Tabela
              colunas={["Função", "CCT / região", "Salário base", "Adicionais fixos", "Encargos", "VR/VA", "Plano de saúde", "Desde"]}
              alinharDireita={[2, 3, 4, 5, 6]}
              linhas={funcoes.map((f) => [f.funcao, [f.cct, f.regiao].filter(Boolean).join(" · ") || "—", reais(f.salarioBase), reais(f.adicionaisFixos), percentual(f.encargosPct), reais(f.vrVa), reais(f.planoSaude), fmtData(f.vigenciaInicio)])}
              vazio="Nenhuma função cadastrada."
            />
          </Secao>
          <Secao titulo="Pedágios">
            <Tabela
              colunas={["Praça", "Concessionária", "Van", "Micro", "Ônibus 2 eixos", "Ônibus 3 eixos", "Desconto TAG", "Desde"]}
              alinharDireita={[2, 3, 4, 5, 6]}
              linhas={pedagios.map((p) => [p.praca, p.concessionaria ?? "—", reais(p.tarifaVan), reais(p.tarifaMicro), reais(p.tarifaOnibus2), reais(p.tarifaOnibus3), percentual(p.descontoTagPct), fmtData(p.vigenciaInicio)])}
              vazio="Nenhuma praça cadastrada."
            />
          </Secao>
        </>
      )}
    </div>
  );
}
