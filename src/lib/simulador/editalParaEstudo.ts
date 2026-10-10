import { z } from "zod";
import { lerNumero } from "./numeros";
import { lerPremissasDoEdital, type PremissasDoEdital } from "./premissasDoEdital";
import { TIPOS_VEICULO, type TipoVeiculo } from "./tipos";

// O EDITAL LIDO → O ESTUDO NOVO.
//
// O que a leitura automática do edital (importarEdital.ts) devolve e como isso
// vira o formulário de Novo estudo. Este arquivo não fala com servidor nem com
// a IA: é o contrato da leitura e a conversão, para a tela e os testes usarem.
//
// A leitura TRANSCREVE o edital e os anexos; não precifica. O que ela teve de
// supor (tipo de veículo pela lotação, dias letivos não informados, km de rota
// sem quilometragem) vai em `suposicoes`, e as exigências que pesam no custo
// (idade máxima, monitor, ar, acessibilidade, garantia, reserva) em
// `exigencias` — as duas listas viram as "Regras do edital" do estudo, para a
// pessoa conferir antes de lançar preço. Os documentos de habilitação vão em
// `habilitacao`, por grupo (jurídica, fiscal, contábil, técnica…), e viram a
// aba Habilitação do estudo: a lista do que juntar, com a situação de cada um.

// Os serviços do estudo (estudos.ts, TIPOS_SERVICO). Repetidos aqui porque
// estudos.ts usa o banco e este arquivo vai para a tela; um teste garante que
// as duas listas são iguais.
export const SERVICOS_DO_EDITAL = ["FRETAMENTO", "FRETAMENTO_EVENTUAL", "ESCOLAR", "SAUDE", "LOCACAO_CM", "LOCACAO_SM", "OUTRO"] as const;
export const UNIDADES_DO_EDITAL = ["KM", "VEICULO_MES", "BINOMIA", "DIARIA", "HORA"] as const;
export const TEMAS_DE_EXIGENCIA = ["VEICULO", "PESSOAL", "OPERACAO", "CONTRATUAL", "TRIBUTARIO", "PENALIDADE", "OUTRO"] as const;

// Os grupos da habilitação (Lei 14.133, arts. 62 a 70; os editais da 8.666 e
// do Sistema S usam os mesmos), mais o que vai junto com a proposta.
export const GRUPOS_HABILITACAO = ["JURIDICA", "FISCAL", "CONTABIL", "TECNICA", "DECLARACAO", "PROPOSTA", "OUTRO"] as const;
export type GrupoHabilitacao = (typeof GRUPOS_HABILITACAO)[number];
export const ROTULO_GRUPO_HABILITACAO: Record<GrupoHabilitacao, string> = {
  JURIDICA: "Jurídica",
  FISCAL: "Fiscal, social e trabalhista",
  CONTABIL: "Econômico-financeira (contábil)",
  TECNICA: "Técnica — atestados e registros",
  DECLARACAO: "Declarações",
  PROPOSTA: "Junto com a proposta",
  OUTRO: "Outros",
};
// A situação da empresa em cada documento, na aba Habilitação.
export const SITUACOES_DOCUMENTO = ["PENDENTE", "PROVIDENCIANDO", "OK", "NAO_SE_APLICA"] as const;
export type SituacaoDocumento = (typeof SITUACOES_DOCUMENTO)[number];
export const ROTULO_SITUACAO_DOCUMENTO: Record<SituacaoDocumento, string> = { PENDENTE: "Pendente", PROVIDENCIANDO: "Providenciando", OK: "Pronto", NAO_SE_APLICA: "Não se aplica" };

const tipoVeiculo = z.enum(TIPOS_VEICULO as [TipoVeiculo, ...TipoVeiculo[]]);
const horario = z.string().nullable().describe("Horário no formato HH:MM (24 h). Nulo se o documento não informar.");
const fonte = z.string().nullable().describe("Arquivo e página de onde o dado saiu, ex.: \"Anexo 1, p. 2\" ou \"Edital, item 5.3\".");

