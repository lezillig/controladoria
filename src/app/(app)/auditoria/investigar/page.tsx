import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { isInvestigadorDisponivel, lerInvestigacao, listarInvestigacoes } from "@/lib/controladoria/investigador";
import { fmtDataHora } from "@/lib/controladoria/format";
import { larguraPainel } from "@/lib/ui";
import { exigirPermissao, podeAcao } from "../../_dados";
import { AvisoVazio, Secao, Tabela } from "../../_componentes";
import InvestigacaoForm from "./InvestigacaoForm";

// INVESTIGAR COM A IA — uma pergunta, uma resposta com evidência e a trilha
// do que foi consultado.
//
// A tela existe para a pergunta que nenhum filtro responde: "o que está
// acontecendo com este fornecedor?", "esta OS foi paga e não faturada?",
// "por que o vencido a receber dobrou?". Os agentes respondem perguntas
// fixas todo dia; aqui a pergunta é de quem está olhando.
//
// A investigação anda em rodadas conduzidas pelo navegador, e cada rodada
// grava o progresso (ver investigador.ts). Com Fluid Compute ligado no projeto
// da Vercel, o teto por requisição pode ir a 300 segundos mesmo no plano
// Hobby — e uma rodada mais longa significa menos idas e vindas para a mesma
// pergunta. A primeira versão desta tela pedia 60 por cautela e foi justamente
// o que cortou a primeira investigação no meio.
export const maxDuration = 300;

const STATUS_ROTULO: Record<string, string> = {
  EXECUTANDO: "Em andamento",
  CONCLUIDA: "Concluída",
  ERRO: "Falhou",
};

export default async function InvestigarPage({ searchParams }: { searchParams: Promise<{ id?: string; pergunta?: string }> }) {
  const session = await exigirPermissao("investigar");
  const { id, pergunta } = await searchParams;

  const [conexoes, inicial, historico] = await Promise.all([
    prisma.omieConexao.findMany({
      where: { companyId: session.companyId, ativa: true },
      orderBy: { ordem: "asc" },
      select: { id: true, apelido: true, nome: true },
    }),
    id ? lerInvestigacao(id, session.companyId) : Promise.resolve(null),
    listarInvestigacoes(session.companyId, 12),
  ]);

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
        <InvestigacaoForm
          key={inicial?.id ?? pergunta ?? "nova"}
          conexoes={conexoes}
          inicial={inicial}
          perguntaInicial={pergunta?.slice(0, 2000) ?? ""}
          podeTratar={await podeAcao(session, "tratar-achado")}
        />
      ) : (
        <AvisoVazio
          titulo="Investigação indisponível"
          descricao="A chave da API de IA (ANTHROPIC_API_KEY) não está configurada na hospedagem. As telas de auditoria continuam funcionando; só esta consulta depende dela."
          acaoHref="/auditoria"
          acaoLabel="Voltar aos achados"
        />
      )}

      {historico.length > 0 && (
        <Secao
          titulo="Investigações anteriores"
          descricao="Toda pergunta fica gravada com a resposta e as consultas feitas — é a trilha do que a IA olhou."
        >
          <Tabela
            colunas={["Quando", "Quem", "Pergunta", "Recorte", "Consultas", "Situação"]}
            alinharDireita={[4]}
            linhas={historico.map((h) => [
              <span key="q" className="whitespace-nowrap text-xs text-slate-600">
                {fmtDataHora(h.criadoEm)}
              </span>,
              <span key="u" className="text-xs text-slate-600">
                {h.userNome ?? "—"}
              </span>,
              <Link key="p" href={`/auditoria/investigar?id=${h.id}`} className="text-blue-700 hover:underline">
                {h.pergunta.length > 90 ? `${h.pergunta.slice(0, 90)}…` : h.pergunta}
              </Link>,
              <span key="e" className="text-xs text-slate-600">
                {h.empresa}
              </span>,
              <span key="c" className="tabular-nums text-xs text-slate-600">
                {h.consultas.length}
              </span>,
              <span
                key="s"
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  h.status === "CONCLUIDA"
                    ? "bg-emerald-100 text-emerald-700"
                    : h.status === "ERRO"
                      ? "bg-red-100 text-red-700"
                      : "bg-amber-100 text-amber-800"
                }`}
              >
                {STATUS_ROTULO[h.status] ?? h.status}
              </span>,
            ])}
          />
        </Secao>
      )}

      <p className="text-xs text-slate-500">
        A resposta é uma leitura da base espelhada da Omie, com a janela e as limitações que a auditoria tem. Indício
        apontado aqui exige a mesma verificação que um achado — e o conserto continua sendo na Omie, por uma pessoa.
      </p>
    </div>
  );
}
