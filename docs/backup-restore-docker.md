# Backup y Restore en Docker (media + base de datos)

> **Version:** 1.0 · **Fecha:** 2026-04-14 · **Estado:** referencia operativa  
> **Contexto:** despliegue de RoboLabel en Ubuntu con Docker Compose v2.  
> **Relacionado:** `docker-compose.yml`, `backend/config/settings.py`.

---

## 1. Que se persiste en este proyecto

En esta configuracion, los datos no viven dentro de la imagen, sino en volumenes Docker:

- `media_data` -> fotos y archivos de usuario (`/app/media` en `backend` y `nginx`).
- `sqlite_data` -> archivo de base de datos si usas SQLite.
- `pgdata` -> datos de PostgreSQL si usas perfil `postgres`.
- `mysqldata` -> datos de MySQL si usas perfil `mysql`.

Mientras no elimines los volumenes, los datos persisten al reconstruir o recrear contenedores.

---

## 2. Reglas importantes antes de operar

- Evita `docker compose down -v` si no quieres borrar datos.
- `docker compose up -d --build` actualiza servicios sin borrar volumenes.
- Verifica nombres reales de volumen en tu servidor (pueden llevar prefijo de proyecto).
- Haz backup de `media` y de la base de datos antes de actualizar software.

---

## 3. Identificar volumenes y rutas reales

Listar volumenes relacionados:

```bash
docker volume ls | grep -E 'robolabel|media|sqlite|pgdata|mysqldata'
```

Ver la ruta real en disco de un volumen:

```bash
docker volume inspect robolabel_media_data
```

Revisar el campo `Mountpoint` del resultado.

---

## 4. Backup de volumenes (tar.gz)

### 4.1 Preparar directorio de backups

```bash
mkdir -p ~/backups/robolabel
```

### 4.2 Backup de media (fotos)

```bash
docker run --rm \
  -v robolabel_media_data:/source:ro \
  -v ~/backups/robolabel:/backup \
  alpine sh -c "tar czf /backup/media_data_$(date +%F_%H%M).tar.gz -C /source ."
```

### 4.3 Backup de SQLite (si aplica)

```bash
docker run --rm \
  -v robolabel_sqlite_data:/source:ro \
  -v ~/backups/robolabel:/backup \
  alpine sh -c "tar czf /backup/sqlite_data_$(date +%F_%H%M).tar.gz -C /source ."
```

### 4.4 Backup de PostgreSQL (volumen crudo, opcional)

```bash
docker run --rm \
  -v robolabel_pgdata:/source:ro \
  -v ~/backups/robolabel:/backup \
  alpine sh -c "tar czf /backup/pgdata_$(date +%F_%H%M).tar.gz -C /source ."
```

### 4.5 Backup de MySQL (volumen crudo, opcional)

```bash
docker run --rm \
  -v robolabel_mysqldata:/source:ro \
  -v ~/backups/robolabel:/backup \
  alpine sh -c "tar czf /backup/mysqldata_$(date +%F_%H%M).tar.gz -C /source ."
```

---

## 5. Backup logico de base de datos (recomendado)

Para restauraciones controladas, se recomienda backup logico (dump) de la DB.

### 5.1 PostgreSQL

```bash
docker compose exec -T postgres \
  pg_dump -U robolabel -d robolabel \
  > ~/backups/robolabel/postgres_$(date +%F_%H%M).sql
```

### 5.2 MySQL

```bash
docker compose exec -T mysql \
  mysqldump -uroot -p'rootpass' robolabel \
  > ~/backups/robolabel/mysql_$(date +%F_%H%M).sql
```

### 5.3 SQLite

Si el archivo SQLite vive en `/data`:

```bash
docker compose exec -T backend sh -lc "cp /data/*.sqlite3 /tmp/db.sqlite3"
docker compose cp backend:/tmp/db.sqlite3 ~/backups/robolabel/sqlite_$(date +%F_%H%M).sqlite3
```

---

## 6. Restore de volumenes

> **Atencion:** restaurar un volumen sobreescribe su contenido actual.

### 6.1 Restore de media

```bash
docker run --rm \
  -v robolabel_media_data:/target \
  -v ~/backups/robolabel:/backup \
  alpine sh -c "rm -rf /target/* && tar xzf /backup/media_data_YYYY-MM-DD_HHMM.tar.gz -C /target"
```

### 6.2 Restore de SQLite (volumen)

```bash
docker run --rm \
  -v robolabel_sqlite_data:/target \
  -v ~/backups/robolabel:/backup \
  alpine sh -c "rm -rf /target/* && tar xzf /backup/sqlite_data_YYYY-MM-DD_HHMM.tar.gz -C /target"
```

### 6.3 Restore de pgdata/mysqldata (solo si sabes lo que haces)

Tambien puedes restaurar volumen crudo de PostgreSQL/MySQL con el mismo patron.  
Se recomienda preferir restore logico (`.sql`) para evitar incompatibilidades de version.

---

## 7. Restore logico de base de datos

### 7.1 PostgreSQL

```bash
cat ~/backups/robolabel/postgres_YYYY-MM-DD_HHMM.sql | \
docker compose exec -T postgres psql -U robolabel -d robolabel
```

### 7.2 MySQL

```bash
cat ~/backups/robolabel/mysql_YYYY-MM-DD_HHMM.sql | \
docker compose exec -T mysql mysql -uroot -p'rootpass' robolabel
```

### 7.3 SQLite

Con contenedores detenidos:

```bash
docker compose stop backend nginx
```

Copiar backup al volumen (si usas `sqlite_data`):

```bash
docker run --rm \
  -v robolabel_sqlite_data:/target \
  -v ~/backups/robolabel:/backup \
  alpine sh -c "cp /backup/sqlite_YYYY-MM-DD_HHMM.sqlite3 /target/db.sqlite3"
```

Levantar servicios:

```bash
docker compose up -d
```

---

## 8. Flujo recomendado antes de actualizar el repo

1. Confirmar stack activo: `docker compose ps`
2. Backup de `media_data`.
3. Backup logico de DB (Postgres/MySQL) o copia de SQLite.
4. Actualizar codigo (`git pull`).
5. Aplicar despliegue (`docker compose up -d --build`).
6. Verificar aplicacion y datos.

---

## 9. Verificacion rapida de backups

Validar que los archivos se crearon:

```bash
ls -lh ~/backups/robolabel
```

Inspeccionar contenido de un backup tar:

```bash
tar tzf ~/backups/robolabel/media_data_YYYY-MM-DD_HHMM.tar.gz | head
```

---

## 10. Errores comunes

- Restaurar en volumen incorrecto por nombre mal identificado.
- Usar `down -v` por error y perder volumenes.
- Restaurar dump SQL en una base vacia con credenciales distintas.
- Restaurar backup de motor/version incompatible sin pruebas previas.

---

## 11. Recomendaciones de operacion

- Mantener al menos copia diaria + copia semanal.
- Guardar backups fuera del servidor (objeto externo o segundo host).
- Probar restore en entorno de prueba de forma periodica.
- Documentar credenciales y nombre real de volumenes por servidor.
