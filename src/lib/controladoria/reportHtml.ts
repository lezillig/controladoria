import type { AuditFinding } from "@prisma/client";
import { fmtBRL, fmtBRLCompacto, fmtData, fmtNumero, fmtPercent, fmtVariacao } from "./format";
import type { PanoramaFinanceiro } from "./analytics";
import type { IndicadorMedido } from "./bsc";
import { PERSPECTIVAS } from "./bsc";
import type { Narrativa } from "./aiAnalyst";
import type { QualidadeDaBase } from "./supervisor";
import type { PanoramaConformidade } from "@/lib/conformidade/panorama";
import { ROTULO_AREA, rotuloCompetencia } from "@/lib/conformidade/tipos";

// TEMPLATE DO RELATÓRIO DIÁRIO (e-mail).
//
// Escrito em HTML de e-mail, que e um dialeto proprio e limitado — nao e a
// mesma coisa que HTML de pagina. As restricoes abaixo nao sao preferencia de
// estilo, sao o que faz a mensagem abrir igual no Gmail do computador e no
// app do celular (o pedido explicito do usuario):
//
//   - LAYOUT EM TABELA. Gmail, Outlook e o app do iOS ignoram ou quebram
//     flexbox e grid. Tabela aninhada e feia de escrever e a unica coisa que
//     renderiza igual em todos.
//   - CSS INLINE em cada elemento. O Gmail remove <style> em varias
//     situacoes; o que esta inline sobrevive.
//   - Uma media query no <head> mesmo assim, para os clientes que a respeitam
//     (Apple Mail, iOS, Outlook mobile): abaixo de 600px as colunas viram
//     blocos de largura total. Onde a media query e ignorada, o layout ja
//     nasce legivel — nunca depende dela.
//   - LARGURA MAXIMA 600px, o padrao historico de e-mail, que cabe na tela do
//     celular sem zoom horizontal.
//   - SEM IMAGEM EXTERNA. Alem de a maioria dos clientes bloquear imagem por
//     padrao, um relatorio financeiro nao deveria disparar requisicao para
//     servidor nenhum ao ser aberto (rastreamento de leitura de dado
//     sensivel). Os "graficos" sao barras feitas com div/tabela colorida.
//   - CORES COM CONTRASTE ALTO e nenhum texto abaixo de 13px: e um relatorio
//     lido as 6 da manha, no celular, com uma mao.

const AZUL = "#1d4ed8";
const CINZA_TEXTO = "#0f172a";
const CINZA_SUAVE = "#64748b";
const BORDA = "#e2e8f0";
const FUNDO = "#f1f5f9";

const CORES_SEVERIDADE: Record<string, { fundo: string; texto: string; rotulo: string }> = {
  CRITICA: { fundo: "#fee2e2", texto: "#991b1b", rotulo: "Crítico" },
  ALTA: { fundo: "#ffedd5", texto: "#9a3412", rotulo: "Alto" },
  MEDIA: { fundo: "#fef3c7", texto: "#854d0e", rotulo: "Médio" },
  BAIXA: { fundo: "#e0f2fe", texto: "#075985", rotulo: "Baixo" },
  INFO: { fundo: "#f1f5f9", texto: "#475569", rotulo: "Informativo" },
};

const CORES_FAROL: Record<string, string> = {
  VERDE: "#16a34a",
  AMARELO: "#d97706",
  VERMELHO: "#dc2626",
  SEM_META: "#94a3b8",
  SEM_DADO: "#cbd5e1",
};

export type DadosRelatorio = {
  empresa: string;
  dataReferencia: Date;
  panorama: PanoramaFinanceiro;
  achados: AuditFinding[];
  bsc: IndicadorMedido[];
  narrativa: Narrativa | null;
  qualidadeDaBase: QualidadeDaBase;
  conformidade: PanoramaConformidade;
  urlSistema: string | null;
};

