#!/usr/bin/env bash
# Restores or test-restores a backup made by backup.sh.
#   bash deploy/scripts/restore.sh --verify /var/backups/qgm/<STAMP>   SAFE: restores into a temporary
#                                                                      database, checks it, deletes it
#   bash deploy/scripts/restore.sh /var/backups/qgm/<STAMP>            DANGER: replaces the live databases
set -euo pipefail
# shellcheck source=deploy/scripts/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

MODE="restore"
if [[ "${1:-}" == "--verify" ]]; then
  MODE="verify"
  shift
fi
SRC="${1:-}"
[[ -n "$SRC" && -d "$SRC" ]] || die "Usage: restore.sh [--verify] <backup folder>"

require_docker
require_env
PGUSER="$(env_value POSTGRES_USER)"
PGUSER="${PGUSER:-qgm}"
PGDB="$(env_value POSTGRES_DB)"
PGDB="${PGDB:-qgm}"
[[ -s "$SRC/$PGDB.dump" && -s "$SRC/n8n.dump" ]] || die "$SRC does not contain $PGDB.dump and n8n.dump"
psql_exec() { compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$PGUSER" -d postgres -qAt "$@"; }

if [[ "$MODE" == "verify" ]]; then
  CHECK_DB="qgm_restore_check"
  info "Test-restoring $SRC into temporary database $CHECK_DB"
  psql_exec -c "DROP DATABASE IF EXISTS $CHECK_DB" -c "CREATE DATABASE $CHECK_DB"
  trap 'psql_exec -c "DROP DATABASE IF EXISTS $CHECK_DB" > /dev/null' EXIT
  compose exec -T postgres pg_restore -U "$PGUSER" -d "$CHECK_DB" --no-owner --exit-on-error < "$SRC/$PGDB.dump"
  BRANDS="$(compose exec -T postgres psql -U "$PGUSER" -d "$CHECK_DB" -qAt -c 'SELECT count(*) FROM brands')"
  MIGRATIONS="$(compose exec -T postgres psql -U "$PGUSER" -d "$CHECK_DB" -qAt -c 'SELECT count(*) FROM schema_migrations')"
  [[ "$BRANDS" -gt 0 ]] || die "Restored database has no brands"
  ok "app database restores cleanly ($BRANDS brands, $MIGRATIONS migrations)"
  compose exec -T postgres pg_restore --list < "$SRC/n8n.dump" > /dev/null
  ok "n8n dump is readable"
  printf '\n✅ Restore test passed for %s\n' "$SRC"
  exit 0
fi

echo "This REPLACES the live '$PGDB' and 'n8n' databases with the backup in:"
echo "  $SRC"
read -rp "Type RESTORE to continue: " CONFIRM
[[ "$CONFIRM" == "RESTORE" ]] || die "Cancelled."

info "Taking a safety backup of the current state first"
bash "$DEPLOY_DIR/scripts/backup.sh"

info "Stopping API and n8n"
compose stop api n8n
for db in "$PGDB" n8n; do
  info "Restoring $db"
  compose exec -T postgres pg_restore -U "$PGUSER" -d "$db" --clean --if-exists --exit-on-error < "$SRC/$db.dump"
done
info "Starting API and n8n"
compose start api n8n
printf '\n✅ Restored from %s\n' "$SRC"
