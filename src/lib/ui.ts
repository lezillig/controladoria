export const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100";
export const labelClass = "block text-sm font-medium text-slate-700 mb-1";
export const cardClass =
  "rounded-2xl border border-slate-200 bg-white p-6 shadow-sm";
export const primaryButtonClass =
  "rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60";
export const secondaryButtonClass =
  "rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50";
export const badgeClass =
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium";

// ---------------------------------------------------------------------------
// LARGURA DE CONTEÚDO
//
// Antes disto havia dezenove larguras de página espalhadas em cinco valores
// diferentes — 4xl, 5xl, 6xl, um 1800px — escolhidos um a um, cada um numa
// tarefa diferente, nenhum com relação com o outro. O sintoma foi o relato:
// "não faz sentido deixar comprimido se tenho espaço". O problema não era o
// número; era não haver sistema.
//
// São TRÊS larguras, e a escolha entre elas é sobre o CONTEÚDO, não sobre a
// tela. Uma tela larga não melhora um formulário nem um parágrafo:
//
//   PAINEL — tabela, KPI, gráfico. Ocupa o que a tela der, com teto: sem teto
//   nenhum, num monitor ultralargo a primeira coluna e a última ficam a meio
//   metro uma da outra e a comparação, que é a razão da tabela, se perde.
//
//   FORMULÁRIO — campos e configuração. Fica estreito de propósito. Um campo
//   de texto de 1800px é pior de usar que um de 600: o olho perde a linha
//   entre o rótulo e o valor, e o cursor fica longe de onde se está lendo.
//
//   LEITURA — prosa longa. Entre 65 e 75 caracteres por linha é o intervalo em
//   que o olho acha o começo da linha seguinte sem procurar. É por isso que
//   jornal tem coluna estreita numa página larga.
//
// Uma tela pode usar as três: painel no contêiner, leitura nos parágrafos.
export const larguraPainel = "w-full max-w-[1800px]";
export const larguraFormulario = "w-full max-w-3xl";
export const larguraLeitura = "max-w-[72ch]";

// AVISO E NOTA DE RODAPÉ NÃO SÃO PROSA LONGA, e aplicar a medida de leitura
// nos dois foi um erro que a tela mostrou: um alerta de três linhas preso a
// 72ch vira uma fita estreita boiando numa tela de 1900px — pior de ler que se
// ocupasse a largura, porque o olho procura o resto do texto onde não há nada.
//
// A regra dos 65-75 caracteres vale para o que se lê por minutos. Um aviso se
// lê de uma vez, e quanto menos linhas ele tiver, mais rápido isso acontece.
// Por isso a nota é larga, com teto só para não virar uma linha única de dois
// metros num monitor ultralargo.
export const larguraNota = "max-w-[130ch]";
