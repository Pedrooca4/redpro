# MinePRO AI — Fase 3C

A bancada local mantém as 23 fichas e a busca por edição e versão exatas. A revisão cobre os seis grupos de fichas. Sete receberam redação mais precisa. As outras 16 mantêm fatos, versões, exemplos, referências e metadados da Fase 3B. As fichas continuam restritas ao RAG. O histórico de conteúdo é o diff sobre o PR #22 (`eab08f38958dd0b04d9b2fea91e3250cb6a56200`).

## Revisão dos erros críticos

| Caso    | Falha observada no RAG 3B                                       | Regra documentada e verificação 3C                                                                                                                                                                                                                                                                     |
| ------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CRA-J01 | Exigiu bancada para tábuas e inventou um custo em troncos.      | Um tronco comum rende quatro tábuas do mesmo tipo em uma célula do inventário. A grade de fabricação 2×2 é suficiente. [Mojang](https://www.minecraft.net/en-us/article/how-craft) · [Planks](https://minecraft.wiki/w/Planks)                                                                         |
| CRA-B02 | Citou o centro vazio, depois exigiu um ingrediente nele.        | Oito pedregulhos na borda da grade 3×3, com o centro vazio, rendem uma fornalha comum. [Furnace](https://minecraft.wiki/w/Furnace)                                                                                                                                                                     |
| CMD-B02 | Inseriu `give` e inventou uma conversão da duração.             | Bedrock recebe alvo diretamente, segundos e amplificador de base zero. Velocidade I por dez segundos no próprio jogador é `/effect @s speed 10 0` no chat com permissão. [Microsoft Learn](https://learn.microsoft.com/en-us/minecraft/creator/commands/commands/effect?view=minecraft-bedrock-stable) |
| RED-B01 | Copiou a força 4 de entrada para a saída, contrariando a ficha. | Em regime estável, com orientação correta e sem trava, qualquer entrada traseira de 1 a 15 produz saída frontal 15. Entrada 0 produz saída 0. [Microsoft Learn](https://learn.microsoft.com/en-us/minecraft/creator/documents/redstoneguide?view=minecraft-bedrock-stable)                             |
| SUR-B01 | Inferiu uma poça temporária a partir da evaporação.             | Despejar no chão do Nether em sobrevivência vanilla não coloca bloco de água. Encher um caldeirão é outra interação. [Water Bucket](https://minecraft.wiki/w/Water_Bucket)                                                                                                                             |

A busca já recuperava a ficha correta nos cinco casos. Os erros vieram da interpretação e da geração. Citar um ID comprova que o modelo o mencionou. A confirmação da afirmação depende do fato e da versão. A conferência desta fase é documental, com Java 1.21.5 e Bedrock 1.21.80 como alvos da regressão. Ainda falta reprodução dentro de ambas as versões do jogo.

### Histórico de fichas

- `MP-planks`, `MP-table` e `MP-furnace` esclarecem a grade usada, onde vai o item fabricado e o que constitui a receita.
- `MP-effect` separa a duração, o amplificador e a sintaxe Bedrock. `MP-bedrock-repeater` explicita o estado estável e as duas faixas de entrada. `MP-nether-water` diferencia despejo e caldeirão.
- `MP-sweeping` explicita os dois números de versão em vez de transferir o número do Java ao Bedrock.
- Os metadados de licença do corpus distinguem documentação Microsoft coberta por CC BY 4.0, wiki CC BY-NC-SA 3.0 salvo exceções e páginas Mojang usadas como referência factual. O corpus usa redação própria. [Licença MicrosoftDocs](https://github.com/MicrosoftDocs/minecraft-creator) · [Licença Minecraft Wiki](<https://minecraft.wiki/w/Minecraft_Wiki_(website)>)

## Controle da resposta

A geração recebe instruções para preservar valores, unidades, negações, edição e condições. Depois da inferência, o executor pode compor uma resposta curta a partir de uma regra local e da ficha compatível. Para comandos da lista sem versão, pede a versão antes de entregar uma sintaxe. O relatório conserva `answer`, hash, citações e telemetria brutos, mais `delivered` com método `model`, `rule` ou `clarification` e as fontes da resposta composta, se houver. A telemetria e a checagem `exactCommandPresent` existentes se referem à geração bruta.

As regras têm alcance limitado aos pedidos simples cobertos por elas. Variações de redação podem passar ao modelo e continuar sujeitas a alucinações. A extração de parâmetros e a presença de uma citação não verificam afirmações arbitrárias. As regras nunca executam comandos de jogo. O fluxo público do MinePRO está fora do escopo desta bancada.

## Protocolo congelado para a próxima fase

- O conjunto reservado tem 72 casos inéditos em PT-BR. Cada tema tem seis casos Java e seis Bedrock, com dois de cada dificuldade por edição. Quatro exigem reconhecer informações insuficientes. Enunciados e rubricas estão em arquivo separado, fora da busca, do repositório e da CI.
- A autoria é do mesmo assistente que alterou a bancada. A checagem de texto normalizado encontrou zero duplicatas com os 24 diagnósticos e as 21 consultas de desenvolvimento. Também se revisaram as famílias de perguntas. Ainda é necessário que um revisor independente confira a originalidade semântica e as referências. Os hashes por fonte e por resposta de referência cobrem os registros locais de proveniência, sem arquivar páginas externas.
- O artefato usa nota 2 para acerto integral, 1 para parcial e 0 para erro, evasão indevida ou falha crítica. Relatar acerto integral sobre 72, pontos sobre 144, erros críticos, edição, versão, suporte factual e clareza em português. Medir truncamentos, falhas, latência, throughput e pico de RSS. Informar resultado por categoria e edição.
- Antes de abrir a bateria, verificar a impressão digital em `ai-bench-freeze.json`. Usar o mesmo GGUF, template, runtime e configuração para as modalidades. Usar somente enunciado, edição e versão na geração. Avaliar respostas congeladas e sem indicação de modalidade, com dois revisores humanos e adjudicação das divergências quando possível. Preservar as respostas brutas e entregues. Uma revisão prévia das referências que exigir correção gera uma nova versão do arquivo com hash próprio antes da execução.
- Nenhum dos 72 casos foi enviado ao modelo. Os 24 diagnósticos são dados de regressão. A execução de comparação foi feita com o Qwen3.5-4B e tem classificação assistida separada das verificações determinísticas. Nenhuma avaliação humana nem treino ocorreu nesta etapa.
