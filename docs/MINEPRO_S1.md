# MinePRO primeira etapa de interface

Este lote evolui a aplicação existente em Next.js sem alterar banco, migrações, autenticação ou integrações. O jogador escolhe edição, versão e especialidade, prepara uma pergunta e a exibe localmente. Nenhuma resposta é gerada por IA, nenhuma ferramenta é executada e nenhuma conversa é persistida.

## Referências e base verificada

Foram lidos integralmente os cinco documentos oficiais anexados, revisão v1.0 de 29/10/2026: Documento Mestre, Design UX/UI, Arquitetura Técnica, Arquitetura da IA e Backlog de Desenvolvimento. O prompt completo de desenvolvimento foi consultado em `Texto colado(3).txt`.

Repositório técnico preservado: `Pedrooca4/redpro`. Base `main`: `4fa8b981e9acdcf88f402526199a06eb300bbb87`, merge do PR #4. Nenhum PR aberto na inspeção inicial. A execução anterior da CI [40790354553](https://github.com/Pedrooca4/redpro/actions/runs/40790354553) terminou com sucesso. O deployment de produção `dpl_8CkhFEm3DTGB5tLBL44ZXmnB4pNp` estava READY e vinculado à mesma base. Essas evidências são da base, não deste lote.

O checkout foi obtido pelo conector autenticado porque o Git local não dispunha de credenciais para o repositório privado. Os 81 blobs originais, a árvore `470a354e12d239930e33d827253ae2fcd2baf56d` e o commit assinado foram verificados pelos hashes Git. A cópia local é rasa, com o commit original e seus parents preservados; o histórico remoto não foi reescrito.

## Dependências e status

| Tarefa   | Dependências e evidência local                                                                                                                | Status do lote                                         |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| RED-035  | RED-001 existe. Cores, escala tipográfica, unidade de espaço e raios centralizados em `src/styles/globals.css`; tema atualizado para MinePRO. | Implementada localmente; revisão e CI pendentes.       |
| MINE-001 | RED-001..010 sustentadas pelo código e relatórios preservados. Marca, ícone, home, status, erros e metadados atualizados.                     | Parcial até revisão, CI e merge.                       |
| MINE-002 | MINE-001 e RED-035 implementadas antes do shell. Sidebar, drawer modal, compositor, estados e teclado.                                        | Parcial até revisão, CI e merge.                       |
| MINE-003 | MINE-002 local. Edição/versão no estado; edição limpa versão, mantém rascunho e avisa sobre contexto anterior.                                | Parcial até revisão, CI e merge.                       |
| MINE-004 | MINE-002 local. Seis modos, seleção acessível e sugestões contextuais.                                                                        | Parcial até revisão, CI e merge.                       |
| MINE-005 | MINE-002..004 locais. Prévia explícita, falha simulada, retry sem duplicação, sem resposta de IA.                                             | Parcial até revisão, CI e merge.                       |
| MINE-006 | MINE-003/004 locais. As 15 instruções oficiais transcritas em `docs/AI_SYSTEM_PROMPT.md`.                                                     | Parcial até revisão, CI e merge; sem conexão a modelo. |

Não se declara RED-036..042 nem RED-063..071 concluídas por sobreposição de interface. MINE-007 e ferramentas MINE-009..019 não são implementadas pelo protótipo. A dependência RED-035 não foi removida ou silenciosamente ignorada: foi atendida no código deste lote, sujeita aos mesmos gates de revisão.

## Implementação e limites

- `/`: nova identidade e entrada no assistente, preservando a ilustração conceitual anterior.
- `/chat`: estado em memória, edição e versão, seis modos, perguntas sugeridas, nova conversa e prévias de ferramentas.
- `/projetos` e `/comunidade`: páginas vazias com indisponibilidade explícita, sem dados fictícios.
- `/status`, erros, 404 e navegação: atualizados para MinePRO.
- `/api/health`: contrato técnico anterior preservado, inclusive identificador `service`, para não quebrar os testes e consumidores. Esse identificador não é apresentado como marca na interface.
- `src/features/chat`: configuração tipada, reducer testável, controles, mensagens, apresentação estruturada, sidebar e dialog nativo com foco modal.
- Ferramentas: painéis com limitações reais e ação para preparar uma pergunta; nenhum cálculo, seed, diagnóstico ou verificação simulado.
- Histórico: vazio explícito; mensagens temporárias somem ao sair/recarregar. Nenhum armazenamento no navegador ou servidor.
- Versões: opções de referência e entrada numérica manual; não são um catálogo atualizado de releases nem uma matriz de compatibilidade validada.
- System Prompt: transcrição oficial para futura integração no servidor. Não é enviado a modelo algum nesta etapa.

