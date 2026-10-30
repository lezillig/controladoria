import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatarCnpj } from "@/lib/cadastro/normalizacao";
import { fmtData, fmtNumero } from "@/lib/controladoria/format";
import { larguraPainel } from "@/lib/ui";
import { exigirPermissao, podeAcao } from "../_dados";
import { Kpi, Secao, Tabela } from "../_componentes";
import AtualizarCadastro from "./AtualizarCadastro";

// CADASTRO MESTRE — a fonte única de veículo, cliente, fornecedor e centro de
// custo da plataforma (docs/plataforma/specs/01-cadastro-mestre.md). Pessoas
// ficam em /cadastro/pessoas, com permissão própria.

export const maxDuration = 60;

const ABAS = [
  { chave: "veiculos", rotulo: "Veículos" },
  { chave: "clientes", rotulo: "Clientes" },
  { chave: "fornecedores", rotulo: "Fornecedores" },
  { chave: "centros", rotulo: "Centros de custo" },
] as const;
const LIMITE = 300;
const ROTULO_TIPO: Record<string, string> = { van: "Van", micro: "Micro-ônibus", onibus: "Ônibus", outro: "Sem tipo" };

export default async function CadastroPage({ searchParams }: { searchParams: Promise<{ aba?: string; q?: string }> }) {
  const params = await searchParams;
  const session = await exigirPermissao("cadastro");
  const podeAtualizar = await podeAcao(session, "gerir-cadastro");
  const companyId = session.companyId;
  const aba = ABAS.find((a) => a.chave === params.aba)?.chave ?? "veiculos";
  const q = (params.q ?? "").trim();
  const busca = q ? { contains: q, mode: "insensitive" as const } : undefined;

  const [veiculos, totalCli, totalForn, totalCentros, semOmie, financiamentos, pessoasAtivas] = await Promise.all([
    prisma.cadVeiculo.findMany({ where: { companyId }, select: { status: true, tipo: true, anoFab: true } }),
    prisma.cadCliente.count({ where: { companyId, ativo: true } }),
    prisma.cadFornecedor.count({ where: { companyId, ativo: true } }),
    prisma.cadCentroCusto.count({ where: { companyId, ativo: true } }),
    prisma.cadCentroCusto.count({ where: { companyId, ativo: true, idsOmie: { equals: {} } } }),
    prisma.frotaFinanciamento.count({ where: { companyId, ativo: true } }),
    prisma.cadPessoa.count({ where: { companyId, ativo: true } }),
  ]);
  const naFrota = veiculos.filter((v) => v.status !== "vendido" && v.status !== "baixado");
  const anoAtual = new Date().getFullYear();
  const idades = naFrota.filter((v) => v.anoFab).map((v) => anoAtual - (v.anoFab as number));
  const idadeMedia = idades.length ? idades.reduce((s, x) => s + x, 0) / idades.length : null;

  // FROTA POR TIPO × SITUAÇÃO, com a idade média (relatório da spec 01).
  const tipos = [...new Set(veiculos.map((v) => v.tipo))].sort();
  const situacoes = ["ativo", "manutencao", "reserva", "vendido", "baixado"];
  const porTipo = tipos.map((t) => {
    const doTipo = veiculos.filter((v) => v.tipo === t);
    const anos = doTipo.filter((v) => v.anoFab && v.status !== "vendido" && v.status !== "baixado").map((v) => anoAtual - (v.anoFab as number));
    return [ROTULO_TIPO[t] ?? t, ...situacoes.map((s) => fmtNumero(doTipo.filter((v) => v.status === s).length)), anos.length ? `${fmtNumero(anos.reduce((a, b) => a + b, 0) / anos.length, 1)} anos` : "—"];
  });

  const lista = await (async () => {
    if (aba === "veiculos") {
      const linhas = await prisma.cadVeiculo.findMany({
        where: { companyId, ...(busca ? { OR: [{ placa: busca }, { modelo: busca }, { marca: busca }] } : {}) },
        orderBy: [{ status: "asc" }, { placa: "asc" }],
        take: LIMITE,
        include: { _count: { select: { financiamentos: true } } },
      });
      return {
        colunas: ["Placa", "Tipo", "Marca / modelo", "Ano", "Capacidade", "Uso", "Empresa", "Situação", "Financiamentos", "Fontes"],
        linhas: linhas.map((v) => [
          <span key="p" className="font-mono">{v.placa}</span>,
          ROTULO_TIPO[v.tipo] ?? v.tipo,
          [v.marca, v.modelo].filter(Boolean).join(" ") || "—",
          v.anoFab ? `${v.anoFab}${v.anoMod && v.anoMod !== v.anoFab ? `/${v.anoMod}` : ""}` : "—",
          v.capacidade ?? "—",
          v.categoriaUso ?? "—",
          v.empresa ?? "—",
          v.status,
          v._count.financiamentos || "—",
          Object.keys((v.origens as Record<string, string>) ?? {}).join(", ") || "—",
        ]),
      };
    }
    if (aba === "clientes" || aba === "fornecedores") {
      const onde = { companyId, ...(busca ? { OR: [{ razaoSocial: busca }, { nomeFantasia: busca }, { cnpj: { contains: q.replace(/\D/g, "") || q } }] } : {}) };
      const linhas = aba === "clientes"
        ? await prisma.cadCliente.findMany({ where: onde, orderBy: { razaoSocial: "asc" }, take: LIMITE })
        : await prisma.cadFornecedor.findMany({ where: onde, orderBy: { razaoSocial: "asc" }, take: LIMITE });
      return {
        colunas: ["CNPJ", "Razão social", "Nome fantasia", aba === "clientes" ? "Tipo" : "Categoria", "Códigos na Omie", "Situação"],
        linhas: linhas.map((c) => [
          <span key="c" className="font-mono text-xs">{formatarCnpj(c.cnpj)}</span>,
          c.razaoSocial,
          c.nomeFantasia ?? "—",
          ("tipo" in c ? c.tipo : c.categoria) ?? "—",
          Object.entries((c.idsOmie as Record<string, string>) ?? {}).map(([k, v]) => `${k} ${v}`).join(" · ") || "—",
          c.ativo ? "ativo" : "inativo",
        ]),
      };
    }
    const linhas = await prisma.cadCentroCusto.findMany({
      where: { companyId, ...(busca ? { codigo: busca } : {}) },
      orderBy: { codigo: "asc" },
      take: LIMITE,
      include: { veiculo: { select: { modelo: true, status: true } }, contrato: { select: { numeroContrato: true } } },
    });
    return {
      colunas: ["Código", "Tipo", "Referência", "Na Omie", "Desde"],
      linhas: linhas.map((c) => [
        <span key="c" className="font-mono">{c.codigo}</span>,
        c.tipo,
        c.veiculo ? `${c.veiculo.modelo ?? "veículo"} (${c.veiculo.status})` : c.contrato ? `contrato ${c.contrato.numeroContrato}` : "—",
        Object.entries((c.idsOmie as Record<string, string>) ?? {}).map(([k, v]) => `${k} ${v}`).join(" · ") || <span key="o" className="text-amber-700">ainda não</span>,
        fmtData(c.criadoEm),
      ]),
    };
  })();
  const href = (a: string) => `/cadastro?aba=${a}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Cadastro mestre</h1>
        <p className="mt-1 max-w-4xl text-sm text-slate-500">
          A fonte única de veículo, pessoa, cliente, fornecedor e centro de custo da plataforma: os outros módulos apontam para cá, pela placa, pelo CPF e pelo CNPJ, em vez de repetir nome em
          texto livre. Nada é apagado (veículo vendido fica como vendido), e toda mudança vai para a trilha de auditoria.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi rotulo="Veículos na frota" valor={fmtNumero(naFrota.length)} apoio={`${fmtNumero(veiculos.length - naFrota.length)} vendido(s) ou baixado(s)`} />
        <Kpi rotulo="Idade média da frota" valor={idadeMedia === null ? "—" : `${fmtNumero(idadeMedia, 1)} anos`} apoio={`${fmtNumero(idades.length)} com ano de fabricação`} />
        <Kpi rotulo="Pessoas ativas" valor={fmtNumero(pessoasAtivas)} />
        <Kpi rotulo="Clientes" valor={fmtNumero(totalCli)} />
        <Kpi rotulo="Fornecedores" valor={fmtNumero(totalForn)} />
        <Kpi rotulo="Centros de custo" valor={fmtNumero(totalCentros)} apoio={semOmie ? `${fmtNumero(semOmie)} ainda sem código na Omie` : "todos com código na Omie"} tom={semOmie ? "atencao" : "bom"} />
      </div>

      {podeAtualizar && (
        <Secao titulo="Atualizar a partir das fontes" descricao="Fontes já ligadas: parceiros da Omie (as duas empresas), motoristas e veículos da gestão. As planilhas CONTROLE INFORMAÇÕES GERAIS e Consórcios e Financiamentos e a Ituran entram por importadores próprios, na sequência da Fase 0.">
          <AtualizarCadastro />
        </Secao>
      )}

      {veiculos.length > 0 && (
        <Secao titulo="Frota por tipo e situação" descricao={`Idade média pelos veículos na frota com ano de fabricação. ${fmtNumero(financiamentos)} financiamento(s) ativo(s) cadastrado(s).`}>
          <Tabela colunas={["Tipo", "Ativo", "Manutenção", "Reserva", "Vendido", "Baixado", "Idade média"]} alinharDireita={[1, 2, 3, 4, 5, 6]} linhas={porTipo} />
        </Secao>
      )}

      <Secao
        titulo={ABAS.find((a) => a.chave === aba)!.rotulo}
        descricao={`Até ${LIMITE} registros; use a busca para achar os demais.`}
        acao={
          <form className="flex gap-2" action="/cadastro">
            <input type="hidden" name="aba" value={aba} />
            <input name="q" defaultValue={q} placeholder="Buscar…" className="rounded-md border border-slate-300 px-2 py-1 text-xs" />
          </form>
        }
      >
        <div className="mb-3 flex flex-wrap gap-1.5">
          {ABAS.map((a) => (
            <Link key={a.chave} href={href(a.chave)} className={`rounded-full px-3 py-1 text-xs font-medium ${a.chave === aba ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
              {a.rotulo}
            </Link>
          ))}
        </div>
        <Tabela colunas={lista.colunas} linhas={lista.linhas} vazio={podeAtualizar ? "Nada cadastrado ainda — use “Atualizar o cadastro a partir das fontes”." : "Nada cadastrado ainda."} />
      </Secao>
    </div>
  );
}
