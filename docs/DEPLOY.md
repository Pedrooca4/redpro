# Preparação para Vercel

Este guia prepara a publicação da fundação do RedPro. Ainda não comprova deploy nem funcionamento dos módulos futuros. A primeira publicação deve ser um **Preview** para revisão.

## Reutilizar o GitHub existente

1. Identificar a URL do repositório `redpro` e inspecionar sua branch padrão e os arquivos existentes.
2. Integrar os arquivos desta entrega em uma branch de trabalho, resolvendo diferenças sem sobrescrever trabalho existente.
3. Executar as verificações locais abaixo e revisar o diff, incluindo arquivos ignorados e ausência de segredos.
4. Registrar o commit e obter a autorização aplicável antes de enviar alterações ao repositório remoto.
5. Abrir a revisão pela branch de trabalho. Não fazer push automático à branch de produção.

## Verificação local

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

Com o servidor iniciado, execute em outro terminal:

```sh
pnpm smoke
```

Verifique também `/` e `/status` em desktop e mobile. Registre os resultados em [RED-001.md](RED-001.md). Compilação aprovada não substitui verificação da versão publicada.

## Configurar o projeto Vercel

Usar o projeto existente, caso já esteja vinculado ao repositório, ou importar o repositório autorizado. Não criar projetos duplicados sem antes conferir essa vinculação.

| Configuração | Valor esperado |
| --- | --- |
| Framework Preset | Next.js |
| Root Directory | `.` — raiz do repositório após integração dos arquivos. |
| Node.js | 24.x, conforme a configuração suportada na conta. |
| Install Command | `pnpm install --frozen-lockfile` |
| Build Command | `pnpm build` |
| Output Directory | Padrão do framework; não definir exportação estática. |
| Package manager | pnpm, na versão fixada no `package.json`. |

Se o repositório existente tiver uma organização diferente, revisar o diretório raiz antes do deploy. A pasta de entrega local não deve virar uma camada extra de diretórios no repositório por acidente.

## Variáveis de ambiente

A página inicial e o endpoint de saúde não exigem Supabase. Para preparar a integração, configurar os valores do projeto correto na Vercel:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Usar os ambientes Preview e Production conscientemente. Não compartilhar credenciais de produção com ambientes de teste sem uma decisão explícita. Variáveis com prefixo `NEXT_PUBLIC_` são públicas e podem ser incorporadas ao JavaScript durante o build; nunca colocar nelas chaves secretas ou `service_role`.

Não há chave de IA necessária nesta entrega. Não há migração, tabela ou política de acesso criada por este guia. A configuração de variáveis não comprova autenticação nem segurança dos dados.

## Verificar o Preview

Após o deploy da branch autorizada:

1. Conferir nos logs se a instalação e o build terminaram com sucesso.
2. Abrir a URL retornada pela Vercel e verificar `/` e `/status`.
3. Consultar `/api/health` e confirmar resposta HTTP bem-sucedida. Esse endpoint verifica somente o processo web; não comprova banco, Supabase ou IA.
4. Testar os links disponíveis, foco de teclado e layout em tela pequena.
5. Registrar URL, branch, commit e resultados observados em `RED-001.md`.

Uma URL de Preview protegida pela conta Vercel não é necessariamente pública. Verificar o acesso pretendido antes de apresentar a versão como disponível para qualquer visitante.

## Publicação posterior

Depois da revisão e autorização para publicação, promover a versão verificada pelo fluxo do projeto Vercel. Conferir a URL de produção novamente e registrar o commit correspondente. Não declarar a beta do RedPro pronta: esta entrega oferece apenas a fundação, e os gates de IA, dados, autenticação, comunidade, segurança e operação continuam pendentes.
