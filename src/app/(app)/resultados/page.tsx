import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { fmtBRL, fmtData, fmtNumero, fmtPercent, fmtVariacao, variacaoPercent } from "@/lib/controladoria/format";
import { serieMensal } from "@/lib/controladoria/serieMensal";
import { composicaoDoPeriodo, maioresTitulosDoPeriodo } from "@/lib/controladoria/composicao";
import { retencoesDoPeriodo } from "@/lib/controladoria/retencoes";
import { receitaFiscalDoPeriodo, receitaNaoOperacional } from "@/lib/controladoria/receitaFiscal";
import { dataReferenciaPadrao } from "@/lib/controladoria/ciclo";
import { fimDoMes, inicioDoDia, inicioDoMes, mesCompleto } from "@/lib/controladoria/periodos";
import PageHeader from "@/components/ui/PageHeader";
import { competenciasDisponiveis, resolverEscopo, resolverPeriodo, resolverRegime, sessaoControladoria } from "../_dados";
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
  searchParams: Promise<{ empresa?: string; competencia?: string; regime?: string }>;
}) {
  const session = await sessaoControladoria();
  const params = await searchParams;
  const escopo = await resolverEscopo(session.companyId, params.empresa);
  const periodo = resolverPeriodo(params.competencia);
  const regime = resolverRegime(params.regime);
  const noCaixa = regime === "caixa";

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
  const receita = await composicaoDoPeriodo({ ...escopoConsulta, periodo: mes, natureza: "RECEBER", regime });
  const despesa = await composicaoDoPeriodo({ ...escopoConsulta, periodo: mes, natureza: "PAGAR", regime });
  const topReceber = await maioresTitulosDoPeriodo({ ...escopoConsulta, periodo: mes, natureza: "RECEBER", regime });
  const topPagar = await maioresTitulosDoPeriodo({ ...escopoConsulta, periodo: mes, natureza: "PAGAR", regime });
  const retencoes = await retencoesDoPeriodo({ ...escopoConsulta, periodo: mes });
  const fiscal = await receitaFiscalDoPeriodo({ ...escopoConsulta, periodo: mes });
  const naoOperacional = await receitaNaoOperacional({ ...escopoConsulta, periodo: mes });

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

  // ACUMULADO DO ANO NO REGIME DE CAIXA.
  //
  // A série já traz o acumulado de competência pronto, zerando em janeiro. Para
  // caixa não havia equivalente, e mostrar o acumulado de competência ao lado
  // de cartões de caixa seria a mistura que o seletor existe para acabar.
  //
  // Somado aqui, sobre a mesma série e com a mesma regra de zerar na virada do
  // ano: são doze linhas na memória, não vale uma consulta a mais.
  const acumuladoDeCaixa = (() => {
    if (!fechamentoDoAno) return { recebido: 0, pago: 0, liquido: 0 };
    const ano = fechamentoDoAno.competencia.slice(0, 4);
    const ate = fechamentoDoAno.competencia;
    let recebido = 0;
    let pago = 0;
    for (const m of serie) {
      if (!m.competencia.startsWith(ano) || m.competencia > ate) continue;
      recebido += m.recebidoCents;
      pago += m.pagoCents;
    }
    return { recebido, pago, liquido: recebido - pago };
  })();
  const variacao = (atual: number, anterior: number | undefined) =>
    anterior === undefined ? null : variacaoPercent(atual, anterior);

  // Link da planilha carrega o MESMO recorte da tela — empresa e competência.
  // Baixar um arquivo que ignora os filtros visíveis é a forma mais rápida de
  // alguém corrigir a categoria do mês errado.
  const filtros = new URLSearchParams();
  if (escopo.conexaoId) filtros.set("empresa", escopo.conexaoId);
  if (periodo.competencia) filtros.set("competencia", periodo.competencia);
  if (noCaixa) filtros.set("regime", "caixa");
  const urlDaPlanilha = `/api/exportar/composicao${filtros.toString() ? `?${filtros}` : ""}`;
  // Mesma querystring: a lista de notas serve para conferir contra o que a
  // Omie exporta, e conferir o mês errado é o jeito mais rápido de concluir
  // que falta nota quando não falta.
  const urlDasNotas = `/api/exportar/notas${filtros.toString() ? `?${filtros}` : ""}`;

  const tabelaComposicao = (dados: typeof receita) => (
    <Tabela
      colunas={["Categoria", "Tipo", "Conta", "Títulos", "Valor", "%"]}
      alinharDireita={[3, 4, 5]}
      vazio={noCaixa ? "Nenhuma baixa registrada neste mês." : "Nenhum título emitido neste mês."}
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
      vazio={noCaixa ? "Nenhuma baixa registrada neste mês." : "Nenhum título emitido neste mês."}
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
        subtitle={
          noCaixa
            ? "Regime de CAIXA: pelo dinheiro que entrou e saiu, na data da baixa. Responde \u201Csobrou dinheiro no mês?\u201D."
            : "Regime de COMPETÊNCIA: pela data de emissão do documento — o critério que bate com a declaração de faturamento da contabilidade. Responde \u201Ca operação deu lucro no mês?\u201D. O acumulado zera em janeiro."
        }
      />

      <Filtros
        conexoes={conexoes}
        empresaAtiva={escopo.conexaoId}
        competencias={competenciasDisponiveis(config?.dataInicioBase ?? desde)}
        competenciaAtiva={periodo.competencia}
        regimeAtivo={regime}
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
            rotulo={`${noCaixa ? "Recebido" : "Receita"} — ${mes.rotulo}`}
            valor={fmtBRL(noCaixa ? fechamentoDoAno.recebidoCents : fechamentoDoAno.receitaCents)}
            apoio={
              mesAnteriorDaSerie
                ? `${fmtVariacao(
                    noCaixa
                      ? variacao(fechamentoDoAno.recebidoCents, mesAnteriorDaSerie.recebidoCents)
                      : variacao(fechamentoDoAno.receitaCents, mesAnteriorDaSerie.receitaCents)
                  )} vs ${mesAnteriorDaSerie.rotulo}`
                : "sem mês anterior na base"
            }
          />
          <Kpi
            rotulo={`${noCaixa ? "Pago" : "Despesa"} — ${mes.rotulo}`}
            valor={fmtBRL(noCaixa ? fechamentoDoAno.pagoCents : fechamentoDoAno.despesaCents)}
            apoio={
              mesAnteriorDaSerie
                ? `${fmtVariacao(
                    noCaixa
                      ? variacao(fechamentoDoAno.pagoCents, mesAnteriorDaSerie.pagoCents)
                      : variacao(fechamentoDoAno.despesaCents, mesAnteriorDaSerie.despesaCents)
                  )} vs ${mesAnteriorDaSerie.rotulo}`
                : "sem mês anterior na base"
            }
          />
          <Kpi
            rotulo={`${noCaixa ? "Fluxo líquido" : "Resultado"} — ${mes.rotulo}`}
            valor={fmtBRL(noCaixa ? fechamentoDoAno.fluxoLiquidoCents : fechamentoDoAno.resultadoCents)}
            apoio={
              mesAnteriorDaSerie
                ? `${fmtBRL(
                    noCaixa ? mesAnteriorDaSerie.fluxoLiquidoCents : mesAnteriorDaSerie.resultadoCents
                  )} em ${mesAnteriorDaSerie.rotulo}`
                : undefined
            }
            tom={(noCaixa ? fechamentoDoAno.fluxoLiquidoCents : fechamentoDoAno.resultadoCents) >= 0 ? "bom" : "ruim"}
          />
          {/* Margem é razão entre resultado e receita — conceito de
              competência. No caixa a leitura equivalente é a conversão: quanto
              do que entrou sobrou depois do que saiu. */}
          <Kpi
            rotulo={`${noCaixa ? "Conversão de caixa" : "Margem"} — ${mes.rotulo}`}
            valor={
              noCaixa
                ? fechamentoDoAno.recebidoCents > 0
                  ? fmtPercent((fechamentoDoAno.fluxoLiquidoCents / fechamentoDoAno.recebidoCents) * 100)
                  : "—"
                : fechamentoDoAno.margemPercent === null
                  ? "—"
                  : fmtPercent(fechamentoDoAno.margemPercent)
            }
            apoio={
              !noCaixa && mesAnteriorDaSerie && mesAnteriorDaSerie.margemPercent !== null
                ? `${fmtPercent(mesAnteriorDaSerie.margemPercent)} em ${mesAnteriorDaSerie.rotulo}`
                : undefined
            }
            tom={(noCaixa ? fechamentoDoAno.fluxoLiquidoCents : fechamentoDoAno.resultadoCents) >= 0 ? "bom" : "ruim"}
          />
        </div>
      )}

      {fechamentoDoAno && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* "até julho/2026" e não só "2026": o acumulado depende do seletor,
              e um cartão que muda de valor sem mudar de rótulo é a forma mais
              rápida de alguém comparar dois períodos achando que é um só. */}
          <Kpi
            rotulo={`${noCaixa ? "Recebido acumulado" : "Receita acumulada"} ${ultimoAno}`}
            apoio={`Até ${mes.rotulo}`}
            valor={fmtBRL(noCaixa ? acumuladoDeCaixa.recebido : fechamentoDoAno.receitaAcumuladaCents)}
          />
          <Kpi
            rotulo={`${noCaixa ? "Pago acumulado" : "Despesa acumulada"} ${ultimoAno}`}
            apoio={`Até ${mes.rotulo}`}
            valor={fmtBRL(noCaixa ? acumuladoDeCaixa.pago : fechamentoDoAno.despesaAcumuladaCents)}
          />
          <Kpi
            apoio={`Até ${mes.rotulo}`}
            rotulo={`${noCaixa ? "Fluxo acumulado" : "Resultado acumulado"} ${ultimoAno}`}
            valor={fmtBRL(noCaixa ? acumuladoDeCaixa.liquido : fechamentoDoAno.resultadoAcumuladoCents)}
            tom={(noCaixa ? acumuladoDeCaixa.liquido : fechamentoDoAno.resultadoAcumuladoCents) >= 0 ? "bom" : "ruim"}
          />
          <Kpi
            rotulo={noCaixa ? "Conversão acumulada" : "Margem acumulada"}
            apoio={`Até ${mes.rotulo}`}
            valor={fmtPercent(
              noCaixa
                ? acumuladoDeCaixa.recebido > 0
                  ? (acumuladoDeCaixa.liquido / acumuladoDeCaixa.recebido) * 100
                  : 0
                : fechamentoDoAno.receitaAcumuladaCents > 0
                  ? (fechamentoDoAno.resultadoAcumuladoCents / fechamentoDoAno.receitaAcumuladaCents) * 100
                  : 0
            )}
            tom={(noCaixa ? acumuladoDeCaixa.liquido : fechamentoDoAno.resultadoAcumuladoCents) >= 0 ? "bom" : "ruim"}
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

      {/* FATURAMENTO x TÍTULOS A RECEBER — a conciliação que faltava.
          "A receita não pode pegar pelo banco, tem que ser pelas notas fiscais
          emitidas." Está certo, e a composição do mês prova: dentro dos
          títulos a receber havia resgate de consórcio, venda de veículo,
          lucros cessantes e devolução de PIX.

          Os dois números ficam lado a lado em vez de um substituir o outro,
          porque respondem perguntas diferentes — "quanto faturei" e "quanto
          tenho a receber" — e porque o faturamento aqui ainda é PARCIAL: o
          espelho guarda NF-e e NFS-e, não CT-e. */}
      <Secao
        titulo={`Faturamento x títulos a receber — ${mes.rotulo}`}
        descricao="Faturamento é nota emitida, não cancelada, pela data de emissão — o número que a contabilidade declara. Título a receber é cobrança, pela data de vencimento. Os dois divergem por motivo legítimo, e a diferença é o que esta seção existe para nomear."
        acao={
          <a href={urlDasNotas} className="text-xs font-medium text-blue-700 hover:underline">
            Baixar lista de notas
          </a>
        }
      >
        <Tabela
          colunas={["Origem", "Documentos", "Valor"]}
          alinharDireita={[1, 2]}
          vazio="Sem notas emitidas no mês."
          linhas={[
            ...fiscal.linhas.map((l) => [l.rotulo, fmtNumero(l.quantidade), fmtBRL(l.valorCents)]),
            [
              <strong key="tf">Faturamento espelhado (parcial)</strong>,
              <strong key="tq">{fmtNumero(fiscal.quantidade)}</strong>,
              <strong key="tv">{fmtBRL(fiscal.totalCents)}</strong>,
            ],
            [
              "CT-e — não espelhado, medido pelos títulos",
              fmtNumero(fiscal.cteEmTitulos),
              fmtBRL(fiscal.cteEmTitulosCents),
            ],
            [
              <strong key="ef">Faturamento pelo título, por data de EMISSÃO</strong>,
              <strong key="eq">{fmtNumero(fiscal.fiscaisPorEmissao)}</strong>,
              <strong key="ev">{fmtBRL(fiscal.fiscaisPorEmissaoCents)}</strong>,
            ],
            [
              "Todos os títulos emitidos no mês (inclui cobrança sem nota)",
              "",
              fmtBRL(fiscal.todosPorEmissaoCents),
            ],
            [
              <strong key="rf">Receita por título, por data de VENCIMENTO</strong>,
              <strong key="rq">{fmtNumero(receita.quantidade)}</strong>,
              <strong key="rv">{fmtBRL(receita.totalCents)}</strong>,
            ],
            [
              "Diferença (vencimento − emissão)",
              "",
              fmtBRL(receita.totalCents - fiscal.fiscaisPorEmissaoCents),
            ],
            [
              <span key="cc" className={fiscal.canceladasComTitulo > 0 ? "font-medium text-red-700" : undefined}>
                Nota CANCELADA com título ativo — não deveria contar
              </span>,
              fmtNumero(fiscal.canceladasComTitulo),
              <span key="ccv" className={fiscal.canceladasComTitulo > 0 ? "font-medium text-red-700" : undefined}>
                {fmtBRL(fiscal.canceladasComTituloCents)}
              </span>,
            ],
          ]}
        />
        {fiscal.canceladasComTitulo > 0 && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-900">
            <strong>
              {fmtBRL(fiscal.canceladasComTituloCents)} em {fmtNumero(fiscal.canceladasComTitulo)} título(s) estão neste
              mês com a nota fiscal já cancelada.
            </strong>{" "}
            Cancelar a nota na prefeitura não cancela o título na Omie — são dois atos, e o segundo é manual. Enquanto o
            título viver, ele conta no resultado. O conserto é cancelar o título na Omie; aqui a correção não é feita
            sozinha, porque apagar receita por conta própria é a última coisa que um sistema de auditoria deve fazer.
          </p>
        )}
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs leading-relaxed text-emerald-900">
          <strong>Para conferir com a contabilidade, use a linha de EMISSÃO.</strong> Conferida contra a declaração de
          faturamento assinada, doze meses, extraída da própria Omie: os títulos com documento fiscal somados pela data
          de emissão ficam a 3,3% da declaração no acumulado, e entre −7,4% e +0,3% mês a mês. Os mesmos títulos pela
          data de vencimento ficavam 32% acima. A diferença nunca foi dado faltando — era a pergunta trocada.
          Vencimento responde &quot;quanto tenho a receber neste mês&quot;; emissão responde &quot;quanto faturei&quot;.
        </p>
        <p className="mt-3 text-xs text-slate-500">
          <strong>O faturamento acima está incompleto de propósito.</strong> O espelho guarda NF-e e NFS-e; a operação
          também emite <strong>CT-e</strong>, e esse documento ainda não tem endpoint de leitura configurado. A linha do
          CT-e mede o buraco pelo lado da cobrança — é o valor dos títulos que a Omie marcou com esse tipo de documento,
          não o valor das notas. Somar as duas linhas dá a melhor estimativa possível hoje.
        </p>
        {naoOperacional.linhas.length > 0 && (
          <>
            <p className="mt-4 text-sm font-medium text-slate-800">
              Títulos a receber que não são receita de operação — {fmtBRL(naoOperacional.totalCents)}
            </p>
            <div className="mt-2">
              <Tabela
                colunas={["Categoria", "Títulos", "Valor"]}
                alinharDireita={[1, 2]}
                vazio="Nenhum."
                linhas={naoOperacional.linhas.map((l) => [
                  l.categoria,
                  fmtNumero(l.quantidade),
                  fmtBRL(l.valorCents),
                ])}
              />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Lista montada por PALAVRA na descrição da categoria — consórcio, venda de veículo, sinistro, reembolso,
              devolução, estorno, transferência, aporte, empréstimo. É uma heurística para dirigir o olho de quem vai
              reclassificar na Omie, não uma classificação contábil: confira antes de usar.
            </p>
          </>
        )}
      </Secao>

      <Secao
        titulo={`Composição ${noCaixa ? "do recebido" : "da receita"} — ${mes.rotulo}`}
        descricao={`${fmtBRL(receita.totalCents)} em ${fmtNumero(receita.quantidade)} ${noCaixa ? "baixa(s) registrada(s)" : "título(s) a receber emitido(s)"} no mês.`}
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
        titulo={`Composição ${noCaixa ? "do pago" : "da despesa"} — ${mes.rotulo}`}
        descricao={`${fmtBRL(despesa.totalCents)} em ${fmtNumero(despesa.quantidade)} ${noCaixa ? "baixa(s) registrada(s)" : "título(s) a pagar emitido(s)"} no mês.`}
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
            "Faturamento (notas)",
            "Receita (títulos)",
            "Despesa",
            "Resultado",
            "Margem",
            "Acum. receita",
            "Acum. despesa",
            "Acum. resultado",
          ]}
          alinharDireita={[1, 2, 3, 4, 5, 6, 7, 8]}
          linhas={linhas.map((m) => [
            m.rotulo,
            fmtBRL(m.receitaFiscalCents),
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
