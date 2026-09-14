import type { OmieTitulo } from "@prisma/client";
import { fmtBRL, fmtPercent } from "../format";
import type { AchadoNovo, ContextoAuditoria } from "../types";
import { agrupar, chaveAchado, chaveParceiro, nomeParceiro, referenciaTitulo, somar } from "./comum";

// CR-RETENCAO-INDEVIDA — o tomador reteve o que a lei não manda reter
//
// Transporte de passageiros tem regras próprias de retenção, e a base já
// mostrou combinações que não batem com nenhuma tabela (7,70%, 10,70%).
// CR-RETENCAO-PRESUMIDA reconhece o PADRÃO da retenção; esta pergunta se a
// retenção é DEVIDA para aquele tipo de tomador — porque o que foi retido
// sem base é dinheiro a recuperar (PER/DCOMP) ou a contestar na próxima
// fatura.
//
// O que a lei diz (referências no docs/roadmap.md):
//   - PCC (PIS 0,65 + COFINS 3,00 + CSLL 1,00 = 4,65%) por tomador PRIVADO:
//     Lei 10.833 art. 30 lista limpeza, conservação, manutenção, segurança,
//     vigilância, transporte de VALORES, locação de mão de obra e serviços
//     profissionais — não transporte de passageiros. Retido por privado, é
//     indevido.
//   - Órgão FEDERAL: IN RFB 1234/2012 — transporte de passageiros retém
//     7,05% (código 6175). Percentual diferente merece conferência.
//   - ESTADO/MUNICÍPIO: a IN RFB 2145/2023 (STF Tema 1130) obriga a reter
//     só o IRRF pelas tabelas da IN 1234; PIS/COFINS/CSLL retidos por
//     prefeitura são indevidos.
//   - INSS 11% (Lei 8.212 art. 31) só com cessão de mão de obra; no
//     fretamento a Cosit entende que itinerário e horário preestabelecidos
//     caracterizam — questionável, e vale conferir o contrato.
//
// A classificação do tomador é por NOME (não há CNAE do cliente no espelho);
// a evidência mostra o tipo atribuído para quem for conferir. Um achado por
// cliente e trimestre; categoria OPORTUNIDADE (é recuperável), severidade
// pelo total retido indevidamente.
const TOMADOR_FEDERAL =
  /\b(uni[aã]o|minist[eé]rio|universidade federal|instituto federal|ebserh|funda[cç][aã]o nacional|ag[eê]ncia nacional|tribunal (regional|superior|de contas da uni)|justi[cç]a federal|receita federal|ex[eé]rcito|marinha|aeron[aá]utica|pol[ií]cia federal|\bufs?[a-z]{1,3}\b|ifsp|ifpr|ifmg|ifrj|petrobras|correios|caixa econ|banco do brasil)/i;
const TOMADOR_ESTADUAL_MUNICIPAL =
  /\b(prefeitura|munic[ií]pio|munic[ií]pal|secretaria|fundo (municipal|estadual)|c[aâ]mara|estado de|estado do|governo do|autarquia|funda[cç][aã]o (estadual|municipal)|departamento (estadual|municipal)|tribunal de justi|minist[eé]rio p[uú]blico|defensoria|assembleia|hospital (municipal|estadual)|sabesp|cetesb|metr[oô]|cptm|emtu|sptrans|detran|der\b)/i;

type TipoDeTomador = "federal" | "publico" | "privado";

export function tipoDeTomador(nome: string): TipoDeTomador {
  if (TOMADOR_FEDERAL.test(nome)) return "federal";
  if (TOMADOR_ESTADUAL_MUNICIPAL.test(nome)) return "publico";
  return "privado";
}

type Indevida = { t: OmieTitulo; tributo: string; valor: number; motivo: string };

function pontos(valor: number, base: number): number {
  return base > 0 ? Math.round((valor * 10000) / base) : 0;
}

