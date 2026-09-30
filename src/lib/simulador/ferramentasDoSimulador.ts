import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { dataReferenciaPadrao } from "@/lib/controladoria/ciclo";
import type { ConsultaFeita } from "@/lib/controladoria/investigador";
import { baseVigente, paraNumero } from "./baseDeCustos";
import { analisarCustosReais, carregarDadosReais } from "./custosReais";
import { montarPainel, piorar, precoDoConjunto } from "./decisao";
import { carregarEstudo, entradaInicial, regrasDeMargem, ROTULO_STATUS_ESTUDO, ROTULO_TIPO_ESTUDO, ROTULO_TIPO_SERVICO, validarEntrada } from "./estudos";
import { simular } from "./motor";
import { CAMPOS_PREMISSAS, escreverCaminho, lerCaminho, type MapaOrigem } from "./premissas";
import { ROTULO_UNIDADE, type EntradaSimulacao, type ResultadoSimulacao, type UnidadePreco } from "./tipos";

// AS FERRAMENTAS DO SIMULADOR — o que o especialista de precificação consulta.
//
// As mesmas garantias dos outros especialistas: só leitura, escopo pela
// sessão (o modelo não escolhe a empresa), toda consulta registrada. A única
// ferramenta que "faz conta nova" é simular_variacao, e ela roda o MESMO motor
// da tela sobre uma cópia da entrada — não grava versão, não muda premissa do
// estudo. Uma variação que o especialista propõe vira decisão só quando uma
// pessoa a aplica no editor e salva.
//
// Os números saem em reais (não centavos) e frações viram percentuais com uma
// casa, já formatados: o modelo cita, não converte.

const r2 = (v: number | null | undefined, casas = 2) => (v === null || v === undefined || !Number.isFinite(v) ? null : Number(v.toFixed(casas)));
const pctTxt = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? null : `${(v * 100).toFixed(1).replace(".", ",")}%`);
const LIMITE = 30;

const CAMINHOS_NUMERICOS = CAMPOS_PREMISSAS.filter((c) => c.tipo === "numero" || c.tipo === "pct" || c.tipo === "moeda").map((c) => c.caminho);

type Carregado = { id: string; nome: string; versao: number | null; entrada: EntradaSimulacao; origem: MapaOrigem };

function resumoDoResultado(r: ResultadoSimulacao) {
  const lote = r.lote;
  return {
    unidade: ROTULO_UNIDADE[r.unidade],
    criterio: r.criterio,
    apuracao: r.modo === "MENSAL" ? "mensal" : "período",
    totais: {
      kmUtil: r2(r.totais.kmUtil, 0),
      veiculos: r.totais.veiculos,
      motoristas: r2(r.totais.motoristas, 1),
      custoTotal: r2(r.totais.custoTotal),
      faturamento: r2(lote ? lote.faturamentoAoPrecoProposta : r.totais.faturamento),
      lucroLiquido: r2(lote ? lote.lucroAoPrecoProposta : r.totais.lucro),
      margem: pctTxt(lote ? lote.margemAoPrecoProposta : r.totais.margem),
    },
    lote: lote
      ? { precoProposta: r2(lote.precoPropostaUnidade, 4), custoPorKm: r2(lote.custoKm, 4), tributos: pctTxt(lote.tributosPct), itensAcimaDoTeto: lote.itensAcimaDoTeto }
      : null,
    itens: r.itens.map((i) => ({
      item: i.item,
      descricao: i.descricao.slice(0, 120),
      preco: r2(i.precoUnidade, 4),
      precoMaximoKm: i.precoMaximoKm,
      acimaDoTeto: i.acimaDoTeto,
      margem: pctTxt(i.margem),
      lucro: r2(i.lucro),
      custoTotal: r2(i.custoTotal),
      composicaoMensal: {
        maoDeObra: r2(i.maoDeObraMes),
        veiculo: r2(i.veiculoMes),
        depreciacao: r2(i.depreciacao),
        remuneracaoCapital: r2(i.remuneracaoCapital),
      },
      variaveisNaApuracao: { combustivel: r2(i.diesel + i.arla), manutencaoPneusOleo: r2(i.manutencao + i.pneus + i.oleoLavagem), pedagio: r2(i.pedagio) },
      indiretos: r2(i.indiretos),
      tributosSobrePreco: pctTxt(i.tributosPct),
      precoNasUnidades: {
        km: r2(i.indicadores.km.preco, 4),
        veiculoMes: r2(i.indicadores.veiculoMes.preco),
        diaria: r2(i.indicadores.diaria.preco),
        hora: i.indicadores.hora ? r2(i.indicadores.hora.preco) : null,
        binomia: { fixoVeiculoMes: r2(i.indicadores.binomia.fixoVeiculoMes), variavelKm: r2(i.indicadores.binomia.variavelKm, 4) },
      },
    })),
    equilibrio: r.cenarios.pontoEquilibrio === null ? null : { utilizacao: pctTxt(r.cenarios.pontoEquilibrio), tipo: r.cenarios.tipoEquilibrio },
  };
}

