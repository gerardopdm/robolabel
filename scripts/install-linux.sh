#!/usr/bin/env bash
#
# RoboLabel — instalación en Linux (Ubuntu/Debian y similares).
# Uso (desde la raíz del repositorio clonado, p. ej. /opt/robolabel):
#   chmod +x scripts/install-linux.sh
#   ./scripts/install-linux.sh
#
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

die() {
  echo -e "${RED}ERROR:${NC} $*" >&2
  exit 1
}

info() { echo -e "${GREEN}==>${NC} $*"; }
warn() { echo -e "${YELLOW}AVISO:${NC} $*" >&2; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND="$REPO_ROOT/backend"
FRONTEND="$REPO_ROOT/frontend"
VENV="$BACKEND/.venv"

SEED=false
for arg in "$@"; do
  case "$arg" in
    --seed) SEED=true ;;
    -h|--help)
      cat <<EOF
Instala dependencias del backend (venv + pip + migrate) y del frontend (npm).

Uso: $(basename "$0") [opciones]

Opciones:
  --seed    Tras migrate, ejecuta seed_demo (usuarios y datos de prueba)
  -h, --help  Esta ayuda

Ejemplo:
  sudo mkdir -p /opt/robolabel && sudo chown "\$USER:\$USER" /opt/robolabel
  git clone <url-del-repo> /opt/robolabel
  cd /opt/robolabel && ./scripts/install-linux.sh --seed
EOF
      exit 0
      ;;
    *)
      die "Opción desconocida: $arg (usa --help)"
      ;;
  esac
done

[[ -f "$BACKEND/requirements.txt" ]] || die "No se encuentra backend/requirements.txt. Ejecuta este script desde el clon del repo RoboLabel (raíz: $REPO_ROOT)."
[[ -f "$BACKEND/manage.py" ]] || die "No se encuentra backend/manage.py."
[[ -f "$FRONTEND/package.json" ]] || die "No se encuentra frontend/package.json."

PYTHON=""
for cmd in python3.12 python3; do
  if command -v "$cmd" &>/dev/null; then
    if "$cmd" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)' 2>/dev/null; then
      PYTHON="$(command -v "$cmd")"
      break
    fi
  fi
done
[[ -n "${PYTHON:-}" ]] || die "Se requiere Python 3.12 o superior. En Ubuntu: sudo apt update && sudo apt install -y python3.12 python3.12-venv python3.12-dev"

command -v npm &>/dev/null || die "No se encontró npm. Instala Node.js LTS (p. ej. paquetes nodejs/npm del sistema, nvm o https://nodejs.org)."

info "Repositorio: $REPO_ROOT"

if [[ -d "$VENV" ]]; then
  warn "Ya existe el entorno virtual en $VENV; se reutiliza."
else
  info "Creando entorno virtual: $VENV"
  "$PYTHON" -m venv "$VENV" || die "Fallo al ejecutar: python -m venv. ¿Instalaste python3.12-venv?"
fi

# shellcheck source=/dev/null
source "$VENV/bin/activate"
[[ -n "${VIRTUAL_ENV:-}" ]] || die "No se pudo activar el venv en $VENV."

info "Actualizando pip e instalando dependencias Python"
pip install --upgrade pip >/dev/null || die "pip install --upgrade pip falló."
pip install -r "$BACKEND/requirements.txt" || die "pip install -r requirements.txt falló. Revisa errores de compilación o red arriba."

info "Aplicando migraciones Django"
( cd "$BACKEND" && python manage.py migrate ) || die "python manage.py migrate falló."

if [[ "$SEED" == true ]]; then
  info "Cargando datos de demostración (seed_demo)"
  ( cd "$BACKEND" && python manage.py seed_demo ) || die "python manage.py seed_demo falló."
fi

info "Instalando dependencias del frontend (npm)"
if [[ -f "$FRONTEND/package-lock.json" ]]; then
  if ! ( cd "$FRONTEND" && npm ci ); then
    warn "npm ci falló (lock desincronizado u otro error). Intentando npm install..."
    ( cd "$FRONTEND" && npm install ) || die "npm install falló. Revisa la salida de npm arriba."
  fi
else
  warn "No hay package-lock.json; usando npm install."
  ( cd "$FRONTEND" && npm install ) || die "npm install falló. Revisa la salida de npm arriba."
fi

echo ""
echo -e "${GREEN}Instalación completada correctamente.${NC}"
echo ""
echo "Para desarrollo:"
echo "  Backend:  cd $BACKEND && source .venv/bin/activate && python manage.py runserver"
echo "  Frontend: cd $FRONTEND && npm run dev"
echo ""
echo "API: http://127.0.0.1:8000/api/v1/  ·  UI: http://localhost:5173"
