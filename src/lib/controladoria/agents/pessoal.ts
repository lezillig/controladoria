import type { AuditSeveridade, OmieTitulo } from "@prisma/client";
import type { AfastamentoGestao, MotoristaGestao } from "@/lib/gestao/leitura";
import { fmtBRL, fmtData, fmtDocumento, fmtPercent } from "../format";
import { diasEntre, fimDoMes, inicioDoDia, inicioDoMes, somarDias } from "../periodos";
import type { AchadoNovo, Agente, ContextoAuditoria } from "../types";
import {
  agravar,
  agrupar,
  chaveAchado,
  chaveMes,
  materialidadeCents,
  mediana,
  refTitulo,
  severidadePorValor,
  somar,
  titulosAtivos,
} from "./comum";

// AGENTE DE PESSOAL
//
// Numa transportadora de passageiros, gente da folha RECEBE pelo contas a
// pagar: diária de viagem, adiantamento, reembolso de pedágio, acerto de
// rota. O antifraude (agents/antifraude.ts, FR-FORNECEDOR-FUNCIONARIO) já
// reconhece isso como rotina e olha a CATEGORIA em que o dinheiro foi
// lançado. Este agente faz a pergunta seguinte, que só a operação responde:
// a pessoa que recebeu ESTAVA TRABALHANDO? O sistema de gestão guarda o
// rastro — ponto batido, veículo retirado, escala do dia, cartão de frota
// passado, afastamento registrado — e é o cruzamento do título pago a CPF
// com esse rastro que separa o processo normal do pagamento a quem já saiu,
// a quem nunca aparece, ou a quem está de atestado.
//
// Mesma regra de ouro dos outros agentes: nada aqui acusa. Cada achado diz
// o que conferir e com quem (o RH, a operação, o financeiro), e cada regra
// fica CALADA quando o dado que a sustenta não veio — ponto e afastamento
// são leituras opcionais da gestão (src/lib/gestao/leitura.ts), e ausência
// de dado nunca vira ausência de trabalho. Evidência sem CPF em claro:
// `fmtDocumento` mascara.

// O TiqueTaque importa o ponto com atraso de dias. Um título de ontem para
// alguém "sem ponto" só diz que o ponto de ontem ainda não chegou — então o
// título precisa de idade antes de contar: uma semana para o fantasma, e
// para o desligado a mesma folga do próprio critério de desligamento.
const ATRASO_DO_PONTO_DIAS = 7;
// Desligado: título emitido mais de 45 dias depois do último rastro. É o
// prazo em que rescisão, férias vencidas e acerto final já saíram — o que
// vem depois disso, fora dessas categorias, não é do desligamento.
const DIAS_APOS_O_ULTIMO_RASTRO = 45;
// Fantasma: dois meses sem nenhum rastro é mais que qualquer folga, e menos
// que o afastamento longo que o INSS assume (a partir daí a empresa não
// paga mais, e afastamento de 30+ dias no período já explica o silêncio).
const JANELA_DO_FANTASMA_DIAS = 60;
const DIAS_DE_AFASTAMENTO_QUE_EXPLICAM = 30;
// Recém-admitido sem rastro é o cadastro do TiqueTaque que ainda não foi
// vinculado — acontece em toda admissão. Um mês de casa antes de cobrar.
const DIAS_DE_CASA_PARA_TER_RASTRO = 30;
// A regra do fantasma só vale numa base que REGISTRA a operação: se metade
// dos motoristas ativos não tem ponto, escala nem uso no período, o dado é
// que não está mantido, e apontar os sem rastro seria apontar a empresa.
const COBERTURA_MINIMA_DE_RASTRO = 0.5;
// Diária: a mediana e o MAD (desvio absoluto mediano) do departamento
// precisam de gente suficiente para significar algo; 5 é o mínimo em que a
// mediana não é a própria pessoa comparada.
const MINIMO_DE_PESSOAS_NO_DEPARTAMENTO = 5;
const FATOR_DO_MAD = 5;
// Reembolso repetido: mesmo valor, mesma categoria, mesma pessoa em uma
// semana. Acima de 4 títulos iguais com esse ritmo é diária fixa (paga por
// dia ou por semana), não duplicidade.
const JANELA_DE_REEMBOLSO_DUPLICADO_DIAS = 7;
const TITULOS_IGUAIS_QUE_SAO_ROTINA = 4;
// "Número de documento" que a mesma pessoa repete quatro vezes não é cupom:
// é rótulo ("DIARIA", "08/2026"), e cupom igual entre rótulos não diz nada.
const NUMERO_REPETIDO_QUE_E_ROTULO = 4;
// Adiantamento: dois meses para o acerto aparecer (desconto na folha do mês
// seguinte, devolução, título a receber). A partir daí está em aberto.
const DIAS_PARA_ACERTAR_ADIANTAMENTO = 60;
// Se com dez ou mais adiantamentos vencidos NENHUM tem acerto na Omie, o
// acerto acontece fora dela (direto na folha) e a regra apontaria a folha
// inteira — cala, e o comentário na regra diz o que fazer nesse caso.
const MINIMO_PARA_MEDIR_ACERTO = 10;

const CATEGORIA_DE_DESLIGAMENTO = /rescis|acordo|judicial|indeniza|fgts|homolog|aviso pr[eé]vio|f[eé]rias vencidas/i;
const FUNCAO_DE_OPERACAO = /motorista|cobrador|ajudante|monitor|auxiliar/i;
const CATEGORIA_DE_DIARIA = /di[aá]ria|ajuda de custo|reembolso|ped[aá]gio|despesa de viagem|alimenta/i;
const CATEGORIA_DE_ADIANTAMENTO = /adiantamento|vale\b/i;
// "Vale" também é benefício (vale-alimentação, vale-transporte) — pago à
// operadora, quase nunca a CPF, mas quando é, não é adiantamento a acertar.
const CATEGORIA_DE_BENEFICIO = /vale[ -]?(alimenta|refei|transporte|combust|cultura)/i;
const CATEGORIA_DE_ACERTO = /acerto|desconto em folha|devolu/i;
// Afastamento que tira a pessoa da operação. Folga e abono ficam de fora:
// trocar a folga de dia é rotina de escala, não inconsistência.
const AFASTAMENTO_FORA_DA_OPERACAO = /atestado|f[eé]rias|afast|licen[cç]a|inss|acidente/i;

export const agentePessoal: Agente = {
  id: "pessoal",
  nome: "Pessoal e folha",
  area: "RH",
  descricao:
    "Cruza o que se paga a CPF de gente da folha com o rastro operacional da gestão (ponto, escala, uso de veículo, cartão de frota, afastamento): pagamento a quem já saiu, pagamento a quem nunca aparece na operação, diária fora do padrão do departamento ou sem dia trabalhado, reembolso repetido, adiantamento sem acerto e ponto batido em dia de atestado ou férias.",
  executar: auditarPessoal,
};

