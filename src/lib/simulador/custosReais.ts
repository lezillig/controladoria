import { prisma } from "@/lib/prisma";
import { tabela } from "@/lib/esquemaDoBanco";
import { competenciaSql, semProvisaoFuturaSql } from "@/lib/controladoria/competencia";
import { categoriaSql, ehCorporativoSql, filtroConexaoTitulo, naJanela, type EscopoSql } from "@/lib/controladoria/escopoSql";
import { LINHAS_DRE, RETENCOES_ZERADAS, montarDreDeInsumos, type Retencoes } from "@/lib/controladoria/dre";
import { categoriasDoEscopo, movimentoPorCategoria, retencoes } from "@/lib/controladoria/dreNoBanco";
import { ultimoMesFechado } from "@/lib/controladoria/periodos";
import { fmtData, fmtNumero } from "@/lib/controladoria/format";
import { familiaDoCombustivel } from "@/lib/controladoria/agents/frota";
import {
  disponibilidadeGestao,
  leiturasOpcionaisPendentes,
  lerAbastecimentos,
  lerMotoristas,
  lerUsosDeVeiculo,
  lerVeiculos,
} from "@/lib/gestao/leitura";
import { CATEGORIA_DO_TIPO, ROTULO_TIPO_VEICULO, type CategoriaVeiculo } from "./tipos";
import { tipoDoTexto } from "./premissas";

// OS CUSTOS REAIS DA EMPRESA, TRADUZIDOS EM PREMISSAS DO SIMULADOR.
//
// O simulador nasceu com três fontes de número: o PADRÃO (estimativa de
// mercado), a BASE (o que alguém digitou no Gabarito) e o AJUSTE (o que a
// pessoa mudou na tela). Nenhuma das três é medida. E a Azul já tem, espelhado
// neste sistema, o que ela de fato gastou: doze meses de DRE da Omie por
// categoria, o extrato do cartão de frota com litros e km de cada
// abastecimento, o cadastro de veículos e de pessoas da gestão.
//
// Este arquivo transforma esse material em INDICADORES — R$/litro pago,
// km/l por tipo de veículo, R$/km de manutenção e pneus, seguro e IPVA por
// veículo, custo da folha por pessoa, peso dos encargos, administração sobre a
// receita, carga tributária efetiva, km por veículo — e deixa a pessoa escolher
// quais viram premissa. A premissa escolhida passa a ter origem REAL, com a
// conta escrita ao lado.
//
// TRÊS REGRAS, e todas vêm do mesmo medo — o de um número "justo" que não é:
//
//   1. NADA É INVENTADO. Sem abastecimento, não há consumo; sem categoria de
//      pneu, não há R$/km de pneu. O que falta vira LACUNA com o motivo, nunca
//      um zero nem um padrão disfarçado de medida.
//   2. TODA CONTA VEM ESCRITA, com os números: "Σ R$ 45.320,00 ÷ Σ 7.412 l".
//      Quem for defender o preço numa licitação precisa refazer a conta de
//      cabeça, e quem desconfiar precisa saber onde olhar.
//   3. TODO INDICADOR DIZ O QUANTO VALE: confiança (amostra, meses cobertos,
//      classificação confirmada ou só proposta) e avisos. Um R$/km de
//      manutenção medido em dois meses é um número real e um péssimo preço.
//
// A CONTA É PURA (`analisarCustosReais`), e a COLHEITA é à parte
// (`carregarDadosReais`): a primeira se testa com dados montados à mão
// (scripts/teste-custos-reais.ts), sem banco; a segunda soma no banco e lê a
// gestão, e degrada para "sem dado + aviso" quando a gestão não responde.

// ---------------------------------------------------------------------------
// Os tipos
// ---------------------------------------------------------------------------

export type { Confianca, IndicadorReal } from "./aplicarReais";
import type { Confianca, IndicadorReal } from "./aplicarReais";

export type CategoriaReal = {
  codigo: string;
  descricao: string;
  // A linha do DRE em que ela entrou — classificada por uma pessoa ou
  // proposta automaticamente (`confirmada` diz qual das duas).
  linha: string;
  confirmada: boolean;
  // Centavos por mês, alinhados a `DadosReais.meses`, JÁ com o sinal que a
  // categoria tem dentro da linha: positivo engorda a linha, negativo (um
  // estorno, um reembolso) a reduz. É o mesmo sinal da demonstração.
  porMesCents: number[];
};

export type AbastecimentoReal = {
  vehicleId: string | null;
  dataHora: Date;
  valorCents: number;
  volumeLitros: number;
  // Km desde o abastecimento anterior, como o extrato do cartão informa.
  kmRodados: number | null;
  combustivel: string | null;
};

export type VeiculoReal = { id: string; placa: string; modelo: string; tipo: string; status: string };
export type PessoaReal = { id: string; ativo: boolean; funcao: string | null };
export type UsoReal = { vehicleId: string; checkInAt: Date; kmInicial: number; kmFinal: number | null };

export type DadosReais = {
  dataReferencia: Date;
  // Os doze meses FECHADOS, "AAAA-MM", do mais antigo ao mais recente. Mês
  // corrente fica fora: um mês pela metade tem a receita inteira do
  // faturamento e metade das despesas, e distorce todo percentual.
  meses: string[];
  // Valor de cada linha do DRE (inclusive subtotais) por mês, em centavos,
  // como a demonstração mostra — despesas em módulo.
  linhasDre: Record<string, number[]>;
  categorias: CategoriaReal[];
  // Movimento em categoria ainda não confirmada por uma pessoa, e sem
  // categoria nenhuma, na janela inteira.
  naoConfirmadoCents: number;
  semCategoriaCents: number;
  // Do cartão de frota, da gestão: da janela de doze meses até a referência.
  abastecimentos: AbastecimentoReal[];
  veiculos: VeiculoReal[];
  pessoas: PessoaReal[];
  usos: UsoReal[];
  gestaoDisponivel: boolean;
  // O DRE está filtrado por UMA empresa do grupo, e a frota da gestão é do
  // grupo inteiro: dividir um pelo outro mistura escopos, e o indicador avisa.
  conexaoFiltrada: boolean;
  // Avisos da coleta (gestão fora do ar, leitura opcional sem permissão…).
  avisos: string[];
};

export type AnaliseCustosReais = {
  indicadores: IndicadorReal[];
  // O que NÃO pôde ser medido, e por quê. É tão informativo quanto os
  // indicadores: "sem km no extrato" é um defeito de cadastro a corrigir.
  lacunas: string[];
};

// ---------------------------------------------------------------------------
// As regras de corte — em um lugar, com o motivo
// ---------------------------------------------------------------------------

// Preço por litro fora desta faixa é erro de digitação (vírgula no lugar
// errado) ou produto trocado no registro; com o diesel entre R$ 5 e R$ 7 em
// 2026, a faixa é larga de propósito para não cortar posto caro de estrada.
const PRECO_LITRO_MIN = 2;
const PRECO_LITRO_MAX = 15;
// Km entre dois abastecimentos acima disto não cabe no tanque de nenhum
// veículo da frota (ônibus: ~300 l × 3 km/l ≈ 900 km): é hodômetro errado ou
// abastecimento anterior que não entrou no extrato.
const KM_POR_ABASTECIMENTO_MAX = 2000;
// Km/l fora desta faixa não existe para veículo a combustão — nem ônibus
// carregado na serra (≈ 1,5), nem carro econômico na estrada (≈ 20).
const KM_POR_LITRO_MIN = 0.5;
const KM_POR_LITRO_MAX = 30;
// Com pelo menos isto de registros num tipo, os quartis são estimáveis e a
// regra de Tukey (1,5 × intervalo interquartil) corta o que é atípico PARA
// AQUELE TIPO — o que é absurdo para um ônibus é normal para um carro, e só o
// corte absoluto acima não pega isso.
const MINIMO_PARA_TUKEY = 8;
// Abaixo disto não há indicador — três registros ainda são real, mas já não
// são uma média.
const MINIMO_DE_REGISTROS = 3;
// Uso de veículo (check-in/check-out) com mais que isto num dia é km digitado
// errado.
const KM_POR_USO_MAX = 2000;
// Parte do valor em categoria só PROPOSTA acima da qual a confiança cai.
const LIMITE_NAO_CONFIRMADO = 0.25;
// Parte dos litros sem km acima da qual o km da frota está subcontado — e
// todo R$/km calculado sobre ele, inflado.
const LIMITE_LITROS_SEM_KM = 0.2;
const JANELA_PRECO_DIAS = 90;
const MS_DIA = 86_400_000;

