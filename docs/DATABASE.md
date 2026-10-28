# PostgreSQL de desenvolvimento — RED-011/012

## Destino e estado real

O projeto Supabase **REDPRO**, ref `rdwchjjxaipkufgxlnvh`, organização IA, foi reservado pelo usuário exclusivamente para desenvolvimento. A conexão direta por variáveis de ambiente foi comprovada com PostgreSQL 17, TLS com CA/hostname verificados e transação de somente leitura confirmada pelo servidor. Não foi criado projeto duplicado nem contratado plano pago.

O site na Vercel continua sem consumir banco. `/api/health` mantém o contrato de saúde do processo e não afirma conectividade externa. Não há conexão nem migração durante build, inicialização ou deploy. Dados e schemas de produto ainda não existem.

## Escolha técnica

Kysely 0.29.7 e `pg` 8.23.1 fornecem query builder tipado, parâmetros, transações, migrações ordenadas `up`/`down` e lock de execução. `@types/pg` 8.23.1 é dependência de desenvolvimento. As versões estão fixadas no lockfile. A arquitetura oficial permite ORM ou query builder consolidado, sem impor um produto. O ADR-002 registra a decisão e as alternativas.

`src/db/connection.ts` concentra o pool e a construção do Kysely. `src/db/index.ts` é a entrada marcada `server-only` para futuras features. A configuração usa também módulos exclusivos de Node. Não importe banco em componentes cliente. Os contratos das tabelas serão acrescentados nas REDs correspondentes; este lote não antecipa repositories de domínio da RED-021 nem schemas da RED-013 em diante.

O acesso SQL direto usa a identidade PostgreSQL configurada, não a sessão do cliente Supabase. Ele não aplica automaticamente `auth.uid()` nem autorização de usuários. Credenciais administrativas de migração não devem ser usadas por futuras features públicas; permissões e identidade serão implementadas nas etapas correspondentes.

## Configuração privada

Use `.env.development.local`, ignorado pelo Git, com os nomes do `.env.example`. Não envie valores pelo chat, GitHub, screenshots ou logs.

