-- Tipos de veículo escolhidos ao criar o estudo (carro, van, micro, ônibus).
ALTER TABLE "SimEstudo" ADD COLUMN "tiposVeiculo" TEXT[] DEFAULT ARRAY[]::TEXT[];
