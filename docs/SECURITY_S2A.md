# MinePRO — inspeção de segurança S2A

Inspeção em 29/10/2026. Somente documentos, código, advisors e consultas de catálogo em transação **READ ONLY** no Supabase de desenvolvimento já existente. Nenhuma credencial lida, nenhum dado de jogador consultado e nenhum grant, função, trigger ou schema alterado.

## Credenciais — pendência não resolvida

Os cinco documentos oficiais e `DATABASE.md` registram credenciais compartilhadas anteriormente. Não há comprovação de rotação no repositório; não é possível concluir que houve rotação examinando valores, e eles não foram solicitados nem testados. A pendência permanece aberta.

O proprietário deve trocar a senha PostgreSQL em Database Settings no painel Supabase seguro. Atualizar a senha/connection string apenas nos arquivos privados e nos gerenciadores de secrets que efetivamente a utilizem; auditar consumidores e sessões/pools para reconexão, com janela de interrupção controlada. A aplicação S1 publicada não consome DB, e a CI usa fixture descartável: não adicionar a senha real à Vercel ou à CI sem necessidade.

Se também foram expostas chaves privadas de API, revogar/substituir as chaves afetadas pelo painel seguro e atualizar somente consumidores autorizados. Rotacionar senha de banco não rotaciona chaves API; chave publicável não equivale a segredo de servidor. A migração de chaves JWT legadas pode impactar sessões e integrações: inventariar antes, sem mudanças automáticas. Não reutilizar segredo exposto como rollback; emitir outro segredo se necessário. A confirmação deve conter apenas o estado e os consumidores atualizados, nunca valores.

## `public.rls_auto_enable()` — estado confirmado

- Advisors 0028 e 0029 continuam ativos. `has_function_privilege` confirmou EXECUTE efetivo para `anon` e `authenticated`.
- ACL contém EXECUTE para `PUBLIC`, `postgres`, `anon`, `authenticated` e `service_role`; revogar só dos dois papéis não elimina a herança via PUBLIC.
- Função PL/pgSQL sem argumentos, retorno **event_trigger**, proprietária `postgres`, SECURITY DEFINER, `search_path=pg_catalog`.
- Dependência confirmada no catálogo: event trigger **ensure_rls**, ativo, `ddl_command_end`, tags CREATE TABLE, CREATE TABLE AS e SELECT INTO. Atua somente em tabelas do schema public.
- O corpo usa identificadores escapados por `%I` e tenta habilitar RLS. Captura exceções e apenas registra LOG: não garante que RLS tenha sido habilitada em toda criação. Migrações futuras devem habilitar e testar RLS explicitamente.
- A aplicação/migrações não fazem chamadas à função; as referências encontradas no código versionado são documentação. O retorno event_trigger restringe a invocação ao contexto de eventos DDL: o texto genérico do advisor sobre RPC não prova uma RPC explorável. Não foi invocada a função nem feito teste de exploração no banco real.

## Correção recomendada — NÃO EXECUTADA

Proposta de menor impacto: preservar corpo, proprietário, search_path e event trigger; remover apenas a permissão de execução pública da assinatura exata. Não trocar por SECURITY INVOKER nem excluir a função, pois isso pode afetar a habilitação automática de RLS.

Após autorização específica, salvar fora de logs públicos o snapshot de definição, ACL e trigger; testar o procedimento no PostgreSQL descartável e então revisar a operação no destino de desenvolvimento:

```sql
BEGIN;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable()
  FROM PUBLIC, anon, authenticated;
COMMIT;
```

Manter grants administrativos existentes. Não alterar default privileges de todas as funções neste procedimento pontual. Reexecutar as consultas efetivas de EXECUTE, conferir trigger ativo e definição inalterada e reexecutar advisors. Em fixture autorizado, verificar CREATE TABLE normal e CREATE TABLE AS com RLS ativa; testar erros/rollback sem dados reais e preservar objetos alheios. Revalidar permissões após futuras migrações que recriem a função.

