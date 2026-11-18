#!/usr/bin/env bash
# Builds and (re)starts the production stack, applies migrations and seeds the brands.
# Run as the app user from the repository folder:
#   bash deploy/scripts/deploy.sh          deploy the code currently in this folder
#   bash deploy/scripts/deploy.sh --pull   git pull first, then deploy
set -euo pipefail
# shellcheck source=deploy/scripts/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

require_docker
require_env
[[ -f "$AUTH_FILE" ]] || die "Dashboard login not set. Run: bash deploy/scripts/set-dashboard-password.sh"
for key in APP_DOMAIN N8N_DOMAIN ACME_EMAIL ADMIN_API_TOKEN POSTGRES_PASSWORD N8N_DB_PASSWORD N8N_ENCRYPTION_KEY; do
  [[ -n "$(env_value "$key")" ]] || die "$key is empty in deploy/.env"
done

if [[ "${1:-}" == "--pull" ]]; then
  info "Pulling the latest code"
  git -C "$REPO_ROOT" pull --ff-only
fi

info "Building the API image"
compose build api

info "Starting PostgreSQL"
compose up -d --wait postgres

info "Applying database migrations and seeding brands"
compose run --rm --no-deps api node dist/db/cli.js migrate
compose run --rm --no-deps api node dist/db/cli.js seed

info "Starting API, n8n and Caddy"
compose up -d --remove-orphans

info "Waiting for the API to become ready"
for _ in $(seq 1 30); do
  if compose exec -T api wget -qO- http://127.0.0.1:3000/health/ready > /dev/null 2>&1; then
    ok "API is ready"
    compose ps
    printf '\n✅ Deployed.\n   Dashboard: https://%s\n   n8n:       https://%s\n' "$(env_value APP_DOMAIN)" "$(env_value N8N_DOMAIN)"
    echo "   (The first HTTPS visit can take up to a minute while certificates are issued.)"
    exit 0
  fi
  sleep 2
done
compose ps
die "API did not become ready. Check the logs: bash deploy/scripts/dc.sh logs --tail 100 api"
