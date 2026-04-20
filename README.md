# RoboLabel

Aplicación web para gestionar proyectos de visión por computadora: grupos de imágenes, etiquetado con bounding boxes y exportación **YOLOv8** (ZIP), con **versiones de dataset** y soporte **multiempresa** (JWT).

**Esta versión** incluye **roles y permisos** para el flujo de trabajo: **etiquetado** (alcance por asignación de grupos) y **validación** (revisión y cierre de imágenes), además de administración y asignación de lotes. Detalle en [Arquitectura de permisos](docs/arquitectura-permisos.md).

## Stack

- **Backend:** Python 3.12+, Django 5, Django REST Framework, SimpleJWT; base de datos **SQLite** (por defecto), **PostgreSQL** o **MySQL** (variables de entorno o Docker).
- **Frontend:** React 19, TypeScript, Vite 8, Tailwind CSS 4, React Router 7.

---

## Instalación

### Resumen: opciones

Elige **una** vía según tu entorno. No hace falta seguir todas las secciones.

| Opción | Descripción breve | Requisitos principales |
|--------|-------------------|-------------------------|
| **[A. Docker](#a-docker)** | Contenedores: backend (Gunicorn), nginx (frontend compilado) y base de datos opcional. El asistente pregunta si usas **SQLite**, **PostgreSQL** o **MySQL** y genera `.env.docker`. | Docker + Docker Compose v2 |
| **[B. Script Linux](#b-script-linux)** | Sin Docker: venv Python, migraciones y `npm` en el repo. Base de datos: **SQLite** (por defecto del proyecto). | Git, Python 3.12+, Node.js (npm) |
| **[C. Manual](#c-manual)** | Mismos pasos que el script pero ejecutados tú. Base de datos: **SQLite** por defecto; PostgreSQL/MySQL requieren configurar variables (ver `docker/env.docker.example` y `backend/config/settings.py`). | Git, Python 3.12+, Node.js (npm) |
| **[D. Desarrollo local](#d-desarrollo-local)** | Backend y frontend en modo desarrollo (Vite con proxy al API). Pensado para programar en tu PC. | Python 3.12+, Node.js (npm) |

**Referencias útiles en todas las vías:** API `http://<host>:<puerto>/api/v1/`, health `GET /api/v1/health/`. Usuarios demo (contraseña `demo1234`): `admin@demo.local`, `editor@demo.local`, `viewer@demo.local` (tras `seed_demo` si aplica).

---

### A. Docker

Recomendada para **servidor o VPS**. Incluye UI y API detrás de nginx; la base de datos puede ser **SQLite** (archivo en volumen), **PostgreSQL 16** o **MySQL 8** según elijas en el asistente.

1. Clona el repositorio y entra en la raíz del proyecto.
2. Ejecuta el asistente (crea **`.env.docker`**, no lo subas a git):

   ```bash
   chmod +x scripts/docker-setup.sh scripts/docker-up.sh
   ./scripts/docker-setup.sh
   ```

3. Levanta los servicios:

   ```bash
   ./scripts/docker-up.sh
   ```

   Por debajo carga `.env.docker` y ejecuta `docker compose up -d --build` (con `--profile` si aplica a PostgreSQL/MySQL). No hace falta `docker compose --env-file`.

4. Abre la interfaz en `http://localhost:<HTTP_PORT>/` (por defecto puerto **80**). La API está en `/api/v1/` en el mismo origen.

#### Puerto visible desde fuera (host / VPS)

Lo que ves “desde fuera” de Docker es el puerto del **equipo anfitrión** (tu PC o el VPS), no el puerto interno del contenedor. En `docker-compose.yml` el servicio **nginx** declara `ports: "${HTTP_PORT:-80}:80"`: se mapea **`<HTTP_PORT> en el host` → `80` dentro del contenedor** (nginx sigue escuchando en 80 por dentro; no hace falta tocarlo).

- **Al instalar:** `docker-setup.sh` pregunta el puerto HTTP (por defecto **80**) y lo guarda en `.env.docker` como `HTTP_PORT=...`.
- **Cambiarlo después:** edita `.env.docker` (por ejemplo `HTTP_PORT=8080`) y vuelve a levantar la pila para recrear el mapeo:

  ```bash
  ./scripts/docker-up.sh
  ```

  O manualmente: `set -a && source .env.docker && set +a` y luego `docker compose up -d --build` con el `--profile` que corresponda.

Accederás entonces a `http://<IP-o-dominio>:<HTTP_PORT>/` (si usas **80**, el navegador suele omitir `:80`).

5. **Datos de demostración** (opcional):

   ```bash
   cd /opt/robolabel   # o la ruta donde clonaste el repo
   docker compose exec backend python manage.py seed_demo
   ```

**Archivos:** plantilla [`docker/env.docker.example`](docker/env.docker.example), orquestación [`docker-compose.yml`](docker-compose.yml), imágenes [`docker/Dockerfile.backend`](docker/Dockerfile.backend) y [`docker/Dockerfile.nginx`](docker/Dockerfile.nginx).

**Producción:** contraseñas fuertes, `DJANGO_SECRET_KEY` y `DJANGO_ALLOWED_HOSTS` acordes a tu dominio o IP; HTTPS delante de nginx si expones el servicio.

#### Instalar el motor Docker en Ubuntu (solo si aún no lo tienes)

Con el paquete del repositorio de Ubuntu (`docker.io`):

```bash
sudo apt update
sudo apt install -y docker.io
sudo systemctl enable --now docker
sudo docker run --rm hello-world
```

**Compose v2 (`docker compose`):** hace falta para `./scripts/docker-up.sh`. Prueba primero:

```bash
sudo apt install -y docker-compose-plugin
docker compose version
```

Si **`Unable to locate package docker-compose-plugin`** (pasa en muchas instalaciones mínimas o con solo `docker.io`), instala el **plugin manualmente** desde GitHub (compatible con el `docker` de Ubuntu):

```bash
# Ajusta la versión si quieres la última: https://github.com/docker/compose/releases
COMPOSE_VER="v2.31.0"
ARCH=$(uname -m)
case "$ARCH" in
  x86_64)  COMPOSE_ARCH="x86_64" ;;
  aarch64) COMPOSE_ARCH="aarch64" ;;
  *) echo "Arquitectura no soportada: $ARCH"; exit 1 ;;
esac
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -fsSL "https://github.com/docker/compose/releases/download/${COMPOSE_VER}/docker-compose-linux-${COMPOSE_ARCH}" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
docker compose version
```

Otra opción estable es usar el [repositorio oficial de Docker](https://docs.docker.com/engine/install/ubuntu/) (`docker-ce` + `docker-compose-plugin` desde ahí).

**Sin `sudo`** con Docker (opcional): `sudo usermod -aG docker "$USER"` y vuelve a iniciar sesión.

Tras actualizaciones del sistema pueden aparecer avisos de **nuevo kernel** (reinicia con `sudo reboot` cuando convenga) o **needrestart** para servicios con librerías antiguas.

---

### B. Script Linux

**Qué hace:** crea `backend/.venv`, instala dependencias Python, ejecuta migraciones, instala npm en `frontend/` y, con `--seed`, carga datos demo.

**Requisitos:** Git, **Python 3.12+** y **Node.js (npm)**. Si el servidor ya tiene otras apps, instala Python y Node **en paralelo** al del sistema (no sustituyas el `python3` global sin saber el impacto). Guía detallada: [Preparar Git, Python y Node en Linux (sin Docker)](#preparar-git-python-y-node-en-linux-sin-docker).

```bash
sudo mkdir -p /opt/robolabel
sudo chown "$USER:$USER" /opt/robolabel
git clone <URL_DEL_REPOSITORIO> /opt/robolabel
cd /opt/robolabel
chmod +x scripts/install-linux.sh
./scripts/install-linux.sh          # migraciones + npm
./scripts/install-linux.sh --seed   # igual + seed_demo
```

Ayuda: `./scripts/install-linux.sh --help`.

**Nota:** Por defecto el proyecto usa **SQLite** y ajustes de desarrollo. Para producción en red revisa `ALLOWED_HOSTS`, CORS, `SECRET_KEY` y servicio de estáticos/media.

---

### C. Manual

Mismos pasos que el script, ejecutados a mano: venv en `backend/`, `pip install -r requirements.txt`, `migrate`, `seed_demo` (opcional), y en `frontend/` `npm install`.

Sigue las secciones **Backend** y **Frontend** en [D. Desarrollo local](#d-desarrollo-local) (los comandos están en PowerShell; en Linux/macOS usa `source .venv/bin/activate` en lugar de `.\.venv\Scripts\activate`).

**Nota:** Configuración por defecto orientada a desarrollo local (`DEBUG`, CORS hacia Vite, SQLite). Para otro motor de base de datos, configura las variables de entorno descritas en [`docker/env.docker.example`](docker/env.docker.example) (adaptadas a tu entorno sin Docker).

---

### D. Desarrollo local

Uso típico en tu PC: dos terminales (backend + frontend). Base de datos **SQLite** en `backend/db.sqlite3`.

#### Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py seed_demo
python manage.py runserver
```

En Linux o macOS: `python3.12 -m venv .venv` y `source .venv/bin/activate`.

- API: `http://127.0.0.1:8000/api/v1/`
- Health: `GET /api/v1/health/`

#### Frontend

```powershell
cd frontend
npm install
npm run dev
```

Abre `http://localhost:5173`. El proxy de Vite reenvía `/api` y `/media` al backend en el puerto 8000.

#### Pruebas

```powershell
cd backend
python manage.py test
```

```powershell
cd frontend
npm run build
```

---

### Preparar Git, Python y Node en Linux (sin Docker)

Úsalo si sigues la **opción B** o **C** en un servidor donde quieres instalar herramientas sin romper otras aplicaciones.

**Idea:** añade Python 3.12 y Node LTS **en paralelo** al del sistema; no fuerces que todo el SO use `python3.12` como único `python3` si otros servicios dependen de la versión anterior.

#### Git

```bash
sudo apt update
sudo apt install -y git
```

#### Python 3.12

- **Ubuntu 24.04** (suele traer 3.12):

  ```bash
  sudo apt update
  sudo apt install -y python3.12 python3.12-venv python3.12-dev build-essential
  ```

- **Ubuntu 22.04** (si no hay 3.12 en `apt`): PPA [deadsnakes](https://launchpad.net/~deadsnakes/+archive/ubuntu/ppa) para instalar solo `python3.12`, `python3.12-venv`, etc., sin reemplazar el `python3` del sistema.

RoboLabel usa un **entorno virtual** (`backend/.venv`) para aislar dependencias.

#### Node.js (npm) con nvm (recomendado si ya hay otro Node en el servidor)

[nvm](https://github.com/nvm-sh/nvm) instala Node solo para tu usuario (`~/.nvm`), sin tocar `/usr/bin/node`.

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash
source ~/.bashrc
nvm install --lts
nvm use --lts
```

**systemd:** si ejecutas `node` desde un `.service`, usa la ruta absoluta al binario de nvm o define `PATH` en la unidad (systemd no carga `~/.bashrc`).

---

## Actualización del sistema

Objetivo: traer el código nuevo del repositorio, **reinstalar dependencias** si cambiaron y **aplicar migraciones de Django**. En producción conviene **hacer backup** de base de datos y `media` antes de actualizar.

### Con Docker

1. **Backup (recomendado en producción):** guía paso a paso en [Backup y Restore en Docker](docs/backup-restore-docker.md) (volúmenes `media`, SQLite, PostgreSQL o MySQL). Evita `docker compose down -v` si no quieres borrar datos.
2. **Actualizar el código** en la máquina donde está el clon (por ejemplo `/opt/robolabel`):

   ```bash
   cd /opt/robolabel   # o la ruta de tu clon
   git pull
   ```

3. **Reconstruir y levantar** la pila con la misma configuración que ya usas (`.env.docker` y perfil de Compose si aplica):

   ```bash
   ./scripts/docker-up.sh
   ```

   Ese script ejecuta `docker compose … up -d --build` cargando `.env.docker`. Al arrancar, el backend aplica migraciones en el **entrypoint** del contenedor (`migrate --noinput` en `docker/entrypoint.sh`). Los **volúmenes** (imágenes, SQLite, datos de Postgres/MySQL) se conservan salvo que los elimines explícitamente.

4. **Si el proyecto añade variables nuevas:** compara tu `.env.docker` con [`docker/env.docker.example`](docker/env.docker.example) o vuelve a ejecutar `./scripts/docker-setup.sh` y fusiona los valores (no pierdas contraseñas ni secretos).

5. **Comprobar:** `GET /api/v1/health/` y, si hace falta, `docker compose logs -f backend` (desde la raíz del repo con las variables de entorno cargadas como hace `docker-up.sh`).

### Sin Docker (Linux con `install-linux.sh`)

En la raíz del clon:

```bash
git pull
./scripts/install-linux.sh
```

El script **actualiza** dependencias Python en `backend/.venv`, ejecuta `migrate` y sincroniza dependencias del frontend con `npm ci` (o `npm install` si falla el lock). Usa `--seed` solo si quieres volver a cargar datos demo (puede **sobrescribir** datos de prueba).

### Manual o desarrollo local (B / C / D)

1. `git pull` en la raíz del repositorio.
2. **Backend:** activa el entorno virtual, instala dependencias y migra:

   ```powershell
   cd backend
   .\.venv\Scripts\activate
   pip install -r requirements.txt
   python manage.py migrate
   ```

   En Linux/macOS: `source .venv/bin/activate`.

3. **Frontend:** en `frontend/`, `npm install` (o `npm ci` si trabajas con el lock versionado y está al día).

Si sirves el frontend **compilado** fuera de Vite (por ejemplo detrás de nginx propio), tras actualizar ejecuta `npm run build` y despliega el contenido generado según tu flujo.

---

## Documentación

- [PRD](docs/PRD.md)
- [Arquitectura de pantallas](docs/arquitectura-secciones-pantallas.md)
- [Arquitectura de permisos y roles](docs/arquitectura-permisos.md)
- [Base de datos](docs/base-de-datos.md)
