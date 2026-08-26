-- PERFIS DE ACESSO DA CONTROLADORIA.
--
-- O que ficou de fora, e por quê: um cadastro de usuários próprio. A
-- identidade continua sendo a do sistema de gestão — quem entra, com que
-- senha, e se ainda está ativo. Ter dois cadastros trocaria um acoplamento por
-- uma falha de segurança: hoje, desativar alguém na gestão tira o acesso ao
-- financeiro no mesmo ato, inclusive de sessão já aberta. Com dois, esse
-- desligamento passaria a depender de alguém lembrar de repetir a operação nos
-- dois lugares, e o dia do esquecimento é o dia em que um ex-funcionário
-- continua enxergando o caixa do grupo.
--
-- O que entra é a camada de AUTORIZAÇÃO — quais telas e quais ações cada
-- pessoa alcança DENTRO da Controladoria. Isso é assunto daqui e não tem por
-- que morar no sistema de frota: os cinco papéis de lá (ADMIN, GESTOR,
-- CONTROLADORIA, FOLHA, MOTORISTA) descrevem a operação, não a controladoria,
-- e mapeá-los um a um obrigaria a criar papel de frota para expressar "pode ver
-- o DRE mas não trata achado".
--
-- Sem perfil atribuído, valem as regras de papel que já existiam. Nenhum acesso
-- muda no dia em que isto sobe — o que muda é passar a existir a possibilidade
-- de ajustar.

CREATE TABLE "PerfilAcesso" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    -- Lista de chaves de permissão (ver src/lib/acessos.ts). Array, e não
    -- tabela de junção: a lista é pequena, fechada, lida inteira sempre e
    -- nunca consultada pelo avesso ("quem tem esta permissão?" se responde
    -- percorrendo os perfis, que são poucos).
    "permissoes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    -- Perfil aplicado a quem ainda não tem um. Nulo em todos = ninguém tem
    -- padrão, e valem as regras de papel.
    "padrao" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerfilAcesso_pkey" PRIMARY KEY ("id")
);

-- A ligação usuário → perfil. `userId` é o id do usuário NO BANCO DA GESTÃO,
-- sem chave estrangeira: os dois bancos são separados, e uma FK entre eles é
-- impossível por construção. A consequência aceita é que apagar um usuário lá
-- deixa a linha órfã aqui — inofensiva, porque sem o usuário não há sessão a
-- autorizar.
CREATE TABLE "UsuarioPerfil" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "perfilId" TEXT NOT NULL,
    "userNome" TEXT,
    "atribuidoPor" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsuarioPerfil_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PerfilAcesso_companyId_nome_key" ON "PerfilAcesso"("companyId", "nome");
CREATE INDEX "PerfilAcesso_companyId_idx" ON "PerfilAcesso"("companyId");
CREATE UNIQUE INDEX "UsuarioPerfil_companyId_userId_key" ON "UsuarioPerfil"("companyId", "userId");
CREATE INDEX "UsuarioPerfil_perfilId_idx" ON "UsuarioPerfil"("perfilId");

ALTER TABLE "UsuarioPerfil" ADD CONSTRAINT "UsuarioPerfil_perfilId_fkey"
    FOREIGN KEY ("perfilId") REFERENCES "PerfilAcesso"("id") ON DELETE CASCADE ON UPDATE CASCADE;
