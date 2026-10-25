// A AUDITORIA DE UMA CONTA CORRENTE — a conta que ninguém olha (a Omie.CASH
// da MCZ, que o dono não acessa) aberta lançamento a lançamento.
//
// A pergunta principal: para quem saiu o dinheiro. Toda saída é ligada ao seu
// beneficiário (pelo extrato, pelo título que ela pagou, pelo cadastro do
// parceiro) e cruzada com os funcionários da Azul e da MCZ (cadastro da gestão
// por CPF e nome; quadro de pessoal pelo nome) e com as empresas do grupo
// (raiz do CNPJ). O que não é funcionário nem empresa do grupo é listado por
// beneficiário. Por cima, as checagens de auditoria (`RegraConta`).
//
// Sem banco: a tela colhe e manda para cá.

export type MovimentoDaConta = {
  id: string;
  origem: "extrato" | "baixa";
  data: Date;
  // Com sinal: saída negativa.
  valorCents: number;
  beneficiario: string | null;
  documento: string | null;
  categoria: string | null;
  observacao: string | null;
  // O título pago/recebido, quando há.
  tituloId: string | null;
  tituloNumero: string | null;
  usuario: string | null;
  // Do cadastro do parceiro.
  parceiroPrimeiraVez: Date | null;
  parceiroContaAlteradaEm: Date | null;
  // Campos do título alterados DEPOIS do pagamento (OmieTituloVersao).
  alteracoesDepois: { campo: string; de: string | null; para: string | null; em: Date }[];
};

export type Funcionario = { nome: string; cpf: string | null; empresa: string | null };

export type TipoBeneficiario = "funcionário" | "empresa do grupo" | "pessoa física" | "empresa" | "sem identificação";

export type Beneficiario = {
  chave: string;
  nome: string;
  documento: string | null;
  tipo: TipoBeneficiario;
  // Por que foi tido como funcionário (CPF ou nome) — para conferência.
  comoFuncionario: string | null;
  totalCents: number;
  vezes: number;
  primeira: Date;
  ultima: Date;
  categorias: string[];
  movimentos: MovimentoDaConta[];
};

export type RegraConta =
  | "SAIDA_SEM_TITULO"
  | "DUPLICIDADE"
  | "FRACIONAMENTO"
  | "VALOR_REDONDO"
  | "FIM_DE_SEMANA"
  | "BENEFICIARIO_NOVO"
  | "CONTA_BANCARIA_ALTERADA"
  | "ALTERADO_APOS_PAGAMENTO"
  | "PESSOAL_PARA_NAO_FUNCIONARIO"
  | "SEM_IDENTIFICACAO";

export const DESCRICAO_REGRA: Record<RegraConta, { titulo: string; porque: string; gravidade: "alta" | "média" | "baixa" }> = {
  PESSOAL_PARA_NAO_FUNCIONARIO: { titulo: "Salário, rescisão ou adiantamento para quem não é funcionário", porque: "Categoria de pessoal paga a alguém que não está no cadastro nem no quadro: funcionário fantasma, ex-funcionário ou desvio.", gravidade: "alta" },
  CONTA_BANCARIA_ALTERADA: { titulo: "Pago logo depois de trocar a conta bancária do beneficiário", porque: "Troca de dados bancários seguida de pagamento é o golpe clássico do boleto/transferência.", gravidade: "alta" },
  ALTERADO_APOS_PAGAMENTO: { titulo: "Título alterado depois de pago", porque: "Mudar fornecedor, valor ou documento de um título já pago apaga o rastro do que saiu.", gravidade: "alta" },
  DUPLICIDADE: { titulo: "Mesmo valor ao mesmo beneficiário em até 7 dias", porque: "Pagamento em dobro, por erro ou de propósito.", gravidade: "alta" },
  SAIDA_SEM_TITULO: { titulo: "Saída do extrato sem conta a pagar", porque: "Dinheiro que saiu sem título que o justifique (sem documento, sem aprovação).", gravidade: "média" },
  FRACIONAMENTO: { titulo: "Vários pagamentos ao mesmo beneficiário no mesmo dia", porque: "Dividir para ficar abaixo da alçada ou chamar menos atenção.", gravidade: "média" },
  BENEFICIARIO_NOVO: { titulo: "Beneficiário novo recebendo valor relevante", porque: "Cadastro recente que já recebe muito: conferir se existe e o que entregou.", gravidade: "média" },
  SEM_IDENTIFICACAO: { titulo: "Saída sem beneficiário identificado", porque: "Não dá para saber para quem foi.", gravidade: "média" },
  VALOR_REDONDO: { titulo: "Valor redondo sem título", porque: "R$ 1.000, 5.000… sem documento costuma ser retirada, empréstimo informal ou adiantamento não registrado.", gravidade: "baixa" },
  FIM_DE_SEMANA: { titulo: "Pagamento em sábado ou domingo", porque: "Fora da rotina de pagamentos: conferir quem fez e por quê.", gravidade: "baixa" },
};

