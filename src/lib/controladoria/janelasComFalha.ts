import { prisma } from "@/lib/prisma";

// MESES EM QUE A LEITURA FALHOU E NINGUÉM SOUBE.
//
// A fase de notas fiscais é best-effort por decisão consciente: uma recusa da
// Omie em NF-e não pode impedir o relatório financeiro do dia, que é o núcleo
// do módulo. A decisão está certa. O que estava errado é o que vinha depois
// dela — a janela era marcada como CONCLUÍDA de qualquer jeito, o ciclo seguia
// para o mês seguinte, e aquele mês ficava para sempre sem nota.
//
// O erro não se perdia: ele era gravado em `OmieSyncRun.erro`. Mas ficava
// enterrado numa linha da lista de execuções, cortada em 160 caracteres, entre
// dezenas de execuções bem-sucedidas. Registrar sem mostrar é quase o mesmo que
// não registrar.
//
// Esta consulta traz esses meses para a superfície. Ela não conserta — o
// conserto é reler a janela na Omie —, mas responde à pergunta que a
// contabilidade fez de outro jeito: "o faturamento do sistema não bate com a
// declaração". Se um mês está aqui, ele é candidato imediato.

export type JanelaComFalha = {
  conexaoApelido: string;
  competencia: string;
  inicio: Date;
  fase: string;
  erro: string;
};

// O `erro` da execução acumula as mensagens de todas as fases separadas por
// " | ". O filtro é por palavra porque é assim que a mensagem é montada em
// sync.ts (`notas NFSE: ...`, `extrato conta 123: ...`).
export async function janelasComFalha(companyId: string, limite = 40): Promise<JanelaComFalha[]> {
  try {
    const runs = await prisma.omieSyncRun.findMany({
      where: { companyId, erro: { not: null } },
      orderBy: { janelaInicio: "desc" },
      take: limite,
      // O apelido vem pela relação: `OmieSyncRun` guarda só o id da conexão.
      // A execução do ciclo inteiro (não a de uma conexão) tem `conexaoId`
      // nulo, e aí o rótulo é "todas" — que é o que ela de fato cobre.
      select: {
        janelaInicio: true,
        fase: true,
        erro: true,
        conexao: { select: { apelido: true } },
      },
    });

    return runs.map((r) => ({
      conexaoApelido: r.conexao?.apelido ?? "todas",
      competencia: `${r.janelaInicio.getFullYear()}-${String(r.janelaInicio.getMonth() + 1).padStart(2, "0")}`,
      inicio: r.janelaInicio,
      fase: r.fase,
      // Mensagem inteira, não cortada: o texto é o diagnóstico. Cortar em 160
      // caracteres foi o que manteve isso invisível até agora.
      erro: r.erro ?? "",
    }));
  } catch {
    // A tela que mostra falhas não pode ser a próxima a falhar.
    return [];
  }
}

// Só as que mencionam notas fiscais. É o recorte que responde "por que o
// faturamento não bate", sem o ruído de falhas de extrato — que são esperadas
// e já têm sua própria explicação na tabela de saldos.
export function apenasNotas(janelas: JanelaComFalha[]): JanelaComFalha[] {
  return janelas.filter((j) => /\bnotas?\b|NFSE|NFE/i.test(j.erro));
}
