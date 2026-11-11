# Assistente MinePRO por API

## Estado e arquitetura

Base revisada `8f363750cc20695250471af44984167f986f1682`. Antes deste lote, `/chat` utilizava um reducer local e um timer de demonstração. Não havia endpoint, SDK ou provedor de IA funcional. Autenticação é uma preparação futura. Não há sessão autenticada ou persistência de mensagens.

O mesmo chat consulta `GET /api/chat`, que divulga somente `available`. Em modo disponível, envia perguntas e contexto limitado para `POST /api/chat`. O servidor valida entrada, origem e identidade de rede antes de reservar quota persistente e chamar o provedor. O frontend recebe somente texto e um indicador de truncamento. O adapter, os limites e o prompt ficam separados da interface. `node:crypto` e `node:net` mantêm o caminho privado no runtime Node. Nenhum módulo de configuração privada é importado no cliente.

Provedor proposto Vercel AI Gateway via HTTPS Chat Completions, modelo `google/gemini-3.5-flash-lite`. O catálogo oficial consultado em 10/11/2026 lista texto, saída limitada e preço base de US$ 0,30 por milhão de tokens de entrada e US$ 2,50 por milhão de saída. A seleção prioriza custo e um modelo atual de propósito geral. Qualidade factual para Minecraft e custo observado ainda precisam de avaliação real. O modelo é fixado em uma lista permitida no servidor. O navegador não escolhe provedor, endpoint, modelo, tokens ou ferramentas. O adapter usa `fetch` nativo para evitar dependências adicionais. Não há streaming neste primeiro lote.

As 15 instruções de `AI_SYSTEM_PROMPT.md` são preservadas integralmente e comparadas por teste com o prompt operacional. A edição, versão e especialidade validadas são acrescentadas pelo servidor. Histórico do navegador permanece conteúdo não confiável. Não há RAG, busca, execução de comandos ou ferramenta conectada ao modelo. Orientações podem conter erros. O texto retornado é renderizado por React como texto, sem HTML executável ou Markdown com links automáticos.

## Limites e privacidade

- Pergunta com até 4.000 caracteres. Até oito mensagens anteriores, em turnos completos, e uma pergunta atual. O conjunto tem até 12.000 caracteres e o corpo HTTP até 64.000 bytes.
- Até 800 tokens de saída, 12.000 caracteres na resposta aceita e 20 segundos de provedor. Há cancelamento da sessão e timeouts no cliente, no corpo HTTP e no guard. Não há retry ou fallback de provedor automático.
- Nenhuma conversa é gravada no servidor, em cookies ou no armazenamento do navegador. A interface informa que os dados são enviados ao provedor quando a IA está disponível. Sair/recarregar descarta o histórico local.
- Os logs da aplicação contêm somente os metadados permitidos de requisição. Erros, cabeçalhos de autorização, conteúdo e endereços IP não são registrados. Revisar retenção de prompts nos serviços externos e as condições de uso antes da ativação. O código não promete retenção zero pelo provedor.

## Proteção persistente e condição de ativação

A ausência de uma limitação compartilhada bloqueia a chamada. Um limitador em memória não é usado. O adapter preparado para Redis REST Upstash utiliza Lua atômico e o relógio Redis. A admissão reserva simultaneamente quota global de 30 tentativas por dia UTC, cinco tentativas por identidade em janela fixa de dez minutos, no máximo duas gerações concorrentes globais e uma por identidade. Todas as tentativas admitidas gastam quota, inclusive falhas de provedor. Os limites são conservadores e só podem ser alterados no código revisado.

O guard utiliza prefixo compartilhado entre instâncias e deployments. Ele conserva contadores com expiração e leases de 45 segundos, superiores ao tempo máximo do endpoint de 30 segundos. Liberação compara o token do proprietário. Uma liberação atrasada não remove o lease de outro pedido. Se o guard ou a liberação falhar, não há nova tentativa automática. Falha na admissão impede o provedor. Falha na liberação conserva o bloqueio até expirar.

Só é aceita a identidade do cabeçalho controlado pela Vercel, em runtime Vercel. O endereço é validado e transformado em HMAC antes de ser enviado ao guard. Isso é pseudonimização, sem criar uma conta. Usuários atrás do mesmo NAT compartilham quota. Troca de endereço pode contornar a quota individual, enquanto o limite global continua aplicável. Janelas fixas permitem rajadas junto à fronteira temporal. A proteção não substitui mitigação de DDoS, proteção de funções, controle de tráfego ou orçamento financeiro do provedor.

