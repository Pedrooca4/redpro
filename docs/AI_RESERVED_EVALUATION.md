# MinePRO AI — avaliação reservada

## Preparação da Fase 3D-A

A bateria congelada é `minepro-ai-3c-bateria-reservada-v2.json`. O SHA-256 é `d54f5086a8ff29bad21175e3935d8ad98db663a2923589146215edb0d007e5f7`. São 72 casos, 36 por edição, com 12 em cada um dos seis temas e dois em cada combinação de tema, edição e dificuldade. O arquivo tem 69 registros de fonte. Os hashes das fontes vinculam seus metadados. Os hashes das referências vinculam a edição, versão, resposta esperada, critérios, erro crítico e hashes das fontes. A verificação estrutural não confirma a precisão factual nem a acessibilidade de uma página na data da revisão.

Os comandos existentes `run`, `review` e `compare` continuam destinados aos 24 diagnósticos. O manifesto da Fase 3C preserva os hashes históricos. O executor reservado verifica os componentes de geração usados por ele e registra separadamente os hashes da nova orquestração. O mesmo Qwen3.5-4B Q4_K_M, corpus, prompt, template e parâmetros congelados atendem as três modalidades. O executável verificado é o binário Linux registrado no manifesto, e o ambiente deve oferecer as oito threads usadas no congelamento.

Mantenha a bateria na cópia privada persistente. No computador da avaliação, use um diretório POSIX absoluto fora de checkouts Git e de pastas compartilhadas ou publicadas. Use Linux, inclusive WSL quando compatível com o binário e com permissões POSIX. O diretório deve pertencer ao usuário atual e ter modo `0700`. O arquivo da bateria deve ter modo `0600`, nome fixo e bytes idênticos ao congelamento. Links simbólicos e hardlinks para arquivos privados são recusados.

```sh
private_dir=/caminho/privado/minepro-avaliacao
install -d -m 700 "$private_dir"
install -m 600 /caminho/do/download/minepro-ai-3c-bateria-reservada-v2.json "$private_dir/"
pnpm ai:bench reserved-check --private-dir "$private_dir"
pnpm ai:bench reserved-reference-pack --private-dir "$private_dir"
```

Esses dois comandos leem e validam a bateria sem abrir um servidor ou carregar pesos. O segundo produz `reference-pack.json`, com um formulário privado para o avaliador. Enunciados, referências, formulários e resultados ficam fora do GitHub, da CI, de logs compartilhados e do corpus do MinePRO.

## Revisão humana das referências

1. Entregue `reference-pack.json` em privado a uma pessoa que não tenha escrito os casos nem desenvolvido as regras. Preserve o original como formulário.
2. Em cada caso, abra a fonte indicada, confira a edição e a versão e compare pergunta, resposta esperada, critérios e condição de erro crítico. Registre na coluna `notes` a evidência usada e eventuais dúvidas. Quando houver dúvida que a documentação não resolve, confira a mecânica no jogo ou deixe o item pendente.
3. Preencha `sourcesVerified`, `editionVerified`, `versionVerified` e `rubricVerified` com `true` apenas onde a verificação foi feita. Preserve todos os IDs e hashes. Se houver erro, registre a correção proposta em separado. Corrigir uma referência ou enunciado exigirá congelar uma nova revisão antes de qualquer execução.
4. A pessoa preenche `reviewer` com um identificador acordado, `origin` com `"human"` e `independent` com `true` se atestar a independência. Salve a revisão como `reference-review.json`, com permissão `0600`, na pasta privada. O executor verifica a cobertura e o vínculo com os hashes. A identidade e independência são declarações do avaliador.

A revisão independente está pendente nesta fase.

## Execução posterior e pontuação

Após a autorização da Fase 3D-B e a revisão das referências, o comando de execução é:

```sh
pnpm ai:bench reserved-run --private-dir "$private_dir" \
  --server "$llama_server" --weights "$qwen_4b_gguf" --template "$chat_template"
```