const RotaSchema = z.object({
  nome: z.string().describe("Nome ou código da rota/itinerário como no documento."),
  tipoVeiculo: tipoVeiculo.nullable().describe("Pelo que o documento pede; pela lotação quando ele só diz o número de lugares (ver as regras)."),
  veiculos: z.number().nullable().describe("Veículos que operam a rota ao mesmo tempo."),
  kmDia: z.number().nullable().describe("Km por dia da rota, somados os veículos dela. Nulo se não houver."),
  horarioInicio: horario,
  horarioFim: horario,
  turnos: z.number().int().nullable().describe("Equipes de motorista por veículo no dia (1 manhã; 2 manhã e tarde com motoristas diferentes; ...). Nulo se não informado."),
  monitorasPorVeiculo: z.number().nullable().describe("Monitores exigidos por veículo. Nulo se o documento não exigir."),
  fonte,
});

const ItemSchema = z.object({
  descricao: z.string().describe("Item ou lote como o documento nomeia, com o tipo de veículo e o local."),
  tipoVeiculo: tipoVeiculo.nullable(),
  veiculos: z.number().nullable().describe("Frota operante do item (sem reserva). Quando o mesmo veículo faz rotas em períodos diferentes (manhã, tarde, noite), é a frota, não a soma das rotas."),
  kmMes: z.number().nullable().describe("Km por mês do item inteiro, quando o documento informa assim. Nulo se só houver km por dia ou por rota."),
  kmDia: z.number().nullable().describe("Km por dia do item inteiro, quando não há rotas detalhadas."),
  diasMes: z.number().int().nullable().describe("Dias de operação no mês (ex.: 22 de segunda a sexta). Nulo se não informado."),
  precoMaximo: z.number().nullable().describe("Preço máximo ou de referência DO ITEM na unidade de preço do edital, se for público. Nulo se sigiloso ou não informado. Nunca estime."),
  monitorasPorVeiculo: z.number().nullable(),
  horarioInicio: horario,
  horarioFim: horario,
  turnos: z.number().int().nullable(),
  rotas: z.array(RotaSchema).max(200).describe("As rotas/itinerários do item quando o documento as detalha (planilha de itinerários). Lista vazia se não houver."),
  fonte,
});

