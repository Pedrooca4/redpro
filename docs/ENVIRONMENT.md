# Variáveis de ambiente do RedPro

A página inicial, /status e /api/health funcionam sem configurar serviços externos. O exemplo versionado contém apenas nomes e valores vazios. Não informe senhas, chaves privadas ou tokens pelo chat.

## Inventário atual

| Variável                             | Uso atual                                                 | Obrigatória                                    | Exposição e validação                                                                                                                  |
| ------------------------------------ | --------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| NEXT_PUBLIC_SUPABASE_URL             | Clientes Supabase preparados em src/integrations/supabase | Somente ao usar os clientes, junto com a chave | Pública; origem HTTPS, sem usuário, senha, caminho, query ou fragmento. HTTP somente em localhost, 127.0.0.1 ou ::1.                   |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | Mesmos clientes, sob demanda                              | Somente ao usar os clientes, junto com a URL   | Pública, formato sb_publishable_. A validação rejeita chave privada, service_role e JWT legado.                                        |
| SMOKE_BASE_URL                       | scripts/smoke.mjs                                         | Não; padrão http://127.0.0.1:3000              | Configuração do processo de teste HTTP. Use uma origem confiável HTTP(S), sem credenciais ou tokens na URL. Não configura a aplicação. |

Os clientes ainda não são usados por uma funcionalidade pública. Configurar essas variáveis não implementa autenticação, tabelas, políticas de acesso ou persistência. A validação existente em src/config/supabase.ts ocorre ao chamar os clientes, sem registrar os valores nas mensagens de erro.

Variáveis NEXT_PUBLIC_ são públicas por definição e podem ser incorporadas ao JavaScript no build. Uma variável privada nunca deve receber esse prefixo. Mudanças nas variáveis públicas na Vercel exigem novo build/deploy para chegarem ao navegador.

## Desenvolvimento local

Copie o exemplo sem sobrescrever um arquivo já configurado. No PowerShell:

```powershell
if (-not (Test-Path -LiteralPath .env.local)) {
  Copy-Item -LiteralPath .env.example -Destination .env.local
}
```

Deixe os valores vazios para executar a fundação atual. Quando uma tarefa exigir integração real, preencha os valores diretamente no arquivo local ignorado, usando credenciais de desenvolvimento. Não use dados de produção nos testes.

O Next.js carrega arquivos de ambiente na raiz do projeto. scripts/smoke.mjs é executado pelo Node e não carrega esses arquivos automaticamente. Para usar o alvo salvo localmente:

```sh
node --env-file=.env.local scripts/smoke.mjs
```

Um SMOKE_BASE_URL vazio mantém o alvo padrão. NODE_ENV é controlado pelos comandos Next.js; não é necessário adicioná-lo ao exemplo.

## Vercel

No projeto redpro da equipe PP, configure valores diretamente em Settings → Environment Variables, apenas quando a integração correspondente for implementada. Separe Development, Preview e Production e conceda o menor acesso necessário.

As duas variáveis Supabase atuais são configuração pública. Futuras credenciais privadas devem ficar em variáveis de servidor protegidas, sem prefixo público, definidas no gerenciador da plataforma. Não recuperar nem baixar segredos de produção para esta tarefa. Nenhum valor remoto foi criado, alterado ou solicitado na RED-004.

## Variáveis previstas na arquitetura

O documento técnico cita DATABASE_URL, AUTH_SECRET, LLM_PROVIDER_KEY, EMBEDDINGS_PROVIDER_KEY, STORAGE_ENDPOINT, STORAGE_BUCKET_PUBLIC, STORAGE_BUCKET_PRIVATE, APP_BASE_URL e LOG_LEVEL como exemplo conceitual. Nenhuma delas é consumida pelo código atual.

Esses nomes são referências para etapas futuras, não configuração obrigatória nem decisão definitiva de provedor. Serão confirmados quando banco, autenticação, IA, storage e observabilidade forem implementados. Não adicionar valores ou credenciais preventivamente. A escolha por Supabase pode substituir parte dessas configurações por mecanismos do próprio serviço.

## Proteção e verificação

O .gitignore existente já ignora .env* e .vercel/, com exceção somente para .env.example. Ele foi preservado após inspeção. O .prettierignore também mantém arquivos de ambiente fora da formatação.

Execute pnpm check:env antes de enviar alterações. O comando verifica o exemplo vazio, o inventário e a proteção do Git para arquivos locais, sem ler seus conteúdos ou imprimir valores. A checagem usa o Git instalado e deve ser executada na raiz do checkout; ZIPs sem metadados Git precisam ser inicializados como checkout antes dela.

Essa verificação protege o fluxo de arquivos de ambiente; não identifica todo segredo possível colocado em um arquivo arbitrário. Revisar também o diff antes de enviar. Um segredo já versionado exige rotação no serviço e tratamento do histórico; .gitignore não remove arquivos já rastreados.

Referências: [Next.js](https://nextjs.org/docs/app/guides/environment-variables) e [Vercel](https://vercel.com/docs/environment-variables).
