import type { ConformidadeArea, ConformidadeOrigem, ConformidadeStatus } from "@prisma/client";

// Vocabulário do módulo de Conformidade: rótulos em português, listas para os
// seletores da tela e as duas normalizações que precisam ser idênticas na
// leitura automática, no cadastro manual e na detecção de reincidência.
//
// Um lugar só, porque a chave de recorrência é o que decide se o apontamento de
// agosto é "o mesmo de julho" ou um novo: duas implementações ligeiramente
// diferentes fariam o sistema perder exatamente o sinal mais valioso que ele
// tem — o problema que se repete.

export const AREAS: { valor: ConformidadeArea; rotulo: string; explicacao: string }[] = [
  { valor: "FISCAL", rotulo: "Fiscal", explicacao: "Tributos, créditos, obrigações acessórias, enquadramento." },
  { valor: "TRABALHISTA", rotulo: "Trabalhista", explicacao: "Jornada, verbas, acordos, terceirização, passivo de reclamatória." },
  { valor: "PREVIDENCIARIO", rotulo: "Previdenciário", explicacao: "INSS, FGTS, contribuições sobre a folha." },
  { valor: "CONTABIL", rotulo: "Contábil", explicacao: "Escrituração, conciliação de contas, provisões, encerramento." },
  { valor: "FINANCEIRO", rotulo: "Financeiro", explicacao: "Caixa, endividamento, pagamentos, controles internos do dinheiro." },
  { valor: "SOCIETARIO", rotulo: "Societário", explicacao: "Contrato social, quadro societário, atos e registros." },
  { valor: "REGULATORIO", rotulo: "Regulatório", explicacao: "Licenças, ANTT/EMTU, vistorias, exigências do setor de transporte." },
  { valor: "CONTRATUAL", rotulo: "Contratual", explicacao: "Cláusulas, reajuste, garantias, vigência e risco de contrato." },
  { valor: "LGPD", rotulo: "LGPD e dados", explicacao: "Tratamento de dado pessoal de passageiro, motorista e cliente." },
  { valor: "OUTRO", rotulo: "Outro", explicacao: "Risco que não cabe nas demais áreas." },
];

export const ROTULO_AREA: Record<string, string> = Object.fromEntries(AREAS.map((a) => [a.valor, a.rotulo]));

export const ORIGENS: { valor: ConformidadeOrigem; rotulo: string }[] = [
  { valor: "CONSULTORIA", rotulo: "Consultoria" },
  { valor: "CONTABILIDADE", rotulo: "Contabilidade" },
  { valor: "AUDITORIA_EXTERNA", rotulo: "Auditoria externa" },
  { valor: "FISCALIZACAO", rotulo: "Fiscalização / autuação" },
  { valor: "JURIDICO", rotulo: "Jurídico" },
  { valor: "INTERNO", rotulo: "Levantamento interno" },
];

export const ROTULO_ORIGEM: Record<string, string> = Object.fromEntries(ORIGENS.map((o) => [o.valor, o.rotulo]));

export const STATUS: { valor: ConformidadeStatus; rotulo: string; explicacao: string }[] = [
  { valor: "ABERTO", rotulo: "Aberto", explicacao: "Recebido, ainda sem responsável ou plano." },
  { valor: "EM_TRATATIVA", rotulo: "Em tratativa", explicacao: "Alguém assumiu e está corrigindo." },
  { valor: "RESOLVIDO", rotulo: "Resolvido", explicacao: "A causa foi corrigida — não só o efeito daquele mês." },
  { valor: "ACEITO_COM_RISCO", rotulo: "Aceito com risco", explicacao: "Decisão consciente de conviver com ele, registrada com nome e data." },
  { valor: "NAO_SE_APLICA", rotulo: "Não se aplica", explicacao: "O apontamento não procede para esta operação." },
];

export const ROTULO_STATUS: Record<string, string> = Object.fromEntries(STATUS.map((s) => [s.valor, s.rotulo]));

// Status que ainda pesam: contam como risco vivo no painel, no relatório e nos
// indicadores. ACEITO_COM_RISCO fica de fora porque a empresa já decidiu — mas
// continua visível na tela, que é onde a decisão pode ser revista.
export const STATUS_EM_ABERTO: ConformidadeStatus[] = ["ABERTO", "EM_TRATATIVA"];

// Palavras que não distinguem um apontamento de outro. Sem removê-las,
// "ausência de controle sobre a jornada" e "ausência de controle sobre o
// abastecimento" cairiam na mesma chave por causa de "ausência" e "controle".
const VAZIAS = new Set([
  "de", "da", "do", "das", "dos", "e", "em", "no", "na", "nos", "nas", "a", "o", "as", "os", "um", "uma",
  "para", "por", "com", "sem", "sobre", "ao", "aos", "que", "the", "of",
]);

