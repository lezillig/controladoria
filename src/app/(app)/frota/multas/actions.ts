"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { redigir } from "@/lib/controladoria/falhas";
import { lerReaisEmCents } from "@/lib/controladoria/format";
import { lerData, lerInteiro } from "@/lib/cadastro/fichaVeiculo";
import { normalizarPlaca } from "@/lib/cadastro/normalizacao";
import { diferencas, registrarAlteracao } from "@/lib/auditoria/trilha";
import { exigirPermissao } from "../../_dados";

// AS AÇÕES DAS MULTAS — lançar e tratar cada passo, com "gerir-multas". O
// desconto em folha não está aqui: é o RH que aprova, pela pendência.

type Resposta = { erro?: string; id?: string; ok?: boolean };
const falha = (e: unknown): Resposta => ({ erro: redigir(e instanceof Error ? e.message : "erro").slice(0, 300) });
const texto = (fd: FormData, k: string, max = 120) => String(fd.get(k) ?? "").trim().slice(0, max) || null;

export async function lancarMulta(fd: FormData): Promise<Resposta> {
  const session = await exigirPermissao("gerir-multas");
  try {
    const companyId = session.companyId;
    const placa = normalizarPlaca(String(fd.get("placa") ?? ""));
    if (!placa) return { erro: "Placa inválida." };
    const ait = String(fd.get("ait") ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (ait.length < 5) return { erro: "Informe o número do AIT (auto de infração)." };
    const data = lerData(fd.get("data"));
    if (!data || data === "invalida") return { erro: "Informe a data da infração." };
    const hora = /^(\d{1,2}):(\d{2})$/.exec(String(fd.get("hora") ?? "").trim());
    const dataInfracao = new Date(Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), data.getUTCDate(), (hora ? Number(hora[1]) : 12) + 3, hora ? Number(hora[2]) : 0));
    const valor = lerReaisEmCents(String(fd.get("valor") ?? ""));
    if (valor === "invalido" || valor === null || valor <= 0) return { erro: "Valor inválido." };
    const pontos = lerInteiro(fd.get("pontos"), 0, 21);
    if (pontos === "invalido") return { erro: "Pontos de 0 a 21." };
    const prazo = lerData(fd.get("prazoIndicacao"));
    if (prazo === "invalida") return { erro: "Prazo de indicação inválido." };
    const orgao = texto(fd, "orgao", 80);
    const especificacao = texto(fd, "especificacao");
    if (!orgao || !especificacao) return { erro: "Informe o órgão e o que foi a infração." };
    if (await prisma.frotaMulta.findFirst({ where: { companyId, ait }, select: { id: true } })) return { erro: `O AIT ${ait} já está lançado.` };
    const veiculo = await prisma.cadVeiculo.findFirst({ where: { companyId, placa }, select: { id: true } });
    const nova = await prisma.frotaMulta.create({
      data: { companyId, ait, placa, veiculoId: veiculo?.id ?? null, orgao, especificacao, codigoInfracao: texto(fd, "codigo", 20), pontos, valorCents: valor, dataInfracao, prazoIndicacao: prazo, incluidaEm: new Date(), origem: fd.get("origem") === "consulta" ? "consulta" : "manual" },
    });
    await registrarAlteracao(prisma, { companyId, usuario: session.name, tabela: "FrotaMulta", registroId: nova.id, operacao: "insert", depois: { ait, placa, orgao, especificacao, valorCents: valor, dataInfracao } });
    revalidatePath("/frota/multas");
    return { id: nova.id };
  } catch (e) {
    return falha(e);
  }
}