// Exportada para o teste (scripts/teste-pessoal.ts), como nos outros agentes
// síncronos: decide olhando só o contexto.
export function auditarPessoal(ctx: ContextoAuditoria): AchadoNovo[] {
  const pagamentos = pagamentosAPessoasDaFolha(ctx);
  const rastro = montarRastro(ctx);
  if (pagamentos.length === 0 && (ctx.afastamentos ?? []).length === 0) return [];
  const materialidade = materialidadeCents(ctx);

  return [
    ...pagoADesligado(ctx, pagamentos, rastro, materialidade),
    ...fantasma(ctx, pagamentos, rastro),
    ...diariaForaDoPadrao(ctx, pagamentos, rastro, materialidade),
    ...reembolsoDuplicado(ctx, pagamentos, materialidade),
    ...adiantamentoAberto(ctx, pagamentos, materialidade),
    ...afastadoComOperacao(ctx, rastro),
  ];
}

// ---------------------------------------------------------------------------
// Base comum: os títulos a pagar cujo documento é o CPF de alguém da folha,
// e o rastro operacional de cada pessoa, dia a dia.
// ---------------------------------------------------------------------------

type Pagamento = {
  t: OmieTitulo;
  pessoa: MotoristaGestao;
  // Nome da categoria e o caminho dela na árvore ("Despesas com Pessoal >
  // Diárias"): as regras olham o caminho, para reconhecer o grupo inteiro
  // sem listar cada filha — o mesmo motivo de FR-FORNECEDOR-FUNCIONARIO.
  categoria: string;
  caminho: string;
  // Emissão, ou vencimento quando a Omie não trouxe emissão.
  data: Date;
};

function pagamentosAPessoasDaFolha(ctx: ContextoAuditoria): Pagamento[] {
  const porCpf = new Map(ctx.motoristas.filter((m) => m.cpf).map((m) => [m.cpf.replace(/\D/g, ""), m]));
  if (porCpf.size === 0) return [];
  // O título nem sempre traz o documento; o cadastro do parceiro traz.
  const documentoDoParceiro = new Map(ctx.parceiros.map((p) => [`${p.conexaoId}|${p.codigoOmie}`, p.documento]));
  const caminho = caminhoDaCategoria(ctx);

  const lista: Pagamento[] = [];
  for (const t of titulosAtivos(ctx, "PAGAR")) {
    const documento = (t.parceiroDocumento ?? documentoDoParceiro.get(`${t.conexaoId}|${t.parceiroCodigo}`) ?? "").replace(/\D/g, "");
    if (documento.length !== 11) continue;
    const pessoa = porCpf.get(documento);
    if (!pessoa) continue;
    const arvore = caminho(t);
    lista.push({
      t,
      pessoa,
      categoria: t.categoriaDescricao ?? arvore.split(" > ")[0] ?? "sem categoria",
      caminho: arvore || (t.categoriaDescricao ?? ""),
      data: t.dataEmissao ?? t.dataVencimento,
    });
  }
  return lista;
}

function caminhoDaCategoria(ctx: ContextoAuditoria): (t: OmieTitulo) => string {
  const porCodigo = new Map(ctx.categorias.map((c) => [`${c.conexaoId}|${c.codigo}`, c]));
  return (t) => {
    const nomes: string[] = [];
    let atual = t.categoriaCodigo ? porCodigo.get(`${t.conexaoId}|${t.categoriaCodigo}`) : undefined;
    for (let passos = 0; atual && passos < 6; passos++) {
      nomes.push(atual.descricao);
      atual = atual.categoriaSuperior ? porCodigo.get(`${t.conexaoId}|${atual.categoriaSuperior}`) : undefined;
    }
    if (nomes.length === 0 && t.categoriaDescricao) nomes.push(t.categoriaDescricao);
    return nomes.join(" > ");
  };
}

type Fonte = "ponto" | "uso de veículo" | "escala" | "abastecimento";
type DiaComRastro = { dia: string; fontes: Fonte[] };

type Rastro = {
  temPonto: boolean;
  temUso: boolean;
  temEscala: boolean;
  temAbastecimento: boolean;
  // Última data em que a pessoa deixou rastro OPERACIONAL (ponto, uso,
  // escala). O abastecimento fica de fora deste "último": o cartão pode ser
  // passado por outra pessoa em nome de quem já saiu — que é justamente um
  // dos casos a achar, não uma prova de presença.
  ultimoOperacional: Map<string, { data: Date; fonte: Fonte }>;
  diasNoPeriodo: (driverId: string, inicio: Date, fim: Date, fontes?: Fonte[]) => DiaComRastro[];
};

function montarRastro(ctx: ContextoAuditoria): Rastro {
  const pontos = ctx.pontos ?? [];
  const usos = ctx.usosDeVeiculo ?? [];
  const escalas = ctx.escalas ?? [];
  const abastecimentos = ctx.abastecimentos ?? [];

  const porPessoa = new Map<string, Map<string, Set<Fonte>>>();
  const ultimo = new Map<string, { data: Date; fonte: Fonte }>();
  const marcar = (driverId: string | null, data: Date, fonte: Fonte) => {
    if (!driverId) return;
    let dias = porPessoa.get(driverId);
    if (!dias) porPessoa.set(driverId, (dias = new Map()));
    const chave = chaveDia(data);
    let fontes = dias.get(chave);
    if (!fontes) dias.set(chave, (fontes = new Set()));
    fontes.add(fonte);
    if (fonte === "abastecimento") return;
    const atual = ultimo.get(driverId);
    if (!atual || data > atual.data) ultimo.set(driverId, { data, fonte });
  };
  for (const p of pontos) marcar(p.driverId, p.date, "ponto");
  for (const u of usos) {
    marcar(u.driverId, u.checkInAt, "uso de veículo");
    if (u.checkOutAt) marcar(u.driverId, u.checkOutAt, "uso de veículo");
  }
  for (const e of escalas) marcar(e.driverId, e.date, "escala");
  for (const a of abastecimentos) marcar(a.driverId, a.dataHora, "abastecimento");

  return {
    temPonto: pontos.length > 0,
    temUso: usos.length > 0,
    temEscala: escalas.length > 0,
    temAbastecimento: abastecimentos.length > 0,
    ultimoOperacional: ultimo,
    diasNoPeriodo(driverId, inicio, fim, fontes) {
      const dias = porPessoa.get(driverId);
      if (!dias) return [];
      const de = chaveDia(inicio);
      const ate = chaveDia(fim);
      const lista: DiaComRastro[] = [];
      for (const [dia, quais] of dias) {
        if (dia < de || dia > ate) continue;
        const escolhidas = [...quais].filter((f) => !fontes || fontes.includes(f));
        if (escolhidas.length > 0) lista.push({ dia, fontes: escolhidas });
      }
      return lista.sort((a, b) => a.dia.localeCompare(b.dia));
    },
  };
}

