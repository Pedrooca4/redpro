# MinePRO AI — Fase 3F-A

## Diagnóstico da busca atual

A busca local da bancada valida o esquema das 23 fichas, os IDs de fontes, a lista de domínios HTTPS, os limites de tamanho e marcadores de instrução. Filtra as fichas por edição e versão exata antes de pontuar. Normaliza acentos, caixa e palavras de ligação. Só pontua aliases contíguos na consulta normalizada, com peso igual ao quadrado do número de termos. Em empate, usa o ID da ficha. Mantém até três resultados com pelo menos metade da pontuação do primeiro e aplica o limite de 1.200 bytes UTF-8. Títulos, exemplos, URLs, sinônimos sem alias e significado da frase não participam da pontuação.

O contexto estruturado decide a edição e a versão. A busca não resolve contexto a partir da pergunta. Uma edição nula é rejeitada na entrada da busca, e uma versão nula retorna `missing-version`. Um `no-match` pode significar falta de ficha, alias ausente ou versão excluída. Já `matched` pode conter fatos insuficientes ou irrelevantes. A bancada envia apenas ID e fato no contexto. O relatório registra IDs recuperados, pontuação, tamanho e tempo, além de IDs citados ou desconhecidos. Esse registro permite rastrear a ficha até sua fonte no catálogo. Citação de ID não verifica a alegação. A camada posterior de regras da bancada verifica alguns conflitos e limita o uso de regras, mas recebe o resultado da busca depois de a geração ter sido solicitada.

### Inventário das 23 fichas

O corpus declara somente Java 1.21.5 e Bedrock 1.21.80, em listas exatas por ficha. Das 23 fichas, 11 cobrem as duas edições, sete apenas Java e cinco apenas Bedrock. As 22 entradas de fonte registram URL, título, licença e condições. A verificação automática confirma esses metadados e os vínculos. A sustentação factual foi conferida nas passagens usadas pelos casos desta fase. O inventário abaixo também sinaliza limites que merecem revisão editorial futura.

| Tema no corpus    | Fichas                                                                             | Limite ou observação                                                                                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Crafting (4)      | `MP-planks`, `MP-sticks`, `MP-table`, `MP-furnace`                                 | Úteis para materiais. Tora e plural de materiais podem escapar aos aliases. A ficha da fornalha cobre sua fabricação, embora possa ser recuperada para uma pergunta sobre fundição. |
| Comandos (5)      | `MP-give-java`, `MP-weather`, `MP-keepinventory`, `MP-effect`, `MP-fill`           | Fatos vinculados à edição declarada. Estão fora do foco desta fase. O protótipo separado de comandos não participa do ensaio.                                                       |
| Redstone (4)      | `MP-comparator`, `MP-delay`, `MP-bedrock-repeater`, `MP-repeater-direction`        | O comparador só cobre subtração. Atraso só tem ficha Java. No Bedrock, aliases genéricos de repetidor podem devolver força e direção para uma pergunta sobre atraso.                |
| Sobrevivência (5) | `MP-hunger`, `MP-nether-bed`, `MP-nether-water`, `MP-anchor-dimensions`, `MP-iron` | Fome e farm de ferro só têm Java. A ficha de âncora não detalha carregamento ou consumo. A de ferro menciona detecção de golem sem informar o intervalo.                            |
| Edições (4)       | `MP-quasi`, `MP-sweeping`, `MP-data`, `MP-offhand`                                 | Um fato pode abranger duas edições. A busca ainda recebe um único contexto por consulta. `MP-quasi` também serve à área de redstone.                                                |
| Versões (1)       | `MP-java-components`                                                               | O fato menciona 1.20.5, mas o índice só libera a ficha para Java 1.21.5. A menção histórica não amplia a elegibilidade.                                                             |
| Construção (0)    | —                                                                                  | As fichas de crafting fornecem insumos. Faltam técnicas, blocos decorativos e preparação do mundo para construir.                                                                   |