| Nome                    | Uso                                                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`          | URL PostgreSQL privada do destino de desenvolvimento. Direta ou session pooler na porta 5432.                                       |
| `REDPRO_DB_PASSWORD`    | Alternativa privada: senha sem codificação de URL, somente se a URL estiver sem senha. Não configure as duas fontes ao mesmo tempo. |
| `REDPRO_DB_ENV`         | `development` para o Supabase confirmado; `test` somente para PostgreSQL descartável em loopback.                                   |
| `REDPRO_DB_TARGET_REF`  | Ref pública do projeto, conferida com hostname/usuário. Em testes locais: `local-test`.                                             |
| `REDPRO_DB_SSL_CA_FILE` | Caminho opcional da CA pública oficial baixada no painel Supabase, Database Settings → SSL Configuration.                           |

O Node carrega explicitamente esse arquivo nos comandos `db:*`. Os testes de integração não o carregam. Não é necessário colocar essas variáveis na Vercel ou nos secrets do GitHub neste lote.

Para evitar escape manual, a URL pode conter somente usuário, host, porta e database; preencha a senha separada diretamente no arquivo privado. Se a senha estiver dentro da URL, seus caracteres reservados precisam estar percent-encoded. Ambos os modos são testados.

TLS remoto mantém `rejectUnauthorized: true`; jamais configure `NODE_TLS_REJECT_UNAUTHORIZED=0`. A CA é lida diretamente pelo driver. Parâmetros de URL não podem substituir suas opções TLS. Se o endpoint direto exigir IPv6 indisponível na máquina, copie o host e usuário do **Session pooler** no painel; não adivinhe o host. A porta 6543/transaction pooler não é aceita por estas ferramentas de migração.

Senhas compartilhadas no chat devem ser trocadas pelo proprietário no Supabase e atualizadas somente no arquivo privado. Este lote não redefine credenciais nem remove mensagens do histórico.

## Verificação e execução

Na raiz do checkout, com Node 24 e pnpm fixado:

```sh
pnpm db:target # configuração validada e fingerprint; connected:false, não comprova conexão
pnpm db:check  # consulta real em transação read only; sem alterar estruturas
pnpm db:status # consulta real + estado das migrações; não cria ledger
pnpm db:new nome_descritivo # cria arquivo TypeScript local; não acessa o banco
```

`db:new` gera funções que falham até serem implementadas/revisadas. Migrações ficam congeladas no tempo e não importam o schema atual da aplicação. Não edite uma migração que permaneça aplicada em outro ambiente.

Antes de alterar o banco: confirme no painel o projeto/ambiente, inspecione estruturas existentes e revise o código de `up`/`down`. Obtenha a autorização exigida na sessão. Copie a fingerprint de `db:check` e o nome exato de `db:status` para os argumentos:

```sh
pnpm db:up --confirm-target=FINGERPRINT --migration=NOME_EXATO
pnpm db:status
pnpm db:down --confirm-target=FINGERPRINT --migration=NOME_EXATO
pnpm db:status
```

Cada comando altera no máximo uma migração. Fingerprint errada, nome diferente da próxima migração, projeto divergente, ambiente ausente/produção ou execução na Vercel são recusados. Esses controles conferem configuração e confirmação explícita; não conseguem inferir por conta própria se um projeto foi rotulado incorretamente como desenvolvimento.

## Demonstração executada

O gerador criou `20261028185150423_development_probe.ts`. Após autorização específica, o runner criou `redpro_migrations` com `kysely_migration` e `kysely_migration_lock`, e aplicou a migração que cria o schema privado `redpro_dev_check` e sua tabela técnica vazia `migration_probe` (`id` inteiro como chave e `checked_at` timestamptz).

Foi comprovado: migração aplicada, zero linhas, RLS ativada, nenhum acesso ao schema por `anon`/`authenticated` e zero tabelas em `public`. A reversão removeu apenas a tabela e schema vazios de demonstração. O ledger privado foi mantido, com zero migrações aplicadas; a demonstração aparece como pendente e pode ser reaplicada futuramente mediante revisão/autorização. O ledger representa o estado aplicado, não uma auditoria completa de todos os eventos; as evidências externas registram o ciclo.

`up` não adota objetos existentes (`IF NOT EXISTS` não é usado na demonstração). `down` recusa tabela ocupada e não usa `CASCADE`. Falhas de DDL são revertidas pela transação PostgreSQL do Kysely. Um ledger existente sem a marca do RedPro é recusado. A criação inicial do ledger ocorre antes da transação da migração; se esta falhar, o ledger pode permanecer vazio.

## Testes e CI

`pnpm test` preserva a suíte anterior e verifica destinos, TLS, recusa de produção/Vercel, confirmação e privacidade dos erros. `pnpm test:db` exige explicitamente banco PostgreSQL descartável `redpro_test` em loopback e nunca aceita Supabase. Não pula silenciosamente por falta de configuração.

A CI mantém o job de qualidade/build/smoke e adiciona um serviço PostgreSQL 17.11 descartável, sem secrets externos. A senha visível no workflow é uma fixture válida somente no serviço temporário desse job. A integração cobre conexão, aplicação/reversão/reaplicação, preservação de uma tabela alheia, parâmetros, colisão e bloqueio da reversão de tabela ocupada. Não executa migrações no Supabase ou na Vercel.

## Avisos existentes e limites

Antes e depois da demonstração, o advisor Supabase apontou permissões de execução de `public.rls_auto_enable()` para `anon` e `authenticated` como `SECURITY DEFINER`. A função já existia antes deste lote e não foi alterada. Revisar antes de usar APIs públicas de dados: [aviso 0028](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) e [aviso 0029](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

Não há banco de produção configurado, seed, schemas de produto, login, chat, RAG, library ou comunidade funcional por esta entrega. A conexão atual é administrativa e exclusiva das ferramentas de desenvolvimento.

Referências: [conexões Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres), [TLS Supabase](https://supabase.com/docs/guides/platform/ssl-enforcement), [migrações Kysely](https://kysely.dev/docs/migrations), [TLS pg](https://node-postgres.com/features/ssl) e [configuração oficial do download da CA](https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json).
