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
