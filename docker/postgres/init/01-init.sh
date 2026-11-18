#!/bin/sh
# Runs once, the first time the postgres volume is created.
# Creates the test database and a separate least-privilege role + database for n8n.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v n8n_password="$N8N_DB_PASSWORD" -v app_user="$POSTGRES_USER" <<'EOSQL'
CREATE DATABASE qgm_test OWNER :"app_user";
CREATE ROLE n8n LOGIN PASSWORD :'n8n_password';
CREATE DATABASE n8n OWNER n8n;
REVOKE ALL ON DATABASE n8n FROM PUBLIC;
EOSQL

for db in "$POSTGRES_DB" qgm_test; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" -c 'CREATE EXTENSION IF NOT EXISTS vector;'
done
