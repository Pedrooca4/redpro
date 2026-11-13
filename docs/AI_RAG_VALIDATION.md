# MinePRO AI — Fase 3F-B

## Protocolo e procedência

A avaliação parte do PR #30 no commit `ea5479ebb5981c7645f78e21249472cc3e1034cd`. O lote contém 42 perguntas novas em português, com 18 de redstone, 11 de sobrevivência e 13 de construção. Inclui 22 pedidos com fichas e fontes esperadas, seis casos de contexto ausente ou conflitante, três pedidos que exigem detalhes do projeto, quatro casos de evidência insuficiente, cinco sem ficha e dois de incompatibilidade de versão.

A redação foi feita a partir das fontes públicas, com cenários próprios e sem abrir os enunciados da 3F-A durante a redação. O mesmo assistente conhecia o escopo e o resultado anterior. A seleção dos temas também foi deliberadamente guiada pelas lacunas do PR #30. Portanto, o lote verifica novas formulações de desenvolvimento. Falta validação com outro autor. Os testes confirmam que nenhum enunciado coincide literalmente com os 44 anteriores. Há sobreposição intencional de mecânicas.

Antes da primeira comparação, o lote com enunciados, critérios, fontes, alvos e campos de esclarecimento foi formatado e registrado com SHA-256 `ec95340e3cd44bed598b82d98a8c896f30ffc7f13985776807589df9faa585c8`. O avaliador confere o hash antes de aceitar o arquivo. A árvore Git com apenas o lote acrescentado ao #30, registrada antes da comparação, é `11112d44bdf93363274bcca9a095f4021c306463`. O ranking, o corpus de 23 fichas, o verificador contextual e as sete candidatas foram utilizados sem ajustes. As candidatas foram acrescentadas somente em memória. Uma referência documental adicional de escadas pertence ao avaliador e fica fora do índice.