export const EditalSchema = z.object({
  resumo: z.string().describe("3 a 5 frases: o que se contrata, para quem, onde, quanto e por quanto tempo."),
  nomeSugerido: z.string().describe("Nome curto para o estudo, ex.: \"TCB Gama — escolar — PE 90002/2026\"."),
  esfera: z.enum(["PUBLICO", "PRIVADO"]).describe("PUBLICO para órgão público, empresa pública e Sistema S; PRIVADO para empresa privada."),
  tipoEstudo: z.enum(["LICITACAO", "CONTRATACAO_DIRETA", "RENOVACAO", "CONTRATO_PRIVADO", "OUTRO"]),
  orgao: z.string().nullable(),
  municipio: z.string().nullable().describe("Município onde o serviço é prestado (o do ISS)."),
  uf: z.string().nullable(),
  numeroEdital: z.string().nullable(),
  modalidade: z.string().nullable(),
  plataforma: z.string().nullable(),
  dataSessao: z.string().nullable().describe("AAAA-MM-DD."),
  objeto: z.string().nullable().describe("O objeto, resumido em até 400 caracteres."),
  tipoServico: z.enum(SERVICOS_DO_EDITAL),
  srp: z.boolean().describe("Registro de preços (ata, paga só o que for demandado)."),
  criterioJulgamento: z.enum(["ITEM", "LOTE"]).describe("ITEM: a proposta tem um preço unitário por item, mesmo que o julgamento seja pelo valor global do lote. LOTE: um preço único (ou desconto único) para todos os itens do lote."),
  unidadePreco: z.enum(UNIDADES_DO_EDITAL).describe("Como o contrato paga: por km, por veículo-mês, fixo + variável, por diária ou por hora."),
  abrangencia: z.enum(["MUNICIPAL", "INTERMUNICIPAL", "MISTO"]),
  vigenciaMeses: z.number().int().nullable(),
  prazoPagamentoDias: z.number().int().nullable(),
  valorTotalMaximo: z.number().nullable().describe("Valor estimado/máximo total da contratação, se público. Nulo se sigiloso."),
  indiceReajuste: z.string().nullable(),
  diasLetivosAno: z.number().int().nullable().describe("Só no escolar: os dias de operação no ano que o edital usa na conta do km (ex.: 20 dias × 11 meses = 220). Se ele não fizer a conta, os dias letivos que informar."),
  kmImprodutivoPagoPct: z.number().nullable().describe("% de km improdutivo que o edital SOMA ao km das rotas para chegar ao km pago (ex.: 5 para 5%). Nulo se o km pago for só o das rotas."),
  itens: z.array(ItemSchema).max(100),
  exigencias: z
    .array(
      z.object({
        tema: z.enum(TEMAS_DE_EXIGENCIA),
        texto: z.string().describe("A exigência em uma frase, com o número que o documento traz (idade máxima, lotação, % de garantia, reserva, multa)."),
        fonte,
      })
    )
    .max(60)
    .describe("Exigências que mudam o custo: idade máxima e características dos veículos, monitor, ar, acessibilidade, CNH e cursos, reserva técnica, garagem, rastreamento, garantia contratual, prazo de pagamento, reajuste, penalidades relevantes."),
  premissas: z
    .object({
      reservaTecnicaVeiculos: z.number().nullable().describe("Veículos de reserva técnica que o edital fixa (ex.: 3). Nulo se não fixar."),
      reservaTecnicaPct: z.number().nullable().describe("Reserva técnica em fração da frota quando o edital dá percentual (0,05 = 5%). Nulo se não der."),
      encargosSociaisPct: z.number().nullable().describe("Encargos sociais que o órgão FIXA para a proposta, em fração (0,7064 = 70,64%). Nulo se a licitante informa os dela."),
      salarioMotorista: z.number().nullable().describe("Piso salarial do motorista na convenção coletiva indicada pelo edital (R$/mês). Nulo se não houver."),
      salarioMonitor: z.number().nullable().describe("Piso do monitor/acompanhante na convenção indicada (R$/mês). Nulo se não houver."),
      valeRefeicaoDia: z.number().nullable().describe("Vale-refeição/auxílio-alimentação por DIA trabalhado na convenção indicada (R$). Se só houver valor mensal, divida por 22 e diga em suposições."),
      exigeVeiculoNovo: z.boolean().describe("true se a proposta tem de cotar veículo zero km."),
      idadeMaximaVeiculoAnos: z.number().nullable().describe("Idade máxima do veículo na ENTRADA em operação, em anos. Nulo se não houver."),
      consumoKmPorLitro: z.number().nullable().describe("Consumo de referência de diesel que o órgão fixa, em km por litro (0,35 L/km de diesel+ARLA é cerca de 3 km/L de diesel). Nulo se a licitante informa o dela."),
    })
    .describe("Os números que o edital FIXA para a proposta (não os que a licitante escolhe)."),
  habilitacao: z
    .array(
      z.object({
        grupo: z
          .enum(GRUPOS_HABILITACAO)
          .describe(
            "JURIDICA: ato constitutivo, contrato social, documentos dos sócios, procuração, autorização para funcionar. FISCAL: CNPJ, inscrições estadual/municipal, CND federal, estadual e municipal, FGTS (CRF), CNDT. CONTABIL: balanço e demonstrações, índices (LG, SG, LC), capital ou patrimônio líquido mínimo, certidão de falência, garantia de proposta. TECNICA: atestados de capacidade técnica, registro (ANTT, DER, EMTU, órgão de trânsito), visita técnica, relação de veículos, equipe. DECLARACAO: declarações pedidas (menor, ME/EPP, cota de PcD, inexistência de fato impeditivo, elaboração independente). PROPOSTA: o que vai com a proposta e não na habilitação (planilha de custos, catálogo, cronograma). OUTRO: o resto."
          ),
        documento: z.string().describe("O documento, como o edital o pede, em uma frase."),
        exigencia: z.string().nullable().describe("O detalhe que decide se a Azul atende: índice mínimo, % do capital, quantitativo e período do atestado, prazo de emissão da certidão, se aceita SICAF/CRC. Nulo se não houver."),
        fonte,
      })
    )
    .max(80)
    .describe("Todos os documentos de habilitação que o edital exige, um por linha, na ordem do edital. Inclui os que o SICAF/cadastro substitui (diga isso na exigência)."),
  suposicoes: z.array(z.string()).max(40).describe("O que você teve de deduzir ou que falta no documento (km não informado, dias letivos, tipo de veículo pela lotação, preço sigiloso)."),
});

export type EditalLido = z.infer<typeof EditalSchema>;

// ---------------------------------------------------------------------------
// A conversão para o formulário de Novo estudo.

// Os números como o formulário os tem (texto), para a pessoa conferir e mudar.
export type RotaImportada = {
  nome: string;
  tipoVeiculo: string;
  veiculos: string;
  kmDia: string;
  km: string;
  horarioInicio: string;
  horarioFim: string;
  turnos: string;
  monitoras: string;
};

