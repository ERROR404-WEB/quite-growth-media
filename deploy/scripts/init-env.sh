#!/usr/bin/env bash
# Creates deploy/.env on the server: generates all secrets and asks for your domains.
# Run as the app user from the repository folder:   bash deploy/scripts/init-env.sh
set -euo pipefail
# shellcheck source=deploy/scripts/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

require_docker
if [[ -f "$ENV_FILE" ]]; then
  echo "deploy/.env already exists - leaving it unchanged."
  echo "To change a domain, edit it with: nano deploy/.env"
  exit 0
fi

PUBLIC_IP="$(curl -fsS4 --max-time 5 https://api.ipify.org || hostname -I | awk '{print $1}')"
SSLIP="${PUBLIC_IP//./-}.sslip.io"

info "Your server's public IP: $PUBLIC_IP"
echo "Enter the two web addresses. If you don't own a domain yet, press Enter to use the free"
echo "test addresses under sslip.io (they point to this IP automatically)."
read -rp "Dashboard address [app.$SSLIP]: " APP_DOMAIN
APP_DOMAIN="${APP_DOMAIN:-app.$SSLIP}"
read -rp "n8n address       [n8n.$SSLIP]: " N8N_DOMAIN
N8N_DOMAIN="${N8N_DOMAIN:-n8n.$SSLIP}"
read -rp "Email for HTTPS certificate notices: " ACME_EMAIL

domain_re='^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]{2,}$'
[[ "$APP_DOMAIN" =~ $domain_re ]] || die "Not a valid address: $APP_DOMAIN (use lowercase, no https://)"
[[ "$N8N_DOMAIN" =~ $domain_re ]] || die "Not a valid address: $N8N_DOMAIN (use lowercase, no https://)"
[[ "$APP_DOMAIN" != "$N8N_DOMAIN" ]] || die "The two addresses must be different."
[[ "$ACME_EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || die "Not a valid email: $ACME_EMAIL"

info "Generating secrets (they are written to deploy/.env and never shown)"
docker run --rm -u "$(id -u):$(id -g)" -v "$REPO_ROOT:/repo" -w /repo node:24-alpine \
  node scripts/setup-env.mjs --example deploy/.env.example --out deploy/.env
sed -i \
  -e "s|^APP_DOMAIN=.*|APP_DOMAIN=$APP_DOMAIN|" \
  -e "s|^N8N_DOMAIN=.*|N8N_DOMAIN=$N8N_DOMAIN|" \
  -e "s|^ACME_EMAIL=.*|ACME_EMAIL=$ACME_EMAIL|" \
  "$ENV_FILE"
chmod 600 "$ENV_FILE"

ok "deploy/.env created (dashboard: https://$APP_DOMAIN, n8n: https://$N8N_DOMAIN)"
echo "Next: bash deploy/scripts/set-dashboard-password.sh"
