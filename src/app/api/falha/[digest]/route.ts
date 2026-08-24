import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canViewControladoria } from "@/lib/permissions";
import { falhaPorDigest } from "@/lib/controladoria/falhas";

// A CAUSA DO ERRO, NA MESMA TELA EM QUE O ERRO APARECEU.
//
// A tela de erro já mostrava o identificador e pedia que ele fosse informado.
// Continuava sendo uma volta: ver o número aqui, ir até Sincronização, achar a
// linha. Duas telas para responder uma pergunta que é sempre a mesma — "o que
// aconteceu?".
//
// Esta rota fecha isso. A própria tela de erro consulta o identificador que
// acabou de receber e mostra a mensagem logo abaixo dele.
//
// A MENSAGEM JÁ VEM REDIGIDA DO BANCO — string de conexão, chave de API e
// token foram apagados na gravação (ver `redigir` em falhas.ts). Esta rota não
// redige de novo, e não deve: se um segredo chegasse até aqui, o defeito
// estaria na gravação, e mascarar na leitura só esconderia o defeito enquanto
// o segredo continuasse gravado em claro.
//
// A PILHA NÃO SAI DAQUI, e isso é diferente da tela de Sincronização. Lá, quem
// vê já tem permissão de administrar o módulo. Aqui, qualquer pessoa
// autenticada que topou com um erro veria caminho de arquivo e estrutura
// interna do sistema — informação que não a ajuda em nada e que serve a quem
// está mapeando o alvo.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ digest: string }> }) {
  const session = await getSession();
  if (!session || !canViewControladoria(session.role)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { digest } = await params;
  // O digest do Next é um número decimal. Validar o formato antes de consultar
  // evita que a rota vire um campo de busca livre sobre a tabela de falhas.
  if (!/^\d{1,20}$/.test(digest)) {
    return NextResponse.json({ error: "formato" }, { status: 400 });
  }

  const falha = await falhaPorDigest(digest);
  if (!falha) return NextResponse.json({ error: "nao_encontrada" }, { status: 404 });

  return NextResponse.json(
    { mensagem: falha.mensagem, rota: falha.rota, criadoEm: falha.criadoEm },
    { headers: { "Cache-Control": "no-store" } }
  );
}
