#!/usr/bin/env bash
#
# Construye y arranca RoboLabel con Docker Compose usando `.env.docker`.
# Respeta ROBOLABEL_COMPOSE_PROFILE definido en ese archivo.
#
# Nota: no usamos `docker compose --env-file` porque en Ubuntu el paquete
# `docker.io` a veces solo instala el cliente `docker` sin el plugin Compose v2;
# en ese caso `docker` no reconoce la suborden `compose` ni `--env-file`.
# Cargamos las variables con `source` para la interpolación del compose.
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

# Interpolación de ${HTTP_PORT}, credenciales de BD, etc. en docker-compose.yml
set -a
# shellcheck disable=SC1091
source "$ENV_FILE"
set +a

PROFILE="${ROBOLABEL_COMPOSE_PROFILE:-}"
PROFILE="${PROFILE//$'\r'/}"

run_compose() {
  if docker compose version &>/dev/null 2>&1; then
    exec docker compose "$@"
  fi
  if command -v docker-compose &>/dev/null; then
    exec docker-compose "$@"
  fi
  echo "No se encontró Docker Compose (v2 plugin ni docker-compose)." >&2
  echo "En Ubuntu, instala el plugin oficial:" >&2
  echo "  sudo apt update && sudo apt install -y docker-compose-plugin" >&2
  echo "Luego comprueba: docker compose version" >&2
  exit 1
}

ARGS=()
if [[ -n "$PROFILE" ]]; then
  ARGS+=(--profile "$PROFILE")
fi
ARGS+=(up -d --build)

echo "Ejecutando: docker compose ${ARGS[*]} $*"
run_compose "${ARGS[@]}" "$@"
