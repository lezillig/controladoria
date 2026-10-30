import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { alertaDoDocumento, documentosFaltando, TIPO_DOCUMENTO, TIPOS_DOCUMENTO, type Alerta } from "@/lib/frota/documentos";
import { coberturaDeApolice, EM_OPERACAO, ROTULO_COBERTURA, type CoberturaApolice } from "@/lib/frota/controles";
import { ROTULO_IPVA } from "@/lib/cadastro/fichaVeiculo";
import { fmtData, fmtNumero } from "@/lib/controladoria/format";
import { larguraPainel } from "@/lib/ui";
import { exigirPermissao, podeAcao } from "../../_dados";
import FormAcao from "../FormAcao";
import { salvarEmailsFrota } from "../actions";
import { Kpi, Secao, Tabela } from "../../_componentes";
import { NomeVeiculo, SeloAlerta, SeloCobertura } from "../_frota";

// VENCIMENTOS — o que vence e o que já venceu, na frota em operação: os
// documentos e licenças, a cobertura de apólice (todo veículo em operação com
// apólice ativa, do segmento certo) e o IPVA a restituir. Substitui as colunas
// de validade da planilha CONTROLE INFORMAÇÕES GERAIS.

export const maxDuration = 60;

const JANELAS: { chave: string; rotulo: string; alertas: Alerta[] }[] = [
  { chave: "vencidos", rotulo: "Vencidos", alertas: ["vencido"] },
  { chave: "30", rotulo: "Até 30 dias", alertas: ["7", "30"] },
  { chave: "60", rotulo: "31 a 60 dias", alertas: ["60"] },
  { chave: "sem_data", rotulo: "Sem data / preliminar", alertas: ["sem_data"] },
];

