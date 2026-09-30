// O horário da rota: horas por dia e noturno (22h às 5h), e as rotas que o
// formulário cria com turnos, dias e horário.
import { horarioValido, jornadaDoHorario, minutosDoHorario } from "../src/lib/simulador/horario";
import { itensIniciais, perfilDasRotasNovas } from "../src/lib/simulador/estudos";
import { PERFIS_PADRAO } from "../src/lib/simulador/premissas";

let falhas = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  const passou = JSON.stringify(real) === JSON.stringify(esperado);
  if (!passou) falhas++;
  console.log(`  ${passou ? "ok  " : "FALHA"} ${nome}${passou ? "" : `\n         esperado ${JSON.stringify(esperado)}\n         obtido   ${JSON.stringify(real)}`}`);
}

console.log("HORÁRIO");
conferir("06:00 a 18:00: 12 h, diurno", jornadaDoHorario("06:00", "18:00"), { horas: 12, noturno: false });
conferir("05:00 a 22:00: 17 h, sem hora noturna (as bordas não contam)", jornadaDoHorario("05:00", "22:00"), { horas: 17, noturno: false });
conferir("04:30 a 13:00: começa de madrugada, noturno", jornadaDoHorario("04:30", "13:00"), { horas: 8.5, noturno: true });
conferir("14:00 a 23:30: passa das 22h, noturno", jornadaDoHorario("14:00", "23:30"), { horas: 9.5, noturno: true });
conferir("22:00 a 06:00: vira a meia-noite", jornadaDoHorario("22:00", "06:00"), { horas: 8, noturno: true });
conferir("horário inválido ou igual: nada", [jornadaDoHorario("25:00", "06:00"), jornadaDoHorario("08:00", "08:00"), jornadaDoHorario("", "10:00")], [null, null, null]);
conferir("minutos", [minutosDoHorario("7:05"), minutosDoHorario("07:5")], [425, null]);
conferir("validação: vazio vale, texto não", [horarioValido(null), horarioValido(""), horarioValido("18:30"), horarioValido("18h30")], [true, true, true, false]);

console.log("\nITENS DA PROPOSTA PRIVADA");
const fuVan = PERFIS_PADRAO.find((p) => p.tipo === "VAN")!.motorista.motoristasPorVeiculo;
const { rotas } = itensIniciais({
  nome: "Fábrica",
  tipoServico: "FRETAMENTO",
  tiposVeiculo: ["VAN"],
  itens: [
    { descricao: "Turnos", veiculos: 2, km: 6000, turnos: 3, diasMes: 26, horarioInicio: "05:00", horarioFim: "23:00" },
    { descricao: "Diretoria", veiculos: 1, administrativo: true, horarioInicio: "08:00", horarioFim: "18:00" },
    { descricao: "Sem nada", veiculos: 1 },
  ],
});
conferir("rota com turnos: dias, horas, noturno e motoristas × turnos", [rotas[0].diasMes, rotas[0].horasDia, rotas[0].noturno, rotas[0].turnos, rotas[0].motoristas], [26, 18, true, 3, Math.round(2 * fuVan * 3 * 100) / 100]);
conferir("km por dia nos dias informados", rotas[0].kmDia, Math.round((6000 / 26) * 10) / 10);
conferir("ADM sem km nasce com rota", [rotas[1].itemCodigo, rotas[1].administrativo, rotas[1].kmReferencia, rotas[1].horasDia], ["2", true, 0, 10]);
conferir("item sem km, ADM nem horário: sem rota", rotas.length, 2);
const perfis = [{ ...structuredClone(PERFIS_PADRAO.find((p) => p.tipo === "VAN")!), codigo: "BASE-1" }];
perfis[0].motorista.motoristasPorVeiculo = 1.5;
const r0 = { ...(rotas[0] as unknown as Parameters<typeof perfilDasRotasNovas>[0][number]), item: "1" };
conferir("ao abrir, motoristas pelo fator da base × turnos", perfilDasRotasNovas([r0], perfis)[0].motoristas, 2 * 1.5 * 3);

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
