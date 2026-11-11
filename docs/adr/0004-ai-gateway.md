# ADR-004 LLM por gateway e adapters

Estado: fronteira de gateway implementada para o MVP, com ativação pendente.

## Contexto e decisão

A especialização em Minecraft exige contexto de edição/versão, fontes permitidas, RAG, validação de respostas e avaliação. O backend dependerá de uma interface de gateway, com adapters de modelo e embeddings, mantendo SDKs fora da UI e do domínio.

## Alternativas e consequências

Chamadas diretas do navegador exporiam credenciais e espalhariam dependências. Acoplamento de regras a um provedor dificultaria testes e troca de modelos. O gateway aumenta contratos a manter, mas permite testar falhas e validar saídas antes de consumir serviços reais.

Não treinar modelo do zero no MVP. RAG/ferramentas especializam um modelo via API. Fine-tuning só será considerado mediante evidências e dados. Provedor, nomes de modelos e eventual uso de um produto de gateway hospedado permanecem em aberto; gateway aqui é uma fronteira de código, não contratação de serviço.

## Estado real

`src/server/ai` prepara o gateway HTTP, o prompt oficial, a validação de contexto e o controle persistente de admissão. O adapter usa Chat Completions do Vercel AI Gateway por `fetch`, sem SDK ou dependência adicional. O domínio e os componentes React não importam credenciais ou configuração privada.

A ativação continua pendente de credenciais, orçamento e provisionamento autorizado da proteção persistente. Testes de provedor usam mocks. Retrieval, corpus, RAG, ferramentas e avaliação factual com modelo real continuam pendentes. Nenhuma tarefa do backlog é declarada integralmente concluída por esta entrega. Consulte `docs/AI_CHAT.md`.
