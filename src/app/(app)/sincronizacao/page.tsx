import { prisma } from "@/lib/prisma";
import { canManageControladoria } from "@/lib/permissions";
import { existeAlgumaCredencialOmie } from "@/lib/omie/client";
import { isAnalistaDisponivel } from "@/lib/controladoria/aiAnalyst";
import { isEnvioDisponivel } from "@/lib/email/send";
import { coberturaDeCamposNoBanco, volumeEspelhadoNoBanco } from "@/lib/controladoria/saudeDaBase";
import { progressoDaCarga } from "@/lib/controladoria/progresso";
import { resumirSaldos, saldosPorConta } from "@/lib/controladoria/saldos";
import { falhaDeVersaoAnterior, ultimasFalhas } from "@/lib/controladoria/falhas";
import { badgeClass } from "@/lib/ui";
import { apenasNotas, janelasComFalha } from "@/lib/controladoria/janelasComFalha";
import { ultimaMedicaoDaAuditoria } from "@/lib/controladoria/medicaoAuditoria";
import { driftDoEsquema, ondeOBancoOlha, sobrasEmOutrosEsquemas } from "@/lib/controladoria/esquema";
import { esquemaDaControladoria } from "@/lib/esquemaDoBanco";
import { versaoPublicada } from "@/lib/controladoria/versao";
import { fmtBRL, fmtData, fmtDataHora, fmtNumero, fmtPercent } from "@/lib/controladoria/format";
import { diasEntre } from "@/lib/controladoria/periodos";
import { disponibilidadeGestao } from "@/lib/gestao/leitura";
import { modoDaConexaoGestao } from "@/lib/gestao/cliente";
import { sessaoControladoria } from "../_dados";
import { Barra, Kpi, Secao, Tabela } from "../_componentes";
import SyncButton from "./SyncButton";
import RelerJanelaButton from "./RelerJanelaButton";
import RelerPeriodoForm from "./RelerPeriodoForm";

// Teto de duração das Server Actions desta tela, declarado por precaução e não
// por diagnóstico.
//
// A ação de sincronizar orça 40s de trabalho e 48s de prazo. O log de produção
// mostra que isso já acontecia sem a declaração — as rodadas duram ~41s e
// respondem 200 —, então o padrão da hospedagem hoje é suficiente. A linha
// existe para o orçamento não ficar dependendo de um padrão que pode mudar sem
// aviso, e para o teto ficar escrito onde a rota do cron já escreve o dela.
export const maxDuration = 60;

// SINCRONIZAÇÃO — o estado de saúde do módulo.
//
// A tela mais importante do módulo depois da auditoria, e por um motivo
// específico: a falha mais perigosa de um sistema de auditoria não é apontar
// algo errado, é PARAR DE APONTAR sem ninguém notar. Um sync quebrado há uma
// semana produz um relatório diário bonito, verde e completamente desatualizado.

