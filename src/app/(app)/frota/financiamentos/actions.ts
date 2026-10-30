"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { redigir } from "@/lib/controladoria/falhas";
import { registrarAlteracao } from "@/lib/auditoria/trilha";
import { conciliarParcelasOmie } from "@/lib/frota/parcelasOmie";
import { exigirPermissao } from "../../_dados";

// AÇÕES DA CONFERÊNCIA COM A OMIE — com trilha. O contrato em si é da gestão.

type Resposta = { erro?: string; id?: string; ok?: boolean; resumo?: string };
const falha = (e: unknown): Resposta => ({ erro: redigir(e instanceof Error ? e.message : "erro").slice(0, 300) });
const revalidar = (id?: string) => {
  revalidatePath("/frota/financiamentos");
  if (id) revalidatePath(`/frota/financiamentos/${id}`);
};

export async function conferirParcelas(): Promise<Resposta> {
  const session = await exigirPermissao("gerir-financiamentos");
  try {
    const r = await conciliarParcelasOmie(session.companyId);
    revalidar();
    if (r.gestaoIndisponivel) return { erro: "A gestão não respondeu; as ligações de antes continuam. Tente de novo em instantes." };
    return { ok: true, resumo: `${r.ligacoes} parcela(s) da Omie ligadas a ${r.grupos.reduce((s, g) => s + g.contratos, 0)} contrato(s).${r.semParceiro.length ? ` Sem o banco na Omie: ${r.semParceiro.join(", ")}.` : ""}` };
  } catch (e) {
    return falha(e);
  }
}

// QUEM É O BANCO NA OMIE: confirmar a sugestão, ou tirar.
export async function decidirParceiro(fd: FormData): Promise<Resposta> {
  const session = await exigirPermissao("gerir-financiamentos");
  try {
    const id = String(fd.get("id") ?? "");
    const confirmar = fd.get("decisao") === "confirmar";
    const v = await prisma.frotaInstituicaoParceiro.findFirst({ where: { id, companyId: session.companyId } });
    if (!v) return { erro: "Vínculo não encontrado." };
    await prisma.frotaInstituicaoParceiro.update({ where: { id }, data: confirmar ? { confirmado: true, rejeitado: false } : { confirmado: false, rejeitado: true } });
    await registrarAlteracao(prisma, { companyId: session.companyId, usuario: session.name, tabela: "FrotaInstituicaoParceiro", registroId: id, operacao: confirmar ? "update" : "desativar", antes: { instituicao: v.instituicao, parceiro: v.parceiroNome, confirmado: v.confirmado }, depois: confirmar ? { confirmado: true } : null });
    if (!confirmar) await conciliarParcelasOmie(session.companyId);
    revalidar();
    return { ok: true };
  } catch (e) {
    return falha(e);
  }
}
