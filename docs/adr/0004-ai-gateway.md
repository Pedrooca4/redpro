# ADR-004 LLM por gateway e adapters

Estado: aceita como arquitetura planejada; não implementada.

## Contexto e decisão

A especialização em Minecraft exige contexto de edição/versão, fontes permitidas, RAG, validação de respostas e avaliação. O backend dependerá de uma interface de gateway, com adapters de modelo e embeddings, mantendo SDKs fora da UI e do domínio.

## Alternativas e consequências

Chamadas diretas do navegador exporiam credenciais e espalhariam dependências. Acoplamento de regras a um provedor dificultaria testes e troca de modelos. O gateway aumenta contratos a manter, mas permite testar falhas e validar saídas antes de consumir serviços reais.

Não treinar modelo do zero no MVP. RAG/ferramentas especializam um modelo via API. Fine-tuning só será considerado mediante evidências e dados. Provedor, nomes de modelos e eventual uso de um produto de gateway hospedado permanecem em aberto; gateway aqui é uma fronteira de código, não contratação de serviço.

## Estado real

Nenhuma chamada de IA, prompt operacional, retrieval, corpus, avaliação ou resposta de chat está implementada. A RED-043 inicia o gateway; etapas seguintes implementam provedor, contrato, orquestração e RAG. Não há fontes de vídeo automaticamente conectadas ou farms validadas.
