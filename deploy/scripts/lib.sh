#!/usr/bin/env bash
# Shared helpers for deploy/scripts/*.sh. Source it; do not run it directly.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY_DIR="$REPO_ROOT/deploy"
ENV_FILE="$DEPLOY_DIR/.env"
# shellcheck disable=SC2034  # used by the scripts that source this file
AUTH_FILE="$DEPLOY_DIR/caddy/dashboard-auth.caddy"

info() { printf '\n==> %s\n' "$*"; }
ok() { printf '    OK: %s\n' "$*"; }
die() {
  printf '\nERROR: %s\n' "$*" >&2
  exit 1
}

require_docker() {
  command -v docker > /dev/null || die "Docker is not installed. Run deploy/scripts/server-setup.sh first."
  docker info > /dev/null 2>&1 || die "Cannot talk to Docker. Log out and back in (docker group), or check: sudo systemctl status docker"
}

require_env() {
  [[ -f "$ENV_FILE" ]] || die "deploy/.env is missing. Run: bash deploy/scripts/init-env.sh"
}

# Reads one value from deploy/.env without printing it.
env_value() {
  grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2-
}

compose() {
  docker compose --project-directory "$DEPLOY_DIR" -f "$DEPLOY_DIR/docker-compose.yml" --env-file "$ENV_FILE" "$@"
}
