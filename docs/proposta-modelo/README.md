# Modelo de proposta — Azul Mob

`Modelo_Proposta_Azul_Mob.docx` é o modelo de proposta técnica e comercial, no
papel timbrado da Azul (logo, CNPJ/IE/IM no cabeçalho; telefone, site e
endereço no rodapé) e com fotos do site azulmob.com.br.

Seções: capa · carta de apresentação com resumo da proposta · 01 Quem somos ·
02 Por que a Azul Mob · 03 Escopo do atendimento (briefing e linhas) · 04 Frota
proposta · 05 Investimento (preço por linha, serviços adicionais e preço ano a
ano com a reforma tributária, 2026–2033) · 06 Condições comerciais · 07
Implantação · 08 Níveis de serviço · 09 Aceite.

Campos a preencher: entre « », com marca-texto amarelo. Ao terminar, limpe o
marca-texto (Página Inicial → Cor do realce → Sem cor).

Para regerar depois de mudar o texto:

```bash
cd docs/proposta-modelo
npm install --no-save docx@9   # uma vez
node gerar.js                  # grava Modelo_Proposta_Azul_Mob.docx
```

As fotos em `img/` foram baixadas do site (páginas Frota, Fretamento,
Corporativo, Elétrico e Sobre nós), recortadas e comprimidas; os logos são os
oficiais do manual de marca (versão sólida atual, `#2B448F`).
