import { GRUPOS_HABILITACAO } from "./editalParaEstudo";
export { lerPremissasDoEdital } from "./premissasDoEdital";
import type { ItemNovo } from "./estudos";
import { horarioValido } from "./horario";
import { lerNumero } from "./numeros";
import { TIPOS_VEICULO, type TipoVeiculo } from "./tipos";

// O FORMULÁRIO DE NOVO ESTUDO, lido no servidor: os itens (com as rotas do
// edital importado), as regras e os documentos de habilitação, em JSON. Fica
// fora de actions.ts para o teste do edital passar pelo mesmo caminho da tela.

// Os itens do formulário de novo estudo, em JSON: números como a pessoa
// digitou (pt-BR), lidos por lerNumero; texto inválido volta como erro.
export function lerItensNovos(bruto: string | null): ItemNovo[] | string {
  if (!bruto) return [];
  let lista: unknown;
  try {
    lista = JSON.parse(bruto);
  } catch {
    return "Itens do estudo ilegíveis.";
  }
  if (!Array.isArray(lista) || lista.length > 100) return "Itens do estudo: máximo de 100.";
  const itens: ItemNovo[] = [];
  for (const [k, x] of lista.entries()) {
    const o = (x ?? {}) as Record<string, unknown>;
    const num = (v: unknown) => (v === undefined || v === null || String(v).trim() === "" ? null : (lerNumero(String(v)) ?? NaN));
    const [veiculos, km, precoMaximoKm] = [num(o.veiculos), num(o.km), num(o.precoMaximoKm)];
    for (const [v, rotulo] of [[veiculos, "veículos"], [km, "km"], [precoMaximoKm, "preço máximo"]] as const)
      if (v !== null && (!Number.isFinite(v) || v < 0 || v > 1e9)) return `Item ${k + 1}: ${rotulo} inválido.`;
    const tipo = String(o.tipoVeiculo ?? "");
    const [turnos, diasMes] = [num(o.turnos), num(o.diasMes)];
    if (turnos !== null && !(Number.isInteger(turnos) && turnos >= 1 && turnos <= 4)) return `Item ${k + 1}: turnos de 1 a 4.`;
    if (diasMes !== null && !(Number.isInteger(diasMes) && diasMes >= 1 && diasMes <= 31)) return `Item ${k + 1}: dias no mês de 1 a 31, inteiro.`;
    const horario = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, 5) : null);
    const [inicio, fim] = [horario(o.horarioInicio), horario(o.horarioFim)];
    if (!horarioValido(inicio) || !horarioValido(fim)) return `Item ${k + 1}: horário no formato 06:30.`;
    const monitoras = num(o.monitoras);
    if (monitoras !== null && (!Number.isFinite(monitoras) || monitoras < 0 || monitoras > 10)) return `Item ${k + 1}: monitores por veículo de 0 a 10.`;
    // As rotas do item (importação do edital): mesma validação, linha a linha.
    const rotasBrutas = Array.isArray(o.rotas) ? (o.rotas as unknown[]) : [];
    if (rotasBrutas.length > 300) return `Item ${k + 1}: máximo de 300 rotas.`;
    const rotas: NonNullable<ItemNovo["rotas"]> = [];
    for (const [j, y] of rotasBrutas.entries()) {
      const r = (y ?? {}) as Record<string, unknown>;
      const [rv, rkm, rkmDia, rt, rm] = [num(r.veiculos), num(r.km), num(r.kmDia), num(r.turnos), num(r.monitoras)];
      for (const [v, rotulo] of [[rv, "veículos"], [rkm, "km"], [rkmDia, "km/dia"], [rm, "monitores"]] as const)
        if (v !== null && (!Number.isFinite(v) || v < 0 || v > 1e9)) return `Item ${k + 1}, rota ${j + 1}: ${rotulo} inválido.`;
      if (rt !== null && !(Number.isInteger(rt) && rt >= 1 && rt <= 4)) return `Item ${k + 1}, rota ${j + 1}: turnos de 1 a 4.`;
      const [ri, rf] = [horario(r.horarioInicio), horario(r.horarioFim)];
      if (!horarioValido(ri) || !horarioValido(rf)) return `Item ${k + 1}, rota ${j + 1}: horário no formato 06:30.`;
      const rtipo = String(r.tipoVeiculo ?? "");
      rotas.push({
        nome: String(r.nome ?? "").slice(0, 200),
        tipoVeiculo: (TIPOS_VEICULO as string[]).includes(rtipo) ? (rtipo as TipoVeiculo) : null,
        veiculos: rv,
        km: rkm,
        kmDia: rkmDia,
        horarioInicio: ri,
        horarioFim: rf,
        turnos: rt,
        monitoras: rm,
      });
    }
    itens.push({
      descricao: String(o.descricao ?? "").slice(0, 200),
      tipoVeiculo: (TIPOS_VEICULO as string[]).includes(tipo) ? (tipo as TipoVeiculo) : null,
      veiculos,
      km,
      precoMaximoKm,
      administrativo: o.administrativo === true,
      turnos,
      diasMes,
      horarioInicio: inicio,
      horarioFim: fim,
      monitoras,
      rotas,
    });
  }
  return itens;
}

// As regras do edital importado (exigências e suposições da leitura), como o
// formulário as devolve. Texto curto, no máximo 150.
export function lerRegrasDoEdital(bruto: string | null): { tema: string; texto: string; fonte: string | null }[] {
  if (!bruto) return [];
  try {
    const lista = JSON.parse(bruto);
    if (!Array.isArray(lista)) return [];
    return lista
      .slice(0, 150)
      .map((x) => (x ?? {}) as Record<string, unknown>)
      .filter((o) => typeof o.texto === "string" && o.texto.trim() !== "")
      .map((o) => ({ tema: String(o.tema ?? "OUTRO").slice(0, 40), texto: String(o.texto).slice(0, 1000), fonte: typeof o.fonte === "string" && o.fonte.trim() ? o.fonte.slice(0, 200) : null }));
  } catch {
    return [];
  }
}

// Os documentos de habilitação do edital importado, como o formulário os
// devolve. Grupo fora da lista vira OUTRO; no máximo 100.
export function lerHabilitacaoDoEdital(bruto: string | null): { grupo: string; documento: string; exigencia: string | null; fonte: string | null }[] {
  if (!bruto) return [];
  try {
    const lista = JSON.parse(bruto);
    if (!Array.isArray(lista)) return [];
    return lista
      .slice(0, 100)
      .map((x) => (x ?? {}) as Record<string, unknown>)
      .filter((o) => typeof o.documento === "string" && o.documento.trim() !== "")
      .map((o) => ({
        grupo: (GRUPOS_HABILITACAO as readonly string[]).includes(String(o.grupo)) ? String(o.grupo) : "OUTRO",
        documento: String(o.documento).trim().slice(0, 500),
        exigencia: typeof o.exigencia === "string" && o.exigencia.trim() ? o.exigencia.trim().slice(0, 1000) : null,
        fonte: typeof o.fonte === "string" && o.fonte.trim() ? o.fonte.slice(0, 200) : null,
      }));
  } catch {
    return [];
  }
}
