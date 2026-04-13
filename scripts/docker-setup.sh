#!/usr/bin/env bash
#
# Configura `.env.docker` y deja listo el despliegue con Docker Compose.
# Uso (desde la raíz del repositorio):
#   chmod +x scripts/docker-setup.sh
#   ./scripts/docker-setup.sh
#
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

die() { echo -e "${RED}ERROR:${NC} $*" >&2; exit 1; }
info() { echo -e "${GREEN}==>${NC} $*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env.docker"

rand_b64() { openssl rand -base64 32 | tr -d '\n' | tr '/+' 'ab'; }

command -v openssl &>/dev/null || die "Se requiere openssl."

SECRET_KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(50))' 2>/dev/null || openssl rand -hex 32)"

echo ""
echo "RoboLabel — configuración Docker (.env.docker)"
echo "-----------------------------------------------"
echo ""
echo "Elige el motor de base de datos:"
echo "  1) SQLite (archivo en volumen Docker; el más simple)"
echo "  2) PostgreSQL 16 (contenedor incluido en Compose)"
echo "  3) MySQL 8 (contenedor incluido en Compose)"
echo ""
read -r -p "Opción [1-3] (predeterminado 1): " DB_CHOICE
DB_CHOICE=${DB_CHOICE:-1}

read -r -p "Puerto HTTP para la interfaz [80]: " HTTP_PORT
HTTP_PORT=${HTTP_PORT:-80}

echo ""
echo "Hosts permitidos (DJANGO_ALLOWED_HOSTS). Incluye dominio o IP pública si accedes desde fuera."
read -r -p "Lista separada por comas [localhost,127.0.0.1,nginx,backend]: " ALLOWED_HOSTS
ALLOWED_HOSTS=${ALLOWED_HOSTS:-localhost,127.0.0.1,nginx,backend}

ROBOLABEL_COMPOSE_PROFILE=""
POSTGRES_PASSWORD_VALUE="robolabel"
MYSQL_PASSWORD_VALUE="robolabel"
MYSQL_ROOT_VALUE="rootpass"
DJANGO_DATABASE="sqlite"

case "$DB_CHOICE" in
  2)
    DJANGO_DATABASE="postgresql"
    ROBOLABEL_COMPOSE_PROFILE="postgres"
    POSTGRES_PASSWORD_VALUE="$(rand_b64)"
    info "Contraseña generada para PostgreSQL (guárdala si la necesitas fuera de .env.docker)."
    echo "    POSTGRES_PASSWORD=$POSTGRES_PASSWORD_VALUE"
    read -r -p "Usuario PostgreSQL [robolabel]: " POSTGRES_USER_IN
    POSTGRES_USER_IN=${POSTGRES_USER_IN:-robolabel}
    read -r -p "Nombre de base [robolabel]: " POSTGRES_DB_IN
    POSTGRES_DB_IN=${POSTGRES_DB_IN:-robolabel}
    ;;
  3)
    DJANGO_DATABASE="mysql"
    ROBOLABEL_COMPOSE_PROFILE="mysql"
    MYSQL_PASSWORD_VALUE="$(rand_b64)"
    MYSQL_ROOT_VALUE="$(rand_b64)"
    info "Contraseñas generadas para MySQL (usuario y root)."
    echo "    MYSQL_PASSWORD=$MYSQL_PASSWORD_VALUE"
    echo "    MYSQL_ROOT_PASSWORD=$MYSQL_ROOT_VALUE"
    read -r -p "Usuario MySQL [robolabel]: " MYSQL_USER_IN
    MYSQL_USER_IN=${MYSQL_USER_IN:-robolabel}
    read -r -p "Nombre de base [robolabel]: " MYSQL_DATABASE_IN
    MYSQL_DATABASE_IN=${MYSQL_DATABASE_IN:-robolabel}
    ;;
  1|"")
    ;;
  *)
    die "Opción no válida: $DB_CHOICE"
    ;;
esac

if [[ -f "$ENV_FILE" ]]; then
  read -r -p "Ya existe .env.docker. ¿Sobrescribir? [s/N]: " OVER
  case "$OVER" in
    s|S|y|Y) ;;
    *) die "Cancelado." ;;
  esac
fi

{
  echo "# Generado por scripts/docker-setup.sh — no commitear"
  echo "DJANGO_SECRET_KEY=$SECRET_KEY"
  echo "DJANGO_DEBUG=0"
  echo "USE_WHITENOISE=1"
  echo "DJANGO_ALLOWED_HOSTS=$ALLOWED_HOSTS"
  echo "HTTP_PORT=$HTTP_PORT"
  echo "DJANGO_DATABASE=$DJANGO_DATABASE"
  echo "SQLITE_PATH=/data/db.sqlite3"
  echo "POSTGRES_HOST=postgres"
  echo "POSTGRES_PORT=5432"
  echo "POSTGRES_USER=${POSTGRES_USER_IN:-robolabel}"
  echo "POSTGRES_PASSWORD=$POSTGRES_PASSWORD_VALUE"
  echo "POSTGRES_DB=${POSTGRES_DB_IN:-robolabel}"
  echo "MYSQL_HOST=mysql"
  echo "MYSQL_PORT=3306"
  echo "MYSQL_USER=${MYSQL_USER_IN:-robolabel}"
  echo "MYSQL_PASSWORD=$MYSQL_PASSWORD_VALUE"
  echo "MYSQL_DATABASE=${MYSQL_DATABASE_IN:-robolabel}"
  echo "MYSQL_ROOT_PASSWORD=$MYSQL_ROOT_VALUE"
  echo "ROBOLABEL_COMPOSE_PROFILE=$ROBOLABEL_COMPOSE_PROFILE"
} >"$ENV_FILE"

chmod 600 "$ENV_FILE" 2>/dev/null || true

echo ""
info "Archivo escrito: $ENV_FILE"
echo ""
echo -e "${GREEN}Siguiente paso:${NC} construir y levantar contenedores:"
echo ""
echo "  ./scripts/docker-up.sh"
echo ""
echo "O manualmente (misma interpolación de variables que el script):"
if [[ -n "$ROBOLABEL_COMPOSE_PROFILE" ]]; then
  echo "  cd $REPO_ROOT && docker compose --env-file .env.docker --profile $ROBOLABEL_COMPOSE_PROFILE up -d --build"
else
  echo "  cd $REPO_ROOT && docker compose --env-file .env.docker up -d --build"
fi
echo ""
echo "Interfaz: http://localhost:${HTTP_PORT}/  ·  API: http://localhost:${HTTP_PORT}/api/v1/"
echo "Datos demo (opcional): docker compose --env-file .env.docker exec backend python manage.py seed_demo"
echo ""
