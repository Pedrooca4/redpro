# Decisões arquiteturais iniciais

Os IDs seguem a seção ADR do Documento de Arquitetura Técnica. Decisão aceita não equivale a funcionalidade implementada.

| ADR                       | Decisão                                 | Situação                                             |
| ------------------------- | --------------------------------------- | ---------------------------------------------------- |
| [001](0001-stack.md)      | Aplicação full-stack modular TypeScript | Implementada na fundação                             |
| [002](0002-database.md)   | PostgreSQL via Supabase                 | Planejada; cliente preparado, conexão não verificada |
| [004](0004-ai-gateway.md) | LLM por gateway/adapter                 | Planejada; sem provedor ou chat implementado         |
| [006](0006-auth.md)       | Autenticação gerenciada                 | Planejada com Supabase; sem sessões/login            |

ADR-003 (storage), ADR-005 (RAG) e ADR-007 (workers) continuam reservados conforme o documento técnico e serão detalhados nas etapas correspondentes. Este lote não altera essas decisões.

Fontes: Documento Mestre, Design UX/UI, Arquitetura Técnica, Arquitetura da IA Etapa 3.5 e Backlog Etapa 4. Os textos extraídos preservados orientaram esta entrega. Vercel e Supabase refletem escolhas explícitas do usuário.
