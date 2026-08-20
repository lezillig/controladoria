import { prisma } from "@/lib/prisma";
import { canManageControladoria } from "@/lib/permissions";
import { isEnvioDisponivel } from "@/lib/email/send";
import { dataReferenciaPadrao } from "@/lib/controladoria/ciclo";
import { garantirConfig, destinatarios } from "@/lib/controladoria/contexto";
import { fmtBRL, fmtData, fmtNumero } from "@/lib/controladoria/format";
import { sessaoControladoria } from "../_dados";
import { AvisoVazio, Kpi, Secao, Tabela } from "../_componentes";
import GerarRelatorioForm from "./GerarRelatorioForm";

// HISTÓRICO DE RELATÓRIOS.
//
// O HTML de cada relatório fica guardado inteiro (ver RelatorioDiario no
// schema): o relatório é uma peça de controladoria com data — o que se sabia
// naquele dia, com os números daquele dia. Reconstruí-lo depois a partir da
// base atual daria outro documento e perderia justamente o valor de trilha.

type ResumoGravado = {
  receitaMes?: number;
  resultadoMes?: number;
  saldoCaixa?: number;
  economiaIdentificada?: number;
  qualidadeBase?: number;
};

export default async function RelatoriosPage() {
  const session = await sessaoControladoria();
  const podeGerar = canManageControladoria(session.role);
  const config = await garantirConfig(session.companyId);

  const relatorios = await prisma.relatorioDiario.findMany({
    where: { companyId: session.companyId },
    orderBy: { dataReferencia: "desc" },
    take: 60,
    select: {
      id: true,
      dataReferencia: true,
      geradoEm: true,
      enviadoEm: true,
      status: true,
      destinatarios: true,
      achadosTotal: true,
      achadosCriticos: true,
      erro: true,
      resumo: true,
    },
  });

  const enviados = relatorios.filter((r) => r.status === "ENVIADO").length;
  const comErro = relatorios.filter((r) => r.status === "ERRO_ENVIO").length;
  const dataPadrao = dataReferenciaPadrao().toISOString().slice(0, 10);

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Relatórios diários</h1>
        <p className="mt-1 text-sm text-slate-500">
          Gerado e enviado automaticamente todo dia de madrugada, com os dados de D-1. Cada relatório fica guardado
          exatamente como foi enviado.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Kpi rotulo="Relatórios guardados" valor={fmtNumero(relatorios.length)} apoio="Últimos 60" />
        <Kpi rotulo="Enviados" valor={fmtNumero(enviados)} tom={enviados > 0 ? "bom" : "neutro"} />
        <Kpi rotulo="Falhas de envio" valor={fmtNumero(comErro)} tom={comErro > 0 ? "ruim" : "bom"} />
      </div>

      <Secao
        titulo="Destinatários"
        descricao="Definidos em Controladoria → Modelo de gestão. O relatório abre no computador e no celular."
      >
        <div className="flex flex-wrap gap-2">
          {destinatarios(config).map((e) => (
            <span key={e} className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700">
              {e}
            </span>
          ))}
          {destinatarios(config).length === 0 && (
            <p className="text-sm text-amber-700">Nenhum destinatário configurado — o relatório é gerado, mas não enviado.</p>
          )}
        </div>
        {!isEnvioDisponivel() && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Envio de e-mail ainda não ativado (falta a variável <code className="font-mono">RESEND_API_KEY</code>). Os
            relatórios continuam sendo gerados todos os dias e ficam disponíveis aqui, com o mesmo conteúdo que será
            enviado quando o e-mail for ligado — basta clicar em <strong>abrir</strong> na lista abaixo.
          </p>
        )}
      </Secao>

      {podeGerar && (
        <Secao titulo="Gerar agora" descricao="Para reenviar um dia que falhou ou preparar um relatório de data específica.">
          <GerarRelatorioForm dataPadrao={dataPadrao} envioConfigurado={isEnvioDisponivel()} />
        </Secao>
      )}

      <Secao titulo="Histórico">
        {relatorios.length === 0 ? (
          <AvisoVazio
            titulo="Nenhum relatório gerado ainda"
            descricao="O primeiro sai automaticamente na madrugada seguinte à primeira sincronização — ou você pode gerar um agora."
          />
        ) : (
          <Tabela
            colunas={["Data", "Resultado do mês", "Achados", "Situação", "Ver"]}
            alinharDireita={[1, 2]}
            linhas={relatorios.map((r) => {
              const resumo = (r.resumo ?? {}) as ResumoGravado;
              return [
                <span key="d">
                  <span className="font-medium text-slate-800">{fmtData(r.dataReferencia)}</span>
                  <span className="block text-xs text-slate-400">gerado em {fmtData(r.geradoEm)}</span>
                </span>,
                <span key="r" className="text-xs">
                  {resumo.resultadoMes !== undefined ? fmtBRL(resumo.resultadoMes) : "—"}
                  {resumo.saldoCaixa !== undefined && (
                    <span className="block text-slate-400">caixa {fmtBRL(resumo.saldoCaixa)}</span>
                  )}
                </span>,
                <span key="a" className="text-xs">
                  {fmtNumero(r.achadosTotal)}
                  {r.achadosCriticos > 0 && (
                    <span className="block font-medium text-red-600">{fmtNumero(r.achadosCriticos)} crítico(s)</span>
                  )}
                </span>,
                <span key="s" className="text-xs">
                  <span
                    className={
                      r.status === "ENVIADO"
                        ? "font-medium text-emerald-700"
                        : r.status === "ERRO_ENVIO"
                          ? "font-medium text-red-700"
                          : "font-medium text-slate-600"
                    }
                  >
                    {r.status === "ENVIADO" ? `Enviado ${fmtData(r.enviadoEm)}` : r.status === "ERRO_ENVIO" ? "Falha no envio" : "Gerado"}
                  </span>
                  {r.erro && <span className="mt-0.5 block max-w-xs text-slate-500">{r.erro.slice(0, 120)}</span>}
                </span>,
                <a
                  key="v"
                  href={`/api/relatorio/${r.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-blue-700 hover:underline"
                >
                  abrir
                </a>,
              ];
            })}
          />
        )}
      </Secao>
    </div>
  );
}
