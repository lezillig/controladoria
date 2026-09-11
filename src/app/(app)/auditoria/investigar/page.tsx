import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { isInvestigadorDisponivel } from "@/lib/controladoria/investigador";
import { larguraPainel } from "@/lib/ui";
import { exigirPermissao } from "../../_dados";
import { AvisoVazio } from "../../_componentes";
import InvestigacaoForm from "./InvestigacaoForm";

// INVESTIGAR COM A IA — uma pergunta, uma resposta com evidência e a trilha
// do que foi consultado.
//
// A tela existe para a pergunta que nenhum filtro responde: "o que está
// acontecendo com este fornecedor?", "esta OS foi paga e não faturada?",
// "por que o vencido a receber dobrou?". Os agentes respondem perguntas
// fixas todo dia; aqui a pergunta é de quem está olhando.

// Uma investigação encadeia até doze consultas ao banco com uma chamada de
// modelo entre cada uma. Cabe com folga em cinco minutos e não cabe em um.
export const maxDuration = 300;

export default async function InvestigarPage() {
  const session = await exigirPermissao("investigar");

  const conexoes = await prisma.omieConexao.findMany({
    where: { companyId: session.companyId, ativa: true },
    orderBy: { ordem: "asc" },
    select: { id: true, apelido: true, nome: true },
  });

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div>
        <p className="text-xs text-slate-500">
          <Link href="/auditoria" className="hover:underline">
            Auditoria e achados
          </Link>{" "}
          / Investigar
        </p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Investigar com a IA</h1>
        <p className="mt-1 text-sm text-slate-500">
          Faça uma pergunta de auditoria. A IA consulta os achados, os títulos, as baixas, o cadastro e o histórico
          mensal — só leitura, só desta empresa — e responde citando o dado. Cada consulta feita aparece abaixo da
          resposta, para você ver o que ela olhou e o que não olhou.
        </p>
      </div>

      {isInvestigadorDisponivel() ? (
        <InvestigacaoForm conexoes={conexoes} />
      ) : (
        <AvisoVazio
          titulo="Investigação indisponível"
          descricao="A chave da API de IA (ANTHROPIC_API_KEY) não está configurada na hospedagem. As telas de auditoria continuam funcionando; só esta consulta depende dela."
          acaoHref="/auditoria"
          acaoLabel="Voltar aos achados"
        />
      )}

      <p className="text-xs text-slate-500">
        A resposta é uma leitura da base espelhada da Omie, com a janela e as limitações que a auditoria tem. Indício
        apontado aqui exige a mesma verificação que um achado — e o conserto continua sendo na Omie, por uma pessoa.
      </p>
    </div>
  );
}
