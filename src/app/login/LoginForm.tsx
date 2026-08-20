"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { inputClass, labelClass, primaryButtonClass } from "@/lib/ui";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (res.ok) {
      // Destino único: este sistema tem uma porta de entrada só, o painel
      // financeiro. Quem não tem permissão sequer chega aqui — o login recusa
      // antes, com mensagem própria (ver a rota de login).
      router.push("/");
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Não foi possível entrar");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <label className={labelClass}>E-mail</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
          placeholder="admin@exemplo.com"
        />
      </div>
      <div>
        <label className={labelClass}>Senha</label>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
          placeholder="********"
        />
      </div>
      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <button type="submit" disabled={loading} className={`${primaryButtonClass} mt-2 w-full py-2.5`}>
        {loading ? "Entrando..." : "Entrar"}
      </button>
    </form>
  );
}
