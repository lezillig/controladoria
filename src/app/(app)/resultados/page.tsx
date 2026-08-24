import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { fmtBRL, fmtData, fmtNumero, fmtPercent, fmtVariacao, variacaoPercent } from "@/lib/controladoria/format";
import { serieMensal } from "@/lib/controladoria/serieMensal";
import { composicaoDoPeriodo, maioresTitulosDoPeriodo } from "@/lib/controladoria/composicao";
import { retencoesDoPeriodo } from "@/lib/controladoria/retencoes";
import { dataReferenciaPadrao } from "@/lib/controladoria/ciclo";
import { fimDoMes, inicioDoDia, inicioDoMes, mesCompleto } from "@/lib/controladoria/periodos";
import PageHeader from "@/components/ui/PageHeader";
import { competenciasDisponiveis, resolverEscopo, resolverPeriodo, sessaoControladoria } from "../_dados";
import { Kpi, Secao, Tabela } from "../_componentes";
import Filtros from "../Filtros";

// RESULTADO MÊS A MÊS E COMPOSIÇÃO DO MÊS.
//
// Duas perguntas na mesma tela, porque uma sempre puxa a outra:
//
//   "como viemos até aqui" — a série mensal com acumulado;
//   "de onde vem esse número" — a composição por categoria, tipo e conta.
//
// A segunda existe porque o painel mostrava R$ 9,2 milhões de receita e não
// sabia dizer de quê. Um total sem composição é uma afirmação que a pessoa
// precisa aceitar ou rejeitar em bloco — e quando ele não bate com o que o
// contador diz, não há por onde começar a investigar.
//
// Nada aqui carrega o contexto de auditoria: tudo é somado no Postgres. É o
// mesmo remédio já aplicado na sincronização e na auditoria, pelo mesmo
// motivo — foi carregar linha a linha que esgotou a franquia do banco e fez o
// ciclo diário estourar o tempo da função.

