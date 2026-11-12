# MinePRO AI — Fase 3E-D: sintaxe e robustez

**Decisão: NO-GO para ampliar o protótipo.** As verificações estáticas ficaram mais robustas, mas ainda há três abstenções indevidas em pedidos livres e falta validar em mundos descartáveis os efeitos e limites das duas versões alvo. O teste é de desenvolvimento, com dados sintéticos, e serve para medir regressões dentro da amostra.

## Evidência por versão

| Ponto                               | Java 1.21.5                                                                                                                                                                             | Bedrock 1.21.80                                                                                                                                                                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/weather clear`, `rain`, `thunder` | Alteram o clima. Duração opcional aceita `t`, `s`, `d` ou número em ticks. A árvore de comandos define mínimo de um tick após conversão.                                                | Alteram o clima. Duração opcional em ticks inteiros de 0 a 1.000.000. Zero e ausência escolhem a duração padrão aleatória.                                                                                                                   |
| `/weather query`                    | Ausente da árvore versionada.                                                                                                                                                           | Consulta o clima e não recebe duração.                                                                                                                                                                                                       |
| `/fill` sem modo ou com `replace`   | A árvore versionada confirma execução nos dois formatos. `replace` aceita filtro de bloco ou tag, e o filtro pode ser seguido de `outline`, `hollow`, `destroy` ou `strict`.            | A referência documenta modo opcional e filtro de substituição por ID e estados. Estados do destino podem ser omitidos mesmo quando há modo.                                                                                                  |
| Estados e dados de `/fill`          | O destino aceita estado do bloco e pode aceitar NBT. A Mojang documenta alterações no tratamento de dados de entidades de bloco na 1.21.5. `strict` é específico do Java neste recorte. | Estados são uma lista com chaves entre aspas e `=`. Os parâmetros numéricos de dados legados foram removidos antes da 1.21.80. Alguns exemplos atuais do Learn ainda exibem `0`; as notas de versão sustentam a rejeição dessa forma legada. |

No Java, a validação cruza as [notas oficiais da 1.21.5](https://feedback.minecraft.net/hc/en-us/articles/35298208390797-Minecraft-Java-Edition-1-21-5-Spring-to-Life) com a [árvore de comandos gerada para 1.21.5, publicada por Misode](https://github.com/misode/mcmeta/blob/1.21.5-summary/commands/data.json). No Bedrock, as [notas da 1.21.80](https://feedback.minecraft.net/hc/en-us/articles/36236281562637-Minecraft-1-21-80-Bedrock) identificam a versão alvo. A gramática é cruzada com a referência oficial de [`/fill`](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/commandsreference/examples/commands/fill?view=minecraft-bedrock-stable), [`/weather`](https://learn.microsoft.com/en-us/minecraft/creator/commands/commands/weather?view=minecraft-bedrock-stable) e as mudanças históricas da [1.19.70](https://feedback.minecraft.net/hc/en-us/articles/13857979785613-Minecraft-1-19-70-Bedrock), [1.19.80](https://feedback.minecraft.net/hc/en-us/articles/15171804661005-Minecraft-1-19-80-Bedrock) e [1.20.10](https://feedback.minecraft.net/hc/en-us/articles/17381681401357-Minecraft-1-20-10-Bedrock). Os seis IDs de bloco do protótipo constam no [catálogo comunitário Bedrock 1.21.80](https://github.com/PrismarineJS/minecraft-data/blob/master/data/bedrock/1.21.80/blocks.json). As unidades de clima são corroboradas pelo [guia Microsoft](https://learn.microsoft.com/en-us/minecraft/creator/documents/commandspopularcommands?view=minecraft-bedrock-stable) e pelo [histórico do comando](https://minecraft.wiki/w/Commands/weather).

| Modo      | Efeito esperado                                                                 | Decisão no protótipo                                                                                                                 |
| --------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `replace` | Sobrescreve a região por padrão. Um filtro pode restringir os blocos atingidos. | Informa risco de sobrescrita. Filtros ficam fora do suporte automático.                                                              |
| `keep`    | Preenche apenas posições com ar.                                                | Usa quando a intenção explícita é preservar os blocos existentes.                                                                    |
| `outline` | Altera a borda e conserva o interior.                                           | Avisa que a borda ainda pode ser sobrescrita.                                                                                        |
| `hollow`  | Preenche a borda e deixa o interior com ar.                                     | Exige confirmação no caminho estruturado.                                                                                            |
| `destroy` | Quebra os blocos existentes, podendo soltar itens, antes do preenchimento.      | Exige confirmação. Com destino `air` no Bedrock, o caso fica fora do escopo pela divergência documental e falta de execução em jogo. |

As descrições de efeitos foram cruzadas com a [referência de modos Microsoft](https://learn.microsoft.com/en-us/minecraft/creator/commands/commands/fill?view=minecraft-bedrock-stable) e a [documentação comunitária de `/fill`](https://minecraft.wiki/w/Commands/fill). O protótipo mantém o catálogo e as coordenadas absolutas da fase anterior. Estados, NBT, filtros, posições relativas ou locais e `strict` Java continuam fora da geração automática. `ready` significa que a saída passou no contrato estático. Em jogo, a execução depende também de dimensão, áreas carregadas, borda, permissões e regras do mundo.

## Correções e resultados

- Comandos quebrados em múltiplas linhas eram unidos e aprovados. A validação agora rejeita a entrada multilinha, mesmo quando a união formaria um comando válido.
- Duração Java deixou de cair em abstenção genérica. Candidatos aceitam a gramática numérica coberta, calculam o resultado em ticks e rejeitam unidade inválida, zero após arredondamento ou valor fora do limite conservador. Bedrock distingue zero de uma duração explícita e identifica duração inválida em `query`.
- Campos de preenchimento em branco passam a ser solicitados como ausentes. Um rótulo vazio de bloco não anula o material já fornecido em prosa. Modo explicitamente em branco exige esclarecimento antes de emitir o comando.
- `parar de chover`, `troque o clima para chuva` e cláusulas sucessivas de preservação do horário são reconhecidos. Texto citado, negado ou composto permanece sujeito a abstenção. `destroy` com ar no Bedrock exige confirmação de comportamento em jogo.

A bateria fixa de desenvolvimento contém 25 perguntas em PT-BR e 40 candidatos de comando. Foi criada para esta fase e ficou fora da avaliação reservada. Cada caso tem decisão esperada e, quando aplicável, comando, campos ou trecho de explicação. **Cobertura** conta respostas diferentes de `outside-scope`. **Correto** exige todos os critérios marcados. **Falso positivo** é um comando liberado indevidamente ou diferente do esperado. **Falso negativo** é um caso esperado como `ready` ou `clarify` que falha nos critérios. Uma resposta com sintaxe certa pode falhar pela explicação ou por campos ausentes.

| Métrica                               | PR #27 | Fase 3E-D |
| ------------------------------------- | -----: | --------: |
| Cobertura                             |  38/65 |     47/65 |
| Resultados de acordo com os critérios |  43/65 |     62/65 |
| Comandos adequados                    |      9 |        18 |
| Esclarecimentos adequados             |      4 |         6 |
| Rejeições adequadas                   |      9 |        16 |
| Avisos adequados                      |      7 |         7 |
| Abstenções totais                     |     27 |        18 |
| Abstenções adequadas                  |     14 |        15 |
| Falsos positivos                      |      2 |         0 |
| Falsos negativos                      |     14 |         3 |

Em perguntas, os resultados de acordo com os critérios passaram de 16/25 para 22/25. Em candidatos, de 27/40 para 40/40. São 19 melhorias, 43 resultados corretos mantidos, três lacunas mantidas e zero regressões detectadas na bateria. As lacunas são `W29` (céu sem nuvens), `W30` (consulta da condição do tempo) e `F32` (cobrir apenas a beirada, com cantos ausentes). A lista de exemplos está em `tests/fixtures/command-validation-3ed.json`.

```sh
node --experimental-strip-types scripts/ai-command-validation/robustness.ts
node --experimental-strip-types --test tests/ai-command-validation.test.ts
```

O replay da comparação arquivada da 3B mantém duas melhorias sobre a base e dois acertos preservados frente ao RAG, em `CMD-J02` e `AMB-B01`. Os textos integrais da 3C continuam indisponíveis para replay. Consulte os [resultados anteriores](AI_COMMAND_VALIDATION.md#comparação-com-os-diagnósticos-arquivados).

## Validação em jogo e teste de interface

O ambiente tinha Java 21, mas nenhum servidor Minecraft Java 1.21.5 ou Bedrock 1.21.80 instalado e autorizado para execução. Portanto, não houve testes em jogo. Os testes automatizados executam o validador TypeScript e comparam as decisões. As fontes sustentam sintaxe e efeitos documentados. Nenhum desses resultados atesta o resultado de um comando dentro de um mundo.

O teste de interface de versão personalizada foi investigado separadamente. O log do PR #27 mostra `custom` selecionado, campo vazio, nenhum diálogo e `busy: false` após a tentativa de preencher `invalid` a 320 px. O timeout aconteceu antes de clicar em Aplicar. A primeira execução local do Chromium foi bloqueada na criação de socket pelo ambiente. A causa da intermitência segue em aberto. O protótipo e sua suíte ficam fora do chat público. [Log do job do PR #27](https://github.com/Pedrooca4/redpro/actions/runs/43316013091/job/131524092174) · [Histórico do teste de interface](UI_TEST_STABILITY.md)

Antes de ampliar, execute `replace`, `keep`, `outline`, `hollow` e `destroy` em uma caixa pequena com ar, sólidos e um contêiner descartável em cada edição. Use um mundo novo por ensaio e registre borda, interior, itens soltos e mensagens do jogo. Para clima, verifique `clear`, `rain`, `thunder`, duração mínima, `query` e a preservação do horário com o ciclo de tempo congelado. Registre a versão e as regras do mundo. Depois, repita a medição em perguntas novas com as três famílias de linguagem ainda sem cobertura.