export function ferramentasDoSimulador(escopo: { companyId: string }, consultas: ConsultaFeita[]) {
  const registrar = (ferramenta: string, entrada: Record<string, unknown>, resumo: string) => consultas.push({ ferramenta, entrada, resumo });

  // O estudo por id ou por trecho do nome/edital; a versão pelo número (padrão:
  // a última salva; sem versão, a definição corrente com a base vigente).
  async function carregar(estudo: string, versao?: number): Promise<Carregado | string> {
    const achado = await prisma.simEstudo.findFirst({
      where: {
        companyId: escopo.companyId,
        OR: [{ id: estudo }, { nome: { contains: estudo, mode: "insensitive" } }, { numeroEdital: { contains: estudo, mode: "insensitive" } }],
      },
      orderBy: { atualizadoEm: "desc" },
      select: { id: true },
    });
    if (!achado) return `Nenhum estudo encontrado para "${estudo}". Use listar_estudos.`;
    const c = await carregarEstudo(escopo.companyId, achado.id);
    if (!c) return "Estudo não encontrado.";
    if (versao !== undefined) {
      const s = c.estudo.simulacoes.find((x) => x.versao === versao);
      if (!s) return `O estudo não tem a versão ${versao}. Versões: ${c.estudo.simulacoes.map((x) => x.versao).join(", ") || "nenhuma"}.`;
      return { id: c.estudo.id, nome: c.estudo.nome, versao, entrada: s.entrada as unknown as EntradaSimulacao, origem: (s.origem as MapaOrigem | null) ?? {} };
    }
    const inicial = await entradaInicial(escopo.companyId, c, c.estudo.simulacoes[0]?.id ?? null);
    return { id: c.estudo.id, nome: c.estudo.nome, versao: inicial.versaoBase, entrada: inicial.entrada, origem: inicial.origem };
  }

  const listarEstudos = betaZodTool({
    name: "listar_estudos",
    description:
      "Lista os estudos de custo (licitações, contratos privados, renovações, orçamentos) com a última versão: unidade de preço, preço, margem, situação e resultado da disputa. Comece por aqui para saber o que existe.",
    inputSchema: z.object({
      situacao: z.enum(["EM_ESTUDO", "PROPOSTA_ENVIADA", "GANHO", "PERDIDO", "DESISTENCIA", "EM_EXECUCAO", "ENCERRADO"]).optional(),
      limite: z.number().int().min(1).max(LIMITE).optional(),
    }),
    run: async (input) => {
      const estudos = await prisma.simEstudo.findMany({
        where: { companyId: escopo.companyId, ...(input.situacao ? { status: input.situacao } : {}) },
        orderBy: { atualizadoEm: "desc" },
        take: input.limite ?? 15,
        include: { simulacoes: { orderBy: { versao: "desc" }, take: 1 }, _count: { select: { simulacoes: true, rotas: true, lances: true } } },
      });
      registrar("listar_estudos", input, `${estudos.length} estudo(s)`);
      return JSON.stringify(
        estudos.map((e) => {
          const s = e.simulacoes[0];
          return {
            id: e.id,
            nome: e.nome,
            tipo: ROTULO_TIPO_ESTUDO[e.tipo as keyof typeof ROTULO_TIPO_ESTUDO] ?? e.tipo,
            servico: ROTULO_TIPO_SERVICO[e.tipoServico as keyof typeof ROTULO_TIPO_SERVICO] ?? e.tipoServico,
            cliente: e.orgao ?? e.cliente,
            situacao: ROTULO_STATUS_ESTUDO[e.status as keyof typeof ROTULO_STATUS_ESTUDO] ?? e.status,
            unidade: ROTULO_UNIDADE[(e.unidadePreco as UnidadePreco) ?? "KM"] ?? e.unidadePreco,
            versoes: e._count.simulacoes,
            rotas: e._count.rotas,
            lances: e._count.lances,
            ultimaVersao: s ? { versao: s.versao, status: s.status, preco: r2(paraNumero(s.precoKm), 4), margem: pctTxt(paraNumero(s.margem)), lucro: r2(paraNumero(s.lucro)) } : null,
            resultado: e.resultadoVencedor || e.resultadoPrecoKm ? { posicao: e.resultadoPosicao, vencedor: e.resultadoVencedor, precoVencedor: r2(paraNumero(e.resultadoPrecoKm), 4) } : null,
          };
        })
      );
    },
  });

  const lerEstudo = betaZodTool({
    name: "ler_estudo",
    description:
      "Abre um estudo: premissas (com a origem de cada uma — base da empresa, custo real medido, estimativa padrão ou ajuste manual), tipos de veículo, composição de custo por item, preço em todas as unidades, ponto de equilíbrio, e o painel de decisão (veredicto, faixa de lance, sensibilidade e alertas), mais lances e resultado. É a conta da tela, pelo mesmo motor.",
    inputSchema: z.object({
      estudo: z.string().min(2).describe("Id do estudo ou trecho do nome/número do edital."),
      versao: z.number().int().min(1).optional().describe("Número da versão. Padrão: a última salva."),
    }),
    run: async (input) => {
      const c = await carregar(input.estudo, input.versao);
      if (typeof c === "string") {
        registrar("ler_estudo", input, c);
        return c;
      }
      const resultado = simular(c.entrada);
      const base = await baseVigente(escopo.companyId);
      const regras = regrasDeMargem(base);
      const painel = montarPainel(c.entrada, resultado, { ...regras, origem: c.origem });
      const estudo = await prisma.simEstudo.findFirst({
        where: { id: c.id, companyId: escopo.companyId },
        include: { lances: { orderBy: { dataHora: "asc" } }, regras: { orderBy: { ordem: "asc" } } },
      });
      const premissas = CAMPOS_PREMISSAS.map((f) => ({
        premissa: f.caminho,
        rotulo: f.rotulo,
        unidade: f.unidade,
        valor: lerCaminho(c.entrada.premissas, f.caminho),
        origem: c.origem[f.caminho]?.origem ?? "PADRAO",
        fonte: c.origem[f.caminho]?.fonte,
      }));
      registrar("ler_estudo", input, `${c.nome} v${c.versao ?? "rascunho"}: ${painel.veredicto}, margem ${pctTxt(painel.margem)}`);
      return JSON.stringify({
        estudo: { id: c.id, nome: c.nome, versao: c.versao, situacao: estudo?.status, orgao: estudo?.orgao ?? estudo?.cliente, valorTotalMaximo: r2(paraNumero(estudo?.valorTotalMaximo)) },
        regrasDoEdital: estudo?.regras.map((r) => ({ tema: r.tema, texto: r.texto.slice(0, 300), impacto: r.impacto })) ?? [],
        premissas,
        tiposDeVeiculo: (c.entrada.premissas.perfis ?? []).map((p) => ({
          codigo: p.codigo,
          tipo: p.tipo,
          salarioMotorista: p.motorista.salario,
          motoristasPorVeiculo: p.motorista.motoristasPorVeiculo,
          valorVeiculo: p.veiculo.valor,
          consumoKmL: p.variaveis.consumoAsfaltoKmL,
          rotas: c.entrada.rotas.filter((r) => r.perfilVeiculo === p.codigo).length,
        })),
        rotas: { quantidade: c.entrada.rotas.length, semTipoDeVeiculo: c.entrada.rotas.filter((r) => !r.perfilVeiculo).length },
        resultado: resumoDoResultado(resultado),
        decisao: {
          veredicto: painel.veredicto,
          resumo: painel.resumo,
          margemMinima: pctTxt(painel.margemMinima),
          margemAlvo: pctTxt(painel.margemAlvo),
          regrasDeMargemDaEmpresa: painel.regrasDaBase,
          faixaDeLance: {
            unidade: ROTULO_UNIDADE[painel.faixa.unidade],
            piso: r2(painel.faixa.piso, 4),
            naMargemMinima: r2(painel.faixa.margemMinima, 4),
            alvo: r2(painel.faixa.alvo, 4),
            tetoDoEdital: r2(painel.faixa.teto, 4),
          },
          folgaDeUtilizacao: pctTxt(painel.folgaUtilizacao),
          sensibilidade: painel.sensibilidade.slice(0, 8).map((s) => ({ premissa: s.caminho, rotulo: s.rotulo, efeitoNoLucroSe10PctPior: r2(s.efeitoLucro), pontosDeMargem: r2(s.efeitoMargem * 100, 2) })),
          premissasEstimadas: painel.premissasEstimadas,
          alertas: painel.alertas,
        },
        lances: estudo?.lances.map((l) => ({ fase: l.fase, quando: l.dataHora.toISOString().slice(0, 16), precos: l.precos, valorTotal: r2(paraNumero(l.valorTotal)) })) ?? [],
        resultadoDaDisputa: estudo?.resultadoVencedor || estudo?.resultadoPrecoKm ? { posicao: estudo.resultadoPosicao, vencedor: estudo.resultadoVencedor, precoVencedor: r2(paraNumero(estudo.resultadoPrecoKm), 4) } : null,
      });
    },
  });

  const simularVariacao = betaZodTool({
    name: "simular_variacao",
    description:
      "Roda o motor sobre uma CÓPIA do estudo com premissas mudadas e devolve base × variação. Duas leituras: (1) o PREÇO NOVO que a variação pede para manter a margem alvo; (2) o lucro e a margem AO PREÇO DA BASE — a pergunta de quem já lançou: 'e se a utilização cair para 70%?'. `mudancas` fixa um valor no veículo padrão (os tipos de veículo mantêm os seus); `fatores` multiplica a premissa no padrão E em todos os tipos de veículo (ex.: diesel ×1,15). Não grava nada. Percentuais em fração (0,12 = 12%).",
    inputSchema: z.object({
      estudo: z.string().min(2),
      versao: z.number().int().min(1).optional(),
      mudancas: z
        .array(z.object({ premissa: z.string().describe(`Caminho da premissa, ex.: ${CAMINHOS_NUMERICOS.slice(0, 6).join(", ")}.`), valor: z.number() }))
        .max(15)
        .default([]),
      fatores: z
        .array(z.object({ premissa: z.string(), fator: z.number().positive().max(10).describe("1,15 = +15%; 0,9 = −10%.") }))
        .max(10)
        .default([]),
      unidadePreco: z.enum(["KM", "VEICULO_MES", "DIARIA", "HORA", "BINOMIA"]).optional(),
      criterio: z.enum(["ITEM", "LOTE"]).optional(),
    }),
    run: async (input) => {
      const c = await carregar(input.estudo, input.versao);
      if (typeof c === "string") {
        registrar("simular_variacao", input, c);
        return c;
      }
      const mudancas = input.mudancas ?? [];
      const fatores = input.fatores ?? [];
      const invalidas = [...mudancas, ...fatores].filter((m) => !CAMINHOS_NUMERICOS.includes(m.premissa));
      if (invalidas.length > 0) {
        const msg = `Premissa(s) desconhecida(s): ${invalidas.map((m) => m.premissa).join(", ")}. Válidas: ${CAMINHOS_NUMERICOS.join(", ")}.`;
        registrar("simular_variacao", input, "premissa inválida");
        return msg;
      }
      const variada = structuredClone(c.entrada);
      const aplicadas = mudancas.map((m) => {
        const antes = lerCaminho(variada.premissas, m.premissa);
        escreverCaminho(variada.premissas, m.premissa, m.valor);
        return { premissa: m.premissa, antes, depois: m.valor };
      });
      for (const f of fatores) {
        const antes = lerCaminho(variada.premissas, f.premissa);
        piorar(variada.premissas, f.premissa, f.fator);
        aplicadas.push({ premissa: `${f.premissa} ×${f.fator}`, antes, depois: lerCaminho(variada.premissas, f.premissa) as number });
      }
      if (input.unidadePreco) variada.unidadePreco = input.unidadePreco;
      if (input.criterio) variada.criterio = input.criterio;
      const problema = validarEntrada(variada);
      if (problema) {
        registrar("simular_variacao", input, `inválida: ${problema}`);
        return `A variação não é válida: ${problema}`;
      }
      const base = await baseVigente(escopo.companyId);
      const regras = regrasDeMargem(base);
      const rBase = simular(c.entrada);
      const rVar = simular(variada);
      const pBase = montarPainel(c.entrada, rBase, { ...regras, origem: c.origem });
      const pVar = montarPainel(variada, rVar, { ...regras, origem: c.origem });
      // Ao preço da base: o cenário do motor com o preço fixo e a utilização da
      // variação (só faz sentido na mesma unidade de preço).
      const precoBase = precoDoConjunto(rBase);
      const aoPreco = (e: EntradaSimulacao) => simular({ ...e, precoTesteKm: precoBase, utilizacoesCenario: [e.premissas.contrato.utilizacao] }).cenarios.linhas[0];
      const mesmaUnidade = (variada.unidadePreco ?? "KM") === (c.entrada.unidadePreco ?? "KM");
      const linhaBase = mesmaUnidade ? aoPreco(c.entrada) : null;
      const linhaVar = mesmaUnidade ? aoPreco(variada) : null;
      registrar("simular_variacao", input, `${aplicadas.map((a) => `${a.premissa}=${a.depois}`).join(", ") || "sem mudança de premissa"}: margem ${pctTxt(pBase.margem)} → ${pctTxt(pVar.margem)}`);
      return JSON.stringify({
        estudo: c.nome,
        versao: c.versao,
        mudancas: aplicadas,
        base: { ...resumoDoResultado(rBase), veredicto: pBase.veredicto },
        variacao: { ...resumoDoResultado(rVar), veredicto: pVar.veredicto, alertas: pVar.alertas.map((a) => a.titulo) },
        aoPrecoDaBase:
          linhaBase && linhaVar
            ? {
                preco: r2(precoBase, 4),
                unidade: ROTULO_UNIDADE[rBase.unidade],
                base: { lucro: r2(linhaBase.lucro), margem: pctTxt(linhaBase.margem) },
                variacao: { lucro: r2(linhaVar.lucro), margem: pctTxt(linhaVar.margem) },
                nota: "Conta dos cenários (preço único e tributos ponderados do conjunto): compare base com variação entre si; pode diferir pouco do lucro do lote acima.",
              }
            : "unidade de preço diferente da base: compare pelo preço novo",
        observacao: "Simulação sobre cópia; nada foi gravado no estudo.",
      });
    },
  });

  const custosReais = betaZodTool({
    name: "custos_reais",
    description:
      "Os custos REAIS da empresa medidos na controladoria nos últimos 12 meses fechados (DRE por categoria da Omie, cartão de combustível, frota e pessoas do sistema de gestão): preço do diesel, consumo por tipo de veículo, manutenção por km, encargos, seguro, etc., com a conta, a amostra e a confiança — e o que não pôde ser medido. Use para dizer se uma premissa do estudo está longe do que a empresa gasta de fato.",
    inputSchema: z.object({}),
    run: async () => {
      try {
        const dados = await carregarDadosReais(escopo.companyId, null, dataReferenciaPadrao());
        const a = analisarCustosReais(dados);
        registrar("custos_reais", {}, `${a.indicadores.length} indicador(es), ${a.lacunas.length} lacuna(s)`);
        return JSON.stringify({
          indicadores: a.indicadores.map((i) => ({ premissa: i.caminho, rotulo: i.rotulo, valor: r2(i.valor, 4), unidade: i.unidade, conta: i.base, periodo: i.periodo, amostra: i.amostra, confianca: i.confianca, avisos: i.avisos })),
          naoMedido: [...new Set([...dados.avisos, ...a.lacunas])],
        });
      } catch {
        registrar("custos_reais", {}, "falhou");
        return "Os custos reais não puderam ser lidos agora.";
      }
    },
  });

  const historicoDeDisputas = betaZodTool({
    name: "historico_de_disputas",
    description:
      "Os estudos com resultado registrado (ganho, perdido, desistência): nosso preço lançado, preço do vencedor, posição e a diferença. É o que diz onde o preço da empresa está em relação ao mercado.",
    inputSchema: z.object({}),
    run: async () => {
      const estudos = await prisma.simEstudo.findMany({
        where: { companyId: escopo.companyId, status: { in: ["GANHO", "PERDIDO", "DESISTENCIA", "EM_EXECUCAO", "ENCERRADO"] } },
        orderBy: { resultadoData: "desc" },
        take: LIMITE,
        include: { simulacoes: { where: { status: "LANCADA" }, orderBy: { versao: "desc" }, take: 1 }, lances: { orderBy: { dataHora: "desc" }, take: 1 } },
      });
      registrar("historico_de_disputas", {}, `${estudos.length} disputa(s) com resultado`);
      return JSON.stringify(
        estudos.map((e) => {
          const nosso = paraNumero(e.simulacoes[0]?.precoKm) ?? (e.lances[0] ? ((e.lances[0].precos as { preco: number }[] | null)?.[0]?.preco ?? null) : null);
          const vencedor = paraNumero(e.resultadoPrecoKm);
          return {
            nome: e.nome,
            servico: e.tipoServico,
            situacao: e.status,
            unidade: e.unidadePreco,
            nossoPreco: r2(nosso, 4),
            nossaMargemPrevista: pctTxt(paraNumero(e.simulacoes[0]?.margem)),
            precoVencedor: r2(vencedor, 4),
            diferenca: nosso && vencedor ? pctTxt(nosso / vencedor - 1) : null,
            posicao: e.resultadoPosicao,
            vencedor: e.resultadoVencedor,
            data: e.resultadoData?.toISOString().slice(0, 10) ?? null,
          };
        })
      );
    },
  });

  const baseDeCustos = betaZodTool({
    name: "base_de_custos",
    description:
      "A base de custos vigente do simulador (importada do Gabarito): parâmetros (jornada, indiretos, tributos, financeiro, insumos, margens da empresa), modelos da frota e mão de obra por função (piso da convenção, nunca salário de pessoa), com a fonte e a vigência.",
    inputSchema: z.object({}),
    run: async () => {
      const base = await baseVigente(escopo.companyId);
      registrar("base_de_custos", {}, `${base.parametros.size} parâmetro(s), ${base.veiculos.length} modelo(s), ${base.funcoes.length} função(ões)`);
      if (base.parametros.size + base.veiculos.length + base.funcoes.length === 0) return "A base de custos está vazia: os estudos usam os padrões do simulador (origem PADRAO).";
      const campos = (r: Record<string, unknown>, chaves: string[]) => Object.fromEntries(chaves.map((k) => [k, r[k] ?? null]));
      return JSON.stringify({
        parametros: [...base.parametros.entries()].map(([chave, v]) => ({ chave, valor: v.valor, texto: v.texto, fonte: v.fonte, desde: v.vigenciaInicio.toISOString().slice(0, 10) })),
        veiculos: base.veiculos.map((v) => campos(v, ["tipo", "modelo", "ano", "quantidade", "lotacao", "valorCompra", "valorFipe", "formaAquisicao", "taxaAa", "consumoKmL", "manutencaoKm", "seguroAnual", "ipvaLicenciamentoAnual", "idadeVenda", "revendaPctFipe"])),
        funcoes: base.funcoes.map((f) => campos(f, ["funcao", "cct", "regiao", "salarioBase", "adicionaisFixos", "encargosPct", "vrVa", "vrDia", "planoSaude", "absenteismoPct"])),
      });
    },
  });

  return [listarEstudos, lerEstudo, simularVariacao, custosReais, historicoDeDisputas, baseDeCustos];
}