// Esta tela NÃO monta o contexto de auditoria, de propósito.
//
// O contexto carrega todos os títulos, baixas, notas, parceiros, categorias e
// contas correntes, com as linhas inteiras — os agentes precisam disso para
// cruzar registro a registro. Esta tela precisa só de contagens.
//
// A diferença ficou cara de um jeito concreto: a página se atualiza sozinha a
// cada quinze segundos enquanto a carga anda, e cada atualização puxava a base
// inteira. Foi isso que esgotou a franquia de transferência do banco e derrubou
// junto o sistema de gestão que divide o mesmo Postgres. Medir o andamento não
// pode custar mais que o andamento.
export default async function SincronizacaoPage() {
  const session = await sessaoControladoria();
  const podeSincronizar = canManageControladoria(session.role);

  const config = await prisma.controladoriaConfig.findUnique({
    where: { companyId: session.companyId },
    select: { dataInicioBase: true },
  });
  const dataInicioBase = config?.dataInicioBase ?? new Date();

  const conexoesAtivas = await prisma.omieConexao.findMany({
    where: { companyId: session.companyId, ativa: true },
    orderBy: { ordem: "asc" },
    select: { id: true, apelido: true, nome: true },
  });

  // Mês PASSADO como padrão do formulário de releitura, não o corrente: quem
  // corrige lançamento quase sempre está fechando o mês anterior, e o mês
  // corrente já é relido todo dia pelo ciclo.
  const mesAnterior = new Date();
  mesAnterior.setMonth(mesAnterior.getMonth() - 1);
  const mesPadraoParaReleitura = `${mesAnterior.getFullYear()}-${String(mesAnterior.getMonth() + 1).padStart(2, "0")}`;

  const [execucoes, emAndamento, progresso, volume, cobertura, contasCorrentes, falhas, drift, onde, janelasRuins, medicao, sobras] =
    await Promise.all([
    prisma.omieSyncRun.findMany({
      where: { companyId: session.companyId },
      orderBy: { iniciadoEm: "desc" },
      take: 20,
    }),
    prisma.omieSyncRun.findFirst({
      where: { companyId: session.companyId, status: "EXECUTANDO" },
      orderBy: { iniciadoEm: "asc" },
    }),
    progressoDaCarga(session.companyId, dataInicioBase),
    volumeEspelhadoNoBanco(session.companyId),
    coberturaDeCamposNoBanco(session.companyId),
    // `catch` aqui, e não dentro da função: esta tela é a que mostra o
    // relatório de diferenças de esquema, e ela não pode morrer justamente
    // quando o esquema é o problema. Uma consulta que depende de coluna
    // ausente derrubaria a página antes de o diagnóstico aparecer.
    saldosPorConta(session.companyId).catch(() => null),
    ultimasFalhas(10),
    driftDoEsquema(),
    ondeOBancoOlha(),
    janelasComFalha(session.companyId),
    ultimaMedicaoDaAuditoria(session.companyId),
    sobrasEmOutrosEsquemas(),
  ]);

  const resumoSaldos = contasCorrentes ? resumirSaldos(contasCorrentes) : null;
  const janelasSemNotas = apenasNotas(janelasRuins);
  const versao = versaoPublicada();

  // Lido DEPOIS das consultas: a disponibilidade é registrada pela própria
  // leitura da gestão, então só faz sentido consultá-la quando ela já rodou.
  const gestao = disponibilidadeGestao();

  const ultimoDiario = execucoes.find((e) => e.status === "CONCLUIDO" && !e.backfill);
  const atrasoDias = ultimoDiario ? diasEntre(ultimoDiario.finalizadoEm ?? ultimoDiario.iniciadoEm, new Date()) : null;

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
        {/* VERSÃO NO AR — a resposta para "o deploy já rodou?".
            Sem ela, a única forma de saber qual versão está atendendo é abrir
            o painel da hospedagem, e a dúvida volta a cada correção: é o erro
            de antes ou a versão nova falhando de novo? */}
        <p className="mt-2 text-xs text-slate-400">
          {versao.publicado
            ? `Versão no ar: ${versao.commitCurto}${versao.buildEm ? ` · publicada em ${fmtDataHora(versao.buildEm)}` : ""}`
            : "Ambiente local — sem publicação associada."}
          {versao.mensagem ? ` · ${versao.mensagem}` : ""}
        </p>
      </div>

      {/* DIFERENÇAS DE ESQUEMA — primeiro de tudo, e não no rodapé.
          Quando o banco que está atendendo não tem as colunas que o código
          espera, tudo o que vem abaixo fica suspeito: contagem que some,
          cobertura que despenca, tela que não abre. Ler isso depois de já ter
          tirado conclusões dos outros números é o caminho mais rápido para
          consertar o problema errado. */}
      {drift.disponivel &&
        (drift.tabelasFaltantes.length > 0 ||
          drift.colunasFaltantes.length > 0 ||
          drift.colunasOpcionaisDemais.length > 0) && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm font-semibold text-red-900">O banco em uso está atrás do esquema do sistema</p>
          <p className="mt-1 text-xs leading-relaxed text-red-800">
            As migrações são aplicadas a cada publicação, mas só valem para o que ainda não está marcado como aplicado —
            um banco cuja tabela veio de outra origem passa por elas em silêncio. Enquanto a diferença existir, consultas
            que usam estas colunas falham, e a gravação da sincronização pode estar descartando registro sem alarde.
          </p>
          {drift.tabelasFaltantes.length > 0 && (
            <p className="mt-2 text-xs text-red-900">
              <strong>Tabelas ausentes:</strong> {drift.tabelasFaltantes.join(", ")}
            </p>
          )}
          {drift.colunasFaltantes.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 font-mono text-[11px] text-red-900">
              {drift.colunasFaltantes.slice(0, 40).map((c) => (
                <li key={`${c.tabela}.${c.coluna}`}>
                  {c.tabela}.{c.coluna} — {c.tipo}
                  {c.obrigatoria ? " (obrigatória)" : ""}
                </li>
              ))}
            </ul>
          )}
          {drift.colunasFaltantes.length > 40 && (
            <p className="mt-1 text-xs text-red-800">
              …e mais {fmtNumero(drift.colunasFaltantes.length - 40)} coluna(s).
            </p>
          )}
          {drift.colunasOpcionaisDemais.length > 0 && (
            <>
              <p className="mt-2 text-xs text-red-900">
                <strong>Colunas que aceitam vazio onde o sistema exige valor</strong> — existem, mas na forma errada:
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 font-mono text-[11px] text-red-900">
                {drift.colunasOpcionaisDemais.slice(0, 20).map((c) => (
                  <li key={`nul-${c.tabela}.${c.coluna}`}>
                    {c.tabela}.{c.coluna}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

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
          descricao={`A base é montada mês a mês, por empresa, desde ${fmtData(dataInicioBase)}. Cada janela mensal passa pelas quatro fases de sincronização.`}
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
                    : " Enquanto a aba conduz a carga, o ciclo em segundo plano fica de fora para não haver dois motores na mesma execução — então esta mensagem costuma significar apenas que a aba foi fechada ou parada."}
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

      {/* De onde vêm os dados da operação.
          A Controladoria lê seis tabelas do sistema de gestão — duas delas
          sustentam o login. Quando os bancos são separados, essa leitura vai
          por uma conexão própria, e se ela estiver mal configurada o sintoma é
          silencioso: cruzamentos somem, ninguém entra, e nada explica por quê.
          Dizer aqui qual modo está valendo evita que isso vire suposição. */}
      <Secao titulo="Origem dos dados da operação">
        <p className="text-sm text-slate-600">
          {modoDaConexaoGestao() === "separado" ? (
            <>
              Conexão <strong>própria</strong> com o banco do sistema de gestão (
              <code className="rounded bg-slate-100 px-1 text-xs">GESTAO_DATABASE_URL</code>). Os dois sistemas estão em
              bancos separados, e esta aplicação só lê o de lá.
            </>
          ) : (
            <>
              Mesma conexão desta aplicação — os dois sistemas dividem o mesmo banco, em schemas diferentes. Para
              separá-los, configure <code className="rounded bg-slate-100 px-1 text-xs">GESTAO_DATABASE_URL</code> com um
              papel somente leitura (ver <code className="rounded bg-slate-100 px-1 text-xs">docs/papel-leitura-gestao.sql</code>).
            </>
          )}
        </p>
        {!gestao.disponivel && gestao.erro && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{gestao.erro}</p>
        )}
      </Secao>

      <Secao titulo="Volume espelhado" descricao={`Desde ${fmtData(dataInicioBase)}.`}>
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

      {/* SALDO POR CONTA — a tabela que existe para localizar a diferença.
          A Omie mostra saldo em contas de R$ 2,99 milhões; o módulo mostrava
          R$ 131 mil. Total contra total só permite discordar. Aberto conta a
          conta, com quantas linhas de extrato cada uma tem e que período elas
          cobrem, a diferença deixa de ser um mistério e vira uma linha: conta
          ativa com zero linha de extrato é o extrato que não chegou. */}
      <Secao titulo="Saldo por conta corrente">
        <Tabela
          colunas={[
            "Conta",
            "Saldo inicial",
            "Extrato (linhas)",
            "Período do extrato",
            "Movimento (R$)",
            "Saldo calculado",
            "Baixas (R$)",
            "Situação",
          ]}
          alinharDireita={[1, 2, 4, 5, 6]}
          vazio={
            contasCorrentes
              ? "Nenhuma conta corrente sincronizada."
              : "Não foi possível calcular os saldos — veja as diferenças de esquema abaixo."
          }
          linhas={(contasCorrentes ?? []).map((c) => [
            <span key="c">
              {c.descricao}
              <span className="mt-0.5 block text-xs text-slate-500">
                {c.conexaoApelido}
                {c.banco ? ` · banco ${c.banco}` : ""}
              </span>
            </span>,
            fmtBRL(c.saldoInicialCents),
            c.movimentos === 0 ? (
              <span key="m" className="font-medium text-amber-700">
                0
              </span>
            ) : (
              fmtNumero(c.movimentos)
            ),
            c.primeiroMovimento && c.ultimoMovimento
              ? `${fmtData(c.primeiroMovimento)} a ${fmtData(c.ultimoMovimento)}`
              : "—",
            fmtBRL(c.somaMovimentosCents),
            fmtBRL(c.saldoCalculadoCents),
            fmtBRL(c.somaBaixasCents),
            c.inativa ? "Inativa" : "Ativa",
          ])}
        />
        <p className="mt-3 text-xs text-slate-500">
          Saldo calculado = saldo inicial cadastrado + movimento do extrato espelhado. Ele só é comparável ao saldo da
          Omie quando o extrato cobre todo o período desde a data do saldo inicial — por isso a coluna de período está
          ao lado. <strong>Conta ativa com zero linha de extrato</strong> significa que a Omie não devolveu extrato para
          ela: nesse caso o saldo calculado é apenas o saldo inicial, e a diferença para a Omie é justamente o movimento
          que falta.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          A coluna de baixas é <strong>referência, não parcela do saldo</strong>: baixa de título e linha de extrato são
          a mesma movimentação vista de dois lugares, e somar as duas contaria cada pagamento duas vezes. Ela está aqui
          para mostrar que o dinheiro passou pela conta mesmo quando o extrato veio vazio.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          {!resumoSaldos
            ? "O cálculo de saldo não pôde ser feito nesta leitura."
            : resumoSaldos.contasAtivasSemMovimento > 0
            ? `${fmtNumero(resumoSaldos.contasAtivasSemMovimento)} de ${fmtNumero(
                resumoSaldos.contas
              )} contas estão ativas e sem nenhuma linha de extrato espelhada. Enquanto isso durar, o saldo consolidado do módulo (${fmtBRL(
                resumoSaldos.saldoCalculadoCents
              )}) não é comparável ao da Omie.`
            : `Saldo consolidado do módulo: ${fmtBRL(resumoSaldos.saldoCalculadoCents)} em ${fmtNumero(
                resumoSaldos.contas
              )} contas, todas com extrato espelhado.`}
        </p>
      </Secao>

      {/* FALHAS DE TELA — o identificador com a causa ao lado.
          A tela de erro mostra "erro 2799718439" e pede que o número seja
          informado. Até aqui, responder o que ele significava exigia exportar
          o log da hospedagem: três rodadas disso custaram mais que o conserto
          dos erros. Agora a mensagem mora ao lado do identificador. */}
      {/* ONDE O BANCO ESTÁ OLHANDO — sempre visível, e não só quando há alarme.
          Este bloco nasceu dentro do painel vermelho, o que o escondia
          exatamente quando ele é mais útil: na hora de CONFIRMAR que o
          problema acabou. O painel sumir prova que não há diferença de
          esquema; não prova que os dois caminhos de consulta concordam. São
          perguntas diferentes, e a segunda foi a que custou caro. */}
      {onde.disponivel && (
        <Secao titulo="Onde o banco está olhando">
          <p className="font-mono text-[11px] leading-relaxed text-slate-700">
            banco: {onde.banco ?? "?"} · schema do cliente: {esquemaDaControladoria()} · schema do SQL cru sem
            qualificar: {onde.esquemaAtual ?? "(nenhum)"} · search_path: {onde.caminhoDeBusca ?? "?"}
          </p>
          <p className="mt-1 font-mono text-[11px] text-slate-700">
            OmieTitulo — pelo cliente: {onde.titulosPeloPrisma ?? "erro"} · pelo mesmo nome em SQL cru sem qualificar:{" "}
            {onde.titulosPorSqlCru ?? "erro"}
          </p>
          <ul className="mt-2 space-y-0.5 font-mono text-[11px] text-slate-600">
            {onde.esquemas.map((e) => (
              <li key={e.esquema}>
                {e.esquema}: {fmtNumero(e.tabelas)} tabela(s) · OmieConexao {e.temOmieConexao ? "sim" : "não"} ·
                OmieTitulo.conexaoId {e.tituloTemConexaoId ? "sim" : "não"} · FalhaDeServidor{" "}
                {e.temFalhaDeServidor ? "sim" : "não"}
              </li>
            ))}
          </ul>
          {sobras.length > 0 && (
            <>
              <p className="mt-3 text-xs font-medium text-slate-800">
                Cópias antigas da Controladoria em outros schemas — candidatas a limpeza:
              </p>
              <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-slate-600">
                {sobras.map((t) => (
                  <li key={`${t.esquema}.${t.tabela}`}>
                    {t.esquema}.{t.tabela} —{" "}
                    {t.linhasEstimadas < 0 ? "nunca analisada" : `~${fmtNumero(Math.round(t.linhasEstimadas))} linha(s)`}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-slate-500">
                Estimativa do planejador, não contagem exata — basta para decidir. O sistema não as usa mais, mas quem
                abrir um console no banco e consultar sem qualificar o schema vai encontrar a tabela errada.{" "}
                <strong>Nada é apagado automaticamente:</strong> o schema <code>public</code> é onde vive a gestão de
                motoristas, e um DROP no lugar errado ali não é um susto.
              </p>
            </>
          )}
          {onde.titulosPeloPrisma !== null &&
          onde.titulosPorSqlCru !== null &&
          onde.titulosPeloPrisma !== onde.titulosPorSqlCru ? (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-900">
              Os dois caminhos leem tabelas DIFERENTES. Toda consulta em SQL cru deste sistema é qualificada com o
              schema do cliente, então as telas continuam certas — mas existe uma cópia antiga no caminho, e ela vai
              confundir a próxima pessoa que abrir um console no banco.
            </p>
          ) : (
            <p className="mt-3 text-xs text-slate-500">
              Os dois caminhos leem a mesma tabela. Foi a divergência entre eles que fez a tela de resultado morrer com
              &quot;column cat.conexaoId does not exist&quot; enquanto a tela vizinha ia bem — e é por isso que a
              conferência ficou aqui, em vez de sumir junto com o problema.
            </p>
          )}
        </Secao>
      )}

      {/* RELER UM PERÍODO — depois de corrigir dado na Omie.

          Vem ANTES da lista de janelas com erro de propósito: aquela responde
          "a carga quebrou, refaça"; esta responde "a carga foi bem, mas o dado
          mudou na Omie depois". A segunda acontece toda vez que alguém conserta
          um lançamento, e não tinha caminho nenhum na tela — o botão Reler só
          aparece em janela que falhou.

          Sem isto, o ciclo "corrige na Omie, confere aqui" tinha um buraco
          silencioso: o ciclo diário relê emissão e pagamento dos últimos três
          dias, e vencimento de hoje ±120 dias. Um título de abril corrigido
          hoje, com vencimento em abril, nunca mais seria lido — e a conferência
          mostraria o número velho como se fosse o novo. */}
      {podeSincronizar && (
        <Secao
          titulo="Reler um período"
          descricao="Depois de corrigir lançamentos na Omie, marque os meses corrigidos para o espelho ler de novo."
        >
          <RelerPeriodoForm conexoes={conexoesAtivas} mesPadrao={mesPadraoParaReleitura} />
          <p className="mt-4 text-xs text-slate-500">
            O ciclo diário relê só a emissão e o pagamento dos <strong>últimos três dias</strong>, mais os vencimentos
            de hoje ±120 dias. Correção em mês mais antigo que isso não chega sozinha — é para ela que esta seção
            existe.
          </p>
        </Secao>
      )}

      {/* JANELAS EM QUE A LEITURA FALHOU.
          A fase de notas é best-effort de propósito — recusa da Omie em NF-e
          não pode impedir o relatório do dia. Mas a janela era marcada como
          concluída de qualquer jeito, o ciclo seguia, e aquele mês ficava para
          sempre sem nota. O erro era gravado; só não era mostrado.

          É a primeira coisa a olhar quando o faturamento do sistema não bate
          com a declaração da contabilidade. */}
      {janelasRuins.length > 0 && (
        <Secao titulo="Janelas de carga que registraram erro">
          {janelasSemNotas.length > 0 && (
            <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
              <strong>
                {fmtNumero(janelasSemNotas.length)} destas falharam ao ler NOTAS FISCAIS.
              </strong>{" "}
              Esses meses podem estar sem faturamento no espelho — e é a explicação mais provável quando o número do
              sistema não bate com a declaração da contabilidade.
            </p>
          )}
          <Tabela
            colunas={["Empresa", "Competência", "Fase", "Erro", "Ação"]}
            vazio="Nenhuma."
            linhas={janelasRuins.map((j) => [
              j.conexaoApelido,
              j.competencia,
              j.fase,
              <span key="e" className="block max-w-xl whitespace-pre-wrap text-xs text-slate-600">
                {j.erro}
              </span>,
              // Só janela de CARGA HISTÓRICA de uma conexão pode ser relida: a
              // execução do ciclo diário não é uma janela mensal, e apagá-la
              // não faria a Omie ser consultada de novo.
              podeSincronizar && j.backfill && j.conexaoId ? (
                <RelerJanelaButton
                  key="r"
                  conexaoId={j.conexaoId}
                  janelaInicio={j.inicio.toISOString()}
                  rotulo={`${j.conexaoApelido} · ${j.competencia}`}
                />
              ) : (
                "—"
              ),
            ])}
          />
          <p className="mt-3 text-xs text-slate-500">
            Mensagem inteira, sem corte. A lista de execuções acima mostra as mesmas falhas cortadas em 160 caracteres —
            foi esse corte que manteve o motivo invisível.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            <strong>Reler</strong> apaga a execução daquele mês, não os dados: o ciclo procura a primeira janela que
            falta e a refaz, gravando por cima. O espelho é upsert — reler atualiza e completa, nunca duplica nem perde.
            Uma janela por vez, porque recarregar as trinta e oito são horas de sincronização e consumo de API das duas
            contas.
          </p>
        </Secao>
      )}

      {/* CUSTO DA AUDITORIA — a fase que roda perto do teto da função.
          Função que estoura não grava nada, e o diagnóstico morre junto. A
          medição já era gravada; faltava mostrá-la, e faltava a metade dos
          agentes. Sem separar carregar de processar, "roda em 46s de um teto de
          60" não diz o que apertar: dividir os agentes entre invocações só
          ajuda se o gargalo for eles — se for o carregamento, cada invocação
          recarregaria o contexto inteiro e o custo total subiria. */}
      {medicao && (
        <Secao titulo="Custo da última auditoria">
          <Tabela
            colunas={["Etapa", "Tempo", "O que significa"]}
            alinharDireita={[1]}
            vazio="Sem medição."
            linhas={[
              [
                "Carregar o contexto",
                medicao.msContexto === null ? "—" : `${(medicao.msContexto / 1000).toFixed(1)}s`,
                "Ler do banco os títulos, baixas, notas e parceiros da janela",
              ],
              [
                "Rodar os agentes",
                medicao.msAgentes === null ? "—" : `${(medicao.msAgentes / 1000).toFixed(1)}s`,
                "Cruzar registro a registro e emitir os achados",
              ],
              [
                <strong key="t">Total</strong>,
                <strong key="tv">
                  {medicao.msTotal === null ? "—" : `${(medicao.msTotal / 1000).toFixed(1)}s`}
                </strong>,
                <strong key="td">Teto da função: 60s</strong>,
              ],
            ]}
          />
          <p className="mt-3 text-xs text-slate-500">
            Volume da janela: {fmtNumero(medicao.titulos ?? 0)} títulos, {fmtNumero(medicao.baixas ?? 0)} baixas,{" "}
            {fmtNumero(medicao.notas ?? 0)} notas, {fmtNumero(medicao.parceiros ?? 0)} parceiros
            {medicao.janelaDesde ? ` — desde ${medicao.janelaDesde}` : ""}.
          </p>
          {medicao.msTotal !== null && medicao.msTotal > 40_000 && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
              <strong>Acima de 40s.</strong> A base cresce cerca de 2.400 títulos por mês, e esta fase estoura o teto
              antes de o ano virar. A medição acima diz qual metade apertar — e a fase adiada é registrada em vez de
              morrer com a função, então um estouro atrasa a auditoria de um dia, não a perde.
            </p>
          )}
        </Secao>
      )}

      <Secao
        titulo="Falhas de tela registradas"
        descricao={
          falhas.length > 0 && falhas.every((f) => falhaDeVersaoAnterior(f) === true)
            ? "Todas as falhas listadas são de versões anteriores — nenhuma delas foi causada pelo código que está no ar agora."
            : undefined
        }
      >
        <Tabela
          colunas={["Quando", "Versão", "Tela", "Identificador", "O que aconteceu"]}
          vazio="Nenhuma falha registrada nos últimos 30 dias."
          linhas={falhas.map((f) => [
            fmtDataHora(f.criadoEm),
            // A COLUNA QUE FALTAVA. Sem ela, o painel mostrava um erro já
            // corrigido do mesmo jeito que mostraria um acontecendo agora — e
            // quem lê não tem como saber, a não ser comparando de cabeça o
            // horário do registro com o da última publicação.
            (() => {
              const anterior = falhaDeVersaoAnterior(f);
              if (anterior === null) {
                return (
                  <span key="v" className="text-xs text-slate-400">
                    —
                  </span>
                );
              }
              return anterior ? (
                <span key="v" className={`${badgeClass} bg-slate-100 text-slate-600`}>
                  versão anterior
                </span>
              ) : (
                <span key="v" className={`${badgeClass} bg-red-100 text-red-700`}>
                  versão no ar
                </span>
              );
            })(),
            f.rota ?? "—",
            <span key="d" className="font-mono text-xs">
              {f.digest ?? "—"}
            </span>,
            <span key="m">
              {f.mensagem}
              {f.pilha && (
                <span className="mt-1 block whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-500">
                  {f.pilha.split("\n").slice(0, 3).join("\n")}
                </span>
              )}
            </span>,
          ])}
        />
        <p className="mt-3 text-xs text-slate-500">
          <strong>Versão anterior</strong> quer dizer que a falha foi gravada por uma publicação que não está mais no
          ar: o código que a causou já foi substituído. <strong>Versão no ar</strong> é o que exige olhar hoje. Só
          falhas de servidor, e só dos últimos 30 dias — isto é dado de diagnóstico, não histórico. A mensagem passa por
          redação antes de ser gravada: string de conexão, chave de API e token são apagados, porque uma exceção de
          servidor carrega essas coisas e esta tela não é lugar para elas.
        </p>
      </Secao>
    </div>
  );
}
