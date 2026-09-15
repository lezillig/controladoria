// TESTES DAS REGRAS QUE LEEM A RECEITA FEDERAL — `npm run teste:receita`.
//
// As cinco regras de agents/antifraudeReceita.ts cruzam o cadastro público
// do CNPJ (situação, abertura, CNAE, porte, sócios) com o que o grupo paga.
// Cada uma tem o caso que precisa apontar e o caso legítimo que precisa
// deixar em paz — e todas precisam ficar caladas quando o CNPJ ainda não foi
// consultado. Sem banco e sem rede: contexto montado à mão (fixtures de
// teste-desvios.ts) e o extrator do cliente exercitado com um JSON de
// exemplo no formato da BrasilAPI.
import { auditarFraude } from "../src/lib/controladoria/agents/antifraude";
import {
  familiaDaCategoria,
  familiaDoCnae,
  forcaDaIncompatibilidade,
  nomeComparavel,
  nomeCruzavel,
} from "../src/lib/controladoria/agents/antifraudeReceita";
import { extrairDados, fmtCnae, normalizarCnpj } from "../src/lib/receita/cliente";
import type { ContextoAuditoria } from "../src/lib/controladoria/types";

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(
    `${ok ? "  ok  " : "FALHA "} ${nome}` +
      (ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         obtido   ${JSON.stringify(real)}`)
  );
}

const HOJE = new Date("2026-08-25");
const d = (iso: string) => new Date(iso);

type Titulo = ContextoAuditoria["titulos"][number];
type Parceiro = ContextoAuditoria["parceiros"][number];
type Receita = NonNullable<ContextoAuditoria["receita"]>[number];

let seq = 0;
const titulo = (p: Partial<Titulo> = {}): Titulo =>
  ({
    id: `t${++seq}`,
    companyId: "c",
    conexaoId: "x",
    conexaoApelido: "AZUL",
    natureza: "PAGAR",
    codigoLancamento: `L${seq}`,
    cancelado: false,
    liquidado: true,
    status: "PAGO",
    parceiroNome: "OFICINA MECANICA BETA",
    parceiroDocumento: "12345678000199",
    parceiroCodigo: "P1",
    contaCorrenteCodigo: "100",
    numeroDocumento: null,
    numeroParcela: null,
    tipoDocumento: null,
    categoriaDescricao: "Manutenção de veículos",
    dataEmissao: d("2026-06-01"),
    dataVencimento: d("2026-06-10"),
    dataUltimaBaixa: d("2026-06-10"),
    valorDocumentoCents: 1_234_56,
    valorPagoCents: 1_234_56,
    jurosCents: 0,
    multaCents: 0,
    descontoCents: 0,
    tarifaCents: 0,
    ...p,
  }) as Titulo;

// Título ainda por pagar.
const aberto = (p: Partial<Titulo> = {}): Titulo =>
  titulo({ liquidado: false, status: "ABERTO", valorPagoCents: 0, dataUltimaBaixa: null, dataVencimento: d("2026-09-10"), ...p });

const parceiro = (p: Partial<Parceiro> = {}): Parceiro =>
  ({
    id: `p${++seq}`,
    companyId: "c",
    conexaoId: "x",
    conexaoApelido: "AZUL",
    codigoOmie: "P1",
    nome: "OFICINA MECANICA BETA",
    documento: "12345678000199",
    email: "contato@beta.com.br",
    cidade: "CAMPINAS",
    inativo: false,
    bloqueado: false,
    contaBancariaHash: null,
    contaBancariaAlteradaEm: null,
    dataCadastroOmie: d("2024-01-10"),
    primeiraVezEm: d("2024-01-10"),
    ...p,
  }) as Parceiro;

// Consulta à Receita de uma oficina comum, ativa desde 2015.
const receita = (p: Partial<Receita> = {}): Receita =>
  ({
    id: `r${++seq}`,
    cnpj: "12345678000199",
    razaoSocial: "OFICINA MECANICA BETA LTDA",
    situacao: "ATIVA",
    situacaoEm: d("2015-03-01"),
    inicioAtividade: d("2015-03-01"),
    cnaeCodigo: "4520001",
    cnaeDescricao: "Serviços de manutenção e reparação mecânica de veículos automotores",
    porte: "EMPRESA DE PEQUENO PORTE",
    capitalSocialCents: 100_000_00,
    naturezaJuridica: "Sociedade Empresária Limitada",
    municipio: "CAMPINAS",
    uf: "SP",
    mei: false,
    simples: true,
    socios: [{ nome: "ROBERTO BETA FIGUEIREDO", qualificacao: "Sócio-Administrador" }],
    consultadoEm: d("2026-08-20"),
    erro: null,
    criadoEm: d("2026-08-20"),
    ...p,
  }) as Receita;

function contexto(p: {
  titulos?: Titulo[];
  parceiros?: Parceiro[];
  receita?: Receita[];
  motoristas?: { id: string; name: string; cpf: string; active: boolean }[];
}): ContextoAuditoria {
  return {
    companyId: "c",
    conexaoId: null,
    dataReferencia: HOJE,
    agora: HOJE,
    janelaDesde: d("2026-01-01"),
    titulos: p.titulos ?? [],
    baixas: [],
    parceiros: p.parceiros ?? [parceiro()],
    movimentos: [],
    contasCorrentes: [],
    config: { limiteAlcadaCents: 100_000_000_00, saldoMinimoCents: 0 },
    motoristas: p.motoristas ?? [],
    notas: [],
    categorias: [],
    departamentos: [],
    projetos: [],
    vinculos: [],
    abastecimentos: [],
    veiculos: [],
    clientes: [],
    conexoes: [],
    gestao: { disponivel: true, erro: null },
    receita: p.receita ?? [],
  } as unknown as ContextoAuditoria;
}

// Cinquenta títulos "de fundo" de outros fornecedores (sem consulta), para as
// regras de base inteira não interferirem e a materialidade valer o piso.
function fundo(): Titulo[] {
  return Array.from({ length: 50 }, (_, i) =>
    titulo({
      parceiroNome: `FORNECEDOR ${i}`,
      parceiroDocumento: `${String(10_000_000 + i).padStart(8, "0")}000100`,
      parceiroCodigo: `F${i}`,
      numeroDocumento: String(1000 + i * 7),
      valorDocumentoCents: 1_000_00 + i * 137,
      valorPagoCents: 1_000_00 + i * 137,
    })
  );
}

const rodar = (ctx: ContextoAuditoria, regra: string) => auditarFraude(ctx).filter((a) => a.regra === regra);
const REGRAS = ["FR-CNPJ-IRREGULAR", "FR-CNPJ-RECENTE", "FR-CNAE-INCOMPATIVEL", "FR-SOCIO-FUNCIONARIO", "FR-MEI-ACIMA-DO-TETO"];
const rodarTodas = (ctx: ContextoAuditoria) => auditarFraude(ctx).filter((a) => REGRAS.includes(a.regra));

// -------------------------------------------------------------- cliente
console.log("\ncliente — o que se extrai da resposta da BrasilAPI");
{
  const corpo = {
    cnpj: "19131243000197",
    razao_social: "OPEN KNOWLEDGE BRASIL",
    descricao_situacao_cadastral: "Ativa",
    data_situacao_cadastral: "2013-10-03",
    data_inicio_atividade: "2013-10-03",
    cnae_fiscal: 9430800,
    cnae_fiscal_descricao: "Atividades de associações de defesa de direitos sociais",
    porte: "Demais",
    capital_social: 1234.5,
    natureza_juridica: "Associação Privada",
    municipio: "SAO PAULO",
    uf: "sp",
    opcao_pelo_mei: null,
    opcao_pelo_simples: false,
    qsa: [
      { nome_socio: "ANA PAULA DE OLIVEIRA", qualificacao_socio: "Presidente", cnpj_cpf_do_socio: "***123456**" },
      { nome_socio: "", qualificacao_socio: "Diretor" },
      null,
    ],
    endereco: "não deve ir para lugar nenhum",
  };
  const dados = extrairDados("19131243000197", corpo);
  conferir("situação em caixa alta", dados.situacao, "ATIVA");
  conferir("data de abertura à meia-noite local", dados.inicioAtividade?.getFullYear(), 2013);
  conferir("CNAE com 7 dígitos", dados.cnaeCodigo, "9430800");
  conferir("capital social em centavos", dados.capitalSocialCents, 123_450);
  conferir("UF em caixa alta", dados.uf, "SP");
  conferir("MEI nulo quando a API não diz", dados.mei, null);
  conferir("sócio sem nome fica de fora; só nome e qualificação entram", dados.socios, [
    { nome: "ANA PAULA DE OLIVEIRA", qualificacao: "Presidente" },
  ]);
  conferir("CNAE que começa com zero mantém o zero", extrairDados("1", { cnae_fiscal: 111301 }).cnaeCodigo, "0111301");
  conferir("capital acima do Int4 vai ao teto", extrairDados("1", { capital_social: 90_000_000_000 }).capitalSocialCents, 2_147_483_647);
}
conferir("fmtCnae escreve como a Receita", fmtCnae("4929901"), "4929-9/01");
conferir("normalizarCnpj tira a máscara", normalizarCnpj("12.345.678/0001-99"), "12345678000199");
conferir("normalizarCnpj recusa CPF", normalizarCnpj("52998224725"), null);

// ---------------------------------------------------------- silêncio
console.log("\nsilêncio — sem consulta, nenhuma regra fala");
{
  const ctx = contexto({
    titulos: [...fundo(), titulo({ valorPagoCents: 200_000_00, valorDocumentoCents: 200_000_00 })],
    receita: [],
  });
  conferir("ctx.receita vazio: nada", rodarTodas(ctx).length, 0);
}
{
  const ctx = contexto({
    titulos: [...fundo(), titulo({ valorPagoCents: 200_000_00, valorDocumentoCents: 200_000_00 })],
    receita: [receita({ situacao: null, inicioAtividade: null, cnaeCodigo: null, socios: [], erro: "HTTP 503" })],
  });
  conferir("linha só com erro (nunca consultou com sucesso): nada", rodarTodas(ctx).length, 0);
}
{
  const ctx = contexto({ titulos: fundo(), receita: [receita({ situacao: "BAIXADA" })] });
  conferir("consulta sem título a pagar do CNPJ: nada", rodarTodas(ctx).length, 0);
}

// ---------------------------------------------------- FR-CNPJ-IRREGULAR
console.log("\nFR-CNPJ-IRREGULAR — o CNPJ não está ativo e segue recebendo");
{
  const ctx = contexto({
    titulos: [...fundo(), titulo({ valorPagoCents: 3_000_00, valorDocumentoCents: 3_000_00 })],
    receita: [receita({ situacao: "BAIXADA", situacaoEm: d("2025-11-30") })],
  });
  const r = rodar(ctx, "FR-CNPJ-IRREGULAR");
  conferir("baixada com pagamento em 12 meses é achado", r.length, 1);
  conferir("nunca abaixo de MÉDIA", ["MEDIA", "ALTA", "CRITICA"].includes(r[0]?.severidade ?? ""), true);
  conferir("aponta o fornecedor", r[0]?.entidadeRef, "OFICINA MECANICA BETA");
  conferir("a chave é o CNPJ", r[0]?.chave, "FR-CNPJ-IRREGULAR|12345678000199");
  conferir("a descrição manda conferir, não acusa", /[Cc]onferir/.test(r[0]?.recomendacao ?? ""), true);
}
{
  const ctx = contexto({
    titulos: [...fundo(), aberto({ valorDocumentoCents: 800_00 })],
    receita: [receita({ situacao: "INAPTA" })],
  });
  const r = rodar(ctx, "FR-CNPJ-IRREGULAR");
  conferir("inapta com título em aberto é ALTA mesmo com valor pequeno", r[0]?.severidade, "ALTA");
  conferir("e a recomendação começa por segurar o pagamento", r[0]?.recomendacao?.startsWith("Segurar"), true);
}
{
  const ctx = contexto({
    titulos: [...fundo(), aberto({ valorDocumentoCents: 20_000_00 })],
    receita: [receita({ situacao: "NAO ENCONTRADA", inicioAtividade: null, cnaeCodigo: null })],
  });
  const r = rodar(ctx, "FR-CNPJ-IRREGULAR");
  conferir("não encontrada na base pública é achado", r.length, 1);
  conferir("mas fica em MÉDIA: a base pública atrasa", r[0]?.severidade, "MEDIA");
}
{
  const ctx = contexto({
    titulos: [...fundo(), titulo({ valorPagoCents: 3_000_00, valorDocumentoCents: 3_000_00 })],
    receita: [receita({ situacao: "ATIVA" })],
  });
  conferir("ativa não é achado", rodar(ctx, "FR-CNPJ-IRREGULAR").length, 0);
}
{
  const ctx = contexto({
    titulos: [...fundo(), titulo({ dataUltimaBaixa: d("2025-03-10"), dataVencimento: d("2025-03-10"), dataEmissao: d("2025-03-01") })],
    receita: [receita({ situacao: "BAIXADA" })],
  });
  conferir("baixada, mas o último pagamento tem mais de 12 meses e nada em aberto: nada", rodar(ctx, "FR-CNPJ-IRREGULAR").length, 0);
}

// ------------------------------------------------------ FR-CNPJ-RECENTE
console.log("\nFR-CNPJ-RECENTE — empresa aberta há poucos meses já recebendo alto");
{
  // Aberta em março, primeiro título em maio, R$ 2.000 contra R$ 500 de
  // materialidade (4x = ALTA), capital de R$ 1.000 e MEI: dois agravantes.
  const titulos = [5, 6].map((m) =>
    titulo({ dataEmissao: d(`2026-0${m}-05`), dataVencimento: d(`2026-0${m}-15`), dataUltimaBaixa: d(`2026-0${m}-15`), valorDocumentoCents: 1_000_00, valorPagoCents: 1_000_00 })
  );
  const ctx = contexto({
    titulos: [...fundo(), ...titulos],
    receita: [receita({ inicioAtividade: d("2026-03-01"), capitalSocialCents: 1_000_00, mei: true, porte: "MICRO EMPRESA" })],
  });
  const r = rodar(ctx, "FR-CNPJ-RECENTE");
  conferir("empresa de dois meses recebendo 4x a materialidade é achado", r.length, 1);
  conferir("os dois agravantes aparecem", (r[0]?.evidencia?.agravantes as string[]).length, 2);
  conferir("dois agravantes sobem um degrau (ALTA → CRÍTICA)", r[0]?.severidade, "CRITICA");
  conferir("o total é a soma dos títulos", r[0]?.valorCents, 2_000_00);
}
{
  const titulos = [5, 6].map((m) =>
    titulo({ dataEmissao: d(`2026-0${m}-05`), dataVencimento: d(`2026-0${m}-15`), valorDocumentoCents: 1_000_00, valorPagoCents: 1_000_00 })
  );
  const ctx = contexto({
    titulos: [...fundo(), ...titulos],
    receita: [receita({ inicioAtividade: d("2026-03-01"), capitalSocialCents: 100_000_00, porte: "DEMAIS", mei: false })],
  });
  const r = rodar(ctx, "FR-CNPJ-RECENTE");
  conferir("sem agravante fica na severidade do valor (ALTA)", r[0]?.severidade, "ALTA");
  conferir("e a lista de agravantes vem vazia", (r[0]?.evidencia?.agravantes as string[]).length, 0);
}
{
  const ctx = contexto({
    titulos: [...fundo(), titulo({ valorDocumentoCents: 50_000_00, valorPagoCents: 50_000_00 })],
    receita: [receita({ inicioAtividade: d("2015-03-01") })],
  });
  conferir("empresa de 2015 não é recente, por mais que receba", rodar(ctx, "FR-CNPJ-RECENTE").length, 0);
}
{
  const ctx = contexto({
    titulos: [...fundo(), titulo({ valorDocumentoCents: 800_00, valorPagoCents: 800_00 })],
    receita: [receita({ inicioAtividade: d("2026-03-01"), capitalSocialCents: 1_000_00 })],
  });
  conferir("recente, mas abaixo de 2x a materialidade: nada", rodar(ctx, "FR-CNPJ-RECENTE").length, 0);
}
{
  const ctx = contexto({
    titulos: [...fundo(), titulo({ dataEmissao: d("2026-02-10"), dataVencimento: d("2026-02-20"), valorDocumentoCents: 5_000_00, valorPagoCents: 5_000_00 })],
    receita: [receita({ inicioAtividade: d("2026-03-01"), capitalSocialCents: 100_000_00, porte: "DEMAIS" })],
  });
  const r = rodar(ctx, "FR-CNPJ-RECENTE");
  conferir("título anterior à abertura é agravante", (r[0]?.evidencia?.agravantes as string[])[0]?.includes("ANTES"), true);
}

// ------------------------------------------------- FR-CNAE-INCOMPATIVEL
console.log("\nFR-CNAE-INCOMPATIVEL — a atividade declarada não tem a ver com o que se paga");
conferir("4731-8/00 é posto de combustível", familiaDoCnae("4731800"), "COMBUSTIVEL");
conferir("4711-3/02 é supermercado (classe vence a divisão 47)", familiaDoCnae("4711302"), "ALIMENTACAO");
conferir("4930-2/02 é transporte rodoviário", familiaDoCnae("4930202"), "TRANSPORTE");
conferir("4781-4/00 é loja de roupas", familiaDoCnae("4781400"), "VAREJO_ROUPAS");
conferir("CNAE desconhecido não tem família", familiaDoCnae("9999999"), null);
conferir("'Serviços de consultoria' é consultoria", familiaDaCategoria("Serviços de consultoria"), "CONSULTORIA");
conferir("'Vale alimentação' fica fora da conta", familiaDaCategoria("Vale alimentação"), null);
conferir("'Aluguel de veículos' não é aluguel de imóvel", familiaDaCategoria("Aluguel de veículos"), "ALUGUEL_VEICULO");
conferir("posto cobrando consultoria: forte", forcaDaIncompatibilidade("CONSULTORIA", "COMBUSTIVEL"), "forte");
conferir("transportadora cobrando combustível: fraca", forcaDaIncompatibilidade("COMBUSTIVEL", "TRANSPORTE"), "fraca");
conferir("oficina cobrando manutenção: compatível", forcaDaIncompatibilidade("MANUTENCAO", "MANUTENCAO"), null);
conferir("concessionária alugando veículo: plausível (fora da tabela)", forcaDaIncompatibilidade("ALUGUEL_VEICULO", "MANUTENCAO"), null);
{
  const ctx = contexto({
    titulos: [...fundo(), titulo({ categoriaDescricao: "Serviços de consultoria", valorDocumentoCents: 3_000_00, valorPagoCents: 3_000_00 })],
    receita: [receita({ cnaeCodigo: "4731800", cnaeDescricao: "Comércio varejista de combustíveis para veículos automotores" })],
  });
  const r = rodar(ctx, "FR-CNAE-INCOMPATIVEL");
  conferir("posto recebendo por consultoria é achado", r.length, 1);
  conferir("forte e acima da materialidade é MÉDIA", r[0]?.severidade, "MEDIA");
  conferir("a evidência diz qual categoria e a força", (r[0]?.evidencia?.categorias as { incompatibilidade: string }[])[0]?.incompatibilidade, "forte");
}
{
  const ctx = contexto({
    titulos: [...fundo(), titulo({ categoriaDescricao: "Manutenção de veículos", valorDocumentoCents: 300_00, valorPagoCents: 300_00 })],
    receita: [receita({ cnaeCodigo: "4781400", cnaeDescricao: "Comércio varejista de artigos do vestuário e acessórios" })],
  });
  const r = rodar(ctx, "FR-CNAE-INCOMPATIVEL");
  conferir("loja de roupas recebendo por manutenção de veículos é achado", r.length, 1);
  conferir("forte abaixo da materialidade é BAIXA", r[0]?.severidade, "BAIXA");
}
{
  const ctx = contexto({
    titulos: [...fundo(), titulo({ categoriaDescricao: "Combustível", valorDocumentoCents: 3_000_00, valorPagoCents: 3_000_00 })],
    receita: [receita({ cnaeCodigo: "4930202", cnaeDescricao: "Transporte rodoviário de carga" })],
  });
  const r = rodar(ctx, "FR-CNAE-INCOMPATIVEL");
  conferir("transportadora cobrando combustível é incompatibilidade fraca", r.length, 1);
  conferir("fraca é INFO", r[0]?.severidade, "INFO");
}
{
  const ctx = contexto({
    titulos: [...fundo(), titulo({ categoriaDescricao: "Combustível", valorDocumentoCents: 3_000_00, valorPagoCents: 3_000_00 })],
    receita: [receita({ cnaeCodigo: "4731800" })],
  });
  conferir("posto cobrando combustível não é achado", rodar(ctx, "FR-CNAE-INCOMPATIVEL").length, 0);
}
{
  const ctx = contexto({
    titulos: [...fundo(), titulo({ categoriaDescricao: "Manutenção de veículos", valorDocumentoCents: 3_000_00, valorPagoCents: 3_000_00 })],
    receita: [receita()],
  });
  conferir("oficina cobrando manutenção não é achado", rodar(ctx, "FR-CNAE-INCOMPATIVEL").length, 0);
}
{
  const ctx = contexto({
    titulos: [...fundo(), titulo({ categoriaDescricao: "Vale alimentação", valorDocumentoCents: 30_000_00, valorPagoCents: 30_000_00 })],
    receita: [receita({ cnaeCodigo: "6619399", cnaeDescricao: "Outras atividades auxiliares dos serviços financeiros" })],
  });
  conferir("operadora de benefício recebendo por vale não é achado", rodar(ctx, "FR-CNAE-INCOMPATIVEL").length, 0);
}
{
  const ctx = contexto({
    titulos: [...fundo(), titulo({ categoriaDescricao: "Serviços de terceiros", valorDocumentoCents: 30_000_00, valorPagoCents: 30_000_00 })],
    receita: [receita({ cnaeCodigo: "4731800" })],
  });
  conferir("categoria genérica sem família fica calada", rodar(ctx, "FR-CNAE-INCOMPATIVEL").length, 0);
}

// ------------------------------------------------- FR-SOCIO-FUNCIONARIO
console.log("\nFR-SOCIO-FUNCIONARIO — sócio do fornecedor com o nome de alguém da folha");
conferir("normaliza caixa, acento e partícula", nomeComparavel("Carlos Eduardo Pereira da Rocha"), "CARLOS EDUARDO PEREIRA ROCHA");
conferir("tira o CPF da razão social do MEI", nomeComparavel("MARCOS VINICIUS TORRES 12345678901"), "MARCOS VINICIUS TORRES");
conferir("'JOAO SILVA' não cruza (sobrenome comum, duas palavras)", nomeCruzavel(nomeComparavel("JOAO DA SILVA")), false);
conferir("'JOAO SILVA MENEZES' cruza", nomeCruzavel(nomeComparavel("JOAO DA SILVA MENEZES")), true);
conferir("'JOAO FIGUEIREDO' cruza (sobrenome raro)", nomeCruzavel(nomeComparavel("JOAO FIGUEIREDO")), true);
conferir("só o primeiro nome não cruza", nomeCruzavel(nomeComparavel("JOAO")), false);
{
  const ctx = contexto({
    titulos: [...fundo(), titulo({ valorDocumentoCents: 3_000_00, valorPagoCents: 3_000_00 })],
    receita: [receita({ socios: [{ nome: "CARLOS EDUARDO PEREIRA DA ROCHA", qualificacao: "Sócio-Administrador" }] })],
    motoristas: [{ id: "m1", name: "Carlos Eduardo Pereira da Rocha", cpf: "529.982.247-25", active: true }],
  });
  const r = rodar(ctx, "FR-SOCIO-FUNCIONARIO");
  conferir("sócio com o nome inteiro de motorista da folha é achado", r.length, 1);
  conferir("é CRÍTICA (motorista ativo, valor material)", r[0]?.severidade, "CRITICA");
  conferir("a chave é CNPJ + motorista", r[0]?.chave, "FR-SOCIO-FUNCIONARIO|12345678000199|m1");
  // O caso real: MEI de motorista ativo com um título de R$ 15,00. O conflito
  // existe, mas não ao lado de R$ 33 mil numa conta dividida.
  const pequeno = contexto({
    titulos: [...fundo(), titulo({ valorDocumentoCents: 15_00, valorPagoCents: 15_00 })],
    receita: [receita({ socios: [{ nome: "CARLOS EDUARDO PEREIRA DA ROCHA", qualificacao: "Sócio-Administrador" }] })],
    motoristas: [{ id: "m1", name: "Carlos Eduardo Pereira da Rocha", cpf: "529.982.247-25", active: true }],
  });
  conferir("abaixo da materialidade é ALTA", rodar(pequeno, "FR-SOCIO-FUNCIONARIO")[0]?.severidade, "ALTA");
  const desligado = contexto({
    titulos: [...fundo(), titulo({ valorDocumentoCents: 3_000_00, valorPagoCents: 3_000_00 })],
    receita: [receita({ socios: [{ nome: "CARLOS EDUARDO PEREIRA DA ROCHA", qualificacao: "Sócio-Administrador" }] })],
    motoristas: [{ id: "m1", name: "Carlos Eduardo Pereira da Rocha", cpf: "529.982.247-25", active: false }],
  });
  conferir("motorista desligado é MÉDIA", rodar(desligado, "FR-SOCIO-FUNCIONARIO")[0]?.severidade, "MEDIA");
  conferir("a descrição pede conferir vínculo, não afirma", /conferir parentesco ou vínculo/.test(r[0]?.descricao ?? ""), true);
  conferir("e diz que homônimo existe", /homônimo/.test(r[0]?.descricao ?? ""), true);
}
{
  const ctx = contexto({
    titulos: [...fundo(), titulo({ valorDocumentoCents: 3_000_00, valorPagoCents: 3_000_00 })],
    receita: [receita({ socios: [{ nome: "JOAO SILVA", qualificacao: "Sócio" }] })],
    motoristas: [{ id: "m1", name: "JOAO DA SILVA", cpf: "529.982.247-25", active: true }],
  });
  conferir("'João Silva' contra 'João da Silva' não basta: homônimo comum demais", rodar(ctx, "FR-SOCIO-FUNCIONARIO").length, 0);
}
{
  const ctx = contexto({
    titulos: [...fundo(), titulo({ valorDocumentoCents: 3_000_00, valorPagoCents: 3_000_00 })],
    receita: [receita({ socios: [{ nome: "JOAO DA SILVA MENEZES", qualificacao: "Sócio" }] })],
    motoristas: [{ id: "m1", name: "João Silva Menezes", cpf: "529.982.247-25", active: false }],
  });
  const r = rodar(ctx, "FR-SOCIO-FUNCIONARIO");
  conferir("com o terceiro nome, cruza — inclusive motorista desligado", r.length, 1);
  conferir("a evidência diz que está desligado", r[0]?.evidencia?.motoristaAtivo, false);
}
{
  const ctx = contexto({
    titulos: [...fundo(), titulo({ valorDocumentoCents: 3_000_00, valorPagoCents: 3_000_00 })],
    receita: [receita({ razaoSocial: "MARCOS VINICIUS TORRES 12345678901", naturezaJuridica: "Empresário (Individual)", mei: true, socios: [] })],
    motoristas: [{ id: "m2", name: "Marcos Vinícius Torres", cpf: "529.982.247-25", active: true }],
  });
  const r = rodar(ctx, "FR-SOCIO-FUNCIONARIO");
  conferir("MEI sem quadro societário cruza pela razão social", r.length, 1);
  conferir("e a evidência diz de onde veio o nome", r[0]?.evidencia?.origemDoNome, "razão social");
}
{
  const ctx = contexto({
    titulos: [...fundo(), titulo({ valorDocumentoCents: 3_000_00, valorPagoCents: 3_000_00 })],
    receita: [receita({ razaoSocial: "MARCOS VINICIUS TORRES TRANSPORTES LTDA", naturezaJuridica: "Sociedade Empresária Limitada", mei: false, socios: [] })],
    motoristas: [{ id: "m2", name: "Marcos Vinícius Torres", cpf: "529.982.247-25", active: true }],
  });
  conferir("LTDA sem sócios listados não cruza pela razão social", rodar(ctx, "FR-SOCIO-FUNCIONARIO").length, 0);
}
{
  const ctx = contexto({
    titulos: [...fundo(), titulo({ valorDocumentoCents: 3_000_00, valorPagoCents: 3_000_00 })],
    receita: [receita({ socios: [{ nome: "CARLOS EDUARDO PEREIRA DA ROCHA", qualificacao: "Sócio" }] })],
    motoristas: [{ id: "m1", name: "Carlos Eduardo Pereira", cpf: "529.982.247-25", active: true }],
  });
  conferir("nome parecido mas não inteiro não cruza", rodar(ctx, "FR-SOCIO-FUNCIONARIO").length, 0);
}

// ------------------------------------------------ FR-MEI-ACIMA-DO-TETO
console.log("\nFR-MEI-ACIMA-DO-TETO — o MEI que só com o grupo já passou do teto");
{
  const titulos = [3, 4, 5].map((m) =>
    titulo({ dataUltimaBaixa: d(`2026-0${m}-10`), dataVencimento: d(`2026-0${m}-10`), valorDocumentoCents: 30_000_00, valorPagoCents: 30_000_00 })
  );
  const ctx = contexto({ titulos: [...fundo(), ...titulos], receita: [receita({ mei: true, porte: "MICRO EMPRESA" })] });
  const r = rodar(ctx, "FR-MEI-ACIMA-DO-TETO");
  conferir("MEI com R$ 90 mil em 12 meses é achado", r.length, 1);
  conferir("até 20% acima do teto é INFO", r[0]?.severidade, "INFO");
  conferir("com o excedente na evidência", r[0]?.evidencia?.excedente, 9_000_00);
}
{
  const titulos = [3, 4, 5, 6].map((m) =>
    titulo({ dataUltimaBaixa: d(`2026-0${m}-10`), dataVencimento: d(`2026-0${m}-10`), valorDocumentoCents: 30_000_00, valorPagoCents: 30_000_00 })
  );
  const ctx = contexto({ titulos: [...fundo(), ...titulos], receita: [receita({ mei: true })] });
  conferir("acima da tolerância de 20% é BAIXA", rodar(ctx, "FR-MEI-ACIMA-DO-TETO")[0]?.severidade, "BAIXA");
}
{
  const ctx = contexto({
    titulos: [...fundo(), titulo({ valorDocumentoCents: 50_000_00, valorPagoCents: 50_000_00 })],
    receita: [receita({ mei: true })],
  });
  conferir("MEI abaixo do teto não é achado", rodar(ctx, "FR-MEI-ACIMA-DO-TETO").length, 0);
}
{
  const titulos = [3, 4, 5, 6].map((m) =>
    titulo({ dataUltimaBaixa: d(`2026-0${m}-10`), dataVencimento: d(`2026-0${m}-10`), valorDocumentoCents: 30_000_00, valorPagoCents: 30_000_00 })
  );
  const ctx = contexto({ titulos: [...fundo(), ...titulos], receita: [receita({ mei: false })] });
  conferir("quem não é MEI não tem teto", rodar(ctx, "FR-MEI-ACIMA-DO-TETO").length, 0);
}
{
  // Pago há mais de 12 meses não conta.
  const titulos = [3, 4, 5, 6].map((m) =>
    titulo({ dataUltimaBaixa: d(`2025-0${m}-10`), dataVencimento: d(`2025-0${m}-10`), dataEmissao: d(`2025-0${m}-01`), valorDocumentoCents: 30_000_00, valorPagoCents: 30_000_00 })
  );
  const ctx = contexto({ titulos: [...fundo(), ...titulos], receita: [receita({ mei: true })] });
  conferir("pagamento de 2025 não entra nos 12 meses", rodar(ctx, "FR-MEI-ACIMA-DO-TETO").length, 0);
}

console.log(falhas === 0 ? "\nTodos os casos passaram." : `\n${falhas} caso(s) falharam.`);
process.exit(falhas === 0 ? 0 : 1);
