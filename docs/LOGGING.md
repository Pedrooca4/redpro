# Logging e identificação de requisições

O proxy Next.js gera um UUID v4 novo por requisição de página/API e retorna x-request-id. IDs enviados pelo cliente são substituídos. Os arquivos internos de build/imagens e ícones são excluídos do matcher. Cada evento JSON possui timestamp, nível, evento, requestId, método e rota conhecida.

Não é um identificador de usuário nem mecanismo de autenticação. Não há estado global compartilhado por requisições. O ID é propagado por um header interno de requisição até o handler.

O logger permite apenas rotas estáticas /, /status e /api/health; outras são registradas como unmatched. Métodos desconhecidos viram OTHER. Query strings, caminhos dinâmicos, headers, corpos, IPs, dados de usuário e mensagens/stack brutas de erros não são serializados. Campos extras são descartados mesmo quando fornecidos em runtime.

## Eventos

- request.received: entrada no proxy. Não afirma status ou duração final de resposta.
- request.completed: término do handler instrumentado, com status real e duração em milissegundos.
- request.failed: falha do handler, com duração e categoria fixa unhandled. Não registra a mensagem bruta nem supõe uma resposta entregue.

O endpoint /api/health usa withRequestLogging e mantém seu contrato e cache. Novos handlers devem adotar o mesmo wrapper. Para as páginas, esta etapa registra a entrada e o ID; status/duração finais de renderização exigem instrumentação posterior. O header público permite correlacionar os eventos do proxy e do handler, mesmo em processos separados.

Falhas do destino do log não alteram a resposta do handler. O logger padrão escreve uma linha JSON no console do servidor; não configura serviço externo, retenção, métricas ou alertas. Não há nova variável de ambiente ou dependência.

## Limites

A proteção é por lista de campos/valores permitidos, sem tentar limpar mensagens arbitrárias. Não passe conteúdo privado ao console diretamente. Logs internos do framework/plataforma ficam fora deste logger. O wrapper relança erros preservando o comportamento existente; tratamento global de erros é a RED-009.

Os testes usam dados sintéticos, verificam descarte de campos, IDs concorrentes, propagação, erros e falha do destino de logs. O smoke HTTP verifica os headers em páginas, 404 e API.
