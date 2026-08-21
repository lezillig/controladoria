import { prisma } from "@/lib/prisma";
import { canManageControladoria } from "@/lib/permissions";
import { existeAlgumaCredencialOmie } from "@/lib/omie/client";
import { isAnalistaDisponivel } from "@/lib/controladoria/aiAnalyst";
import { isEnvioDisponivel } from "@/lib/email/send";
import { coberturaDeCampos, volumeEspelhado } from "@/lib/controladoria/agents/administrativo";
import { progressoDaCarga } from "@/lib/controladoria/progresso";
import { fmtBRL, fmtData, fmtNumero, fmtPercent } from "@/lib/controladoria/format";
import { diasEntre } from "@/lib/controladoria/periodos";
import { contextoDaPagina } from "../_dados";
import { Barra, Kpi, Secao, Tabela } from "../_componentes";
import SyncButton from "./SyncButton";

// SINCRONIZAÇÃO — o estado de saúde do módulo.
//
// A tela mais importante do módulo depois da auditoria, e por um motivo
// específico: a falha mais perigosa de um sistema de auditoria não é apontar
// algo errado, é PARAR DE APONTAR sem ninguém notar. Um sync quebrado há uma
// semana produz um relatório diário bonito, verde e completamente desatualizado.

export default async function SincronizacaoPage() {
  const { session, ctx } = await contextoDaPagina();
  const podeSincronizar = canManageControladoria(session.role);

  const [execucoes, emAndamento, progresso] = await Promise.all([
    prisma.omieSyncRun.findMany({
      where: { companyId: session.companyId },
      orderBy: { iniciadoEm: "desc" },
      take: 20,
    }),
    prisma.omieSyncRun.findFirst({
      where: { companyId: session.companyId, status: "EXECUTANDO" },
      orderBy: { iniciadoEm: "asc" },
    }),
    progressoDaCarga(session.companyId, ctx.config.dataInicioBase),
  ]);

  const ultimoDiario = execucoes.find((e) => e.status === "CONCLUIDO" && !e.backfill);
  const atrasoDias = ultimoDiario ? diasEntre(ultimoDiario.finalizadoEm ?? ultimoDiario.iniciadoEm, new Date()) : null;
  const volume = volumeEspelhado(ctx);
  const cobertura = coberturaDeCampos(ctx);

  // Execução travada: iniciada há muito tempo e ainda em EXECUTANDO. A máquina
  // de estados sempre retoma a execução em andamento, então uma travada
  // impede o ciclo seguinte de começar — por isso o aviso e o botão de encerrar.
  const travada = Boolean(emAndamento && diasEntre(emAndamento.iniciadoEm, new Date()) >= 1);

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Sincronização com a Omie</h1>
        <p className="mt-1 text-sm text-slate-500">
          O módulo mantém um espelho local somente-leitura do ERP. A Omie continua sendo a fonte de verdade contábil; o
          espelho existe para dar histórico estável, cruzamento entre domínios e velocidade de consulta à auditoria.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          rotulo="Credenciais da Omie"
          valor={existeAlgumaCredencialOmie() ? "Configuradas" : "Ausentes"}
          apoio="OMIE_APP_KEY_* / OMIE_APP_SECRET_*"
          tom={existeAlgumaCredencialOmie() ? "bom" : "ruim"}
        />
        <Kpi
          rotulo="Base em D-1"
          valor={atrasoDias === null ? "Nunca" : atrasoDias <= 2 ? "Em dia" : `${fmtNumero(atrasoDias)} dias atrás`}
          apoio={ultimoDiario ? `Última: ${fmtData(ultimoDiario.finalizadoEm ?? ultimoDiario.iniciadoEm)}` : "Sem execução concluída"}
          tom={atrasoDias !== null && atrasoDias <= 2 ? "bom" : "ruim"}
        />
        <Kpi
          rotulo="Envio de e-mail"
          valor={isEnvioDisponivel() ? "Configurado" : "Desativado"}
          apoio="RESEND_API_KEY"
          tom={isEnvioDisponivel() ? "bom" : "atencao"}
        />
        <Kpi
          rotulo="Leitura executiva (IA)"
          valor={isAnalistaDisponivel() ? "Ativa" : "Desativada"}
          apoio="ANTHROPIC_API_KEY — o relatório sai completo mesmo sem ela"
          tom={isAnalistaDisponivel() ? "bom" : "neutro"}
        />
      </div>

      {progresso.totalJanelas > 0 && (
        <Secao
          titulo="Carga histórica"
          descricao={`A base é montada mês a mês, por empresa, desde ${fmtData(ctx.config.dataInicioBase)}. Cada janela mensal passa pelas quatro fases de sincronização.`}
        >
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-semibold text-slate-900">
              {progresso.concluida ? "Concluída" : `${fmtPercent(progresso.percentual)} carregado`}
            </p>
            <p className="text-xs text-slate-500">
              {fmtNumero(progresso.janelasConcluidas)} de {fmtNumero(progresso.totalJanelas)} janelas mensais
            </p>
          </div>
          <div className="mt-2">
            <Barra percentual={progresso.percentual} tom={progresso.concluida ? "verde" : "azul"} />
          </div>
          {progresso.emAndamento ? (
            <>
              <p className="mt-2 text-xs text-slate-500">
                Agora em <strong>{progresso.emAndamento.conexaoApelido}</strong>, competência{" "}
                {progresso.emAndamento.competencia} — fase {progresso.emAndamento.fase} (
                {progresso.emAndamento.faseNumero} de {progresso.emAndamento.totalFases}), na{" "}
                {fmtNumero(progresso.emAndamento.invocacoes)}ª invocação.
              </p>
              {/* Batimento. Cada passo do ciclo carimba a execução, e o carimbo
                  avança a cada ~40 segundos enquanto ela vive. Parado há muito
                  é o sinal de que a função morreu sem marcar a execução como
                  encerrada — o único estado em que o ciclo seguinte não começa
                  sozinho e alguém precisa agir. */}
              {progresso.emAndamento.encadeamentoRecusado && (
                <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-800">
                  <strong>A carga não consegue continuar sozinha.</strong>{" "}
                  {progresso.emAndamento.encadeamentoRecusado}
                </p>
              )}
              {progresso.emAndamento.segundosDesdeUltimoAvanco <= 120 ? (
                <p className="mt-1 flex items-center gap-1.5 text-xs text-emerald-700">
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                  Trabalhando — último avanço há {progresso.emAndamento.segundosDesdeUltimoAvanco}s.
                </p>
              ) : (
                <p className="mt-1 text-xs text-amber-800">
                  Sem avanço há {Math.round(progresso.emAndamento.segundosDesdeUltimoAvanco / 60)} min. O ciclo
                  carimba a execução a cada ~40 segundos, então esta parou. Use{" "}
                  <strong>Sincronizar agora</strong> e deixe esta aba aberta — a página conduz a carga rodada a rodada.
                  {progresso.emAndamento.ultimoDisparo
                    ? " A última tentativa de continuar sozinho foi aceita, então o ciclo em segundo plano é quem se perdeu."
                    : " O sistema não chegou a tentar continuar sozinho nesta execução."}
                </p>
              )}
            </>
          ) : progresso.concluida ? (
            <p className="mt-2 text-xs text-slate-500">
              A base histórica está completa. A partir daqui o ciclo diário só traz o movimento novo.
            </p>
          ) : (
            <p className="mt-2 text-xs text-slate-500">
              Parada no momento. Use <strong>Sincronizar agora</strong> para retomar — ela continua da janela onde
              ficou, sem refazer o que já entrou.
            </p>
          )}
        </Secao>
      )}

      {podeSincronizar && (
        <Secao
          titulo="Executar agora"
          descricao="Roda a mesma máquina de estados do agendamento diário: cadastros → títulos → movimentos → notas → auditoria → relatório."
        >
          <SyncButton temExecucaoTravada={travada} emAndamento={Boolean(emAndamento) && !travada} />
          {travada && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Existe uma execução iniciada em {fmtData(emAndamento!.iniciadoEm)} ainda marcada como em andamento. Enquanto
              ela existir, o ciclo seguinte não começa — encerre-a para destravar.
            </p>
          )}
        </Secao>
      )}

      <Secao titulo="Volume espelhado" descricao={`Desde ${fmtData(ctx.config.dataInicioBase)}.`}>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Kpi rotulo="Títulos a pagar" valor={fmtNumero(volume.titulosPagar)} apoio={volume.valorPagar} />
          <Kpi rotulo="Títulos a receber" valor={fmtNumero(volume.titulosReceber)} apoio={volume.valorReceber} />
          <Kpi rotulo="Baixas / movimentos" valor={`${fmtNumero(volume.baixas)} / ${fmtNumero(volume.movimentos)}`} />
          <Kpi rotulo="Notas / parceiros" valor={`${fmtNumero(volume.notas)} / ${fmtNumero(volume.parceiros)}`} />
        </div>
      </Secao>

      <Secao
        titulo="Preenchimento dos campos"
        descricao="Campo vazio em massa costuma significar duas coisas: ou o dado não é preenchido na Omie (falha de processo, que vira achado), ou o mapeamento da integração não encontrou aquele campo. Esta tabela distingue as duas."
      >
        <div className="space-y-4">
          {cobertura.map((entidade) => (
            <div key={entidade.entidade}>
              <p className="text-xs font-semibold text-slate-700">
                {entidade.entidade} <span className="font-normal text-slate-400">({fmtNumero(entidade.total)} registros)</span>
              </p>
              <ul className="mt-2 space-y-2">
                {entidade.campos.map((campo) => (
                  <li key={campo.nome}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="text-slate-600">{campo.nome}</span>
                      <span className="tabular-nums text-slate-500">{fmtPercent(campo.preenchidoPercent)}</span>
                    </div>
                    <Barra
                      percentual={campo.preenchidoPercent}
                      tom={campo.preenchidoPercent >= 90 ? "verde" : campo.preenchidoPercent >= 50 ? "ambar" : "vermelho"}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Secao>

      <Secao titulo="Últimas execuções">
        <Tabela
          colunas={["Início", "Janela", "Tipo", "Fase", "Registros", "Situação"]}
          alinharDireita={[4]}
          vazio="Nenhuma execução registrada ainda."
          linhas={execucoes.map((e) => [
            <span key="i" className="text-xs">
              {fmtData(e.iniciadoEm)}
              <span className="block text-slate-400">{e.invocacoes} invocação(ões)</span>
            </span>,
            <span key="j" className="text-xs">
              {fmtData(e.janelaInicio)} → {fmtData(e.janelaFim)}
            </span>,
            e.backfill ? "Carga histórica" : "Ciclo diário",
            e.fase,
            <span key="r" className="text-xs">
              {fmtNumero(e.titulosPagar + e.titulosReceber)} títulos · {fmtNumero(e.movimentos)} movimentos
              {e.achados > 0 && <span className="block text-slate-400">{fmtNumero(e.achados)} achados</span>}
            </span>,
            <span key="s" className="text-xs">
              <span
                className={
                  e.status === "CONCLUIDO"
                    ? "font-medium text-emerald-700"
                    : e.status === "ERRO"
                      ? "font-medium text-red-700"
                      : "font-medium text-amber-700"
                }
              >
                {e.status === "CONCLUIDO" ? "Concluída" : e.status === "ERRO" ? "Com erro" : "Em andamento"}
              </span>
              {e.erro && <span className="mt-0.5 block max-w-xs text-slate-500">{e.erro.slice(0, 160)}</span>}
            </span>,
          ])}
        />
      </Secao>

      <Secao titulo="Contas correntes espelhadas">
        <Tabela
          colunas={["Conta", "Banco", "Agência", "Saldo inicial", "Situação"]}
          alinharDireita={[3]}
          vazio="Nenhuma conta corrente sincronizada."
          linhas={ctx.contasCorrentes.map((c) => [
            c.descricao,
            c.banco ?? "—",
            c.agencia ?? "—",
            fmtBRL(c.saldoInicialCents),
            c.inativa ? "Inativa" : "Ativa",
          ])}
        />
        <p className="mt-3 text-xs text-slate-500">
          O saldo consolidado do módulo é o saldo inicial cadastrado somado aos movimentos espelhados — exato apenas se o
          extrato foi importado desde a data desse saldo inicial. Conta ativa sem extrato vira achado de conformidade.
        </p>
      </Secao>
    </div>
  );
}