Os critérios de redstone foram conferidos nas notas de Tricky Trials para [Java](https://feedback.minecraft.net/hc/en-us/articles/27547857163917-Minecraft-Java-Edition-1-21-Tricky-Trials) e [Bedrock](https://feedback.minecraft.net/hc/en-us/articles/27451789924237-Minecraft-Bedrock-Edition-1-21-Tricky-Trials), no [guia da Microsoft](https://learn.microsoft.com/en-us/minecraft/creator/documents/redstoneguide?view=minecraft-bedrock-stable), e nas referências de [comparador](https://minecraft.wiki/w/Redstone_Comparator) e [repetidor](https://minecraft.wiki/w/Redstone_Repeater). Os critérios de sobrevivência usam a documentação da [âncora](https://www.minecraft.net/en-us/article/spawning-and-dying) e as regras por edição de [golems de ferro](https://minecraft.wiki/w/Iron_golem). Para construção, as referências incluem [andaimes](https://www.minecraft.net/pt-br/article/block-week--scaffolding), tijolos de resina em [Java 1.21.4](https://feedback.minecraft.net/hc/en-us/articles/32385811139085-Minecraft-Java-Edition-1-21-4-The-Garden-Awakens) e [Bedrock 1.21.50](https://feedback.minecraft.net/hc/en-us/articles/32344904160397-Minecraft-Bedrock-Edition-1-21-50-The-Garden-Awakens), e as [predefinições da 1.21.80](https://feedback.minecraft.net/hc/en-us/articles/36236281562637-Minecraft-1-21-80-Bedrock).

```sh
node --experimental-strip-types scripts/ai-retrieval-dev/evaluate.ts 3fb > /tmp/minepro-3fb-retrieval.json
node --experimental-strip-types --test tests/ai-retrieval-dev.test.ts tests/ai-retrieval-3fb.test.ts tests/ai-knowledge.test.ts
```

O JSON contém dados por caso e agregados por edição, versão, assunto e decisão esperada. A ferramenta lê os conjuntos de desenvolvimento e o corpus local. A avaliação termina na recuperação, com zero chamadas de inferência. A bateria reservada fica fora desse caminho.

## Resultados

| Métrica                                                | Busca congelada | + verificação contextual | + sete candidatas |
| ------------------------------------------------------ | --------------: | -----------------------: | ----------------: |
| Recuperação correta                                    |      9/22 (41%) |               9/22 (41%) |       14/22 (64%) |
| Primeira ficha relevante                               |           11/22 |                    11/22 |             15/22 |
| Todas as fontes esperadas presentes                    |            9/22 |                     9/22 |             17/22 |
| Cobertura bruta, qualquer ficha                        |           20/42 |                    18/42 |             25/42 |
| Edição e versão compatíveis com o contexto selecionado |           20/20 |                    18/18 |             25/25 |
| Abstenções sem ficha e sem esclarecimento              |              22 |                       18 |                11 |
| Abstenções adequadas, ausência ou incompatibilidade    |             7/7 |                      7/7 |               7/7 |
| Esclarecimentos corretos de edição ou versão           |             0/6 |                      6/6 |               6/6 |
| Esclarecimentos corretos de detalhes do projeto        |             0/3 |                      0/3 |               0/3 |
| Consultas com alguma ficha irrelevante                 |               5 |                        3 |                 6 |
| Decisão conforme o critério                            |           16/42 |                    22/42 |             27/42 |

Acerto de recuperação exige a primeira ficha relevante, todas as fichas e fontes esperadas e metadados compatíveis. A rubrica usa uma lista de fontes e fichas previamente definida para cada caso. Cobertura conta também fichas que não resolvem a dúvida. Abstenção conta respostas vazias do mecanismo de recuperação, incluindo falhas de busca. O avaliador mantém as ausências adequadas separadas dos esclarecimentos esperados. Compatibilidade técnica com o campo selecionado não prova compatibilidade com a pergunta escrita. Em B17 e B28, a busca congelada recuperou fichas apesar do conflito textual.

| Recorte         | Evidência correta, busca congelada → proposta | Conformidade geral, busca congelada → proposta |
| --------------- | --------------------------------------------: | ---------------------------------------------: |
| Java            |                                   5/10 → 6/10 |                                   6/18 → 10/18 |
| Bedrock         |                                   4/12 → 8/12 |                                  10/22 → 15/22 |
| Sem edição      |                                             — |                                      0/2 → 2/2 |
| Redstone        |                                   6/10 → 6/10 |                                   8/18 → 10/18 |
| Sobrevivência   |                                     3/4 → 3/4 |                                    6/11 → 8/11 |
| Construção      |                                     0/8 → 5/8 |                                    2/13 → 9/13 |
| Java 1.21.5     |                                     5/9 → 6/9 |                                    6/16 → 9/16 |
| Bedrock 1.21.80 |                                   4/11 → 7/11 |                                   8/19 → 12/19 |
| Java 1.21.4     |                                     0/1 → 0/1 |                                      0/1 → 0/1 |
| Bedrock 1.21.50 |                                     0/1 → 1/1 |                                      0/1 → 1/1 |

O ganho de recuperação reapareceu em nova amostra, com cinco acertos líquidos. Os 14/22 desta fase e os 26/28 da 3F-A usam perguntas e distribuições diferentes. Nesta amostra, as candidatas aumentaram a presença de fontes certas em redstone de 6/10 para 9/10. O acerto completo ficou em 6/10, pois o ranking colocou fichas irrelevantes em primeiro lugar.

## Falhas e regressões

| Casos               | Observação reproduzida                                                                                                                                                                                                                                                                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B03, B04 e B05      | Em B03, a pergunta é sobre a lâmpada. A direção do repetidor fica em primeiro com 5 pontos, seguida pela ficha da lâmpada com 4. B04 e B05 eram corretos antes da inclusão das candidatas. Em B04, a lâmpada mencionada supera o comparador perguntado (4 a 2). Em B05, a lâmpada usada como destino supera a ficha de intensidade do repetidor (4 a 2). |
| B08                 | A ficha de intensidade fica em primeiro, mas a ficha de direção não entra no contexto. A pergunta pede as duas informações. A busca não identifica que faltou uma parte.                                                                                                                                                                                 |
| B09, B10 e B11      | As fichas elegíveis não sustentam, respectivamente, a leitura do estado luminoso pelo comparador, o ajuste do atraso Bedrock e as condições de travamento do repetidor Java.                                                                                                                                                                             |
| B19 a B22           | O contexto Java ajuda com fatores gerais de uma farm parada. O intervalo de sono de 20 minutos permanece sem sustentação no fato recuperado. As duas consultas Bedrock sobre trabalho dos aldeões e limite de golens ficam sem ficha, como esperado.                                                                                                     |
| B23, B32, B33 e B34 | A pergunta sobre capacidade da âncora recupera a ficha de `/give` por um alias que contém “blocos de pedra”. “Tora” e “ripas” deixam a ficha de tábuas de fora. “Bancadas” no plural não recupera a ficha da bancada. “Aglomerados de resina” no plural e sem “tijolo de resina” também não recupera a candidata Java.                                   |
| B15, B29 e B39      | Faltam detalhes para diagnosticar o portão, a farm e a proporção da fachada. Nenhum dos três gera esclarecimento. Em B39, as candidatas introduzem contexto irrelevante de andaime para uma pergunta sobre altura, embora a decisão já fosse incorreta no baseline.                                                                                      |

Houve 13 melhorias de decisão e duas regressões. A verificação contextual sozinha respondeu pelos seis esclarecimentos novos e não introduziu regressões neste lote. As 21 consultas históricas conservaram a primeira ficha ou a ausência esperada. Os 44 testes de desenvolvimento da 3F-A mantêm as métricas documentadas. As limitações de cobertura das farms vêm das fichas disponíveis. As condições do jogo foram conferidas em documentação, sem execução de Minecraft.

## Decisão

**NO-GO para integrar o pacote de melhorias.** As duas regressões em redstone ocorrem mesmo quando a ficha e a fonte corretas foram recuperadas. Em uma próxima rodada isolada, vale avaliar separadamente o verificador contextual, que acertou os seis casos desta amostra, e mudanças de seleção por componente e operação. Faça pares controlados em que a mesma pergunta troca apenas o componente mencionado de passagem. Inclua testes de perguntas compostas, plurais e dúvidas de diagnóstico que exigem esclarecimento. Depois, meça se as propostas preservam os acertos de comparador e repetidor enquanto ampliam cobertura de construção e das farms.
