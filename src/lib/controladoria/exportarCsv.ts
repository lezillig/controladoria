// EXPORTAÇÃO PARA PLANILHA.
//
// Nasceu de "os valores de receita e despesa estão incorretos, gerar planilha
// para corrigirmos". O trabalho de corrigir não acontece aqui: acontece na
// Omie, categoria por categoria, e quem faz precisa de uma lista que dê para
// ordenar, filtrar e riscar. Tela não serve para isso.
//
// CSV, e não XLSX, por três motivos concretos: abre no Excel e no Google
// Planilhas sem conversão, não acrescenta dependência ao projeto, e é legível
// por qualquer ferramenta daqui a dez anos — o que importa num sistema cuja
// razão de existir é trilha de auditoria.
//
// O formato é o do Excel EM PORTUGUÊS, que é onde o arquivo vai ser aberto:
// separador ponto e vírgula e decimal com vírgula. Com separador de vírgula e
// ponto decimal, o Excel brasileiro joga a linha inteira numa célula só e a
// planilha chega inútil — detalhe pequeno que decide se o arquivo serve ou não.

const SEPARADOR = ";";

// BOM. Sem ele o Excel lê o arquivo como Latin-1 e "Combustível" vira
// "CombustÃ­vel" em toda a coluna.
const BOM = "﻿";

function celula(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined) return "";

  if (typeof valor === "number") {
    // Inteiro sai inteiro. Contagem de títulos formatada como "2,00" faz a
    // planilha parecer errada logo na primeira olhada, e quem abre passa a
    // desconfiar também dos valores que estão certos.
    if (Number.isInteger(valor)) return String(valor);
    // Decimal com vírgula, sem separador de milhar: o separador de milhar
    // colide com o separador de coluna e o Excel quebra a célula em duas.
    return valor.toFixed(2).replace(".", ",");
  }

  const texto = String(valor);
  // Aspas duplicadas e campo entre aspas quando há separador, aspas ou quebra
  // de linha. Descrição de categoria com ponto e vírgula existe, e sem isto
  // ela desloca todas as colunas à direita — o tipo de erro que passa
  // despercebido porque a planilha "abre".
  return /[;"\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

export function montarCsv(linhas: (string | number | null | undefined)[][]): string {
  return BOM + linhas.map((l) => l.map(celula).join(SEPARADOR)).join("\r\n");
}

// Nome de arquivo previsível e ordenável.
//
// Quem baixa o mesmo relatório de três competências quer os três lado a lado,
// na ordem certa, sem abrir um por um. Data no formato AAAA-MM faz a ordem
// alfabética coincidir com a cronológica.
export function nomeDoArquivo(prefixo: string, escopo: string, competencia: string): string {
  const limpo = (t: string) =>
    t
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase();
  return `${limpo(prefixo)}-${limpo(escopo)}-${limpo(competencia)}.csv`;
}

// Cabeçalho de contexto, antes da tabela.
//
// Uma planilha de valores sem dizer de qual empresa, de qual mês e por qual
// critério é uma armadilha: ela circula por e-mail, alguém abre semanas depois
// e conclui o que quiser. As três linhas de contexto custam nada e impedem
// isso.
export function cabecalhoDeContexto(params: {
  titulo: string;
  empresa: string;
  competencia: string;
  criterio: string;
  geradoEm: Date;
}): (string | number | null)[][] {
  return [
    [params.titulo],
    ["Empresa", params.empresa],
    ["Competência", params.competencia],
    ["Critério", params.criterio],
    ["Gerado em", params.geradoEm.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })],
    [],
  ];
}
