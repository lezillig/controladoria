import { timingSafeEqual } from "crypto";

// Quem pode chamar as rotas do ciclo: o agendamento da Vercel e o condutor do
// GitHub Actions, com o CRON_SECRET no cabeçalho Authorization.
export function autorizado(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const recebido = req.headers.get("authorization") ?? "";
  const esperado = `Bearer ${secret}`;
  // Comparação em tempo constante: `===` em string vaza, pelo tempo de
  // resposta, o tamanho do prefixo correto — o suficiente para descobrir o
  // segredo caractere a caractere com requisições repetidas.
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