| Modalidade | Origem da resposta                               |
| ---------- | ------------------------------------------------ |
| A          | Uma geração do Qwen sem recuperação.             |
| B          | Uma geração do Qwen com as fichas do MinePRO.    |
| C          | A saída de B após a avaliação das regras locais. |

C referencia o ID e o hash de B e guarda seu próprio ID, texto, hash e origem. Se a regra não atuar, B e C terão o mesmo hash de texto e IDs distintos. Correção por regra, pedido de esclarecimento e passagem direta de B são identificáveis. A geração recebe edição, versão e pergunta. B também recebe fichas recuperadas. Respostas esperadas, rubricas e fontes reservadas são usadas na revisão.

A avaliação de respostas é feita em um pacote com ordem aleatória por pergunta e sem rótulos A, B ou C. Citações e textos idênticos podem dar pistas sobre a modalidade. O operador deve manter o manifesto e os checkpoints sob sua guarda. O avaliador recebe apenas o pacote necessário.

```sh
pnpm ai:bench reserved-blind-pack --private-dir "$private_dir" --run-id "$run_id"
```

O arquivo `blind-pack.json` inclui critérios e um ID opaco por resposta. O avaliador registra a nota no seguinte formato em `ratings.json` (modo `0600`) no diretório da execução:

```json
{
  "schemaVersion": 1,
  "runId": "ID da execução",
  "origin": "human",
  "reviewer": "identificador do avaliador",
  "ratings": [
    {
      "id": "ID da resposta no pacote",
      "answerSha256": "SHA-256 da resposta no pacote",
      "points": 2,
      "criticalError": false,
      "editionError": false,
      "versionError": false,
      "unsupportedClaims": false,
      "needsPortugueseReview": false,
      "note": "Critérios cumpridos e justificativa"
    }
  ]
}
```

Use 2 para acerto integral, 1 para parcial e 0 para erro ou falha crítica. Registre a origem real como `human` ou `assisted`. Respostas sem nota ficam pendentes. Rode `pnpm ai:bench reserved-score --private-dir "$private_dir" --run-id "$run_id"` para validar os vínculos e produzir uma revisão com totais separados para A, B e C. O arquivo `scored-*.json` é novo a cada importação. Preserve as notas originais de cada avaliador e, se houver mais de um, faça a adjudicação em uma revisão adicional.

## Armazenamento e recuperação

A execução usa um diretório privado com UUID. O manifesto é gravado antes da inicialização do modelo. Cada caso concluído é persistido em arquivo próprio com sincronização em disco e publicação atômica. Os arquivos são exclusivos e não substituem resultados anteriores. O manifesto registra modelo, pesos, quantização, configuração, hashes do corpus e do código, ambiente e IDs. Os checkpoints guardam textos de A/B/C, fichas recuperadas e procedência, latência de cada geração, tempo da regra, pico acumulado de memória do processo quando disponível e falhas. O relatório de notas vincula hash, avaliador e procedência de cada nota. `status.json` registra a conclusão ou interrupção quando o processo consegue finalizar.

Use armazenamento privado durável desde a primeira geração. Antes de iniciar, confirme que consegue restaurar o diretório em outra sessão e repetir `reserved-check`. Se o ambiente só oferecer disco temporário do Work, configure um destino privado durável antes de rodar. A sincronização em disco preserva checkpoints em uma interrupção do processo, mas não protege um volume descartado. Exporte cópias privadas durante a execução e ao final. Um exemplo para um segundo volume privado, já montado e verificado:

```sh
install -d -m 700 "$backup_dir/$run_id"
rsync -a --ignore-existing --exclude='.pending-*' \
  "$private_dir/$run_id/" "$backup_dir/$run_id/"
```

Preserve também a bateria congelada e a revisão de referências, em arquivos separados, em armazenamento privado persistente. A nota e o pacote cego podem ser processados a partir dos checkpoints concluídos mesmo se faltar `status.json`. Uma queda durante um caso pode perder esse caso. Uma nova execução recebe outro ID. Não combine checkpoints de execuções diferentes.
