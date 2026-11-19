#!/usr/bin/env bash
# Sets up n8n on the server (safe to re-run):
#   - creates/updates the "QGM Admin Token" Header Auth credential from ADMIN_API_TOKEN (stored encrypted by n8n)
#   - imports the workflows from n8n/workflows/, pointed at the API inside Docker (http://api:3000)
# Run as the app user after deploy.sh and after creating your n8n owner account:
#   bash deploy/scripts/n8n-bootstrap.sh
set -euo pipefail
# shellcheck source=deploy/scripts/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

require_docker
require_env
compose ps --status running --services | grep -qx n8n || die "n8n is not running. Run deploy.sh first."
TOKEN="$(env_value ADMIN_API_TOKEN)"
[[ "$TOKEN" =~ ^[A-Za-z0-9]{24,}$ ]] || die "ADMIN_API_TOKEN in deploy/.env is missing or has unexpected characters."

umask 077
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"; compose exec -T n8n rm -rf /tmp/qgm-import > /dev/null 2>&1 || true' EXIT

printf '[{"id":"qgmAdminToken001","name":"QGM Admin Token","type":"httpHeaderAuth","data":{"name":"Authorization","value":"Bearer %s"}}]' \
  "$TOKEN" > "$TMP/credentials.json"
unset TOKEN

# Files are streamed in through stdin so they are owned by n8n's own user inside the container.
compose exec -T n8n sh -c 'mkdir -p /tmp/qgm-import/workflows && chmod -R 700 /tmp/qgm-import'
compose exec -T n8n sh -c 'cat > /tmp/qgm-import/credentials.json' < "$TMP/credentials.json"

count=0
for wf in "$REPO_ROOT"/n8n/workflows/*.json; do
  name="$(basename "$wf")"
  sed 's|"value": "http://127.0.0.1:3000"|"value": "http://api:3000"|' "$wf" > "$TMP/$name"
  if grep -q '127.0.0.1:3000' "$TMP/$name"; then die "Could not point $name at http://api:3000"; fi
  compose exec -T n8n sh -c "cat > /tmp/qgm-import/workflows/$name" < "$TMP/$name"
  count=$((count + 1))
done

info "Importing credential"
compose exec -T n8n n8n import:credentials --input=/tmp/qgm-import/credentials.json
info "Importing $count workflow(s)"
compose exec -T n8n n8n import:workflow --separate --input=/tmp/qgm-import/workflows

printf '\n✅ n8n bootstrap complete. In the n8n editor, open "QGM - Daily content scheduler" and\n'
printf '   "QGM - Publish due videos", click "Execute workflow" on each to test, then switch them to Active.\n'
