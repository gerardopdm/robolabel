# Arquitectura de permisos y roles — RoboLabel

> **Versión:** 0.1 · **Fecha:** 2026-04-11 · **Estado:** borrador  
> **Referencia:** [PRD](./PRD.md) (multiempresa, §4), [base de datos](./base-de-datos.md). Este documento describe el **diseño objetivo** de roles múltiples, asignación de trabajo y validación; la implementación en código puede divergir hasta alinearse con estas decisiones.

---

## 1. Objetivos

| Objetivo | Descripción |
|----------|-------------|
| **Roles múltiples** | Cada usuario puede tener uno o varios roles simultáneamente (no es un único valor “rol”). |
| **Administrador** | Acceso a la **administración de Django** (`/admin/`) y gestión amplia de la empresa. |
| **Asignador** | Puede **cargar imágenes** y **asignarlas** a uno o varios etiquetadores; puede **crear** nuevas versiones de dataset. |
| **Etiquetador** | Solo ve y etiqueta las imágenes **asignadas** por el asignador (alcance acotado). |
| **Validador** | Puede **validar** el trabajo de etiquetadores; **solo** el validador puede marcar imágenes como **completadas** (`completed`) en el flujo de validación. |
| **Multiempresa** | Toda consulta y autorización sigue filtrando por `company` (inquilino), como en el resto del producto. |

---

## 2. Modelo de usuario: roles como booleanos

Se reemplaza el esquema de un único campo `role` (`admin` / `editor` / `viewer`) por **cuatro banderas** en el modelo `User`:

| Campo | Significado |
|-------|-------------|
| `is_administrador` | Acceso administrativo de producto y sincronización con `is_staff` para Django Admin. |
| `is_asignador` | Subida de imágenes, asignación a etiquetadores, creación de versiones de dataset (según matriz). |
| `is_etiquetador` | Etiquetado en imágenes asignadas. |
| `is_validador` | Revisión y transición a `completed` (y rechazos) en el flujo de validación. |

### 2.1 Ventajas de este enfoque

- Sin JOINs adicionales frente a tablas de roles o `ManyToMany` para consultas frecuentes.
- Combinaciones libres: `is_etiquetador=True` e `is_validador=True` en el mismo usuario.
- Compatible con SQLite, MySQL y MariaDB sin dependencias especiales.

### 2.2 Django Admin

- **`is_staff`**: debe ser `True` para usuarios que entren a `/admin/`. Se recomienda **sincronizar** `is_staff` con `is_administrador` (o establecer ambos al crear/editar usuario desde admin o API).
- **`is_superuser`**: reservado para operaciones de sistema; no confundir con “administrador de empresa”. En producción, solo superusuarios técnicos.

---

## 3. Asignación de trabajo: `GroupAssignment`

Para que el etiquetador solo vea lo que le corresponde, hace falta **materializar la asignación**. Se propone una tabla por **grupo de imágenes** (`ImageGroup`), alineado con el flujo por lotes del PRD.

### 3.1 Entidad `GroupAssignment` (nombre orientativo)

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `image_group` | FK → `ImageGroup` | Grupo al que aplica la asignación. |
| `labeler` | FK → `User` | Etiquetador asignado (debe ser usuario con `is_etiquetador=True`). |
| `assigned_by` | FK → `User`, nullable | Asignador que creó la asignación (auditoría). |
| `created_at` | DateTime | Alta de la asignación. |

**Restricción de unicidad:** `(image_group, labeler)` — no duplicar la misma pareja grupo–etiquetador.

**Regla de negocio:** las imágenes del grupo heredan la visibilidad del etiquetador a través de la fila de asignación. Si un grupo se asigna a varios etiquetadores, cada uno ve las mismas imágenes del grupo según la política de producto (p. ej. colaboración en el mismo lote).

### 3.2 Alternativa: asignación por imagen

Si en el futuro se requiere granularidad por `ProjectImage`, se puede añadir `ImageAssignment` con FK a `ProjectImage` y `labeler`, con las mismas reglas de filtrado en querysets.

---

## 4. Estados de imagen y flujo de validación

El modelo actual (`pending`, `in_progress`, `completed`) se extiende para separar **“trabajo del etiquetador”** de **“cierre por validador”**.

### 4.1 Estados propuestos (`ProjectImage.Status`)

| Estado | Código sugerido | Descripción |
|--------|------------------|-------------|
| Pendiente | `pending` | Imagen en grupo asignado; sin anotaciones o aún no iniciada. |
| En progreso | `in_progress` | El etiquetador está trabajando (hay anotaciones o edición activa). |
| En validación | `pending_validation` | El etiquetador envió la imagen a revisión; espera decisión del validador. |
| Completada | `completed` | El **validador** aprobó; imagen lista para exportación según criterios del proyecto. |
| Rechazada | `rejected` | El validador rechazó; el etiquetador debe corregir. |

### 4.2 Diagrama de transiciones (referencia)

```
pending ──▶ in_progress ──▶ pending_validation ──▶ completed
                ▲                │                    │
                │                ▼                    │
                │            rejected ────────────────┘
                │                │            (reapertura)
                └────────────────┘
```

| Transición | Actor | Notas |
|------------|--------|--------|
| `pending` → `in_progress` | Sistema / etiquetador | P. ej. al crear primera anotación. |
| `in_progress` → `pending_validation` | Etiquetador | Envío explícito a revisión (si el producto lo exige). |
| `pending_validation` → `completed` | **Validador** (o admin si se define política) | Única transición a `completed` en el flujo de validación. |
| `pending_validation` → `rejected` | Validador | Con comentario opcional. |
| `rejected` → `in_progress` | Sistema / etiquetador | Vuelve a edición. |
| `completed` → `pending_validation` | Validador | Reapertura para re-validar (opcional). |

