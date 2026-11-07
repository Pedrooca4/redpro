# MinePRO — preparação do Kysely pelo celular

## Estado e fronteiras

Configuração preparada a partir da `main` `595839f624e9e0db6c19748b676b4e9630a41dbe`, sem incluir o PR #15, que continua aberto e sem merge. Nenhum Codespace, token, usuário, secret, permissão, configuração de Supabase/Vercel ou migração real foi criado/aplicado por esta preparação. Esta branch exige revisão e autorização antes do merge por preparar acesso administrativo futuro.

O repositório é privado, pessoal e o proprietário tem acesso administrativo. GitHub documenta Codespaces em contas pessoais Free/Pro, inclusive para repositórios privados; isso não comprova a cota restante, habilitação e restrições específicas desta conta. O conector não expõe Codespaces/cobrança e o endpoint de preflight não é aceito por ele. **O proprietário precisa confirmar a opção e a cota no celular antes de criar uma instância.** Não foi criada uma instância sem essa confirmação, porque computação/armazenamento podem gerar custos.

A interface web pode ser usada no celular; telas pequenas e teclado virtual limitam a praticidade. Node, Git, pnpm e Docker executam na máquina remota, sem instalação no telefone. A CI em Dev Container verifica imagem/ferramentas/fixtures; não comprova a experiência de toque/terminal da conta do proprietário.

## Cota, custos e encerramento

GitHub Free pessoal inclui 120 horas-core e 15 GB-mês por ciclo. Uma máquina de 2 cores consome 2 horas-core por hora ativa, aproximadamente 60 horas reais se toda a cota estiver disponível. Armazenamento é medido no tempo, não apenas pelo tamanho do checkout. Dados de Docker/imagem customizada, dependências e instâncias paradas ainda podem consumir armazenamento; não há promessa de gratuidade ilimitada.

Antes de criar, no GitHub pelo navegador: avatar → Settings → Billing/Licensing → uso/orçamentos. Conferir cota restante e um orçamento de Codespaces com **Stop usage when budget limit is reached** habilitado. Alertas sozinhos não bloqueiam cobrança. Confirmar que o limite corresponde a nenhum gasto adicional pretendido; se isso não puder ser comprovado na interface, parar sem criar. Sem meio de pagamento, o GitHub documenta bloqueio ao esgotar a cota, mas não verificamos a situação de pagamento desta conta. Não alterar cobrança ou adicionar cartão para seguir este guia.

Usar a menor máquina compatível (2 cores), um único Codespace, sem prebuilds e com o menor timeout de inatividade disponível. A configuração de código não muda timeout nem orçamento da conta. O padrão documentado é 30 minutos; saída de terminal pode renovar esse prazo, portanto não confiar apenas no timeout.

Para parar pelo celular: abrir `github.com/codespaces`, menu **…** da instância → **Stop codespace**. **Fechar a aba não para a máquina.** Quando não for mais necessário, conferir que o trabalho foi commitado/publicado e então usar **Delete**; excluir descarta arquivos não salvos e depende de decisão explícita do proprietário. Parar reduz computação futura, excluir também reduz armazenamento futuro; uso já acumulado não é devolvido. Esta preparação não para/exclui recursos existentes.

## Abrir e testar sem credenciais

Somente após conferir disponibilidade, cota e autorizar a criação sem custo adicional:

