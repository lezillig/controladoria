// Manutenção pela idade do veículo (curva ANTP/NTU): o fator nos anos do
// contrato, o ano do veículo ↔ idade, e o efeito no motor.
import { anoDaIdade, coeficienteDaIdade, fatorManutencaoPorIdade, fracaoForaDaGarantia, idadeDoAno } from "../src/lib/simulador/idadeManutencao";
import { PERFIS_PADRAO, PREMISSAS_PADRAO } from "../src/lib/simulador/premissas";
import { simular } from "../src/lib/simulador/motor";
import { historicoSaoJoseDosPinhais } from "../src/lib/simulador/historico";

let falhas = 0;
const perto = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) < tol;
function ok(nome: string, passou: boolean, detalhe = "") {
  if (!passou) falhas++;
  console.log(`  ${passou ? "ok  " : "FALHA"} ${nome}${passou || !detalhe ? "" : ` — ${detalhe}`}`);
}

console.log("CURVA ANTP");
ok("faixas: 6% (0–2), 7%, 8%, 9%, 10% (8–10), 12% (10+)", [0.5, 2.5, 4.5, 6.5, 8.5, 12].map(coeficienteDaIdade).join() === "0.06,0.07,0.08,0.09,0.1,0.12");

console.log("\nFATOR NO CONTRATO");
ok("sem idade de referência (versão antiga): 1", fatorManutencaoPorIdade({ idadeInicialAnos: 9 }, 36) === 1);
ok("veículo novo, 12 meses, referência 0: 1", perto(fatorManutencaoPorIdade({ idadeInicialAnos: 0, idadeReferenciaManutencao: 0 }, 12), 1));
ok("veículo novo, 36 meses: envelhece no contrato (6, 6, 7) ÷ 6", perto(fatorManutencaoPorIdade({ idadeInicialAnos: 0, idadeReferenciaManutencao: 0 }, 36), (0.06 + 0.06 + 0.07) / 3 / 0.06));
ok("van de 2018 num contrato de 2026 (8 anos), 12 meses, referência 0: 10 ÷ 6", perto(fatorManutencaoPorIdade({ idadeInicialAnos: idadeDoAno(2018, 2026), idadeReferenciaManutencao: 0 }, 12), 0.1 / 0.06));
ok("ônibus de 12 anos sobre referência 8: 12 ÷ 10", perto(fatorManutencaoPorIdade({ idadeInicialAnos: 12, idadeReferenciaManutencao: 8 }, 12), 1.2));
ok("veículo mais novo que a referência: fator menor que 1", fatorManutencaoPorIdade({ idadeInicialAnos: 0, idadeReferenciaManutencao: 8 }, 12) < 1);
ok("ano ↔ idade", idadeDoAno(2020, 2026) === 6 && anoDaIdade(6, 2026) === 2020 && idadeDoAno(2027, 2026) === 0);

console.log("\nPADRÕES");
ok("estudo novo: referência 0 no veículo padrão", PREMISSAS_PADRAO.veiculo.idadeReferenciaManutencao === 0);
const onibus = PERFIS_PADRAO.find((p) => p.tipo === "ONIBUS")!;
ok("ônibus padrão: usado de 8 anos, manutenção informada para 8 anos", onibus.veiculo.idadeInicialAnos === 8 && onibus.veiculo.idadeReferenciaManutencao === 8);

console.log("\nNO MOTOR");
const base = structuredClone(historicoSaoJoseDosPinhais().entrada);
const van = structuredClone(PERFIS_PADRAO.find((p) => p.tipo === "VAN")!);
// Só a curva de idade: sem a corretiva (que depende da garantia, testada abaixo).
van.variaveis.corretivaKm = 0;
base.premissas.perfis = [{ ...van, codigo: "V" }];
base.premissas.contrato.vigenciaMeses = 12;
for (const r of base.rotas) r.perfilVeiculo = "V";
const manut = (idade: number) => {
  const e = structuredClone(base);
  e.premissas.perfis![0].veiculo.idadeInicialAnos = idade;
  return simular(e).itens.reduce((a, i) => a + i.manutencao, 0);
};
const nova = manut(0);
const velha = manut(8);
ok("van de 8 anos gasta 10 ÷ 6 da nova em manutenção por km", nova > 0 && perto(velha / nova, 0.1 / 0.06, 1e-9), `${velha / nova}`);
const semCurva = structuredClone(base);
delete semCurva.premissas.perfis![0].veiculo.idadeReferenciaManutencao;
semCurva.premissas.perfis![0].veiculo.idadeInicialAnos = 8;
ok("versão salva sem a referência não muda", perto(simular(semCurva).itens.reduce((a, i) => a + i.manutencao, 0), nova));

console.log("\nGARANTIA E CORRETIVA");
ok("sem prazo nem km: fora da garantia o contrato todo", fracaoForaDaGarantia({ idadeInicialAnos: 0 }, 24, 5000) === 1);
ok("van nova, 2 anos de garantia, contrato de 24 meses: toda na garantia", fracaoForaDaGarantia({ idadeInicialAnos: 0, garantiaMeses: 24, garantiaKm: null }, 24, 8000) === 0);
ok("van nova, 2 anos, contrato de 36 meses: 1/3 fora", perto(fracaoForaDaGarantia({ idadeInicialAnos: 0, garantiaMeses: 24 }, 36, 8000), 1 / 3));
ok("carro novo 3 anos/100 mil km a 5 mil km/mês: acaba em 20 meses pelo km", perto(fracaoForaDaGarantia({ idadeInicialAnos: 0, garantiaMeses: 36, garantiaKm: 100000 }, 36, 5000), 16 / 36));
ok("carro de 2 anos a 5 mil km/mês (120 mil km): já fora", fracaoForaDaGarantia({ idadeInicialAnos: 2, garantiaMeses: 36, garantiaKm: 100000 }, 24, 5000) === 1);
const comCorretiva = (meses: number) => {
  const e = structuredClone(base);
  e.premissas.contrato.vigenciaMeses = meses;
  e.premissas.perfis![0].variaveis.corretivaKm = 0.08;
  e.premissas.perfis![0].veiculo.idadeInicialAnos = 0;
  return simular(e).itens.reduce((a, i) => a + i.manutencao, 0);
};
const semCorr = (meses: number) => {
  const e = structuredClone(base);
  e.premissas.contrato.vigenciaMeses = meses;
  e.premissas.perfis![0].veiculo.idadeInicialAnos = 0;
  return simular(e).itens.reduce((a, i) => a + i.manutencao, 0);
};
ok("no motor: van nova em 24 meses de garantia não paga corretiva", perto(comCorretiva(24), semCorr(24)));
ok("no motor: em 36 meses paga corretiva no último ano", comCorretiva(36) > semCorr(36));

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
