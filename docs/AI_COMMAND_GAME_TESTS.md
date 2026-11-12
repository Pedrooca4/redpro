# MinePRO AI — Fase 3E-E

## Resultado de desenvolvimento

A resolução de perguntas em PT-BR reconhece pedidos para abrir o tempo, consultar o clima atual e preencher a borda. `/weather clear` altera o clima e preserva o horário. A resposta distingue o clima das nuvens renderizadas nas configurações de vídeo. A consulta usa `/weather query` no Bedrock e informa a incompatibilidade no Java. Para a borda, o protótipo pede os campos ausentes e usa `outline` quando os dados bastam. A saída explica que todas as faces externas podem ser sobrescritas, incluindo topo e base. Se um eixo tem menos de três blocos, todas as posições fazem parte da borda e o protótipo alerta antes de sugerir o comando. Pedidos de uma forma circular, apenas paredes, preservação de todos os blocos existentes ou modo incompatível ficam fora dessa regra.

| Métrica                   | 3E-D no #28 | 3E-D nesta fase | 3E-E no #28 | 3E-E nesta fase |
| ------------------------- | ----------: | --------------: | ----------: | --------------: |
| Cobertura                 |       47/65 |           50/65 |        4/38 |           21/38 |
| Conformidade              |       62/65 |           65/65 |       19/38 |           38/38 |
| Comandos adequados        |          18 |              20 |           0 |              10 |
| Esclarecimentos adequados |           6 |               7 |           0 |               4 |
| Rejeições adequadas       |          16 |              16 |           1 |               3 |
| Avisos adequados          |           7 |               7 |           1 |               4 |
| Abstenções totais         |          18 |              15 |          34 |              17 |
| Abstenções adequadas      |          15 |              15 |          17 |              17 |
| Falsos positivos          |           0 |               0 |           0 |               0 |
| Falsos negativos          |           3 |               0 |          14 |               0 |

Cobertura conta resultados diferentes de `outside-scope`. Conformidade exige a decisão e os critérios registrados para comando, campos e explicação. Falsos positivos contam comandos liberados indevidamente ou diferentes do esperado. Falsos negativos contam os casos esperados como comando ou esclarecimento que não atendem ao contrato. As colunas comparam os mesmos exemplos antes e depois. Na bateria de 65, foram três melhorias (`W29`, `W30`, `F32`) e 62 resultados conformes preservados. Na de 38, foram 19 melhorias e 19 resultados conformes preservados. Nenhuma regressão nessas amostras. No replay de `CMD-J02` e `AMB-B01`, as decisões e os resultados da comparação histórica foram preservados. A explicação adicional sobre nuvens altera o texto e o hash da resposta de clima.

A bateria 3E-E reúne 33 perguntas e cinco candidatos, todos destinados a desenvolvimento. Exemplos incluem “Como posso retirar as nuvens do céu?”, “Confira a condição atual do clima, por favor” e “Preencha apenas o contorno do volume com vidro, sem alterar o interior”. Há também negações, perguntas sobre tempo de jogo, pedidos condicionais ou compostos, coordenadas parciais, conflitos de modo, volumes finos e candidatos com `air destroy` nas duas edições. A amostra mede o contrato escolhido para este protótipo. A avaliação independente e a execução no Minecraft ficam em aberto.

```sh
node --experimental-strip-types scripts/ai-command-validation/robustness.ts 3ed
node --experimental-strip-types scripts/ai-command-validation/robustness.ts 3ee
node --experimental-strip-types --test tests/ai-command-validation.test.ts
```

## Disponibilidade observada no Work