// Um passo do processo. O formulário diz qual ("passo") e traz só os campos
// dele; o resto da multa não muda.
export async function tratarMulta(fd: FormData): Promise<Resposta> {
  const session = await exigirPermissao("gerir-multas");
  try {
    const companyId = session.companyId;
    const m = await prisma.frotaMulta.findFirst({ where: { id: String(fd.get("multaId") ?? ""), companyId } });
    if (!m) return { erro: "Multa não encontrada." };
    const data = (k: string): Date | null | "invalida" => lerData(fd.get(k));
    let depois: Prisma.FrotaMultaUncheckedUpdateInput = {};
    switch (String(fd.get("passo") ?? "")) {
      case "condutor": {
        const pessoaId = String(fd.get("pessoaId") ?? "");
        if (fd.get("naoLocalizado") === "1") {
          depois = { condutorNaoLocalizado: true, condutorPessoaId: null, condutorFonte: null };
          break;
        }
        const p = pessoaId ? await prisma.cadPessoa.findFirst({ where: { id: pessoaId, companyId }, select: { id: true } }) : null;
        if (!p) return { erro: "Escolha quem dirigia." };
        const fonte = String(fd.get("fonte") ?? "manual");
        depois = { condutorPessoaId: p.id, condutorNome: null, condutorNaoLocalizado: false, condutorFonte: ["escala", "uso", "diario", "manual"].includes(fonte) ? fonte : "manual" };
        break;
      }
      case "diario": {
        const sol = data("solicitadoEm");
        const rec = data("recebidoEm");
        if (sol === "invalida" || rec === "invalida") return { erro: "Data inválida." };
        depois = { diarioSolicitadoEm: sol ?? m.diarioSolicitadoEm ?? new Date(), diarioRecebidoEm: rec };
        break;
      }
      case "responsavel": {
        const r = String(fd.get("responsavel") ?? "");
        if (!["motorista", "empresa", "a_definir"].includes(r)) return { erro: "Escolha quem paga." };
        depois = { responsavel: r };
        break;
      }
      case "termo": {
        if (fd.get("recusou") === "1") {
          depois = { termoRecusado: true, termoAssinadoEm: null };
          break;
        }
        const d = data("assinadoEm");
        if (!d || d === "invalida") return { erro: "Informe a data em que o termo foi assinado." };
        depois = { termoAssinadoEm: d, termoRecusado: false, responsavel: "motorista" };
        break;
      }
      case "indicacao": {
        const ind = data("indicadoEm");
        const prazo = data("prazoIndicacao");
        if (ind === "invalida" || prazo === "invalida") return { erro: "Data inválida." };
        depois = { indicadoEm: ind, ...(prazo ? { prazoIndicacao: prazo } : {}) };
        break;
      }
      case "pagamento": {
        const venc = data("vencimentoBoleto");
        const pago = data("pagoEm");
        if (venc === "invalida" || pago === "invalida") return { erro: "Data inválida." };
        depois = { vencimentoBoleto: venc, pagoEm: pago };
        break;
      }
      case "pontos": {
        const pontos = lerInteiro(fd.get("pontos"), 0, 21);
        if (pontos === "invalido") return { erro: "Pontos de 0 a 21." };
        depois = { pontos, observacao: texto(fd, "observacao", 300) ?? m.observacao };
        break;
      }
      case "situacao": {
        const s = String(fd.get("situacao") ?? "");
        if (!["aberta", "finalizada", "cancelada"].includes(s)) return { erro: "Situação inválida." };
        const motivo = texto(fd, "motivo", 300);
        if (s === "cancelada" && !motivo) return { erro: "Diga o motivo (recurso deferido, AIT anulado…)." };
        depois = { situacao: s, ...(motivo ? { observacao: [m.observacao, motivo].filter(Boolean).join(" · ").slice(0, 600) } : {}) };
        break;
      }
      default:
        return { erro: "Passo desconhecido." };
    }
    const mud = diferencas(m as unknown as Record<string, unknown>, depois as Record<string, unknown>);
    if (mud) {
      await prisma.frotaMulta.update({ where: { id: m.id }, data: mud.depois as Prisma.FrotaMultaUncheckedUpdateInput });
      await registrarAlteracao(prisma, { companyId, usuario: session.name, tabela: "FrotaMulta", registroId: m.id, operacao: "update", antes: mud.antes, depois: mud.depois });
    }
    revalidatePath(`/frota/multas/${m.id}`);
    revalidatePath("/frota/multas");
    return { ok: true };
  } catch (e) {
    return falha(e);
  }
}
