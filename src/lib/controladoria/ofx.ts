// LEITURA DE OFX — o extrato que o banco exporta (Bradesco, Itaú, Santander…).
//
// OFX 1.x é SGML: as tags de valor não fecham (`<TRNAMT>-66625,54`). O 2.x é
// XML e fecha. A leitura aqui é por expressão regular, tag a tag, e serve aos
// dois. Valor pode vir com vírgula decimal (o Bradesco manda assim) ou ponto.

export type LancamentoOfx = { id: string; data: Date; valorCents: number; memo: string; documento: string | null };
export type ExtratoOfx = {
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  inicio: Date | null;
  fim: Date | null;
  saldoCents: number | null;
  saldoEm: Date | null;
  lancamentos: LancamentoOfx[];
};

const tag = (bloco: string, nome: string): string | null => {
  const m = new RegExp(`<${nome}>([^<\\r\\n]*)`, "i").exec(bloco);
  const v = m?.[1]?.trim();
  return v ? v : null;
};

// "20261028120000[-3:BRT]" → 28/10/2026 (meia-noite UTC: é dia, não instante).
function dataOfx(v: string | null): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(v ?? "");
  if (!m || m[1] === "0000") return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

// "-66625,54", "1.234,56", "1234.56", "-1,234.56" → centavos.
export function valorOfx(v: string | null): number | null {
  if (!v) return null;
  let t = v.replace(/\s/g, "");
  const negativo = t.startsWith("-");
  t = t.replace(/^[-+]/, "");
  const ultimaVirgula = t.lastIndexOf(",");
  const ultimoPonto = t.lastIndexOf(".");
  if (ultimaVirgula > ultimoPonto) t = t.replace(/\./g, "").replace(",", ".");
  else t = t.replace(/,/g, "");
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) * (negativo ? -1 : 1);
}

export function lerOfx(texto: string): ExtratoOfx {
  const conta = /<(BANKACCTFROM|CCACCTFROM)>([\s\S]*?)<\/\1>/i.exec(texto)?.[2] ?? texto;
  const lista = /<BANKTRANLIST>([\s\S]*?)<\/BANKTRANLIST>/i.exec(texto)?.[1] ?? "";
  const saldo = /<LEDGERBAL>([\s\S]*?)<\/LEDGERBAL>/i.exec(texto)?.[1] ?? "";
  const lancamentos: LancamentoOfx[] = [];
  for (const m of texto.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi)) {
    const b = m[1];
    const data = dataOfx(tag(b, "DTPOSTED"));
    const valorCents = valorOfx(tag(b, "TRNAMT"));
    if (!data || valorCents === null) continue;
    lancamentos.push({
      id: tag(b, "FITID") ?? `${data.toISOString().slice(0, 10)}:${valorCents}:${lancamentos.length}`,
      data,
      valorCents,
      memo: [tag(b, "NAME"), tag(b, "MEMO")].filter(Boolean).join(" · ") || "—",
      documento: tag(b, "CHECKNUM") ?? tag(b, "REFNUM"),
    });
  }
  return {
    banco: tag(conta, "BANKID"),
    agencia: tag(conta, "BRANCHID"),
    conta: tag(conta, "ACCTID"),
    inicio: dataOfx(tag(lista, "DTSTART")),
    fim: dataOfx(tag(lista, "DTEND")),
    saldoCents: valorOfx(tag(saldo, "BALAMT")),
    saldoEm: dataOfx(tag(saldo, "DTASOF")),
    lancamentos,
  };
}

// A conta da Omie que corresponde ao arquivo: mesmo banco (237 = 0237) e
// número da conta contendo o do arquivo (com ou sem dígito, zeros à esquerda).
export function contaDoOfx<C extends { banco: string | null; numeroConta: string | null }>(ofx: ExtratoOfx, contas: C[]): C | null {
  const digitos = (s: string | null) => (s ?? "").replace(/\D/g, "").replace(/^0+/, "");
  const banco = digitos(ofx.banco);
  const numero = digitos(ofx.conta);
  if (!numero) return null;
  const candidatas = contas.filter((c) => (!banco || digitos(c.banco) === banco) && digitos(c.numeroConta).length > 0);
  return (
    candidatas.find((c) => digitos(c.numeroConta) === numero) ??
    candidatas.find((c) => digitos(c.numeroConta).startsWith(numero) && digitos(c.numeroConta).length - numero.length <= 1) ??
    candidatas.find((c) => numero.startsWith(digitos(c.numeroConta)) && numero.length - digitos(c.numeroConta).length <= 1) ??
    null
  );
}

// O CRUZAMENTO: cada lançamento do banco com um da Omie de MESMO valor, na
// data mais próxima dentro de `folgaDias` (compensação e lançamento na Omie
// costumam diferir em um dia). Cada lado casa uma vez só.
export type LadoOmie = { id: string; data: Date; valorCents: number; descricao: string; conciliado: boolean };
export type CruzamentoOfx = {
  casados: { banco: LancamentoOfx; omie: LadoOmie; dias: number }[];
  soNoBanco: LancamentoOfx[];
  soNaOmie: LadoOmie[];
  agendados: LancamentoOfx[];
};

export function cruzarOfx(params: { banco: LancamentoOfx[]; omie: LadoOmie[]; ate: Date | null; folgaDias?: number }): CruzamentoOfx {
  const folga = (params.folgaDias ?? 3) * 86_400_000;
  const limite = params.ate ? params.ate.getTime() : Infinity;
  const agendados = params.banco.filter((b) => b.data.getTime() > limite);
  const banco = params.banco.filter((b) => b.data.getTime() <= limite).sort((a, b) => a.data.getTime() - b.data.getTime());
  const livres = new Set(params.omie.map((o) => o.id));
  const casados: CruzamentoOfx["casados"] = [];
  const soNoBanco: LancamentoOfx[] = [];
  for (const b of banco) {
    let melhor: LadoOmie | null = null;
    for (const o of params.omie) {
      if (!livres.has(o.id) || o.valorCents !== b.valorCents) continue;
      const d = Math.abs(o.data.getTime() - b.data.getTime());
      if (d > folga) continue;
      if (!melhor || d < Math.abs(melhor.data.getTime() - b.data.getTime())) melhor = o;
    }
    if (melhor) {
      livres.delete(melhor.id);
      casados.push({ banco: b, omie: melhor, dias: Math.round((melhor.data.getTime() - b.data.getTime()) / 86_400_000) });
    } else soNoBanco.push(b);
  }
  return { casados, soNoBanco, soNaOmie: params.omie.filter((o) => livres.has(o.id)), agendados };
}
