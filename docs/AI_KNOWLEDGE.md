# Base de conhecimento local do MinePRO AI

A Fase 3B adiciona 23 fichas próprias em PT-BR. A base [knowledge.json](../scripts/ai-bench/knowledge.json) cobre crafting, comandos, redstone, sobrevivência, diferenças entre edições e sintaxe dependente da versão. Cada ficha registra versões exatas, tema, fato, exemplo original, fonte, licença, condição de uso, data de verificação e confiança documental ou comunitária.

As fontes são páginas oficiais da Mojang/Microsoft, documentação Bedrock do Microsoft Learn coberta por CC BY 4.0 quando aplicável e Minecraft Wiki como referência factual, cujo texto é CC BY-NC-SA 3.0 salvo exceções. As fichas contêm redação própria. O uso das fontes foi documental e o corpus não inclui texto integral, imagens ou ativos. "Verificada" significa conferência documental. Ainda cabe confirmar, nas versões alvo do jogo, casos com mecânica sensível a edição e versão.

## Busca e segurança

A busca lê um JSON do repositório. Filtra por edição e versão exata, remove acentos e palavras de ligação e pontua frases de palavras-chave pela quantidade de termos ao quadrado. Seleciona até três fichas em ordem estável com um orçamento de 1.200 bytes UTF-8 de contexto. Versão ausente, versão desconhecida e consulta sem correspondência geram contexto vazio. A pesquisa usa apenas palavras-chave, e o modelo recebe somente ID e fato em um bloco de dados JSON.

As fichas passam por validação de esquema, procedência, tamanho, delimitadores de chat e padrões comuns de instrução. O prompt manda tratar as fichas como dados, citar IDs e pedir informação quando faltar evidência. Essas barreiras reduzem o risco de injeção indireta. A aprovação editorial do corpus continua necessária. O modelo pode citar uma ficha e contradizê-la. O relatório distingue IDs enviados, IDs citados e IDs desconhecidos, sem inferir uso semântico a partir de uma citação.

O conjunto [retrieval-dev.json](../scripts/ai-bench/retrieval-dev.json) contém 21 consultas de desenvolvimento, com 16 alvos positivos e 5 situações sem ficha. No conjunto usado para ajustar a busca, a abordagem textual acertou a primeira ficha ou a abstenção esperada em 21/21. Um ensaio BM25 de unigramas nos mesmos aliases, com a mesma normalização e os mesmos filtros de edição e versão, marcou 20/21 com k1=1,2 e b=0,75. Em D02, BM25 colocou a ficha de bancada acima da de gravetos. A busca textual permaneceu como padrão. Esses resultados medem o conjunto de desenvolvimento.

## Reproduzir a comparação

Prepare pesos, template e executável como em [AI_BENCH.md](AI_BENCH.md). Execute duas vezes com os mesmos argumentos de artefatos. Use `--knowledge off --max-output-tokens 256 --out base.json` e `--knowledge on --max-output-tokens 256 --out rag.json`. O modo desligado conserva as mensagens da bancada anterior. O modo ligado acrescenta as fichas recuperadas e as instruções específicas de evidência. Os parâmetros de geração são os mesmos.

```sh
pnpm ai:bench compare --base base.json --rag rag.json --out comparacao.json
```

Para incluir a classificação, forneça `--base-ratings base-notas.json --rag-ratings rag-notas.json --review-origin assisted` ou `--review-origin human`, conforme a procedência das avaliações. Use o esquema de notas e o hash de cada resposta descritos no guia. Sem notas, a comparação apresenta apenas telemetria. A comparação rejeita diferenças de modelo, template, executável, casos ou configuração de geração. Uma rodada adicional com outro limite deve ter seu próprio arquivo de saída.

## Evidência de 11 de novembro de 2026

A execução-base da Fase 3B reproduziu os 24 SHA-256 de resposta da Fase 3A. O relatório original foi preservado com SHA-256 `b1d6c50ee4a7455820a40c880a481b6216db1c195213b9e8b4f75dd121e54985`. A comparação usou Qwen3.5-4B Q4_K_M e llama.cpp b12110 em Linux x64, AMD EPYC 9V74, 9,7 GiB de RAM e oito threads de inferência por CPU. Contexto 4.096, saída 256, temperatura zero, semente 42 e uma geração por vez.

