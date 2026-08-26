import { prisma } from "@/lib/prisma";
import { credencialConfigurada, nomesDasVariaveis } from "@/lib/omie/client";
import { fmtData, fmtDocumento, fmtNumero } from "@/lib/controladoria/format";
import { AvisoVazio, Kpi, Secao, Tabela } from "../_componentes";
import ConexaoForm from "./ConexaoForm";
import TesteConexao from "./TesteConexao";
import { alternarConexao } from "./actions";
import { exigirPermissao, podeAcao } from "../_dados";
import { larguraPainel } from "@/lib/ui";

// CONEXÕES OMIE — uma por CNPJ do grupo.
//
// Existe porque o grupo opera com mais de uma empresa, cada uma com sua conta
// na Omie. Não é só configuração: cada conta tem numeração de lançamento
// própria, e o sistema precisa saber de qual empresa veio cada título para não
// sobrescrever um com o outro — e para conseguir dizer, no relatório, se o
// problema é da Azul ou da MCZ.

export default async function ConexoesPage() {
  const session = await exigirPermissao("conexoes");
  const podeEditar = await podeAcao(session, "gerir-conexoes");

  const conexoes = await prisma.omieConexao.findMany({
    where: { companyId: session.companyId },
    orderBy: { ordem: "asc" },
  });

  const volumes = await prisma.omieTitulo.groupBy({
    by: ["conexaoId"],
    where: { companyId: session.companyId },
    _count: true,
  });
  const volumePorConexao = new Map(volumes.map((v) => [v.conexaoId, v._count]));

  const ultimosSyncs = await prisma.omieSyncRun.findMany({
    where: { companyId: session.companyId, status: "CONCLUIDO", backfill: false, conexaoId: { not: null } },
    orderBy: { finalizadoEm: "desc" },
    take: 20,
    select: { conexaoId: true, finalizadoEm: true },
  });
  const ultimoPorConexao = new Map<string, Date>();
  for (const s of ultimosSyncs) {
    if (s.conexaoId && s.finalizadoEm && !ultimoPorConexao.has(s.conexaoId)) {
      ultimoPorConexao.set(s.conexaoId, s.finalizadoEm);
    }
  }

  const semCredencial = conexoes.filter((c) => c.ativa && !credencialConfigurada(c.credencialRef));

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Conexões Omie</h1>
        <p className="mt-1 text-sm text-slate-500">
          Uma conexão por empresa do grupo. Os números aparecem consolidados nas telas e no relatório, sempre com a
          empresa de origem identificada — e dá para filtrar por uma delas quando a pergunta for específica.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Kpi rotulo="Conexões cadastradas" valor={fmtNumero(conexoes.length)} />
        <Kpi rotulo="Ativas" valor={fmtNumero(conexoes.filter((c) => c.ativa).length)} tom="bom" />
        <Kpi
          rotulo="Sem credencial no ambiente"
          valor={fmtNumero(semCredencial.length)}
          tom={semCredencial.length > 0 ? "ruim" : "bom"}
          apoio={semCredencial.length > 0 ? "Ficam fora do ciclo diário" : undefined}
        />
      </div>

      {semCredencial.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm font-semibold text-red-900">
            {semCredencial.length} conexão(ões) ativa(s) sem credencial no ambiente
          </p>
          <p className="mt-1 text-xs text-red-800">
            Cadastre as variáveis abaixo na hospedagem e faça um novo deploy. Enquanto não existirem, essas empresas não
            são sincronizadas — e o relatório sai com o retrato de apenas parte do grupo.
          </p>
          <ul className="mt-2 space-y-1 font-mono text-xs text-red-900">
            {semCredencial.map((c) => {
              const vars = nomesDasVariaveis(c.credencialRef);
              return (
                <li key={c.id}>
                  {vars.chave} · {vars.segredo}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <Secao titulo="Empresas conectadas">
        {conexoes.length === 0 ? (
          <AvisoVazio
            titulo="Nenhuma conexão cadastrada"
            descricao="Cadastre uma conexão por empresa do grupo. Sem pelo menos uma, o ciclo diário não tem o que sincronizar."
          />
        ) : (
          <Tabela
            colunas={["Empresa", "Apelido", "CNPJ", "Credencial", "Títulos", "Última sincronização", ...(podeEditar ? [""] : [])]}
            alinharDireita={[4]}
            linhas={conexoes.map((c) => {
              const vars = nomesDasVariaveis(c.credencialRef);
              const ok = credencialConfigurada(c.credencialRef);
              return [
                <span key="n">
                  <span className="font-medium text-slate-800">{c.nome}</span>
                  {!c.ativa && <span className="block text-xs text-slate-400">inativa</span>}
                </span>,
                <span key="a" className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                  {c.apelido}
                </span>,
                fmtDocumento(c.cnpj),
                <span key="c" className="text-xs">
                  <span className={ok ? "font-medium text-emerald-700" : "font-medium text-red-700"}>
                    {ok ? "configurada" : "ausente"}
                  </span>
                  <span className="block font-mono text-slate-400">{vars.chave}</span>
                </span>,
                fmtNumero(volumePorConexao.get(c.id) ?? 0),
                <span key="s" className="text-xs">
                  {ultimoPorConexao.has(c.id) ? fmtData(ultimoPorConexao.get(c.id)!) : "nunca"}
                </span>,
                ...(podeEditar
                  ? [
                      <div key="acoes" className="flex flex-col gap-2">
                        <ConexaoForm
                          conexao={{
                            id: c.id,
                            nome: c.nome,
                            apelido: c.apelido,
                            cnpj: c.cnpj ?? "",
                            credencialRef: c.credencialRef,
                          }}
                        />
                        <form action={alternarConexao}>
                          <input type="hidden" name="id" value={c.id} />
                          <button type="submit" className="text-xs font-medium text-slate-600 hover:underline">
                            {c.ativa ? "desativar" : "reativar"}
                          </button>
                        </form>
                      </div>,
                    ]
                  : []),
              ];
            })}
          />
        )}
      </Secao>

      {podeEditar && conexoes.some((c) => c.ativa && credencialConfigurada(c.credencialRef)) && (
        <Secao
          titulo="Testar a integração"
          descricao="Consulta cada endpoint da Omie com os mesmos parâmetros que a sincronização usa, sem gravar nada. Descobrir aqui que uma credencial não vale leva trinta segundos; descobrir no ciclo automático leva uma madrugada."
        >
          <ul className="space-y-5">
            {conexoes
              .filter((c) => c.ativa && credencialConfigurada(c.credencialRef))
              .map((c) => (
                <li key={c.id}>
                  <p className="mb-2 text-sm font-medium text-slate-800">
                    {c.apelido} <span className="font-normal text-slate-500">— {c.nome}</span>
                  </p>
                  <TesteConexao conexaoId={c.id} />
                </li>
              ))}
          </ul>
        </Secao>
      )}

      {podeEditar && (
        <Secao
          titulo="Nova conexão"
          descricao="A chave e o segredo da Omie não são digitados aqui: ficam apenas nas variáveis de ambiente da hospedagem."
        >
          <ConexaoForm />
        </Secao>
      )}

      <Secao titulo="Como funciona">
        <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-600">
          <li>
            Cada empresa é sincronizada separadamente, com a própria credencial e o próprio cursor. Uma falha na Azul não
            interrompe o espelho da MCZ.
          </li>
          <li>
            A auditoria roda depois, sobre o <strong>grupo inteiro</strong>. É assim que aparece o que nenhuma das
            empresas veria sozinha: a mesma nota paga pelas duas, o caixa total, a concentração real de um fornecedor.
          </li>
          <li>
            Cada achado guarda de qual empresa veio. O relatório diário pode sair consolidado (padrão) ou um por empresa
            — a escolha está em <strong>Modelo de gestão</strong>.
          </li>
          <li>
            Fornecedores são reconhecidos entre as empresas pelo CNPJ, não pelo código da Omie — que é diferente em cada
            conta. Sem isso, uma nota paga pelas duas passaria despercebida.
          </li>
        </ul>
      </Secao>
    </div>
  );
}
