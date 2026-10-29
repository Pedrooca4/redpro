# Título proposto

feat: implementar identidade MinePRO e protótipo de chat multimodo

## Objetivo

Implementar MINE-001 a MINE-006, cumprindo RED-035 para a nova interface sem modificar banco ou reconstruir o projeto.

## Comportamento

A aplicação pública passa a usar a identidade MinePRO e oferece um assistente demonstrativo em `/chat`. O jogador pode selecionar JavaMine/BedMine, informar a versão e alternar RED, FARM, BUILDER, COMMAND, MODS e SURVIVAL. A edição altera sugestões, limpa a versão anterior e preserva o rascunho; mensagens locais mantêm uma cópia do contexto de envio.

O lote centraliza os tokens de tema para atender RED-035 antes do shell MINE-002, adiciona navegação mobile com foco modal, seis prévias de ferramentas, páginas vazias de biblioteca/comunidade e transcreve integralmente o System Prompt oficial. Não há IA conectada, ferramentas executáveis ou persistência de conversas. Infraestrutura, migrações, configurações de banco e testes antigos permanecem preservados.

## Validação

Validação local: política de ambiente, Prettier, ESLint, TypeScript, 54 testes unitários, build de produção limpo, smoke de sete rotas e Chromium em 320/390/768/1440 px. Os testes de UI cobrem seletores, seis modos, contexto, falha/retry, ferramentas, teclado, foco, navegação, ampliação de texto e ausência de chamadas de IA. Capturas e resultados estão em `docs/evidence/s1`; detalhes e limites em `docs/MINEPRO_S1_VALIDATION.md`.

## Limites e pendências

A suíte de integração PostgreSQL foi invocada contra loopback, mas falhou com `ECONNREFUSED` por indisponibilidade do banco descartável local. O ambiente permite apenas UID 0 e não permite iniciar o PostgreSQL como outro usuário. O job de PostgreSQL descartável existente na CI foi preservado e deverá passar neste PR antes do merge. Nenhum Supabase real foi acessado ou modificado.

MINE-001..006 permanecem parciais até revisão, CI e merge autorizados. As pendências anteriores de rotação de credenciais e revisão de grants continuam abertas. A publicação de produção e sua verificação por SHA dependem do merge autorizado.

## Estado de publicação

Este arquivo prepara o texto para revisão. O PR remoto ainda não foi aberto: envio da branch e criação do PR dependem de autorização do responsável. O merge exigirá uma segunda autorização, após conferir a CI e o preview.