| Medida                                              |     Sem fichas |     Com fichas |
| --------------------------------------------------- | -------------: | -------------: |
| Respostas geradas                                   |             24 |             24 |
| Saídas truncadas                                    |              5 |              0 |
| Latência mediana                                    |        10,22 s |         6,75 s |
| Latência p95                                        |        15,85 s |        12,21 s |
| Velocidade média reportada                          | 17,76 tokens/s | 18,12 tokens/s |
| Pico de RSS do servidor                             |       6,51 GiB |       6,82 GiB |
| Tokens totais de entrada                            |          2.813 |          5.554 |
| Tokens totais de saída                              |          3.956 |          2.005 |
| Acerto factual integral, revisão assistida          |           2/24 |          14/24 |
| Acerto parcial, revisão assistida                   |           9/24 |           5/24 |
| Erros críticos, revisão assistida                   |             11 |              5 |
| Erros de edição, revisão assistida                  |              2 |              2 |
| Erros de versão, revisão assistida                  |              2 |              1 |
| Português claro, revisão assistida                  |             18 |             23 |
| Casos com afirmações sem suporte, revisão assistida |             22 |              7 |

Classificação factual assistida pela IA, com justificativas por caso e pelo hash da resposta. Nenhuma revisão humana foi realizada nesta etapa. O acerto integral exige os critérios da rubrica e ausência de erro relevante. Uma resposta parcialmente útil ou incompleta recebe acerto parcial. A gravidade segue a descrição crítica do caso. As métricas de edição, versão e gravidade podem se sobrepor. As latências medem as duas execuções observadas em CPU compartilhada, sem garantia de desempenho futuro.

Houve 15 melhorias de classificação factual, uma piora e oito casos na mesma faixa. Com fichas, o comparador em subtração retornou 6, a âncora no Overworld deixou de ser recomendada e /weather clear deixou de vir acompanhado de alteração de horário. Em SUR-B01, a resposta passou de parcialmente correta a incorreta ao inventar uma poça temporária no Nether. Em CRA-B02, a classificação continuou incorreta e apareceu um erro crítico novo: instrução explícita para preencher o centro da fornalha. O repetidor Bedrock e a sintaxe de /effect continuam incorretos.

Foram recuperadas fichas em 22/24 casos. AMB-J01 ficou sem fichas por falta de versão e AMB-B02 por falta de identificação do item. Foram enviados 23 IDs contando repetições entre casos. Todos apareceram em citações nas respostas correspondentes, com zero IDs desconhecidos. O contexto máximo foi de 336 bytes e o tempo mediano de busca foi de 0,126 ms. Houve contradições factuais mesmo com citação válida.

## Diagnóstico separado do limite de saída

Os cinco casos que truncaram sem fichas atingiram exatamente 256 tokens. Repeti apenas esses casos sem fichas, com o mesmo GGUF, template, runtime e demais parâmetros, elevando o limite para 512. Os cinco novos textos começaram com a resposta anterior.

| Caso    | Tokens com limite 512 | Resultado                                                       |
| ------- | --------------------: | --------------------------------------------------------------- |
| CRA-B01 |                   298 | Concluiu e manteve a instrução incorreta com cristal.           |
| SUR-B02 |                   344 | Concluiu e continuou recomendando âncora no Overworld.          |
| EDI-B01 |                   331 | Concluiu e acrescentou sintaxe de dados inexistente no Bedrock. |
| AMB-J02 |                   512 | Truncou de novo, repetindo a mesma frase.                       |
| AMB-B01 |                   512 | Truncou de novo, repetindo coordenadas em um comando inválido.  |

O orçamento maior eliminou três cortes, sem resolver os erros de conteúdo. A mediana desta amostra de cinco foi 21,12 s. O padrão permaneceu em 256 tokens para a comparação principal.

## Separação dos conjuntos

- **Desenvolvimento:** as 21 consultas de busca acima servem para ajustar aliases, filtros e ranking.
- **Diagnóstico e regressão:** os 24 casos da Fase 3A tiveram seus erros inspecionados. A cobertura das fichas levou em conta essas categorias e falhas. Os números desta página medem a regressão conhecida. Perguntas, respostas de referência, rubricas e paráfrases desses casos ficam reservadas à avaliação.
- **Validação final:** planejar 72 casos novos, seis por tema e edição, com autoria independente das fichas e dos casos diagnósticos. Incluir versões compatíveis e incompatíveis, perguntas ambíguas e verificações em jogo. Separar famílias de mecânicas entre conjuntos, manter os enunciados e rubricas reservados, registrar o hash da bateria e congelar corpus, prompt, busca e parâmetros antes de abrir o conjunto. Comparar no mesmo ambiente, com respostas avaliadas sem identificação da modalidade e revisão humana independente em divergências.

A decisão técnica desta fase é adiar LoRA/QLoRA. Prioridades: verificar em jogo os erros críticos restantes, reforçar validação de comandos e alegações suportadas pelas fichas e medir no conjunto reservado.
