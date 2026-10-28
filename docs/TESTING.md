# Executar os testes do RedPro

O projeto mantém o executor nativo do Node com remoção de tipos. Use Node 24 e instale as dependências pelo lockfile.

| Comando        | Comportamento                                                         |
| -------------- | --------------------------------------------------------------------- |
| pnpm test      | Executa tests/*.test.ts, sem exigir serviços externos ou credenciais. |
| pnpm typecheck | Verifica os tipos da aplicação, testes e fixture de compilação.       |
| pnpm build     | Compila a aplicação para produção.                                    |
| pnpm start     | Inicia o build de produção em 127.0.0.1:3000.                         |
| pnpm smoke     | Testa via HTTP uma aplicação em execução.                             |

## Cobertura atual

Oito casos existentes foram preservados: um smoke unitário do contrato de /api/health e sete casos da configuração Supabase, incluindo configuração ausente, incompleta, inválida e mensagens que não expõem valores. Os dados de teste são sintéticos.

tests/typescript-contract.ts é uma fixture de compilação da RED-002: o typecheck a verifica, mas pnpm test não a executa.

O smoke HTTP existente verifica / e /status com conteúdo esperado, rota inexistente com 404 e /api/health com contrato JSON e Cache-Control no-store. Ele verifica a aplicação, não banco, autenticação ou IA.

## Smoke de produção local

No primeiro terminal:

```sh
pnpm build
pnpm start
```

No segundo:

```sh
pnpm smoke
```

Para outro alvo, defina SMOKE_BASE_URL no processo conforme docs/ENVIRONMENT.md. Não execute testes que façam mutações em produção; o smoke atual apenas lê rotas públicas.

## Integração contínua

.github/workflows/ci.yml executa automaticamente os comandos de qualidade em pushes para branches e em pull requests. Ao final, gera o build, inicia um servidor local, aguarda sua disponibilidade e executa o smoke. O servidor é encerrado ao terminar a etapa, inclusive em falhas.

Não usa pull_request_target nem secrets. O token de checkout tem permissão de leitura e não é persistido na configuração Git. Não são publicados arquivos de ambiente ou artefatos contendo credenciais.

O workflow não implanta o site. A integração Git da Vercel continua responsável pelos deploys. A CI não foi configurada como regra obrigatória de merge nem como bloqueio de produção; a proteção de branches ou deployment checks exige configuração separada.

As execuções reais e seus resultados são registrados no relatório de entrega. A existência do YAML não comprova uma execução bem-sucedida.
