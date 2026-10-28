# RedPro

Base do RedPro, uma plataforma em desenvolvimento para inteligência artificial especializada em redstone e farms de Minecraft. Esta entrega inicia a **RED-001 — Criar repositório e projeto base**.

A aplicação contém uma página inicial com identidade verde e preta, uma página de status e um endpoint de saúde do processo. Chat com IA, biblioteca, comunidade, autenticação e persistência ainda não estão implementados. Os clientes Supabase estão preparados para configuração; isso não comprova conexão com o projeto existente.

## Executar localmente

Requisitos: Node.js 24 recomendado (mínimo 22.12) e pnpm. Use a versão de pnpm indicada em `packageManager` no `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Abra `http://127.0.0.1:3000`. A base pública deve iniciar sem credenciais externas.

Para executar a compilação de produção:

```sh
pnpm build
pnpm start
```

Não execute os servidores de desenvolvimento e produção simultaneamente na mesma porta.

## Configuração do Supabase

Copie `.env.example` para `.env.local` e preencha apenas quando for configurar o projeto Supabase:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

Essas variáveis são públicas por definição e podem chegar ao navegador. Use a chave **publishable**, nunca uma chave secreta ou `service_role`. Segredos de provedores de IA deverão permanecer exclusivamente no servidor quando essa integração for implementada. Não versione `.env.local` nem cole credenciais em logs, issues ou documentação.

Configurar as variáveis não implementa login, autorização ou acesso seguro aos dados. Essas entregas dependem das próximas tarefas de banco, políticas de acesso e autenticação. Não há migração a aplicar nesta etapa.

## Comandos

| Comando | Finalidade |
| --- | --- |
| `pnpm dev` | Iniciar o servidor de desenvolvimento. |
| `pnpm build` | Compilar a aplicação para produção. |
| `pnpm start` | Servir a compilação de produção já criada. |
| `pnpm lint` | Verificar o código com o linter configurado. |
| `pnpm typecheck` | Verificar os tipos TypeScript. |
| `pnpm test` | Executar os testes da base. |
| `pnpm smoke` | Executar a verificação HTTP contra a aplicação em execução. |

Execute `pnpm smoke` com o servidor local iniciado. Resultados e limitações da verificação desta entrega estão em [docs/RED-001.md](docs/RED-001.md).

## Estrutura e rotas

- `src/app`: rotas e layout do App Router.
- `src/integrations/supabase`: preparação dos clientes Supabase.
- `src/config`: validação da configuração.
- `src/styles`: estilos e tokens de tema.
- `src/components`: componentes visuais compartilhados.
- `docs`: escopo da entrega e preparação para publicação.

| Rota | Função atual |
| --- | --- |
| `/` | Apresentação inicial e escopo da plataforma. |
| `/status` | Estado atual da implementação. |
| `/api/health` | Resposta de saúde do processo web. Não verifica Supabase, banco ou IA. |

## Stack e decisões

Next.js 16.4.3 com App Router, TypeScript, React, Tailwind CSS 4 e ícones Lucide. Supabase será o serviço de dados e autenticação; Vercel é o destino solicitado para hospedagem. A base permanece executável enquanto os módulos são adicionados por etapas.

Os cinco documentos oficiais orientam o projeto. A relação das referências, as decisões desta entrega e o critério de aceite da RED-001 estão em [docs/RED-001.md](docs/RED-001.md). O preparo para Vercel está em [docs/DEPLOY.md](docs/DEPLOY.md).

## TypeScript e imports RED-002

O projeto usa strict: true, que inclui noImplicitAny e strictNullChecks, e verifica os tipos sem emitir JavaScript com pnpm typecheck. Os arquivos da aplicação usam .ts/.tsx; allowJs: false evita incluir fontes JavaScript não verificadas. Arquivos de ferramenta .mjs continuam sendo executados pelo Node e verificados pelo lint. forceConsistentCasingInFileNames exige consistência nos nomes importados.

O alias único @/* resolve ./src/* no TypeScript e no Next.js. Exemplos:

```ts
import type { SupabaseConfig } from "@/config/supabase";
import { SiteHeader } from "@/components/site-header";
```

Use imports relativos dentro do mesmo módulo quando forem mais claros. O executor nativo do Node dos testes de runtime não interpreta paths do tsconfig: nesses testes, use caminhos relativos com extensão .ts. A fixture tests/typescript-contract.ts usa o alias apenas na verificação do compilador; ela não é executada pelo comando test.

Prefira inferência ou tipos de domínio. Para valores externos sem tipo, use unknown e faça validação antes do uso. Não contorne erros com any ou supressões sem justificativa. O comando typecheck valida também as expectativas negativas da fixture.

## Estado e próxima etapa

RED-001 publicada: https://redpro-pp-0c16.vercel.app. O repositório existente é https://github.com/Pedrooca4/redpro.

A RED-002 complementa a configuração de tipos, documenta aliases e registra seu aceite em [docs/RED-002.md](docs/RED-002.md). A próxima tarefa é RED-003, configurar lint e formatação. O envio de novas alterações continua sujeito à autorização do usuário.