1. Abrir `Pedrooca4/redpro` pelo navegador do celular. Para testar a preparação antes do merge, selecionar a branch `codex/codespaces-kysely-preparation`; **não usar credenciais reais nessa branch**.
2. **Code → Codespaces → … → New with options**. Conferir repositório, branch, responsável pela cobrança e máquina de 2 cores antes de criar. Se não aparecer Codespaces ou houver exigência de pagamento, parar. Usar “Site para computador” se os controles estiverem ocultos.
3. Não cadastrar recommended secrets, repository secrets nem Codespaces secrets. O `postCreateCommand` verifica versões e instala dependências fixadas com lifecycle scripts desabilitados, sem conexão a banco. Se detectar configuração de banco/token herdada, recusa a preparação sem imprimir valores.
4. A imagem publicada `javascript-node:5.2.3-24-bookworm` está fixada por digest, fornece Node 24.21.0 e recebe pnpm **10.28.1**. A feature oficial Docker-in-Docker **4.1.3** fornece daemon próprio no Codespace. Não compartilha Docker de produção; usa privilégios elevados dentro dessa VM e exige que ela/código sejam confiáveis. Não há portas automaticamente encaminhadas.
5. No terminal remoto, executar os comandos abaixo, que não usam o Supabase:

```sh
pnpm check:env
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:db:disposable
```

`test:db:disposable` cria um container PostgreSQL 17.11 com senha **pública de fixture**, nome aleatório, dados em tmpfs e porta dinâmica publicada somente em `127.0.0.1`. Executa a suíte de integração existente, incluindo o runner/locks, e remove somente o container criado por esse comando ao terminar/falhar/receber sinal tratável. Cada execução usa um banco novo. Não faz prune global nem toca containers alheios. Encerramento abrupto do daemon/VM pode impedir cleanup; conferir pelo label `com.minepro.disposable=true` antes de encerrar a instância, sem remover recursos desconhecidos. Se Docker estiver indisponível, o comando falha; não substitui o serviço por banco remoto e não ignora testes.

A CI adicional `codespaces-check.yml` constrói e executa esta configuração com `devcontainers/ci` fixado por SHA, sem herdar secrets, sem publicar imagens e sem criar um Codespace na conta. A CI anterior e as seis migrações permanecem preservadas. São testes em GitHub Actions, sujeitos à cota normal desse serviço; não alteramos cobrança nem orçamento.

## Compatibilidade do acesso temporário Supabase

O recurso documentado aceita token Supabase (PAT com escopos ou sessão do painel) como credencial PostgreSQL, associado a um papel. **Não é um JWT de jogador, chave publicável, service_role ou token OIDC do GitHub.** Não substitui autorização de operações nem reduz sozinho os poderes do papel assumido.

A leitura de metadados da plataforma confirmou o projeto autorizado `rdwchjjxaipkufgxlnvh` ativo com versão **17.11.0.003**, superior ao mínimo documentado **17.6.1.081**. Não foi aberta conexão administrativa pelo runner. Ainda faltam confirmar no projeto: disponibilidade da opção, **Enforce SSL**, estado do temporary access, associação do proprietário ao papel, escopos do token, expiração/revogação e eventuais restrições de rede. Nenhum desses itens foi habilitado ou modificado. A documentação informa que o recurso vem desabilitado por padrão; isso não prova seu estado atual nesta conta.

| Conexão                                                        | Compatibilidade preparada                                                                                                       | Limitação                                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Direta `db.<ref>.supabase.co:5432`                             | Token na fonte privada de senha, TLS/CA e locks de sessão preservados                                                           | Exige rede IPv6 ou acesso IPv4 disponível, além da configuração temporária real |
| Shared **Session pooler**, porta **5432**                      | Novo modo explícito `REDPRO_DB_AUTH_MODE=temporary` acrescenta somente `-c jit=on` às opções de startup do pg, mantendo UTC/TLS | Autenticação Supavisor/JIT real ainda não testada                               |
| Transaction pooler / porta 6543 / dedicated transaction pooler | **Recusado**                                                                                                                    | Incompatível com locks de sessão do runner; não contornar                       |

O runner anterior não enviava `jit=on`. O modo opcional novo prepara essa compatibilidade sem aceitar opções arbitrárias na URL, sem alterar defaults do modo `password`, sem alterar fingerprint do destino ou o lock corrigido no PR #14. `temporary` é recusado para fixtures locais e valores desconhecidos falham fechados. Testes sintéticos de configuração não comprovam autenticação Supabase, validade do token ou rede real. O token pode expirar e a operação falhar; uma perda de conexão durante commit exigirá reconciliação por leitura, sem retry automático de migração.

