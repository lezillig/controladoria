import { prisma } from "@/lib/prisma";
import { dataReferenciaPadrao } from "@/lib/controladoria/ciclo";
import { carregarContexto, janelaDeAuditoria } from "@/lib/controladoria/contexto";
import { sugerirAlcadas } from "@/lib/controladoria/agents/oportunidades";
import { fmtBRL, fmtDiaDoInstante } from "@/lib/controladoria/format";
import { Secao, Tabela } from "../_componentes";
import { exigirPermissao } from "../_dados";
import ConfiguracaoForm from "./ConfiguracaoForm";
import { larguraPainel } from "@/lib/ui";

// MODELO DE GESTÃO — os parâmetros que tornam as regras genéricas em política
// desta empresa, mais a trilha de quem mexeu no módulo.

function linhaDoEvento(e: { criadoEm: Date; userNome: string | null; ip: string | null; acao: string; descricao: string }) {
  return [
    <span key="q" className="text-xs">
      {fmtDiaDoInstante(e.criadoEm)}
      <span className="block text-slate-400">{e.criadoEm.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
    </span>,
    <span key="w" className="text-xs">
      {e.userNome ?? "sistema"}
      {e.ip && <span className="block text-slate-400">{e.ip}</span>}
    </span>,
    <span key="a" className="text-xs font-medium text-slate-700">
      {e.acao.replace(/_/g, " ").toLowerCase()}
    </span>,
    <span key="d" className="text-xs text-slate-600">
      {e.descricao}
    </span>,
  ];
}

export default async function ConfiguracaoPage() {
  // Só quem opera a controladoria configura: GESTOR lê o módulo inteiro, mas
  // mudar o parâmetro que define o que é "crítico" é mexer no próprio critério
  // de auditoria.
  const session = await exigirPermissao("gerir-modelo");
  const ctx = await carregarContexto(session.companyId, dataReferenciaPadrao(), undefined, {
    desde: janelaDeAuditoria(dataReferenciaPadrao()),
  });
  const config = ctx.config;

  const sugestao = sugerirAlcadas(ctx);

  const eventos = await prisma.controladoriaEventLog.findMany({
    where: { companyId: session.companyId },
    orderBy: { criadoEm: "desc" },
    take: 40,
  });

  const emReais = (cents: number | null) => (cents === null ? "" : String(cents / 100).replace(".", ","));

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Modelo de gestão financeira</h1>
        <p className="mt-1 text-sm text-slate-500">
          Os parâmetros abaixo são o que separa uma regra genérica de uma política desta empresa. Vários agentes ficam
          parcialmente desligados enquanto não forem preenchidos — e dizem isso, em vez de inventar um número.
        </p>
      </div>

      <Secao titulo="Parâmetros">
        <ConfiguracaoForm
          valores={{
            emails: config.emailsRelatorio,
            dataInicioBase: config.dataInicioBase.toISOString().slice(0, 10),
            limiteAlcada: emReais(config.limiteAlcadaCents),
            saldoMinimo: emReais(config.saldoMinimoCaixaCents),
            metaMargem: config.metaMargemPercent === null ? "" : String(config.metaMargemPercent).replace(".", ","),
            toleranciaVariacao: String(config.toleranciaVariacaoPercent).replace(".", ","),
            diasAtrasoCritico: String(config.diasAtrasoCritico),
            limiteConcentracao: String(config.limiteConcentracaoFornecedorPercent).replace(".", ","),
            relatorioAutomatico: config.relatorioAutomatico,
            retencoesNasDeducoes: config.retencoesNasDeducoes,
            alertaPorExcecao: config.alertaPorExcecao,
          }}
          alcadaSugerida={
            sugestao
              ? {
                  operacional: fmtBRL(sugestao.operacional),
                  gerencial: fmtBRL(sugestao.gerencial),
                  diretoria: fmtBRL(sugestao.diretoria),
                  amostra: sugestao.amostra,
                }
              : null
          }
        />
      </Secao>

      <Secao
        titulo="Trilha de auditoria do módulo"
        descricao="Toda ação humana aqui dentro fica registrada: tratativa de achado, mudança de parâmetro, meta de BSC, sincronização e envio manual. Nunca é alterada nem apagada."
      >
        {/* RESUMIDA: as cinco ações mais recentes à vista; o resto abre ao
            clicar. A trilha é para conferir quando alguém pergunta, não para
            ler inteira toda vez que a tela abre. */}
        <Tabela colunas={["Quando", "Quem", "Ação", "Descrição"]} vazio="Nenhuma ação registrada ainda." linhas={eventos.slice(0, 5).map(linhaDoEvento)} />
        {eventos.length > 5 && (
          <details className="group mt-3">
            <summary className="cursor-pointer list-none text-sm font-medium text-blue-700 hover:text-blue-900">
              <span className="group-open:hidden">Ver as outras {eventos.length - 5} ações</span>
              <span className="hidden group-open:inline">Recolher</span>
            </summary>
            <div className="mt-2">
              <Tabela colunas={["Quando", "Quem", "Ação", "Descrição"]} linhas={eventos.slice(5).map(linhaDoEvento)} />
            </div>
          </details>
        )}
      </Secao>
    </div>
  );
}
