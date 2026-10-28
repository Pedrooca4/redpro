# ADR-002 PostgreSQL via Supabase

Estado: conexão de desenvolvimento e ciclo de migração comprovados na RED-011/012; banco de produção e schemas do produto ainda não implementados.

## Contexto e decisão

Conversas, perfis, projetos e comunidade têm relações e restrições transacionais. O documento técnico define PostgreSQL; o usuário já criou um projeto Supabase, escolhido como serviço gerenciado do banco.

## Alternativas e consequências

Arquivos/arrays no frontend não oferecem a persistência exigida. Uma base sem relações exigiria resolver integridade na aplicação. PostgreSQL oferece relações, constraints e caminho futuro para vetores, a adotar somente no escopo RAG.

Kysely 0.29.7 com pg 8.23.1 foi escolhido como query builder tipado e driver PostgreSQL. A combinação oferece SQL parametrizado, transações e migrações versionadas com up/down e lock, sem geração de um cliente de ORM nem ferramentas extras de migração. O projeto já usa TypeScript e Node 24, compatíveis com essas versões.

Prisma e Drizzle também seriam compatíveis. Neste ponto, Prisma adicionaria um modelo/geração de cliente antes dos schemas de produto, e Drizzle não é necessário para cumprir os contratos atuais. A escolha do query builder mantém SQL/PostgreSQL explícitos para futuras constraints e vetores. O custo é manter contratos de tipos e migrações revisados em conjunto; tipos não substituem validação de dados externos nem autorização.

A RED-011 comprovou conexão real por variáveis privadas com TLS verificado no Supabase existente, reservado exclusivamente para desenvolvimento. A RED-012 criou, aplicou e reverteu uma migração técnica isolada após autorização. O runner de desenvolvimento recusa produção/Vercel, exige confirmação de destino e não roda no deploy.

Os clientes Supabase públicos preparados são independentes do acesso SQL administrativo de migração. Login, RLS de domínio, repositories e schemas de produto continuam futuros. Nenhuma credencial é registrada neste ADR. Ver [DATABASE.md](../DATABASE.md).
