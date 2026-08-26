import { prisma } from "@/lib/prisma";
import { listarPessoas } from "@/lib/gestao/leitura";
import { modoDaConexaoGestao } from "@/lib/gestao/cliente";
import { rotuloPapel } from "@/lib/permissions";
import { PERMISSOES, resolverAcesso } from "@/lib/acessos";
import { fmtNumero } from "@/lib/controladoria/format";
import { larguraPainel } from "@/lib/ui";
import { AvisoVazio, Kpi, Secao, Tabela } from "../_componentes";
import { exigirPermissao } from "../_dados";
import NovoUsuario from "./NovoUsuario";
import AtribuirPerfil from "./AtribuirPerfil";
import PerfilForm from "./PerfilForm";

// USUÁRIOS E PERFIS DE ACESSO.
//
// Duas colunas desta tela respondem à pergunta que motivou construí-la — "quem
// enxerga o financeiro do grupo, e por quê". A segunda metade dessa pergunta é
// a que faltava: até agora o acesso vinha inteiro do PAPEL cadastrado na
// gestão, e papel de frota não sabe dizer "vê o DRE mas não trata achado".
//
// A identidade continua sendo da gestão, de propósito. Criar usuário aqui
// escreve LÁ, no mesmo cadastro do login da frota — porque com dois cadastros,
// desligar alguém passaria a depender de alguém lembrar de repetir a operação
// nos dois lugares, e o dia do esquecimento é o dia em que um ex-funcionário
// continua enxergando o caixa do grupo.
//
// O que mora aqui é só a AUTORIZAÇÃO: os perfis, e quem está em cada um.

