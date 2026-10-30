# Estabilidade da validação de versão no Chromium

Lote de manutenção, base `b987cc763c950e0527b2f1831a01b24617df19c4`, PR #11. Sem mudanças no produto, dependências, workflow, segurança, migrações ou configurações externas.

## Evidência e limite do diagnóstico

O [job histórico](https://github.com/Pedrooca4/redpro/actions/runs/41086742915/job/124169753578) falhou aguardando `.composer-error` por 30 segundos em `scripts/test-ui.mjs:154`. Esse ponto é o clique em Aplicar após preencher uma versão personalizada inválida; não é o cenário de falha simulada de envio. A reexecução anterior passou, mas não demonstra correção da causa.

Inspecionados VersionSelect, ChatShell, PrototypeDialog e chatReducer. O erro esperado é produzido localmente pelo reducer; não depende de API, banco ou rede. Foram consideradas sincronização de eventos/renderização, estado previewing que rejeita mudanças de contexto, foco/modal e diferenças de carga do navegador. O log antigo não registrava o valor do campo, estado busy ou diálogos naquele instante: não permite escolher uma dessas hipóteses como causa comprovada.

Uma fragilidade comprovada no código do teste: esperar somente a visibilidade de `.composer-error` aceita qualquer erro anterior. A leitura imediata da versão após o clique também não espera sua confirmação renderizada. Esses pontos são endurecidos neste lote; não são prova da origem do timeout histórico.

## Verificação fortalecida

- Preservados todos os cenários anteriores de rotas, edições, modos, mensagens, rascunho/retry, limites, ferramentas, teclado, escala de texto e viewport 320 × 360.
- Vinte ciclos inválido/válido por largura 320/390/768/1440, 80 por execução completa. Cada ciclo começa sem erro, envia `invalid` uma vez, exige a mensagem exata de versão inválida e confirma que o contexto continua não informado. Depois aplica `1.20.2` uma vez, espera a versão renderizada e exige remoção do erro. O reset entre ciclos impede reutilizar sucesso/erro anterior.
- Asserções web-first esperam condições observáveis com o mesmo teto de 30 segundos do waitFor anterior. Sem sleeps, retries do cenário, cliques extras para recuperar falhas, `.skip`, captura que converta falha em sucesso ou aumento de timeout.
- Em falha, registra somente largura/ciclo e estado mínimo dos controles sintéticos: valor da versão de teste, aria-busy, opção selecionada, presença visual do erro e quantidade de modais. Não grava rascunhos, mensagens, cookies, storage, tokens, traces ou screenshots adicionais. Se o diagnóstico falhar, o erro original é preservado e o job continua falhando.
- O log e results.json registram ciclos efetivamente concluídos, além dos cinco cenários de viewport. Nenhum campo novo é sinal de IA, histórico ou biblioteca reais.

## Validação e pendências

Chromium local indisponível: a instalação retornou ZIP inválido/truncado. Por isso as repetições reais são executadas na CI descartável, com o workflow e a versão fixada existentes. Unitários e verificações de sintaxe/lint foram executados localmente. O resultado exato de cada revisão/execução fica no PR #11.

Enquanto não houver reprodução com evidência suficiente, o timeout histórico permanece de causa não confirmada. Sucessos repetidos reduzem a incerteza desta sequência, mas não garantem ausência de intermitência em toda carga/ambiente. Nenhuma correção no componente foi presumida necessária e nenhum recurso público foi alterado. Se voltar a ocorrer, investigar o primeiro estado divergente registrado antes de propor uma alteração no produto.
