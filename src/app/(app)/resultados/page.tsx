import { prisma } from "@/lib/prisma";
import { fmtBRL, fmtNumero, fmtPercent } from "@/lib/controladoria/format";
import { serieMensal } from "@/lib/controladoria/serieMensal";
import { dataReferenciaPadrao } from "@/lib/controladoria/ciclo";
import { inicioDoDia } from "@/lib/controladoria/periodos";
import PageHeader from "@/components/ui/PageHeader";
import { resolverEscopo, sessaoControladoria } from "../_dados";
import { Kpi, Secao, Tabela } from "../_componentes";
import Filtros from "../Filtros";

// RESULTADO MÊS A MÊS — a tela que responde "como estamos indo ao longo do ano".
//
// O painel responde "como está hoje" e a competência escolhida responde "como
// foi naquele mês". Faltava a pergunta que fica entre as duas: a evolução, e o
// acumulado que ela produz. Sem isso, comparar março com abril exigia abrir o
// painel duas vezes e anotar num papel.
//
// Esta tela NÃO carrega o contexto de auditoria. Ela soma no banco e recebe uma
// linha por mês — alguns kilobytes contra os mais de trinta megabytes que o
// painel move a cada abertura. É o mesmo remédio já aplicado na tela de
// sincronização, e o motivo é o mesmo: foi esse padrão que esgotou a franquia
// de transferência do banco e derrubou os dois sistemas.

export default async function ResultadosPage({
  searchParams,
}: {
  searchParams: Promise<{ empresa?: string }>;
}) {
  const session = await sessaoControladoria();
  const escopo = await resolverEscopo(session.companyId, (await searchParams).empresa);

  const [config, conexoes] = await Promise.all([
    prisma.controladoriaConfig.findUnique({
      where: { companyId: session.companyId },
      select: { dataInicioBase: true },
    }),
    prisma.omieConexao.findMany({
      where: { companyId: session.companyId, ativa: true },
      orderBy: { ordem: "asc" },
      select: { id: true, apelido: true, nome: true },
    }),
  ]);

  const ate = dataReferenciaPadrao();
  const desde = inicioDoDia(config?.dataInicioBase ?? new Date(ate.getFullYear() - 1, 0, 1));

  const serie = await serieMensal({
    companyId: session.companyId,
    conexaoId: escopo.conexaoId,
    desde,
    ate,
  });

  // Do mais recente para o mais antigo: quem abre esta tela quer o mês passado,
  // não janeiro do ano retrasado.
  const linhas = [...serie].reverse();
  const ultimoAno = linhas[0]?.competencia.slice(0, 4) ?? "";
  const fechamentoDoAno = linhas.find((m) => m.competencia.startsWith(ultimoAno));

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title="Resultado mês a mês"
        subtitle="Competência pela data de vencimento do título, como no painel e no relatório. O acumulado zera em janeiro, como em qualquer DRE gerencial."
      />

      <Filtros
        conexoes={conexoes}
        empresaAtiva={escopo.conexaoId}
        competencias={[]}
        competenciaAtiva={null}
        rota="/resultados"
      />

      {fechamentoDoAno && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi rotulo={`Receita acumulada ${ultimoAno}`} valor={fmtBRL(fechamentoDoAno.receitaAcumuladaCents)} />
          <Kpi rotulo={`Despesa acumulada ${ultimoAno}`} valor={fmtBRL(fechamentoDoAno.despesaAcumuladaCents)} />
          <Kpi
            rotulo={`Resultado acumulado ${ultimoAno}`}
            valor={fmtBRL(fechamentoDoAno.resultadoAcumuladoCents)}
            tom={fechamentoDoAno.resultadoAcumuladoCents >= 0 ? "bom" : "ruim"}
          />
          <Kpi
            rotulo="Margem acumulada"
            valor={fmtPercent(
              fechamentoDoAno.receitaAcumuladaCents > 0
                ? (fechamentoDoAno.resultadoAcumuladoCents / fechamentoDoAno.receitaAcumuladaCents) * 100
                : 0
            )}
            tom={fechamentoDoAno.resultadoAcumuladoCents >= 0 ? "bom" : "ruim"}
          />
        </div>
      )}

      <Secao
        titulo="Competência — o mês em que o resultado foi gerado"
        descricao="Receita e despesa pelo vencimento dos títulos, independentemente de terem sido pagos. Responde 'a operação deu lucro no mês?'."
      >
        <Tabela
          colunas={["Mês", "Receita", "Despesa", "Resultado", "Margem", "Acum. receita", "Acum. despesa", "Acum. resultado"]}
          alinharDireita={[1, 2, 3, 4, 5, 6, 7]}
          linhas={linhas.map((m) => [
            m.rotulo,
            fmtBRL(m.receitaCents),
            fmtBRL(m.despesaCents),
            fmtBRL(m.resultadoCents),
            m.margemPercent === null ? "—" : fmtPercent(m.margemPercent),
            fmtBRL(m.receitaAcumuladaCents),
            fmtBRL(m.despesaAcumuladaCents),
            fmtBRL(m.resultadoAcumuladoCents),
          ])}
        />
      </Secao>

      <Secao
        titulo="Caixa — o mês em que o dinheiro entrou e saiu"
        descricao="Pelas baixas efetivamente registradas. Responde 'sobrou dinheiro na conta?'. Os dois regimes ficam separados de propósito: misturá-los é o erro mais comum de relatório gerencial, e o sintoma é o mês fechar no azul no resultado e no vermelho no banco."
      >
        <Tabela
          colunas={["Mês", "Recebido", "Pago", "Fluxo líquido", "Títulos a receber", "Títulos a pagar"]}
          alinharDireita={[1, 2, 3, 4, 5]}
          linhas={linhas.map((m) => [
            m.rotulo,
            fmtBRL(m.recebidoCents),
            fmtBRL(m.pagoCents),
            fmtBRL(m.fluxoLiquidoCents),
            fmtNumero(m.titulosReceber),
            fmtNumero(m.titulosPagar),
          ])}
        />
      </Secao>
    </div>
  );
}