export type ItemImportado = {
  descricao: string;
  tipoVeiculo: string;
  veiculos: string;
  km: string;
  precoMaximoKm: string;
  administrativo: boolean;
  turnos: string;
  diasMes: string;
  horarioInicio: string;
  horarioFim: string;
  monitoras: string;
  fonte: string;
  rotas: RotaImportada[];
};

export type RegraImportada = { tema: string; texto: string; fonte: string | null };
export type { PremissasDoEdital };
export type DocumentoImportado = { grupo: GrupoHabilitacao; documento: string; exigencia: string | null; fonte: string | null };

export type EstudoImportado = {
  campos: Record<string, string>;
  esfera: "PUBLICO" | "PRIVADO";
  tipo: string;
  tipoServico: string;
  abrangencia: "MUNICIPAL" | "INTERMUNICIPAL" | "MISTO";
  unidade: string;
  criterio: "ITEM" | "LOTE";
  srp: boolean;
  tipos: string[];
  itens: ItemImportado[];
  regras: RegraImportada[];
  habilitacao: DocumentoImportado[];
  // As premissas que o edital fixa (reserva, encargos, pisos…), aplicadas ao
  // estudo novo (premissasDoEdital.ts). Nulo se o edital não fixa nenhuma.
  premissas: PremissasDoEdital | null;
  resumo: string;
  // Quem leu (o modelo) e se a leitura foi refeita no modelo forte, e por quê.
  leitura?: { modelo: string; refeitaPorque: string | null };
};

// Sem dias letivos no edital, o escolar usa 200 (o mínimo da LDB) e diz isso.
export const DIAS_LETIVOS_PADRAO = 200;
const DIAS_MES_PADRAO = 22;

// No padrão do formulário (numeros.ts): vírgula decimal, sem milhar. Com ponto,
// "5.172" (R$/km) seria lido como 5.172 reais — mil vezes mais.
const txt = (v: number | null | undefined, casas = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "" : String(Number(v.toFixed(casas))).replace(".", ","));
const hhmm = (v: string | null | undefined) => {
  const m = /^(\d{1,2}):(\d{2})/.exec((v ?? "").trim());
  if (!m) return "";
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 23 && min <= 59 ? `${String(h).padStart(2, "0")}:${m[2]}` : "";
};
const turnosValidos = (t: number | null | undefined) => (t && Number.isInteger(t) && t >= 1 && t <= 4 ? String(t) : "1");

