#!/usr/bin/env bash
#
# Construye y arranca RoboLabel con Docker Compose usando `.env.docker`.
# Respeta ROBOLABEL_COMPOSE_PROFILE definido por scripts/docker-setup.sh.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="$REPO_ROOT/.env.docker"
[[ -f "$ENV_FILE" ]] || {
  echo "Falta .env.docker. Ejecuta primero: ./scripts/docker-setup.sh" >&2
  exit 1
}

PROFILE=""
if grep -q '^ROBOLABEL_COMPOSE_PROFILE=' "$ENV_FILE" 2>/dev/null; then
  PROFILE=$(grep '^ROBOLABEL_COMPOSE_PROFILE=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r' | tr -d "'\"")
fi

COMPOSE=(docker compose --env-file "$ENV_FILE")
if [[ -n "${PROFILE:-}" ]]; then
  COMPOSE+=(--profile "$PROFILE")
fi
COMPOSE+=(up -d --build)

echo "Ejecutando: ${COMPOSE[*]} $*"
exec "${COMPOSE[@]}" "$@"
