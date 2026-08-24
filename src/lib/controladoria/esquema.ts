import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// O BANCO REALMENTE TEM AS COLUNAS QUE O CÓDIGO ESPERA?
//
// A pergunta parece supérflua — `prisma migrate deploy` roda a cada publicação
// e falha ruidosamente quando não consegue aplicar uma migração. Mas ele só
// aplica o que ainda não está marcado como aplicado; um banco cuja tabela veio
// de um `db push` antigo, ou que foi apontado para outro servidor no meio do
// caminho, passa por ele em silêncio, com a migração marcada e a tabela velha.
//
// Foi exatamente o que aconteceu: a tela de resultado morria com
// `column cat.conexaoId does not exist` enquanto a mesma consulta rodava limpa
// em qualquer banco criado do zero pelas migrações deste repositório. Não havia
// como descobrir isso lendo o código — o código estava certo.
//
// O QUE ISTO FAZ: compara o modelo de dados do Prisma (a fonte da verdade do
// repositório) com o `information_schema` do banco que está atendendo AGORA, e
// lista o que falta. Uma consulta, alguns kilobytes, e a diferença deixa de ser
// invisível.
//
// O que ele NÃO faz: consertar. Acrescentar coluna sozinho, em produção, a
// partir de uma comparação automática, é como se apaga um banco sem querer. A
// tela mostra; a correção é uma migração escrita, revisada e aplicada.

export type ColunaFaltante = { tabela: string; coluna: string; tipo: string; obrigatoria: boolean };
// Coluna que EXISTE mas aceita nulo onde o modelo exige valor. Merece linha
// própria: depois de um reparo que acrescenta a coluna sem preencher, a
// checagem de existência fica verde e o problema continua lá — a gravação
// passa a falhar por violação de restrição em vez de por coluna ausente.
export type ColunaOpcionalDemais = { tabela: string; coluna: string };
export type DriftDoEsquema = {
  // Falso quando não foi possível ler o catálogo — que é diferente de "está
  // tudo certo", e a tela precisa saber a diferença.
  disponivel: boolean;
  tabelasFaltantes: string[];
  colunasFaltantes: ColunaFaltante[];
  colunasOpcionaisDemais: ColunaOpcionalDemais[];
};

type LinhaCatalogo = { tabela: string; coluna: string; anulavel: string };

// Nome físico do modelo/campo: o Prisma permite renomear com `@@map`/`@map`, e
// comparar pelo nome do modelo daria falso positivo em qualquer campo mapeado.
function nomeFisico(x: { name: string; dbName?: string | null }): string {
  return x.dbName ?? x.name;
}

export async function driftDoEsquema(): Promise<DriftDoEsquema> {
  let catalogo: LinhaCatalogo[];
  try {
    catalogo = await prisma.$queryRaw<LinhaCatalogo[]>`
      SELECT table_name AS tabela, column_name AS coluna, is_nullable AS anulavel
        FROM information_schema.columns
       WHERE table_schema = current_schema()
    `;
  } catch {
    return { disponivel: false, tabelasFaltantes: [], colunasFaltantes: [], colunasOpcionaisDemais: [] };
  }

  const colunasPorTabela = new Map<string, Map<string, boolean>>();
  for (const linha of catalogo) {
    const mapa = colunasPorTabela.get(linha.tabela) ?? new Map<string, boolean>();
    mapa.set(linha.coluna, linha.anulavel === "YES");
    colunasPorTabela.set(linha.tabela, mapa);
  }

  const tabelasFaltantes: string[] = [];
  const colunasFaltantes: ColunaFaltante[] = [];
  const colunasOpcionaisDemais: ColunaOpcionalDemais[] = [];

  for (const modelo of Prisma.dmmf.datamodel.models) {
    const tabela = nomeFisico(modelo);
    const existentes = colunasPorTabela.get(tabela);
    if (!existentes) {
      tabelasFaltantes.push(tabela);
      continue;
    }

    for (const campo of modelo.fields) {
      // Relações não são coluna: a chave estrangeira que as sustenta já aparece
      // como campo escalar próprio. Listá-las encheria o relatório de ruído.
      if (campo.kind === "object") continue;
      const coluna = nomeFisico(campo);
      const anulavel = existentes.get(coluna);

      if (anulavel === undefined) {
        colunasFaltantes.push({
          tabela,
          coluna,
          tipo: campo.type,
          // Coluna obrigatória que falta quebra gravação E leitura; opcional
          // que falta quebra só a leitura que a menciona. A ordem de conserto
          // sai daí.
          obrigatoria: campo.isRequired && !campo.hasDefaultValue,
        });
        continue;
      }

      // Campo obrigatório sobre coluna que aceita nulo. O caminho contrário —
      // campo opcional sobre coluna NOT NULL — não é checado de propósito: ele
      // aparece na primeira gravação como erro claro de restrição, enquanto
      // este aqui só aparece muito depois, como valor faltando sem explicação.
      if (campo.isRequired && anulavel) {
        colunasOpcionaisDemais.push({ tabela, coluna });
      }
    }
  }

  return { disponivel: true, tabelasFaltantes, colunasFaltantes, colunasOpcionaisDemais };
}

// Existe esta coluna, agora, neste banco?
//
// Serve para as consultas em SQL cru decidirem se podem usar um JOIN opcional.
// O cliente do Prisma valida o modelo contra o schema do repositório, não
// contra o banco — então, em SQL cru, a única forma de não morrer por uma
// coluna ausente é perguntar.
//
// O resultado fica em memória pelo tempo de vida da instância. Coluna não
// aparece nem some durante uma requisição, e consultar o catálogo a cada
// chamada colocaria uma ida ao banco na frente de cada consulta de tela.
const cacheDeColunas = new Map<string, boolean>();

export async function temColuna(tabela: string, coluna: string): Promise<boolean> {
  const chave = `${tabela}.${coluna}`;
  const lembrado = cacheDeColunas.get(chave);
  if (lembrado !== undefined) return lembrado;

  try {
    const linhas = await prisma.$queryRaw<{ existe: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = ${tabela}
           AND column_name = ${coluna}
      ) AS existe
    `;
    const existe = linhas[0]?.existe ?? false;
    cacheDeColunas.set(chave, existe);
    return existe;
  } catch {
    // Não deu para perguntar: responde "não existe". A consulta que depende
    // disso vai pelo caminho simples e a tela abre — que é o comportamento
    // certo quando a dúvida é sobre o próprio banco.
    return false;
  }
}
