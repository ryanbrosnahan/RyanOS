#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${1:-docker-compose.server.yml}"

docker compose -f "$COMPOSE_FILE" exec -T postgres sh -lc '
  set -e
  hba="${PGDATA:-/var/lib/postgresql/data}/pg_hba.conf"
  if ! grep -Eq "^[[:space:]]*host[[:space:]]+all[[:space:]]+all[[:space:]]+0\\.0\\.0\\.0/0" "$hba"; then
    {
      printf "\n# RyanOS Docker network access\n"
      printf "host    all             all             0.0.0.0/0               scram-sha-256\n"
      printf "host    all             all             ::/0                    scram-sha-256\n"
    } >> "$hba"
  fi
  psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-postgres}" -c "SELECT pg_reload_conf();"
'
