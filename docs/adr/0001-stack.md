# ADR-001 Aplicação full-stack modular

Estado: aceita e implementada na fundação.

## Contexto e decisão

O MVP deve evoluir em incrementos verificáveis, com operação simples e separação de módulos. Mantemos Next.js App Router, React, TypeScript estrito, Tailwind e componentes próprios, com rotas de servidor no mesmo projeto e publicação na Vercel.

## Alternativas e consequências

Microsserviços e backend separado aumentariam operação antes de existir necessidade medida. A aplicação única compartilha tipos e simplifica deploy; exige preservar fronteiras entre UI, domínio, dados e integrações. SDKs privados não devem ir ao navegador.

## Implementação comprovada e limites

Site inicial, CI, testes, logging e tratamento de erros pertencem à fundação. Banco, autenticação, gateway de IA e comunidade não estão implementados. Não introduzimos infraestrutura nova nesta decisão.
