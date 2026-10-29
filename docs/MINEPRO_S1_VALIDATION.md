# Verificação local da interface MinePRO

Verificação realizada em 29/10/2026 na branch `codex/mine-001-006-interface`, baseada em `4fa8b981e9acdcf88f402526199a06eb300bbb87`. Este relatório distingue evidências locais da CI remota e da publicação de produção.

## Resultado dos comandos

| Verificação         | Resultado real         | Evidência e limites                                                                                                                                                                                                                       |
| ------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check:env`    | PASS                   | Exemplo vazio e regras de versionamento; nenhum arquivo privado lido. Não é scanner geral de segredos.                                                                                                                                    |
| `pnpm format:check` | PASS                   | Todos os arquivos reconhecidos pelo Prettier formatados.                                                                                                                                                                                  |
| `pnpm lint`         | PASS                   | ESLint sem erros ou avisos.                                                                                                                                                                                                               |
| `pnpm typecheck`    | PASS                   | `next typegen` e `tsc --noEmit`.                                                                                                                                                                                                          |
| `pnpm test`         | PASS                   | 54 testes, 54 aprovados, nenhum ignorado; 46 anteriores e 8 novos.                                                                                                                                                                        |
| `pnpm build`        | PASS                   | Build limpo de produção, com home, chat, biblioteca, comunidade, status, 404 e health.                                                                                                                                                    |
| `pnpm smoke`        | PASS                   | Sete rotas; conteúdo, marca, status HTTP, request IDs únicos e contrato health preservado.                                                                                                                                                |
| `pnpm test:ui`      | PASS                   | Chromium em 320, 390, 768 e 1440 px. Resultados em [ui-results.json](evidence/s1/ui-results.json).                                                                                                                                        |
| `pnpm test:db`      | BLOQUEADA POR AMBIENTE | Suíte invocada; 1 teste falhou com `ECONNREFUSED 127.0.0.1:55439`, sem conexão estabelecida. PostgreSQL descartável não pôde iniciar: só UID 0 está mapeado e a troca para usuário não root é proibida. Nenhum banco remoto foi acessado. |
| System Prompt       | PASS                   | As 15 instruções oficiais correspondem integralmente à seção 8 do documento de IA. SHA-256 do conteúdo entre as cercas: `c301fc1a44f5140f286784965af4a1dad7ed14d9189c05c7f4bf1040e9868cb4`.                                               |
| Preservação         | PASS                   | Sem diff em código/configuração de banco, integrações, logging, proxy, migrações ou testes anteriores. Nenhum arquivo anterior excluído.                                                                                                  |

Runtime: Node.js 24.22.1, pnpm 10.28.1 e versões de aplicação preservadas. A única dependência nova é Playwright 1.62.1, de desenvolvimento, com lockfile versionado. O download padrão do navegador não funcionou neste executor; a execução local usou Chromium 153.0.8010.0, distribuído como binário por `@sparticuz/chromium` em diretório temporário. Essa dependência temporária não faz parte da aplicação. A CI usa o navegador padrão do Playwright e ainda precisa ser executada para este lote.

## Comportamentos verificados no navegador

- Home e quatro rotas de interface sem overflow horizontal nas quatro larguras; títulos e texto público com a identidade correta.
- Navegação Biblioteca → assistente; drawer mobile, Escape e retorno de foco ao botão de abertura.
- JavaMine e BedMine selecionáveis; ausência de versão explícita; troca de edição limpa a versão e mantém o texto.
- Seis modos com uma seleção ativa, sugestões compatíveis com a edição e modo ativo alcançável na faixa rolável.
- Captura imutável do contexto das mensagens locais e aviso de possível incompatibilidade ao mudar edição/versão.
- Enter envia a prévia local; Shift+Enter preserva a quebra de linha; mensagens vazias e mais de 4000 caracteres são rejeitadas sem apagar o rascunho.
- Estado de espera local; falha explicitamente simulada nas configurações; retry adiciona somente uma mensagem.
- Nova conversa limpa o conteúdo local e mantém preferências.
- Seis painéis de ferramentas indicam indisponibilidade e limites; preparar pergunta escolhe a especialidade correspondente.
- Versão manual inválida gera erro; versão numérica válida atualiza o contexto.
- Tab permanece dentro dos painéis e Escape fecha; não houve erro JavaScript ou requisição para `/api/chat`, `/api/tools` ou `/api/conversations`.
- Ampliação de texto a 200% sem overflow horizontal. Isso é uma aproximação automatizada; não substitui zoom de navegador, leitor de tela ou aparelho físico.

Problemas encontrados e corrigidos: largura mínima nativa do fieldset dos modos causava overflow em 320 px; centralização de foco nos painéis exigia tratamento dos extremos de Tab. Um cache local de rotas do Next.js conservou HTML anterior entre builds; os artefatos foram removidos e o build final executado do zero. O smoke e a UI passaram a exigir a seção nova dos seis modos na home para detectar conteúdo anterior.

Contrastes calculados para os tokens: texto principal/fundo 17,07:1; texto secundário/superfície 7,49:1; texto escuro/botão esmeralda 11,26:1; erro/superfície 7,78:1. Isso verifica esses pares, não representa auditoria WCAG completa.

## Capturas reais

| Evidência                 | Arquivo                                            |
| ------------------------- | -------------------------------------------------- |
| Chat desktop com JavaMine | [chat-desktop.png](evidence/s1/chat-desktop.png)   |
| Chat mobile com BedMine   | [chat-mobile.png](evidence/s1/chat-mobile.png)     |
| Home desktop              | [home-desktop.png](evidence/s1/home-desktop.png)   |
| Home mobile               | [home-mobile.png](evidence/s1/home-mobile.png)     |
| RED                       | [mode-red.png](evidence/s1/mode-red.png)           |
| FARM                      | [mode-farm.png](evidence/s1/mode-farm.png)         |
| BUILDER                   | [mode-builder.png](evidence/s1/mode-builder.png)   |
| COMMAND                   | [mode-command.png](evidence/s1/mode-command.png)   |
| MODS                      | [mode-mods.png](evidence/s1/mode-mods.png)         |
| SURVIVAL                  | [mode-survival.png](evidence/s1/mode-survival.png) |

## GitHub, Vercel e aceitação

Branch preparada localmente. PR remoto e GitHub Actions deste lote ainda não existem, pois o envio requer autorização. A CI anterior da base passou; não se atribui esse sucesso ao código novo. O deployment de produção verificado na inspeção inicial continua sendo a referência da base: `dpl_8CkhFEm3DTGB5tLBL44ZXmnB4pNp`, target `production`, READY, SHA `4fa8b981e9acdcf88f402526199a06eb300bbb87`. Nenhum preview ou deployment deste lote foi criado.

MINE-001..006 estão implementadas localmente e registradas como parciais pelos gates de revisão, CI, merge e publicação. RED-035 tem tokens implementados no mesmo lote, sem alterar sua dependência. Integração PostgreSQL deste PR, aparelho físico, teclado virtual, zoom real e auditoria assistiva continuam pendentes. Credenciais compartilhadas e grants citados nos documentos não foram alterados nem considerados resolvidos.

Após autorização para envio: publicar a branch e abrir o PR com a descrição preparada, conferir ambos os jobs da CI e o preview pelo SHA. Solicitar nova autorização para merge. Depois do merge autorizado: identificar o deployment de produção pelo SHA integrado, confirmar READY e verificar as rotas públicas sem confundir preview com produção.

## Revisão remota do PR 5

A publicação autorizada abriu o [PR 5](https://github.com/Pedrooca4/redpro/pull/5) com a árvore original idêntica à local. A [CI do PR](https://github.com/Pedrooca4/redpro/actions/runs/40933205784) aprovou os dois jobs, incluindo 54 testes unitários, build, smoke, UI nas quatro larguras e o ciclo completo de PostgreSQL 17.11 descartável (1 teste aprovado). A limitação do PostgreSQL local foi, portanto, superada pela evidência remota; nenhum Supabase real foi utilizado.

O preview inicial foi verificado via HTTP e Chromium nas quatro larguras. Uma checagem adicional em 320 × 360 px encontrou colapso da área de mensagens: a regra de altura mínima zero permitia que o compositor interceptasse cliques nas ferramentas. A correção remove apenas essa exceção e mantém a altura útil mínima já definida, permitindo rolagem vertical do documento em janelas muito baixas. Não há redesenho ou alteração de componentes.

Foi adicionado um teste de regressão que exige área de mensagens utilizável, ausência de sobreposição/overflow horizontal, preservação do rascunho e acesso às ferramentas, envio e menu mobile em 320 × 360 px. Os quatro tamanhos anteriores e todos os testes existentes permanecem exigidos. A revisão final da correção, a CI do novo commit e o preview correspondente devem ser conferidos no PR antes da autorização separada de merge. Teclado virtual em aparelho físico continua sem teste direto.
