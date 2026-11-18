#!/usr/bin/env bash
# Sets (or changes) the login that protects the dashboard at https://APP_DOMAIN.
# Only a bcrypt hash is stored (deploy/caddy/dashboard-auth.caddy); the password is never written to disk.
# Run as the app user:   bash deploy/scripts/set-dashboard-password.sh
set -euo pipefail
# shellcheck source=deploy/scripts/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

require_docker

read -rp "Dashboard username [admin]: " DASH_USER
DASH_USER="${DASH_USER:-admin}"
[[ "$DASH_USER" =~ ^[A-Za-z0-9_.-]{3,32}$ ]] || die "Username: 3-32 letters, digits, dot, dash or underscore."

read -rsp "New password (at least 12 characters): " PW1
echo
read -rsp "Repeat the password: " PW2
echo
[[ "$PW1" == "$PW2" ]] || die "Passwords do not match."
[[ ${#PW1} -ge 12 ]] || die "Password is too short."

# Passed via the environment, not the command line, so it doesn't show up in the host's process list.
HASH="$(PW="$PW1" docker run --rm -e PW caddy:2 sh -c 'caddy hash-password --plaintext "$PW"')"
unset PW1 PW2
[[ "$HASH" == \$2* ]] || die "Could not create the password hash."

umask 022
printf 'basic_auth {\n\t%s %s\n}\n' "$DASH_USER" "$HASH" > "$AUTH_FILE"
ok "Dashboard login saved for user '$DASH_USER'."

if [[ -f "$ENV_FILE" ]] && compose ps --status running --services 2> /dev/null | grep -qx caddy; then
  compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
  ok "Caddy reloaded - the new password is active."
fi
