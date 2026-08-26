import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  DECISOES,
  FONTES_DE_CREDITO,
  MARCOS_REFORMA,
  MODALIDADES,
  PREPARACAO,
  RISCO_DESCARACTERIZACAO,
  type Aproveitamento,
} from "@/lib/conformidade/regime";
import { ROTULO_AREA, ROTULO_NATUREZA } from "@/lib/conformidade/tipos";
import { exigirPermissao, podeAcao } from "../../_dados";
import { Secao, Tabela } from "../../_componentes";
import { criarApontamentoDaTransicao } from "../actions";
import { larguraPainel } from "@/lib/ui";

// TRANSIÇÃO PARA O LUCRO REAL — janeiro de 2027.
//
// Fica dentro de Conformidade, e não numa área de planejamento, por uma razão
// de método: mudar de regime é um projeto com prazo e com pré-requisitos que
// falham exatamente onde a conformidade desta empresa já falha hoje. O balancete
// trimestral que a consultoria cobra desde dezembro de 2025 é uma pendência de
// obrigação acessória no Lucro Presumido; no Lucro Real é a base de cálculo do
// imposto. O mesmo item, duas gravidades — e é essa continuidade que justifica
// as duas coisas morarem na mesma tela.
//
// Cada decisão e cada preparação vira apontamento com um clique: é o que separa
// um documento de referência de um plano com dono.