Se temporary access estiver indisponível ou desconhecido, o modo `password` aceita uma credencial exclusiva de curta validade do papel `minepro_ledger_reader`, mediante autorização específica. O helper de inspeção aceita somente o Session pooler na porta 5432. A conexão direta descrita acima refere-se ao runner administrativo. Não usar a senha de `postgres` nem uma credencial já exposta.

## Primeira conexão privada — procedimento futuro, ainda não autorizado

1. Obter aprovação do PR e do SHA de merge da `main`, com CI verde. Abrir um Codespace limpo da **main aprovada**, sem secrets automáticos, revisar código/imagem/features/dependências/extensões. Concluir instalação e todos os testes **antes** de fornecer credencial. O PR #15 não é dependência.
2. Por autorização separada, revisar o papel `minepro_ledger_reader` e seus privilégios efetivos conforme [DATABASE.md](DATABASE.md). Confirmar Enforce SSL. Usar uma senha exclusiva de curta validade ou, se o temporary access estiver confirmado e aprovado, token curto associado ao mesmo papel. O helper constrói o usuário `minepro_ledger_reader.rdwchjjxaipkufgxlnvh`.
3. Baixar a **CA pública do servidor** pelo painel do projeto e colocá-la em `.minepro-ca/server-ca.crt` no Codespace (pasta ignorada pelo Git). Esse é o único arquivo de conexão permitido pelo helper; não salvar senha, token, `.env` ou chave privada. Usar o Host exibido em **Connect → Session pooler** do projeto; não copiar nada da Vercel.
4. Após autorizar expressamente a primeira leitura real, executar o comando abaixo com os três dados não secretos revisados. O helper exige Codespaces, repositório correto, branch main limpa, SHA local igual ao informado e ao HEAD remoto da main, CA pública válida e destino/porta/mecanismo permitidos. Antes disso, não pede credencial.

```sh
pnpm db:inspect:private SHA_COMPLETO_APROVADO HOST_DO_SESSION_POOLER .minepro-ca/server-ca.crt password
```

Usar `temporary` no último argumento somente quando esse modo estiver habilitado, associado ao papel leitor e aprovado. Somente quando aparecer o prompt **“Credencial privada (entrada oculta…)”**, fornecer a credencial diretamente no terminal privado. O helper desliga tracing, recusa pipes e mantém a credencial em memória/ambiente dos processos filhos até sair. A entrada dedicada aceita apenas `target`, `check` e `status`, sem carregar arquivos `.env`, e interrompe na primeira falha. O runner administrativo também recusa o papel leitor antes de conectar para migrar.

Esperado: destino `rdwchjjxaipkufgxlnvh`, `target` com `connected:false`, `check` com `readOnly:true` e `tlsVerified:true`, e status das seis migrações. O preflight não conecta; não interpretar `connected:false` como teste de rede. O status não é auditoria completa de objetos/ACL. Credencial não deve aparecer em saída; em caso de problema, compartilhar apenas os códigos seguros, nunca env/URL/token. Não executar instalação, build, testes ou código adicional enquanto a credencial estiver fornecida; o helper encerra o escopo ao terminar os três comandos.

Limites: processos/extensões do mesmo usuário, root e código malicioso podem acessar memória/env. Nenhum script garante sigilo diante de ambiente comprometido. Um input oculto evita eco/histórico, não transforma código não confiável em seguro. A conta de migração continua poderosa; não expor essa identidade à interface ou aos jogadores. Encerrar conexões e verificar expiração/revogação quando o acesso temporário autorizado terminar. Não se afirma que expirar um token encerra automaticamente sessões já abertas.

## Autorizações ainda necessárias

