#!/usr/bin/env bash
# Backs up both databases, n8n's data folder and the server settings.
#   bash deploy/scripts/backup.sh                  run a backup now
#   bash deploy/scripts/backup.sh --install-cron   run it automatically every night at 02:17 (server time)
# Backups land in BACKUP_DIR (default /var/backups/qgm), one folder per run; folders older than
# BACKUP_RETENTION_DAYS (default 14) are deleted. They contain secrets (deploy/.env) - keep them private.
set -euo pipefail
# shellcheck source=deploy/scripts/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

require_env
BACKUP_DIR="$(env_value BACKUP_DIR)"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/qgm}"
RETENTION_DAYS="$(env_value BACKUP_RETENTION_DAYS)"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
[[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || die "BACKUP_RETENTION_DAYS must be a number"
PGUSER="$(env_value POSTGRES_USER)"
PGUSER="${PGUSER:-qgm}"
PGDB="$(env_value POSTGRES_DB)"
PGDB="${PGDB:-qgm}"

if [[ "${1:-}" == "--install-cron" ]]; then
  line="17 2 * * * /bin/bash $DEPLOY_DIR/scripts/backup.sh >> $BACKUP_DIR/backup.log 2>&1"
  (crontab -l 2> /dev/null | grep -vF "$DEPLOY_DIR/scripts/backup.sh" || true; echo "$line") | crontab -
  ok "Nightly backup scheduled (crontab -l to view)."
  exit 0
fi

require_docker
[[ -d "$BACKUP_DIR" && -w "$BACKUP_DIR" ]] || die "$BACKUP_DIR is missing or not writable (server-setup.sh creates it)."
umask 077
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$BACKUP_DIR/$STAMP"
mkdir -p "$DEST"

info "Backup $STAMP -> $DEST"
for db in "$PGDB" n8n; do
  compose exec -T postgres pg_dump -U "$PGUSER" -Fc "$db" > "$DEST/$db.dump"
  # pg_restore --list fails on a truncated or corrupt dump.
  compose exec -T postgres pg_restore --list < "$DEST/$db.dump" > /dev/null || die "Backup of $db is not readable"
  ok "database $db ($(du -h "$DEST/$db.dump" | cut -f1))"
done

N8N_VOLUME="$(docker volume ls -q --filter label=com.docker.compose.project=qgm --filter label=com.docker.compose.volume=n8n_data | head -n1)"
if [[ -n "$N8N_VOLUME" ]]; then
  docker run --rm -v "$N8N_VOLUME:/data:ro" -v "$DEST:/backup" alpine \
    sh -c "tar czf /backup/n8n_data.tgz -C /data . && chown $(id -u):$(id -g) /backup/n8n_data.tgz"
  ok "n8n data folder"
fi

cp "$ENV_FILE" "$DEST/deploy.env"
[[ -f "$AUTH_FILE" ]] && cp "$AUTH_FILE" "$DEST/"
{
  echo "created_utc=$STAMP"
  echo "git_commit=$(git -C "$REPO_ROOT" rev-parse --short HEAD 2> /dev/null || echo unknown)"
  (cd "$DEST" && ls -l)
} > "$DEST/manifest.txt"
ok "settings (deploy/.env, dashboard login)"

find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*Z' -mtime +"$RETENTION_DAYS" -exec rm -rf {} +
ok "removed backups older than $RETENTION_DAYS days"
printf '\n✅ Backup complete: %s (%s)\n' "$DEST" "$(du -sh "$DEST" | cut -f1)"