export default async function ResultadosPage({
  searchParams,
}: {
  searchParams: Promise<{ empresa?: string; competencia?: string }>;
}) {
  const session = await sessaoControladoria();
  const params = await searchParams;
  const escopo = await resolverEscopo(session.companyId, params.empresa);
  const periodo = resolverPeriodo(params.competencia);

  const [config, conexoes] = await Promise.all([
    prisma.controladoriaConfig.findUnique({
      where: { companyId: session.companyId },
      select: { dataInicioBase: true },
    }),
    prisma.omieConexao.findMany({
      where: { companyId: session.companyId, ativa: true },
      orderBy: { ordem: "asc" },
      select: { id: true, apelido: true, nome: true },
    }),
  ]);

  // A série vai até o FIM do mês corrente, não até hoje. Ver `mesCompleto`:
  // em competência, o mês é o mês — cortar no dia de hoje fazia a última barra
  // da série parecer uma queda que era só o calendário.
  const hoje = dataReferenciaPadrao();
  const ate = fimDoMes(inicioDoMes(hoje));
  const desde = inicioDoDia(config?.dataInicioBase ?? new Date(hoje.getFullYear() - 1, 0, 1));
  const mes = mesCompleto(periodo.dataReferencia);

  const escopoConsulta = { companyId: session.companyId, conexaoId: escopo.conexaoId };

  // EM SEQUÊNCIA, e não em paralelo — de propósito.
  //
  // A versão anterior disparava estas cinco com `Promise.all`, e duas delas
  // disparam mais duas cada por dentro: sete consultas simultâneas. No
  // Postgres local, por socket, isso é instantâneo; em produção é o pooler do
  // Neon com latência de rede, e o Prisma tem teto de conexões. Estourado o
  // teto, ele lança `Timed out fetching a new connection from the connection
  // pool` — exceção que derruba a página inteira, e foi o que aconteceu.
  //
  // O custo de serializar é somar as latências em vez de pegar a maior: umas
  // poucas centenas de milissegundos. O custo de não serializar é a tela não
  // abrir. O painel escapou por disparar três; esta foi a primeira a passar do
  // limite, e não seria a última.
  const serie = await serieMensal({ ...escopoConsulta, desde, ate });
  const receita = await composicaoDoPeriodo({ ...escopoConsulta, periodo: mes, natureza: "RECEBER" });
  const despesa = await composicaoDoPeriodo({ ...escopoConsulta, periodo: mes, natureza: "PAGAR" });
  const topReceber = await maioresTitulosDoPeriodo({ ...escopoConsulta, periodo: mes, natureza: "RECEBER" });
  const topPagar = await maioresTitulosDoPeriodo({ ...escopoConsulta, periodo: mes, natureza: "PAGAR" });
  const retencoes = await retencoesDoPeriodo({ ...escopoConsulta, periodo: mes });

  // Do mais recente para o mais antigo: quem abre esta tela quer o mês passado,
  // não janeiro do ano retrasado.
  const linhas = [...serie].reverse();

  // OS ACUMULADOS SEGUEM A COMPETÊNCIA ESCOLHIDA.
  //
  // Antes, os quatro cartões vinham sempre do último mês da série — o mês
  // corrente —, independentemente do que o seletor dizia. Escolher julho
  // trocava as tabelas de composição e deixava os cartões em agosto, sem nada
  // avisar: dois períodos diferentes na mesma tela, cada um parecendo o outro.
  //
  // Acumulado é do ano, DENTRO do ano, até o mês escolhido. Selecionar julho
  // tem que responder "como estava o acumulado no fechamento de julho" — que é
  // a pergunta que faz alguém escolher um mês fechado em vez de olhar o
  // corrente.
  const competenciaDoMes = `${mes.inicio.getFullYear()}-${String(mes.inicio.getMonth() + 1).padStart(2, "0")}`;
  const indiceDoMes = serie.findIndex((m) => m.competencia === competenciaDoMes);
  const fechamentoDoAno = (indiceDoMes >= 0 ? serie[indiceDoMes] : linhas[0]) ?? null;
  const ultimoAno = fechamentoDoAno?.competencia.slice(0, 4) ?? "";

  // O mês ANTERIOR ao escolhido, para a variação. Vem da série, que já está
  // ordenada e sem buracos — mês sem movimento entra zerado em vez de sumir, e
  // por isso `indice - 1` é sempre o mês de calendário anterior, e não "o
  // anterior que teve título".
  const mesAnteriorDaSerie = indiceDoMes > 0 ? serie[indiceDoMes - 1] : null;
  const variacao = (atual: number, anterior: number | undefined) =>
    anterior === undefined ? null : variacaoPercent(atual, anterior);

  // Link da planilha carrega o MESMO recorte da tela — empresa e competência.
  // Baixar um arquivo que ignora os filtros visíveis é a forma mais rápida de
  // alguém corrigir a categoria do mês errado.
  const filtros = new URLSearchParams();
  if (escopo.conexaoId) filtros.set("empresa", escopo.conexaoId);
  if (periodo.competencia) filtros.set("competencia", periodo.competencia);
  const urlDaPlanilha = `/api/exportar/composicao${filtros.toString() ? `?${filtros}` : ""}`;

  const tabelaComposicao = (dados: typeof receita) => (
    <Tabela
      colunas={["Categoria", "Tipo", "Conta", "Títulos", "Valor", "%"]}
      alinharDireita={[3, 4, 5]}
      vazio="Nenhum título com vencimento neste mês."
      linhas={dados.linhas.map((l) => [
        l.categoria,
        l.tipo,
        l.conta,
        fmtNumero(l.quantidade),
        fmtBRL(l.valorCents),
        fmtPercent(l.participacaoPercent),
      ])}
    />
  );

  const tabelaTitulos = (titulos: typeof topReceber) => (
    <Tabela
      colunas={["Vencimento", "Empresa", "Documento", "Parceiro", "Categoria", "Situação", "Valor"]}
      alinharDireita={[6]}
      vazio="Nenhum título com vencimento neste mês."
      linhas={titulos.map((t) => [
        fmtData(t.dataVencimento),
        t.conexaoApelido,
        t.numeroDocumento ?? "—",
        t.parceiroNome ?? "—",
        t.categoriaDescricao ?? "Sem categoria",
        t.liquidado ? "Liquidado" : "Em aberto",
        fmtBRL(t.valorDocumentoCents),
      ])}
    />
  );

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title="Resultado mês a mês"
        subtitle="Competência pela data de vencimento do título, como no painel e no relatório. O acumulado zera em janeiro, como em qualquer DRE gerencial."
      />

      <Filtros
        conexoes={conexoes}
        empresaAtiva={escopo.conexaoId}
        competencias={competenciasDisponiveis(config?.dataInicioBase ?? desde)}
        competenciaAtiva={periodo.competencia}
        rota="/resultados"
      />

      {/* O MÊS ESCOLHIDO, antes do acumulado.
          A tela existe para responder "como foi o mês"; o acumulado responde
          "como está o ano". Só o segundo estava em cartão, e o primeiro
          obrigava a caçar a linha certa na tabela lá embaixo — que é o
          movimento que ninguém faz quando está com pressa.

          A variação ao lado é contra o mês de calendário anterior, e não
          contra "o último mês que teve movimento": a série não tem buracos, e
          mês zerado comparando como zero é informação, não erro. */}
      {fechamentoDoAno && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi
            rotulo={`Receita — ${mes.rotulo}`}
            valor={fmtBRL(fechamentoDoAno.receitaCents)}
            apoio={
              mesAnteriorDaSerie
                ? `${fmtVariacao(variacao(fechamentoDoAno.receitaCents, mesAnteriorDaSerie.receitaCents))} vs ${mesAnteriorDaSerie.rotulo}`
                : "sem mês anterior na base"
            }
          />
          <Kpi
            rotulo={`Despesa — ${mes.rotulo}`}
            valor={fmtBRL(fechamentoDoAno.despesaCents)}
            apoio={
              mesAnteriorDaSerie
                ? `${fmtVariacao(variacao(fechamentoDoAno.despesaCents, mesAnteriorDaSerie.despesaCents))} vs ${mesAnteriorDaSerie.rotulo}`
                : "sem mês anterior na base"
            }
          />
          <Kpi
            rotulo={`Resultado — ${mes.rotulo}`}
            valor={fmtBRL(fechamentoDoAno.resultadoCents)}
            apoio={
              mesAnteriorDaSerie ? `${fmtBRL(mesAnteriorDaSerie.resultadoCents)} em ${mesAnteriorDaSerie.rotulo}` : undefined
            }
            tom={fechamentoDoAno.resultadoCents >= 0 ? "bom" : "ruim"}
          />
          <Kpi
            rotulo={`Margem — ${mes.rotulo}`}
            valor={fechamentoDoAno.margemPercent === null ? "—" : fmtPercent(fechamentoDoAno.margemPercent)}
            apoio={
              mesAnteriorDaSerie?.margemPercent !== null && mesAnteriorDaSerie
                ? `${fmtPercent(mesAnteriorDaSerie.margemPercent)} em ${mesAnteriorDaSerie.rotulo}`
                : undefined
            }
            tom={fechamentoDoAno.resultadoCents >= 0 ? "bom" : "ruim"}
          />
        </div>
      )}

      {fechamentoDoAno && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* "até julho/2026" e não só "2026": o acumulado depende do seletor,
              e um cartão que muda de valor sem mudar de rótulo é a forma mais
              rápida de alguém comparar dois períodos achando que é um só. */}
          <Kpi
            rotulo={`Receita acumulada ${ultimoAno}`}
            apoio={`Até ${mes.rotulo}`}
            valor={fmtBRL(fechamentoDoAno.receitaAcumuladaCents)}
          />
          <Kpi
            rotulo={`Despesa acumulada ${ultimoAno}`}
            apoio={`Até ${mes.rotulo}`}
            valor={fmtBRL(fechamentoDoAno.despesaAcumuladaCents)}
          />
          <Kpi
            apoio={`Até ${mes.rotulo}`}
            rotulo={`Resultado acumulado ${ultimoAno}`}
            valor={fmtBRL(fechamentoDoAno.resultadoAcumuladoCents)}
            tom={fechamentoDoAno.resultadoAcumuladoCents >= 0 ? "bom" : "ruim"}
          />
          <Kpi
            rotulo="Margem acumulada"
            apoio={`Até ${mes.rotulo}`}
            valor={fmtPercent(
              fechamentoDoAno.receitaAcumuladaCents > 0
                ? (fechamentoDoAno.resultadoAcumuladoCents / fechamentoDoAno.receitaAcumuladaCents) * 100
                : 0
            )}
            tom={fechamentoDoAno.resultadoAcumuladoCents >= 0 ? "bom" : "ruim"}
          />
        </div>
      )}

      {/* AVISO QUE PRECISA ESTAR AQUI, e não numa documentação que ninguém lê.
          O painel chama de "receita" a soma dos títulos a receber, e é comum
          essa soma não bater com o faturamento que a contabilidade enxerga —
          por três motivos concretos que a pessoa precisa saber ANTES de
          concluir que o sistema está errado, ou de concluir que está certo. */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <p className="text-sm font-medium text-slate-800">Como estes números são formados</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs leading-relaxed text-slate-600">
          <li>
            <strong>Por vencimento, não por nota fiscal.</strong> Serviço prestado em junho e faturado com vencimento
            em julho conta em julho. O faturamento que a contabilidade apura sai da nota emitida, e por isso pode
            divergir.
          </li>
          <li>
            <strong>Todo título a receber entra, de qualquer categoria.</strong> Aporte de sócio, empréstimo,
            reembolso, estorno e transferência entre contas também são &quot;a receber&quot; — a tabela abaixo mostra em
            qual categoria cada real está.
          </li>
          <li>
            <strong>Parcela conta no mês do seu vencimento.</strong> Um contrato em três vezes aparece em três meses.
          </li>
        </ul>
      </div>

      <Secao
        titulo={`Composição da receita — ${mes.rotulo}`}
        descricao={`${fmtBRL(receita.totalCents)} em ${fmtNumero(receita.quantidade)} título(s) a receber com vencimento no mês.`}
        acao={
          <div className="flex gap-3">
            {/* A planilha traz receita E despesa no mesmo arquivo — corrigir
                categorização exige olhar os dois lados junto. */}
            <a href={urlDaPlanilha} className="text-xs font-medium text-blue-700 hover:underline">
              Baixar planilha
            </a>
            <Link href="/titulos" className="text-xs font-medium text-blue-700 hover:underline">
              Ver todos os títulos
            </Link>
          </div>
        }
      >
        {tabelaComposicao(receita)}
      </Secao>

      <Secao
        titulo={`Maiores títulos a receber — ${mes.rotulo}`}
        descricao="A composição diz de onde vem; estes dizem qual documento é."
      >
        {tabelaTitulos(topReceber)}
      </Secao>

      <Secao
        titulo={`Composição da despesa — ${mes.rotulo}`}
        descricao={`${fmtBRL(despesa.totalCents)} em ${fmtNumero(despesa.quantidade)} título(s) a pagar com vencimento no mês.`}
        acao={
          <Link href="/titulos" className="text-xs font-medium text-blue-700 hover:underline">
            Ver todos os títulos
          </Link>
        }
      >
        {tabelaComposicao(despesa)}
      </Secao>

      <Secao
        titulo={`Maiores títulos a pagar — ${mes.rotulo}`}
        descricao="A composição diz de onde vem; estes dizem qual documento é."
      >
        {tabelaTitulos(topPagar)}
      </Secao>

      {/* RETENÇÕES — a diferença entre o que foi faturado e o que cai na conta.
          Sem esta tabela, o desconto do imposto retido aparece como conciliação
          que não fecha, todo mês, sem explicação. */}
      <Secao
        titulo={`Retenções na fonte — ${mes.rotulo}`}
        descricao="Imposto retido pelo tomador (a receber) ou retido pela empresa em nome do prestador (a pagar). Não é receita nem despesa: é a diferença entre o valor do título e o dinheiro que muda de mãos."
      >
        <Tabela
          colunas={["Tributo", "Retido sobre a receber", "Retido sobre a pagar"]}
          alinharDireita={[1, 2]}
          vazio="Nenhuma retenção lançada em título com vencimento neste mês."
          linhas={retencoes.linhas.map((l) => [l.tributo, fmtBRL(l.receberCents), fmtBRL(l.pagarCents)])}
        />
        {(retencoes.totalReceberCents !== 0 || retencoes.totalPagarCents !== 0) && (
          <p className="mt-3 text-xs text-slate-500">
            Total retido: <strong>{fmtBRL(retencoes.totalReceberCents)}</strong> em{" "}
            {fmtNumero(retencoes.titulosComRetencaoReceber)} título(s) a receber — este valor{" "}
            <strong>não entra na conta</strong>, e explica parte da diferença entre a receita do mês e o que foi
            depositado. E <strong>{fmtBRL(retencoes.totalPagarCents)}</strong> em{" "}
            {fmtNumero(retencoes.titulosComRetencaoPagar)} título(s) a pagar — obrigação a recolher em nome do
            prestador, que precisa bater com a guia.
          </p>
        )}
        <p className="mt-2 text-xs text-slate-500">
          Por tributo, e não somado: cada retenção tem guia, prazo e alíquota própria, e a conferência contra a DCTFWeb
          exige o número separado. Títulos espelhados antes desta versão aparecem com zero até a sincronização passar
          de novo pela janela deles.
        </p>
      </Secao>

      <Secao
        titulo="Competência — o mês em que o resultado foi gerado"
        descricao="Receita e despesa pelo vencimento dos títulos, independentemente de terem sido pagos. Responde 'a operação deu lucro no mês?'."
      >
        <Tabela
          colunas={[
            "Mês",
            "Receita",
            "Despesa",
            "Resultado",
            "Margem",
            "Acum. receita",
            "Acum. despesa",
            "Acum. resultado",
          ]}
          alinharDireita={[1, 2, 3, 4, 5, 6, 7]}
          linhas={linhas.map((m) => [
            m.rotulo,
            fmtBRL(m.receitaCents),
            fmtBRL(m.despesaCents),
            fmtBRL(m.resultadoCents),
            m.margemPercent === null ? "—" : fmtPercent(m.margemPercent),
            fmtBRL(m.receitaAcumuladaCents),
            fmtBRL(m.despesaAcumuladaCents),
            fmtBRL(m.resultadoAcumuladoCents),
          ])}
        />
      </Secao>

      <Secao
        titulo="Caixa — o mês em que o dinheiro entrou e saiu"
        descricao="Pelas baixas efetivamente registradas. Responde 'sobrou dinheiro na conta?'. Os dois regimes ficam separados de propósito: misturá-los é o erro mais comum de relatório gerencial, e o sintoma é o mês fechar no azul no resultado e no vermelho no banco."
      >
        <Tabela
          colunas={["Mês", "Recebido", "Pago", "Fluxo líquido", "Títulos a receber", "Títulos a pagar"]}
          alinharDireita={[1, 2, 3, 4, 5]}
          linhas={linhas.map((m) => [
            m.rotulo,
            fmtBRL(m.recebidoCents),
            fmtBRL(m.pagoCents),
            fmtBRL(m.fluxoLiquidoCents),
            fmtNumero(m.titulosReceber),
            fmtNumero(m.titulosPagar),
          ])}
        />
      </Secao>
    </div>
  );
}
