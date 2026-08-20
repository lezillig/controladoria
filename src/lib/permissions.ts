// Papéis vêm do cadastro de usuários do sistema de gestão (schema `public`).
// Este sistema não cria papel próprio: quem administra pessoas é lá, e ter dois
// lugares para conceder acesso é ter um lugar para esquecer de revogar.

export const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Administrador",
  GESTOR: "Gestor",
  CONTROLADORIA: "Controladoria",
  FOLHA: "Folha",
  MOTORISTA: "Motorista",
};

// Quem entra no sistema. FOLHA e MOTORISTA ficam de fora: o financeiro do
// grupo não é dado que precise circular por quem cuida de ponto ou dirige.
export function canViewControladoria(role: string): boolean {
  return role === "ADMIN" || role === "GESTOR" || role === "CONTROLADORIA";
}

// Quem trata achado, muda parâmetro do modelo de gestão, mexe em meta do BSC,
// cadastra conexão e dispara sync/relatório.
//
// Separado da leitura de propósito: num sistema de auditoria, "ver" e "poder
// desligar o alerta" não podem ser a mesma permissão. GESTOR lê tudo; quem
// opera a controladoria é quem trata.
export function canManageControladoria(role: string): boolean {
  return role === "ADMIN" || role === "CONTROLADORIA";
}

export function rotuloPapel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}