export function retencaoIndevida(ctx: ContextoAuditoria, titulos: OmieTitulo[], materialidade: number): AchadoNovo[] {
  const achados: AchadoNovo[] = [];
  const indevidas: Indevida[] = [];

  for (const t of titulos) {
    if (t.valorDocumentoCents <= 0) continue;
    const pcc = t.retencaoPisCents + t.retencaoCofinsCents + t.retencaoCsllCents;
    const tipo = tipoDeTomador(nomeParceiro(ctx, t));
    if (tipo === "privado" && pcc > 0) {
      indevidas.push({
        t,
        tributo: "PIS/COFINS/CSLL",
        valor: pcc,
        motivo: `tomador privado reteve ${fmtPercent(pontos(pcc, t.valorDocumentoCents) / 100, 2)} de PCC — transporte de passageiros não está no art. 30 da Lei 10.833`,
      });
    }
    if (tipo === "publico" && pcc > 0) {
      indevidas.push({
        t,
        tributo: "PIS/COFINS/CSLL",
        valor: pcc,
        motivo: `estado/município só retém IRRF (IN RFB 2145/2023); PCC de ${fmtPercent(pontos(pcc, t.valorDocumentoCents) / 100, 2)} retido sem base`,
      });
    }
    if (tipo === "federal") {
      const total = t.retencaoIrCents + pcc;
      const p = pontos(total, t.valorDocumentoCents);
      // 7,05% é o código 6175 (transporte de passageiros). Outro percentual
      // relevante é retenção pelo código errado — normalmente maior.
      if (total > 0 && Math.abs(p - 705) > 10 && p > 705) {
        indevidas.push({
          t,
          tributo: "IR+PCC",
          valor: Math.round(total - (t.valorDocumentoCents * 705) / 10000),
          motivo: `órgão federal reteve ${fmtPercent(p / 100, 2)}; transporte de passageiros é 7,05% (IN 1234, cód. 6175)`,
        });
      }
    }
  }
  if (indevidas.length === 0) return [];

  const trimestre = (d: Date) => `${d.getFullYear()}-T${Math.floor(d.getMonth() / 3) + 1}`;
  for (const [chave, lista] of agrupar(indevidas, (i) => `${chaveParceiro(i.t)}|${trimestre(i.t.dataEmissao ?? i.t.dataVencimento)}`)) {
    const [cliente, periodo] = [chave.slice(0, chave.lastIndexOf("|")), chave.slice(chave.lastIndexOf("|") + 1)];
    const valor = somar(lista, (i) => i.valor);
    if (valor < materialidade / 4) continue;
    const nome = nomeParceiro(ctx, lista[0].t);
    const tipo = tipoDeTomador(nome);
    achados.push({
      regra: "CR-RETENCAO-INDEVIDA",
      tipo: "EVENTO",
      severidade: valor >= materialidade ? "MEDIA" : "BAIXA",
      categoria: "OPORTUNIDADE",
      titulo: `${nome}: ${fmtBRL(valor)} retidos sem base legal em ${lista.length} título(s) (${periodo})`,
      descricao:
        `Tomador classificado como ${tipo === "federal" ? "órgão federal" : tipo === "publico" ? "estado/município" : "privado"} pelo nome. ` +
        `${lista[0].motivo}. Retenção sem base é dinheiro que saiu da fatura e não virou crédito: cabe pedir a correção ao ` +
        `tomador ou recuperar via PER/DCOMP (o comprovante de retenção é o documento).`,
      recomendacao:
        "Confirmar o tipo do tomador e o contrato. Sendo indevida, solicitar ao tomador a retificação (DCTF/EFD-Reinf do " +
        "lado dele) ou pedir a restituição/compensação do valor retido. Ajustar o cadastro para as próximas faturas.",
      valorCents: valor,
      impactoCents: valor,
      dataReferencia: lista[lista.length - 1].t.dataEmissao ?? ctx.dataReferencia,
      entidadeTipo: "OmieParceiro",
      entidadeRef: nome,
      evidencia: {
        cliente: nome,
        tipoDeTomador: tipo,
        periodo,
        titulos: lista.slice(0, 20).map((i) => ({
          ref: referenciaTitulo(i.t),
          tributo: i.tributo,
          retido: i.valor,
          documento: i.t.valorDocumentoCents,
          motivo: i.motivo,
        })),
        retidoIndevidamente: valor,
      },
      chave: chaveAchado("CR-RETENCAO-INDEVIDA", cliente, periodo),
    });
  }
  return achados;
}
