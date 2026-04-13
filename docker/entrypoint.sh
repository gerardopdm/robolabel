#!/bin/bash
set -euo pipefail
cd /app

wait_tcp() {
  local host=$1 port=$2 tries=${3:-60}
  local i=0
  while [ "$i" -lt "$tries" ]; do
    if (echo >/dev/tcp/"$host"/"$port") 2>/dev/null; then
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done
  echo "ERROR: no se pudo conectar a ${host}:${port} tras ${tries} intentos." >&2
  return 1
}

case "${DJANGO_DATABASE:-sqlite}" in
  postgresql)
    echo "Esperando PostgreSQL en ${POSTGRES_HOST:-postgres}:${POSTGRES_PORT:-5432}..."
    wait_tcp "${POSTGRES_HOST:-postgres}" "${POSTGRES_PORT:-5432}" 60
    ;;
  mysql)
    echo "Esperando MySQL en ${MYSQL_HOST:-mysql}:${MYSQL_PORT:-3306}..."
    wait_tcp "${MYSQL_HOST:-mysql}" "${MYSQL_PORT:-3306}" 90
    ;;
esac

python manage.py migrate --noinput

if [ "${USE_WHITENOISE:-0}" = "1" ] || [ "${USE_WHITENOISE:-0}" = "true" ]; then
  python manage.py collectstatic --noinput
fi

exec "$@"