## Validação

Os resultados executados e as limitações ficam em `docs/MINEPRO_S1_VALIDATION.md`. Os testes antigos permanecem íntegros. O smoke HTTP mantém correlação e health e adiciona as novas rotas e verificação de marca. `scripts/test-ui.mjs` testa Chromium em 320, 390, 768 e 1440 px, seletores, modos, contexto, rascunhos, falha/retry, ferramentas, Escape, foco modal e ausência de requisições de IA. O workflow preserva seus jobs anteriores e passa a executar essas verificações de interface no servidor de produção local.

## Próximas integrações

Após o lote visual aprovado: resolver as pendências operacionais de segurança com autorização separada; então RED-023 → RED-013/014, seguidas de auth. RED-043..052 e MINE-007 deverão introduzir o gateway e validação real de contexto no servidor antes do chat por API. RAG e ferramentas exigem fontes, contratos, permissões e testes próprios. Biblioteca e comunidade dependem de dados e autorização, e não devem ser liberadas com conteúdo fictício.

As credenciais previamente compartilhadas e os grants de `public.rls_auto_enable()` continuam pendentes, sem evidência de correção. Nenhuma credencial foi solicitada ou lida, e nenhuma conexão com o banco de desenvolvimento foi realizada neste lote.

## Publicação e reversão

Branch local: `codex/mine-001-006-interface`. O envio da branch e a abertura do PR exigem a autorização solicitada pelo responsável. O merge exige uma segunda autorização, depois de revisar a CI e o preview. Só após esse merge deve ser verificado o deployment automático de produção pelo SHA integrado, estado READY e rotas públicas. Nenhum projeto, domínio ou identificador de infraestrutura foi renomeado.

Reversão: reverter o commit deste lote por novo PR autorizado; não reescrever histórico. Como não há migrações ou variáveis novas de runtime, a reversão da interface não exige rollback de dados.

## Arquivos deste lote

```text
.github/workflows/ci.yml
README.md
docs/AI_SYSTEM_PROMPT.md
docs/MINEPRO_S1.md
docs/MINEPRO_S1_PR.md
docs/MINEPRO_S1_VALIDATION.md
docs/evidence/s1/chat-desktop.png
docs/evidence/s1/chat-mobile.png
docs/evidence/s1/home-desktop.png
docs/evidence/s1/home-mobile.png
docs/evidence/s1/mode-builder.png
docs/evidence/s1/mode-command.png
docs/evidence/s1/mode-farm.png
docs/evidence/s1/mode-mods.png
docs/evidence/s1/mode-red.png
docs/evidence/s1/mode-survival.png
docs/evidence/s1/ui-results.json
package.json
pnpm-lock.yaml
scripts/smoke.mjs
scripts/test-ui.mjs
src/app/chat/page.tsx
src/app/comunidade/page.tsx
src/app/icon.svg
src/app/layout.tsx
src/app/page.tsx
src/app/projetos/page.tsx
src/app/status/page.tsx
src/components/circuit-scene.tsx
src/components/error-state.tsx
src/components/minepro-brand.tsx
src/components/planned-page.tsx
src/components/site-footer.tsx
src/components/site-header.tsx
src/features/chat/app-sidebar.tsx
src/features/chat/chat-controls.tsx
src/features/chat/chat-presentation.tsx
src/features/chat/chat-shell.tsx
src/features/chat/config.ts
src/features/chat/icons.ts
src/features/chat/prototype-dialog.tsx
src/features/chat/state.ts
src/styles/chat.css
src/styles/globals.css
tests/minepro-chat.test.ts
```