export type Achado = { regra: RegraConta; beneficiario: string; valorCents: number; movimentos: MovimentoDaConta[]; detalhe: string };

export type ResultadoAuditoriaConta = {
  entradasCents: number;
  saidasCents: number;
  lancamentos: number;
  porMes: { mes: string; entradasCents: number; saidasCents: number }[];
  beneficiarios: Beneficiario[];
  naoFuncionarios: Beneficiario[];
  achados: Achado[];
  usuarios: { usuario: string; saidas: number; saidasCents: number }[];
};

export const normalizarNome = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\b(LTDA|ME|EPP|EIRELI|S\/?A|SA)\b\.?/g, "")
    .replace(/\d{11,14}/g, "")
    .replace(/[^A-Z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const CATEGORIA_DE_PESSOAL = /sal[aá]ri|rescis|f[eé]rias|13[ºo°]|d[eé]cimo|adiantamento|vale.?(transporte|refei|alimenta)|pr[oó]-?labore|folha|bonifica|gratifica/i;
const DIAS = 86_400_000;

export function auditarConta(params: {
  movimentos: MovimentoDaConta[];
  funcionarios: Funcionario[];
  // Raízes (8 dígitos) dos CNPJs das empresas do grupo.
  raizesDoGrupo: string[];
  // Beneficiário "novo" com mais que isso no período vira achado.
  limiteNovoCents?: number;
}): ResultadoAuditoriaConta {
  const { movimentos, funcionarios } = params;
  const limiteNovo = params.limiteNovoCents ?? 500_000;
  const cpfs = new Map(funcionarios.filter((f) => f.cpf).map((f) => [f.cpf!.replace(/\D/g, ""), f]));
  const nomes = new Map(funcionarios.map((f) => [normalizarNome(f.nome), f]));
  const grupo = new Set(params.raizesDoGrupo);

  const saidas = movimentos.filter((m) => m.valorCents < 0);
  const entradas = movimentos.filter((m) => m.valorCents > 0);

  const porMes = new Map<string, { mes: string; entradasCents: number; saidasCents: number }>();
  for (const m of movimentos) {
    const mes = m.data.toISOString().slice(0, 7);
    const x = porMes.get(mes) ?? { mes, entradasCents: 0, saidasCents: 0 };
    if (m.valorCents > 0) x.entradasCents += m.valorCents;
    else x.saidasCents += -m.valorCents;
    porMes.set(mes, x);
  }

  // O BENEFICIÁRIO de cada saída: o documento quando há, senão o nome.
  const chaveDe = (m: MovimentoDaConta) => {
    const doc = (m.documento ?? "").replace(/\D/g, "");
    if (doc.length >= 11) return `doc:${doc}`;
    const n = normalizarNome(m.beneficiario ?? "");
    return n ? `nome:${n}` : "sem";
  };
  const porBeneficiario = new Map<string, MovimentoDaConta[]>();
  for (const m of saidas) porBeneficiario.set(chaveDe(m), [...(porBeneficiario.get(chaveDe(m)) ?? []), m]);

  const classificar = (nome: string, documento: string | null): { tipo: TipoBeneficiario; como: string | null } => {
    const doc = (documento ?? "").replace(/\D/g, "");
    if (doc.length === 14 && grupo.has(doc.slice(0, 8))) return { tipo: "empresa do grupo", como: null };
    if (doc.length === 11 && cpfs.has(doc)) return { tipo: "funcionário", como: `CPF no cadastro${cpfs.get(doc)!.empresa ? ` (${cpfs.get(doc)!.empresa})` : ""}` };
    const n = normalizarNome(nome);
    if (n && nomes.has(n)) return { tipo: "funcionário", como: `nome${nomes.get(n)!.empresa ? ` (${nomes.get(n)!.empresa})` : ""}` };
    if (!n && !doc) return { tipo: "sem identificação", como: null };
    if (doc.length === 14) return { tipo: "empresa", como: null };
    if (doc.length === 11) return { tipo: "pessoa física", como: null };
    return { tipo: /\b(LTDA|S\/?A|ME|EPP|EIRELI|COMERCIO|SERVICOS|TRANSPORTES|AUTO POSTO|BANCO)\b/i.test(nome) ? "empresa" : "pessoa física", como: null };
  };

  const beneficiarios: Beneficiario[] = [...porBeneficiario.entries()]
    .map(([chave, lista]) => {
      const nome = lista.find((m) => m.beneficiario)?.beneficiario ?? "(sem beneficiário)";
      const documento = lista.find((m) => m.documento)?.documento ?? null;
      const { tipo, como } = chave === "sem" ? { tipo: "sem identificação" as const, como: null } : classificar(nome, documento);
      const datas = lista.map((m) => m.data.getTime());
      return {
        chave,
        nome,
        documento,
        tipo,
        comoFuncionario: como,
        totalCents: lista.reduce((s, m) => s - m.valorCents, 0),
        vezes: lista.length,
        primeira: new Date(Math.min(...datas)),
        ultima: new Date(Math.max(...datas)),
        categorias: [...new Set(lista.map((m) => m.categoria).filter((c): c is string => !!c))],
        movimentos: lista.sort((a, b) => b.data.getTime() - a.data.getTime()),
      };
    })
    .sort((a, b) => b.totalCents - a.totalCents);

  const achados: Achado[] = [];
  const brl = (c: number) => (Math.abs(c) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  for (const b of beneficiarios) {
    const l = b.movimentos;
    if (b.tipo !== "funcionário" && b.tipo !== "empresa do grupo") {
      const pessoal = l.filter((m) => CATEGORIA_DE_PESSOAL.test(m.categoria ?? ""));
      if (pessoal.length) achados.push({ regra: "PESSOAL_PARA_NAO_FUNCIONARIO", beneficiario: b.nome, valorCents: pessoal.reduce((s, m) => s - m.valorCents, 0), movimentos: pessoal, detalhe: `${pessoal.length} pagamento(s) em ${[...new Set(pessoal.map((m) => m.categoria))].join(", ")}` });
    }
    if (b.tipo === "sem identificação") achados.push({ regra: "SEM_IDENTIFICACAO", beneficiario: b.nome, valorCents: b.totalCents, movimentos: l, detalhe: `${l.length} saída(s)` });
    // Duplicidade: mesmo valor em até 7 dias.
    const ordem = [...l].sort((a, b2) => a.data.getTime() - b2.data.getTime());
    const dup: MovimentoDaConta[] = [];
    for (let i = 0; i < ordem.length; i++)
      for (let j = i + 1; j < ordem.length && ordem[j].data.getTime() - ordem[i].data.getTime() <= 7 * DIAS; j++)
        if (ordem[j].valorCents === ordem[i].valorCents && ordem[j].tituloId !== ordem[i].tituloId) {
          if (!dup.includes(ordem[i])) dup.push(ordem[i]);
          if (!dup.includes(ordem[j])) dup.push(ordem[j]);
        }
    if (dup.length && b.tipo !== "empresa do grupo") achados.push({ regra: "DUPLICIDADE", beneficiario: b.nome, valorCents: dup.reduce((s, m) => s - m.valorCents, 0) / 2, movimentos: dup, detalhe: `${dup.length} pagamentos de valores repetidos` });
    // Fracionamento: 3 ou mais no mesmo dia.
    const porDia = new Map<string, MovimentoDaConta[]>();
    for (const m of l) porDia.set(m.data.toISOString().slice(0, 10), [...(porDia.get(m.data.toISOString().slice(0, 10)) ?? []), m]);
    for (const [dia, ms] of porDia)
      if (ms.length >= 3 && b.tipo !== "empresa do grupo") achados.push({ regra: "FRACIONAMENTO", beneficiario: b.nome, valorCents: ms.reduce((s, m) => s - m.valorCents, 0), movimentos: ms, detalhe: `${ms.length} pagamentos em ${dia.split("-").reverse().join("/")}` });
    // Novo e relevante.
    const primeira = l.find((m) => m.parceiroPrimeiraVez)?.parceiroPrimeiraVez;
    if (primeira && primeira >= b.primeira && b.totalCents >= limiteNovo && b.tipo !== "funcionário" && b.tipo !== "empresa do grupo")
      achados.push({ regra: "BENEFICIARIO_NOVO", beneficiario: b.nome, valorCents: b.totalCents, movimentos: l, detalhe: `cadastro visto pela primeira vez em ${primeira.toLocaleDateString("pt-BR")}` });
    // Pago até 60 dias depois de trocar a conta bancária.
    const trocas = l.filter((m) => m.parceiroContaAlteradaEm && m.data >= m.parceiroContaAlteradaEm && m.data.getTime() - m.parceiroContaAlteradaEm.getTime() <= 60 * DIAS);
    if (trocas.length) achados.push({ regra: "CONTA_BANCARIA_ALTERADA", beneficiario: b.nome, valorCents: trocas.reduce((s, m) => s - m.valorCents, 0), movimentos: trocas, detalhe: `conta bancária trocada em ${trocas[0].parceiroContaAlteradaEm!.toLocaleDateString("pt-BR")}` });
  }
  for (const m of saidas) {
    const nome = m.beneficiario ?? "(sem beneficiário)";
    if (m.origem === "extrato" && !m.tituloId) {
      achados.push({ regra: "SAIDA_SEM_TITULO", beneficiario: nome, valorCents: -m.valorCents, movimentos: [m], detalhe: m.observacao ?? m.categoria ?? "sem observação" });
      if (-m.valorCents >= 100_000 && -m.valorCents % 100_000 === 0) achados.push({ regra: "VALOR_REDONDO", beneficiario: nome, valorCents: -m.valorCents, movimentos: [m], detalhe: brl(m.valorCents) });
    }
    const dia = m.data.getUTCDay();
    if (dia === 0 || dia === 6) achados.push({ regra: "FIM_DE_SEMANA", beneficiario: nome, valorCents: -m.valorCents, movimentos: [m], detalhe: dia === 0 ? "domingo" : "sábado" });
    if (m.alteracoesDepois.length) achados.push({ regra: "ALTERADO_APOS_PAGAMENTO", beneficiario: nome, valorCents: -m.valorCents, movimentos: [m], detalhe: m.alteracoesDepois.map((a) => `${a.campo}: ${a.de ?? "—"} → ${a.para ?? "—"}`).join("; ") });
  }
  const peso = { alta: 0, média: 1, baixa: 2 };
  achados.sort((a, b) => peso[DESCRICAO_REGRA[a.regra].gravidade] - peso[DESCRICAO_REGRA[b.regra].gravidade] || b.valorCents - a.valorCents);

  const usuarios = new Map<string, { usuario: string; saidas: number; saidasCents: number }>();
  for (const m of saidas) {
    const u = m.usuario ?? "(não informado)";
    const x = usuarios.get(u) ?? { usuario: u, saidas: 0, saidasCents: 0 };
    x.saidas++;
    x.saidasCents += -m.valorCents;
    usuarios.set(u, x);
  }

  return {
    entradasCents: entradas.reduce((s, m) => s + m.valorCents, 0),
    saidasCents: saidas.reduce((s, m) => s - m.valorCents, 0),
    lancamentos: movimentos.length,
    porMes: [...porMes.values()].sort((a, b) => a.mes.localeCompare(b.mes)),
    beneficiarios,
    naoFuncionarios: beneficiarios.filter((b) => b.tipo !== "funcionário"),
    achados,
    usuarios: [...usuarios.values()].sort((a, b) => b.saidasCents - a.saidasCents),
  };
}
