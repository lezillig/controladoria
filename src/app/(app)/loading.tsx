import { larguraPainel } from "@/lib/ui";

// O RETORNO IMEDIATO DO CLIQUE. Sem este arquivo, a tela anterior ficava
// parada, sem sinal nenhum, até o servidor terminar a nova — e o sistema
// parecia travado mesmo quando só estava trabalhando. Com ele, o esqueleto
// aparece na hora e a tela troca sozinha quando chega.
export default function Carregando() {
  return (
    <div className={`${larguraPainel} animate-pulse space-y-6`} aria-busy="true" aria-label="Carregando">
      <div className="space-y-2">
        <div className="h-6 w-64 rounded bg-slate-200" />
        <div className="h-4 w-full max-w-2xl rounded bg-slate-100" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 rounded-2xl border border-slate-200 bg-white p-6">
            <div className="h-3 w-24 rounded bg-slate-200" />
            <div className="mt-4 h-6 w-36 rounded bg-slate-200" />
          </div>
        ))}
      </div>
      <div className="h-80 rounded-2xl border border-slate-200 bg-white" />
    </div>
  );
}