export function editalParaEstudo(e: EditalLido): EstudoImportado {
  const escolar = e.tipoServico === "ESCOLAR";
  const regras: RegraImportada[] = [];
  const dias = (d: number | null | undefined) => {
    if (escolar) return e.diasLetivosAno ?? DIAS_LETIVOS_PADRAO;
    return d ?? DIAS_MES_PADRAO;
  };
  if (escolar && !e.diasLetivosAno)
    regras.push({ tema: "SUPOSICAO", texto: `Dias letivos não informados: o km do período usa ${DIAS_LETIVOS_PADRAO} dias (mínimo da LDB).`, fonte: null });

  // Km improdutivo que o edital soma ao km pago (a TCB soma 5%): o km da rota
  // é o pago, e o km/dia fica o do itinerário.
  const pago = 1 + Math.max(0, Math.min(50, e.kmImprodutivoPagoPct ?? 0)) / 100;
  if (pago > 1)
    regras.push({ tema: "CONTRATUAL", texto: `O km pago soma ${txt(e.kmImprodutivoPagoPct, 2)}% de km improdutivo ao km dos itinerários: o km das rotas já inclui esse acréscimo. Na aba Premissas, o km improdutivo (o que roda sem receber) deve ser só o que passar disso.`, fonte: null });

  const itens: ItemImportado[] = e.itens.map((i) => {
    const diasDoItem = dias(i.diasMes);
    // Frota compartilhada: o mesmo veículo faz rotas em períodos diferentes
    // (a TCB tem 107 itinerários e 52 ônibus). Cada rota fica com a sua fração
    // da frota — o custo do veículo segue a frota, o km segue as rotas.
    const somaDasRotas = (i.rotas ?? []).reduce((a, r) => a + (r.veiculos ?? 1), 0);
    const fracao = i.veiculos && somaDasRotas > 0 && i.veiculos < somaDasRotas - 0.01 ? i.veiculos / somaDasRotas : 1;
    if (fracao < 1)
      regras.push({
        tema: "SUPOSICAO",
        texto: `${i.descricao.slice(0, 120)}: ${txt(i.veiculos)} veículos fazem as ${(i.rotas ?? []).length} rotas (que somam ${txt(somaDasRotas)}) em períodos diferentes; cada rota ficou com ${txt(fracao, 4)} da frota. Confira se a frota e os motoristas batem com o edital.`,
        fonte: i.fonte,
      });
    const rotas: RotaImportada[] = (i.rotas ?? []).map((r) => ({
      nome: r.nome.slice(0, 120),
      tipoVeiculo: r.tipoVeiculo ?? i.tipoVeiculo ?? "",
      veiculos: txt((r.veiculos ?? 1) * fracao, fracao < 1 ? 4 : 2),
      kmDia: txt(r.kmDia, 1),
      // Km de referência da rota (o pago): no mês (km/dia × dias do mês) ou,
      // no escolar, no ano letivo (km/dia × dias de operação do ano).
      km: r.kmDia ? txt(r.kmDia * pago * diasDoItem, 0) : "",
      horarioInicio: hhmm(r.horarioInicio),
      horarioFim: hhmm(r.horarioFim),
      turnos: turnosValidos(r.turnos ?? i.turnos),
      monitoras: txt(r.monitorasPorVeiculo ?? i.monitorasPorVeiculo, 2),
    }));
    const kmDasRotas = rotas.reduce((a, r) => a + (lerNumero(r.km) ?? 0), 0);
    const veiculosDasRotas = rotas.reduce((a, r) => a + (lerNumero(r.veiculos) ?? 0), 0);
    const kmDoItem = rotas.length > 0 ? kmDasRotas : i.kmMes && !escolar ? i.kmMes : i.kmDia ? i.kmDia * pago * diasDoItem : i.kmMes && escolar ? i.kmMes * 10 : 0;
    // Conferência: o km por dia das rotas contra o km do mês que o edital dá.
    const kmDiaDasRotas = (i.rotas ?? []).reduce((a, r) => a + (r.kmDia ?? 0), 0) * pago;
    if (kmDiaDasRotas > 0 && i.kmMes && i.diasMes) {
      const doEdital = i.kmMes / i.diasMes;
      if (Math.abs(kmDiaDasRotas / doEdital - 1) > 0.02)
        regras.push({ tema: "SUPOSICAO", texto: `${i.descricao.slice(0, 120)}: as rotas somam ${txt(kmDiaDasRotas, 1)} km/dia, mas o edital dá ${txt(i.kmMes, 1)} km/mês em ${i.diasMes} dias (${txt(doEdital, 1)} km/dia). Confira qual vale.`, fonte: i.fonte });
    }
    if (escolar && rotas.length === 0 && !i.kmDia && i.kmMes)
      regras.push({ tema: "SUPOSICAO", texto: `${i.descricao}: km por mês × 10 meses letivos para o km do período.`, fonte: i.fonte });
    return {
      descricao: i.descricao.slice(0, 200),
      tipoVeiculo: i.tipoVeiculo ?? rotas.find((r) => r.tipoVeiculo)?.tipoVeiculo ?? "",
      veiculos: txt(rotas.length > 0 ? veiculosDasRotas : (i.veiculos ?? 1), 2),
      km: kmDoItem > 0 ? txt(kmDoItem, 0) : "",
      // O teto vai na unidade do contrato (veículo-mês, diária, hora, km); a
      // binômia não tem um preço único, e o teto dela fica só como regra.
      precoMaximoKm: e.unidadePreco === "BINOMIA" ? "" : txt(i.precoMaximo, 4),
      administrativo: false,
      turnos: turnosValidos(i.turnos),
      diasMes: String(escolar ? DIAS_MES_PADRAO : Math.min(31, Math.max(1, Math.round(i.diasMes ?? DIAS_MES_PADRAO)))),
      horarioInicio: hhmm(i.horarioInicio),
      horarioFim: hhmm(i.horarioFim),
      monitoras: txt(i.monitorasPorVeiculo, 2),
      fonte: i.fonte ?? "",
      rotas,
    };
  });

  for (const i of e.itens)
    if (i.precoMaximo && e.unidadePreco === "BINOMIA")
      regras.push({ tema: "CONTRATUAL", texto: `${i.descricao}: preço máximo de ${i.precoMaximo.toLocaleString("pt-BR")} (tarifa binômia: confira em que parcela o teto vale).`, fonte: i.fonte });
  if (e.abrangencia === "MISTO")
    regras.push({ tema: "SUPOSICAO", texto: "Abrangência mista (municipal e intermunicipal): o estudo nasce como municipal (ISS). Ajuste o % intermunicipal (ICMS) de cada item na aba Operação.", fonte: null });
  for (const x of e.exigencias) regras.push({ tema: x.tema, texto: x.texto.slice(0, 600), fonte: x.fonte });
  for (const s of e.suposicoes) regras.push({ tema: "SUPOSICAO", texto: s.slice(0, 600), fonte: null });

  // Os tipos de veículo do estudo, na ordem em que aparecem (o primeiro é o
  // das rotas novas).
  const tipos: string[] = [];
  for (const i of itens) for (const t of [i.tipoVeiculo, ...i.rotas.map((r) => r.tipoVeiculo)]) if (t && !tipos.includes(t)) tipos.push(t);

  const campos: Record<string, string> = {
    nome: e.nomeSugerido.slice(0, 120),
    cliente: (e.orgao ?? "").slice(0, 160),
    municipio: (e.municipio ?? "").slice(0, 120),
    uf: (e.uf ?? "").slice(0, 2).toUpperCase(),
    vigenciaMeses: e.vigenciaMeses ? String(e.vigenciaMeses) : "12",
    prazoPagamentoDias: e.prazoPagamentoDias ? String(e.prazoPagamentoDias) : "",
    numeroEdital: (e.numeroEdital ?? "").slice(0, 80),
    modalidade: (e.modalidade ?? "").slice(0, 80),
    plataforma: (e.plataforma ?? "").slice(0, 120),
    dataSessao: /^\d{4}-\d{2}-\d{2}$/.test(e.dataSessao ?? "") ? (e.dataSessao as string) : "",
    valorTotalMaximo: e.valorTotalMaximo ? txt(e.valorTotalMaximo, 2) : "",
    indiceReajuste: (e.indiceReajuste ?? "").slice(0, 80),
    descricao: (e.objeto ?? e.resumo).slice(0, 2000),
  };

  return {
    campos,
    esfera: e.esfera,
    tipo: e.tipoEstudo,
    tipoServico: e.tipoServico,
    abrangencia: e.abrangencia,
    unidade: e.unidadePreco,
    criterio: e.criterioJulgamento,
    srp: e.srp,
    tipos,
    itens: itens.length > 0 ? itens : [],
    regras: regras.slice(0, 120),
    habilitacao: (e.habilitacao ?? [])
      .filter((d) => d.documento.trim() !== "")
      .slice(0, 80)
      .map((d) => ({ grupo: d.grupo, documento: d.documento.trim().slice(0, 500), exigencia: d.exigencia?.trim().slice(0, 1000) || null, fonte: d.fonte?.slice(0, 200) || null })),
    premissas: premissasDoEdital(e),
    resumo: e.resumo,
  };
}

