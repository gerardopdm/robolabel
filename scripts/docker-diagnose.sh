#!/usr/bin/env bash
#
# Diagnostica problemas de red/DNS durante `docker build` en Ubuntu.
# Uso:
#   chmod +x scripts/docker-diagnose.sh
#   ./scripts/docker-diagnose.sh
#

set -u -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="${TMPDIR:-/tmp}/robolabel-docker-diagnose-${TIMESTAMP}.log"

exec > >(tee -a "$LOG_FILE") 2>&1

section() {
  echo ""
  echo "=================================================================="
  echo "$1"
  echo "=================================================================="
}

run_cmd() {
  local description="$1"
  shift

  echo ""
  echo "--- $description"
  echo "+ $*"
  if "$@"; then
    echo "[OK] $description"
  else
    local rc=$?
    echo "[FAIL:$rc] $description"
  fi
}

run_shell() {
  local description="$1"
  shift
  run_cmd "$description" bash -lc "$*"
}

compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    echo "docker compose"
    return 0
  fi
  if command -v docker-compose >/dev/null 2>&1; then
    echo "docker-compose"
    return 0
  fi
  return 1
}

TEMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

cat >"$TEMP_DIR/Dockerfile" <<'EOF'
FROM python:3.12-slim-bookworm
RUN set -eux; \
    echo "-- /etc/resolv.conf --"; \
    cat /etc/resolv.conf; \
    echo; \
    echo "-- getent hosts deb.debian.org --"; \
    getent hosts deb.debian.org || true; \
    echo; \
    echo "-- apt-get update --"; \
    apt-get update -o Acquire::Retries=1
EOF

section "Resumen"
echo "Fecha: $(date -Is)"
echo "Host: $(hostname)"
echo "Usuario: $(id -un)"
echo "Repo: $REPO_ROOT"
echo "Log: $LOG_FILE"

if command -v git >/dev/null 2>&1; then
  run_shell "Commit actual del repo" "git rev-parse --short HEAD && git status --short"
fi

section "Host Ubuntu"
run_shell "Sistema operativo" "uname -a && echo && sed -n '1,20p' /etc/os-release"
run_shell "Resolver del host" "sed -n '1,20p' /etc/resolv.conf"
run_shell "Ruta por defecto" "ip route || true"
run_shell "Resolucion DNS del host" "getent hosts deb.debian.org && echo && getent ahostsv4 deb.debian.org || true"
run_shell "Ping del host a deb.debian.org" "ping -c 2 -W 2 deb.debian.org"

section "Docker instalado"
run_shell "Version de Docker" "docker version"
run_shell "Informacion resumida del daemon" "docker info 2>/dev/null | sed -n '1,80p'"
run_shell "Contextos de Docker" "docker context ls"
run_shell "Buildx" "docker buildx version"
run_shell "Config del daemon" "if [ -f /etc/docker/daemon.json ]; then sed -n '1,120p' /etc/docker/daemon.json; else echo '/etc/docker/daemon.json no existe'; fi"
run_shell "Estado del servicio Docker" "systemctl status docker --no-pager -n 20 || true"

section "Compose y archivos del repo"
run_shell "Version de Compose" "if docker compose version >/dev/null 2>&1; then docker compose version; elif command -v docker-compose >/dev/null 2>&1; then docker-compose version; else echo 'Compose no instalado'; fi"
run_shell "Dockerfile backend actual" "sed -n '1,40p' docker/Dockerfile.backend"
run_shell "Dockerfile nginx actual" "sed -n '1,30p' docker/Dockerfile.nginx"
run_shell "Compose backend/nginx" "sed -n '50,90p' docker-compose.yml"

section "Prueba: docker run"
run_shell \
  "Contenedor base con resolv.conf y apt-get update" \
  "docker run --rm python:3.12-slim-bookworm sh -lc 'echo \"-- /etc/resolv.conf --\"; cat /etc/resolv.conf; echo; echo \"-- getent hosts deb.debian.org --\"; getent hosts deb.debian.org || true; echo; echo \"-- apt-get update --\"; apt-get update -o Acquire::Retries=1'"

section "Prueba: docker build minimo"
run_shell \
  "Build con BuildKit por defecto" \
  "docker build --no-cache --progress=plain -f \"$TEMP_DIR/Dockerfile\" \"$TEMP_DIR\""
run_shell \
  "Build con network=host" \
  "docker build --no-cache --progress=plain --network=host -f \"$TEMP_DIR/Dockerfile\" \"$TEMP_DIR\""
run_shell \
  "Build sin BuildKit" \
  "DOCKER_BUILDKIT=0 docker build --no-cache -f \"$TEMP_DIR/Dockerfile\" \"$TEMP_DIR\""

section "Prueba opcional: build real del backend"
if COMPOSE_BIN="$(compose_cmd)"; then
  run_shell \
    "Compose build del backend sin cache" \
    "$COMPOSE_BIN build --no-cache backend"
else
  echo "Compose no esta disponible; se omite la prueba del backend."
fi

section "Fin"
echo "Diagnostico completado."
echo "Guarda o comparte este log para revisar diferencias entre host, docker run y docker build:"
echo "$LOG_FILE"
