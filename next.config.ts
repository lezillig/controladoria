import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Extrato real de combustivel (RFCV) pode passar de 2MB (8mil+ linhas);
    // o limite padrao de Server Actions e 1MB.
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