// A reserva em veículos vira fração da frota operante (a soma dos itens).
function premissasDoEdital(e: EditalLido): PremissasDoEdital | null {
  const p = e.premissas;
  if (!p) return lerPremissasDoEdital({ kmImprodutivoPagoPct: e.kmImprodutivoPagoPct ? e.kmImprodutivoPagoPct / 100 : null });
  const frota = e.itens.reduce((a, i) => a + (i.veiculos ?? 0), 0);
  const reserva = p.reservaTecnicaPct ?? (p.reservaTecnicaVeiculos !== null && frota > 0 ? Math.round((p.reservaTecnicaVeiculos / frota) * 10000) / 10000 : null);
  return lerPremissasDoEdital({
    reservaTecnicaPct: reserva,
    kmImprodutivoPagoPct: e.kmImprodutivoPagoPct ? e.kmImprodutivoPagoPct / 100 : null,
    encargosSociaisPct: p.encargosSociaisPct,
    salarioMotorista: p.salarioMotorista,
    salarioMonitor: p.salarioMonitor,
    valeRefeicaoDia: p.valeRefeicaoDia,
    exigeVeiculoNovo: p.exigeVeiculoNovo,
    idadeMaximaVeiculoAnos: p.idadeMaximaVeiculoAnos,
    consumoKmPorLitro: p.consumoKmPorLitro,
  });
}
