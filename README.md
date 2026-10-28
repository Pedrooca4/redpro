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

## Próxima etapa

Reutilizar o repositório GitHub `redpro` existente em https://github.com/Pedrooca4/redpro, após obter a autorização necessária para enviar alterações. Não criar um repositório remoto substituto nem enviar diretamente à branch de produção. Depois da RED-001, seguir os itens de fundação do backlog e suas evidências de aceite.
