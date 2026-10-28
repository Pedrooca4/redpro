# ADR-002 PostgreSQL via Supabase

Estado: decisão aceita para implementação futura; conexão ainda não verificada.

## Contexto e decisão

Conversas, perfis, projetos e comunidade têm relações e restrições transacionais. O documento técnico define PostgreSQL; o usuário já criou um projeto Supabase, escolhido como serviço gerenciado do banco.

## Alternativas e consequências

Arquivos/arrays no frontend não oferecem a persistência exigida. Uma base sem relações exigiria resolver integridade na aplicação. PostgreSQL oferece relações, constraints e caminho futuro para vetores, a adotar somente no escopo RAG.

Clientes Supabase e variáveis públicas estão preparados, mas não comprovam banco conectado, schema ou autorização. A RED-011 verificará conexão em desenvolvimento. ORM/query layer e estratégia de migração serão selecionados/verificados na RED-012; não há decisão prematura entre Prisma, Drizzle ou outra ferramenta.

Nenhuma credencial, SQL de produção ou migração foi criada neste ADR.
