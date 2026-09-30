import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { paraNumero } from "@/lib/simulador/baseDeCustos";
import { CATALOGO_PARAMETROS } from "@/lib/simulador/catalogo";
import { camposEditaveis, padraoDoSimulador, USO_DA_BASE, type TipoTabela } from "@/lib/simulador/edicaoBase";
import { PERFIS_PADRAO, PREMISSAS_PADRAO } from "@/lib/simulador/premissas";
import { ROTULO_TIPO_VEICULO, VARIANTE_DO_TIPO } from "@/lib/simulador/tipos";
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
      unidadePadrao: USO_DA_BASE[d.chave]?.unidadePadrao ?? null,
      uso: USO_DA_BASE[d.chave]?.como ?? null,
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
  const sugestoesFuncao = PERFIS_PADRAO.filter((p) => VARIANTE_DO_TIPO[p.tipo] === "PADRAO").map((p) => ({
    rotulo: `Motorista de ${ROTULO_TIPO_VEICULO[p.tipo].toLowerCase()}`,
    campos: { funcao: `Motorista de ${ROTULO_TIPO_VEICULO[p.tipo].toLowerCase()}`, salarioBase: p.motorista.salario, encargosPct: PREMISSAS_PADRAO.pessoal.encargosPct },
  }));

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

      <Secao titulo="Parâmetros" descricao="Diesel, tributos, prazos, jornada, administração e margens. “Estimativa” é o padrão do simulador enquanto a empresa não informa o seu número.">
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