Riscos: consumidores externos não inventariados podem depender de grants; catálogo não detecta todas as chamadas em SQL dinâmico. Mudanças futuras no proprietário ou na definição podem modificar o comportamento do trigger. A execução de event triggers não deve ser presumida equivalente a uma chamada RPC: comprovar o fluxo de criação em ambiente descartável antes de aplicar no real.

Reversão emergencial, somente autorizada e se a ACL continuar idêntica ao snapshot salvo: restaurar EXECUTE para PUBLIC, anon e authenticated, mantendo os demais grants. Isso reintroduz os alertas e a superfície de acesso, portanto deve ser temporário. Se houver mudanças concorrentes, reconstruir apenas os grants efetivamente removidos a partir do snapshot, sem sobrescrever a ACL inteira. Não há alteração de dados nem exclusão de tabelas neste plano.

## Gates

A RED-023 pode ser preparada/testada localmente sem usar credenciais reais. Antes de aplicar schemas ou expor APIs de dados: comprovar rotação, resolver/revisar formalmente os grants, aprovar migrações e definir papéis mínimos/RLS. Nenhuma dessas pendências foi marcada como resolvida pela S2A.

Referências: [advisor 0028](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [advisor 0029](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [privilégios de funções](https://supabase.com/docs/guides/database/functions#function-privileges), [event triggers](https://supabase.com/docs/guides/database/postgres/event-triggers), [funções de trigger PostgreSQL](https://www.postgresql.org/docs/17/plpgsql-trigger.html).

## Continuação S2C — preparação, sem alteração real

Base: `57f3cd55f67f4bf346f2b0d04002424e95b17632`; branch local `codex/s2c-supabase-security`. RED-023 concluída, sem reimplementação. Consulta atual confirmou projeto de desenvolvimento `rdwchjjxaipkufgxlnvh`, nome técnico REDPRO, ACTIVE_HEALTHY, PostgreSQL 17.11. Catálogos consultados com `transaction_read_only=on`: assinatura, definição, proprietário, search_path, ACL e dependência ensure_rls continuam como acima; 0028/0029 continuam presentes. Não foi testado DDL nem invocada a função no projeto real. O gatilho está habilitado no catálogo; funcionamento atual por DDL real ainda não foi comprovado nesta etapa.

### Senha novamente exposta e inventário sem valores

O proprietário informou que trocou a senha PostgreSQL e depois compartilhou a nova senha em uma conversa. Tratar como potencialmente exposta e substituir novamente. Nenhum valor foi recuperado, utilizado ou copiado.

| Consumidor                    | Evidência e atualização necessária                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Comandos locais db:*          | Único consumidor SQL remoto encontrado no código: scripts/db.ts → configuração validada → pool Kysely/pg. Lê .env.development.local; atualizar a fonte privada usada pelo proprietário antes da próxima conexão.                                                                                                                                                     |
| Este executor                 | Arquivo .env.development.local ausente; nomes DATABASE_URL e REDPRO_DB_PASSWORD ausentes no processo. Apenas existência/nomes inspecionados. Não há credencial local para atualizar ou validar aqui.                                                                                                                                                                 |
| GitHub Actions                | Workflow usa somente fixture pública do PostgreSQL descartável em loopback; não trocar essa senha pela senha real nem adicionar secrets preventivamente.                                                                                                                                                                                                             |
| Aplicação/Vercel              | Código atual não consome SQL em produção e recusa configuração SQL na Vercel. Documentação informa ausência de senha SQL remota; configuração manual posterior no painel não foi descartada. Endpoint disponível de inventário pode retornar valores, portanto não foi usado. O proprietário precisa conferir apenas nomes/ambientes no painel, sem revelar valores. |
| Outros aplicativos            | DBeaver, pgAdmin, extensões SQL, automações e outros checkouts não são inventariáveis por este executor. Confirmação de uso/atualização pelo proprietário pendente. Zero sessões redpro-development na consulta é apenas uma observação pontual, não prova ausência de consumidores.                                                                                 |
| Serviços gerenciados Supabase | Segundo documentação atual, atualizados automaticamente após reset da senha do projeto; isso não comprova atualização de consumidores externos. A conexão de gerenciamento usada para inspeção não comprova a nova senha PostgreSQL.                                                                                                                                 |

Substituição confirmadamente necessária: **senha PostgreSQL**. A chave publicável identifica o projeto no cliente e não equivale à senha; não há motivo comprovado para substituí-la nesta inspeção. Chave secreta de API e chave legada service_role são credenciais privilegiadas distintas: substituir/revogar apenas se comprometidas, em operação própria autorizada. Chave legada anon é pública; chaves JWT legadas são acopladas e a documentação atual recomenda migração para chaves novas, não reset indiscriminado. Não há evidência nesta etapa de exposição adicional de chave API; não foram lidos seus valores.

Sequência segura para o proprietário:

1. Identificar conexões externas pelo nome e pausar apenas scripts/conexões manuais que usem a senha antiga. Confirmar nomes de variáveis na Vercel e eventuais outros consumidores sem copiar valores para o chat.
2. No painel Supabase do projeto de desenvolvimento correto, abrir Database → Settings (ou Settings → Database, conforme o menu) → Database password / Reset database password. Gerar senha forte no gerenciador de senhas e salvar diretamente no painel/gerenciador. Não enviar por conversa ou screenshot.
3. Atualizar somente consumidores privados efetivos. Nos comandos existentes, usar DATABASE_URL sem senha + REDPRO_DB_PASSWORD no arquivo local ignorado, ou uma URL privada com senha corretamente percent-encoded; nunca as duas fontes simultâneas. Preservar host, projeto, porta e TLS já verificados. Não executar env pull, migrações ou comandos que imprimam configuração.
4. Reabrir a conexão externa para testar autenticação nova, sem depender de conexão antiga já aberta. Executar pnpm db:check no computador que guarda a configuração privada; é somente leitura e retorna metadados sanitizados. Confirmar apenas sucesso/falha e os nomes dos consumidores atualizados. Neste executor, o mesmo check só poderá ocorrer se houver configuração segura disponível; não solicitar envio dela pelo chat.

Rotação permanece **pendente** até confirmação do proprietário e sucesso de conexão nova de cada consumidor necessário. Falha não deve levar à restauração da senha exposta: corrigir o consumidor ou gerar outra senha segura. Não é possível garantir revogação de sessões antigas apenas pelo reset; eventual encerramento de sessões exige análise e autorização próprias.

### Teste da correção mínima

Acrescentados tests/integration/security-grants.test.ts e fixture SQL da definição de catálogo. Recusa destinos remotos, exige banco local-test descartável e dono privilegiado, recusa colisões e roda a montagem inteira em transação revertida. Não há DROP ou alteração de objeto real.

O teste exige: EXECUTE inicial de PUBLIC/anon/authenticated; revogação pontual e idempotência; retenção de acesso administrativo/service_role; definição, dono, search_path e trigger inalterados; CREATE TABLE, CREATE TABLE AS e SELECT INTO por papel sem EXECUTE com RLS habilitada; negação de leitura anon sem policy; registro sentinela preservado; reversão por GRANT e rollback; limpeza integral do fixture. O script test:db existente o inclui automaticamente, junto das duas integrações anteriores.

Resultado local: execução tentada, **bloqueada por ECONNREFUSED 127.0.0.1:55439 antes da conexão**. Sem PostgreSQL/Docker local e sem usuário não root disponível para iniciar servidor nativo. Não há evidência de aprovação funcional do novo teste. Formatação, TypeScript e ESLint são verificações separadas, não substituem PostgreSQL. Publicação da branch/PR para executar a CI exige autorização ainda não concedida.

Limites mesmo após aprovação descartável: PostgreSQL upstream com owner superuser não replica Supautils, privilégios específicos do postgres gerenciado, configuração PostgREST ou consumidores externos. O teste prova o mecanismo relevante no fixture, não ausência de todo risco no Supabase.

### Plano real ainda bloqueado

Após teste descartável aprovado e autorização específica: reconferir projeto e snapshot, executar somente REVOKE EXECUTE na assinatura exata para PUBLIC/anon/authenticated em transação, preservando função/trigger e demais grants. Não alterar default privileges. Verificar ACL efetiva, integridade de definição/trigger e advisors 0028/0029. O REVOKE não modifica linhas ou tabelas.

Reversão proposta: restaurar apenas os três grants observados, após autorização, conservando outros privilégios e comparando snapshot. Isso reintroduz o alerta. Antes de COMMIT, falha deve causar ROLLBACK. Depois de COMMIT, falha exige interromper e apresentar diagnóstico; não executar restauração nem ações adicionais silenciosamente.

O funcionamento por DDL no banco real exige criar objetos de prova, o que **não está incluído** na proposta de apenas REVOKE. Catálogo habilitado não prova execução. Caso seja necessária essa prova real, apresentar separadamente os objetos temporários/DDL e sua reversão para autorização explícita, ou validar durante a primeira migração autorizada. Até lá, registrar essa limitação sem alegar prova real de acionamento.

Fontes atuais: [senhas PostgreSQL](https://supabase.com/docs/guides/database/managing-passwords), [chaves API](https://supabase.com/docs/guides/getting-started/api-keys), [migração de chaves](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys). Changelog e documentação de privilégios/event triggers também consultados. Nenhuma correção, rotação ou publicação executada pela S2C até este registro.

### Confirmação do proprietário e inventário anterior à publicação

O proprietário confirmou nova redefinição da senha PostgreSQL e que a senha atual não foi compartilhada nesta conversa. Registrar **rotação confirmada pelo proprietário**, separada de **validação de consumidores ainda pendente**. Confirmou não usar DBeaver, pgAdmin, extensões SQL ou outros aplicativos externos de conexão direta; não repetir essas perguntas. A ausência desses aplicativos não elimina consumidores automatizados.

Inventário adicional autorizado da Vercel, projeto existente da equipe pp-0c16: consulta com descriptografia desabilitada; somente nomes, tipo e ambientes foram examinados. Existem variáveis encrypted POSTGRES_PASSWORD, POSTGRES_URL, POSTGRES_URL_NON_POOLING e POSTGRES_PRISMA_URL em development/preview/production, além de metadados PostgreSQL e configurações de chaves Supabase. **Isso atualiza a limitação do inventário anterior:** há cópias/configurações privadas remotas, embora nenhum consumidor delas tenha sido encontrado no código atual. Não foram acessados valores nem conferida sua atualidade. Não se presume que a redefinição do banco tenha atualizado automaticamente essas cópias na Vercel; sincronização deve ser confirmada no painel/integrador seguro em etapa autorizada, sem env pull, leitura de valores ou alteração de produção nesta entrega.

Reinspeção local: arquivo .env.development.local ausente, nomes DATABASE_URL/REDPRO_DB_PASSWORD ausentes no processo. O workflow continua usando somente credenciais sintéticas do serviço PostgreSQL descartável, sem referências a secrets de banco real. Não há consumidor SQL real ativo identificável no código publicado. Os serviços gerenciados Supabase não devem ser confundidos com cópias externas de variáveis. A API de gerenciamento acessível não prova autenticação com a nova senha PostgreSQL.

Pendência concreta: confirmar sincronização dessas configurações privadas, identificar eventual automação fora do repositório que as use e validar uma conexão nova dos consumidores efetivos por meio seguro. Não foi exigido nem usado o segredo compartilhado anteriormente. Não substituir chaves API por causa da troca da senha PostgreSQL; são credenciais diferentes e não houve evidência adicional de comprometimento delas nesta inspeção.
