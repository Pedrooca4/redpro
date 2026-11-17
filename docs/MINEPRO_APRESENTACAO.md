# MinePRO · Guia de apresentação do projeto

A MinePRO é uma plataforma de assistência para jogadores de Minecraft. O trabalho reúne uma interface de conversa, modos de assistência, ferramentas do jogo e experimentos para verificar se um modelo de IA consegue usar referências de Minecraft e responder com precisão. O nome `redpro` identifica o repositório histórico.

O índice reúne o histórico GitHub verificado em 17 de novembro de 2026. O código de cada etapa fica em **Files changed** no PR correspondente. A série experimental da IA usa PRs empilhados, em que o PR seguinte toma a branch da etapa anterior como base.

## O que ver primeiro

| Parte do projeto | PRs de referência |
| --- | --- |
| Interface e identidade MinePRO, com chat e modos | [#5](https://github.com/Pedrooca4/redpro/pull/5) |
| Perfis, conversas, projetos e comunidade | [#8](https://github.com/Pedrooca4/redpro/pull/8), [#9](https://github.com/Pedrooca4/redpro/pull/9), [#10](https://github.com/Pedrooca4/redpro/pull/10), [#12](https://github.com/Pedrooca4/redpro/pull/12) |
| Calculadora de materiais | [#19](https://github.com/Pedrooca4/redpro/pull/19) |
| Assistente e bancada local de IA | [#20](https://github.com/Pedrooca4/redpro/pull/20) a [#24](https://github.com/Pedrooca4/redpro/pull/24) |
| Avaliação de comandos do Minecraft | [#25](https://github.com/Pedrooca4/redpro/pull/25) a [#29](https://github.com/Pedrooca4/redpro/pull/29) |
| Busca de referências e avaliação de recuperação | [#30](https://github.com/Pedrooca4/redpro/pull/30) e [#31](https://github.com/Pedrooca4/redpro/pull/31) |

## Experimentos posteriores ao PR #31

| Etapa | Evidência e conclusão |
| --- | --- |
| **3F-C a 3F-L** | Os experimentos investigaram recuperação de referências, interpretação do contexto e detecção de pedidos. Na 3F-L, a melhor configuração identificou 22 de 31 pedidos do lote avaliado. Ainda houve omissões de pedidos implícitos e falsos positivos em relatos. |
| **3F-M e 3F-N** | Foi definido um piloto com o modelo local Qwen3.5-4B. A arquitetura B produz o rascunho com referências. D aplica verificações ao mesmo rascunho. A primeira preparação da execução encontrou artefatos locais ausentes. |
| **3G e piloto 3G-B** | Os artefatos fixados foram recuperados e o piloto iniciou. Foram planejadas 8 conversas com 32 turnos. Houve 8 tentativas e 7 respostas originais, com 7 pares B/D. P02.4 ficou interrompido e 24 turnos ficaram sem tentativa. |
| **Avaliação parcial do piloto** | A revisão assistida contabilizou 6 de 11 pedidos integralmente atendidos. Todas as 7 respostas atingiram o limite de 256 tokens. Latência de 34,15 s na mediana e 38,82 s no p95 descritivo. Houve um turno com erro crítico e um com falsa suficiência. D deixou passar os sete textos sem intervenção. |
| **Recuperação operacional** | Passaram os 16 testes locais sintéticos e o teste de restauração privada. No ensaio entre sandboxes, 3 checkpoints e 4 releituras foram conferidos por SHA-256. Após encerrar o sandbox A, B recuperou 1 resultado oficial, manteve a operação incerta como indeterminada e fez 0 reenvios. O teste cobriu a perda do sandbox. A causa da interrupção original continua indeterminada. |
| **Prontidão** | A retomada do piloto, as 36 conversas de validação e a integração seguem em **NO-GO**. A retomada depende do ambiente controlado, da restauração dos artefatos fixados e de autorização para uma nova tentativa de P02.4 e os 24 turnos inéditos. |

A integridade do histórico de 3G-B foi conferida pelos 21 hashes de entrada e saída dos sete turnos. O pacote de reprodução da validação final tem SHA-256 `4e4b58491704deced8f2c012eca1f33dce4bcc3dfbeb32510fc8ed9c30e34ee7`. Os resultados instrumentados são parciais e a avaliação semântica foi assistida. Os dados brutos, as 72 perguntas reservadas, os pesos e os checkpoints privados permanecem nos arquivos de trabalho do projeto.

## Próximo recorte da demonstração

O escopo planejado do MVP é reaproveitar a interface de conversa e os controles de contexto existentes, com respostas demonstrativas explicitamente identificadas. A implementação dessa etapa fica pendente. A demonstração planejada e a avaliação do modelo têm objetivos próprios.

## Índice dos PRs anteriores

| PR | Entrega | Estado em 17/11/2026 |
| --- | --- | --- |
| [#1](https://github.com/Pedrooca4/redpro/pull/1) | RED-005/RED-006: testes existentes e integração contínua | Integrado |
| [#2](https://github.com/Pedrooca4/redpro/pull/2) | RED-007/RED-008: contribuição e logging seguro por requisição | Integrado |
| [#3](https://github.com/Pedrooca4/redpro/pull/3) | RED-009/RED-010: erros seguros e decisões arquiteturais | Integrado |
| [#4](https://github.com/Pedrooca4/redpro/pull/4) | RED-011/RED-012: PostgreSQL de desenvolvimento e migrações | Integrado |
| [#5](https://github.com/Pedrooca4/redpro/pull/5) | feat: implementar identidade MinePRO e chat multimodo (MINE-001..006) | Integrado |
| [#6](https://github.com/Pedrooca4/redpro/pull/6) | feat: definir política de IDs e timestamps do MinePRO (RED-023) | Integrado |
| [#7](https://github.com/Pedrooca4/redpro/pull/7) | test: validar correção de permissões Supabase em PostgreSQL descartável (S2C) | Integrado |
| [#8](https://github.com/Pedrooca4/redpro/pull/8) | feat: preparar perfis privados vinculados ao Auth (RED-013) | Integrado |
| [#9](https://github.com/Pedrooca4/redpro/pull/9) | feat: preparar conversas e mensagens privadas (RED-014) | Integrado |
| [#10](https://github.com/Pedrooca4/redpro/pull/10) | feat: preparar projetos privados, etapas e materiais (RED-015) | Integrado |
| [#11](https://github.com/Pedrooca4/redpro/pull/11) | test: reforçar validação de versão e diagnósticos do Chromium | Integrado |
| [#12](https://github.com/Pedrooca4/redpro/pull/12) | feat: preparar estrutura privada da comunidade (RED-016) | Integrado |
| [#13](https://github.com/Pedrooca4/redpro/pull/13) | feat: preparar denúncias confidenciais e auditoria de moderação (RED-017) | Integrado |
| [#14](https://github.com/Pedrooca4/redpro/pull/14) | fix: serializar seleção e execução autorizada das migrações | Integrado |
| [#15](https://github.com/Pedrooca4/redpro/pull/15) | feat: preparar inspeção manual protegida do banco pelo Actions | Aberto |
| [#16](https://github.com/Pedrooca4/redpro/pull/16) | feat: preparar Codespaces e acesso temporário explícito ao Kysely | Integrado |
| [#17](https://github.com/Pedrooca4/redpro/pull/17) | Restringe a inspeção do ledger Kysely a um papel leitor | Integrado |
| [#18](https://github.com/Pedrooca4/redpro/pull/18) | Adiciona helper administrativo somente leitura do MinePRO | Integrado |
| [#19](https://github.com/Pedrooca4/redpro/pull/19) | Adiciona a calculadora de materiais do MinePRO | Integrado |
| [#20](https://github.com/Pedrooca4/redpro/pull/20) | Prepara assistente Minecraft com IA no servidor e proteção de custos | Aberto |
| [#21](https://github.com/Pedrooca4/redpro/pull/21) | MinePRO AI: bancada local de avaliação com llama.cpp | Aberto |
| [#22](https://github.com/Pedrooca4/redpro/pull/22) | MinePRO AI Fase 3B: base local de conhecimento e comparação RAG | Aberto |
| [#23](https://github.com/Pedrooca4/redpro/pull/23) | MinePRO AI 3C: ground diagnostic answers and freeze reserved evaluation | Aberto |
| [#24](https://github.com/Pedrooca4/redpro/pull/24) | MinePRO AI 3D-A: validate reserved suite and separate A/B/C scoring | Aberto |
| [#25](https://github.com/Pedrooca4/redpro/pull/25) | MinePRO AI — Fase 3E-A: auditar comandos da bancada diagnóstica | Aberto |
| [#26](https://github.com/Pedrooca4/redpro/pull/26) | MinePRO AI — Fase 3E-B: corrigir contexto da auditoria de comandos | Aberto |
| [#27](https://github.com/Pedrooca4/redpro/pull/27) | MinePRO AI — Fase 3E-C: validar /weather e /fill em desenvolvimento | Aberto |
| [#28](https://github.com/Pedrooca4/redpro/pull/28) | MinePRO AI — Fase 3E-D: validar sintaxe e robustez de weather e fill | Aberto |
| [#29](https://github.com/Pedrooca4/redpro/pull/29) | MinePRO AI 3E-E — robustez de comandos e protocolo em jogo | Aberto |
| [#30](https://github.com/Pedrooca4/redpro/pull/30) | MinePRO AI 3F-A — auditoria de recuperação e fichas candidatas | Aberto |
| [#31](https://github.com/Pedrooca4/redpro/pull/31) | MinePRO AI 3F-B — validação de recuperação em novas perguntas | Aberto |
