import { montarComparativo, ranking } from "@/lib/controladoria/analytics";
import { montarDre, montarDreAnual } from "@/lib/controladoria/dre";
import { prisma } from "@/lib/prisma";
import TabelaDre from "./TabelaDre";
import TabelaDreAnual from "./TabelaDreAnual";
import { analisarEstrategiaDeCusto, ROTULO_CLASSIFICACAO } from "@/lib/controladoria/estrategiaCusto";
import { fmtBRL, fmtData, fmtNumero, fmtPercent } from "@/lib/controladoria/format";
import { larguraPainel, secondaryButtonClass } from "@/lib/ui";
import {
  anosDisponiveis,
  competenciasDisponiveis,
  contextoDaPagina,
  resolverAno,
  resolverPeriodo,
  resolverRegime,
} from "../_dados";
import { Kpi, Secao, Tabela } from "../_componentes";
import Filtros from "../Filtros";

// Mesmo mês, um ano antes. O mês INTEIRO, mesmo quando o atual está pela
// metade: comparar agosto até o dia 26 com agosto inteiro do ano passado daria
// uma queda que é só de calendário. A tela diz que a comparação é com o mês
// fechado, e quem lê decide o que fazer com isso.
function mesmoMesAnoAnterior(mes: { inicio: Date }) {
  const inicio = new Date(mes.inicio.getFullYear() - 1, mes.inicio.getMonth(), 1, 0, 0, 0, 0);
  const fim = new Date(mes.inicio.getFullYear() - 1, mes.inicio.getMonth() + 1, 0, 23, 59, 59, 999);
  return { inicio, fim, rotulo: `${inicio.getFullYear()}` };
}

// CUSTOS E DRE.
//
// A demonstração segue a estrutura do art. 187 da Lei 6.404/76 — receita
// bruta, deduções, receita líquida, custo, lucro bruto, despesas, EBIT,
// resultado financeiro, tributos, resultado líquido. Nessa ordem, porque a
// ordem É a demonstração.
//
// O que liga essa estrutura ao plano de categorias REAL da empresa é dado
// editável, não regra no código (ver DreClassificacao): a Omie diz se a
// categoria é receita ou despesa, mas não diz se uma despesa é custo do
// serviço ou despesa operacional — e é essa distinção que separa lucro bruto
// de resultado operacional.
//
// Categoria em branco fica FORA da demonstração, num aviso à parte. Diluí-la
// faria o DRE fechar escondendo justamente o que falta classificar.