Para as fichas candidatas, a documentação consultada inclui [cargas da âncora](https://www.minecraft.net/en-us/article/spawning-and-dying), [uso de andaimes](https://www.minecraft.net/pt-br/article/block-week--scaffolding), resina em [Java 1.21.4](https://feedback.minecraft.net/hc/en-us/articles/32385811139085-Minecraft-Java-Edition-1-21-4-The-Garden-Awakens) e [Bedrock 1.21.50](https://feedback.minecraft.net/hc/en-us/articles/32344904160397-Minecraft-Bedrock-Edition-1-21-50-The-Garden-Awakens), [predefinições da 1.21.80](https://feedback.minecraft.net/hc/en-us/articles/36236281562637-Minecraft-1-21-80-Bedrock) e a lâmpada de cobre em [Java](https://feedback.minecraft.net/hc/en-us/articles/27547857163917-Minecraft-Java-Edition-1-21-Tricky-Trials) e [Bedrock](https://feedback.minecraft.net/hc/en-us/articles/27451789924237-Minecraft-Bedrock-Edition-1-21-Tricky-Trials). A [referência comunitária de resina](https://minecraft.wiki/w/Resin_Brick) complementa o changelog Bedrock com o processo de fundição. Páginas gerais e notas da versão de introdução são evidência documental de mecânicas estáveis. Elas não registram um teste em cada build alvo. As fichas usam redação própria.

## Experimento reproduzível

As 44 perguntas inéditas de desenvolvimento têm 28 alvos com evidência esperada, oito casos de contexto ausente ou em conflito, dois casos que exigem detalhes do projeto, três casos de ficha insuficiente, um de assunto sem ficha e dois de versão incompatível. O arquivo de casos registra a decisão esperada, o critério factual e os IDs das fontes aplicáveis. A ferramenta produz uma linha por pergunta com referências, motivo bruto, IDs, pontuações, URLs, compatibilidade e decisão de auditoria. Os rótulos de ausência, incompatibilidade e insuficiência vêm dos critérios do conjunto. O mecanismo congelado continua usando seus próprios motivos.

Foram comparadas três execuções da mesma função de ranking. A primeira usa o corpus congelado do #29. A segunda acrescenta um verificador de edição e versão separado. A terceira acrescenta também sete fichas em memória. A ferramenta só lê esse conjunto, o corpus aprovado e as 21 consultas antigas de regressão. A busca do chat, o corpus em disco e as regras da bancada ficam fora dessa mudança. Não há requisições de inferência.

```sh
node --experimental-strip-types scripts/ai-retrieval-dev/evaluate.ts > /tmp/minepro-3fa-retrieval.json
node --experimental-strip-types --test tests/ai-retrieval-dev.test.ts
```

### Métricas

| Métrica                                             | Corpus congelado | + verificação de contexto | + sete fichas candidatas |
| --------------------------------------------------- | ---------------: | ------------------------: | -----------------------: |
| Recuperação correta, com primeira ficha relevante   |            14/28 |                     14/28 |                    26/28 |
| Fontes esperadas presentes no conjunto recuperado   |            14/28 |                     14/28 |                    27/28 |
| Recuperação correta sem ficha irrelevante           |            14/28 |                     14/28 |                    25/28 |
| Cobertura bruta, qualquer ficha                     |            26/44 |                     22/44 |                    30/44 |
| Edição compatível com o campo estruturado           |            26/26 |                     22/22 |                    30/30 |
| Versão compatível com o campo estruturado           |            26/26 |                     22/22 |                    30/30 |
| Esclarecimentos corretos, edição ou versão          |              0/8 |                       8/8 |                      8/8 |
| Esclarecimentos sobre o problema ou projeto         |              0/2 |                       0/2 |                      0/2 |
| Consultas com alguma ficha marcada como irrelevante |                6 |                         2 |                        2 |
| Decisão conforme o critério da pergunta             |            17/44 |                     25/44 |                    37/44 |

Acerto de recuperação exige a primeira ficha relevante, todas as fichas necessárias, as fontes esperadas e metadados compatíveis. Uma ficha complementar pode acompanhar a resposta. O indicador sem ficha irrelevante mostra quando entrou contexto extra sem relação suficiente. Compatibilidade de edição e versão conta apenas consultas que receberam fichas, com base nos campos estruturados. Por isso, os 100% da busca atual coexistem com quatro recuperações em que o texto contradiz o contexto selecionado ou pede mais de um contexto. A conformidade inclui os esclarecimentos com os campos corretos. Em ausência e incompatibilidade, exige recuperação vazia. Nos três casos insuficientes, a busca ainda envia material incompleto e falha. Os dois pedidos de detalhe ficam sem pergunta de esclarecimento e também falham.

| Recorte                                                                   | Recuperação correta no #29 | Com verificação e candidatas |
| ------------------------------------------------------------------------- | -------------------------: | ---------------------------: |
| Sobrevivência                                                             |                  5/7 (71%) |                   7/7 (100%) |
| Construção                                                                |                 2/10 (20%) |                   9/10 (90%) |
| Redstone                                                                  |                 7/11 (64%) |                  10/11 (91%) |
| Java, todas as versões com alvo                                           |                 7/12 (58%) |                 12/12 (100%) |
| Bedrock, todas as versões com alvo                                        |                 7/16 (44%) |                  14/16 (88%) |
| Java 1.21.5                                                               |                 7/11 (64%) |                 11/11 (100%) |
| Bedrock 1.21.80                                                           |                 7/15 (47%) |                  13/15 (87%) |
| Java 1.21.4                                                               |                        0/1 |                          1/1 |
| Bedrock 1.21.50                                                           |                        0/1 |                          1/1 |
| Java 1.21.3 e Bedrock 1.21.70, versão incompatível nos casos selecionados |              2/2 sem ficha |                2/2 sem ficha |

### Falhas reproduzidas

| Caso                     | Evidência observada                                                                                                                                                                                                                                                             | Recomendação                                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R11, R23, R38, R41 e R42 | A busca original ignora conflito entre edição ou versão textual e contexto selecionado. Quatro casos retornam fichas e um retorna vazio. O verificador pede os campos pertinentes em todos os cinco.                                                                            | Medir menções a origem de projetos, comparações e formatos textuais novos. Comparação entre edições precisa de uma recuperação por contexto.                         |
| R26                      | A pergunta usa “tora de bétula”; nenhum alias atual de `MP-planks` corresponde. O fato já existe no corpus.                                                                                                                                                                     | Testar revisão de aliases em lote de desenvolvimento novo antes de mudar normalização ou pontuação.                                                                  |
| R43 e R44                | “Linha de pó” recupera `MP-repeater-direction` junto da ficha de lâmpada. No primeiro, há empate de 4 pontos com a lâmpada em primeiro. No segundo, “repetidor” soma um ponto, e a ficha irrelevante fica com 5 contra 4. A fonte certa continua disponível como segunda ficha. | Adicionar pares controlados em que o componente do entorno varia e a pergunta sobre o alvo fica igual. Usar esses pares para testar ranking ou extração de entidade. |
| R07 e R08                | A ficha Java de ferro carece dos 30 segundos sem detecção. A consulta Bedrock sobre população mínima fica sem ficha elegível.                                                                                                                                                   | Propor uma ficha específica para requisitos Java e outra para a vila Bedrock, com camas, aldeões e condições aplicáveis.                                             |
| R34 e R35                | O comparador recuperado fala de subtração, sem leitura de inventário. O repetidor Bedrock retorna força e direção, sem o ajuste de atraso.                                                                                                                                      | Propor fichas separadas por operação e registrar quando a evidência cobre só parte do pedido.                                                                        |
| R24 e R37                | Uma ponte sem detalhes e um circuito sem esquema retornam `no-match`.                                                                                                                                                                                                           | Testar uma camada de intenção que peça dimensões ou materiais da ponte e componentes, ligações e sintoma do circuito.                                                |

As referências para as lacunas de ferro, comparador e repetidor estão no [catálogo de golems](https://minecraft.wiki/w/Iron_golem), na [referência de comparador](https://minecraft.wiki/w/Redstone_Comparator) e no [guia de redstone da Microsoft](https://learn.microsoft.com/en-us/minecraft/creator/documents/redstoneguide?view=minecraft-bedrock-stable). O [guia de crafting da Mojang](https://www.minecraft.net/en-us/article/how-craft) sustenta a ficha de tábuas já existente.

Foram 20 melhorias de conformidade, 17 resultados conformes preservados e sete falhas restantes. Nenhuma regressão de decisão final foi encontrada nessas 44 perguntas ou na expectativa de primeira ficha ou abstenção das 21 consultas antigas. Na primeira tentativa, o detector de conflito tratava toda menção a Java como alvo e bloqueava R30, que só citava Java como origem do circuito. A correção restringiu o detector a menções explícitas de contexto e incluiu um teste de regressão. A heurística ainda depende de padrões textuais. Os mesmos exemplos informaram a seleção de candidatas, portanto as taxas medem desenvolvimento. Para ampliar o verificador ou o ranking, faltam perguntas de autores distintos e enunciados que não repitam os aliases.

## Próxima etapa

**GO** para um segundo lote de desenvolvimento com outras formulações, incluindo pares difíceis de alvo versus componente incidental, perguntas de diagnóstico com dados faltantes e os requisitos de ferro, comparador e atraso Bedrock. Compare primeiro alias, filtro contextual e seleção da operação contra o ranking congelado. Meça primeira ficha, todas as fontes necessárias, contexto irrelevante, falhas de interpretação e esclarecimentos em separado.

**NO-GO** para promover as candidatas ou ajustar o ranking da bancada agora. As duas colisões de redstone são reproduzíveis, porém a mesma amostra orientou as mudanças e a evidência sobre generalização ainda é limitada. Após a nova rodada de recuperação, um ensaio de respostas com fontes identificáveis pode verificar se o modelo preserva as condições dos fatos recuperados.
