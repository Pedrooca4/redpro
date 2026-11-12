# MinePRO AI — protótipo de validação de comandos

A Fase 3E-C testa dois comandos fora do fluxo do produto. `validateIntent` recebe uma intenção estruturada. `resolveQuestion` reconhece formas delimitadas de pedidos em português. `validateCandidate` valida um comando fornecido como texto e descreve seu efeito. As três funções operam sem inferência. A detecção de menções da 3E-B só é usada no replay para encontrar candidatos nas respostas arquivadas.

## Comportamento implementado

| Comando    | Cobertura                                                                                                                                 | Decisão                                                                                                                                        |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `/weather` | Java 1.21.5 e Bedrock 1.21.80. Clima limpo, chuva e tempestade. Consulta no Bedrock.                                                      | A resposta preserva o horário. Pedidos mistos, como mudar o clima e fazer anoitecer, ficam fora do protótipo.                                  |
| `/fill`    | As mesmas versões, dois cantos absolutos XYZ, catálogo de seis blocos vanilla e modos `replace`, `keep`, `outline`, `hollow` e `destroy`. | Pede os campos ausentes. Distingue coordenadas do identificador de bloco. Expõe substituição, limpeza ou quebra antes de apresentar o comando. |

`ready` indica que o comando passou nas verificações do protótipo. `clarify` lista dados ausentes, `invalid` aponta campos incompatíveis, `caution` retém uma instrução que exige confirmação ou conferência, e `outside-scope` devolve o pedido a quem chamou a função. Esse retorno não implica que o comando seja inválido no jogo.

Em `/fill`, a caixa é inclusiva. `replace` pode sobrescrever a região. `outline` preserva o interior e pode sobrescrever a borda. `keep` só preenche ar. Usar ar, `hollow` ou `destroy` exige confirmação explícita no caminho estruturado. O protótipo usa 32.768 posições como teto próprio e uma faixa conservadora de coordenadas. A validade final depende das áreas carregadas, dimensão, borda, permissões e regras do mundo. Posições relativas ou locais, estados de bloco, NBT, filtros e `strict` no Java ficam fora desta implementação. O catálogo não pretende cobrir todos os blocos.

A entrada livre aceita poucos formatos e se abstém diante de pedidos ambíguos, compostos ou condicionais. A validação de candidatos aceita duração Java em `t`, `s` ou `d` e duração Bedrock como inteiro em ticks. Converter duração expressa em prosa continua fora do protótipo. As referências documentais sustentam a validação estática. A execução em jogo segue pendente. [Relatório da Fase 3E-D](AI_COMMAND_ROBUSTNESS.md)

## Comparação com os diagnósticos arquivados

```sh
node --experimental-strip-types scripts/ai-command-validation/replay.ts \
  --in .minepro-ai-bench/comparacao-3b.json \
  --out .minepro-ai-bench/validacao-comandos.json
```

O replay aceita a comparação arquivada da 3B, confere o hash da bateria diagnóstica pública e o vínculo de cada nota histórica ao hash do texto. Ele reavalia os dois casos com critérios direcionados ao efeito do comando e à origem dos campos. A saída registra texto e hash do protótipo. O replay cria um arquivo novo e preserva o relatório original. [Comparação arquivada da 3B](https://chatgpt.com/library?file_id=libfile_f0119a473aec8191af5fd2e101e466f1&account_id=personal)

| Caso      | Base arquivada                                                                                | RAG arquivado                                   | Protótipo                                                                                  |
| --------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `CMD-J02` | Falha. Menciona `/weather clear`, mas recomenda `/time set` e inclui um estado inválido.      | Passa. Limpa o clima independentemente da hora. | Passa. Entrega `/weather clear` e informa que o horário é preservado.                      |
| `AMB-B01` | Falha. Prescreve um `/fill` com argumentos inválidos para uma região que o jogador não mediu. | Passa. Pede os dois cantos e o bloco.           | Passa. Pede os dois cantos XYZ e o identificador de bloco sem fornecer comando executável. |

Nos quatro pares, houve duas melhorias sobre a base e dois resultados mantidos em relação ao RAG, com zero regressões detectadas. A 3C tem notas reconstituídas sobre incerteza quanto ao horário e confusão entre XYZ e ID de bloco. Como os textos integrais da 3C se perderam, a comparação automática com essas respostas fica inconclusiva. Os resultados verificam estes casos e critérios. Eles não estimam a taxa de acerto em perguntas novas nem constituem revisão humana independente. [Evidências reconstituídas da 3C](https://chatgpt.com/library?file_id=libfile_7ae1c2b3d0448191b53f34cbb58e3df6&account_id=personal)

## Casos novos de desenvolvimento

| Entrada                                                                                                           | Resultado esperado                                                    |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| “No Java 1.21.5, como tirar a chuva, sem mexer no relógio?”                                                       | `/weather clear` com horário preservado.                              |
| “Como ver o clima atual?” no Bedrock.                                                                             | `/weather query`. A mesma sintaxe é rejeitada no Java.                |
| “Quero mudar o clima.”                                                                                            | Pede o estado desejado.                                               |
| “Quero deixar o céu limpo e remover os inimigos.”                                                                 | Fica fora da regra de clima.                                          |
| “Preencha a região com vidro; primeiro canto: (-8, 70, 4); segundo canto: (-6, 72, 7).”                           | Comando com `minecraft:glass` e aviso de substituição em 36 posições. |
| Região com bloco e primeiro canto fornecidos.                                                                     | Pede somente o segundo canto XYZ.                                     |
| “Preencha o espaço com pedra sem apagar os blocos existentes” com os cantos completos.                            | Usa `keep`.                                                           |
| `/fill` com item, eixo inválido, região excedente, modo `strict` no Bedrock ou efeito de limpeza sem confirmação. | Retorna erro, limite ou pedido de confirmação conforme o parâmetro.   |

Os testes também cobrem negação, repetição de um campo, conflito entre contexto e edição escrita, datas de versão fora do escopo, escopo parcial da região e duração Bedrock com unidade inválida. A recomendação para a etapa seguinte é medir cobertura e abstenção em novos pedidos de desenvolvimento e verificar os modos de `/fill` nas duas versões do jogo antes de ampliar o conjunto de comandos.
