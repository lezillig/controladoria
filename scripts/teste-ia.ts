// A IA DO SISTEMA — `npm run teste:ia`.
//
// 1. Sem banco e sem API: preço de cada chamada, o filtro de documento
//    pessoal, a impressão digital do prefixo e a decisão de retomada, o
//    andamento, a recomendação da triagem, a transcrição da segunda opinião e a
//    comparação das duas leituras de conformidade.
// 2. Com Postgres (TESTE_DATABASE_URL) e uma API SIMULADA aqui dentro (um
//    servidor HTTP local que responde como a Messages API): o laço inteiro da
//    investigação, o recomeço quando o prefixo muda, o aviso de último passo, o
//    recurso opcional recusado, a triagem, o lote do parecer mensal e a
//    conferência da leitura. A API de verdade nunca é chamada.
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { PrismaClient } from "@prisma/client";
import { custoMicroUsd, precoDoModelo } from "../src/lib/ia/precos";
import { comMascara, mascararDocumentosNoTexto } from "../src/lib/ia/mascara";
import { mesValido } from "../src/lib/ia/painel";
import {
  AVISO_DE_ULTIMO_PASSO,
  andamentoDe,
  decidirRetomada,
  esforcoDaPergunta,
  impressaoDoPrefixo,
  recomendacaoDaTriagem,
} from "../src/lib/controladoria/investigador";
import { especialistaPorId } from "../src/lib/controladoria/especialistas";
import { aberturaDaSegundaOpiniao, consultasDaConversa } from "../src/lib/controladoria/segundaOpiniao";
import { aberturaDaTriagem, montarAvisoDaTriagem } from "../src/lib/controladoria/triagem";
import { compararLeituras } from "../src/lib/conformidade/conferencia";
import { competenciaAnterior, competenciaValida } from "../src/lib/controladoria/parecerMensal";
import type { ApontamentoExtraido } from "../src/lib/conformidade/analise";

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "  ok  " : "FALHA "} ${nome}${ok ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         veio     ${JSON.stringify(real)}`}`);
}

