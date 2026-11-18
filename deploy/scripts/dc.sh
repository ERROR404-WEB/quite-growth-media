#!/usr/bin/env bash
# Shortcut for "docker compose" with the production settings. Examples:
#   bash deploy/scripts/dc.sh ps
#   bash deploy/scripts/dc.sh logs -f --tail 100 api
#   bash deploy/scripts/dc.sh restart n8n
set -euo pipefail
# shellcheck source=deploy/scripts/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

require_env
compose "$@"
