# RoboLabel

Aplicación web para gestionar proyectos de visión por computadora: grupos de imágenes, etiquetado con bounding boxes y exportación **YOLOv8** (ZIP), con **versiones de dataset** y soporte **multiempresa** (JWT).

**Esta versión** incluye **roles y permisos** para el flujo de trabajo: **etiquetado** (alcance por asignación de grupos) y **validación** (revisión y cierre de imágenes), además de administración y asignación de lotes. Detalle en [Arquitectura de permisos](docs/arquitectura-permisos.md).

## Stack

- **Backend:** Python 3.12+, Django 5, Django REST Framework, SimpleJWT, SQLite (dev)
- **Frontend:** React 19, TypeScript, Vite 8, Tailwind CSS 4, React Router 7

## Desarrollo local

### Backend

```powershell
cd backend
python -m venv .venv   # opcional; el proyecto puede usar %USERPROFILE%\.venvs\robolabel
.\.venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py seed_demo
python manage.py runserver
```

- API: `http://127.0.0.1:8000/api/v1/`
- Health: `GET /api/v1/health/`
- Usuarios demo (contraseña `demo1234`): `admin@demo.local` (administrador), `editor@demo.local` (asignador + etiquetador), `viewer@demo.local` (validador)

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

Abre `http://localhost:5173`. El proxy de Vite reenvía `/api` y `/media` al backend en el puerto 8000.

### Pruebas

```powershell
cd backend
python manage.py test
```

```powershell
cd frontend
npm run build
```

## Documentación

- [PRD](docs/PRD.md)
- [Arquitectura de pantallas](docs/arquitectura-secciones-pantallas.md)
- [Arquitectura de permisos y roles](docs/arquitectura-permisos.md)
- [Base de datos](docs/base-de-datos.md)