export default async function VencimentosPage({ searchParams }: { searchParams: Promise<{ janela?: string; tipo?: string }> }) {
  const params = await searchParams;
  const session = await exigirPermissao("frota");
  const podeEditar = await podeAcao(session, "gerir-frota");
  const hoje = new Date();
  const veiculos = await prisma.cadVeiculo.findMany({
    where: { companyId: session.companyId, status: { in: EM_OPERACAO } },
    include: { documentos: true, apolice: true },
    orderBy: { placa: "asc" },
  });
  const docs = veiculos.flatMap((v) => v.documentos.map((d) => ({ v, d, alerta: alertaDoDocumento(d, hoje) })));
  const janela = JANELAS.find((j) => j.chave === params.janela) ?? JANELAS[0];
  const tipo = TIPO_DOCUMENTO.has(params.tipo ?? "") ? params.tipo : undefined;
  const lista = docs
    .filter((x) => janela.alertas.includes(x.alerta) && (!tipo || x.d.tipo === tipo))
    .sort((a, b) => (a.d.validade?.getTime() ?? 0) - (b.d.validade?.getTime() ?? 0));
  const conta = (alertas: Alerta[]) => docs.filter((x) => alertas.includes(x.alerta)).length;
  const faltando = veiculos.map((v) => ({ v, faltando: documentosFaltando(v, v.documentos) })).filter((x) => x.faltando.length > 0);

  const coberturas = veiculos.map((v) => ({ v, c: coberturaDeApolice(v, v.apolice, hoje) }));
  const semCobertura = coberturas.filter((x) => !["coberto"].includes(x.c));
  const porCobertura = (c: CoberturaApolice) => coberturas.filter((x) => x.c === c).length;
  const apolices = await prisma.frotaApolice.findMany({ where: { companyId: session.companyId }, include: { _count: { select: { veiculos: true } } }, orderBy: { vigenciaFim: "asc" } });
  const emailsFrota = (await prisma.controladoriaConfig.findUnique({ where: { companyId: session.companyId }, select: { emailsFrota: true } }))?.emailsFrota ?? "";
  const ipva = veiculos.filter((v) => v.ipvaSituacao === "isento_falta_restituir" || v.ipvaSituacao === "isento_liberado_restituir" || v.ipvaSituacao === "em_analise");
  const href = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, x] of Object.entries({ janela: janela.chave, tipo, ...extra })) if (x) p.set(k, x);
    return `/frota/vencimentos?${p}`;
  };

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div>
        <Link href="/frota" className="text-xs text-slate-500 hover:text-slate-800">← Frota</Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Vencimentos e apólices</h1>
        <p className="mt-1 max-w-4xl text-sm text-slate-500">
          Os {fmtNumero(veiculos.length)} veículos em operação: documentos e licenças por prazo, a cobertura de apólice e o IPVA a restituir. O agente diário avisa com 60, 30 e 7 dias e abre pendência
          para o que venceu.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi rotulo="Documentos vencidos" valor={fmtNumero(conta(["vencido"]))} tom={conta(["vencido"]) ? "ruim" : "bom"} />
        <Kpi rotulo="Vencem em 30 dias" valor={fmtNumero(conta(["7", "30"]))} tom={conta(["7", "30"]) ? "atencao" : "bom"} />
        <Kpi rotulo="Vencem em 31–60 dias" valor={fmtNumero(conta(["60"]))} />
        <Kpi rotulo="Sem apólice ativa" valor={fmtNumero(porCobertura("sem_apolice") + porCobertura("vencida"))} tom={porCobertura("sem_apolice") + porCobertura("vencida") ? "ruim" : "bom"} apoio={`${porCobertura("vence_em_breve")} vencendo em 45 dias`} />
        <Kpi rotulo="Apólice de outro segmento" valor={fmtNumero(porCobertura("segmento_incompativel"))} tom={porCobertura("segmento_incompativel") ? "atencao" : "bom"} />
        <Kpi rotulo="IPVA a restituir" valor={fmtNumero(veiculos.filter((v) => v.ipvaSituacao === "isento_falta_restituir" || v.ipvaSituacao === "isento_liberado_restituir").length)} apoio={`${veiculos.filter((v) => v.ipvaSituacao === "em_analise").length} em análise`} />
      </div>

      <Secao
        titulo="Documentos e licenças"
        acao={
          <form action="/frota/vencimentos" className="flex gap-2 text-xs">
            <input type="hidden" name="janela" value={janela.chave} />
            <select name="tipo" defaultValue={tipo ?? ""} className="rounded-md border border-slate-300 px-2 py-1">
              <option value="">todos os documentos</option>
              {TIPOS_DOCUMENTO.map((t) => <option key={t.chave} value={t.chave}>{t.rotulo}</option>)}
            </select>
            <button className="rounded-md bg-slate-900 px-2 py-1 font-semibold text-white">Filtrar</button>
          </form>
        }
      >
        <div className="mb-3 flex flex-wrap gap-1.5">
          {JANELAS.map((j) => (
            <Link key={j.chave} href={href({ janela: j.chave })} className={`rounded-full px-3 py-1 text-xs font-medium ${j.chave === janela.chave ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
              {j.rotulo} ({conta(j.alertas)})
            </Link>
          ))}
        </div>
        <Tabela
          colunas={["Placa", "Veículo", "Contrato / alocação", "Documento", "Validade", "Número", "Situação"]}
          linhas={lista.map(({ v, d, alerta }) => [
            <NomeVeiculo key="p" v={v} />,
            [v.marca, v.modelo].filter(Boolean).join(" ") || "—",
            v.alocacao ?? "—",
            <Link key="t" href={`/frota/${v.id}?aba=documentos`} className="text-blue-800 hover:underline">{TIPO_DOCUMENTO.get(d.tipo)?.rotulo ?? d.tipo}</Link>,
            d.validade ? fmtData(d.validade) : "—",
            d.numero ?? "—",
            <SeloAlerta key="s" alerta={alerta} texto={d.situacao === "preliminar" ? "preliminar" : d.situacao === "em_inclusao" ? "em inclusão" : undefined} />,
          ])}
          vazio="Nada nesta janela."
        />
      </Secao>

      <Secao titulo={`Exigidos e não lançados (${faltando.length})`} descricao="Pela categoria do veículo: tacógrafo acima de 10 lugares; no escolar, CVS, ATE e vistoria semestral. Sem o lançamento, o sistema não consegue avisar o vencimento — e alocar o veículo assim abre pendência crítica.">
        <Tabela
          colunas={["Placa", "Veículo", "Uso", "Lugares", "Contrato / alocação", "Falta lançar"]}
          linhas={faltando.map(({ v, faltando: f }) => [
            <NomeVeiculo key="p" v={v} />,
            [v.marca, v.modelo].filter(Boolean).join(" ") || "—",
            v.categoriaUso ?? "—",
            v.capacidade ?? "—",
            v.alocacao ?? "—",
            <Link key="f" href={`/frota/${v.id}?aba=documentos`} className="text-blue-800 hover:underline">{f.map((t) => TIPO_DOCUMENTO.get(t)?.rotulo ?? t).join(", ")}</Link>,
          ])}
          vazio="Todos os documentos exigidos estão lançados."
        />
      </Secao>

      <Secao titulo="Controle de apólice" descricao="Todo veículo em operação precisa de apólice ativa, dentro da vigência e do segmento do uso (escolar na apólice escolar, fretamento na de fretamento, carro na de veículo leve).">
        <Tabela
          colunas={["Placa", "Veículo", "Uso", "Contrato / alocação", "Apólice", "Vencimento", "Situação"]}
          linhas={semCobertura
            .sort((a, b) => ["sem_apolice", "vencida", "segmento_incompativel", "sem_vencimento", "vence_em_breve"].indexOf(a.c) - ["sem_apolice", "vencida", "segmento_incompativel", "sem_vencimento", "vence_em_breve"].indexOf(b.c))
            .map(({ v, c }) => [
              <NomeVeiculo key="p" v={v} />,
              [v.marca, v.modelo].filter(Boolean).join(" ") || "—",
              v.categoriaUso ?? "—",
              v.alocacao ?? "—",
              v.apolice?.descricao ?? "—",
              fmtData(v.apoliceVencimento ?? v.apolice?.vigenciaFim ?? null),
              <SeloCobertura key="c" cobertura={c} />,
            ])}
          vazio="Todos os veículos em operação estão cobertos."
        />
        <h3 className="mb-1 mt-5 text-sm font-semibold text-slate-800">Apólices</h3>
        <Tabela
          colunas={["Apólice", "Segmento", "Seguradora", "Vigência até", "Veículos"]}
          alinharDireita={[4]}
          linhas={apolices.map((a) => [a.descricao, a.segmento ?? "—", a.seguradora ?? "—", fmtData(a.vigenciaFim), fmtNumero(a._count.veiculos)])}
          vazio="Nenhuma apólice cadastrada."
        />
        <p className="mt-2 text-xs text-slate-500">Situações: {Object.values(ROTULO_COBERTURA).join(" · ")}.</p>
      </Secao>

      {podeEditar && (
        <Secao titulo="Quem recebe os avisos" descricao="E-mail quando um documento chega a 60, 30 ou 7 dias do vencimento ou vence, e quando uma apólice chega a 45 ou 15 dias. Separe os endereços por vírgula.">
          <FormAcao acao={salvarEmailsFrota} rotulo="Salvar destinatários" classe="text-xs">
            <input name="emails" defaultValue={emailsFrota} placeholder="frota@empresa.com.br, operacao@empresa.com.br" className="w-full rounded-md border border-slate-300 px-2 py-1.5" />
          </FormAcao>
        </Secao>
      )}

      <Secao titulo="IPVA a restituir e em análise" descricao="Veículos isentos com valor a restituir pela Fazenda: dinheiro a recuperar.">
        <Tabela
          colunas={["Placa", "Veículo", "Situação", "Isenção desde"]}
          linhas={ipva.map((v) => [<NomeVeiculo key="p" v={v} />, [v.marca, v.modelo].filter(Boolean).join(" ") || "—", ROTULO_IPVA[v.ipvaSituacao ?? ""] ?? "—", fmtData(v.ipvaIsencaoInicio)])}
          vazio="Nenhum IPVA a restituir."
        />
      </Secao>
    </div>
  );
}
