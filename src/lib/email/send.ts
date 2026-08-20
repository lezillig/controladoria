// Envio de e-mail. Provedor: Resend (definido com o usuario), acessado por
// HTTP direto — sem SDK e sem nodemailer.
//
// Duas razoes para nao adicionar dependencia aqui: (1) o projeto roda em
// funcao serverless, onde cada pacote a mais e tempo de cold start em toda
// requisicao, inclusive nas que nao enviam e-mail; (2) a superficie que este
// modulo usa da API do Resend e um POST com JSON — um SDK inteiro para isso
// seria peso sem retorno.
//
// A funcao de envio e a UNICA porta de saida de e-mail do sistema. Trocar de
// provedor (Brevo, SendGrid, SMTP) e reescrever este arquivo, e nada mais.

const RESEND_URL = "https://api.resend.com/emails";

export function isEnvioDisponivel(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

// Remetente. Precisa ser de um dominio verificado no Resend — enviar de um
// dominio nao verificado e recusado pela API, e enviar de um dominio de
// terceiro (gmail.com) reprova em SPF/DKIM e cai em spam.
const REMETENTE_PADRAO = process.env.EMAIL_REMETENTE ?? "Controladoria Azul Mob <controladoria@azulmob.com.br>";

export type ResultadoEnvio = {
  enviado: boolean;
  id: string | null;
  erro: string | null;
};

export async function enviarEmail(params: {
  para: string[];
  assunto: string;
  html: string;
  // Alternativa em texto puro. Vai junto, sempre: cliente de e-mail que
  // bloqueia HTML (ou leitor de tela) recebe o conteudo, e a presenca da
  // parte texto melhora a reputacao antispam da mensagem.
  texto: string;
}): Promise<ResultadoEnvio> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { enviado: false, id: null, erro: "RESEND_API_KEY não configurada — envio de e-mail desativado." };
  }
  if (params.para.length === 0) {
    return { enviado: false, id: null, erro: "Nenhum destinatário configurado." };
  }

  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: REMETENTE_PADRAO,
        to: params.para,
        subject: params.assunto,
        html: params.html,
        text: params.texto,
      }),
    });

    const corpo = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };

    if (!res.ok) {
      // A mensagem de erro e persistida em RelatorioDiario.erro e mostrada na
      // UI — por isso nunca inclui a chave, so o motivo.
      return {
        enviado: false,
        id: null,
        erro: `Resend respondeu ${res.status}: ${corpo.message ?? corpo.name ?? "erro desconhecido"}`.slice(0, 500),
      };
    }

    return { enviado: true, id: corpo.id ?? null, erro: null };
  } catch (e) {
    return {
      enviado: false,
      id: null,
      erro: `Falha de rede ao enviar e-mail: ${e instanceof Error ? e.message : "erro desconhecido"}`,
    };
  }
}
