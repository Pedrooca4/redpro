# Bancada local do MinePRO AI

A bancada da Fase 3A mede inferência do modelo-base quantizado em português brasileiro. O executor roda fora do Next.js e o contrato do chat público fica separado. Os pesos, binários e relatórios locais ficam em `.minepro-ai-bench/`, ignorado pelo Git.

## Proveniência

O manifesto [models.json](../scripts/ai-bench/models.json) fixa as revisões dos repositórios de origem e da conversão, URLs, tamanhos, hashes e o build do llama.cpp.

| Artefato          | Origem e identificação                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| Qwen3.5-4B        | Qwen, Apache-2.0, revisão `851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a`                                  |
| Qwen3.5-4B Q4_K_M | Conversão comunitária SoAIHQ, revisão `5f113e0dbe6862596f7f5927dbe583c592e887aa`, 2.783.447.136 bytes |
| Qwen3.5-2B Q4_K_M | Alternativa SoAIHQ com o próprio checkpoint e template fixados no manifesto, 1.312.165.056 bytes      |
| llama.cpp         | Release `b12110`, commit `cd959bae99ff4bed22bef2604f45241c09bbb8c8`                                   |

A origem da conversão 4B é declarada pelo publicador do [GGUF](https://huggingface.co/SoAIHQ/Qwen3.5-4B-GGUF/tree/5f113e0dbe6862596f7f5927dbe583c592e887aa). O hash do artefato é divulgado tanto pelo publicador quanto no registro LFS. O experimento usa esse GGUF e carrega o template Jinja **original da Qwen**, verificado por hash. Seus resultados se aplicam à quantização, ao runtime e aos parâmetros registrados. Uma mudança de conversão, revisão, template ou build merece outra medição. Os pesos do modelo-base e os da conversão têm Apache-2.0. O manifesto registra integridade dos arquivos, enquanto a correspondência da conversão com o checkpoint original depende da proveniência declarada pelo publicador.

## Preparação

Use Node.js 24 e pnpm 10.28.1. Planeje pelo menos 8 GiB de RAM total, 5 GiB disponíveis para o processo e 5 GiB livres em disco para a configuração 4B. Esses valores são uma margem de operação para este perfil CPU, não uma garantia para todo computador. Use o 2B se a memória ou a velocidade forem insuficientes. O perfil inicial usa CPU, até oito threads, contexto de 4.096 tokens, um slot, saída de até 256 tokens, modo texto e raciocínio desativado.

### Windows x64, PowerShell

Confira memória e disco antes do download:

```powershell
Get-CimInstance Win32_OperatingSystem | Select-Object Caption, TotalVisibleMemorySize, FreePhysicalMemory
Get-CimInstance Win32_Processor | Select-Object Name, NumberOfLogicalProcessors
Get-CimInstance Win32_VideoController | Select-Object Name
Get-PSDrive -PSProvider FileSystem
node --version
pnpm --version
```

Na raiz do repositório, baixe os artefatos fixados. Para usar a alternativa, troque somente `$modelId` para `qwen3.5-2b`. Separe as pastas de modelos para manter cada template associado aos pesos corretos.

```powershell
$modelId = 'qwen3.5-4b'
$manifest = Get-Content scripts/ai-bench/models.json -Raw | ConvertFrom-Json
$model = $manifest.models | Where-Object id -eq $modelId
$archive = $manifest.runtime.archives.'win32-x64'
$dir = ".minepro-ai-bench/$modelId"
New-Item -ItemType Directory -Force $dir | Out-Null

function Receive-PinnedFile($pin, $path) {
  curl.exe --fail --location --silent --show-error --output "$path.part" $pin.url
  if ($LASTEXITCODE -ne 0) { throw "Falha no download de $path" }
  if ((Get-FileHash "$path.part" -Algorithm SHA256).Hash.ToLowerInvariant() -ne $pin.sha256) {
    throw "SHA-256 divergente em $path"
  }
  Move-Item "$path.part" $path
}

Receive-PinnedFile $archive "$dir/llama.zip"
Receive-PinnedFile $model.conversion "$dir/model.gguf"
Receive-PinnedFile $model.template "$dir/chat_template.jinja"
Expand-Archive "$dir/llama.zip" "$dir/runtime"
$server = (Get-ChildItem "$dir/runtime" -Recurse -File -Filter llama-server.exe | Select-Object -First 1).FullName
& $server --version
pnpm ai:bench run --model $modelId --server $server --weights "$dir/model.gguf" --template "$dir/chat_template.jinja" --out "$dir/resultado.json"
```

### Linux x64, Bash

Confira a máquina antes de executar:

```sh
uname -sm
free -h
df -h .
node --version
pnpm --version
```

Com `curl`, `jq`, `sha256sum` e `tar` disponíveis:

```bash
set -e
model_id=qwen3.5-4b
manifest=scripts/ai-bench/models.json
dir=".minepro-ai-bench/$model_id"
mkdir -p "$dir/runtime"
model=$(jq -ce --arg id "$model_id" '.models[] | select(.id == $id)' "$manifest")
archive=$(jq -ce '.runtime.archives["linux-x64"]' "$manifest")

receive_pinned_file() {
  local pin="$1" path="$2"
  curl --fail --location --silent --show-error --output "$path.part" "$(jq -r .url <<<"$pin")"
  printf '%s  %s\n' "$(jq -r .sha256 <<<"$pin")" "$path.part" | sha256sum --check
  mv "$path.part" "$path"
}

receive_pinned_file "$archive" "$dir/llama.tar.gz"
receive_pinned_file "$(jq -c .conversion <<<"$model")" "$dir/model.gguf"
receive_pinned_file "$(jq -c .template <<<"$model")" "$dir/chat_template.jinja"
tar -xzf "$dir/llama.tar.gz" -C "$dir/runtime"
server=$(find "$dir/runtime" -type f -name llama-server -print -quit)
"$server" --version
pnpm ai:bench run --model "$model_id" --server "$server" --weights "$dir/model.gguf" --template "$dir/chat_template.jinja" --out "$dir/resultado.json"
```

Para uma verificação rápida, acrescente `--case CRA-J01` e use outro nome de saída. O executor valida o tamanho e SHA-256 do GGUF e o SHA-256 do template antes de iniciar o servidor. Ele verifica o build e registra também o hash do executável. O processo filho escuta exclusivamente em `127.0.0.1:18123`, usa uma chave descartável em memória e é encerrado ao fim. Mantenha a porta livre e local. O cliente HTTP tem destino e rotas fixos, sem redirecionamento, e recebe as perguntas como texto. O teste da CI usa respostas simuladas, sem baixar pesos ou binários.

## Casos e resultados

[Os 24 casos](../scripts/ai-bench/cases.json) têm dois exemplos por edição para cada categoria. Java usa 1.21.5 e Bedrock usa 1.21.80. O caso sobre sintaxe dependente de versão mantém a versão deliberadamente ausente. As referências foram consultadas para formular critérios próprios em PT-BR. As licenças e os limites de uso constam no arquivo. Os critérios, fontes e respostas de referência ficam fora das mensagens ao modelo. Reserve a bateria para avaliação e mantenha os casos e suas paráfrases fora do conjunto de treino.

O JSON contém resposta, hash da resposta, latência de ponta a ponta, contagens de tokens, taxa de geração quando reportada pelo runtime, truncamento, falhas, hash da bateria e pico de RSS do processo do modelo quando disponível em Linux. A latência exclui verificação dos pesos e inicialização. Ausência de telemetria aparece como `null`. Um indicador determinístico verifica a presença de um comando canônico em linha isolada. Ele serve para triagem e não é um veredito de correção.

Avalie as respostas com o critério de cada caso e a fonte indicada. Marque acerto integral, parcial ou incorreto, erros de edição/versão, clareza em português, afirmações sem suporte e erro crítico conforme a definição do caso. Grave um array JSON de revisões como este, substituindo o hash pelo `answerSha256` da resposta real:

```json
[
  {
    "caseId": "CRA-J01",
    "answerSha256": "<copie o SHA-256 da resposta>",
    "factual": "correct",
    "editionError": false,
    "versionError": false,
    "portuguese": "clear",
    "unsupportedClaims": false,
    "criticalError": false
  }
]
```

`factual` aceita `correct`, `partial` ou `incorrect`. `portuguese` aceita `clear` ou `needs-review`. É possível revisar apenas uma parte da bateria. As taxas são calculadas sobre as respostas revisadas, com contagem explícita. Sem revisões, as métricas de qualidade ficam pendentes (`null`).

```sh
pnpm ai:bench review --report .minepro-ai-bench/qwen3.5-4b/resultado.json --ratings .minepro-ai-bench/qwen3.5-4b/revisoes.json --out .minepro-ai-bench/qwen3.5-4b/resultado-revisado.json
```

Cada execução grava um novo arquivo e preserva os relatórios existentes. Use um nome diferente para repetir o experimento. A próxima comparação é repetir a bateria com uma base local de fichas verificadas por edição e versão, mantendo os mesmos pesos e parâmetros.
