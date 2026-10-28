# Contribuir com o RedPro

## Branches

main representa a versão integrada. Comece a partir da main atualizada e use codex/red-NNN-descricao para uma tarefa ou codex/red-NNN-NNN-descricao para um lote, por exemplo codex/red-007-008. Use nomes curtos, minúsculos e hífens. Não sobrescreva trabalho de outra branch nem use force push em main.

## Commits

Use tipo: descrição curta, citando RED-NNN quando relevante. Tipos comuns: feat, fix, test, docs, refactor, chore e ci. Exemplo: feat: add request logging (RED-008). Cada commit deve representar uma mudança coerente; mensagens e diffs não devem conter credenciais.

## Pull Requests

Informe problema/objetivo, IDs do backlog, comportamento implementado, validações executadas, limitações e dependências. Para mudanças visuais, forneça evidência desktop/mobile. Use o template do repositório.

Antes de enviar: pnpm check:env, pnpm format:check, pnpm lint, pnpm typecheck, pnpm test e pnpm build. Execute também pnpm smoke com o build em execução.

Abra PR para main e aguarde os checks reais. Corrija falhas antes de integrar. A aprovação do usuário exigida na sessão deve ser obtida antes do envio e antes da integração conforme combinado; não trate CI verde como autorização humana.

Não registre senha, chave, token, cookies ou conteúdo privado em logs. Use o logger permitido e identifique as requisições por x-request-id; consulte docs/LOGGING.md.

Estas convenções orientam o fluxo. Não são regras de proteção automatizadas de branches. CI e Vercel continuam independentes; regras obrigatórias de merge ou deployment checks não foram configuradas aqui.