export function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Chave estável do assunto. Usa CONJUNTO ORDENADO de palavras, e não a frase:
// a consultoria reescreve o mesmo ponto a cada mês ("falta de conciliação das
// contas bancárias" vira "contas bancárias sem conciliação"), e uma chave
// sensível à ordem trataria os dois como problemas distintos — o oposto do que
// o módulo existe para mostrar.
//
// Números ficam de fora pelo mesmo motivo: o valor e a competência mudam todo
// mês; o assunto não.
export function chaveRecorrencia(area: string, assunto: string): string {
  const palavras = [...new Set(normalizarTexto(assunto).split(" "))]
    .filter((p) => p.length >= 4 && !VAZIAS.has(p) && !/^\d+$/.test(p))
    .sort()
    .slice(0, 6);

  // Assunto que não sobreviveu à filtragem (só números, só palavras curtas)
  // cai no texto normalizado inteiro: chave feia, mas estável — melhor que
  // agrupar apontamentos diferentes sob uma chave vazia.
  const corpo = palavras.length > 0 ? palavras.join("-") : normalizarTexto(assunto).replace(/\s+/g, "-").slice(0, 60);
  return `${area}:${corpo || "sem-assunto"}`;
}

// Grau mínimo de sobreposição para considerar que duas chaves falam do mesmo
// assunto. Calibrado para tolerar uma palavra a mais ou a menos numa frase de
// cinco ou seis — a variação típica de quem reescreve o mesmo parágrafo no mês
// seguinte —, sem colar assuntos que apenas compartilham vocabulário.
const SOBREPOSICAO_MINIMA = 0.6;

function palavrasDaChave(chave: string): string[] {
  return chave.split(":")[1]?.split("-").filter(Boolean) ?? [];
}

// Reaproveita a chave de um assunto já existente quando a nova é praticamente a
// mesma.
//
// Existe porque a chave sozinha é frágil onde mais importa: "juros e multa por
// atraso no pagamento de fornecedores" e "atraso no pagamento de fornecedores
// gerando juros e multa" produzem chaves diferentes por causa de uma única
// palavra — e o sistema trataria como dois problemas novos o que é o mesmo
// problema há três meses, perdendo justamente o sinal mais valioso do módulo.
//
// A comparação usa o MAIOR dos dois conjuntos no denominador: assim uma frase
// bem mais longa não é absorvida por uma curta só porque a contém.
export function escolherChaveRecorrencia(candidata: string, existentes: string[]): string {
  const area = candidata.split(":")[0];
  const novas = new Set(palavrasDaChave(candidata));
  if (novas.size === 0) return candidata;

  let melhor: { chave: string; grau: number } | null = null;

  for (const existente of existentes) {
    // Só dentro da mesma área: "controle de jornada" (trabalhista) e "controle
    // de crédito" (fiscal) não podem virar o mesmo assunto por semelhança.
    if (!existente.startsWith(`${area}:`)) continue;
    const antigas = new Set(palavrasDaChave(existente));
    if (antigas.size === 0) continue;

    const comuns = [...novas].filter((p) => antigas.has(p)).length;
    if (comuns < 2) continue;

    const grau = comuns / Math.max(novas.size, antigas.size);
    if (grau >= SOBREPOSICAO_MINIMA && (!melhor || grau > melhor.grau)) {
      melhor = { chave: existente, grau };
    }
  }

  return melhor?.chave ?? candidata;
}

// Competência sempre no dia 1, à meia-noite local. Documento de julho enviado
// no dia 12 de agosto tem que cair em julho, e duas pessoas cadastrando o mesmo
// mês precisam produzir exatamente o mesmo instante — senão a comparação mês a
// mês passa a depender do dia em que alguém subiu o arquivo.
export function competenciaDe(data: Date): Date {
  return new Date(data.getFullYear(), data.getMonth(), 1, 0, 0, 0, 0);
}

// "2026-07" (o formato do <input type="month">) para Date. Feito por partes, e
// não com new Date(texto), porque string curta é interpretada como UTC e volta
// para junho no fuso do Brasil.
export function competenciaDeTexto(texto: string): Date | null {
  const m = texto.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) return null;
  return new Date(ano, mes - 1, 1, 0, 0, 0, 0);
}

export function competenciaParaTexto(data: Date): string {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}`;
}

const NOMES_MES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

export function rotuloCompetencia(data: Date): string {
  return `${NOMES_MES[data.getMonth()]}/${data.getFullYear()}`;
}