export default async function CustosPage({
  searchParams,
}: {
  searchParams: Promise<{ empresa?: string; competencia?: string; regime?: string; visao?: string }>;
}) {
  const params = await searchParams;
  // VISÃO ANUAL carrega o ano inteiro; a mensal, a janela de sempre.
  //
  // A janela maior fica atrelada à visão, e não vira padrão: carregar um ano de
  // títulos em toda abertura de tela foi o que já esgotou a franquia de
  // transferência do banco uma vez, derrubando junto o sistema de gestão que
  // divide o mesmo Postgres. Quem pede o ano paga pelo ano.
  const anual = params.visao === "ano";
  // NA VISÃO ANUAL O MESMO PARÂMETRO CARREGA UM ANO, não uma competência —
  // "2026" em vez de "2026-07". A caixa de seleção é a mesma; o que ela oferece
  // muda com a visão, e é assim que se escolhe o ano.
  //
  // O ano vira `AAAA-12` na hora de resolver o período: dezembro de um ano
  // passado é uma competência válida e dá a data de referência certa (31/12);
  // dezembro do ano corrente é futuro, e `resolverPeriodo` cai sozinho na
  // leitura corrente — que é exatamente o que se quer para o ano em curso.
  const anoDaTela = anual ? resolverAno(params.competencia) : 0;
  // A JANELA COBRE O MESMO MÊS DO ANO PASSADO, na visão mensal — treze meses
  // em vez de três. É o custo do comparativo ano contra ano, e ele é pago só
  // aqui: nenhuma outra tela precisa dessa profundidade.
  const referenciaProvisoria = resolverPeriodo(anual ? `${anoDaTela}-12` : params.competencia).dataReferencia;
  const { ctx, escopo, periodo } = await contextoDaPagina(
    params.empresa,
    anual ? `${anoDaTela}-12` : params.competencia,
    anual
      ? new Date(anoDaTela, 0, 1)
      : new Date(referenciaProvisoria.getFullYear() - 1, referenciaProvisoria.getMonth(), 1)
  );
  const regime = resolverRegime(params.regime);

  const comparativo = await montarComparativo(ctx);

  const guardadas = await prisma.dreClassificacao.findMany({
    where: { companyId: ctx.companyId },
    select: { categoriaCodigo: true, linha: true, subgrupo: true, origem: true },
  });
  const classificacoes = new Map(
    guardadas.map((c) => [
      c.categoriaCodigo,
      { linha: c.linha, subgrupo: c.subgrupo, confirmada: c.origem === "CONFIRMADA" },
    ])
  );
  // Montado no servidor e passado pronto: o componente da tabela é de cliente,
  // e mandar o cadastro inteiro de categorias para o navegador só para extrair
  // quatro campos seria carga que ninguém vê e todos pagam.
  const marcasPorCategoria: Record<string, string> = {};
  for (const c of ctx.categorias) {
    const marcas = [
      c.codigoDre ? `DRE ${c.codigoDre}` : null,
      c.tipoCategoria,
      c.contaReceita ? "receita" : null,
      c.contaDespesa ? "despesa" : null,
    ].filter(Boolean);
    if (marcas.length > 0) marcasPorCategoria[c.codigo] = marcas.join(" · ");
  }
  const subgruposConhecidos = [...new Set(guardadas.map((c) => c.subgrupo).filter((s): s is string => !!s))].sort();

  const dreAnual = anual
    ? montarDreAnual(ctx, anoDaTela, classificacoes, {
        somarRetencoes: ctx.config.retencoesNasDeducoes,
        regime,
      })
    : null;

  const dre = montarDre(
    ctx,
    comparativo.janelas.mesAtual,
    comparativo.janelas.mesAnterior,
    classificacoes,
    {
      somarRetencoes: ctx.config.retencoesNasDeducoes,
      regime,
      periodoAnoAnterior: anual ? undefined : mesmoMesAnoAnterior(comparativo.janelas.mesAtual),
    }
  );

  // LINHA VAZIA NÃO É MOSTRADA, e subtotal repetido tampouco.
  //
  // Sem custo dos serviços classificado, "custo" dá R$ 0,00 e o lucro bruto
  // repete a receita líquida — duas linhas dizendo o mesmo número, com a
  // segunda sugerindo uma informação que ela não tem. O mesmo vale para
  // "despesas comerciais" e "despesas administrativas" enquanto nada estiver
  // classificado ali.
  //
  // A que SOBREVIVE do par é a receita líquida, e não o lucro bruto. Lucro
  // bruto é, por definição, receita líquida menos o custo do serviço: sem o
  // custo, chamar o número de lucro bruto seria dar-lhe um nome que ele não
  // tem — e esta demonstração vai ser comparada com a da contabilidade.
  // Assim que qualquer categoria for classificada em custo, as duas linhas
  // voltam sozinhas e passam a divergir, que é quando o lucro bruto começa a
  // significar alguma coisa.
  //
  // Grupo com ITENS aparece mesmo somando zero: ali existe movimento, e
  // escondê-lo esconderia o que precisa ser olhado.
  const linhasVisiveis: typeof dre.linhas = [];
  let ultimoSubtotal: number | null = null;
  for (const linha of dre.linhas) {
    if (linha.tipo === "GRUPO") {
      if (linha.valorCents === 0 && linha.valorAnteriorCents === 0 && linha.itens.length === 0) continue;
      linhasVisiveis.push(linha);
      ultimoSubtotal = null;
      continue;
    }
    // Subtotal que repete o anterior só acrescenta ruído — a não ser o último,
    // que é o resultado do período e fecha a demonstração.
    const repetido = ultimoSubtotal !== null && linha.valorCents === ultimoSubtotal;
    if (repetido && linha.chave !== "RESULTADO_LIQUIDO") continue;
    linhasVisiveis.push(linha);
    ultimoSubtotal = linha.valorCents;
  }
  const linhasOcultas = dre.linhas.length - linhasVisiveis.length;
  const totalDespesa = dre.linhas
    .filter((l) => l.tipo === "GRUPO" && l.chave !== "RECEITA_BRUTA" && l.chave !== "RECEITA_FINANCEIRA")
    .reduce((a, l) => a + l.valorCents, 0);

  const fornecedores = ranking(ctx, comparativo.janelas.mesAtual, "PAGAR", 15);
  const estrategia = analisarEstrategiaDeCusto(ctx);

  const filtros = new URLSearchParams();
  if (escopo.conexaoId) filtros.set("empresa", escopo.conexaoId);
  if (periodo.competencia) filtros.set("competencia", periodo.competencia);
  const urlDaPlanilha = `/api/exportar/composicao${filtros.toString() ? `?${filtros}` : ""}`;
  if (regime === "caixa") filtros.set("regime", "caixa");
  const urlDaConferencia = `/api/exportar/dre${filtros.toString() ? `?${filtros}` : ""}`;

  return (
    /* LARGURA LIVRE NESTA TELA, e não os 1024px das demais.
       O DRE anual tem doze colunas de mês mais total e percentual; o mensal
       ganhou o comparativo ano contra ano. Presos a max-w-5xl, os dois
       rolavam de lado numa tela de 1900px que estava mais da metade vazia — e
       tabela financeira que rola de lado é tabela que não se compara, porque
       a linha some do campo de visão junto com o número.
       O TETO DE 1800px continua existindo: sem nenhum, num monitor
       ultralargo a primeira coluna e a última ficam a meio metro uma da
       outra. */
    <div className={`${larguraPainel} space-y-6`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Custos e DRE gerencial</h1>
          <p className="mt-1 text-sm text-slate-500">
            {comparativo.janelas.mesAtual.rotulo} até {fmtData(ctx.dataReferencia)}, comparado ao mês anterior inteiro.
            {regime === "caixa"
              ? "Regime de CAIXA: entra o que foi pago ou recebido no mês, pela data da baixa."
              : "Regime de COMPETÊNCIA, pela data de emissão do documento."}
          </p>
        </div>
        {/* Corrigir categorização é trabalho de lista, não de tela: exige
            ordenar, filtrar e riscar conforme se resolve. A planilha traz
            receita e despesa juntas, com o mesmo recorte de empresa e
            competência que está visível aqui. */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Mês ou ano. São perguntas diferentes: "como foi julho" e "o que
              mudou ao longo do ano". Um seletor, e não duas telas, porque a
              segunda pergunta quase sempre nasce da primeira. */}
          <div className="mr-1 flex rounded-full bg-slate-100 p-0.5">
            {[
              { valor: "mes", rotulo: "Mês" },
              { valor: "ano", rotulo: "Ano" },
            ].map((v) => {
              const q = new URLSearchParams(filtros);
              // O PERÍODO É TRADUZIDO NA TROCA, não descartado. Quem está
              // olhando julho/2025 e clica em "Ano" quer 2025, não o ano
              // corrente — perder o ano a cada clique seria o mesmo defeito
              // que o filtro de empresa evita ao preservar a competência.
              const anoCorrente = new Date().getFullYear();
              if (v.valor === "ano") {
                q.set("visao", "ano");
                const anoAlvo = anual ? anoDaTela : (periodo.competencia?.slice(0, 4) ?? String(anoCorrente));
                if (String(anoAlvo) !== String(anoCorrente)) q.set("competencia", String(anoAlvo));
                else q.delete("competencia");
              } else {
                q.delete("visao");
                // Ano passado vira dezembro daquele ano; ano corrente volta à
                // leitura corrente, que é o padrão da visão mensal.
                if (anual && anoDaTela !== anoCorrente) q.set("competencia", `${anoDaTela}-12`);
                else if (anual) q.delete("competencia");
              }
              const ativo = (v.valor === "ano") === anual;
              return (
                <a
                  key={v.valor}
                  href={`/custos${q.toString() ? `?${q}` : ""}`}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    ativo ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {v.rotulo}
                </a>
              );
            })}
          </div>
          {/* Duas planilhas, e não uma com tudo: elas servem a trabalhos
              diferentes. A de composição é para corrigir a CATEGORIA na Omie;
              a de conferência do DRE é para julgar em que LINHA a categoria
              caiu, e traz os campos do cadastro Omie lado a lado justamente
              para isso. Juntá-las daria uma planilha que ninguém percorre
              inteira. */}
          {/* As duas planilhas são MENSAIS. Na visão anual isso precisa estar
              no rótulo: um arquivo baixado enquanto a tela mostra doze meses
              seria aberto esperando doze meses, e a decepção acontece longe
              daqui, quando ninguém pode explicar. */}
          <a href={urlDaConferencia} className={secondaryButtonClass}>
            Planilha de conferência do DRE{anual ? ` — ${comparativo.janelas.mesAtual.rotulo}` : ""}
          </a>
          <a href={urlDaPlanilha} className={secondaryButtonClass}>
            Composição por categoria
          </a>
        </div>
      </div>

      <Filtros
        conexoes={ctx.conexoes}
        empresaAtiva={escopo.conexaoId}
        competencias={anual ? anosDisponiveis(ctx.config.dataInicioBase) : competenciasDisponiveis(ctx.config.dataInicioBase)}
        competenciaAtiva={anual ? (anoDaTela === new Date().getFullYear() ? null : String(anoDaTela)) : periodo.competencia}
        regimeAtivo={regime}
        rotuloPeriodo={anual ? "Ano" : "Competência"}
        rotuloPeriodoPadrao={anual ? `${new Date().getFullYear()} (ano corrente)` : "Leitura corrente (D-1)"}
        extras={{ visao: anual ? "ano" : undefined }}
        rota="/custos"
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          rotulo={anual ? `Receita líquida ${anoDaTela}` : "Receita líquida"}
          valor={fmtBRL(dreAnual?.receitaLiquidaCents ?? dre.receitaLiquidaCents)}
          apoio="Receita bruta menos as deduções"
        />
        <Kpi
          rotulo="Lucro bruto"
          valor={fmtBRL(
            dreAnual
              ? (dreAnual.linhas.find((l) => l.chave === "LUCRO_BRUTO")?.totalCents ?? 0)
              : (dre.linhas.find((l) => l.chave === "LUCRO_BRUTO")?.valorCents ?? 0)
          )}
          apoio={`${fmtPercent(
            (dreAnual ?? dre).linhas.find((l) => l.chave === "LUCRO_BRUTO")?.percentReceitaLiquida ?? null
          )} da receita líquida`}
        />
        <Kpi
          rotulo="Resultado líquido"
          valor={fmtBRL(dreAnual?.resultadoLiquidoCents ?? dre.resultadoLiquidoCents)}
          apoio={`Margem ${fmtPercent(dreAnual?.margemLiquidaPercent ?? dre.margemLiquidaPercent)}`}
          tom={(dreAnual?.resultadoLiquidoCents ?? dre.resultadoLiquidoCents) >= 0 ? "bom" : "ruim"}
        />
        <Kpi
          rotulo="Por classificar"
          valor={fmtBRL(
            (dreAnual?.naoConfirmadoCents ?? dre.naoConfirmadoCents) +
              (dreAnual?.semCategoriaCents ?? dre.semCategoriaCents)
          )}
          apoio="Movimento em categoria que ninguém confirmou ainda"
          tom={
            (dreAnual?.naoConfirmadoCents ?? dre.naoConfirmadoCents) +
              (dreAnual?.semCategoriaCents ?? dre.semCategoriaCents) >
            0
              ? "atencao"
              : "bom"
          }
        />
      </div>

      {(dre.naoConfirmadoCents > 0 || dre.semCategoriaCents > 0) && (
        <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Este DRE ainda não foi conferido por inteiro.</strong>{" "}
          {dre.naoConfirmadoCents > 0 && (
            <>
              {fmtBRL(dre.naoConfirmadoCents)} estão em categorias classificadas por dedução automática — e a dedução é
              conservadora de propósito: toda despesa que o sistema não reconhece com segurança cai em{" "}
              <em>outras despesas operacionais</em>, que é a única linha que não desloca o lucro bruto por engano.
              Enquanto houver valor aqui, a margem bruta está subestimada.{" "}
            </>
          )}
          {dre.semCategoriaCents > 0 && (
            <>
              {fmtBRL(dre.semCategoriaCents)} estão em títulos <strong>sem categoria nenhuma</strong> na Omie e ficaram
              fora da demonstração — o conserto desses é lá, não aqui.
            </>
          )}
        </div>
      )}

      <Secao
        titulo="Demonstração do resultado"
        descricao={
          `${anual ? `Janeiro a ${dreAnual?.meses[dreAnual.meses.length - 1]?.rotulo ?? "dezembro"} de ${anoDaTela}, valores dos meses em MILHARES de reais` : comparativo.janelas.mesAtual.rotulo}, na estrutura do art. 187 da Lei 6.404/76. ` +
          `Percentuais sobre a receita líquida. ` +
          (regime === "caixa"
            ? "Regime de CAIXA — o que se moveu na conta, pela data da baixa."
            : "Regime de COMPETÊNCIA — o que aconteceu, pela data de emissão.") +
          (anual
            ? ""
            : " A coluna do ano anterior é o MESMO MÊS, fechado — comparar um mês pela metade com um mês inteiro daria uma queda que é só de calendário.")
        }
      >
        {dreAnual ? (
          <TabelaDreAnual dre={dreAnual} />
        ) : (
          <TabelaDre
            linhas={linhasVisiveis}
            subgruposConhecidos={subgruposConhecidos}
            marcasPorCategoria={marcasPorCategoria}
            anoAnterior={comparativo.janelas.mesAtual.inicio.getFullYear() - 1}
          />
        )}

        {!anual && dre.retencoes.totalCents > 0 && (
          <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Retido na fonte pelos clientes — não somado acima
            </p>
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-700">
              {[
                ["ISS", dre.retencoes.issCents],
                ["PIS", dre.retencoes.pisCents],
                ["COFINS", dre.retencoes.cofinsCents],
                ["CSLL", dre.retencoes.csllCents],
                ["IR", dre.retencoes.irCents],
                ["INSS", dre.retencoes.inssCents],
              ]
                .filter(([, v]) => (v as number) > 0)
                .map(([nome, v]) => (
                  <span key={nome as string}>
                    {nome as string}{" "}
                    <strong className="tabular-nums">{fmtBRL(v as number)}</strong>
                  </span>
                ))}
              <span className="font-semibold">
                Total <span className="tabular-nums">{fmtBRL(dre.retencoes.totalCents)}</span>
              </span>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-slate-600">
              São tributos que o cliente reteve e recolheu no lugar da empresa, em{" "}
              {fmtNumero(dre.retencoes.titulosComRetencao)} título(s) do mês.{" "}
              <strong>Ficam de fora das deduções de propósito, porque somá-los pode contar o mesmo imposto duas vezes.</strong>{" "}
              Depende de como a empresa lança: se o imposto retido não vira título a pagar, estes valores{" "}
              <em>completam</em> a linha de deduções e deveriam ser somados; se a empresa lança o imposto cheio e abate a
              retenção na hora de recolher, o título já contém este valor e somar duplicaria. A diferença está na prática
              de lançamento, não no registro — por isso o sistema mostra os dois lados em vez de escolher.
            </p>
            <p className="mt-2 text-xs leading-relaxed text-slate-600">
              <strong>Como decidir em um minuto:</strong> pegue um título de imposto do mês e veja se o valor dele é o
              imposto cheio sobre o faturamento ou só o saldo depois da retenção. Me diga qual dos dois e eu passo a
              somar — ou deixo como está.
            </p>
          </div>
        )}

        {!anual && linhasOcultas > 0 && (
          <p className="mt-3 text-xs text-slate-500">
            {linhasOcultas} linha(s) da estrutura não aparecem por estarem zeradas e sem nenhuma categoria — entre elas,
            as que ainda não receberam classificação. Elas voltam sozinhas assim que houver movimento classificado ali,
            e continuam disponíveis no seletor de cada categoria.
          </p>
        )}

        <p className="mt-4 text-xs text-slate-500">
          <strong>IRPJ e CSLL entram como dedução da receita bruta</strong>, e não abaixo do resultado antes dos
          tributos. É uma escolha da empresa, com razão de negócio: no Lucro Presumido a base dos dois é uma presunção
          sobre a receita — 16% para transporte de passageiros, 12% de CSLL —, então eles se comportam como percentual
          do faturamento, igual a PIS, COFINS e ISS. O resultado líquido final é o mesmo pelos dois caminhos; o que muda
          é a receita líquida e, com ela, todo percentual desta tela. Ao comparar com o DRE da contabilidade, é aqui que
          a diferença aparece.
          <br />
          <br />
          <strong>Como esta demonstração difere do DRE contábil oficial.</strong> Aqui o regime é o de competência dos
          títulos, pela data de emissão do documento. Não há provisão, apropriação de despesa antecipada nem
          depreciação — depreciação não passa por título, e este sistema espelha títulos. É uma leitura gerencial na
          estrutura legal: serve para decidir no dia 5, não para assinar balanço. O DRE oficial é o da contabilidade.
        </p>
      </Secao>

      {/* DEPOIS do DRE, e não antes: recomendar corte antes de mostrar o
          resultado é dar resposta a quem ainda não viu a pergunta. Quem abre
          esta tela quer saber primeiro se deu lucro; onde cortar é a conversa
          seguinte. */}
      <Secao
        titulo="Onde reduzir"
        descricao="Reduzir custo é meta; saber onde reduzir é estratégia. As categorias são cruzadas em dois eixos: peso no custo total e acoplamento à receita."
      >
        {!estrategia.baseSuficiente ? (
          <p className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-600">
            São necessários pelo menos 4 meses de histórico para julgar se um custo acompanha a receita ou cresceu sozinho.
            A base tem {estrategia.mesesAnalisados} mês(es) — a análise aparece automaticamente quando houver histórico
            suficiente. Recomendar onde cortar com menos que isso custa mais caro que não recomendar.
          </p>
        ) : (
          <>
            <p className="mb-3 text-sm text-slate-600">
              Economia anual estimada nos alvos prioritários:{" "}
              <strong className="text-emerald-700">{fmtBRL(estrategia.economiaAnualTotalCents)}</strong>. Custo médio
              mensal analisado: {fmtBRL(estrategia.custoTotalMensalCents)} ao longo de {estrategia.mesesAnalisados} meses.
            </p>
            <ul className="space-y-3">
              {estrategia.linhas
                .filter((l) => l.dentroDosPrimeiros80)
                .slice(0, 8)
                .map((l) => (
                  <li key={l.codigo} className="rounded-lg border border-slate-200 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">{l.descricao}</p>
                        <span
                          className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            l.classificacao === "DESACOPLADO_CRESCENTE"
                              ? "bg-red-100 text-red-700"
                              : l.classificacao === "FIXO_ESTRUTURAL"
                                ? "bg-amber-100 text-amber-700"
                                : l.classificacao === "VARIAVEL_ACOPLADO"
                                  ? "bg-sky-100 text-sky-700"
                                  : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {ROTULO_CLASSIFICACAO[l.classificacao]}
                        </span>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold tabular-nums text-slate-900">
                          {fmtBRL(l.custoMedioMensalCents)}/mês
                        </p>
                        <p className="text-xs text-slate-500">{fmtPercent(l.participacaoPercent)} do custo</p>
                        {l.economiaAnualEstimadaCents > 0 && (
                          <p className="text-xs font-medium text-emerald-700">
                            até {fmtBRL(l.economiaAnualEstimadaCents)}/ano
                          </p>
                        )}
                      </div>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-slate-600">{l.racional}</p>
                    <div className="mt-2 rounded-lg bg-slate-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">O que fazer</p>
                      <p className="mt-1 text-sm leading-relaxed text-slate-700">{l.acao}</p>
                    </div>
                  </li>
                ))}
            </ul>
            <p className="mt-3 text-xs text-slate-500">
              Corte linear (&quot;todos reduzem 10%&quot;) trata igual o que é desigual: corta o combustível que leva o
              passageiro na mesma proporção do contrato que ninguém usa. As categorias marcadas como &quot;acompanha a
              entrega&quot; devem ser atacadas por eficiência (custo por km, por hora), nunca por corte de valor absoluto.
            </p>
          </>
        )}
      </Secao>

      <Secao titulo="Maiores fornecedores do mês" descricao="Volume concentrado é poder de negociação — e risco de dependência.">
        <Tabela
          colunas={["Fornecedor", "Títulos", "Valor", "Participação"]}
          alinharDireita={[1, 2, 3]}
          linhas={fornecedores.map((f) => [
            f.nome,
            fmtNumero(f.quantidade),
            fmtBRL(f.valorCents),
            fmtPercent(totalDespesa > 0 ? (f.valorCents / totalDespesa) * 100 : null),
          ])}
        />
      </Secao>
    </div>
  );
}