// "aaaa-mm-dd" com zero à esquerda, para a comparação de texto respeitar a
// ordem das datas.
function chaveDia(d: Date): string {
  const x = inicioDoDia(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

function ehDeOperacao(m: MotoristaGestao): boolean {
  return !m.funcao || FUNCAO_DE_OPERACAO.test(m.funcao);
}

function nomeDaPessoa(m: MotoristaGestao): string {
  return m.name || "(motorista sem nome)";
}

// Nunca abaixo de BAIXA: o valor de um pagamento a pessoa é sempre pequeno
// perto da materialidade da empresa, e INFO sumiria do relatório.
function pisoBaixa(s: AuditSeveridade): AuditSeveridade {
  return s === "INFO" ? "BAIXA" : s;
}

function linhaDoTitulo(p: Pagamento) {
  return {
    titulo: refTitulo(p.t),
    emissao: fmtData(p.data),
    categoria: p.categoria,
    documento: p.t.numeroDocumento ?? null,
    valorCents: p.t.valorDocumentoCents,
    empresa: p.t.conexaoApelido,
  };
}

// ---------------------------------------------------------------------------
// PE-PAGO-A-DESLIGADO — título a quem o cadastro diz que saiu
// ---------------------------------------------------------------------------
// A gestão não guarda data de desligamento, só `active = false`. O que se
// tem é o último rastro operacional da pessoa: o dia em que bateu ponto,
// retirou veículo ou esteve escalada pela última vez. Rescisão, férias
// vencidas, FGTS e acordo saem depois disso e são do desligamento; diária,
// adiantamento ou reembolso emitidos mais de 45 dias depois do último dia
// trabalhado são pagamento a quem não estava mais lá — ou o cadastro que
// desativou alguém que continua trabalhando, o que é o outro erro a corrigir.
function pagoADesligado(ctx: ContextoAuditoria, pagamentos: Pagamento[], rastro: Rastro, materialidade: number): AchadoNovo[] {
  // Sem nenhuma fonte de rastro carregada, não há "último dia" para ninguém.
  if (!rastro.temPonto && !rastro.temUso && !rastro.temEscala) return [];

  const achados: AchadoNovo[] = [];
  const aDesligados = pagamentos.filter((p) => !p.pessoa.active && !CATEGORIA_DE_DESLIGAMENTO.test(p.caminho));
  for (const [driverId, doMotorista] of agrupar(aDesligados, (p) => p.pessoa.id)) {
    const ultimo = rastro.ultimoOperacional.get(driverId);
    // Sem rastro na janela não se sabe quando a pessoa saiu — pode ter sido
    // antes do que foi carregado. Aqui a regra cala; quem nunca aparece com
    // cadastro ATIVO é assunto de PE-FANTASMA.
    if (!ultimo) continue;
    const limite = somarDias(inicioDoDia(ultimo.data), DIAS_APOS_O_ULTIMO_RASTRO);
    const depois = doMotorista.filter(
      (p) => p.data >= limite && diasEntre(p.data, ctx.dataReferencia) >= DIAS_APOS_O_ULTIMO_RASTRO
    );
    if (depois.length === 0) continue;

    const pessoa = doMotorista[0].pessoa;
    const valor = somar(depois, (p) => p.t.valorDocumentoCents);
    const ordenados = [...depois].sort((a, b) => a.data.getTime() - b.data.getTime());
    achados.push({
      regra: "PE-PAGO-A-DESLIGADO",
      tipo: "ESTADO",
      severidade: agravar(severidadePorValor(valor, materialidade)),
      categoria: "FRAUDE",
      titulo: `${nomeDaPessoa(pessoa)} consta desligado e recebeu ${depois.length} título(s) depois do último dia trabalhado`,
      descricao:
        `O cadastro de motoristas mostra ${nomeDaPessoa(pessoa)} como INATIVO, e o último rastro operacional dele ` +
        `(${ultimo.fonte}) é de ${fmtData(ultimo.data)}. Mais de ${DIAS_APOS_O_ULTIMO_RASTRO} dias depois disso, ` +
        `${depois.length} título(s) a pagar foram emitidos ao CPF dele, somando ${fmtBRL(valor)}, em categorias que não ` +
        `são de desligamento (${[...new Set(depois.map((p) => p.categoria))].join(", ")}). Rescisão, férias vencidas e ` +
        `acordo ficaram de fora de propósito — o que resta é pagamento de rotina a quem não estava mais na operação.`,
      recomendacao:
        "Confirmar com o RH a data real do desligamento. Se a pessoa saiu mesmo, cada título da lista precisa de " +
        "justificativa e de quem o aprovou; se continua trabalhando, o cadastro da gestão está errado e todo relatório " +
        "de custo por motorista está errado junto — corrigir o cadastro fecha este achado sozinho.",
      valorCents: valor,
      dataReferencia: ctx.dataReferencia,
      entidadeTipo: "Motorista",
      entidadeId: driverId,
      entidadeRef: nomeDaPessoa(pessoa),
      evidencia: {
        pessoa: nomeDaPessoa(pessoa),
        documento: fmtDocumento(pessoa.cpf),
        funcao: pessoa.funcao ?? "—",
        ultimoRastro: fmtData(ultimo.data),
        fonteDoUltimoRastro: ultimo.fonte,
        quantidade: depois.length,
        valorCents: valor,
        titulos: ordenados.slice(0, 30).map((p) => ({ ...linhaDoTitulo(p), diasDepoisDoUltimoRastro: diasEntre(ultimo.data, p.data) })),
      },
      chave: chaveAchado("PE-PAGO-A-DESLIGADO", driverId),
    });
  }
  return achados;
}

// ---------------------------------------------------------------------------
// PE-FANTASMA — recebe, consta ativo, e a operação nunca o vê
// ---------------------------------------------------------------------------
// O funcionário fantasma é o esquema mais antigo de folha: um nome que
// recebe e não trabalha. Numa transportadora ele deixaria QUATRO rastros —
// ponto, escala, veículo retirado, cartão de frota — e a ausência dos quatro
// em dois meses, num cadastro de operação, com título pago no período e sem
// afastamento que explique, é o que esta regra aponta. Ela só roda quando a
// base registra a operação de pelo menos metade dos motoristas ativos: numa
// empresa que não mantém ponto nem escala, "sem rastro" é todo mundo.
// Severidade fixa em ALTA, sem olhar o valor: o que pesa é a pessoa não
// existir na operação, não o tamanho do título que recebeu.
function fantasma(ctx: ContextoAuditoria, pagamentos: Pagamento[], rastro: Rastro): AchadoNovo[] {
  // Sem a tabela de afastamentos não dá para separar o fantasma de quem
  // está de atestado longo: cala, em vez de apontar quem está doente.
  const afastamentos = ctx.afastamentos ?? [];
  if (afastamentos.length === 0) return [];
  if (!rastro.temPonto && !rastro.temUso && !rastro.temEscala) return [];

  const fim = inicioDoDia(ctx.dataReferencia);
  const inicio = somarDias(fim, -JANELA_DO_FANTASMA_DIAS);
  const ativosDeOperacao = ctx.motoristas.filter((m) => m.active && ehDeOperacao(m));
  if (ativosDeOperacao.length === 0) return [];
  // Cobertura medida NA JANELA, não na base inteira: a empresa pode ter
  // parado de importar o ponto há três meses, e aí os últimos sessenta dias
  // são silêncio para todo mundo — sem que ninguém tenha sumido.
  const comRastro = ativosDeOperacao.filter(
    (m) => rastro.diasNoPeriodo(m.id, inicio, fim, ["ponto", "uso de veículo", "escala"]).length > 0
  ).length;
  const cobertura = comRastro / ativosDeOperacao.length;
  if (cobertura < COBERTURA_MINIMA_DE_RASTRO) return [];

  const limiteDeEmissao = somarDias(fim, -ATRASO_DO_PONTO_DIAS);
  // Rescisão e acordo pagos a quem consta ativo já são apontados pelo
  // antifraude (FR-FORNECEDOR-FUNCIONARIO): quem recebeu rescisão e sumiu
  // saiu de verdade e o cadastro atrasou — não é fantasma.
  const candidatos = pagamentos.filter(
    (p) =>
      p.pessoa.active &&
      ehDeOperacao(p.pessoa) &&
      !CATEGORIA_DE_DESLIGAMENTO.test(p.caminho) &&
      p.data >= inicio &&
      p.data <= limiteDeEmissao
  );

  const achados: AchadoNovo[] = [];
  for (const [driverId, doMotorista] of agrupar(candidatos, (p) => p.pessoa.id)) {
    const pessoa = doMotorista[0].pessoa;
    if (pessoa.admissao && diasEntre(pessoa.admissao, fim) < DIAS_DE_CASA_PARA_TER_RASTRO) continue;
    // Aqui o abastecimento CONTA como rastro: para dizer que a pessoa não
    // aparece em lugar nenhum, todas as fontes valem.
    if (rastro.diasNoPeriodo(driverId, inicio, fim).length > 0) continue;
    const afastado = diasAfastados(afastamentos, driverId, inicio, fim);
    if (afastado.dias >= DIAS_DE_AFASTAMENTO_QUE_EXPLICAM) continue;

    const valor = somar(doMotorista, (p) => p.t.valorDocumentoCents);
    achados.push({
      regra: "PE-FANTASMA",
      tipo: "ESTADO",
      severidade: "ALTA",
      categoria: "FRAUDE",
      titulo: `${nomeDaPessoa(pessoa)} recebeu ${fmtBRL(valor)} e não aparece na operação há ${JANELA_DO_FANTASMA_DIAS} dias`,
      descricao:
        `${nomeDaPessoa(pessoa)} consta ATIVO no cadastro, com função de operação (${pessoa.funcao ?? "não informada"}), e recebeu ` +
        `${doMotorista.length} título(s) a pagar nos últimos ${JANELA_DO_FANTASMA_DIAS} dias, somando ${fmtBRL(valor)}. No mesmo ` +
        `período não há um único ponto, escala, retirada de veículo nem abastecimento em nome dele` +
        (afastado.dias > 0 ? `, e o afastamento registrado cobre só ${afastado.dias} dia(s)` : ", e nenhum afastamento registrado") +
        `. A base registra a operação de ${fmtPercent(cobertura * 100, 0)} dos motoristas ativos nesse período — o silêncio ` +
        `desta pessoa não é falta de registro da empresa.`,
      recomendacao:
        "Confirmar com a operação onde essa pessoa trabalhou nos últimos dois meses e por que não há registro. Se está " +
        "afastada, registrar o afastamento na gestão (o achado fecha sozinho). Se trabalha em função sem ponto nem " +
        "veículo, ajustar a função no cadastro. Se ninguém a reconhece, apurar com o RH e o financeiro quem cadastrou e " +
        "quem aprova os pagamentos.",
      valorCents: valor,
      dataReferencia: ctx.dataReferencia,
      entidadeTipo: "Motorista",
      entidadeId: driverId,
      entidadeRef: nomeDaPessoa(pessoa),
      evidencia: {
        pessoa: nomeDaPessoa(pessoa),
        documento: fmtDocumento(pessoa.cpf),
        funcao: pessoa.funcao ?? "—",
        empregador: pessoa.empregador ?? "—",
        admissao: pessoa.admissao ? fmtData(pessoa.admissao) : "—",
        periodo: `${fmtData(inicio)} a ${fmtData(fim)}`,
        coberturaDaOperacao: fmtPercent(cobertura * 100, 0),
        diasAfastado: afastado.dias,
        quantidade: doMotorista.length,
        valorCents: valor,
        titulos: doMotorista.slice(0, 30).map(linhaDoTitulo),
      },
      chave: chaveAchado("PE-FANTASMA", driverId),
    });
  }
  return achados;
}

// Dias de afastamento de uma pessoa dentro de [inicio, fim], sem contar
// duas vezes o dia coberto por dois registros.
function diasAfastados(afastamentos: AfastamentoGestao[], driverId: string, inicio: Date, fim: Date): { dias: number; tipos: string[] } {
  const dias = new Set<string>();
  const tipos = new Set<string>();
  for (const a of afastamentos) {
    if (a.driverId !== driverId) continue;
    const de = inicioDoDia(a.startDate) > inicio ? inicioDoDia(a.startDate) : inicio;
    const ate = inicioDoDia(a.endDate) < fim ? inicioDoDia(a.endDate) : fim;
    if (ate < de) continue;
    tipos.add(a.leaveType);
    // Teto de dias por registro: um afastamento gravado com data de fim
    // absurda não pode travar a auditoria num laço de anos.
    for (let d = de, passos = 0; d <= ate && passos < 400; d = somarDias(d, 1), passos++) dias.add(chaveDia(d));
  }
  return { dias: dias.size, tipos: [...tipos] };
}

// ---------------------------------------------------------------------------
// PE-DIARIA-OUTLIER — diária por dia trabalhado fora do padrão do departamento
// ---------------------------------------------------------------------------
// Diária, ajuda de custo e reembolso de viagem são pagos por dia na rua. A
// pergunta certa não é "quanto recebeu", é "quanto recebeu POR DIA
// TRABALHADO" — e a referência é o departamento da pessoa (a rota, o
// contrato), porque a diária de quem viaja é outra da de quem faz linha
// urbana. Mediana e MAD, não média e desvio-padrão: a média seria puxada
// pelo próprio valor que se procura. Um achado por pessoa e mês.
//
// Dias trabalhados: dias com ponto no mês; quando a pessoa não tem ponto,
// dias com retirada de veículo. Só meses fechados há uma semana, pelo atraso
// do ponto — no mês corrente todo mundo teria "dias a menos".
function diariaForaDoPadrao(ctx: ContextoAuditoria, pagamentos: Pagamento[], rastro: Rastro, materialidade: number): AchadoNovo[] {
  if (!rastro.temPonto && !rastro.temUso) return [];
  const diarias = pagamentos.filter((p) => CATEGORIA_DE_DIARIA.test(p.caminho) && p.t.valorDocumentoCents > 0);
  if (diarias.length === 0) return [];

  const fechadoAte = somarDias(inicioDoDia(ctx.dataReferencia), -ATRASO_DO_PONTO_DIAS);
  const achados: AchadoNovo[] = [];

  for (const [mes, doMes] of agrupar(diarias, (p) => chaveMes(p.data))) {
    const inicio = inicioDoMes(doMes[0].data);
    const fim = fimDoMes(inicio);
    if (fim > fechadoAte) continue;

    type Linha = { pessoa: MotoristaGestao; valor: number; dias: number; fonte: string; porDia: number; titulos: Pagamento[] };
    const linhas: Linha[] = [...agrupar(doMes, (p) => p.pessoa.id).values()].map((titulos) => {
      const id = titulos[0].pessoa.id;
      const comPonto = rastro.diasNoPeriodo(id, inicio, fim, ["ponto"]).length;
      const comUso = rastro.diasNoPeriodo(id, inicio, fim, ["uso de veículo"]).length;
      const dias = comPonto > 0 ? comPonto : comUso;
      const valor = somar(titulos, (p) => p.t.valorDocumentoCents);
      return {
        pessoa: titulos[0].pessoa,
        valor,
        dias,
        fonte: comPonto > 0 ? "ponto" : comUso > 0 ? "uso de veículo" : "nenhum",
        porDia: dias > 0 ? valor / dias : 0,
        titulos,
      };
    });
    // O mês precisa estar REGISTRADO: se metade de quem recebeu diária não
    // tem dia trabalhado nenhum, é o ponto daquele mês que não veio.
    const comDias = linhas.filter((l) => l.dias > 0);
    if (comDias.length < linhas.length * COBERTURA_MINIMA_DE_RASTRO) continue;

    // (a) Diária sem nenhum dia trabalhado no mês.
    for (const l of linhas.filter((l) => l.dias === 0)) {
      achados.push({
        regra: "PE-DIARIA-OUTLIER",
        tipo: "ESTADO",
        severidade: "MEDIA",
        categoria: "FRAUDE",
        titulo: `${nomeDaPessoa(l.pessoa)}: ${fmtBRL(l.valor)} de diária em ${mes} sem nenhum dia trabalhado registrado`,
        descricao:
          `${nomeDaPessoa(l.pessoa)} recebeu ${l.titulos.length} título(s) de diária/reembolso em ${mes}, somando ${fmtBRL(l.valor)}, ` +
          `e não tem ponto nem retirada de veículo em dia nenhum desse mês — enquanto ${comDias.length} de ${linhas.length} ` +
          `pessoas com diária no mesmo mês têm. Diária é paga por dia na rua; sem dia na rua, precisa de outra explicação.`,
        recomendacao:
          "Pedir ao RH o motivo de cada título (viagem sem ponto? reembolso de despesa antiga?) e o comprovante. Se a " +
          "pessoa trabalhou e o ponto não foi importado, corrigir o ponto na gestão fecha o achado.",
        valorCents: l.valor,
        dataReferencia: fim,
        entidadeTipo: "Motorista",
        entidadeId: l.pessoa.id,
        entidadeRef: nomeDaPessoa(l.pessoa),
        evidencia: {
          pessoa: nomeDaPessoa(l.pessoa),
          documento: fmtDocumento(l.pessoa.cpf),
          departamento: l.pessoa.departamento ?? "—",
          mes,
          diasTrabalhados: 0,
          valorCents: l.valor,
          titulos: l.titulos.slice(0, 30).map(linhaDoTitulo),
        },
        chave: chaveAchado("PE-DIARIA-OUTLIER", l.pessoa.id, mes),
      });
    }

    // (b) Diária por dia acima de mediana + 5·MAD do departamento.
    for (const [departamento, doDepartamento] of agrupar(comDias, (l) => l.pessoa.departamento ?? "(sem departamento)")) {
      if (doDepartamento.length < MINIMO_DE_PESSOAS_NO_DEPARTAMENTO) continue;
      const porDia = doDepartamento.map((l) => Math.round(l.porDia));
      const tipico = mediana(porDia);
      const mad = mediana(porDia.map((v) => Math.abs(v - tipico)));
      const limite = tipico + FATOR_DO_MAD * mad;
      for (const l of doDepartamento) {
        if (Math.round(l.porDia) <= limite) continue;
        const excesso = Math.round(l.valor - tipico * l.dias);
        if (excesso < materialidade / 4) continue;
        achados.push({
          regra: "PE-DIARIA-OUTLIER",
          tipo: "ESTADO",
          severidade: "MEDIA",
          categoria: "ERRO_PROCESSO",
          titulo: `${nomeDaPessoa(l.pessoa)}: diária de ${fmtBRL(Math.round(l.porDia))} por dia trabalhado em ${mes}, contra ${fmtBRL(tipico)} no departamento`,
          descricao:
            `Em ${mes}, ${nomeDaPessoa(l.pessoa)} recebeu ${fmtBRL(l.valor)} de diária/reembolso por ${l.dias} dia(s) trabalhado(s) ` +
            `(${l.fonte}): ${fmtBRL(Math.round(l.porDia))} por dia. No departamento "${departamento}", ${doDepartamento.length} pessoas ` +
            `receberam diária no mês e a mediana é ${fmtBRL(tipico)} por dia (limite de ${fmtBRL(Math.round(limite))}, mediana + ` +
            `${FATOR_DO_MAD}× o desvio mediano). O excesso sobre a mediana é ${fmtBRL(excesso)}.`,
          recomendacao:
            "Conferir com a operação se a pessoa fez viagens que justificam a diferença (rota mais longa, pernoite) e " +
            "se os comprovantes existem. Se a diária é por política e não por comprovante, a política precisa dizer " +
            "quanto é por dia — e este caso passa dela.",
          valorCents: l.valor,
          impactoCents: excesso,
          dataReferencia: fim,
          entidadeTipo: "Motorista",
          entidadeId: l.pessoa.id,
          entidadeRef: nomeDaPessoa(l.pessoa),
          evidencia: {
            pessoa: nomeDaPessoa(l.pessoa),
            documento: fmtDocumento(l.pessoa.cpf),
            departamento,
            mes,
            diasTrabalhados: l.dias,
            fonteDosDias: l.fonte,
            valorCents: l.valor,
            valorPorDiaCents: Math.round(l.porDia),
            medianaDoDepartamentoCents: tipico,
            limiteCents: Math.round(limite),
            pessoasNoDepartamento: doDepartamento.length,
            excessoCents: excesso,
            titulos: l.titulos.slice(0, 30).map(linhaDoTitulo),
          },
          chave: chaveAchado("PE-DIARIA-OUTLIER", l.pessoa.id, mes),
        });
      }
    }
  }
  return achados;
}

// ---------------------------------------------------------------------------
// PE-REEMBOLSO-DUPLICADO — o mesmo cupom, ou o mesmo valor, pago duas vezes
// ---------------------------------------------------------------------------
// Dois modos: (a) o mesmo número de documento (cupom) em dois títulos de
// reembolso — da mesma pessoa, ou de pessoas diferentes com o mesmo valor
// (o mesmo cupom apresentado por dois colegas); (b) a mesma pessoa, o mesmo
// valor e a mesma categoria em até sete dias, quando isso NÃO é o ritmo
// normal dela (diária fixa paga por dia é rotina, não duplicidade).
// EVENTO: o segundo pagamento aconteceu; só uma pessoa encerra.
function reembolsoDuplicado(ctx: ContextoAuditoria, pagamentos: Pagamento[], materialidade: number): AchadoNovo[] {
  const reembolsos = pagamentos.filter((p) => CATEGORIA_DE_DIARIA.test(p.caminho) && p.t.valorDocumentoCents > 0);
  if (reembolsos.length < 2) return [];
  const achados: AchadoNovo[] = [];
  const paresPorCupom = new Set<string>();
  const parcelasDiferentes = (a: Pagamento, b: Pagamento) =>
    Boolean(a.t.numeroParcela && b.t.numeroParcela && a.t.numeroParcela !== b.t.numeroParcela);

  // (a) Mesmo cupom.
  const comCupom = reembolsos
    .map((p) => ({ p, cupom: normalizarNumero(p.t.numeroDocumento) }))
    .filter((x): x is { p: Pagamento; cupom: string } => x.cupom !== null);
  for (const [cupom, grupo] of agrupar(comCupom, (x) => x.cupom)) {
    if (grupo.length < 2) continue;
    // A mesma pessoa com o mesmo "número" quatro vezes: é rótulo, não cupom.
    if ([...agrupar(grupo, (x) => x.p.pessoa.id).values()].some((g) => g.length >= NUMERO_REPETIDO_QUE_E_ROTULO)) continue;
    const envolvidos = new Set<Pagamento>();
    for (let i = 0; i < grupo.length; i++) {
      for (let j = i + 1; j < grupo.length; j++) {
        const a = grupo[i].p;
        const b = grupo[j].p;
        if (parcelasDiferentes(a, b)) continue;
        if (a.pessoa.id !== b.pessoa.id && a.t.valorDocumentoCents !== b.t.valorDocumentoCents) continue;
        envolvidos.add(a);
        envolvidos.add(b);
        paresPorCupom.add(parChave(a, b));
      }
    }
    if (envolvidos.size < 2) continue;
    const lista = [...envolvidos].sort((a, b) => a.data.getTime() - b.data.getTime());
    const pessoas = [...new Set(lista.map((p) => nomeDaPessoa(p.pessoa)))];
    // O que se pagou a mais é tudo menos o primeiro.
    const valorRepetido = somar(lista.slice(1), (p) => p.t.valorDocumentoCents);
    achados.push({
      regra: "PE-REEMBOLSO-DUPLICADO",
      tipo: "EVENTO",
      severidade: pisoBaixa(severidadePorValor(valorRepetido, materialidade)),
      categoria: "FRAUDE",
      titulo: `Cupom ${lista[0].t.numeroDocumento} reembolsado ${lista.length} vezes (${pessoas.join(", ")})`,
      descricao:
        `${lista.length} títulos de reembolso/diária carregam o mesmo número de documento "${lista[0].t.numeroDocumento}": ` +
        lista.map((p) => `${fmtBRL(p.t.valorDocumentoCents)} a ${nomeDaPessoa(p.pessoa)} em ${fmtData(p.data)} (${p.t.conexaoApelido})`).join("; ") +
        `. O mesmo comprovante não sustenta dois reembolsos — ${fmtBRL(valorRepetido)} foram pagos a mais, salvo se o número ` +
        `de documento foi digitado errado num deles.`,
      recomendacao:
        "Pedir os comprovantes físicos dos títulos listados e conferir se são o mesmo cupom. Sendo o mesmo, descontar o " +
        "repetido de quem recebeu; sendo cupons diferentes com número igual, corrigir o número na Omie.",
      valorCents: valorRepetido,
      impactoCents: valorRepetido,
      dataReferencia: lista[lista.length - 1].data,
      entidadeTipo: "Motorista",
      entidadeId: lista[0].pessoa.id,
      entidadeRef: pessoas.join(", "),
      evidencia: {
        cupom: lista[0].t.numeroDocumento,
        pessoas: lista.map((p) => ({ pessoa: nomeDaPessoa(p.pessoa), documento: fmtDocumento(p.pessoa.cpf) })),
        titulos: lista.map(linhaDoTitulo),
        valorRepetidoCents: valorRepetido,
      },
      chave: chaveAchado("PE-REEMBOLSO-DUPLICADO", "cupom", cupom, ...lista.map((p) => refTitulo(p.t)).sort()),
    });
  }

  // (b) Mesma pessoa, mesmo valor, mesma categoria em até 7 dias.
  for (const [, grupo] of agrupar(reembolsos, (p) => `${p.pessoa.id}|${p.t.conexaoId}|${p.t.categoriaCodigo ?? ""}|${p.t.valorDocumentoCents}`)) {
    if (grupo.length < 2) continue;
    const ordenado = [...grupo].sort((a, b) => a.data.getTime() - b.data.getTime());
    const intervalos = ordenado.slice(1).map((p, i) => diasEntre(ordenado[i].data, p.data));
    // Diária fixa, paga por dia ou por semana: quatro ou mais títulos iguais
    // em que metade dos intervalos cabe na janela é o ritmo da pessoa.
    const rotina =
      ordenado.length >= TITULOS_IGUAIS_QUE_SAO_ROTINA &&
      intervalos.filter((d) => d <= JANELA_DE_REEMBOLSO_DUPLICADO_DIAS).length >= intervalos.length / 2;
    if (rotina) continue;
    for (let i = 1; i < ordenado.length; i++) {
      const a = ordenado[i - 1];
      const b = ordenado[i];
      if (intervalos[i - 1] > JANELA_DE_REEMBOLSO_DUPLICADO_DIAS) continue;
      if (parcelasDiferentes(a, b)) continue;
      // Já apontado pelo cupom, ou é o mesmo documento em parcelas.
      if (paresPorCupom.has(parChave(a, b))) continue;
      if (a.t.numeroDocumento && a.t.numeroDocumento === b.t.numeroDocumento) continue;
      const valor = b.t.valorDocumentoCents;
      achados.push({
        regra: "PE-REEMBOLSO-DUPLICADO",
        tipo: "EVENTO",
        severidade: pisoBaixa(severidadePorValor(valor, materialidade)),
        categoria: "ERRO_PROCESSO",
        titulo: `${nomeDaPessoa(a.pessoa)}: ${fmtBRL(valor)} de "${a.categoria}" duas vezes em ${intervalos[i - 1]} dia(s)`,
        descricao:
          `Dois títulos de ${fmtBRL(valor)} na categoria "${a.categoria}" foram emitidos a ${nomeDaPessoa(a.pessoa)} em ` +
          `${fmtData(a.data)} e ${fmtData(b.data)}` +
          (a.t.numeroDocumento || b.t.numeroDocumento
            ? ` (documentos ${a.t.numeroDocumento ?? "—"} e ${b.t.numeroDocumento ?? "—"})`
            : " (nenhum dos dois com número de documento)") +
          `. Não é o ritmo normal dessa pessoa nessa categoria (${grupo.length} título(s) iguais no período). Pode ser a ` +
          `mesma despesa lançada duas vezes, ou duas viagens iguais — o comprovante decide.`,
        recomendacao:
          "Conferir os dois comprovantes. Se é a mesma despesa, cancelar ou descontar o segundo; se são duas despesas, " +
          "registrar o número do comprovante em cada título para o próximo par não voltar aqui.",
        valorCents: valor,
        impactoCents: valor,
        dataReferencia: b.data,
        entidadeTipo: "Motorista",
        entidadeId: a.pessoa.id,
        entidadeRef: nomeDaPessoa(a.pessoa),
        evidencia: {
          pessoa: nomeDaPessoa(a.pessoa),
          documento: fmtDocumento(a.pessoa.cpf),
          categoria: a.categoria,
          intervaloDias: intervalos[i - 1],
          titulos: [a, b].map(linhaDoTitulo),
          titulosIguaisNoPeriodo: grupo.length,
        },
        chave: chaveAchado("PE-REEMBOLSO-DUPLICADO", "valor", refTitulo(a.t), refTitulo(b.t)),
      });
    }
  }
  return achados;
}

function parChave(a: Pagamento, b: Pagamento): string {
  return [refTitulo(a.t), refTitulo(b.t)].sort().join("+");
}

// Número de documento normalizado para comparação: só letras e dígitos, sem
// zeros à esquerda, e com pelo menos três caracteres úteis — "1", "01" e "A"
// coincidem por acaso, não por cupom.
function normalizarNumero(numero: string | null): string | null {
  if (!numero) return null;
  const n = numero.replace(/[^a-z0-9]/gi, "").replace(/^0+/, "").toUpperCase();
  return n.length >= 3 ? n : null;
}

// ---------------------------------------------------------------------------
// PE-ADIANTAMENTO-ABERTO — adiantamento sem acerto em dois meses
// ---------------------------------------------------------------------------
// Adiantamento é dinheiro da empresa na mão da pessoa até o acerto. O
// acerto aparece na Omie como título de "acerto"/"devolução"/"desconto em
// folha" a pagar à mesma pessoa, como título a RECEBER do CPF dela, ou como
// rescisão (que o desconta). Sem nenhum dos três em sessenta dias, o
// adiantamento está em aberto — e adiantamento em aberto que se acumula é
// remuneração por fora com outro nome. Agregado por pessoa, RISCO_FINANCEIRO:
// é passivo trabalhista e caixa fora de controle antes de ser fraude.
function adiantamentoAberto(ctx: ContextoAuditoria, pagamentos: Pagamento[], materialidade: number): AchadoNovo[] {
  const adiantamentos = pagamentos.filter(
    (p) => CATEGORIA_DE_ADIANTAMENTO.test(p.caminho) && !CATEGORIA_DE_BENEFICIO.test(p.caminho) && p.t.valorPagoCents > 0
  );
  if (adiantamentos.length === 0) return [];
  const vencidos = adiantamentos.filter((p) => diasEntre(p.data, ctx.dataReferencia) >= DIAS_PARA_ACERTAR_ADIANTAMENTO);
  if (vencidos.length === 0) return [];

  const acertosPorPessoa = agrupar(
    pagamentos.filter((p) => CATEGORIA_DE_ACERTO.test(p.caminho) || CATEGORIA_DE_DESLIGAMENTO.test(p.caminho)),
    (p) => p.pessoa.id
  );
  const recebiveisPorCpf = agrupar(
    titulosAtivos(ctx, "RECEBER").filter((t) => t.parceiroDocumento),
    (t) => (t.parceiroDocumento as string).replace(/\D/g, "")
  );
  const acerto = (p: Pagamento): string | null => {
    const limite = somarDias(p.data, DIAS_PARA_ACERTAR_ADIANTAMENTO);
    const dentro = (d: Date | null) => d !== null && d >= p.data && d <= limite;
    const aPagar = (acertosPorPessoa.get(p.pessoa.id) ?? []).find((a) => a.t.id !== p.t.id && dentro(a.data));
    if (aPagar) return `${aPagar.categoria} em ${fmtData(aPagar.data)}`;
    const aReceber = (recebiveisPorCpf.get(p.pessoa.cpf.replace(/\D/g, "")) ?? []).find((t) => dentro(t.dataEmissao ?? t.dataVencimento));
    if (aReceber) return `título a receber ${refTitulo(aReceber)}`;
    return null;
  };

  const abertos = vencidos.filter((p) => acerto(p) === null);
  if (abertos.length === 0) return [];
  // NENHUM acerto na base inteira: o acerto é feito direto na folha, fora
  // da Omie, e a regra não tem como enxergá-lo — apontaria todo adiantamento
  // da empresa. Cala; o caminho é lançar o desconto em folha como título de
  // acerto, ou aceitar que esta regra não se aplica a esta empresa.
  if (vencidos.length >= MINIMO_PARA_MEDIR_ACERTO && abertos.length === vencidos.length) return [];

  const achados: AchadoNovo[] = [];
  for (const [driverId, doMotorista] of agrupar(abertos, (p) => p.pessoa.id)) {
    const pessoa = doMotorista[0].pessoa;
    const valor = somar(doMotorista, (p) => p.t.valorPagoCents);
    const ordenados = [...doMotorista].sort((a, b) => a.data.getTime() - b.data.getTime());
    achados.push({
      regra: "PE-ADIANTAMENTO-ABERTO",
      tipo: "ESTADO",
      severidade: pisoBaixa(severidadePorValor(valor, materialidade)),
      categoria: "RISCO_FINANCEIRO",
      titulo: `${nomeDaPessoa(pessoa)}: ${doMotorista.length} adiantamento(s) sem acerto há mais de ${DIAS_PARA_ACERTAR_ADIANTAMENTO} dias — ${fmtBRL(valor)}`,
      descricao:
        `${doMotorista.length} adiantamento(s) pagos a ${nomeDaPessoa(pessoa)}${pessoa.active ? "" : " (INATIVO no cadastro)"}, ` +
        `o mais antigo em ${fmtData(ordenados[0].data)}, somando ${fmtBRL(valor)}, não têm nos ${DIAS_PARA_ACERTAR_ADIANTAMENTO} dias ` +
        `seguintes nenhum título de acerto, devolução ou desconto em folha, nenhum título a receber do CPF e nenhuma ` +
        `rescisão. Outros adiantamentos da base têm acerto registrado — estes não.`,
      recomendacao:
        pessoa.active
          ? "Confirmar com o RH e o financeiro se o desconto foi feito na folha sem título na Omie. Se foi, lançar o acerto " +
            "(o achado fecha sozinho); se não foi, descontar nas próximas folhas e registrar."
          : "A pessoa saiu: conferir se o adiantamento foi descontado na rescisão. Se não foi, é valor a cobrar — e sem " +
            "rescisão na Omie, conferir se a rescisão foi paga.",
      valorCents: valor,
      dataReferencia: ctx.dataReferencia,
      entidadeTipo: "Motorista",
      entidadeId: driverId,
      entidadeRef: nomeDaPessoa(pessoa),
      evidencia: {
        pessoa: nomeDaPessoa(pessoa),
        documento: fmtDocumento(pessoa.cpf),
        ativo: pessoa.active,
        quantidade: doMotorista.length,
        valorCents: valor,
        adiantamentos: ordenados.slice(0, 30).map((p) => ({ ...linhaDoTitulo(p), diasEmAberto: diasEntre(p.data, ctx.dataReferencia) })),
      },
      chave: chaveAchado("PE-ADIANTAMENTO-ABERTO", driverId),
    });
  }
  return achados;
}

// ---------------------------------------------------------------------------
// PE-AFASTADO-COM-OPERACAO — ponto batido em dia de atestado ou férias
// ---------------------------------------------------------------------------
// Informativo, e de propósito: na maioria das vezes é o registro que está
// errado (o atestado foi lançado com a data errada, ou as férias foram
// interrompidas e ninguém ajustou). Mas trabalho durante atestado é
// irregularidade trabalhista, e trabalho durante férias anula as férias —
// os dois custam dinheiro numa reclamação. Um achado por afastamento.
function afastadoComOperacao(ctx: ContextoAuditoria, rastro: Rastro): AchadoNovo[] {
  const afastamentos = (ctx.afastamentos ?? []).filter((a) => AFASTAMENTO_FORA_DA_OPERACAO.test(a.leaveType));
  if (afastamentos.length === 0) return [];
  if (!rastro.temPonto && !rastro.temUso && !rastro.temAbastecimento) return [];
  const pessoas = new Map(ctx.motoristas.map((m) => [m.id, m]));

  const achados: AchadoNovo[] = [];
  for (const a of afastamentos) {
    const inicio = inicioDoDia(a.startDate);
    const fim = inicioDoDia(a.endDate);
    if (fim < inicio) continue;
    // Escala não conta: escala é plano, e plano feito antes do atestado é
    // normal. Ponto, veículo retirado e cartão passado são presença.
    const dias = rastro.diasNoPeriodo(a.driverId, inicio, fim, ["ponto", "uso de veículo", "abastecimento"]);
    if (dias.length === 0) continue;
    const pessoa = pessoas.get(a.driverId);
    const nome = pessoa ? nomeDaPessoa(pessoa) : "(motorista fora do cadastro)";
    const duracao = diasEntre(inicio, fim) + 1;
    achados.push({
      regra: "PE-AFASTADO-COM-OPERACAO",
      tipo: "ESTADO",
      severidade: "INFO",
      categoria: "ERRO_PROCESSO",
      titulo: `${nome} tem ${a.leaveType} de ${fmtData(inicio)} a ${fmtData(fim)} e operação em ${dias.length} dia(s) desse período`,
      descricao:
        `A gestão registra ${a.leaveType}${a.paidLeave ? "" : " (não remunerado)"} para ${nome} por ${duracao} dia(s), e em ` +
        `${dias.length} deles há ${[...new Set(dias.flatMap((d) => d.fontes))].join(", ")} em nome da pessoa. Ou o afastamento ` +
        `está com a data errada, ou a pessoa trabalhou afastada — atestado com trabalho é irregularidade, férias com trabalho ` +
        `anulam as férias.`,
      recomendacao:
        "Conferir com o RH as datas do afastamento e com a operação os dias marcados. Corrigir o que estiver errado na " +
        "gestão fecha o achado; se a pessoa trabalhou mesmo, registrar a ocorrência.",
      dataReferencia: fim,
      entidadeTipo: "Motorista",
      entidadeId: a.driverId,
      entidadeRef: nome,
      evidencia: {
        pessoa: nome,
        documento: pessoa ? fmtDocumento(pessoa.cpf) : "—",
        tipo: a.leaveType,
        remunerado: a.paidLeave,
        periodo: `${fmtData(inicio)} a ${fmtData(fim)}`,
        diasDoAfastamento: duracao,
        diasComOperacao: dias.length,
        dias: dias.slice(0, 40).map((d) => ({ dia: d.dia, fontes: d.fontes.join(", ") })),
      },
      chave: chaveAchado("PE-AFASTADO-COM-OPERACAO", a.driverId, chaveDia(inicio), a.leaveType.toLowerCase()),
    });
  }
  return achados;
}