La implementación actual del PRD (§3.6) asume que el propio usuario marca “completada” sin capa de validación; aquí se **sustituye o complementa** esa regla: **solo el validador** puede pasar a `completed` cuando el flujo de validación esté activo.

---

## 5. Trazabilidad opcional: `ValidationRecord`

Para auditoría y comentarios de rechazo:

| Campo | Descripción |
|-------|-------------|
| `image` | FK → `ProjectImage` |
| `validator` | FK → `User` |
| `decision` | p. ej. `approved` / `rejected` |
| `comment` | Texto libre; útil en rechazos. |
| `created_at` | Timestamp |

---

## 6. Permisos en Django REST Framework (DRF)

Clases de permiso orientativas (nombres pueden ajustarse al código):

| Clase | Comportamiento |
|-------|----------------|
| `IsCompanyMember` | Usuario autenticado con `company_id` (ya existente en el proyecto). |
| `IsAdministrador` | Requiere `is_administrador`. |
| `IsAsignador` | Requiere `is_asignador`. |
| `IsEtiquetador` | Requiere `is_etiquetador`. |
| `IsValidador` | Requiere `is_validador`. |
| `IsAsignadorOrAdministrador` | `is_asignador` **o** `is_administrador` (subidas, asignaciones, versiones de dataset según matriz). |

Los métodos HTTP seguros (`GET`, `HEAD`, `OPTIONS`) pueden combinarse con reglas distintas a las de escritura (`POST`, `PUT`, `PATCH`, `DELETE`) según acción.

---

## 7. Matriz de permisos por tipo de operación

| Operación | Administrador | Asignador | Etiquetador | Validador |
|-----------|:-------------:|:---------:|:-----------:|:---------:|
| **Django Admin** (`/admin/`) | Sí | No | No | No |
| **CRUD proyectos** (completo) | Sí | Lectura / limitado | Lectura | Lectura |
| **Subir imágenes** | Sí | Sí | No | No |
| **Asignar grupos/imágenes a etiquetadores** | Sí | Sí | No | No |
| **Ver todas las imágenes del proyecto** | Sí | Sí | No | Sí |
| **Ver solo imágenes asignadas** | — | — | Sí | — |
| **Crear/editar anotaciones** | Sí | No | Sí (solo asignadas) | No |
| **Enviar a validación** (`→ pending_validation`) | — | — | Sí | — |
| **Aprobar / rechazar** (`→ completed` / `rejected`) | Política | — | — | Sí |
| **Crear versiones de dataset** | Sí | Sí | No | No |
| **Listar / descargar exportaciones y ZIP** | Sí | Sí | Según política | Sí |

Las celdas “Según política” deben cerrarse en el PRD o en tickets (p. ej. si el etiquetador puede descargar export de sus imágenes completadas).

---

## 8. Filtrado de querysets (etiquetador)

**Vista global** (todos los grupos e imágenes del proyecto en la empresa): `is_administrador`, `is_asignador`, o `is_validador` **sin** `is_etiquetador` (validador que no etiqueta ve todo el proyecto para validar).

**Vista por asignación:** si el usuario tiene `is_etiquetador=True` y **no** es administrador ni asignador, los listados de proyectos, grupos e imágenes se restringen a filas con `GroupAssignment` para `labeler=request.user`. Esto aplica también a **etiquetador + validador**: no recibe vista global solo por ser validador; solo ve los grupos donde está asignado (cada etiquetador solo sus grupos).

Ejemplo lógico:

```python
qs = ProjectImage.objects.filter(
    group__project=project,
    group__project__company=user.company,
    deleted_at__isnull=True,
)
global_view = user.is_administrador or user.is_asignador or (
    user.is_validador and not user.is_etiquetador
)
if user.is_etiquetador and not global_view:
    qs = qs.filter(group__assignments__labeler=user)
```

---

## 9. Migración desde roles legacy (`admin` / `editor` / `viewer`)

Tabla orientativa para datos existentes (ajustar en migración real):

| `role` actual | Mapeo sugerido a booleanos |
|---------------|----------------------------|
| `admin` | `is_administrador=True`, `is_asignador=True` (y `is_staff=True`) |
| `editor` | `is_asignador=True`, `is_etiquetador=True` |
| `viewer` | `is_validador=True` |

Tras la migración, el campo `role` único puede eliminarse del modelo.

---

## 10. Relación con exportación y versiones de dataset

- Las reglas de [base de datos](./base-de-datos.md) sobre `dataset_version` y `dataset_version_image` se mantienen.
- Solo usuarios con permiso de **crear versión** (asignador y/o administrador, según matriz) deben poder `POST` en el endpoint de versiones.
- Las imágenes incluidas en un ZIP deben respetar el estado mínimo acordado (p. ej. solo `completed`); si el flujo exige validación, `completed` solo es alcanzable por el validador.

---

## 11. Documentos relacionados

| Documento | Ubicación |
|-----------|-----------|
| PRD | [`PRD.md`](./PRD.md) |
| Base de datos | [`base-de-datos.md`](./base-de-datos.md) |
| Arquitectura de pantallas | [`arquitectura-secciones-pantallas.md`](./arquitectura-secciones-pantallas.md) |

---

*Documento vivo: actualizar al implementar modelos, migraciones y permisos en `backend/`.*