export default async function UsuariosPage() {
  // Gerir acesso é a permissão que concede todas as outras — inclusive a de
  // conceder acesso. Quem chega aqui sem ela sai antes de ler qualquer nome.
  const session = await exigirPermissao("gerir-usuarios");

  const [resultado, perfis, atribuicoes] = await Promise.all([
    listarPessoas(session.companyId),
    prisma.perfilAcesso.findMany({
      where: { companyId: session.companyId },
      orderBy: [{ padrao: "desc" }, { nome: "asc" }],
      include: { _count: { select: { usuarios: true } } },
    }),
    prisma.usuarioPerfil.findMany({
      where: { companyId: session.companyId },
      select: { userId: true, perfilId: true, atribuidoPor: true },
    }),
  ]);

  const perfilPorUsuario = new Map(atribuicoes.map((a) => [a.userId, a]));
  const perfilPorId = new Map(perfis.map((p) => [p.id, p]));
  const perfilPadrao = perfis.find((p) => p.padrao) ?? null;

  const pessoas = resultado.situacao === "ok" ? resultado.pessoas : [];
  const linhas = pessoas.map((p) => {
    const atribuido = perfilPorUsuario.get(p.id);
    const perfil = atribuido ? (perfilPorId.get(atribuido.perfilId) ?? null) : perfilPadrao;
    const resolvido = resolverAcesso(p.role, perfil);
    return { pessoa: p, perfilId: atribuido?.perfilId ?? "", herdado: !atribuido && !!perfil, resolvido };
  });

  const comAcesso = linhas.filter((l) => l.resolvido.permissoes.size > 0);
  const opcoes = perfis.map((p) => ({ id: p.id, nome: p.nome }));

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Usuários e perfis de acesso</h1>
        <p className="mt-1 text-sm text-slate-500">
          Quem entra no financeiro do grupo, e com qual recorte. O cadastro da pessoa é o mesmo do sistema de gestão —
          desligar alguém lá tira o acesso aqui no mesmo ato. O perfil, que define as telas e as ações, é definido nesta
          tela.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Kpi rotulo="Pessoas no cadastro" valor={fmtNumero(pessoas.length)} />
        <Kpi
          rotulo="Com acesso à Controladoria"
          valor={fmtNumero(comAcesso.length)}
          apoio={`${fmtNumero(comAcesso.filter((l) => l.resolvido.origem === "perfil").length)} por perfil`}
        />
        <Kpi rotulo="Perfis definidos" valor={fmtNumero(perfis.length)} tom={perfis.length === 0 ? "atencao" : "neutro"} />
      </div>

      {resultado.situacao === "indisponivel" && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm font-semibold text-red-900">Não consegui ler o cadastro de usuários da gestão</p>
          <p className="mt-1 text-xs text-red-800">
            Os perfis abaixo continuam valendo — o que não dá para mostrar agora é quem está em cada um. Erro:{" "}
            {resultado.erro.slice(0, 200)}
          </p>
        </div>
      )}

      {perfis.length === 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-900">Nenhum perfil definido ainda</p>
          <p className="mt-1 text-xs text-amber-800">
            Enquanto não houver perfil, o acesso de todo mundo continua vindo do papel cadastrado na gestão — exatamente
            como era antes desta tela existir. Criar um perfil não muda nada para quem não for atribuído a ele.
          </p>
        </div>
      )}

      <Secao
        titulo="Pessoas"
        descricao="A coluna Acesso diz de onde vem a autorização de cada uma: do perfil atribuído ou das regras do papel."
      >
        {linhas.length === 0 ? (
          <AvisoVazio
            titulo="Nenhuma pessoa no cadastro desta empresa"
            descricao="Cadastre a primeira em 'Novo usuário', logo abaixo — ou pelo próprio sistema de gestão, que é o mesmo cadastro."
          />
        ) : (
          <Tabela
            colunas={["Pessoa", "Papel na gestão", "Perfil", "Acesso", "Telas e ações"]}
            alinharDireita={[4]}
            linhas={linhas.map((l) => [
              <span key="n">
                <span className="font-medium text-slate-800">{l.pessoa.name}</span>
                <span className="block text-xs text-slate-500">{l.pessoa.email}</span>
                {!l.pessoa.active && (
                  <span className="mt-0.5 inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                    desativado na gestão
                  </span>
                )}
              </span>,
              <span key="p" className="text-xs text-slate-600">
                {rotuloPapel(l.pessoa.role)}
              </span>,
              <AtribuirPerfil
                key="a"
                userId={l.pessoa.id}
                userNome={l.pessoa.name}
                perfilId={l.perfilId}
                perfis={opcoes}
                herdado={l.herdado ? (perfilPadrao?.nome ?? null) : null}
              />,
              <span key="o" className="text-xs">
                {l.resolvido.permissoes.size === 0 ? (
                  <span className="font-medium text-slate-500">sem acesso ao financeiro</span>
                ) : l.resolvido.origem === "perfil" ? (
                  <span className="font-medium text-blue-700">perfil {l.resolvido.perfilNome}</span>
                ) : (
                  <span className="font-medium text-slate-600">regras do papel</span>
                )}
              </span>,
              <span key="q" className="text-xs tabular-nums text-slate-600">
                {l.resolvido.permissoes.size === 0 ? "—" : `${l.resolvido.permissoes.size} de ${PERMISSOES.length}`}
              </span>,
            ])}
          />
        )}
      </Secao>

      <Secao
        titulo="Novo usuário"
        descricao="O cadastro é criado no sistema de gestão, com o mesmo login da frota. É a mesma senha para as duas aplicações — e um desligamento só."
      >
        <NovoUsuario perfis={opcoes} conexaoSeparada={modoDaConexaoGestao() === "separado"} />
      </Secao>

      <Secao
        titulo="Perfis de acesso"
        descricao="Cada perfil é um recorte de telas e ações. Ver e poder mudar são permissões separadas de propósito: num sistema de auditoria, dar leitura a alguém não pode dar junto o poder de desligar o alerta que incomoda."
      >
        <div className="space-y-4">
          {perfis.map((p) => (
            <PerfilForm
              key={p.id}
              perfil={{
                id: p.id,
                nome: p.nome,
                descricao: p.descricao ?? "",
                permissoes: p.permissoes,
                padrao: p.padrao,
                usuarios: p._count.usuarios,
              }}
            />
          ))}
          <PerfilForm />
        </div>
      </Secao>

      <Secao titulo="Como o acesso é decidido">
        <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-600">
          <li>
            <strong>Papel sem acesso vence qualquer perfil.</strong> Quem é <em>Folha</em> ou <em>Motorista</em> na
            gestão não entra na Controladoria, e um perfil generoso não abre essa porta. Quem administra pessoas é a
            gestão, e a decisão de lá sobre quem é do financeiro continua valendo aqui.
          </li>
          <li>
            <strong>Sem perfil atribuído, valem as regras do papel</strong> — as mesmas de sempre. Ninguém ganhou nem
            perdeu acesso no dia em que esta tela subiu; o que passou a existir é a possibilidade de ajustar.
          </li>
          <li>
            <strong>Um perfil pode ser o padrão da empresa</strong>, e aí passa a valer para quem não tiver perfil
            próprio. Só um por empresa: dois marcados fariam a resolução depender da ordem que o banco devolvesse.
          </li>
          <li>
            <strong>Desativar na gestão corta o acesso na hora</strong>, inclusive de sessão já aberta — a sessão é
            reconferida no cadastro a cada requisição. Remover o perfil aqui não desliga ninguém: devolve a pessoa às
            regras do papel.
          </li>
        </ul>
      </Secao>
    </div>
  );
}