- Confirmar elegibilidade/cota/bloqueio de custos e autorizar criação de Codespace, se ainda não comprovado.
- Revisar e autorizar **merge separado** deste PR de preparação de acesso.
- Autorizar separadamente qualquer mudança real de SSL/temporary access/mapeamento/permissões e criação/uso de credencial temporária; apresentar antes o plano exato e reversão, sem valores secretos.
- Autorizar a primeira conexão real de leitura; revalidar destino, ledger completo e pré-requisitos via conector.
- Somente depois: autorização explícita de **uma migração exata por vez**, SHA/fingerprint/ledger esperados e validação posterior. Esta tarefa não autoriza nenhuma aplicação/reversão. Não disponibiliza um botão para migrar.

Referências oficiais: [Codespaces e contas pessoais](https://docs.github.com/en/codespaces/developing-in-a-codespace/creating-a-codespace-for-a-repository), [cobrança](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces), [orçamentos com bloqueio](https://docs.github.com/en/billing/how-tos/set-up-budgets), [inatividade](https://docs.github.com/en/codespaces/setting-your-user-preferences/setting-your-timeout-period-for-github-codespaces), [parar/iniciar](https://docs.github.com/en/codespaces/developing-in-a-codespace/stopping-and-starting-a-codespace), [acesso temporário](https://supabase.com/docs/guides/platform/temporary-access), [conexões Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres).

## Sessão administrativa de leitura

O comando `db:inspect:admin` é independente de `db:inspect:private`. Seu uso exige
autorização específica para a instância Codespaces, o SHA e a conexão ao projeto de
desenvolvimento `rdwchjjxaipkufgxlnvh`. O papel `postgres` continua administrativo,
inclusive com capacidade de contornar RLS. A transação somente leitura limita o
helper. Ela não restringe o papel em outros programas ou sessões.

1. No Codespaces existente e autorizado, confirme o nome no painel do GitHub.
   Use a `main` limpa, no SHA completo aprovado após revisão e CI. Conclua a instalação
   antes da sessão. Use um terminal privado sem compartilhamento, gravação, depuração,
   injeção de código Node ou configuração de credenciais de banco no ambiente.
2. No painel **Connect** do Supabase de desenvolvimento, confira o host da conexão
   direta ou do **Session pooler** na porta 5432. Confirme **Enforce SSL** em
   **Database Settings** e obtenha ali a CA pública oficial. Coloque somente a CA em
   `.minepro-ca/server-ca.crt` dentro do Codespace. O comando valida o certificado da
   CA, a cadeia TLS e o hostname. A origem da CA deve ser conferida no painel.
3. Após autorização para a conexão de leitura, execute:

   ```bash
   pnpm db:inspect:admin NOME_DO_CODESPACE SHA_APROVADO HOST_DO_PAINEL .minepro-ca/server-ca.crt
   ```

   Digite a credencial administrativa já autorizada apenas no prompt oculto. O
   helper aceita autenticação por senha e mantém a entrada na memória do processo,
   sem histórico, exportação ao ambiente, argumentos ou arquivo. Feche o terminal
   privado ao terminar. Um ambiente comprometido ainda pode capturar a entrada ou
   a memória. As variáveis do Codespaces são conferências locais e o nome precisa
   corresponder à instância autorizada pelo operador.

4. Confira a sequência `database.target`, `database.connected` e
   `database.migrations`. O helper verifica o SHA local e remoto antes do prompt
   e novamente antes de conectar. O check e o status compartilham uma transação
   `REPEATABLE READ READ ONLY`, com identidade `postgres` no banco `postgres`.
   Ledger ausente aparece com `ledgerPresent: false` e migrações pendentes, sem criar metadados. Linhas
   desconhecidas ou fora de ordem encerram a operação. O comando faz uma tentativa
   de conexão, sem fallback de TLS ou reexecução automática. Em caso de falha,
   verifique os pré-requisitos separadamente e obtenha autorização para nova tentativa.

Uma aprovação para esta sessão cobre apenas destino, conexão e status. Aplicar
uma migração pelo runner normal é uma operação separada e requer nova autorização.