// As linhas do DRE onde vive o custo do VEÍCULO. CUSTO_SERVICO entra porque é
// onde muita empresa lança a operação inteira (combustível, manutenção) — a
// descrição da categoria é que decide se ela é manutenção, pneu ou seguro.
const LINHAS_DO_VEICULO = ["DESPESA_VEICULOS", "CUSTO_SERVICO"];
const LINHAS_DE_RECEITA = new Set(["RECEITA_BRUTA", "OUTRAS_RECEITAS", "RECEITA_FINANCEIRA"]);
// Administração central: tudo o que a empresa gasta para existir e que não é
// frota, gente da operação, sócio, financeiro ou investimento.
const LINHAS_DE_ADMINISTRACAO = ["DESPESA_SALARIOS_CORPORATIVO", "DESPESA_ADMINISTRATIVA", "DESPESA_ESTRUTURA", "DESPESA_INFORMATICA", "DESPESA_COMERCIAL", "DESPESA_GERAL"];
// O custo DIRETO da operação, para converter a administração para a base em
// que o simulador a aplica.
const LINHAS_DE_CUSTO_DIRETO = ["CUSTO_SERVICO", "DESPESA_VEICULOS", "DESPESA_SALARIOS"];

// Os padrões sobre a descrição SEM ACENTO e em minúsculas (ver `normalizar`).
const PADRAO_MANUTENCAO = /manutenc|\bpecas?\b|autopec|oficina|mecanic|funilaria|revisao|retifica|eletrica automotiva|guincho|socorro mecanico/;
const PADRAO_PNEU = /pneu|recap|recauch|borrach/;
// "Óleo diesel" é combustível, não troca de óleo — por isso a exclusão.
const PADRAO_OLEO = /\boleo\b|lubrific|filtro|lavagem|lava.?rapido/;
const EXCLUI_OLEO = /diesel|combust/;
// "Seguro de vida" e "seguro saúde" são benefício; "seguro predial" é sede.
const PADRAO_SEGURO = /seguro/;
const EXCLUI_SEGURO = /vida|saude|pessoal|funcionari|colaborador|predial|imovel|empresarial|garantia/;
const PADRAO_IPVA = /ipva|licenciamento|dpvat|crlv/;
// Pessoal que pode morar em CUSTO_SERVICO (a folha dos motoristas lançada
// como custo do serviço).
const PADRAO_PESSOAL = /salari|ordenado|folha|ferias|decimo|\b13|rescis|fgts|inss|encargo|beneficio|vale.?(transporte|refeicao|alimentacao)|cesta basica|plano de saude|hora.?extra/;
// Encargos e provisões, como o simulador os entende (`pessoal.encargosPct`):
// o que a empresa paga ALÉM do salário do mês por causa dele — INSS patronal,
// FGTS, férias com o terço, 13º e rescisões.
const PADRAO_ENCARGO = /inss|fgts|ferias|decimo|\b13|rescis|encargo|\bgps\b|provis/;
const PADRAO_SALARIO = /salari|ordenado|folha de pagamento|^folha\b|remuneracao/;
const PADRAO_MOTORISTA = /motorist|condutor/;

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function normalizar(s: string | null | undefined): string {
  return (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const MES_CURTO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function chaveDoMes(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function rotuloDoMes(chave: string): string {
  const [ano, mes] = chave.split("-").map(Number);
  return `${MES_CURTO[mes - 1]}/${ano}`;
}

function periodoDosMeses(meses: string[]): string {
  if (meses.length === 0) return "—";
  return meses.length === 1 ? rotuloDoMes(meses[0]) : `${rotuloDoMes(meses[0])} a ${rotuloDoMes(meses[meses.length - 1])}`;
}

const reais = (v: number, casas = 2) => `R$ ${fmtNumero(v, casas)}`;
const deCents = (cents: number, casas = 2) => reais(cents / 100, casas);
const pct = (fracao: number, casas = 1) => `${fmtNumero(fracao * 100, casas)}%`;
const soma = (xs: number[]) => xs.reduce((a, v) => a + v, 0);


function rebaixar(c: Confianca): Confianca {
  return c === "ALTA" ? "MEDIA" : "BAIXA";
}

function confiancaPorRegistros(n: number, alta = 30, media = 10): Confianca {
  return n >= alta ? "ALTA" : n >= media ? "MEDIA" : "BAIXA";
}

// Um ano quase inteiro é ALTA; meio ano ainda diz alguma coisa; menos que
// isso é um trimestre, e numa operação com calendário escolar um trimestre
// pode ser só as férias.
function confiancaPorMeses(n: number): Confianca {
  return n >= 10 ? "ALTA" : n >= 6 ? "MEDIA" : "BAIXA";
}

// Percentil com interpolação linear (o PERCENTILE.INC do Excel).
function percentil(ordenados: number[], p: number): number {
  if (ordenados.length === 0) return NaN;
  const pos = (ordenados.length - 1) * p;
  const i = Math.floor(pos);
  const f = pos - i;
  return i + 1 < ordenados.length ? ordenados[i] + f * (ordenados[i + 1] - ordenados[i]) : ordenados[i];
}

function listaDeNomes(nomes: string[], max = 4): string {
  const unicos = [...new Set(nomes)];
  return unicos.length <= max ? unicos.join(", ") : `${unicos.slice(0, max).join(", ")} e mais ${unicos.length - max}`;
}

// Mede-se pela CATEGORIA (carro, van, micro, ônibus): a van adaptada e a van
// comum rodam e consomem igual, e separar encolheria a amostra. O indicador
// da categoria vale para as variantes dela ao aplicar (aplicarReais.ts).
function tipoDoVeiculo(v: VeiculoReal | undefined): CategoriaVeiculo | null {
  if (!v) return null;
  const t = tipoDoTexto(v.tipo) ?? tipoDoTexto(v.modelo);
  return t ? CATEGORIA_DO_TIPO[t] : null;
}
const CATEGORIAS: CategoriaVeiculo[] = ["CARRO", "VAN", "MICRO", "ONIBUS"];

// Veículo que ainda gera seguro e IPVA: tudo o que não foi baixado. O veículo
// parado na oficina continua segurado e licenciado.
const veiculoAtivo = (v: VeiculoReal) => v.status !== "INATIVO";

// ---------------------------------------------------------------------------
// Categorias do DRE
// ---------------------------------------------------------------------------

type Selecao = {
  usadas: CategoriaReal[];
  // As que casam com o padrão mas estão em outra linha de despesa: NÃO
  // entram, e o aviso diz quais — pode ser só classificação a corrigir.
  foraDasLinhas: CategoriaReal[];
};

function selecionar(dados: DadosReais, linhas: string[], padrao: RegExp, exclui?: RegExp): Selecao {
  const casa = (c: CategoriaReal) => {
    const d = normalizar(c.descricao);
    return padrao.test(d) && !(exclui && exclui.test(d));
  };
  const comValor = dados.categorias.filter((c) => c.porMesCents.some((v) => v !== 0));
  return {
    usadas: comValor.filter((c) => linhas.includes(c.linha) && casa(c)),
    foraDasLinhas: comValor.filter((c) => !linhas.includes(c.linha) && !LINHAS_DE_RECEITA.has(c.linha) && c.linha !== "DEDUCOES" && casa(c)),
  };
}

function somaDasCategorias(cats: CategoriaReal[], indices?: Set<number>): number {
  return soma(cats.map((c) => soma(c.porMesCents.filter((_, i) => !indices || indices.has(i)))));
}

function mesesComValor(cats: CategoriaReal[], n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (cats.some((c) => c.porMesCents[i] !== 0)) out.push(i);
  return out;
}

// Quanto do valor usado está em categoria cuja linha é só PROPOSTA — o
// palpite automático pelo nome, que ninguém conferiu.
function avisosDeClassificacao(sel: Selecao, rotuloDoPadrao: string): { avisos: string[]; rebaixa: boolean } {
  const avisos: string[] = [];
  const total = soma(sel.usadas.map((c) => Math.abs(somaDasCategorias([c]))));
  const proposto = soma(sel.usadas.filter((c) => !c.confirmada).map((c) => Math.abs(somaDasCategorias([c]))));
  const parte = total > 0 ? proposto / total : 0;
  if (parte > 0) {
    avisos.push(
      `${pct(parte, 0)} do valor está em categorias com a linha do DRE apenas proposta automaticamente, não confirmada (${listaDeNomes(sel.usadas.filter((c) => !c.confirmada).map((c) => c.descricao))}).`
    );
  }
  if (sel.foraDasLinhas.length > 0) {
    avisos.push(
      `Categorias que parecem ${rotuloDoPadrao} mas estão classificadas em outra linha do DRE e ficaram FORA da conta: ${listaDeNomes(
        sel.foraDasLinhas.map((c) => `${c.descricao} (${c.linha}, ${deCents(somaDasCategorias([c]))})`)
      )}. Se forem mesmo ${rotuloDoPadrao}, reclassifique no DRE.`
    );
  }
  return { avisos, rebaixa: parte > LIMITE_NAO_CONFIRMADO };
}

// Meses em que a base tem movimento de fato. Uma base que começou a ser
// espelhada há cinco meses tem sete meses de zero na janela — e dividir o
// seguro do ano por doze ali subestimaria o seguro em mais da metade.
function mesesCobertos(dados: DadosReais): number[] {
  const out: number[] = [];
  for (let i = 0; i < dados.meses.length; i++) {
    const receita = dados.linhasDre.RECEITA_BRUTA?.[i] ?? 0;
    if (receita !== 0 || dados.categorias.some((c) => c.porMesCents[i] !== 0)) out.push(i);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Combustível e km — o extrato do cartão de frota
// ---------------------------------------------------------------------------

type RegistroDeConsumo = { a: AbastecimentoReal; tipo: CategoriaVeiculo | null; kmPorLitro: number };

type LeituraDoCartao = {
  // Registros de combustível (sem ARLA) com km e litros plausíveis.
  validos: RegistroDeConsumo[];
  semKm: number;
  absurdos: number;
  litrosTotais: number;
  litrosSemKm: number;
  semVeiculo: number;
};

function lerCartao(abastecimentos: AbastecimentoReal[], veiculos: Map<string, VeiculoReal>): LeituraDoCartao {
  const r: LeituraDoCartao = { validos: [], semKm: 0, absurdos: 0, litrosTotais: 0, litrosSemKm: 0, semVeiculo: 0 };
  for (const a of abastecimentos) {
    if (familiaDoCombustivel(a.combustivel) === "ARLA") continue;
    if (!(a.volumeLitros > 0)) {
      r.absurdos++;
      continue;
    }
    if (!a.vehicleId || !veiculos.has(a.vehicleId)) {
      r.semVeiculo++;
      continue;
    }
    r.litrosTotais += a.volumeLitros;
    if (a.kmRodados === null || !(a.kmRodados > 0)) {
      r.semKm++;
      r.litrosSemKm += a.volumeLitros;
      continue;
    }
    const kmPorLitro = a.kmRodados / a.volumeLitros;
    if (a.kmRodados > KM_POR_ABASTECIMENTO_MAX || kmPorLitro < KM_POR_LITRO_MIN || kmPorLitro > KM_POR_LITRO_MAX) {
      r.absurdos++;
      continue;
    }
    r.validos.push({ a, tipo: tipoDoVeiculo(veiculos.get(a.vehicleId)), kmPorLitro });
  }
  return r;
}

type KmDaFrota = {
  fonte: "CARTAO" | "USO";
  descricaoFonte: string;
  kmPorMes: number[];
  veiculosPorMes: number[];
  total: number;
  avisos: string[];
  rebaixa: boolean;
};

// O KM DA FROTA POR MÊS, de uma das duas fontes: o km entre abastecimentos do
// cartão ou o km de check-in/check-out do uso de veículo. As duas SUBCONTAM
// (abastecimento fora do cartão, motorista que não fez check-out), e nenhuma
// supercontam depois dos cortes — então a de MAIOR total é a menos incompleta.
// Misturar as duas mês a mês somaria o mesmo km duas vezes.
function kmDaFrota(dados: DadosReais, cartao: LeituraDoCartao): KmDaFrota | null {
  const indiceDoMes = new Map(dados.meses.map((m, i) => [m, i]));
  const n = dados.meses.length;

  const doCartao = { km: new Array<number>(n).fill(0), veiculos: Array.from({ length: n }, () => new Set<string>()) };
  for (const r of cartao.validos) {
    const i = indiceDoMes.get(chaveDoMes(r.a.dataHora));
    if (i === undefined) continue;
    doCartao.km[i] += r.a.kmRodados as number;
    doCartao.veiculos[i].add(r.a.vehicleId as string);
  }
  const doUso = { km: new Array<number>(n).fill(0), veiculos: Array.from({ length: n }, () => new Set<string>()) };
  let usosDescartados = 0;
  for (const u of dados.usos) {
    const i = indiceDoMes.get(chaveDoMes(u.checkInAt));
    if (i === undefined) continue;
    const km = u.kmFinal === null ? null : u.kmFinal - u.kmInicial;
    if (km === null || km <= 0 || km > KM_POR_USO_MAX) {
      usosDescartados++;
      continue;
    }
    doUso.km[i] += km;
    doUso.veiculos[i].add(u.vehicleId);
  }

  const totalCartao = soma(doCartao.km);
  const totalUso = soma(doUso.km);
  if (totalCartao <= 0 && totalUso <= 0) return null;

  const avisos: string[] = [];
  let rebaixa = false;
  if (totalCartao >= totalUso) {
    const parteSemKm = cartao.litrosTotais > 0 ? cartao.litrosSemKm / cartao.litrosTotais : 0;
    if (parteSemKm > 0) {
      avisos.push(
        `${pct(parteSemKm, 0)} dos litros do cartão vieram sem km no extrato: o km da frota está subcontado nessa proporção, e o R$/km, inflado.`
      );
    }
    if (parteSemKm > LIMITE_LITROS_SEM_KM) rebaixa = true;
    if (totalUso > 0) avisos.push(`O uso de veículo (check-in/check-out) registra ${fmtNumero(totalUso)} km no mesmo período; ficou de fora por ser menor que o do cartão.`);
    return {
      fonte: "CARTAO",
      descricaoFonte: "km entre abastecimentos do extrato do cartão de frota",
      kmPorMes: doCartao.km,
      veiculosPorMes: doCartao.veiculos.map((s) => s.size),
      total: totalCartao,
      avisos,
      rebaixa,
    };
  }
  if (usosDescartados > 0) avisos.push(`${fmtNumero(usosDescartados)} uso(s) de veículo sem km final, com km negativo ou acima de ${fmtNumero(KM_POR_USO_MAX)} km ficaram fora.`);
  if (totalCartao > 0) avisos.push(`O extrato do cartão registra ${fmtNumero(totalCartao)} km no mesmo período; ficou de fora por ser menor que o do uso de veículo.`);
  return {
    fonte: "USO",
    descricaoFonte: "km de check-in/check-out do uso de veículo da gestão",
    kmPorMes: doUso.km,
    veiculosPorMes: doUso.veiculos.map((s) => s.size),
    total: totalUso,
    avisos,
    rebaixa,
  };
}

// ---------------------------------------------------------------------------
// A análise
// ---------------------------------------------------------------------------

export function indicadoresReais(dados: DadosReais): IndicadorReal[] {
  return analisarCustosReais(dados).indicadores;
}

export function analisarCustosReais(dados: DadosReais): AnaliseCustosReais {
  const indicadores: IndicadorReal[] = [];
  const lacunas: string[] = [...dados.avisos];
  const veiculos = new Map(dados.veiculos.map((v) => [v.id, v]));
  const periodoDre = periodoDosMeses(dados.meses);
  const avisoDeEscopo = dados.conexaoFiltrada
    ? ["O DRE está filtrado por uma empresa do grupo, e a frota e as pessoas da gestão são do grupo inteiro: a divisão mistura escopos."]
    : [];

  const semGestao = !dados.gestaoDisponivel;
  if (semGestao) {
    lacunas.push("Sistema de gestão indisponível: preço pago, consumo, km da frota, custos por veículo e por pessoa não foram medidos.");
  }

  // ---- 1. Combustível: preço pago por litro, últimos 90 dias ----
  const fimDaReferencia = new Date(dados.dataReferencia.getTime());
  fimDaReferencia.setHours(0, 0, 0, 0);
  const fimExclusivo = new Date(fimDaReferencia.getTime() + MS_DIA);
  const inicioPreco = new Date(fimExclusivo.getTime() - JANELA_PRECO_DIAS * MS_DIA);
  const periodoPreco = `${fmtData(inicioPreco)} a ${fmtData(fimDaReferencia)} (${JANELA_PRECO_DIAS} dias)`;
  const noPreco = dados.abastecimentos.filter(
    (a) => a.dataHora >= inicioPreco && a.dataHora < fimExclusivo && familiaDoCombustivel(a.combustivel) !== "ARLA"
  );

  if (dados.abastecimentos.length === 0) {
    if (!semGestao) lacunas.push("Nenhum abastecimento do cartão de frota nos últimos doze meses: preço pago, consumo e km da frota não foram medidos.");
  } else if (noPreco.length === 0) {
    lacunas.push(`Nenhum abastecimento de combustível nos últimos ${JANELA_PRECO_DIAS} dias: preço pago por litro não foi medido.`);
  } else {
    const plausivel = (a: AbastecimentoReal) => {
      if (!(a.volumeLitros > 0)) return false;
      const p = a.valorCents / 100 / a.volumeLitros;
      return p >= PRECO_LITRO_MIN && p <= PRECO_LITRO_MAX;
    };
    const foraDaFaixa = noPreco.filter((a) => !plausivel(a)).length;
    const regraDaFaixa = foraDaFaixa > 0 ? ` Fora da conta: ${fmtNumero(foraDaFaixa)} registro(s) com preço por litro fora de ${reais(PRECO_LITRO_MIN, 0)} a ${reais(PRECO_LITRO_MAX, 0)} (erro de digitação ou produto trocado).` : "";
    const precoDe = (lista: AbastecimentoReal[], caminho: string, rotulo: string, descricao: string, avisos: string[] = []) => {
      const validos = lista.filter(plausivel);
      if (validos.length < MINIMO_DE_REGISTROS) {
        lacunas.push(`${rotulo}: só ${validos.length} abastecimento(s) válido(s) em ${JANELA_PRECO_DIAS} dias — pouco para uma média.`);
        return;
      }
      const valor = soma(validos.map((a) => a.valorCents));
      const litros = soma(validos.map((a) => a.volumeLitros));
      indicadores.push({
        caminho,
        rotulo,
        valor: valor / 100 / litros,
        unidade: "R$/litro",
        base: `Σ ${deCents(valor)} ÷ Σ ${fmtNumero(litros, 1)} litros em ${fmtNumero(validos.length)} abastecimentos de ${descricao} no cartão de frota.${regraDaFaixa}`,
        periodo: periodoPreco,
        amostra: validos.length,
        confianca: confiancaPorRegistros(validos.length),
        avisos,
      });
    };

    const diesel = noPreco.filter((a) => familiaDoCombustivel(a.combustivel) === "DIESEL");
    const otto = noPreco.filter((a) => familiaDoCombustivel(a.combustivel) === "OTTO");
    const semProduto = noPreco.filter((a) => familiaDoCombustivel(a.combustivel) === null).length;
    const avisoProduto = semProduto > 0 ? [`${fmtNumero(semProduto)} abastecimento(s) sem produto identificável no extrato ficaram fora da separação diesel × gasolina.`] : [];
    if (diesel.length > 0) precoDe(diesel, "variaveis.dieselLitro", "Diesel pago", "diesel", avisoProduto);
    else lacunas.push(`Nenhum abastecimento de diesel identificado nos últimos ${JANELA_PRECO_DIAS} dias.`);
    if (otto.length > 0) {
      precoDe(otto, "referencia:gasolinaLitro", "Gasolina/etanol pago", "gasolina e etanol", [
        ...avisoProduto,
        "Referência para os perfis movidos a gasolina/etanol (carro): o campo do simulador se chama diesel, mas é o combustível do perfil.",
      ]);
    }

    // Por tipo de veículo: o que os veículos DAQUELE tipo pagaram, qualquer
    // que seja o combustível — é o número que vai no perfil do tipo.
    for (const tipo of CATEGORIAS) {
      const doTipo = noPreco.filter((a) => a.vehicleId && tipoDoVeiculo(veiculos.get(a.vehicleId)) === tipo);
      if (doTipo.filter(plausivel).length < MINIMO_DE_REGISTROS) continue;
      precoDe(doTipo, `perfil:${tipo}:variaveis.dieselLitro`, `Combustível pago — ${ROTULO_TIPO_VEICULO[tipo]}`, `veículos do tipo ${ROTULO_TIPO_VEICULO[tipo].toLowerCase()}`);
    }
  }

  // ---- 2. Consumo real por tipo de veículo, doze meses ----
  const inicioDaJanela = dados.meses.length > 0 ? new Date(Number(dados.meses[0].slice(0, 4)), Number(dados.meses[0].slice(5, 7)) - 1, 1) : fimExclusivo;
  const periodoCartao = `${fmtData(inicioDaJanela)} a ${fmtData(fimDaReferencia)}`;
  const naJanelaDoCartao = dados.abastecimentos.filter((a) => a.dataHora >= inicioDaJanela && a.dataHora < fimExclusivo);
  const cartao = lerCartao(naJanelaDoCartao, veiculos);

  if (naJanelaDoCartao.length > 0) {
    if (cartao.validos.length === 0) {
      lacunas.push("Nenhum abastecimento com km informado no extrato do cartão: consumo real (km/l) e km da frota pelo cartão não foram medidos.");
    }
    const semTipo = cartao.validos.filter((r) => r.tipo === null);
    if (semTipo.length > 0) {
      const placas = [...new Set(semTipo.map((r) => veiculos.get(r.a.vehicleId as string)?.placa ?? "?"))];
      lacunas.push(`${fmtNumero(semTipo.length)} abastecimento(s) de veículo sem tipo reconhecível no cadastro (${listaDeNomes(placas)}) ficaram fora do consumo por tipo.`);
    }
    if (cartao.semVeiculo > 0) {
      lacunas.push(`${fmtNumero(cartao.semVeiculo)} abastecimento(s) de placa fora do cadastro de veículos ficaram fora do consumo e do km da frota.`);
    }

    for (const tipo of CATEGORIAS) {
      const doTipo = cartao.validos.filter((r) => r.tipo === tipo);
      if (doTipo.length === 0) continue;
      let mantidos = doTipo;
      let regraTukey = "";
      if (doTipo.length >= MINIMO_PARA_TUKEY) {
        const ord = doTipo.map((r) => r.kmPorLitro).sort((x, y) => x - y);
        const q1 = percentil(ord, 0.25);
        const q3 = percentil(ord, 0.75);
        const iqr = q3 - q1;
        const lo = q1 - 1.5 * iqr;
        const hi = q3 + 1.5 * iqr;
        mantidos = doTipo.filter((r) => r.kmPorLitro >= lo && r.kmPorLitro <= hi);
        const cortados = doTipo.length - mantidos.length;
        regraTukey = ` Atípicos para o tipo (fora de ${fmtNumero(Math.max(0, lo), 2)} a ${fmtNumero(hi, 2)} km/l, 1,5 × o intervalo interquartil): ${fmtNumero(cortados)} registro(s) fora.`;
      }
      if (mantidos.length < MINIMO_DE_REGISTROS) {
        lacunas.push(`Consumo — ${ROTULO_TIPO_VEICULO[tipo]}: só ${mantidos.length} abastecimento(s) com km válido — pouco para uma média.`);
        continue;
      }
      const km = soma(mantidos.map((r) => r.a.kmRodados as number));
      const litros = soma(mantidos.map((r) => r.a.volumeLitros));
      const nVeiculos = new Set(mantidos.map((r) => r.a.vehicleId)).size;
      let confianca = confiancaPorRegistros(mantidos.length);
      if (confianca === "ALTA" && nVeiculos < 3) confianca = "MEDIA";
      const avisos: string[] = [];
      if (nVeiculos < 3) avisos.push(`Medido em só ${nVeiculos} veículo(s) do tipo: é o consumo deles, não do tipo.`);
      avisos.push("Consumo médio da operação real (asfalto e terra misturados, como a frota rodou).");
      indicadores.push({
        caminho: `perfil:${tipo}:variaveis.consumoAsfaltoKmL`,
        rotulo: `Consumo real — ${ROTULO_TIPO_VEICULO[tipo]}`,
        valor: km / litros,
        unidade: "km/l",
        base:
          `Σ ${fmtNumero(km)} km ÷ Σ ${fmtNumero(litros, 1)} litros em ${fmtNumero(mantidos.length)} abastecimentos de ${fmtNumero(nVeiculos)} veículo(s) do tipo, com km informado no extrato do cartão. ` +
          `Regra de exclusão (em toda a frota): sem km (${fmtNumero(cartao.semKm)}), ou km acima de ${fmtNumero(KM_POR_ABASTECIMENTO_MAX)} por abastecimento ou fora de ${fmtNumero(KM_POR_LITRO_MIN, 1)} a ${fmtNumero(KM_POR_LITRO_MAX)} km/l (${fmtNumero(cartao.absurdos)}).${regraTukey}`,
        periodo: periodoCartao,
        amostra: mantidos.length,
        confianca,
        avisos,
      });
    }
  }

  // ---- 3. Km da frota: base dos custos por km e da utilização ----
  const km = kmDaFrota(dados, cartao);
  if (!km && !semGestao) lacunas.push("Sem km da frota (nem no extrato do cartão, nem no uso de veículo): os custos por km não foram medidos.");

  const custoPorKm = (caminho: string, rotulo: string, padrao: RegExp, exclui: RegExp | undefined, nomeDoPadrao: string) => {
    const sel = selecionar(dados, LINHAS_DO_VEICULO, padrao, exclui);
    if (sel.usadas.length === 0) {
      const fora = sel.foraDasLinhas.length > 0 ? ` (há ${listaDeNomes(sel.foraDasLinhas.map((c) => `${c.descricao} em ${c.linha}`))} — classificar em Despesas com veículos resolve)` : "";
      lacunas.push(`${rotulo}: nenhuma categoria de ${nomeDoPadrao} entre as despesas com veículos e o custo do serviço no DRE${fora}.`);
      return;
    }
    if (!km) return;
    const mesesComKm = new Set(km.kmPorMes.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0));
    const custo = somaDasCategorias(sel.usadas, mesesComKm);
    const kmTotal = soma(km.kmPorMes.filter((_, i) => mesesComKm.has(i)));
    const custoFora = somaDasCategorias(sel.usadas) - custo;
    const cls = avisosDeClassificacao(sel, nomeDoPadrao);
    let confianca = confiancaPorMeses(mesesComKm.size);
    if (cls.rebaixa) confianca = rebaixar(confianca);
    if (km.rebaixa) confianca = rebaixar(confianca);
    const avisos = [
      "Média da frota inteira (carros, vans, micros e ônibus juntos): um ônibus custa mais por km que uma van. Vale para o veículo padrão, não para um perfil.",
      ...cls.avisos,
      ...km.avisos,
      ...avisoDeEscopo,
    ];
    if (custoFora !== 0) avisos.push(`${deCents(custoFora)} lançados em meses sem km medido ficaram fora, para custo e km serem dos mesmos meses.`);
    if (custo <= 0) {
      lacunas.push(`${rotulo}: as categorias de ${nomeDoPadrao} não têm valor nos meses com km medido.`);
      return;
    }
    const meses = [...mesesComKm].sort((a, b) => a - b).map((i) => dados.meses[i]);
    indicadores.push({
      caminho,
      rotulo,
      valor: custo / 100 / kmTotal,
      unidade: "R$/km",
      base: `Σ ${deCents(custo)} em ${listaDeNomes(sel.usadas.map((c) => c.descricao))} ÷ Σ ${fmtNumero(kmTotal)} km da frota (${km.descricaoFonte}), nos ${mesesComKm.size} mês(es) com km medido.`,
      periodo: periodoDosMeses(meses),
      amostra: mesesComKm.size,
      confianca,
      avisos,
    });
  };

  custoPorKm("variaveis.manutencaoAsfaltoKm", "Manutenção real por km", PADRAO_MANUTENCAO, PADRAO_PNEU, "manutenção");
  custoPorKm("variaveis.pneusAsfaltoKm", "Pneus reais por km", PADRAO_PNEU, undefined, "pneus");
  custoPorKm("variaveis.oleoLavagemKm", "Óleo, filtros e lavagem reais por km", PADRAO_OLEO, EXCLUI_OLEO, "óleo, filtros ou lavagem");

  // ---- 4. Seguro e IPVA por veículo ----
  const cobertos = mesesCobertos(dados);
  const ativos = dados.veiculos.filter(veiculoAtivo);
  const porVeiculo = (caminho: string, rotulo: string, padrao: RegExp, exclui: RegExp | undefined, nomeDoPadrao: string, anual: boolean) => {
    const sel = selecionar(dados, LINHAS_DO_VEICULO, padrao, exclui);
    if (sel.usadas.length === 0) {
      lacunas.push(`${rotulo}: nenhuma categoria de ${nomeDoPadrao} entre as despesas com veículos no DRE.`);
      return;
    }
    if (ativos.length === 0) {
      if (!semGestao) lacunas.push(`${rotulo}: nenhum veículo ativo no cadastro da gestão para dividir.`);
      return;
    }
    if (cobertos.length === 0) return;
    const total = somaDasCategorias(sel.usadas);
    const porMes = total / 100 / cobertos.length;
    const valor = (anual ? porMes * 12 : porMes) / ativos.length;
    const cls = avisosDeClassificacao(sel, nomeDoPadrao);
    let confianca = confiancaPorMeses(cobertos.length);
    if (cls.rebaixa) confianca = rebaixar(confianca);
    const avisos = [...cls.avisos, ...avisoDeEscopo, "Divide pela frota ATIVA de hoje: veículo vendido ou comprado no meio do ano desloca a média."];
    if (anual && cobertos.length < 12) {
      confianca = "BAIXA";
      avisos.push(`A base cobre só ${cobertos.length} mês(es): IPVA e licenciamento se concentram no começo do ano, e anualizar menos de doze meses erra para qualquer lado.`);
    }
    if (total <= 0) return;
    indicadores.push({
      caminho,
      rotulo,
      valor,
      unidade: anual ? "R$/ano por veículo" : "R$/mês por veículo",
      base: anual
        ? `Σ ${deCents(total)} em ${listaDeNomes(sel.usadas.map((c) => c.descricao))} em ${cobertos.length} mês(es) com movimento, anualizado (× 12 ÷ ${cobertos.length}) ÷ ${fmtNumero(ativos.length)} veículos ativos.`
        : `Σ ${deCents(total)} em ${listaDeNomes(sel.usadas.map((c) => c.descricao))} ÷ ${cobertos.length} mês(es) com movimento ÷ ${fmtNumero(ativos.length)} veículos ativos.`,
      periodo: periodoDre,
      amostra: cobertos.length,
      confianca,
      avisos,
    });
  };
  porVeiculo("veiculo.seguroMes", "Seguro real por veículo", PADRAO_SEGURO, EXCLUI_SEGURO, "seguro de veículo", false);
  porVeiculo("veiculo.ipvaLicenciamentoAno", "IPVA e licenciamento reais por veículo", PADRAO_IPVA, undefined, "IPVA/licenciamento", true);

  // ---- 5. Mão de obra: custo por pessoa e peso dos encargos ----
  const doPessoal: Selecao = (() => {
    const folha = dados.categorias.filter((c) => c.linha === "DESPESA_SALARIOS" && c.porMesCents.some((v) => v !== 0));
    const noCusto = selecionar(dados, ["CUSTO_SERVICO"], PADRAO_PESSOAL).usadas;
    return { usadas: [...folha, ...noCusto], foraDasLinhas: [] };
  })();
  const pessoasAtivas = dados.pessoas.filter((p) => p.ativo);
  const motoristasAtivos = pessoasAtivas.filter((p) => PADRAO_MOTORISTA.test(normalizar(p.funcao)));
  if (doPessoal.usadas.length === 0) {
    lacunas.push("Nenhuma categoria de pessoal no DRE (Despesas com pessoas, ou folha lançada no custo do serviço): custo real por pessoa e encargos não foram medidos.");
  } else {
    const mesesFolha = mesesComValor(doPessoal.usadas, dados.meses.length);
    const total = somaDasCategorias(doPessoal.usadas);
    const cls = avisosDeClassificacao(doPessoal, "pessoal");

    if (pessoasAtivas.length === 0) {
      if (!semGestao) lacunas.push("Custo real por pessoa: nenhuma pessoa ativa no cadastro da gestão para dividir.");
    } else if (mesesFolha.length > 0 && total > 0) {
      const porMes = total / 100 / mesesFolha.length;
      let confianca = confiancaPorMeses(mesesFolha.length);
      if (cls.rebaixa) confianca = rebaixar(confianca);
      const avisos = [
        ...cls.avisos,
        ...avisoDeEscopo,
        "A folha paga todo mundo — motoristas, monitoras, escritório —, então o número é o custo médio por PESSOA ativa, com salário, encargos e benefícios juntos. Serve de régua para salário + encargos + benefícios do motorista, não para um campo só.",
        "O quadro ativo é o de hoje; a folha é a média dos meses.",
      ];
      indicadores.push({
        caminho: "referencia:custoPorPessoaMes",
        rotulo: "Custo real por pessoa da folha",
        valor: porMes / pessoasAtivas.length,
        unidade: "R$/mês por pessoa",
        base: `Σ ${deCents(total)} de pessoal (${listaDeNomes(doPessoal.usadas.map((c) => c.descricao))}) ÷ ${mesesFolha.length} mês(es) ÷ ${fmtNumero(pessoasAtivas.length)} pessoas ativas no cadastro (${fmtNumero(motoristasAtivos.length)} com função de motorista).`,
        periodo: periodoDosMeses(mesesFolha.map((i) => dados.meses[i])),
        amostra: mesesFolha.length,
        confianca,
        avisos,
      });
    }

    // Encargos ÷ salários, quando as categorias separam os dois. Categoria
    // que mistura ("Folha e encargos") casa com os dois padrões e é contada
    // como encargo — então a ausência de uma categoria só de salário basta
    // para não haver indicador.
    const encargos = doPessoal.usadas.filter((c) => PADRAO_ENCARGO.test(normalizar(c.descricao)));
    const salarios = doPessoal.usadas.filter((c) => !encargos.includes(c) && PADRAO_SALARIO.test(normalizar(c.descricao)));
    const totalEncargos = somaDasCategorias(encargos);
    const totalSalarios = somaDasCategorias(salarios);
    if (encargos.length === 0 || salarios.length === 0 || totalSalarios <= 0 || totalEncargos <= 0) {
      lacunas.push(
        `Encargos reais: as categorias de pessoal não separam salário de encargos (${salarios.length === 0 ? "sem categoria só de salário" : "sem categoria de INSS, FGTS, férias, 13º ou rescisões"}).`
      );
    } else {
      const mesesEnc = mesesComValor([...encargos, ...salarios], dados.meses.length);
      let confianca = confiancaPorMeses(mesesEnc.length);
      if (cls.rebaixa) confianca = rebaixar(confianca);
      const avisos = [
        ...cls.avisos,
        "Medido no caixa do ano: férias, 13º e rescisões entram quando foram pagos, e em menos de doze meses o 13º pode faltar ou sobrar.",
        "Benefícios (VR/VA, VT, plano) e horas extras ficam fora: são premissas à parte no simulador.",
      ];
      if (mesesEnc.length < 12) confianca = rebaixar(confianca);
      indicadores.push({
        caminho: "pessoal.encargosPct",
        rotulo: "Encargos e provisões reais",
        valor: totalEncargos / totalSalarios,
        unidade: "% do salário",
        base: `Σ ${deCents(totalEncargos)} de encargos (${listaDeNomes(encargos.map((c) => c.descricao))}) ÷ Σ ${deCents(totalSalarios)} de salários (${listaDeNomes(salarios.map((c) => c.descricao))}).`,
        periodo: periodoDosMeses(mesesEnc.map((i) => dados.meses[i])),
        amostra: mesesEnc.length,
        confianca,
        avisos,
      });
    }
  }

  // ---- 6. Administração e carga tributária, sobre a receita ----
  const linha = (chave: string) => dados.linhasDre[chave] ?? new Array<number>(dados.meses.length).fill(0);
  const mesesComReceita = dados.meses.map((_, i) => i).filter((i) => (linha("RECEITA_BRUTA")[i] ?? 0) > 0);
  const totalLinha = (chave: string) => soma(mesesComReceita.map((i) => linha(chave)[i] ?? 0));
  const movimentoTotal = soma(dados.categorias.map((c) => soma(c.porMesCents.map(Math.abs))));
  const parteNaoConfirmada = movimentoTotal > 0 ? dados.naoConfirmadoCents / movimentoTotal : 0;
  const avisosDoDre: string[] = [];
  if (parteNaoConfirmada > 0) avisosDoDre.push(`${pct(parteNaoConfirmada, 0)} do movimento do DRE está em categorias com a linha apenas proposta, não confirmada.`);
  if (dados.semCategoriaCents !== 0) avisosDoDre.push(`${deCents(Math.abs(dados.semCategoriaCents))} em títulos sem categoria ficaram fora do DRE.`);
  const periodoReceita = periodoDosMeses(mesesComReceita.map((i) => dados.meses[i]));

  if (mesesComReceita.length === 0) {
    lacunas.push("Sem receita bruta no DRE dos últimos doze meses fechados: administração e carga tributária não foram medidas.");
  } else {
    const receitaBruta = totalLinha("RECEITA_BRUTA");
    const receitaLiquida = totalLinha("RECEITA_LIQUIDA");
    const deducoes = totalLinha("DEDUCOES");
    let confiancaDre = confiancaPorMeses(mesesComReceita.length);
    if (parteNaoConfirmada > LIMITE_NAO_CONFIRMADO) confiancaDre = rebaixar(confiancaDre);

    // A ADMINISTRAÇÃO vai como % do CUSTO DIRETO, que é onde o motor a aplica
    // (indiretos = custo direto × administração). Oferecer a razão sobre a
    // receita e deixar o motor aplicá-la sobre o custo subestimava o indireto:
    // 7% da receita é ~10% do custo direto numa operação com margem normal.
    const adm = soma(LINHAS_DE_ADMINISTRACAO.map(totalLinha));
    const custoDireto = soma(LINHAS_DE_CUSTO_DIRETO.map(totalLinha));
    if (receitaLiquida > 0 && custoDireto > 0) {
      const partes = LINHAS_DE_ADMINISTRACAO.map((c) => `${LINHAS_DRE.find((l) => l.chave === c)?.rotulo.replace("(-) ", "") ?? c} ${deCents(totalLinha(c))}`).join(" + ");
      const avisos = [
        ...avisosDoDre,
        `Sobre a receita líquida (${deCents(receitaLiquida)}) a administração é ${pct(adm / receitaLiquida)}; o simulador a aplica sobre o CUSTO DIRETO, por isso o número oferecido é a razão sobre o custo direto do DRE.`,
        "A folha da empresa corporativa (Despesas com pessoas — corporativo) entra na administração; a da operação fica no custo direto. Despesas com sócios ficam fora.",
      ];
      indicadores.push({
        caminho: "indiretos.administracaoPct",
        rotulo: "Administração central real",
        valor: adm / custoDireto,
        unidade: "% do custo direto",
        base: `(${partes}) = ${deCents(adm)} ÷ custo direto de ${deCents(custoDireto)} (custo do serviço + veículos + pessoas).`,
        periodo: periodoReceita,
        amostra: mesesComReceita.length,
        confianca: confiancaDre,
        avisos,
      });
    } else if (receitaLiquida > 0) {
      lacunas.push("Administração central: o DRE não tem custo direto (custo do serviço, veículos, pessoas) para a razão que o simulador usa.");
    }

    if (receitaBruta > 0 && deducoes > 0) {
      indicadores.push({
        caminho: "referencia:cargaTributariaPct",
        rotulo: "Carga tributária efetiva sobre o faturamento",
        valor: deducoes / receitaBruta,
        unidade: "% da receita bruta",
        base: `Deduções da receita (PIS, COFINS, ISS, ICMS e IRPJ/CSLL do Presumido) ${deCents(deducoes)} ÷ receita bruta ${deCents(receitaBruta)}.`,
        periodo: periodoReceita,
        amostra: mesesComReceita.length,
        confianca: confiancaDre,
        avisos: [
          ...avisosDoDre,
          "Referência para conferir a soma de PIS + COFINS + IRPJ + CSLL + ISS/ICMS das premissas: é a média da empresa inteira, com o mix de clientes municipais e intermunicipais do período.",
        ],
      });
    } else if (receitaBruta > 0) {
      lacunas.push("Carga tributária: nenhuma dedução da receita no DRE (tributos sobre o faturamento sem categoria classificada em Deduções?).");
    }
  }

  // ---- 7. Km por veículo por mês (utilização da frota) ----
  if (km) {
    const mesesComKm = km.kmPorMes.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
    const veiculoMeses = soma(mesesComKm.map((i) => km.veiculosPorMes[i]));
    if (veiculoMeses > 0) {
      let confianca = confiancaPorMeses(mesesComKm.length);
      if (km.rebaixa) confianca = rebaixar(confianca);
      indicadores.push({
        caminho: "referencia:kmPorVeiculoMes",
        rotulo: "Km real por veículo por mês",
        valor: km.total / veiculoMeses,
        unidade: "km/mês por veículo",
        base: `Σ ${fmtNumero(km.total)} km (${km.descricaoFonte}) ÷ ${fmtNumero(veiculoMeses)} veículos-mês com km registrado, em ${mesesComKm.length} mês(es). Frota ativa hoje: ${fmtNumero(ativos.length)} veículo(s).`,
        periodo: periodoDosMeses(mesesComKm.map((i) => dados.meses[i])),
        amostra: mesesComKm.length,
        confianca,
        avisos: [
          ...km.avisos,
          "Referência para discutir utilização e km improdutivo: é o km que cada veículo em operação de fato rodou, não o km pago pelos contratos.",
        ],
      });
    }
  }

  return { indicadores, lacunas };
}

// ---------------------------------------------------------------------------
// Aplicar os indicadores escolhidos às premissas
// ---------------------------------------------------------------------------

export { aplicarIndicadores } from "./aplicarReais";

// ---------------------------------------------------------------------------
// A colheita
// ---------------------------------------------------------------------------

type LinhaCategoriaMes = { categoria: string; mes: string; cents: bigint; corp: bigint };

// O DRE dos doze meses fechados, mês a mês — a parte dos custos reais que não
// depende da gestão (a tela Custos base usa só esta).
export type DreDosMeses = Pick<DadosReais, "meses" | "linhasDre" | "categorias" | "naoConfirmadoCents" | "semCategoriaCents">;


// O DRE DOS DOZE MESES FECHADOS, mês a mês. Na visão do grupo (sem conexão),
// sem as operações entre as empresas e com a folha da empresa corporativa na
// linha própria — os mesmos números da tela de Custos e DRE.
export async function carregarDreDosMeses(companyId: string, conexaoId: string | null, dataReferencia: Date): Promise<DreDosMeses> {
  const fechado = ultimoMesFechado(dataReferencia);
  const inicio = new Date(fechado.inicio.getFullYear(), fechado.inicio.getMonth() - 11, 1, 0, 0, 0, 0);
  const fim = fechado.fim;
  const meses = Array.from({ length: 12 }, (_, i) => chaveDoMes(new Date(inicio.getFullYear(), inicio.getMonth() + i, 1)));
  const escopo: EscopoSql = { companyId, conexaoId, janela: { desde: inicio, ate: null } };

  const [somas, movimento, categoriasDaOmie, guardadas, config] = await Promise.all([
    prisma.$queryRaw<LinhaCategoriaMes[]>`
      SELECT ${categoriaSql()} AS categoria,
             to_char(${competenciaSql("t")}, 'YYYY-MM') AS mes,
             COALESCE(SUM(t."valorDocumentoCents"), 0)::bigint AS cents,
             COALESCE(SUM(t."valorDocumentoCents") FILTER (WHERE ${ehCorporativoSql(companyId)}), 0)::bigint AS corp
        FROM ${tabela("OmieTitulo")} t
       WHERE t."companyId" = ${companyId}
         AND t.cancelado = false
         AND ${semProvisaoFuturaSql("t")}
         AND ${competenciaSql("t")} >= ${inicio}
         AND ${competenciaSql("t")} <= ${fim}
         ${filtroConexaoTitulo(conexaoId, companyId)}
         ${naJanela(escopo.janela)}
       GROUP BY 1, 2
    `,
    movimentoPorCategoria(escopo),
    categoriasDoEscopo(escopo),
    prisma.dreClassificacao.findMany({
      where: { companyId },
      select: { categoriaCodigo: true, linha: true, subgrupo: true, origem: true },
    }),
    prisma.controladoriaConfig.findUnique({ where: { companyId }, select: { retencoesNasDeducoes: true } }),
  ]);

  const classificacoes = new Map(
    guardadas.map((c) => [c.categoriaCodigo, { linha: c.linha, subgrupo: c.subgrupo, confirmada: c.origem === "CONFIRMADA" }])
  );
  const somarRetencoes = config?.retencoesNasDeducoes ?? false;
  // Retenções por mês só quando entram nas deduções — como na visão anual do
  // DRE, doze agregações de uma linha.
  const retencoesPorMes: Retencoes[] = somarRetencoes
    ? await Promise.all(
        meses.map((_, i) =>
          retencoes(
            escopo,
            {
              inicio: new Date(inicio.getFullYear(), inicio.getMonth() + i, 1, 0, 0, 0, 0),
              fim: new Date(inicio.getFullYear(), inicio.getMonth() + i + 1, 0, 23, 59, 59, 999),
              rotulo: meses[i],
            },
            "competencia"
          )
        )
      )
    : meses.map(() => RETENCOES_ZERADAS);

  const porMes = new Map<string, Map<string, number>>();
  // A parcela de cada categoria que vem da empresa CORPORATIVA: separa as duas
  // linhas de pessoas, como na tela de Custos e DRE.
  const corpPorMes = new Map<string, Map<string, number>>();
  for (const l of somas) {
    const mapa = porMes.get(l.mes) ?? new Map<string, number>();
    mapa.set(l.categoria, (mapa.get(l.categoria) ?? 0) + Number(l.cents));
    porMes.set(l.mes, mapa);
    if (Number(l.corp) !== 0) {
      const corp = corpPorMes.get(l.mes) ?? new Map<string, number>();
      corp.set(l.categoria, (corp.get(l.categoria) ?? 0) + Number(l.corp));
      corpPorMes.set(l.mes, corp);
    }
  }

  const linhasDre: Record<string, number[]> = Object.fromEntries(LINHAS_DRE.map((l) => [l.chave, new Array<number>(12).fill(0)]));
  const sinalDaLinha = new Map(LINHAS_DRE.map((l) => [l.chave as string, l.sinal as number]));
  const categorias = new Map<string, CategoriaReal>();
  let naoConfirmadoCents = 0;
  let semCategoriaCents = 0;
  const vazio = new Map<string, number>();

  meses.forEach((mes, i) => {
    const r = montarDreDeInsumos(
      {
        atual: porMes.get(mes) ?? vazio,
        anterior: vazio,
        anoAnterior: null,
        movimento,
        titulos: new Map(),
        retencoes: retencoesPorMes[i],
        retencoesAnteriores: RETENCOES_ZERADAS,
        retencoesAnoAnterior: null,
        categorias: categoriasDaOmie,
        corporativo: { atual: corpPorMes.get(mes) ?? vazio, anterior: vazio, anoAnterior: null },
      },
      classificacoes,
      { somarRetencoes, regime: "competencia" }
    );
    naoConfirmadoCents += r.naoConfirmadoCents;
    semCategoriaCents += r.semCategoriaCents;
    for (const linha of r.linhas) {
      linhasDre[linha.chave][i] = linha.valorCents;
      if (linha.tipo !== "GRUPO") continue;
      const linhaEhReceita = (sinalDaLinha.get(linha.chave) ?? -1) > 0;
      for (const item of linha.itens) {
        // A retenção na fonte é um agregado calculado, não uma categoria:
        // está no total da linha e não na lista.
        if (item.categoriaCodigo === "RETENCAO_NA_FONTE") continue;
        // A mesma categoria de pessoal aparece nas duas linhas de pessoas
        // (operação e corporativo): uma entrada por linha, para a parte
        // corporativa não somar na folha da operação.
        const chave = linha.chave === "DESPESA_SALARIOS_CORPORATIVO" ? `${item.categoriaCodigo}@corporativo` : item.categoriaCodigo;
        const c =
          categorias.get(chave) ??
          ({
            codigo: item.categoriaCodigo,
            descricao: item.descricao,
            linha: linha.chave,
            confirmada: item.confirmada,
            porMesCents: new Array<number>(12).fill(0),
          } satisfies CategoriaReal);
        c.porMesCents[i] += item.ehReceita === linhaEhReceita ? Math.abs(item.valorCents) : -Math.abs(item.valorCents);
        categorias.set(chave, c);
      }
    }
  });

  return { meses, linhasDre, categorias: [...categorias.values()], naoConfirmadoCents, semCategoriaCents };
}

// Reúne o material da análise. O DRE é SOMADO NO BANCO — uma consulta
// agrupada por (categoria, mês) sobre os doze meses, e não os títulos: são
// quarenta categorias × doze meses atravessando a rede, e não dezenas de
// milhares de linhas (ver a medida em dreNoBanco.ts). A classificação e os
// subtotais saem de `montarDreDeInsumos`, a MESMA função da tela de Custos e
// DRE — o número daqui é o número de lá.
//
// A gestão é lida pelas funções de leitura.ts, que devolvem lista vazia
// quando o banco dela não responde; aqui isso vira aviso e
// `gestaoDisponivel = false`, e a análise segue só com o DRE.
export async function carregarDadosReais(companyId: string, conexaoId: string | null, dataReferencia: Date): Promise<DadosReais> {
  const fechado = ultimoMesFechado(dataReferencia);
  const inicio = new Date(fechado.inicio.getFullYear(), fechado.inicio.getMonth() - 11, 1, 0, 0, 0, 0);
  const dre = await carregarDreDosMeses(companyId, conexaoId, dataReferencia);

  // ---- Gestão ----
  const avisos: string[] = [];
  let gestaoDisponivel = true;
  const fimExclusivo = new Date(fechado.fim.getTime() + 1);
  const fimDaReferencia = new Date(dataReferencia.getTime());
  fimDaReferencia.setHours(0, 0, 0, 0);
  const ateReferencia = new Date(fimDaReferencia.getTime() + MS_DIA);
  const desdeGestao = new Date(Math.min(inicio.getTime(), ateReferencia.getTime() - JANELA_PRECO_DIAS * MS_DIA));

  // Em SEQUÊNCIA, e não em paralelo: `disponibilidadeGestao()` guarda o
  // resultado da ÚLTIMA leitura, e três leituras em paralelo deixariam uma
  // falha ser apagada pelo sucesso da seguinte.
  async function daGestao<T>(rotulo: string, ler: () => Promise<T[]>): Promise<T[]> {
    try {
      const linhas = await ler();
      const d = disponibilidadeGestao();
      if (!d.disponivel) {
        gestaoDisponivel = false;
        // A mensagem do banco fica no log do servidor, não na tela: ela traz
        // nome de banco, de tabela e trecho de consulta.
        if (d.erro) console.warn(`[simulador] custos reais: ${d.erro}`);
        avisos.push(`Não foi possível ler ${rotulo} do sistema de gestão agora (fora do ar ou sem acesso).`);
        return [];
      }
      return linhas;
    } catch (e) {
      gestaoDisponivel = false;
      console.warn(`[simulador] custos reais: falha ao ler ${rotulo}`, e instanceof Error ? e.message.slice(0, 200) : e);
      avisos.push(`Não foi possível ler ${rotulo} do sistema de gestão agora (fora do ar ou sem acesso).`);
      return [];
    }
  }

  const veiculosGestao = await daGestao("os veículos", () => lerVeiculos(companyId));
  const motoristasGestao = gestaoDisponivel ? await daGestao("as pessoas", () => lerMotoristas(companyId)) : [];
  const abastecimentosGestao = gestaoDisponivel ? await daGestao("os abastecimentos", () => lerAbastecimentos(companyId, desdeGestao)) : [];
  let usosGestao: Awaited<ReturnType<typeof lerUsosDeVeiculo>> = [];
  if (gestaoDisponivel) {
    try {
      usosGestao = await lerUsosDeVeiculo(companyId, inicio);
      if (leiturasOpcionaisPendentes().some((r) => r.includes("VehicleUsageLog"))) {
        avisos.push("Uso de veículo (check-in/check-out) sem permissão de leitura na gestão: o km da frota vem só do cartão.");
      }
    } catch {
      avisos.push("Uso de veículo (check-in/check-out) indisponível: o km da frota vem só do cartão.");
    }
  }

  return {
    dataReferencia,
    ...dre,
    abastecimentos: abastecimentosGestao
      .filter((a) => a.dataHora < ateReferencia)
      .map((a) => ({
        vehicleId: a.vehicleId,
        dataHora: a.dataHora,
        valorCents: Number(a.valorCents),
        volumeLitros: Number(a.volumeLitros),
        kmRodados: a.kmRodados === null ? null : Number(a.kmRodados),
        combustivel: a.combustivel,
      })),
    veiculos: veiculosGestao.map((v) => ({ id: v.id, placa: v.plate, modelo: v.model, tipo: v.type, status: v.status })),
    pessoas: motoristasGestao.map((m) => ({ id: m.id, ativo: m.active, funcao: m.funcao })),
    usos: usosGestao
      .filter((u) => u.checkInAt < fimExclusivo)
      .map((u) => ({
        vehicleId: u.vehicleId,
        checkInAt: u.checkInAt,
        kmInicial: Number(u.kmInicial),
        kmFinal: u.kmFinal === null ? null : Number(u.kmFinal),
      })),
    gestaoDisponivel,
    conexaoFiltrada: conexaoId !== null,
    avisos,
  };
}
