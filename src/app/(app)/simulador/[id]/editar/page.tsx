import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { paraNumero } from "@/lib/simulador/baseDeCustos";
import { larguraPainel } from "@/lib/ui";
import { exigirPermissao } from "../../../_dados";
import NovoEstudoForm, { type EstudoParaEditar } from "../../novo/NovoEstudoForm";

// EDITAR OS DADOS DO ESTUDO depois de criado — o mesmo formulário da criação,
// preenchido. Corrigir o nome, o cliente, o edital, a proposta, a abrangência.
export default async function EditarEstudoPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await exigirPermissao("gerir-simulador");
  const { id } = await params;
  const estudo = await prisma.simEstudo.findFirst({
    where: { id, companyId: session.companyId },
    include: { itens: { select: { shareIntermunicipal: true } } },
  });
  if (!estudo) notFound();

  const data = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
  const texto = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  const shares = estudo.itens.map((i) => paraNumero(i.shareIntermunicipal) ?? 0);
  const abrangencia: EstudoParaEditar["abrangencia"] =
    shares.length > 0 && shares.every((x) => x >= 1) ? "INTERMUNICIPAL" : shares.every((x) => x <= 0) ? "MUNICIPAL" : "MISTO";
  const valorMaximo = paraNumero(estudo.valorTotalMaximo);

  const dados: EstudoParaEditar = {
    id: estudo.id,
    esfera: estudo.esfera === "PUBLICO" ? "PUBLICO" : "PRIVADO",
    abrangencia,
    srp: estudo.srp,
    campos: {
      nome: estudo.nome,
      tipo: estudo.tipo,
      tipoServico: estudo.tipoServico,
      cliente: texto(estudo.esfera === "PUBLICO" ? (estudo.orgao ?? estudo.cliente) : estudo.cliente),
      municipio: texto(estudo.municipio),
      uf: texto(estudo.uf),
      vigenciaMeses: texto(estudo.vigenciaMeses),
      prazoPagamentoDias: texto(estudo.prazoPagamentoDias),
      numeroEdital: texto(estudo.numeroEdital),
      modalidade: texto(estudo.modalidade),
      plataforma: texto(estudo.plataforma),
      dataSessao: data(estudo.dataSessao),
      valorTotalMaximo: valorMaximo === null ? "" : valorMaximo.toLocaleString("pt-BR", { maximumFractionDigits: 2 }),
      indiceReajuste: texto(estudo.indiceReajuste),
      clienteDocumento: texto(estudo.clienteDocumento),
      contatoCliente: texto(estudo.contatoCliente),
      validadeProposta: data(estudo.validadeProposta),
      inicioPrevisto: data(estudo.inicioPrevisto),
      formaFaturamento: texto(estudo.formaFaturamento),
      avisoRescisaoDias: texto(estudo.avisoRescisaoDias),
      descricao: texto(estudo.descricao),
    },
  };

  return (
    <div className={`${larguraPainel} space-y-6`}>
      <div>
        <Link href={`/simulador/${estudo.id}`} className="text-xs font-medium text-blue-700 hover:underline">
          ← {estudo.nome}
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-slate-900">Editar dados do estudo</h1>
        <p className="mt-1 text-sm text-slate-500">
          Corrija o que for preciso. As versões já salvas não mudam; vigência e prazo de pagamento alterados aqui entram na próxima versão.
        </p>
      </div>
      <NovoEstudoForm estudo={dados} />
    </div>
  );
}