export default async function TransicaoPage() {
  const session = await exigirPermissao("conformidade");
  const podeGerir = await podeAcao(session, "gerir-conformidade");

  // Quais itens já viraram apontamento. A tela precisa saber para não oferecer
  // criar de novo — e para mostrar que aquilo já tem dono em algum lugar.
  const jaCriados = await prisma.conformidadeApontamento.findMany({
    where: { companyId: session.companyId, obrigacaoCodigo: { startsWith: "LR-" } },
    select: { id: true, obrigacaoCodigo: true, status: true, responsavel: true },
  });
  const criadosPrep = await prisma.conformidadeApontamento.findMany({
    where: { companyId: session.companyId, obrigacaoCodigo: { startsWith: "PREP-" } },
    select: { id: true, obrigacaoCodigo: true, status: true, responsavel: true },
  });
  const registrados = new Map(
    [...jaCriados, ...criadosPrep].filter((a) => a.obrigacaoCodigo).map((a) => [a.obrigacaoCodigo!, a])
  );

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-blue-700">
          <Link href="/conformidade" className="hover:underline">
            Conformidade
          </Link>{" "}
          · Transição de regime
        </p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Lucro Real a partir de janeiro de 2027</h1>
        <p className="mt-1 text-sm text-slate-500">
          A decisão de regime coincide com a virada da reforma tributária, e as duas se afetam. Esta tela reúne o que
          muda, o que se pode creditar, o que decidir e o que precisa estar de pé antes da virada — cada item podendo
          virar apontamento com responsável e prazo.
        </p>
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-4">
        <p className="text-sm font-semibold text-blue-900">Duas coisas tornam esta janela específica</p>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-blue-900">
          <li>
            <strong>Em 2027 o PIS e a COFINS deixam de existir.</strong> A razão clássica para migrar — capturar o
            crédito não cumulativo de 9,25% — desaparece junto. Quem migra em janeiro de 2027 nunca vai apurar
            EFD-Contribuições no regime não cumulativo, que é a parte mais cara e mais arriscada da mudança.
          </li>
          <li>
            <strong>O crédito de CBS e IBS não depende do regime de IRPJ.</strong> Lucro Presumido credita igual. A
            partir de 2027, escolher regime passa a ser uma decisão exclusivamente de IRPJ e CSLL: lucro presumido
            contra lucro efetivo, e nada mais.
          </li>
        </ul>
      </div>

      <Secao
        titulo="Fretamento não é transporte público — e a diferença decide quase tudo"
        descricao="Linha regular concedida, transporte urbano e fretamento têm regulador, documento fiscal, CNAE e regime de alíquota diferentes. A operação deste grupo é fretamento, e é por isso que a maior parte dos benefícios do setor de transporte não a alcança."
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {MODALIDADES.map((m) => {
            const nossa = m.codigo === "FRETAMENTO";
            return (
              <div
                key={m.codigo}
                className={`rounded-xl border p-4 ${nossa ? "border-blue-400 bg-blue-50/40" : "border-slate-200"}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">{m.nome}</h3>
                  {nossa && (
                    <span className="rounded-full bg-blue-700 px-2 py-0.5 text-xs font-medium text-white">nossa operação</span>
                  )}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-slate-600">{m.oQueE}</p>
                <dl className="mt-3 space-y-1.5 text-xs">
                  <Linha rotulo="Regulador" valor={m.regulador} />
                  <Linha rotulo="Documento fiscal" valor={m.documentoFiscal} />
                  <Linha rotulo="CNAE" valor={m.cnae} />
                  <Linha rotulo="Imposto sobre o serviço" valor={m.impostoSobreOServico} />
                  <Linha rotulo="Desoneração da folha" valor={m.desoneracaoDaFolha} destaque={nossa} />
                  <Linha rotulo="Na reforma" valor={m.reformaTributaria} destaque={nossa} />
                </dl>
              </div>
            );
          })}
        </div>

        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm font-semibold text-red-900">{RISCO_DESCARACTERIZACAO.titulo}</p>
          <p className="mt-1 text-xs leading-relaxed text-red-800">{RISCO_DESCARACTERIZACAO.oQueObservar}</p>
          <p className="mt-2 font-mono text-xs text-red-700">{RISCO_DESCARACTERIZACAO.baseLegal}</p>
        </div>
      </Secao>

      <Secao titulo="Linha do tempo da reforma" descricao="As obrigações começam antes do imposto.">
        <ol className="space-y-4">
          {MARCOS_REFORMA.map((m) => (
            <li key={m.periodo} className="border-l-2 border-slate-200 pl-4">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-sm font-semibold text-blue-700">{m.periodo}</span>
                <span className="text-sm font-semibold text-slate-900">{m.titulo}</span>
              </div>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">{m.oQueMuda}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-800">
                <strong>Agora:</strong> {m.acaoAgora}
              </p>
              <p className="mt-1 font-mono text-xs text-slate-400">{m.baseLegal}</p>
            </li>
          ))}
        </ol>
      </Secao>

      <Secao
        titulo="O que gera crédito, e o que nunca vai gerar"
        descricao="A pergunta que sempre vem primeiro é o que se pode creditar. A que quase nunca vem, e decide o tamanho do ganho, é o que não se pode."
      >
        <Tabela
          colunas={["Custo", "Presumido hoje", "Lucro Real hoje", "CBS/IBS 2027", "Observação"]}
          linhas={FONTES_DE_CREDITO.map((f) => [
            <span key="i" className="font-medium text-slate-800">{f.item}</span>,
            <Marca key="a" valor={f.presumidoHoje} />,
            <Marca key="b" valor={f.realHoje} />,
            <Marca key="c" valor={f.cbsIbs} />,
            <span key="o" className="text-xs leading-relaxed text-slate-600">{f.observacao}</span>,
          ])}
        />
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          A primeira linha é a mais importante. Numa operação de fretamento o maior custo é folha, e folha não gera
          crédito em regime nenhum — nem hoje no não cumulativo, nem na CBS/IBS, que credita operação com fornecedor.
          Quem dimensiona o ganho da migração pelo total de custos, e não pelos custos creditáveis, erra por um fator
          grande.
        </p>
      </Secao>

      <Secao
        titulo="Decisões que precisam de dono"
        descricao="Cada uma vira apontamento de conformidade, com prazo e responsável, no mesmo lugar em que o resto é cobrado."
      >
        <ul className="space-y-4">
          {DECISOES.map((d) => (
            <ItemDaTransicao
              key={d.codigo}
              codigo={d.codigo}
              titulo={d.titulo}
              area={d.area}
              natureza={d.natureza}
              pergunta={d.pergunta}
              texto={d.porQueImporta}
              baseLegal={d.baseLegal}
              confirmar={d.confirmar}
              registrado={registrados.get(d.codigo)}
              podeGerir={podeGerir}
            />
          ))}
        </ul>
      </Secao>

      <Secao
        titulo="O que precisa estar de pé antes de janeiro"
        descricao="A ordem é de dependência, não de importância: sem fechamento contábil não há DRE; sem DRE não há como decidir o regime."
      >
        <ul className="space-y-4">
          {PREPARACAO.map((p) => (
            <ItemDaTransicao
              key={p.codigo}
              codigo={p.codigo}
              titulo={p.titulo}
              area={p.area}
              natureza={p.natureza}
              pergunta={p.quando}
              texto={p.porQue}
              comoFazer={p.comoFazer}
              registrado={registrados.get(p.codigo)}
              podeGerir={podeGerir}
            />
          ))}
        </ul>
      </Secao>

      <Secao titulo="Como ler esta tela">
        <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-600">
          <li>
            Os itens marcados <strong>confirmar com a assessoria</strong> dependem de norma em transição ou de
            enquadramento ainda não pacificado. O sistema organiza a decisão; quem decide o enquadramento é a
            assessoria fiscal.
          </li>
          <li>
            A alíquota de referência da CBS e do IBS ainda depende de fixação pelo Senado. Qualquer projeção feita hoje
            é ordem de grandeza para dimensionar decisão — não apuração.
          </li>
          <li>
            A conta que decide o regime é uma só: dividir o que se paga hoje de IRPJ e CSLL por 34% e comparar com o
            lucro contábil efetivo. Acima dele, o Presumido é mais barato; abaixo, o Real. Essa conta depende de uma
            DRE fechada — que é o que este sistema passa a produzir quando o espelho da Omie estiver sincronizado.
          </li>
        </ul>
      </Secao>
    </div>
  );
}

function Linha({ rotulo, valor, destaque = false }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div>
      <dt className="font-medium uppercase tracking-wide text-slate-400">{rotulo}</dt>
      <dd className={`mt-0.5 leading-relaxed ${destaque ? "font-medium text-blue-900" : "text-slate-700"}`}>{valor}</dd>
    </div>
  );
}

const MARCAS: Record<Aproveitamento, { rotulo: string; classe: string }> = {
  SIM: { rotulo: "credita", classe: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  NAO: { rotulo: "não credita", classe: "bg-red-50 text-red-700 ring-red-200" },
  PARCIAL: { rotulo: "parcial", classe: "bg-amber-50 text-amber-800 ring-amber-200" },
  VERIFICAR: { rotulo: "verificar", classe: "bg-slate-100 text-slate-600 ring-slate-200" },
};

function Marca({ valor }: { valor: Aproveitamento }) {
  const m = MARCAS[valor];
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${m.classe}`}>
      {m.rotulo}
    </span>
  );
}

function ItemDaTransicao({
  codigo,
  titulo,
  area,
  natureza,
  pergunta,
  texto,
  comoFazer,
  baseLegal,
  confirmar,
  registrado,
  podeGerir,
}: {
  codigo: string;
  titulo: string;
  area: string;
  natureza: string;
  pergunta: string;
  texto: string;
  comoFazer?: string;
  baseLegal?: string;
  confirmar?: boolean;
  registrado?: { id: string; status: string; responsavel: string | null };
  podeGerir: boolean;
}) {
  return (
    <li className="rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-violet-200">
          {ROTULO_AREA[area] ?? area}
        </span>
        <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-medium text-white">
          {ROTULO_NATUREZA[natureza] ?? natureza}
        </span>
        {confirmar && (
          <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200">
            confirmar com a assessoria
          </span>
        )}
        <span className="font-mono text-xs text-slate-400">{codigo}</span>
      </div>

      <h3 className="mt-2 text-sm font-semibold text-slate-900">{titulo}</h3>
      <p className="mt-1 text-sm font-medium text-slate-700">{pergunta}</p>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{texto}</p>

      {comoFazer && (
        <div className="mt-3 rounded-lg bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Como fazer</p>
          <p className="mt-1 text-sm leading-relaxed text-slate-700">{comoFazer}</p>
        </div>
      )}

      {baseLegal && <p className="mt-2 font-mono text-xs text-slate-400">{baseLegal}</p>}

      {registrado ? (
        <p className="mt-3 text-xs text-emerald-700">
          Já é apontamento{registrado.responsavel ? ` sob responsabilidade de ${registrado.responsavel}` : " sem responsável definido"}.{" "}
          <Link href={`/conformidade#${registrado.id}`} className="font-medium underline">
            abrir
          </Link>
        </p>
      ) : (
        podeGerir && (
          <form action={criarApontamentoDaTransicao} className="mt-3">
            <input type="hidden" name="codigo" value={codigo} />
            <button type="submit" className="text-xs font-medium text-blue-700 hover:underline">
              transformar em apontamento
            </button>
          </form>
        )
      )}
    </li>
  );
}