| Alvo                    | Encontrado                                                                                                                                                                                                                                                                                                                                                                                | Situação                                                                                                                                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Java Edition 1.21.5     | OpenJDK 21 disponível. O [manifesto oficial da versão](https://piston-meta.mojang.com/v1/packages/deed2dfe12bd2f6dd3397178c68ce07d0a8f2604/1.21.5.json) identifica o [JAR exato](https://piston-data.mojang.com/v1/objects/e6ec2f64e6080b9b5d9b471b291c33cc7f509733/server.jar), que respondeu HTTP 206 ao pedido de um byte. SHA-1 publicado `e6ec2f64e6080b9b5d9b471b291c33cc7f509733`. | Servidor, cliente e instalação de teste já licenciada indisponíveis no Work.                                                                                                                                            |
| Bedrock Edition 1.21.80 | O [histórico do servidor](https://minecraft.wiki/w/Bedrock_Dedicated_Server_version_history) relaciona a edição 1.21.80 à build 1.21.80.3. O [ZIP Linux no domínio oficial](https://www.minecraft.net/bedrockdedicatedserver/bin-linux/bedrock-server-1.21.80.3.zip) respondeu HTTP 206 ao pedido de um byte.                                                                             | Nenhum servidor ou cliente instalado. O Work usa Debian 13. O [suporte oficial](https://www.minecraft.net/en-us/download/server/bedrock) exige Ubuntu 22.04 LTS ou posterior para o servidor Linux e não inclui Debian. |

As sondagens confirmaram a disponibilidade dos endereços, sem instalação ou execução dos binários. O software de servidor oficial está disponível sem contratação. A instalação e o uso seguem a [EULA do Minecraft](https://www.minecraft.net/en-us/eula) e o [procedimento oficial de download](https://help.minecraft.net/hc/en-us/articles/4408873961869-Descarga-el-software-de-servidor-dedicado-de-Minecraft). Não havia um ambiente de jogo pronto para executar os ensaios no Work. Os resultados em jogo estão pendentes nas duas edições.

### Evidência documental para `air destroy` no Bedrock

O [Microsoft Learn para /fill](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/commandsreference/examples/commands/fill?view=minecraft-bedrock-stable) inclui um exemplo com `air 0 destroy`. A Mojang registra a remoção do argumento numérico `data` para `/fill` após [Bedrock 1.19.70](https://feedback.minecraft.net/hc/en-us/articles/13857979785613-Minecraft-1-19-70-Bedrock). O exemplo legado, portanto, não comprova a forma moderna. A [tabela de resultados da Wiki](https://minecraft.wiki/w/Commands/fill#Result) distingue o caso de destino ar. A referência comunitária atual não substitui a observação de blocos e itens na build 1.21.80.3. O protótipo continua abstendo para `air destroy` no Bedrock e exigindo cautela no Java. O ensaio abaixo registra a aceitação da sintaxe, a alteração da região e os itens como resultados distintos.

## Protocolo de teste em mundo descartável

1. Use uma instalação oficial licenciada de cada versão ou servidor oficial de versão exata em um host compatível. O servidor Java requer Java 21. Confirme a versão no log de inicialização ou na tela de jogo. Registre edição, build, plataforma, origem do executável e SHA-256 do arquivo local. Para o Java, confira também o SHA-1 do manifesto. Use um mundo plano do Overworld, sem mods ou complementos, com comandos autorizados. Restrinja o ambiente à máquina de teste.
2. Prepare um mundo-base exclusivo. Use Y=80 em uma área carregada, com um piso sólido em Y=79 que cubra pelo menos X/Z de 6 a 12 para os itens pousarem. Mantenha `doTileDrops` ou `dotiledrops` ligado na respectiva edição e evite mobs ou outros itens perto da área. Em cada edição, prepare a região assim:

   ```mcfunction
   /fill 8 80 8 10 82 10 minecraft:dirt replace
   /setblock 8 80 8 minecraft:air
   /setblock 9 81 9 minecraft:chest
   /setblock 11 81 9 minecraft:cobblestone
   ```

   Coloque exatamente três maçãs no baú central. No chat, use `/`. No console do servidor, retire o prefixo. Para pôr as maçãs por comando, use `/item replace block 9 81 9 container.0 with minecraft:apple 3` no Java e `/replaceitem block 9 81 9 slot.container 0 minecraft:apple 3` no Bedrock. Confirme a região inicial com 25 blocos de terra, uma posição de ar e um baú com três maçãs. O pedregulho em X=11 é a sentinela externa. Salve e feche o mundo-base. Restaure uma cópia limpa para cada linha da tabela e para cada edição.

3. Use `/fill 8 80 8 10 82 10 minecraft:glass <modo>` para os cinco modos. As colunas abaixo registram hipóteses a verificar, ainda sem dados de execução. Registre também os blocos substituídos e os itens soltos, por tipo e quantidade. Vários itens podem estar agrupados em uma entidade.

   | Modo      | Blocos esperados após o teste                        | Itens a verificar                                                              |
   | --------- | ---------------------------------------------------- | ------------------------------------------------------------------------------ |
   | `replace` | 27 vidros. O baú desaparece.                         | Procurar itens do bloco e do inventário. A referência prevê ausência de itens. |
   | `keep`    | 25 terras, um vidro onde havia ar e o baú no centro. | Conferir as três maçãs ainda no baú.                                           |
   | `outline` | 26 vidros nas faces externas e o baú no centro.      | Conferir as três maçãs ainda no baú.                                           |
   | `hollow`  | 26 vidros nas faces externas e ar no centro.         | Medir separadamente se soltam itens do baú e do inventário.                    |
   | `destroy` | 27 vidros. O baú desaparece.                         | Verificar terra, baú e maçãs como itens, contando quantidades.                 |

   Como controle de substituição seletiva, em cópia nova execute `/fill 8 80 8 10 82 10 minecraft:glass replace minecraft:dirt`. Verifique se apenas as 25 terras viraram vidro. O protótipo não gera esse filtro, mas o controle distingue sobrescrita total de substituição por tipo.

4. Use cópias novas para `/fill 8 80 8 10 82 10 minecraft:air replace` (controle de remoção) e `/fill 8 80 8 10 82 10 minecraft:air destroy`. Registre no Bedrock, separadamente, se a sintaxe é aceita, se o comando retorna erro, se a região muda mesmo após um erro e se terra, baú ou maçãs aparecem no chão. Em outra cópia, teste `/fill 8 80 8 10 82 10 minecraft:air [] destroy` no Bedrock para distinguir a variante com estado vazio. Compare com o controle de `destroy` com vidro na mesma edição e com o ensaio Java executado separadamente.
5. Registre o comando literal, a mensagem do jogo, os blocos das 27 posições, a sentinela, o conteúdo do baú se ele persistir e os itens encontrados logo após o comando. Use verificações por coordenada com `/execute if block` no servidor. Para itens, observe antes de coletar em um cliente autorizado, ou registre as entidades e pilhas nos dados da cópia do mundo com uma ferramenta compatível com a edição. Registre qual método foi usado. Se apenas a presença de entidade for observável, deixe tipo e quantidade como não medidos. Salve logs ou gravação com identificação de edição e build.

## Decisão

GO para encerrar o desenvolvimento estático de `/weather` e `/fill` neste protótipo. A validação em jogo continua pendente. Mantenha o protótipo fora do chat público e deixe a expansão de comandos condicionada à evidência desses ensaios.

O próximo investimento recomendado é uma camada de conhecimento rastreável por edição e versão para perguntas comuns de sobrevivência, construção e redstone. Meça recuperação de fonte, afirmações factuais, esclarecimento e abstenção em dados novos de desenvolvimento. Mantenha a validação determinística como ferramenta para operações bem delimitadas. Esse recorte mede a qualidade da IA especializada antes de considerar treinamento.
