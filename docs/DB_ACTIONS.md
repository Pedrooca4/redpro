# MinePRO — inspeção privada do banco pelo celular

## Estado e viabilidade

Preparação de código, **sem merge autorizado e sem execução com credenciais reais**. Base revisada: `595839f624e9e0db6c19748b676b4e9630a41dbe` (PR #14). Repositório privado `Pedrooca4/redpro`, de conta pessoal; projeto de desenvolvimento exclusivo `rdwchjjxaipkufgxlnvh`.

O navegador do celular permite configurar recursos e acionar `workflow_dispatch`; se algum menu estiver oculto, use “Site para computador” do navegador. Não é necessário Node, Git, PowerShell, aplicativo SQL ou GitHub Mobile. O workflow somente aparece para acionamento normal depois de integrado à branch padrão; **não executar pela branch do PR nem fornecer credenciais antes da revisão**.

A disponibilidade do plano da conta e das proteções reais **não pôde ser confirmada**: o conector não oferece os endpoints de cobrança/Environments e o navegador não tem sessão autenticada. Não confundir essa limitação de acesso com ausência comprovada de uma funcionalidade.

Disponibilidade segundo a documentação atual do GitHub:

| Recurso em repositório privado                            | Disponibilidade documentada                                                                            |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Actions manual e repository secrets                       | Disponíveis nos planos atuais; sujeitos à habilitação e limites de uso da conta                        |
| Environments, environment secrets e restrição de branches | Pro/Team/Enterprise; Free não oferece esses controles em repositório privado                           |
| Required reviewers / wait timer                           | Free/Pro/Team oferecem somente em repositórios públicos; em privado requer plano compatível Enterprise |

**Decisão de segurança deste desenho:** não expor a senha administrativa com apenas um botão manual e repository secrets acessíveis por código de outras branches. Exigir environment secrets, restrição de branch `main`, aprovação do proprietário e bypass administrativo desabilitado. É uma escolha conservadora para esta credencial; não significa que o usuário já tenha esse plano, nem recomenda pagar ou tornar o repositório público. Se qualquer controle não estiver disponível ou não puder ser lido, o preflight falha e o job com credenciais não deve iniciar. Nenhum downgrade de proteção, transferência de repositório ou contratação está autorizado. Uma alternativa futura seria avaliar credencial SQL realmente restrita a leitura, com autorização específica para criá-la; ela **não foi criada** e não se deve reutilizar a senha administrativa como substituto.

Não cadastrar segredos agora. Primeiro o proprietário confere o plano e a disponibilidade em Settings; a ativação exige uma decisão separada. Este PR pode ser revisado/testado sem acesso ao banco.

## Fluxo e controles preparados

Arquivo `.github/workflows/db-inspect.yml`, somente `workflow_dispatch`, sem push, PR, chamada reutilizável ou cron. Recebe apenas `approved_sha`, sem comando SQL, senha, URL, nome livre de ambiente ou operação de migração. `permissions: {}` no nível global; jobs usam somente `contents: read` e `actions: read` para checkout e metadados. Nenhum PAT adicional é necessário.

1. Recusar evento/ref/repositório/ator diferentes dos fixados, antes do checkout; somente `Pedrooca4`, inclusive em reexecuções, pode iniciar a inspeção.
2. Fixar checkout no SHA completo informado, que precisa ser o SHA do evento e da `main` atual. Actions fixadas por commit; checkout não retém credenciais.
3. Consultar exclusivamente metadados por GET: identidade privada do repositório, SHA atual, proteções do environment e política exata de branch `main` (sem tags ou curingas). Não consulta valores nem endpoints de secrets.
4. Exigir required reviewer `Pedrooca4`, sem outro aprovador e sem bypass administrativo. Como o proprietário inicia e aprova, `Prevent self-review` precisa estar desmarcado: **não é separação de funções nem aprovação por duas pessoas**. Uma configuração diferente falha, exigindo revisão do desenho antes de uso.
5. Exigir a execução mais recente de `ci.yml` para push nesse SHA/main, concluída com sucesso e os dois jobs esperados aprovados. CI pendente, falha, cancelada, ignorada ou inacessível bloqueia.
6. Job dependente usa o environment fixo `minepro-development-inspection`. Depois da aprovação, instala dependências fixadas com `--frozen-lockfile --ignore-scripts`, antes de disponibilizar segredos; não usa caches ou artifacts privados. Repete o gate imediatamente antes da etapa de conexão.
7. Injetar credenciais somente nessa última etapa. Validar destino, usuário PostgreSQL, porta 5432, fonte separada de senha, CA pública e TLS. Recusar porta 6543/Transaction pooler, outro projeto, ambiente de produção/Vercel, CA inválida e modo de debug.
8. Executar somente as implementações de `db:target`, `db:check`, `db:status`, nessa ordem, sem carregar arquivos `.env`. `check` e `status` passam a abrir sessões com `default_transaction_read_only=on`; `check` mantém sua transação explícita de leitura e a CLI confirma também `default_transaction_read_only=on` no servidor, recusando configuração ignorada pelo pooler. Conexões de migração continuam inalteradas e graváveis quando autorizadas separadamente.
9. Capturar a saída dos subprocessos sem encaminhar stdout/stderr bruto. Publicar somente JSON de metadados após os três comandos aprovados, com allowlist de campos, SHA/fingerprint, destino, TLS/leitura e seis migrações conhecidas na ordem histórica, cujo estado aplicado deve formar um prefixo. Falhas imprimem apenas códigos seguros. `target` continua `connected:false` e não comprova conexão.

O certificado público é gravado temporariamente com modo `0600` no runner e removido em `finally`; nunca se grava senha, URL ou `.env`. Não há upload de artefatos, exportação de secrets, logs de ambiente, comandos com senha ou migração durante checkout/build/deploy. Cancelamento abrupto pode impedir `finally`; o arquivo é apenas a CA pública e o runner hospedado é descartável.

Concorrência do workflow: grupo fixo `minepro-development-database`, sem cancelar uma execução ativa. Isso não substitui o lock PostgreSQL corrigido no PR #14, preservado para uma futura operação de migração; a inspeção não aplica migrações nem adquire esse lock. GitHub pode substituir execuções ainda na fila; isso não é autorização de aplicação.

## Limitações e risco residual

- A senha administrativa permite muito mais que leitura no servidor. `default_transaction_read_only` é defesa contra escrita acidental, **não privilégio mínimo imposto pelo banco**: código malicioso com essa identidade poderia desativá-lo. Aprovar o SHA significa confiar em todo código executado e nas dependências do lockfile, não apenas no YAML. Instalar antes dos segredos/ignorar lifecycle scripts reduz a exposição, mas não elimina import malicioso, processos em segundo plano ou dependências comprometidas.
- GitHub mascara secrets, mas transformações não são necessariamente mascaradas. Por isso o wrapper nunca repassa mensagens brutas. Não habilitar debug, imprimir env, adicionar artefatos ou divulgar logs privados indiscriminadamente.
- Proteções do próprio GitHub e o revisor são parte da fronteira de confiança. Não cadastrar os mesmos nomes como repository/organization secrets; isso poderia permitir acesso por outro workflow/branch. Um administrador que mude o environment após a revisão continua sendo um risco. Há rechecagem após aprovação, mas não uma garantia atômica entre API do GitHub e PostgreSQL.
- Plano, Environment real, regras de branch, secrets, rede e certificado do projeto **não foram validados numa execução real**. Respostas 403/404, campos ausentes ou indisponibilidade dos controles falham fechadas; não resolver concedendo permissões de escrita ao token ou criando PAT amplo.
- Runners hospedados podem não alcançar a conexão direta IPv6. Preferir o **Session pooler do próprio projeto**, porta 5432, com usuário `postgres.rdwchjjxaipkufgxlnvh`. O host deve ser o indicado no painel; não adivinhar região. A conexão direta aceita `postgres`/`db.rdwchjjxaipkufgxlnvh.supabase.co:5432` quando houver conectividade. Nunca usar a integração Vercel `supabase-copper-tree`, que pertence a outro recurso.
- `db:status` mostra o estado reconhecido pelo provider Kysely, não prova integridade completa de cada objeto/timestamp/ACL nem detecta toda adulteração administrativa. A aplicação futura exige inspeção adicional de catálogo/ledger e Security Advisors.
- Não altera o PostgreSQL real, Auth, RLS, permissões, credenciais, Vercel, domínio ou interface pública. As seis migrações e o runner de aplicação/reversão permanecem preservados.

## Configuração pelo navegador do celular — somente após aprovação separada

1. Entre na sua conta em `github.com`. Avatar → **Settings** → área de **Billing / Licensing**: confira o plano atual. No repositório, **Settings → Environments**: confirme se as proteções acima estão disponíveis. Se faltar uma opção, **pare sem cadastrar segredos**; informe apenas o nome da opção ausente, nunca dados de cobrança ou credenciais.
2. Depois da revisão e autorização de configuração, crie/seleciona o environment `minepro-development-inspection`. Configure **Selected branches and tags**, somente regra **Branch: main**, sem tags. Adicione **Required reviewers: Pedrooca4**, não marque **Prevent self-review** neste desenho de proprietário único e desmarque a opção que permite bypass administrativo. Nenhuma configuração foi feita por este lote.
3. Em **Environment secrets → Add environment secret**, cadastre exclusivamente estes nomes, diretamente no formulário seguro:

   - `MINEPRO_DEV_DATABASE_URL`
   - `MINEPRO_DEV_DB_PASSWORD`
   - `MINEPRO_DEV_DB_CA_PEM`

   A primeira recebe a URL **sem senha**, construída pelos parâmetros de Connect → **Session pooler** do projeto autorizado; a senha fica somente no segundo secret. A terceira recebe apenas o certificado **público** do servidor baixado em Database Settings → SSL Configuration, nunca certificado/chave privada. Não cole aqui na conversa, não copie variáveis da Vercel e não cadastre como repository secrets. Não use prints do formulário preenchido.

4. Depois de merge autorizado, configuração verificada e autorização específica para a primeira conexão real de leitura: abra **Actions → MinePRO development database inspection → Run workflow**. Selecione `main` e informe seu SHA completo, previamente revisado e com CI verde. Acione; na execução, use **Review deployments** e aprove somente o job desse SHA/ambiente/destino. Dependendo do navegador, ative a visualização de computador.
5. Confira os JSON seguros: `target` com `connected:false`; `database.connected` com destino autorizado, `readOnly:true`, `tlsVerified:true`, PostgreSQL 17; as seis migrações em ordem. Isso **não aplica nenhuma delas**. Se falhar, pare e traga apenas o código seguro de erro; não envie secrets, certificado ou URL privada. Limites de minutos/armazenamento de Actions privados podem gerar custos segundo a conta; este lote não altera cobrança nem orçamento.

## Segunda etapa futura — plano, sem botão de aplicação

Exige nova autorização e outro PR/revisão de segurança. Não ampliar este workflow com parâmetro `up/down` ou SQL livre.

- Inspecionar novamente catálogo, Auth, privilégios, colisões, histórico completo Kysely e Security Advisors do projeto autorizado; não inferir destino pelas variáveis Vercel. Revalidar rede/TLS por este fluxo de leitura.
- Propor um workflow separado de aplicação, com aprovação explícita do proprietário **para cada nome**, SHA de código e fingerprint de destino. Exigir também estado/digest esperado do ledger, sem entradas artificiais.
- Conferir SHA aprovado, hash dos arquivos congelados e CI; confirmar a etapa imediatamente anterior. Usar o mesmo grupo de concorrência, `cancel-in-progress:false`, e o runner Kysely do PR #14, cujo lock/seleção/transação impedem avançar a etapa vizinha. Uma única execução chama uma única etapa exata, sem batch ou reaplicação automática.
- Parar se destino, SHA, ledger, nome, resultado ou objetos divergirem. Nenhum retry de mutação após erro ambíguo de rede/commit: primeiro reconciliar por leitura e solicitar decisão.
- Após cada aplicação: histórico exato, objetos esperados, constraints/FKs, RLS/ACL, funções/triggers preservados e Advisors sem novos alertas. Catálogo somente leitura; não criar usuários/dados de teste no banco real.
- Reversão requer autorização própria e guards existentes; não usar CASCADE, apagar dados para facilitar down ou alterar SQL aplicado.

Ordem preservada: `development_probe` → `profiles` (RED-013) → `conversations_messages` (RED-014) → `projects` (RED-015) → `community` (RED-016) → `reports_moderation` (RED-017), com os seis nomes completos verificados por `scripts/db-inspect.ts`.

## Validação desta preparação

Testes unitários usam somente metadados e credenciais sintéticas: evento/ator/ref/SHA, proteções indisponíveis, branch/tag, CI falha/ignorada, GETs fixos, destino/TLS/fonte de senha, CA pública, saída sanitizada e falha antes de conexão. A integração usa apenas PostgreSQL descartável e comprova leituras e rejeição de INSERT/UPDATE/DELETE/CREATE por sessão read-only, preservando dados. Testes reais de Environments/aprovação/segredos/rede permanecem pendentes até autorização; mocks não comprovam disponibilidade do plano.

Referências oficiais: [Environments e planos](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments), [execução manual pelo navegador](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow), [API de Environments](https://docs.github.com/en/rest/deployments/environments), [branch policies](https://docs.github.com/en/rest/deployments/branch-policies), [segredos e limites do mascaramento](https://docs.github.com/en/actions/concepts/security/secrets).
