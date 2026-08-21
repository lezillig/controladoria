import type { NextConfig } from "next";

// Cabeçalhos de segurança em TODA resposta.
//
// Nenhum deles conserta uma falha específica deste código — eles fecham
// classes inteiras de ataque que dependem da cooperação do navegador. Num
// sistema que mostra o caixa e os títulos de duas empresas, o custo de não ter
// é alto e o de ter é zero.
const CABECALHOS_DE_SEGURANCA = [
  // Nunca mais falar HTTP com este domínio, nem no primeiro acesso do dia.
  // Sem isso, uma rede hostil consegue rebaixar a conexão antes do
  // redirecionamento para HTTPS e ler o cookie de sessão em trânsito.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },

  // Enquadrar a página num iframe de terceiro é o que torna clickjacking
  // possível: a vítima logada clica no que acha ser outro site e aciona uma
  // ação aqui. `frame-ancestors` é a forma moderna; `X-Frame-Options` cobre
  // navegador antigo que ainda não a respeita.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },

  // Impede o navegador de "adivinhar" o tipo de um arquivo servido. Sem isso,
  // um documento da consultoria enviado por alguém poderia ser interpretado
  // como HTML e executar script na origem do sistema.
  { key: "X-Content-Type-Options", value: "nosniff" },

  // O caminho da URL aqui carrega informação — id de título, de achado, de
  // documento. Mandá-lo no `Referer` para um site externo vazaria isso; a
  // origem sozinha basta.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

  // Nada neste sistema precisa de câmera, microfone ou localização. Desligar
  // por padrão significa que um script injetado também não os alcança.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  experimental: {
    // Extrato real de combustivel (RFCV) pode passar de 2MB (8mil+ linhas);
    // o limite padrao de Server Actions e 1MB.
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: CABECALHOS_DE_SEGURANCA }];
  },
};

export default nextConfig;
