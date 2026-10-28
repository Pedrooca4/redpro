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

## Ambiente RED-004

A base funciona sem credenciais externas. O [.env.example](.env.example) documenta as duas variáveis públicas Supabase preparadas e o alvo opcional do smoke HTTP, sempre com valores vazios.

Consulte [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) para configurar o desenvolvimento e a Vercel, entender a exposição de cada variável e distinguir configurações atuais das futuras. Não envie credenciais pelo chat ou pelo GitHub.

Execute pnpm check:env na raiz do checkout para verificar o exemplo vazio e a proteção do Git. O comando exige Git instalado, não lê arquivos privados e não substitui a revisão do diff. O .gitignore existente foi preservado. Configurar variáveis não comprova conexão Supabase, autenticação ou persistência.

## Comandos

| Comando          | Finalidade                                                  |
| ---------------- | ----------------------------------------------------------- |
| `pnpm dev`       | Iniciar o servidor de desenvolvimento.                      |
| `pnpm build`     | Compilar a aplicação para produção.                         |
| `pnpm start`     | Servir a compilação de produção já criada.                  |
| `pnpm lint`      | Verificar o código com o linter configurado.                |
| `pnpm typecheck` | Verificar os tipos TypeScript.                              |
| `pnpm test`      | Executar os testes da base.                                 |
| `pnpm smoke`     | Executar a verificação HTTP contra a aplicação em execução. |

Execute `pnpm smoke` com o servidor local iniciado. Resultados e limitações da verificação desta entrega estão em [docs/RED-001.md](docs/RED-001.md).

## Estrutura e rotas

- `src/app`: rotas e layout do App Router.
- `src/integrations/supabase`: preparação dos clientes Supabase.
- `src/config`: validação da configuração.
- `src/styles`: estilos e tokens de tema.
- `src/components`: componentes visuais compartilhados.
- `docs`: escopo da entrega e preparação para publicação.

| Rota          | Função atual                                                           |
| ------------- | ---------------------------------------------------------------------- |
| `/`           | Apresentação inicial e escopo da plataforma.                           |
| `/status`     | Estado atual da implementação.                                         |
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

## Lint e formatação RED-003

```sh
pnpm lint          # Verifica regras Next.js/TypeScript; avisos também falham
pnpm lint:fix      # Aplica correções automáticas do ESLint
pnpm format       # Aplica o padrão Prettier
pnpm format:check # Verifica formatação sem alterar arquivos
```

As regras estão em eslint.config.mjs e .prettierrc.json. O Prettier trata apresentação; o ESLint verifica qualidade do código. Dois espaços, aspas duplas, ponto e vírgula, vírgulas finais e finais de linha LF são padronizados. O EditorConfig orienta os editores e .gitattributes padroniza o Git. A verificação de formatação ignora dependências, builds, arquivos gerados, lockfile e arquivos de ambiente.

Antes de enviar alterações: pnpm format:check, pnpm lint, pnpm typecheck, pnpm test e pnpm build. A configuração de CI permanece na RED-006.

## Estado e próxima etapa

Site publicado: https://redpro-pp-0c16.vercel.app. Repositório: https://github.com/Pedrooca4/redpro. Deploys automáticos estão vinculados ao projeto Vercel existente.

O lote RED-009/RED-010 adiciona tratamento de erros descrito em [docs/ERRORS.md](docs/ERRORS.md) e registra [ADRs iniciais](docs/adr/README.md). Decisões aceitas não significam integrações implementadas.

Próximo lote: RED-011 e RED-012, conexão de banco de desenvolvimento antes da camada de acesso e migrações. Envio e integração continuam sujeitos a autorização separada do usuário.