// Escapa texto vindo do banco (nome de fornecedor, descricao de achado) antes
// de entrar no HTML. Nome de fornecedor com "&" ou "<" quebraria o e-mail; um
// nome cadastrado com tag HTML seria injecao de conteudo no relatorio que a
// diretoria le.
function esc(texto: string | null | undefined): string {
  if (!texto) return "";
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function secao(titulo: string, conteudo: string, subtitulo?: string): string {
  return `
  <tr>
    <td style="padding:24px 20px 0 20px;">
      <div style="font:600 11px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:${CINZA_SUAVE};">${esc(titulo)}</div>
      ${subtitulo ? `<div style="font:400 13px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${CINZA_SUAVE};margin-top:4px;">${esc(subtitulo)}</div>` : ""}
      <div style="margin-top:12px;">${conteudo}</div>
    </td>
  </tr>`;
}

function cartaoKpi(rotulo: string, valor: string, apoio: string, cor = CINZA_TEXTO): string {
  // class="col" e o gancho da media query: no celular cada cartao ocupa a
  // linha inteira em vez de espremer quatro colunas de 140px.
  return `
  <td class="col" style="width:50%;padding:4px;" valign="top">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#ffffff;border:1px solid ${BORDA};border-radius:10px;">
      <tr><td style="padding:12px 14px;">
        <div style="font:500 12px/1.3 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${CINZA_SUAVE};">${esc(rotulo)}</div>
        <div style="font:700 20px/1.3 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${cor};margin-top:4px;">${esc(valor)}</div>
        <div style="font:400 12px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${CINZA_SUAVE};margin-top:2px;">${esc(apoio)}</div>
      </td></tr>
    </table>
  </td>`;
}

function tabela(cabecalho: string[], linhas: string[][], alinhamentoDireita: number[] = []): string {
  const th = cabecalho
    .map(
      (c, i) =>
        `<th align="${alinhamentoDireita.includes(i) ? "right" : "left"}" style="font:600 11px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;text-transform:uppercase;letter-spacing:.05em;color:${CINZA_SUAVE};padding:8px 10px;border-bottom:1px solid ${BORDA};">${esc(c)}</th>`
    )
    .join("");

  const tr = linhas
    .map(
      (linha) =>
        `<tr>${linha
          .map(
            (celula, i) =>
              `<td align="${alinhamentoDireita.includes(i) ? "right" : "left"}" style="font:400 13px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${CINZA_TEXTO};padding:9px 10px;border-bottom:1px solid ${BORDA};">${celula}</td>`
          )
          .join("")}</tr>`
    )
    .join("");

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#ffffff;border:1px solid ${BORDA};border-radius:10px;border-collapse:separate;overflow:hidden;">
    <tr>${th}</tr>${tr}</table>`;
}

function barra(percentual: number, cor: string): string {
  const largura = Math.max(0, Math.min(100, percentual));
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${FUNDO};border-radius:99px;">
    <tr><td style="height:6px;width:${largura}%;background:${cor};border-radius:99px;font-size:0;line-height:0;">&nbsp;</td><td style="font-size:0;line-height:0;">&nbsp;</td></tr>
  </table>`;
}

function blocoAchado(a: AuditFinding): string {
  const cor = CORES_SEVERIDADE[a.severidade] ?? CORES_SEVERIDADE.INFO;
  const valores = [
    a.valorCents !== null ? `Valor: ${fmtBRL(a.valorCents)}` : null,
    a.impactoCents !== null ? `Impacto estimado: ${fmtBRL(a.impactoCents)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#ffffff;border:1px solid ${BORDA};border-left:3px solid ${cor.texto};border-radius:8px;margin-bottom:10px;">
    <tr><td style="padding:12px 14px;">
      <span style="display:inline-block;background:${cor.fundo};color:${cor.texto};font:600 11px/1 -apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:4px 8px;border-radius:99px;">${cor.rotulo}</span>
      ${a.confianca < 100 ? `<span style="font:400 11px/1 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${CINZA_SUAVE};margin-left:6px;">confiança ${a.confianca}%</span>` : ""}
      <div style="font:600 15px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${CINZA_TEXTO};margin-top:8px;">${esc(a.titulo)}</div>
      <div style="font:400 13px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#334155;margin-top:6px;">${esc(a.descricao)}</div>
      ${valores ? `<div style="font:600 12px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${CINZA_TEXTO};margin-top:8px;">${esc(valores)}</div>` : ""}
      ${
        a.recomendacao
          ? `<div style="background:${FUNDO};border-radius:6px;padding:10px 12px;margin-top:10px;">
               <div style="font:600 11px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;text-transform:uppercase;letter-spacing:.05em;color:${CINZA_SUAVE};">O que fazer</div>
               <div style="font:400 13px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#334155;margin-top:4px;">${esc(a.recomendacao)}</div>
             </div>`
          : ""
      }
      ${
        a.notaSupervisor
          ? `<div style="font:400 12px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${CINZA_SUAVE};margin-top:8px;font-style:italic;">Revisão: ${esc(a.notaSupervisor)}</div>`
          : ""
      }
    </td></tr>
  </table>`;
}

// Bloco de conformidade: o que a revisão externa apontou e onde ela e os dados
// se encontram. Fica no relatório, e não só na tela, porque risco apontado por
// terceiro que não chega à diretoria produz o pior resultado possível — a
// empresa fica com o registro de que foi avisada e sem a decisão.
function secaoConformidade(c: PanoramaConformidade): string {
  const partes: string[] = [];

  partes.push(`
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    <tr>
      ${cartaoKpi("Apontamentos em aberto", fmtNumero(c.abertos), c.valorEnvolvidoCents > 0 ? `${fmtBRLCompacto(c.valorEnvolvidoCents)} envolvidos` : "De consultoria, contabilidade e auditoria")}
      ${cartaoKpi("Graves", fmtNumero(c.criticos), "Críticos e altos sem conclusão", c.criticos > 0 ? "#b91c1c" : "#15803d")}
    </tr>
    <tr>
      ${cartaoKpi("Prazo vencido", fmtNumero(c.vencidos), "Prazo combinado que passou", c.vencidos > 0 ? "#b91c1c" : "#15803d")}
      ${cartaoKpi("Reincidentes", fmtNumero(c.reincidentes), "Mesmo ponto em 3+ competências", c.reincidentes > 0 ? "#b91c1c" : "#15803d")}
    </tr>
  </table>`);

  if (!c.documentoEsperadoRecebido && c.competenciaEsperada) {
    partes.push(`
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px 14px;margin-top:10px;font:400 13px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#854d0e;">
      O documento de <strong>${esc(rotuloCompetencia(c.competenciaEsperada))}</strong> ainda não foi recebido.
      ${c.ultimaCompetencia ? `A última competência analisada é ${esc(rotuloCompetencia(c.ultimaCompetencia))}.` : ""}
    </div>`);
  }

  for (const a of c.prioritarios) {
    const cor = CORES_SEVERIDADE[a.severidade] ?? CORES_SEVERIDADE.INFO;
    const marcas = [
      `${ROTULO_AREA[a.area] ?? a.area} · ${rotuloCompetencia(a.competencia)}`,
      a.ocorrencias >= 3 ? `${a.ocorrencias}ª competência seguida` : null,
      a.prazo ? `prazo ${fmtData(a.prazo)}` : "sem prazo definido",
      a.responsavel ?? "sem responsável",
    ]
      .filter(Boolean)
      .join(" · ");

    partes.push(`
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#ffffff;border:1px solid ${BORDA};border-left:3px solid ${cor.texto};border-radius:8px;margin-top:10px;">
      <tr><td style="padding:12px 14px;">
        <span style="display:inline-block;background:${cor.fundo};color:${cor.texto};font:600 11px/1 -apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:4px 8px;border-radius:99px;">${cor.rotulo}</span>
        <div style="font:600 14px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${CINZA_TEXTO};margin-top:8px;">${esc(a.titulo)}</div>
        <div style="font:400 13px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#334155;margin-top:6px;">${esc(a.descricao)}</div>
        ${a.valorEnvolvidoCents !== null ? `<div style="font:600 12px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${CINZA_TEXTO};margin-top:8px;">Valor apontado: ${fmtBRL(a.valorEnvolvidoCents)}</div>` : ""}
        <div style="font:400 12px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${CINZA_SUAVE};margin-top:8px;">${esc(marcas)}</div>
      </td></tr>
    </table>`);
  }

  partes.push(`
  <div style="font:400 12px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${CINZA_SUAVE};margin-top:10px;">
    <strong style="color:${CINZA_TEXTO};">${fmtNumero(c.confirmadosPeloSistema)}</strong> apontamento(s) com confirmação nos próprios dados desta auditoria ·
    <strong style="color:${CINZA_TEXTO};">${fmtNumero(c.semCobertura)}</strong> que só a revisão externa enxerga${c.naoValidados > 0 ? ` · ${fmtNumero(c.naoValidados)} proposta(s) de leitura automática aguardando conferência` : ""}.
  </div>`);

  return secao(
    "Conformidade e riscos externos",
    partes.join(""),
    "O que a consultoria, a contabilidade e a auditoria apontaram — e o que os dados confirmam."
  );
}

export function montarAssunto(dados: DadosRelatorio): string {
  const criticos = dados.achados.filter((a) => a.severidade === "CRITICA").length;
  const resultado = dados.panorama.comparativo.mesAtual.resultadoCents;
  const prefixo = criticos > 0 ? `[${criticos} crítico${criticos > 1 ? "s" : ""}] ` : "";
  return `${prefixo}Controladoria ${fmtData(dados.dataReferencia)} · Resultado do mês ${fmtBRLCompacto(resultado)}`;
}

export function montarHtml(dados: DadosRelatorio): string {
  const { panorama, achados, bsc, narrativa, qualidadeDaBase } = dados;
  const c = panorama.comparativo;

  const criticos = achados.filter((a) => a.severidade === "CRITICA" || a.severidade === "ALTA").slice(0, 6);
  const oportunidades = achados.filter((a) => a.categoria === "OPORTUNIDADE").slice(0, 5);
  const economiaTotal = achados
    .filter((a) => a.categoria === "OPORTUNIDADE")
    .reduce((acc, a) => acc + (a.impactoCents ?? 0), 0);
  const perdasTotal = achados
    .filter((a) => a.categoria === "PERDA_FINANCEIRA")
    .reduce((acc, a) => acc + (a.valorCents ?? 0), 0);

  const partes: string[] = [];

  // ---- Cabeçalho ----
  partes.push(`
  <tr>
    <td style="background:${AZUL};padding:22px 20px;">
      <div style="font:700 18px/1.3 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#ffffff;">Relatório de Controladoria</div>
      <div style="font:400 13px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#dbeafe;margin-top:4px;">
        ${esc(dados.empresa)} · dados de ${fmtData(dados.dataReferencia)} (D-1)
      </div>
    </td>
  </tr>`);

  // ---- Leitura executiva (IA) ----
  if (narrativa) {
    partes.push(
      secao(
        "Leitura executiva",
        `<div style="background:#ffffff;border:1px solid ${BORDA};border-radius:10px;padding:14px 16px;">
          <div style="font:400 14px/1.65 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${CINZA_TEXTO};">${esc(narrativa.resumoExecutivo)}</div>
        </div>`
      )
    );
  }

  // ---- KPIs do mês ----
  partes.push(
    secao(
      "Resultado do mês",
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          ${cartaoKpi("Receita do mês", fmtBRL(c.mesAtual.receitaCents), `${fmtVariacao(c.variacoes.receitaMesVsAnterior)} vs. mês anterior`)}
          ${cartaoKpi("Despesa do mês", fmtBRL(c.mesAtual.despesaCents), `${fmtVariacao(c.variacoes.despesaMesVsAnterior)} vs. mês anterior`)}
        </tr>
        <tr>
          ${cartaoKpi(
            "Resultado do mês",
            fmtBRL(c.mesAtual.resultadoCents),
            `Margem ${fmtPercent(c.mesAtual.margemPercent)}`,
            c.mesAtual.resultadoCents >= 0 ? "#15803d" : "#b91c1c"
          )}
          ${cartaoKpi(
            "Saldo em caixa",
            fmtBRL(panorama.saldoAtualCents),
            `A pagar em aberto ${fmtBRLCompacto(panorama.aPagarEmAbertoCents)}`,
            panorama.saldoAtualCents >= 0 ? CINZA_TEXTO : "#b91c1c"
          )}
        </tr>
      </table>`,
      `Movimento de ${fmtData(dados.dataReferencia)}: receita ${fmtBRL(c.dia.receitaCents)} · despesa ${fmtBRL(c.dia.despesaCents)}`
    )
  );

  // ---- Achados prioritários ----
  if (criticos.length > 0) {
    partes.push(
      secao(
        `Precisa de decisão (${criticos.length})`,
        criticos.map(blocoAchado).join(""),
        "Achados de maior severidade validados pelo supervisor nesta execução."
      )
    );
  } else {
    partes.push(
      secao(
        "Precisa de decisão",
        `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px 16px;font:400 14px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#166534;">
          Nenhum achado crítico ou de alta severidade nesta execução.
        </div>`
      )
    );
  }

  // ---- Comparativos ----
  partes.push(
    secao(
      "Comparativos",
      tabela(
        ["Período", "Receita", "Despesa", "Resultado"],
        [
          [esc("Dia (D-1)"), fmtBRL(c.dia.receitaCents), fmtBRL(c.dia.despesaCents), fmtBRL(c.dia.resultadoCents)],
          [esc(c.mesAtual.rotulo), fmtBRL(c.mesAtual.receitaCents), fmtBRL(c.mesAtual.despesaCents), fmtBRL(c.mesAtual.resultadoCents)],
          [esc(c.mesAnterior.rotulo), fmtBRL(c.mesAnterior.receitaCents), fmtBRL(c.mesAnterior.despesaCents), fmtBRL(c.mesAnterior.resultadoCents)],
          [esc(c.ano.rotulo), fmtBRL(c.ano.receitaCents), fmtBRL(c.ano.despesaCents), fmtBRL(c.ano.resultadoCents)],
          c.semBaseAnoAnterior
            ? [esc(c.anoAnterior.rotulo), "sem base", "sem base", "sem base"]
            : [esc(c.anoAnterior.rotulo), fmtBRL(c.anoAnterior.receitaCents), fmtBRL(c.anoAnterior.despesaCents), fmtBRL(c.anoAnterior.resultadoCents)],
        ],
        [1, 2, 3]
      ) +
        (c.semBaseAnoAnterior
          ? `<div style="font:400 12px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${CINZA_SUAVE};margin-top:8px;">
               A base histórica ainda não cobre o ano anterior inteiro — as comparações anuais aparecem como "sem base" em vez de mostrar uma variação que não existe.
             </div>`
          : `<div style="font:400 12px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${CINZA_SUAVE};margin-top:8px;">
               Receita do ano: ${fmtVariacao(c.variacoes.receitaAnoVsAnterior)} · Resultado do ano: ${fmtVariacao(c.variacoes.resultadoAnoVsAnterior)} (mesmo período do ano anterior)
             </div>`),
      "Regime de competência, pela data de vencimento do título."
    )
  );

  // ---- Perdas e oportunidades ----
  partes.push(
    secao(
      "Dinheiro em jogo",
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          ${cartaoKpi("Perdas do mês", fmtBRL(c.mesAtual.perdaTotalCents), "Juros, multa, tarifa e desconto", c.mesAtual.perdaTotalCents > 0 ? "#b91c1c" : "#15803d")}
          ${cartaoKpi("Economia identificada", fmtBRL(economiaTotal), "Impacto anual estimado das oportunidades", economiaTotal > 0 ? "#15803d" : CINZA_TEXTO)}
        </tr>
        <tr>
          ${cartaoKpi("Perdas apontadas", fmtBRL(perdasTotal), "Total dos achados de perda em aberto")}
          ${cartaoKpi("Vencido a receber", fmtBRL(panorama.vencidoReceberCents), `De ${fmtBRLCompacto(panorama.aReceberEmAbertoCents)} em aberto`)}
        </tr>
      </table>`
    )
  );

  if (oportunidades.length > 0) {
    partes.push(
      secao(
        "Oportunidades de economia",
        oportunidades.map(blocoAchado).join(""),
        "Cada item traz a ação e o valor anual estimado."
      )
    );
  }

  // ---- Conformidade (o que veio de fora) ----
  // Só entra quando existe: um bloco fixo dizendo "nenhum documento recebido"
  // apareceria todo dia numa empresa que não usa o módulo, e bloco que sempre
  // diz a mesma coisa treina o leitor a pular a seção — inclusive no dia em que
  // ela tiver conteúdo.
  if (dados.conformidade.temModulo) {
    partes.push(secaoConformidade(dados.conformidade));
  }

  // ---- Fluxo de caixa ----
  partes.push(
    secao(
      "Projeção de caixa",
      tabela(
        ["Horizonte", "Entradas", "Saídas", "Saldo projetado"],
        panorama.projecao.map((p) => [
          `${p.dias} dias`,
          fmtBRL(p.entradasCents),
          fmtBRL(p.saidasCents),
          `<span style="color:${p.saldoProjetadoCents < 0 ? "#b91c1c" : "#15803d"};font-weight:600;">${fmtBRL(p.saldoProjetadoCents)}</span>`,
        ]),
        [1, 2, 3]
      ) +
        `<div style="font:400 12px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${CINZA_SUAVE};margin-top:8px;">
          Projeção conservadora: recebível já vencido não entra como entrada. Ciclo financeiro atual: ${fmtNumero(panorama.ciclo.cicloFinanceiroDias)} dias (PMR ${fmtNumero(panorama.ciclo.pmrDias)} · PMP ${fmtNumero(panorama.ciclo.pmpDias)}).
        </div>`
    )
  );

  // ---- BSC ----
  const blocosBsc = PERSPECTIVAS.map((p) => {
    const indicadores = bsc.filter((i) => i.indicador.perspectiva === p.chave);
    if (indicadores.length === 0) return "";
    const linhas = indicadores
      .map((i) => {
        const valor =
          i.valor === null
            ? "sem dado"
            : i.indicador.unidade === "PERCENTUAL"
              ? fmtPercent(i.valor)
              : i.indicador.unidade === "REAIS"
                ? fmtBRL(Math.round(i.valor * 100))
                : `${fmtNumero(i.valor)}${i.indicador.unidade === "DIAS" ? " dias" : ""}`;
        const metaTexto =
          i.meta === null
            ? "sem meta"
            : `meta ${i.indicador.unidade === "PERCENTUAL" ? fmtPercent(i.meta) : fmtNumero(i.meta)}${i.metaEhSugerida ? " (sugerida)" : ""}`;
        const tendencia =
          i.valor !== null && i.valorAnterior !== null
            ? i.valor > i.valorAnterior
              ? "▲"
              : i.valor < i.valorAnterior
                ? "▼"
                : "="
            : "";
        return `<tr>
          <td style="padding:8px 10px;border-bottom:1px solid ${BORDA};font:400 13px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${CINZA_TEXTO};">
            <span style="display:inline-block;width:8px;height:8px;border-radius:99px;background:${CORES_FAROL[i.farol] ?? CORES_FAROL.SEM_DADO};margin-right:8px;"></span>${esc(i.indicador.nome)}
          </td>
          <td align="right" style="padding:8px 10px;border-bottom:1px solid ${BORDA};font:600 13px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${CINZA_TEXTO};white-space:nowrap;">
            ${esc(valor)} <span style="color:${CINZA_SUAVE};font-weight:400;">${tendencia}</span>
          </td>
          <td align="right" style="padding:8px 10px;border-bottom:1px solid ${BORDA};font:400 12px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${CINZA_SUAVE};white-space:nowrap;">${esc(metaTexto)}</td>
        </tr>`;
      })
      .join("");

    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#ffffff;border:1px solid ${BORDA};border-radius:10px;margin-bottom:10px;">
      <tr><td style="padding:12px 10px 4px 10px;">
        <div style="font:600 13px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${CINZA_TEXTO};">${esc(p.nome)}</div>
        <div style="font:400 12px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${CINZA_SUAVE};margin-top:2px;">${esc(p.explicacao)}</div>
      </td></tr>
      <tr><td><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${linhas}</table></td></tr>
    </table>`;
  }).join("");

  partes.push(secao("Balanced Scorecard", blocosBsc, "Verde dentro da meta · amarelo na tolerância · vermelho fora."));

  // ---- Aging ----
  const totalAging = panorama.agingReceber.totalCents || 1;
  partes.push(
    secao(
      "Recebíveis por faixa de atraso",
      panorama.agingReceber.faixas
        .map(
          (f) => `
        <div style="margin-bottom:10px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td style="font:400 13px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${CINZA_TEXTO};">${esc(f.rotulo)} <span style="color:${CINZA_SUAVE};">(${f.quantidade})</span></td>
              <td align="right" style="font:600 13px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${CINZA_TEXTO};">${fmtBRL(f.valorCents)}</td>
            </tr>
          </table>
          <div style="margin-top:5px;">${barra((f.valorCents / totalAging) * 100, f.rotulo === "A vencer" ? "#16a34a" : "#dc2626")}</div>
        </div>`
        )
        .join("")
    )
  );

  // ---- Maiores fornecedores ----
  if (panorama.topFornecedores.length > 0) {
    partes.push(
      secao(
        "Maiores despesas do mês",
        tabela(
          ["Fornecedor", "Títulos", "Valor"],
          panorama.topFornecedores.slice(0, 8).map((f) => [esc(f.nome), String(f.quantidade), fmtBRL(f.valorCents)]),
          [1, 2]
        )
      )
    );
  }

  // ---- Ações recomendadas (IA) ----
  if (narrativa && narrativa.acoesRecomendadas.length > 0) {
    const prazos: Record<string, string> = { HOJE: "Hoje", ESTA_SEMANA: "Esta semana", ESTE_MES: "Este mês" };
    partes.push(
      secao(
        "Ações recomendadas",
        tabela(
          ["Ação", "Prazo", "Responsável"],
          narrativa.acoesRecomendadas.map((a) => [esc(a.acao), esc(prazos[a.prazo] ?? a.prazo), esc(a.responsavelSugerido)])
        )
      )
    );
  }

  if (narrativa?.leituraEstrategica) {
    partes.push(
      secao(
        "Leitura estratégica",
        `<div style="background:#ffffff;border:1px solid ${BORDA};border-radius:10px;padding:14px 16px;font:400 14px/1.65 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${CINZA_TEXTO};">${esc(
          narrativa.leituraEstrategica
        )}</div>`
      )
    );
  }

  // ---- Rodapé: qualidade da base ----
  const limitacoes = qualidadeDaBase.limitacoes.length
    ? `<ul style="margin:6px 0 0 18px;padding:0;font:400 12px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${CINZA_SUAVE};">
        ${qualidadeDaBase.limitacoes.map((l) => `<li>${esc(l)}</li>`).join("")}
      </ul>`
    : "";

  partes.push(`
  <tr>
    <td style="padding:24px 20px 28px 20px;">
      <div style="border-top:1px solid ${BORDA};padding-top:14px;">
        <div style="font:400 12px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${CINZA_SUAVE};">
          Qualidade da base nesta execução: <strong style="color:${CINZA_TEXTO};">${qualidadeDaBase.score}%</strong>.
          ${qualidadeDaBase.syncAtrasadoDias !== null ? `Última sincronização com a Omie há ${qualidadeDaBase.syncAtrasadoDias} dia(s).` : "Sem registro de sincronização concluída."}
        </div>
        ${limitacoes}
        ${
          dados.urlSistema
            ? `<div style="margin-top:14px;">
                 <a href="${esc(dados.urlSistema)}/" style="display:inline-block;background:${AZUL};color:#ffffff;text-decoration:none;font:600 14px/1 -apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:12px 18px;border-radius:8px;">Abrir o painel completo</a>
               </div>`
            : ""
        }
        <div style="font:400 11px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#94a3b8;margin-top:16px;">
          Gerado automaticamente pelo módulo de Controladoria a partir dos dados da Omie e da operação.
          Os achados são indícios que exigem verificação, não conclusões — cada um traz a evidência que o originou no painel.
        </div>
      </div>
    </td>
  </tr>`);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(montarAssunto(dados))}</title>
<style>
  /* Respeitada por Apple Mail, iOS Mail e Outlook mobile. Onde for ignorada,
     o layout de tabela acima ja e legivel — a media query melhora, nao sustenta. */
  @media only screen and (max-width:600px) {
    .col { display:block !important; width:100% !important; }
    .wrap { width:100% !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${FUNDO};-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    Resultado do mês ${fmtBRL(c.mesAtual.resultadoCents)} · ${achados.length} achado(s) em aberto · saldo ${fmtBRL(panorama.saldoAtualCents)}
  </div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${FUNDO};">
    <tr><td align="center" style="padding:16px 8px;">
      <table role="presentation" class="wrap" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:600px;background:${FUNDO};border-radius:14px;overflow:hidden;">
        ${partes.join("")}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// Versao em texto puro. Vai em toda mensagem: leitor de tela, cliente que
// bloqueia HTML e filtros antispam usam essa parte.
export function montarTexto(dados: DadosRelatorio): string {
  const c = dados.panorama.comparativo;
  const linhas: string[] = [];

  linhas.push(`RELATÓRIO DE CONTROLADORIA — ${dados.empresa}`);
  linhas.push(`Dados de ${fmtData(dados.dataReferencia)} (D-1)`);
  linhas.push("");

  if (dados.narrativa) {
    linhas.push("LEITURA EXECUTIVA");
    linhas.push(dados.narrativa.resumoExecutivo);
    linhas.push("");
  }

  linhas.push("RESULTADO DO MÊS");
  linhas.push(`Receita: ${fmtBRL(c.mesAtual.receitaCents)} (${fmtVariacao(c.variacoes.receitaMesVsAnterior)} vs. mês anterior)`);
  linhas.push(`Despesa: ${fmtBRL(c.mesAtual.despesaCents)} (${fmtVariacao(c.variacoes.despesaMesVsAnterior)})`);
  linhas.push(`Resultado: ${fmtBRL(c.mesAtual.resultadoCents)} · margem ${fmtPercent(c.mesAtual.margemPercent)}`);
  linhas.push(`Saldo em caixa: ${fmtBRL(dados.panorama.saldoAtualCents)}`);
  linhas.push("");

  linhas.push("ACUMULADO DO ANO");
  linhas.push(`Receita: ${fmtBRL(c.ano.receitaCents)} (${fmtVariacao(c.variacoes.receitaAnoVsAnterior)} vs. ano anterior)`);
  linhas.push(`Resultado: ${fmtBRL(c.ano.resultadoCents)}`);
  linhas.push("");

  const criticos = dados.achados.filter((a) => a.severidade === "CRITICA" || a.severidade === "ALTA");
  linhas.push(`ACHADOS PRIORITÁRIOS (${criticos.length})`);
  for (const a of criticos.slice(0, 10)) {
    linhas.push(`- [${a.severidade}] ${a.titulo}`);
    if (a.recomendacao) linhas.push(`  Ação: ${a.recomendacao}`);
  }
  linhas.push("");

  const c2 = dados.conformidade;
  if (c2.temModulo) {
    linhas.push("CONFORMIDADE E RISCOS EXTERNOS");
    linhas.push(
      `${c2.abertos} apontamento(s) em aberto · ${c2.criticos} grave(s) · ${c2.vencidos} com prazo vencido · ${c2.reincidentes} reincidente(s)`
    );
    if (!c2.documentoEsperadoRecebido && c2.competenciaEsperada) {
      linhas.push(`ATENÇÃO: o documento de ${rotuloCompetencia(c2.competenciaEsperada)} ainda não foi recebido.`);
    }
    for (const a of c2.prioritarios) {
      linhas.push(`- [${a.severidade}] ${a.titulo} (${ROTULO_AREA[a.area] ?? a.area}, ${rotuloCompetencia(a.competencia)})`);
    }
    linhas.push(
      `${c2.confirmadosPeloSistema} com confirmação nos dados · ${c2.semCobertura} que só a revisão externa enxerga.`
    );
    linhas.push("");
  }

  if (dados.urlSistema) {
    linhas.push(`Painel completo: ${dados.urlSistema}/`);
  }

  return linhas.join("\n");
}
