-- As premissas que o edital importado fixa (reserva, encargos, pisos, idade do veículo).
ALTER TABLE "SimEstudo" ADD COLUMN "premissasDoEdital" JSONB;
