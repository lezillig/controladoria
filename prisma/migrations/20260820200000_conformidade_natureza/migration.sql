-- CreateEnum
CREATE TYPE "ConformidadeNatureza" AS ENUM ('RISCO', 'DOCUMENTO', 'QUESTIONAMENTO', 'DIVERGENCIA', 'OBRIGACAO', 'OPORTUNIDADE');

-- AlterTable
ALTER TABLE "ConformidadeApontamento" ADD COLUMN     "baseLegal" TEXT,
ADD COLUMN     "competenciaAlvo" TIMESTAMP(3),
ADD COLUMN     "natureza" "ConformidadeNatureza" NOT NULL DEFAULT 'RISCO',
ADD COLUMN     "obrigacaoCodigo" TEXT;

