import type {
  AuditCategoria,
  AuditSeveridade,
  ControladoriaConfig,
  OmieBaixa,
  OmieCategoria,
  OmieConexao,
  OmieContaCorrente,
  OmieDepartamento,
  OmieMovimento,
  OmieNota,
  OmieParceiro,
  OmieSyncRun,
  OmieTitulo,
  OmieVinculoCentroCusto,
} from "@prisma/client";
import type {
  AbastecimentoGestao,
  ClienteGestao,
  DisponibilidadeGestao,
  MotoristaGestao,
  VeiculoGestao,
} from "@/lib/gestao/leitura";
import type { DadosConformidade } from "@/lib/conformidade/panorama";

// Contexto carregado UMA vez por execucao e compartilhado por todos os
// agentes. Cada agente e uma funcao pura sobre este contexto: nao consulta o
// banco, nao chama a Omie, nao escreve nada. Tres ganhos concretos disso:
// (1) rodar 11 agentes custa 1 leitura do banco, e nao 11 (o relatorio
// diario roda dentro do teto de 60s da Vercel); (2) todo agente enxerga
// exatamente o MESMO retrato dos dados, entao dois achados nunca se
// contradizem por terem lido a base em momentos diferentes; (3) agente puro
// e testavel e auditavel — da pra reproduzir um achado passado alimentando o
// mesmo contexto.
export type ContextoAuditoria = {
  companyId: string;
  // Momento da execucao.
  agora: Date;
  // D-1: o dia que o relatorio de hoje cobre.
  dataReferencia: Date;
  config: ControladoriaConfig;

  // Conexoes Omie ativas (uma por CNPJ do grupo). O contexto e sempre
  // CONSOLIDADO — os agentes veem as duas empresas juntas, e cada registro
  // carrega a conexao de origem. Auditoria de grupo que so soubesse olhar uma
  // empresa por vez perderia justamente o que interessa: fornecedor pago em
  // duplicidade pelas duas, caixa total do grupo, concentracao real.
  conexoes: OmieConexao[];

  // A conexão a que ESTA leitura está restrita, ou null para o grupo inteiro.
  //
  // Sem isso, quem recebe o contexto não sabe qual recorte está vendo — e as
  // somas agregadas, que não passam pelas linhas, precisam reproduzir
  // exatamente o mesmo recorte. Sem essa informação, o painel filtrado por uma
  // empresa mostraria o comparativo do grupo inteiro.
  conexaoId: string | null;

  // A partir de quando títulos, baixas e notas foram carregados.
  //
  // A leitura deixou de ser sempre "desde o início da base". Com 46 mil
  // títulos e 45 mil baixas, carregar tudo passou de trinta megabytes por
  // chamada e fez a fase de auditoria do ciclo diário estourar os 60 segundos
  // da função — o ciclo parou de fechar. A janela existe para isso, e fica
  // registrada aqui para que ninguém conclua "não há título em 2025" quando o
  // correto é "2025 não foi carregado nesta leitura".
  janelaDesde: Date;

  titulos: OmieTitulo[];
  baixas: OmieBaixa[];
  movimentos: OmieMovimento[];
  notas: OmieNota[];
  parceiros: OmieParceiro[];
  categorias: OmieCategoria[];
  departamentos: OmieDepartamento[];
  contasCorrentes: OmieContaCorrente[];
  vinculos: OmieVinculoCentroCusto[];

  // Dados operacionais lidos do SISTEMA DE GESTAO (schema public, somente
  // leitura — ver src/lib/gestao/leitura.ts). Sao eles que sustentam os
  // cruzamentos que a Omie sozinha nao faz: combustivel do cartao de frota
  // contra o titulo do posto, fornecedor cujo CPF e de um motorista da folha,
  // custo por veiculo e por funcionario.
  //
  // Quando a gestao esta indisponivel, todas vem vazias e `gestao.disponivel`
  // fica falso — o supervisor registra a limitacao e os agentes que dependem
  // desses cruzamentos nao emitem achado, em vez de emitir achado errado.
  motoristas: MotoristaGestao[];
  clientes: ClienteGestao[];
  veiculos: VeiculoGestao[];
  abastecimentos: AbastecimentoGestao[];
  gestao: DisponibilidadeGestao;

  // O que veio de fora: relatorios de consultoria, contabilidade e auditoria
  // externa, ja transformados em apontamentos rastreaveis, mais as ligacoes
  // deles com os achados dos agentes. Entra no contexto como qualquer outra
  // fonte para que a auditoria consiga cruzar as duas leituras — e apontar
  // tanto o risco que as duas confirmam quanto o que so uma delas ve.
  conformidade: DadosConformidade;

  ultimoSyncConcluido: OmieSyncRun | null;
};

// Um achado emitido por um agente. Ainda nao e o registro do banco: o motor
// (engine.ts) cuida de deduplicar por `chave`, preservar tratativa humana ja
// feita e fechar o que deixou de existir.
export type AchadoNovo = {
  regra: string;
  severidade: AuditSeveridade;
  categoria: AuditCategoria;
  titulo: string;
  descricao: string;
  // O que fazer. Escrito no imperativo e enderecado a uma pessoa concreta
  // ("exigir do fornecedor X", "revisar a categoria Y") — achado sem acao
  // vira ruido e, em duas semanas, ninguem abre mais a tela.
  recomendacao?: string;
  // Dinheiro envolvido no fato (ex.: valor do titulo pago em duplicidade).
  valorCents?: number;
  // Economia/recuperacao estimada se a recomendacao for executada. Ver o
  // comentario em AuditFinding.impactoCents (schema) sobre por que os dois
  // sao campos separados.
  impactoCents?: number;
  dataReferencia?: Date;
  entidadeTipo?: string;
  entidadeId?: string;
  entidadeRef?: string;
  evidencia?: Record<string, unknown>;
  chave: string;
  // ESTADO: o achado descreve uma situacao que pode deixar de existir
  // ("titulo vencido em aberto") — o motor fecha sozinho como OBSOLETO
  // quando o agente para de emiti-lo.
  // EVENTO: o achado descreve um fato consumado e datado ("pagou R$ 320 de
  // juros em 14/02") — nunca se torna falso, so uma pessoa encerra.
  tipo: "ESTADO" | "EVENTO";
};

export type Agente = {
  id: string;
  nome: string;
  // Area responsavel por tratar o que este agente aponta — e o que faz a
  // lista de achados ser distribuivel entre pessoas em vez de virar uma
  // caixa de entrada coletiva que ninguem assume.
  area: string;
  descricao: string;
  // Assíncrono é PERMITIDO, não a norma. Quase todo agente decide olhando só o
  // contexto que já veio carregado, e continua síncrono — é o que mantém as
  // regras exercitáveis por teste sem banco em pé. A exceção é o agente de
  // histórico: ele compara o mês corrente com anos de resumo mensal, que por
  // definição não cabem no contexto de 400 dias. Ali a CONSULTA é assíncrona e
  // as REGRAS continuam puras, recebendo os dados por parâmetro.
  executar: (ctx: ContextoAuditoria) => AchadoNovo[] | Promise<AchadoNovo[]>;
};
