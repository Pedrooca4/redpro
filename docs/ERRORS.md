# Tratamento de erros

Handlers que usam withRequestLogging retornam JSON 500 genérico em falhas inesperadas: error contém code INTERNAL_ERROR, mensagem pública fixa e requestId. O header x-request-id possui o mesmo ID; Cache-Control é no-store. O logger registra categoria fixa, status e duração, sem serializar o valor lançado.

Respostas retornadas de sucesso, 404 ou redirecionamento são preservadas. O helper oficial unstable_rethrow mantém o controle de fluxo interno do Next.js antes de tratar erros inesperados. O acesso fica isolado em next-control-flow.ts porque importar navigation.js completo causa incompatibilidade de bundle nas rotas desta versão. O adaptador usa o módulo interno estreito do helper. Essa API de compatibilidade é instável; a versão Next.js está fixada e os testes de redirect/notFound devem passar antes de qualquer atualização.

app/error.tsx cobre falhas dos segmentos; app/global-error.tsx cobre o layout raiz e fornece html/body próprios. As duas telas compartilham ErrorState, com tentar novamente e voltar ao início. No erro de segmento, a tentativa usa reset; no erro raiz, recarrega o documento inteiro para recuperar inclusive o roteador. Nenhuma delas renderiza ou registra a mensagem, stack ou digest recebido.

O ID permanece nos headers e nos logs do servidor. As telas não inventam um ID nem exibem o digest interno do framework; o ID original de uma navegação não está disponível automaticamente para um error boundary cliente. Não foi tornado o layout inteiro dinâmico apenas para esse fim.

instrumentation.ts carrega o reporter somente no runtime Node atual, sem incluir APIs Node no bundle Edge. Adiciona registros seguros para erros de renderização observados pelo Next.js. O hook não inspeciona o erro, headers privados ou o conteúdo da rota. Não substitui logs internos do framework/plataforma nem garante sanitizá-los. A aplicação evita lançar dados privados; erros de servidor em produção são sanitizados pelo Next antes de chegar ao cliente.

Erros de eventos assíncronos ou de código executado fora da árvore React não são capturados por error boundaries; futuras ações e integrações devem usar respostas esperadas e tratamento explícito. O 404 existente permanece distinto de uma falha inesperada.

Não existe endpoint público criado para provocar erros. As verificações de falhas visuais usam fixtures temporárias locais, removidas antes do build final e do envio.