function puros() {
  console.log("\nPreço de cada chamada");
  const milhao = { input_tokens: 1_000_000, output_tokens: 1_000_000 };
  conferir("Fable 5.2: US$ 8 de entrada + US$ 40 de saída", custoMicroUsd("claude-fable-5-2", milhao), { microUsd: 48_000_000, estimado: false });
  conferir("Fable 5.1 continua 10/50", custoMicroUsd("claude-fable-5-1", milhao).microUsd, 60_000_000);
  conferir("o 5.2 não sai pelo preço do 5 (prefixo mais específico vence)", precoDoModelo("claude-fable-5-2").preco.entrada, 8);
  conferir("Opus 5.5 não sai pelo preço do Opus 5", precoDoModelo("claude-opus-5-5").preco.entrada, 4);
  conferir("modelo com data no fim ainda é reconhecido", precoDoModelo("claude-sonnet-5-20260203").preco.saida, 10);
  conferir("em lote, metade", custoMicroUsd("claude-fable-5-2", milhao, { lote: true }).microUsd, 24_000_000);
  conferir(
    "cache lido a US$ 0,20 e gravado a US$ 10 por milhão no 5.2",
    custoMicroUsd("claude-fable-5-2", { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 }).microUsd,
    10_200_000
  );
  conferir("modelo desconhecido: cobrado pelo mais caro e marcado como estimado", custoMicroUsd("claude-modelo-novo", milhao), { microUsd: 60_000_000, estimado: true });
  conferir("Haiku 5.5 com prompt acima de 100 mil tokens custa 5x", [
    custoMicroUsd("claude-haiku-5-5", { input_tokens: 50_000, output_tokens: 0 }).microUsd,
    custoMicroUsd("claude-haiku-5-5", { input_tokens: 200_000, output_tokens: 0 }).microUsd,
  ], [5_000, 100_000]);

  console.log("\nDocumento pessoal não vai inteiro ao modelo");
  const m = mascararDocumentosNoTexto;
  conferir("CPF pontuado", m("motorista 529.982.247-25 recebeu"), "motorista ***.982.247-** recebeu");
  conferir("11 dígitos que fecham como CPF", m("doc 52998224725 ok"), "doc ***.982.247-** ok");
  conferir("11 dígitos que NÃO fecham como CPF ficam", m("pedido 12345678901"), "pedido 12345678901");
  conferir("CNPJ fica inteiro (é de empresa)", m("CNPJ 11.222.333/0001-81 e 11222333000181"), "CNPJ 11.222.333/0001-81 e 11222333000181");
  conferir("linha digitável não é mordida", m("34191790010104351004791020150008291070026000"), "34191790010104351004791020150008291070026000");
  conferir("campo cpf em JSON", m('{"cpf":"52998224725","nome":"X"}'), '{"cpf":"***.982.247-**","nome":"X"}');
  conferir("campo numeroCnh, mesmo sem fechar como CPF", m('{"numeroCnh":"01234567890"}'), '{"numeroCnh":"***.345.678-**"}');
  conferir("campo rg", m('{"rg": "12.345.678-9"}'), '{"rg": "***89"}');
  conferir("cpfCnpj com CNPJ fica", m('{"cpfCnpj":"11222333000181"}'), '{"cpfCnpj":"11222333000181"}');
  conferir("piso e administrativoCents não são documento", m('{"piso": 12345.67, "administrativoCents": 1234567}'), '{"piso": 12345.67, "administrativoCents": 1234567}');
  conferir("valor em reais não é mordido", m("total 12.345.678,90 e 98765432100,00"), "total 12.345.678,90 e 98765432100,00");
  conferir("número sob campo que não é de documento fica, mesmo fechando como CPF", m('{"valorCents": 52998224725, "codigoOmie":"52998224725"}'), '{"valorCents": 52998224725, "codigoOmie":"52998224725"}');
  conferir("campo documento do parceiro: CPF mascarado, número de nota não", m('{"documento":"52998224725"} {"numeroDocumento":"000123456"}'), '{"documento":"***.982.247-**"} {"numeroDocumento":"000123456"}');
  conferir("CPF solto numa observação", m('{"observacao":"pago ao motorista 52998224725 em dinheiro"}'), '{"observacao":"pago ao motorista ***.982.247-** em dinheiro"}');

  console.log("\nImpressão digital e retomada");
  const base = { modelo: "claude-fable-5-2", system: "prompt", ferramentas: [{ name: "a", description: "d", input_schema: { type: "object" } }] };
  conferir("a mesma entrada dá a mesma impressão", impressaoDoPrefixo(base), impressaoDoPrefixo({ ...base }));
  conferir("mudou o prompt, mudou", impressaoDoPrefixo(base) === impressaoDoPrefixo({ ...base, system: "prompt." }), false);
  conferir("mudou a descrição de uma ferramenta, mudou", impressaoDoPrefixo(base) === impressaoDoPrefixo({ ...base, ferramentas: [{ ...base.ferramentas[0], description: "outra" }] }), false);
  conferir("mudou o modelo, mudou", impressaoDoPrefixo(base) === impressaoDoPrefixo({ ...base, modelo: "claude-fable-5-1" }), false);
  conferir("sem resposta do modelo ainda: segue, mesmo com impressão diferente", decidirRetomada({ prefixoGravado: null, prefixoAtual: "x", temRespostaDoModelo: false, reinicios: 0 }), "seguir");
  conferir("mesma impressão: segue", decidirRetomada({ prefixoGravado: "x", prefixoAtual: "x", temRespostaDoModelo: true, reinicios: 0 }), "seguir");
  conferir("impressão mudou no meio: recomeça", decidirRetomada({ prefixoGravado: "x", prefixoAtual: "y", temRespostaDoModelo: true, reinicios: 0 }), "recomecar");
  conferir("investigação antiga, sem impressão gravada: recomeça", decidirRetomada({ prefixoGravado: null, prefixoAtual: "y", temRespostaDoModelo: true, reinicios: 0 }), "recomecar");
  conferir("mudou de novo depois de recomeçar: desiste", decidirRetomada({ prefixoGravado: "x", prefixoAtual: "y", temRespostaDoModelo: true, reinicios: 1 }), "desistir");

  console.log("\nAndamento, esforço e recomendação");
  conferir("andamento é o último raciocínio não vazio", andamentoDe([{ type: "thinking", thinking: "primeiro" }, { type: "thinking", thinking: "  segundo  passo " }, { type: "thinking", thinking: "" }, { type: "text" }]), "segundo passo");
  conferir("sem raciocínio legível, sem andamento", andamentoDe([{ type: "thinking", thinking: "" }, { type: "tool_use" }]), null);
  conferir("andamento longo é cortado", (andamentoDe([{ type: "thinking", thinking: "x".repeat(900) }]) ?? "").length, 400);
  conferir("resposta rápida: especialista em low, investigador em medium", [esforcoDaPergunta(especialistaPorId("controller"), "rapida"), esforcoDaPergunta(especialistaPorId("investigador"), "rapida")], ["low", "medium"]);
  conferir("parecer completo: o esforço do especialista", esforcoDaPergunta(especialistaPorId("controller"), "completa"), null);
  conferir("recomendação lida da última linha", recomendacaoDaTriagem("texto\nRECOMENDAÇÃO: SEGURAR — conta nova"), "SEGURAR");
  conferir("com negrito e sem acento", recomendacaoDaTriagem("**RECOMENDACAO:** **LIBERAR** — ok"), "LIBERAR");
  conferir("vale a última, se o texto citar o formato antes", recomendacaoDaTriagem("RECOMENDAÇÃO: SEGURAR\n...\nRECOMENDAÇÃO: VERIFICAR — falta dado"), "VERIFICAR");
  conferir("sem a linha, é VERIFICAR", recomendacaoDaTriagem("acho que pode pagar"), "VERIFICAR");

  console.log("\nSegunda opinião");
  const conversa = [
    { role: "user", content: "Pergunta" },
    { role: "assistant", content: [{ type: "thinking", thinking: "", signature: "s" }, { type: "tool_use", id: "t1", name: "listar_achados", input: { regra: "FR-X" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: '[{"id":"a1","cpf":"52998224725"}]' }] },
    { role: "assistant", content: [{ type: "text", text: "Conclusão" }] },
  ];
  conferir("as consultas saem da conversa, com o resultado", consultasDaConversa(conversa), [{ ferramenta: "listar_achados", entrada: { regra: "FR-X" }, resultado: '[{"id":"a1","cpf":"52998224725"}]' }]);
  const abertura = aberturaDaSegundaOpiniao({ pergunta: "Por que subiu?", especialista: "investigador", resposta: "Subiu por X.", erro: null, consultas: [], mensagens: conversa });
  conferir("a transcrição leva pergunta, consulta, resultado e conclusão", ["Por que subiu?", "listar_achados", "Devolveu:", "Subiu por X."].every((t) => abertura.includes(t)), true);
  conferir("e passa pelo filtro de documento", abertura.includes("52998224725"), false);
  conferir("investigação que não fechou diz isso", aberturaDaSegundaOpiniao({ pergunta: "p", especialista: "investigador", resposta: null, erro: "limite de consultas", consultas: [], mensagens: [] }).includes("Não fechou uma resposta (limite de consultas)"), true);

  console.log("\nTriagem");
  const achado = { id: "a1", regra: "FR-BOLETO-TROCADO", titulo: "Boleto com linha trocada", descricao: "desc", conexaoId: null, conexaoApelido: "Azul", entidadeRef: "Fornecedor X", valorCents: 1234500 };
  conferir("a abertura pede a linha de recomendação no formato lido", /RECOMENDAÇÃO: SEGURAR \| LIBERAR \| VERIFICAR/.test(aberturaDaTriagem(achado)), true);
  const aviso = montarAvisoDaTriagem(
    [
      { id: "i1", achadoTitulo: "Boleto <trocado>", regra: "FR-BOLETO-TROCADO", empresa: "Azul", valorCents: 1234500, status: "CONCLUIDA", recomendacao: "SEGURAR", resposta: "Conta nova.", erro: null, consultas: 4 },
      { id: "i2", achadoTitulo: "Outro", regra: "FR-CONTA-ALTERADA", empresa: "Azul", valorCents: null, status: "ERRO", recomendacao: null, resposta: null, erro: "limite", consultas: 1 },
    ],
    "https://exemplo.test"
  );
  conferir("assunto diz quantos são para segurar", aviso.assunto, "Triagem de fraude: 1 pagamento(s) para SEGURAR");
  conferir("HTML escapa o título e traz o link da investigação", [aviso.html.includes("Boleto &lt;trocado&gt;"), aviso.html.includes("https://exemplo.test/auditoria/investigar?id=i1")], [true, true]);
  conferir("triagem que falhou vira 'verificar', com o motivo", aviso.texto.includes("VERIFICAR ANTES DE PAGAR") && aviso.texto.includes("A triagem não fechou: limite"), true);

  console.log("\nConferência da leitura e parecer");
  const ap = (titulo: string) => ({ titulo }) as unknown as ApontamentoExtraido;
  conferir(
    "as duas leituras comparadas pela chave do assunto",
    compararLeituras(
      [{ id: "1", chaveRecorrencia: "FISCAL:a" }, { id: "2", chaveRecorrencia: "FISCAL:b" }],
      [{ chave: "FISCAL:a", apontamento: ap("A") }, { chave: "FISCAL:c", apontamento: ap("C") }, { chave: "FISCAL:c", apontamento: ap("C de novo") }]
    ),
    { confirmados: ["1"], naoConfirmados: ["2"], novos: [{ titulo: "C" }] }
  );
  conferir("competência anterior vira o ano em janeiro", [competenciaAnterior(new Date(2026, 10, 10)), competenciaAnterior(new Date(2027, 0, 5))], ["2026-10", "2026-12"]);
  conferir("competência e mês válidos", [competenciaValida("2026-13"), competenciaValida("2026-07"), mesValido("2026-7"), mesValido("2026-07")], [false, true, false, true]);
}

async function comMascaraNasFerramentas() {
  console.log("\nA máscara embrulha a ferramenta sem mudar a definição");
  const ferramenta = { name: "f", description: "d", run: async (x: { doc: string }) => `{"cpf":"${x.doc}"}` };
  const [embrulhada] = comMascara([ferramenta]);
  conferir("nome e descrição intactos", [embrulhada.name, embrulhada.description], ["f", "d"]);
  conferir("a saída sai mascarada", await embrulhada.run({ doc: "52998224725" }), '{"cpf":"***.982.247-**"}');
  const emBlocos = { name: "g", run: async () => [{ type: "text", text: "CPF 529.982.247-25" }, { type: "document", source: { type: "file", file_id: "file_abc12345" } }] };
  conferir("blocos de texto mascarados, documento intacto", await comMascara([emBlocos])[0].run(), [{ type: "text", text: "CPF ***.982.247-**" }, { type: "document", source: { type: "file", file_id: "file_abc12345" } }]);
}

// ---------------------------------------------------------------------------
// API simulada
// ---------------------------------------------------------------------------
type Pedido = { caminho: string; corpo: Record<string, unknown>; betas: string };
type Resposta = { status?: number; corpo: unknown };

const uso = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const mensagem = (content: unknown[], stop_reason: string, model = "claude-sonnet-5") => ({
  id: `msg_${Math.random().toString(36).slice(2)}`, type: "message", role: "assistant", model, content, stop_reason, stop_sequence: null, usage: uso,
});

async function comApiSimulada() {
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.TESTE_DATABASE_URL } } });
  const pedidos: Pedido[] = [];
  let fila: Resposta[] = [];
  const lotes = new Map<string, { customId: string; resultado: unknown }>();
  let proximoLote: unknown = null;

  const ler = (req: IncomingMessage) =>
    new Promise<string>((resolve) => {
      let dados = "";
      req.on("data", (c) => (dados += c));
      req.on("end", () => resolve(dados));
    });
  const servidor = createServer(async (req, res) => {
    const caminho = (req.url ?? "").split("?")[0];
    const responder = (status: number, corpo: unknown, tipo = "application/json") => {
      res.writeHead(status, { "content-type": tipo });
      res.end(typeof corpo === "string" ? corpo : JSON.stringify(corpo));
    };
    const texto = req.method === "POST" ? await ler(req) : "";
    const corpo = texto ? (JSON.parse(texto) as Record<string, unknown>) : {};
    pedidos.push({ caminho: `${req.method} ${caminho}`, corpo, betas: String(req.headers["anthropic-beta"] ?? "") });

    if (req.method === "POST" && caminho === "/v1/messages") {
      const proxima = fila.shift();
      if (!proxima) return responder(500, { type: "error", error: { type: "api_error", message: "a API simulada não tinha resposta na fila" } });
      return responder(proxima.status ?? 200, proxima.corpo);
    }
    if (req.method === "POST" && caminho === "/v1/messages/batches") {
      const id = `msgbatch_${lotes.size + 1}`;
      const pedido = (corpo.requests as { custom_id: string }[])[0];
      lotes.set(id, { customId: pedido.custom_id, resultado: proximoLote });
      return responder(200, { id, type: "message_batch", processing_status: "in_progress", request_counts: { processing: 1, succeeded: 0, errored: 0, canceled: 0, expired: 0 }, results_url: null });
    }
    const lote = caminho.match(/^\/v1\/messages\/batches\/(msgbatch_\d+)(\/results)?$/);
    if (req.method === "GET" && lote && lotes.has(lote[1])) {
      const base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
      if (!lote[2]) {
        return responder(200, { id: lote[1], type: "message_batch", processing_status: "ended", request_counts: { processing: 0, succeeded: 1, errored: 0, canceled: 0, expired: 0 }, results_url: `${base}/v1/messages/batches/${lote[1]}/results` });
      }
      const l = lotes.get(lote[1])!;
      return responder(200, `${JSON.stringify({ custom_id: l.customId, result: { type: "succeeded", message: l.resultado } })}\n`, "application/x-jsonl");
    }
    return responder(404, { type: "error", error: { type: "not_found_error", message: caminho } });
  });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  process.env.ANTHROPIC_API_KEY = "chave-de-teste";
  delete process.env.ANTHROPIC_WORKSPACE_ID;
  delete process.env.RESEND_API_KEY;
  process.env.DATABASE_URL = process.env.TESTE_DATABASE_URL;

  // Importados só agora: usam o prisma da aplicação, que lê DATABASE_URL.
  const { iniciarInvestigacao, avancarInvestigacao } = await import("../src/lib/controladoria/investigador");
  const { pedirSegundaOpiniao } = await import("../src/lib/controladoria/segundaOpiniao");
  const { abrirTriagens, avancarUmaTriagem, avisarTriagens } = await import("../src/lib/controladoria/triagem");
  const { situacaoDoTeto } = await import("../src/lib/ia/uso");
  const { coletarLotes } = await import("../src/lib/ia/lote");
  const { pedirParecerMensal } = await import("../src/lib/controladoria/parecerMensal");
  const { pedirConferencia } = await import("../src/lib/conformidade/conferencia");
  const { chaveRecorrencia } = await import("../src/lib/conformidade/tipos");
  const { resumoDoUso, chamadasDoUso, mesCorrente } = await import("../src/lib/ia/painel");

  const companyId = `teste-ia-${Date.now()}`;
  await prisma.controladoriaConfig.create({ data: { companyId, dataInicioBase: new Date(2025, 0, 1), emailsRelatorio: "" } });
  const conduzir = async (id: string) => {
    for (let i = 0; i < 30; i++) {
      const e = await avancarInvestigacao(id, companyId);
      if (e.status !== "EXECUTANDO") return e;
    }
    throw new Error("a investigação não terminou");
  };
  const nova = (extra: Partial<Parameters<typeof iniciarInvestigacao>[0]> = {}) =>
    iniciarInvestigacao({ companyId, conexaoId: null, empresa: "grupo", pergunta: "O que há de crítico em aberto?", userId: "u1", userNome: "Pessoa de Teste", ...extra });
  const ultimosPedidos = (n: number) => pedidos.filter((p) => p.caminho === "POST /v1/messages").slice(-n);

  try {
    console.log("\nInvestigação com ferramenta (API simulada)");
    fila = [
      { corpo: mensagem([{ type: "thinking", thinking: "Vou listar os achados críticos.", signature: "sig" }, { type: "tool_use", id: "tu1", name: "listar_achados", input: { severidade: "CRITICA" } }], "tool_use") },
      { corpo: mensagem([{ type: "text", text: "Não há achado crítico aberto." }], "end_turn") },
    ];
    const i1 = await nova();
    const f1 = await conduzir(i1.id);
    const [p1, p2] = ultimosPedidos(2);
    conferir("concluiu com a resposta do modelo", [f1.status, f1.resposta, f1.consultas.length], ["CONCLUIDA", "Não há achado crítico aberto.", 1]);
    conferir("pede o resumo do raciocínio e o esforço do especialista", [p1.corpo.thinking, (p1.corpo.output_config as { effort: string }).effort, p1.corpo.model], [{ type: "adaptive", display: "summarized" }, "high", "claude-sonnet-5"]);
    conferir("a segunda chamada devolve o raciocínio intacto e o resultado da ferramenta", (() => {
      const m = p2.corpo.messages as { role: string; content: { type: string; signature?: string }[] }[];
      return [m.length, m[1].content[0].signature, m[2].content[0].type];
    })(), [3, "sig", "tool_result"]);
    const usos = await prisma.iaUso.findMany({ where: { companyId, referenciaId: i1.id } });
    conferir("cada chamada virou uma linha de uso, com custo e a pessoa", [usos.length, usos.every((u) => u.custoMicroUsd === 7000 && u.userNome === "Pessoa de Teste" && u.origem === "investigador")], [2, true]);

    console.log("\nRetomada com o prefixo mudado");
    const i2 = await nova();
    await prisma.investigacao.update({
      where: { id: i2.id },
      data: { prefixoHash: "impressao-de-outro-deploy", iteracoes: 3, mensagens: [{ role: "user", content: "pergunta original" }, { role: "assistant", content: [{ type: "text", text: "meio do caminho" }] }] },
    });
    fila = [{ corpo: mensagem([{ type: "text", text: "Resposta depois do recomeço." }], "end_turn") }];
    const f2 = await conduzir(i2.id);
    const [p3] = ultimosPedidos(1);
    conferir("recomeçou só com a pergunta e fechou", [f2.status, (p3.corpo.messages as unknown[]).length, f2.consultas.some((c) => c.ferramenta === "recomeço")], ["CONCLUIDA", 1, true]);
    conferir("contou um recomeço", (await prisma.investigacao.findUniqueOrThrow({ where: { id: i2.id } })).reinicios, 1);

    console.log("\nÚltimo passo");
    const i3 = await nova({ profundidade: "rapida" });
    // Resposta rápida do investigador: seis idas. Com quatro já gastas, a
    // próxima é a penúltima.
    await prisma.investigacao.update({ where: { id: i3.id }, data: { iteracoes: 4 } });
    fila = [
      { corpo: mensagem([{ type: "tool_use", id: "tu9", name: "listar_achados", input: {} }], "tool_use") },
      { corpo: mensagem([{ type: "text", text: "Fecho com o que tenho." }], "end_turn") },
    ];
    const f3 = await conduzir(i3.id);
    const [, p5] = ultimosPedidos(2);
    const ultimaMensagem = (p5.corpo.messages as { content: { type: string; text?: string }[] }[]).at(-1)!;
    conferir("a penúltima ida leva o aviso de último passo junto do resultado", [f3.status, ultimaMensagem.content.at(-1)?.text === AVISO_DE_ULTIMO_PASSO, (p5.corpo.output_config as { effort: string }).effort], ["CONCLUIDA", true, "medium"]);

    console.log("\nRecurso opcional recusado pela API");
    await prisma.controladoriaConfig.update({ where: { companyId }, data: { iaOrcamentoTokensParecer: 50_000 } });
    fila = [
      { status: 400, corpo: { type: "error", error: { type: "invalid_request_error", message: "output_config.task_budget: Extra inputs are not permitted" } } },
      { corpo: mensagem([{ type: "text", text: "Parecer sem orçamento." }], "end_turn", "claude-fable-5-2") },
    ];
    const f4 = await conduzir((await nova({ especialista: "auditor" })).id);
    const [p6, p7] = ultimosPedidos(2);
    conferir("a primeira chamada levou o orçamento; recusada, a segunda foi sem ele e fechou", [
      (p6.corpo.output_config as { task_budget?: { total: number } }).task_budget?.total,
      p6.betas.includes("task-budgets-2026-03-13"),
      "task_budget" in (p7.corpo.output_config as object),
      f4.status,
    ], [50_000, true, false, "CONCLUIDA"]);

    console.log("\nSegunda opinião");
    const so = await pedirSegundaOpiniao({ investigacaoId: i1.id, companyId, userId: "u2", userNome: "Outra Pessoa" });
    conferir("abre no auditor, ligada à original", so.ok ? [so.estado.especialista, so.estado.origem, so.estado.origemId] : so.erro, ["auditor", "SEGUNDA_OPINIAO", i1.id]);
    const repetida = await pedirSegundaOpiniao({ investigacaoId: i1.id, companyId, userId: "u2", userNome: "Outra Pessoa" });
    conferir("pedir de novo reabre a mesma", so.ok && repetida.ok ? repetida.estado.id === so.estado.id : false, true);
    if (so.ok) {
      fila = [{ corpo: mensagem([{ type: "text", text: "A conclusão se sustenta." }], "end_turn", "claude-fable-5-2") }];
      await conduzir(so.estado.id);
      const [p8] = ultimosPedidos(1);
      const primeira = (p8.corpo.messages as { content: string }[])[0].content;
      conferir("o especialista recebe a transcrição do caminho", ["SEGUNDA OPINIÃO", "listar_achados", "Não há achado crítico aberto."].every((t) => primeira.includes(t)), true);
    }

    console.log("\nTriagem automática");
    const achado = await prisma.auditFinding.create({
      data: {
        companyId, agente: "antifraudeBoleto", regra: "FR-BOLETO-TROCADO", severidade: "CRITICA", categoria: "FRAUDE",
        titulo: "Boleto com linha diferente da registrada", descricao: "A linha digitável mudou depois do lançamento.", valorCents: 4_500_000, chave: `teste:${companyId}:1`,
      },
    });
    await prisma.auditFinding.create({
      data: { companyId, agente: "contasPagar", regra: "CP-VENCIDO", severidade: "CRITICA", categoria: "RISCO_FINANCEIRO", titulo: "Título vencido", descricao: "x", chave: `teste:${companyId}:2` },
    });
    conferir("abre triagem só para o crítico de antifraude", (await abrirTriagens(companyId)).abertas, 1);
    conferir("não abre de novo para o mesmo achado", (await abrirTriagens(companyId)).abertas, 0);
    fila = [{ corpo: mensagem([{ type: "text", text: "A conta de destino é nova.\n\nRECOMENDAÇÃO: SEGURAR — banco fora do hábito do fornecedor" }], "end_turn", "claude-fable-5-2") }];
    conferir("avança a triagem", await avancarUmaTriagem(companyId), true);
    const triada = await prisma.investigacao.findFirstOrThrow({ where: { companyId, origem: "TRIAGEM", achadoId: achado.id } });
    conferir("a recomendação fica gravada", [triada.status, triada.recomendacao, triada.especialista], ["CONCLUIDA", "SEGURAR", "auditor"]);
    conferir("sem e-mail configurado, nada é marcado como avisado", [await avisarTriagens(companyId), (await prisma.investigacao.findUniqueOrThrow({ where: { id: triada.id } })).avisadaEm], [0, null]);
    await prisma.controladoriaConfig.update({ where: { companyId }, data: { iaTetoMensalUsdCents: 1 } });
    await prisma.auditFinding.create({
      data: { companyId, agente: "antifraude", regra: "FR-CONTA-ALTERADA", severidade: "CRITICA", categoria: "FRAUDE", titulo: "Conta alterada", descricao: "x", chave: `teste:${companyId}:3` },
    });
    conferir("com o teto mensal atingido, a triagem não abre", [(await situacaoDoTeto(companyId)).estourado, await abrirTriagens(companyId)], [true, { abertas: 0, motivo: "teto mensal da IA atingido" }]);
    await prisma.controladoriaConfig.update({ where: { companyId }, data: { iaTetoMensalUsdCents: null, iaTriagemAutomatica: false } });
    conferir("desligada na configuração, também não", (await abrirTriagens(companyId)).motivo, "triagem automática desligada na configuração");

    console.log("\nParecer mensal em lote");
    const parecer = {
      resumoExecutivo: "O mês fechou estável.", resultado: [{ titulo: "Receita", texto: "Sem variação relevante." }], caixa: "Sem atraso relevante.",
      achadosNaoCorrigidos: "Nenhum.", achadosDoMes: "Um crítico surgiu.", decisoes: [{ decisao: "Manter", porque: "Estável", dadoQueSustenta: "Resultado do mês" }], limitacoes: [],
    };
    proximoLote = mensagem([{ type: "text", text: JSON.stringify(parecer) }], "end_turn", "claude-fable-5-2");
    const competencia = competenciaAnterior();
    const pedido = await pedirParecerMensal({ companyId, conexaoId: null, empresa: "grupo", competencia, pedidoPor: "Pessoa de Teste" });
    const noLote = pedidos.filter((p) => p.caminho === "POST /v1/messages/batches").at(-1)!;
    const parametros = (noLote.corpo.requests as { params: Record<string, unknown> }[])[0].params;
    conferir("o pedido vai em lote, no modelo dos especialistas, sem a cobertura que o lote não aceita", [pedido.ok, parametros.model, "fallbacks" in parametros], [true, "claude-fable-5-2", false]);
    conferir("pedir de novo não paga outro", await pedirParecerMensal({ companyId, conexaoId: null, empresa: "grupo", competencia, pedidoPor: "Outra" }), pedido.ok ? { ok: true, id: pedido.id, jaExistia: true } : null);
    conferir("a coleta recolhe o lote", (await coletarLotes({ companyId })).coletados, 1);
    const pronto = await prisma.parecerMensal.findFirstOrThrow({ where: { companyId, competencia } });
    conferir("o parecer fica pronto, com o briefing guardado", [pronto.status, (pronto.parecer as typeof parecer).resumoExecutivo, pronto.briefing.includes("## Achados de auditoria")], ["PRONTO", "O mês fechou estável.", true]);
    const usoDoLote = await prisma.iaUso.findFirstOrThrow({ where: { companyId, origem: "parecer_mensal" } });
    conferir("o uso em lote custa metade", [usoDoLote.lote, usoDoLote.custoMicroUsd], [true, 14_000]);
    conferir("parecer de mês que não fechou é recusado", (await pedirParecerMensal({ companyId, conexaoId: null, empresa: "grupo", competencia: "2999-01", pedidoPor: "x" })).ok, false);

    console.log("\nConferência da leitura de conformidade");
    const competenciaDoc = new Date(2026, 8, 1);
    const documento = await prisma.conformidadeDocumento.create({
      data: {
        companyId, titulo: "Relatório de setembro", competencia: competenciaDoc, arquivoNome: "relatorio.txt", mimeType: "text/plain", tamanhoBytes: 40,
        sha256: `sha-${companyId}`, conteudo: Buffer.from("Certidão municipal positiva. Guia de ISS não enviada."), extracao: "EXTRAIDO",
      },
    });
    const base = { companyId, documentoId: documento.id, competencia: competenciaDoc, primeiraCompetencia: competenciaDoc, descricao: "d", propostoPorIa: true };
    const a1 = await prisma.conformidadeApontamento.create({ data: { ...base, area: "FISCAL", titulo: "Certidão municipal positiva", chaveRecorrencia: chaveRecorrencia("FISCAL", "certidao municipal positiva") } });
    const a2 = await prisma.conformidadeApontamento.create({ data: { ...base, area: "FISCAL", titulo: "Balancete pendente", chaveRecorrencia: chaveRecorrencia("FISCAL", "balancete trimestral pendente") } });
    const item = (titulo: string, assuntoCanonico: string) => ({
      titulo, descricao: "d", area: "FISCAL", natureza: "RISCO", baseLegal: null, obrigacaoCodigo: null, severidade: "MEDIA", assuntoCanonico, recomendacao: null,
      trechoOrigem: "trecho", paginaOrigem: null, competenciaAlvo: null, valorEnvolvidoReais: null, prazoSugeridoDias: null,
    });
    proximoLote = mensagem(
      [{ type: "text", text: JSON.stringify({ resumo: "r", apontamentos: [item("Certidão positiva do município", "certidao municipal positiva"), item("Guia de ISS não enviada", "guia iss nao enviada")] }) }],
      "end_turn",
      "claude-fable-5-2"
    );
    conferir("a conferência é enviada em lote", await pedirConferencia({ documentoId: documento.id, companyId, userId: "u1", userNome: "Pessoa de Teste" }), { ok: true, jaPedida: false });
    conferir("pedir de novo com uma na fila não manda outra", await pedirConferencia({ documentoId: documento.id, companyId, userId: "u1", userNome: "Pessoa de Teste" }), { ok: true, jaPedida: true });
    await coletarLotes({ companyId });
    const depois = await prisma.conformidadeApontamento.findMany({ where: { companyId, documentoId: documento.id }, orderBy: { criadoEm: "asc" }, select: { id: true, titulo: true, conferencia: true, validado: true } });
    conferir("confirmado, só na primeira e só na segunda", [
      depois.find((x) => x.id === a1.id)?.conferencia,
      depois.find((x) => x.id === a2.id)?.conferencia,
      depois.filter((x) => x.conferencia === "SO_NA_SEGUNDA").map((x) => [x.titulo, x.validado]),
    ], ["CONFIRMADO", "NAO_CONFIRMADO", [["Guia de ISS não enviada", false]]]);
    const conferido = await prisma.conformidadeDocumento.findUniqueOrThrow({ where: { id: documento.id } });
    conferir("o documento guarda o resultado da conferência", [conferido.conferenciaModelo, conferido.conferenciaResumo], ["claude-fable-5-2", "1 confirmado(s) pelas duas leituras, 1 só na primeira, 1 só na segunda (entraram como proposta)."]);

    console.log("\nPainel de uso");
    const filtro = { companyId, mes: mesCorrente() };
    const resumo = await resumoDoUso(filtro);
    const tudo = await chamadasDoUso(filtro, 500);
    conferir("o cartão e a lista somam o mesmo", [resumo.microUsd, resumo.chamadas], [tudo.microUsd, tudo.total]);
    conferir("os quadros somam o cartão", [resumo.porOrigem, resumo.porModelo, resumo.porUsuario].map((g) => g.reduce((s, x) => s + x.microUsd, 0)), [resumo.microUsd, resumo.microUsd, resumo.microUsd]);
    const soLote = await chamadasDoUso({ ...filtro, lote: true });
    conferir("o cartão de lote abre só as chamadas em lote, com a mesma soma", [soLote.microUsd, soLote.linhas.every((l) => l.lote)], [resumo.loteMicroUsd, true]);
    const porFuncao = await chamadasDoUso({ ...filtro, origem: "triagem" });
    conferir("a linha de uma função abre só ela", [porFuncao.total, porFuncao.microUsd], [1, resumo.porOrigem.find((g) => g.chave === "triagem")?.microUsd]);
    conferir("a fila da API simulada ficou vazia (nenhuma chamada a mais ou a menos)", fila.length, 0);
  } finally {
    servidor.close();
    await prisma.$disconnect();
  }
}

async function main() {
  puros();
  await comMascaraNasFerramentas();
  if (process.env.TESTE_DATABASE_URL) await comApiSimulada();
  else console.log("\n(sem TESTE_DATABASE_URL: os testes com banco e API simulada foram pulados)");
  console.log(falhas === 0 ? "\nTodos os testes passaram.\n" : `\n${falhas} FALHA(S).\n`);
  process.exit(falhas === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
