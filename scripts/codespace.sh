#!/usr/bin/env bash
# Never enable tracing here: the inspect command later reads a private credential.
set +x
set -euo pipefail
refuse() { printf '%s\n' 'MinePRO preparation refused. See docs/CODESPACES.md.' >&2; exit 1; }
no_database_credentials() {
  local name
  for name in DATABASE_URL REDPRO_DB_PASSWORD REDPRO_DB_ENV REDPRO_DB_TARGET_REF REDPRO_DB_AUTH_MODE REDPRO_DB_SSL_CA_FILE SUPABASE_ACCESS_TOKEN SUPABASE_MANAGEMENT_API_TOKEN PGPASSWORD PGHOST PGUSER; do
    [[ ! -v "$name" ]] || refuse
  done
}
docker_local() {
  env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH \
    docker --host=unix:///var/run/docker.sock "$@"
}
[[ $# -ge 1 ]] || refuse
mode="$1"
shift
case "$mode" in
  setup)
    [[ $# -eq 0 ]] || refuse
    no_database_credentials
    [[ "$(node -p 'process.versions.node.split(".")[0]')" == 24 ]] || refuse
    [[ "$(pnpm --version)" == 10.28.1 ]] || refuse
    pnpm install --frozen-lockfile --ignore-scripts
    printf '%s\n' 'MinePRO dependencies ready; no database connection was attempted.'
    ;;
  test-db)
    [[ $# -eq 0 ]] || refuse
    no_database_credentials
    command -v docker >/dev/null || refuse
    docker_local info >/dev/null
    name="minepro-pg-test-$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
    created=0
    cleanup() { if [[ "$created" == 1 ]]; then docker_local rm --force "$name" >/dev/null; fi; }
    trap cleanup EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    # Only public disposable fixtures. No volume, no external interface, no real SQL credentials.
    docker_local run --detach --rm --name "$name" --label com.minepro.disposable=true \
      --publish 127.0.0.1::5432 --tmpfs /var/lib/postgresql/data:rw,nosuid,size=512m \
      --env POSTGRES_DB=redpro_test --env POSTGRES_USER=redpro_ci \
      --env POSTGRES_PASSWORD=redpro_ci_disposable postgres:17.11 >/dev/null
    created=1
    ready=0
    for ((attempt=0; attempt<45; attempt++)); do
      if docker_local exec "$name" pg_isready -U redpro_ci -d redpro_test >/dev/null 2>&1; then ready=1; break; fi
      sleep 1
    done
    [[ "$ready" == 1 ]] || refuse
    binding="$(docker_local port "$name" 5432/tcp)"
    [[ "$binding" =~ ^127\.0\.0\.1:([0-9]+)$ ]] || refuse
    port="${BASH_REMATCH[1]}"
    NODE_ENV=test REDPRO_DB_ENV=test REDPRO_DB_TARGET_REF=local-test \
      DATABASE_URL="postgresql://redpro_ci:redpro_ci_disposable@127.0.0.1:${port}/redpro_test" \
      node --experimental-strip-types --test tests/integration/*.test.ts
    ;;
  inspect)
    [[ $# -eq 4 && -t 0 ]] || refuse
    no_database_credentials
    [[ "${CODESPACES:-}" == true && "${GITHUB_REPOSITORY:-}" == Pedrooca4/redpro ]] || refuse
    sha="$1"; host="$2"; ca="$3"; auth="$4"
    [[ "$sha" =~ ^[a-f0-9]{40}$ && "$(git rev-parse HEAD)" == "$sha" ]] || refuse
    [[ "$(git branch --show-current)" == main && -z "$(git status --porcelain --untracked-files=all)" ]] || refuse
    origin="$(git remote get-url origin)"
    [[ "$origin" == https://github.com/Pedrooca4/redpro || "$origin" == https://github.com/Pedrooca4/redpro.git || "$origin" == git@github.com:Pedrooca4/redpro.git ]] || refuse
    remote_sha="$(git ls-remote --exit-code origin refs/heads/main | cut -f1)"
    [[ "$remote_sha" == "$sha" ]] || refuse
    node --experimental-strip-types scripts/codespace-connection.ts "$sha" "$host" "$ca" "$auth"
    # Credential is typed only into the hidden terminal prompt, never into chat,
    # shell commands, files, workflow inputs or Codespaces secrets.
    (
      trap 'unset REDPRO_DB_PASSWORD mineproSecret DATABASE_URL REDPRO_DB_ENV REDPRO_DB_TARGET_REF REDPRO_DB_AUTH_MODE REDPRO_DB_SSL_CA_FILE' EXIT
      IFS= read -r -s -p 'Credencial privada (entrada oculta; não cole na conversa): ' mineproSecret </dev/tty || refuse
      printf '\n'
      [[ -n "$mineproSecret" ]] || refuse
      export REDPRO_DB_PASSWORD="$mineproSecret"
      unset mineproSecret
      if [[ "$host" == "db.rdwchjjxaipkufgxlnvh.supabase.co" ]]; then user=postgres; else user=postgres.rdwchjjxaipkufgxlnvh; fi
      export DATABASE_URL="postgresql://${user}@${host}:5432/postgres"
      export REDPRO_DB_ENV=development REDPRO_DB_TARGET_REF=rdwchjjxaipkufgxlnvh
      export REDPRO_DB_AUTH_MODE="$auth" REDPRO_DB_SSL_CA_FILE="$ca"
      for command in target check status; do
        node --experimental-strip-types scripts/db.ts "$command"
      done
    )
    ;;
  *) refuse ;;
esac
