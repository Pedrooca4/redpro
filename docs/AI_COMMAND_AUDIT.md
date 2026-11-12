# MinePRO AI — auditoria de comandos em desenvolvimento

A Fase 3E-A adiciona um leitor de relatórios da bancada diagnóstica. O leitor trabalha com os textos registrados e usa somente os quatro casos com `exactCommand` do conjunto público de 24 casos. O hash do conjunto e os IDs são conferidos antes da análise. A bancada original continua usando a métrica histórica para manter seus relatórios reproduzíveis.

## Reproduzir a análise local

```sh
node --experimental-strip-types scripts/ai-command-audit/replay.ts \
  --in .minepro-ai-bench/relatorio-diagnostico.json \
  --out .minepro-ai-bench/auditoria-comandos.json
```

O leitor aceita um relatório `real-local` ou a comparação base/RAG produzida pela bancada. Ele grava um novo JSON e resume as contagens no terminal. A gravação é exclusiva, com permissão `0600` onde suportada. Use caminhos distintos e mantenha o arquivo de saída junto aos artefatos locais da bancada. Nenhum servidor de modelo é iniciado.

## O que cada métrica comprova

| Campo                              | Significado                                                                                                                                                                                                                      |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `legacyExactCommandPresent`        | Valor original do relatório, disponível para a saída bruta. Comparava uma linha inteira após normalização limitada.                                                                                                              |
| `referenceTextPresent`             | A sequência de tokens da referência aparece em um comando identificado em texto, código inline ou bloco cercado. Pode haver argumentos adicionais ou uma orientação explícita para evitar o comando.                             |
| `referenceParametersMatch`         | Pelo menos uma menção contém exatamente os tokens do comando de referência, na ordem esperada. Aplica-se à referência deste caso.                                                                                                |
| `recommendedReferencePresent`      | A referência com os parâmetros esperados aparece apresentada como comando e sem desaconselhamento explícito da mesma referência. Exemplos rotulados, menções sem intenção clara e comandos desaconselhados ficam nas evidências. |
| `conflictingReferencePresentation` | A mesma referência aparece apresentada e desaconselhada na resposta. A recomendação fica desmarcada.                                                                                                                             |
| `intentAssessment`                 | Nota factual arquivada com origem declarada e hash conferido na comparação base/RAG, quando disponível. O campo fica `not-assessed` sem uma nota vinculada ao texto avaliado.                                                    |

O relatório tem registros `raw` e `delivered` com texto, hash SHA-256, procedência e métricas próprios. `raw` identifica a geração do modelo, com fichas recuperadas e citadas quando registradas. `delivered` preserva o método e as fontes reportados pela bancada. Se o relatório histórico não registrou a etapa entregue, o campo fica `null`. Os hashes do arquivo de entrada e do conjunto diagnóstico identificam a procedência do replay.

As heurísticas cobrem as apresentações usuais em Markdown e marcadores explícitos em PT-BR. A comparação conserva maiúsculas, namespace e tokens. Formas equivalentes com grafia ou argumentos diferentes exigem inspeção. A adequação à intenção depende da explicação e dos efeitos de todos os comandos da resposta. O leitor não testa gramática geral, permissões, efeitos dentro do jogo nem contradições arbitrárias na prosa.

## Evidência arquivada da 3B

| Saída bruta                      | Métrica histórica | Referência textual | Parâmetros da referência | Referência apresentada |
| -------------------------------- | ----------------: | -----------------: | -----------------------: | ---------------------: |
| Base, com os mesmos textos da 3A |               0/4 |                1/4 |                      1/4 |                    1/4 |
| RAG                              |               0/4 |                3/4 |                      3/4 |                    3/4 |

No RAG, `/give`, `/weather` e `keepinventory` estavam dentro de frases com Markdown inline. O `/effect` Bedrock tinha `give` adicional. Na base, `/weather clear` aparece com os parâmetros esperados e recebe nota factual incorreta. A resposta também recomenda alterar o horário, contrariando o pedido. O acerto textual e a nota histórica permanecem visíveis separadamente.

A amostra em `tests/fixtures/command-audit-3b.json` preserva as oito saídas brutas e seus hashes dos quatro casos com comando esperado. Os testes também usam exemplos sintéticos para o caminho entregue, Markdown e desaconselhamento. [Relatório arquivado da 3B](https://chatgpt.com/library?file_id=libfile_f0119a473aec8191af5fd2e101e466f1&account_id=personal)