Nenhum serviço Redis foi criado ou conectado nesta tarefa. Nenhuma variável real foi modificada. Os metadados acessíveis da Vercel não mostraram `AI_GATEWAY_API_KEY` nem configuração do guard. Variáveis ocultas não foram recuperadas e nenhuma chave foi validada. A integração PostgreSQL da Vercel não é utilizada.

Todas as variáveis abaixo são privadas, vazias em `.env.example`, e exigem configuração autorizada em uma etapa posterior.

| Nome                         | Finalidade                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| `MINEPRO_AI_ENABLED`         | `true` somente depois da revisão e aprovação de ativação                                         |
| `AI_GATEWAY_API_KEY`         | Chave exclusiva do gateway, com teto de gasto e escopo apropriados                               |
| `MINEPRO_AI_MODEL`           | Opcional, aceita somente o modelo revisado                                                       |
| `MINEPRO_AI_BUDGET_APPROVED` | Registro operacional da aprovação do orçamento, sem substituir o limite financeiro real da chave |
| `MINEPRO_AI_REDIS_URL`       | Origem HTTPS oficial do guard Upstash autorizado                                                 |
| `MINEPRO_AI_REDIS_TOKEN`     | Credencial restrita do guard, guardada no servidor                                               |
| `MINEPRO_AI_RATE_SECRET`     | Segredo exclusivo com pelo menos 32 caracteres para HMAC                                         |

O runtime precisa ser `preview` ou `production` na Vercel, com TLS validado. Não há fallback para OIDC automático ou ambiente local com credencial real. Falta, configuração inválida ou `NODE_TLS_REJECT_UNAUTHORIZED=0` impedem a ativação. `GET /api/chat` não testa conectividade nem comprova orçamento. A reserva efetiva é feita somente no POST.

Antes da ativação, o proprietário precisa aprovar o serviço persistente e eventuais custos, configurar diretamente os segredos no painel seguro, definir teto financeiro real na chave/projeto do gateway e revisar retenção, tráfego e orçamento de execução. O sinalizador de aprovação não verifica o teto no provedor. Depois será necessária autorização específica para uma avaliação real com custo máximo definido. Nenhum segredo deve ser enviado em conversa, argumentos, capturas ou commits.

## Validação e limites de evidência

Os testes de provedor injetam respostas simuladas e falhas de 401/403/429/5xx, timeout, configuração e validação. O teste Chromium usa interceptação de `/api/chat` apenas no processo de teste e exibe `TESTE AUTOMATIZADO · RESPOSTA SIMULADA` no conteúdo. A rolagem mantém a pergunta atual e o início da resposta na área de conversa, sem saltar para a bancada abaixo; esse posicionamento é verificado em todas as quatro larguras. O Preview permanece no estado real desativado, com calculadora e demonstração local acessíveis. Não há fixture, modo de teste ou bypass de segurança habilitável pela aplicação pública.

`pnpm test:ai-guard` executa as duas instâncias do adapter contra Lua real em Redis descartável da CI. O transporte HTTP é simulado e o comando é executado com `redis-cli` no container isolado do job. São cobertos concorrência individual/global, quotas, leases obsoletos e metadados corrompidos. Isso não comprova disponibilidade, permissões, replicação, orçamento ou semântica operacional do serviço Upstash real. Validar essas propriedades antes de qualquer ativação. As integrações PostgreSQL anteriores continuam independentes e usam exclusivamente o serviço descartável existente.

As tarefas oficiais de gateway, orquestração, avaliações, RAG e fontes possuem critérios adicionais. Esta entrega não declara essas tarefas concluídas. Não foram feitas migrações, autenticação, alterações de dados ou integrações reais. O fluxo completo com IA real permanece pendente até as autorizações e os testes operacionais.

## Revisão e reversão

O PR pode ser revisado com a ativação desabilitada. Publicação ou ativação exige autorização separada. Em falha de IA, desabilitar o sinalizador somente com autorização operacional, preservando a calculadora e o modo demonstrativo. Uma reversão de código deve usar novo commit/PR aprovado, preservando o histórico. Não há migração ou dado de conversa a reverter.

## Referências consultadas

- [Catálogo oficial de modelos](https://ai-gateway.vercel.sh/v1/models).
- [Chat Completions do Gateway](https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions).
- [Cabeçalhos de requisição da Vercel](https://vercel.com/docs/headers/request-headers).
- [Redis REST](https://upstash.com/docs/redis/features/restapi).
