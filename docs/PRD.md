# PRD — RoboLabel

> **Versión:** 0.7 · **Fecha:** 2026-04-11 · **Estado:** borrador activo

## 1. Resumen ejecutivo

**RoboLabel** es una aplicación web para **gestionar proyectos de visión por computadora**, **organizar imágenes en grupos** (similar al flujo de trabajo de Roboflow) y **etiquetar objetos con bounding boxes** para modelos de **detección de objetos**. Cada lote subido **permanece siempre en el grupo en el que se cargó**; la aplicación ofrece una **vista de trabajo por grupos** para ir etiquetando lotes y **integrando progresivamente** las imágenes listas al **dataset exportable** del proyecto (mismas clases y proyecto). Los equipos pueden **crear y conservar varias versiones del dataset** por proyecto (instantáneas con nombre, criterios e inclusiones materializadas) para **entrenar, comparar y reproducir** exportaciones sin perder el histórico. El producto es **multiempresa** (aislamiento de datos por organización) y **multiusuario** (roles y permisos dentro de cada empresa).

**Stack acordado:** frontend en **React** (+ TypeScript); backend en **Python / Django** (Django REST Framework); base de datos **SQLite** en desarrollo e inicio de producción, con **migración prevista** a **MySQL** o **MariaDB** sin rediseño funcional.

**Documentos relacionados:**

| Documento | Ubicación |
|-----------|-----------|
| Arquitectura de secciones y pantallas | [`docs/arquitectura-secciones-pantallas.md`](./arquitectura-secciones-pantallas.md) |
| Base de datos (ER y diccionario de datos; incluye `dataset_version`) | [`docs/base-de-datos.md`](./base-de-datos.md) |
| Prototipo — galería de imágenes | [`docs/ejemplos/frontend/ejemplo-galeria-imagenes-etiquetado.html`](./ejemplos/frontend/ejemplo-galeria-imagenes-etiquetado.html) |
| Prototipo — lienzo de etiquetado | [`docs/ejemplos/frontend/ejemplo-ui-etiquetado.html`](./ejemplos/frontend/ejemplo-ui-etiquetado.html) |

---

## 2. Objetivos del producto

| ID | Objetivo | Secciones relacionadas |
|----|----------|------------------------|
| O1 | Permitir crear y administrar proyectos de etiquetado por empresa. | §3.1 |
| O2 | Agrupar imágenes en "grupos" (batches / sets) para organización y flujo de trabajo; **pertenencia estable** de cada imagen a su grupo de subida. | §3.2, §3.2.1 |
| O3 | Distinguir visualmente imágenes ya etiquetadas vs. pendientes dentro de cada grupo. | §3.3 |
| O4 | Ofrecer un lienzo de etiquetado con rectángulos, clases editables y CRUD de anotaciones. | §3.4, §3.5 |
| O5 | Garantizar aislamiento multiempresa y colaboración multiusuario de forma segura y auditable. | §4 |
| O6 | Permitir exportar el dataset etiquetado de un proyecto para entrenamiento **YOLOv8** en un **archivo ZIP** descargable; **inclusión incremental** según imágenes completadas y, en implementación, **filtro por grupo(s)**; opcionalmente **aumento de datos** seleccionable en la exportación para enriquecer el conjunto de entrenamiento. | §3.8 |
| O7 | Mantener **varias versiones del dataset** por proyecto (metadatos, conjunto de imágenes congelado al crear la versión, descarga ZIP por versión y listado histórico). | §3.9 |

### 2.1 Criterios de éxito (MVP)

| Métrica | Umbral mínimo | Forma de medición |
|---------|---------------|-------------------|
| Tiempo medio de etiquetado por imagen | ≤ 60 s para imagen con ≤ 5 objetos | Cronometría en sesiones de prueba con usuarios reales |
| Errores de clase | < 5 % de rectángulos con clase incorrecta tras revisión | Auditoría manual sobre muestra representativa |
| Aislamiento multiempresa | 0 fugas de datos entre empresas | Pruebas automatizadas de seguridad (API + BD) |
| Compatibilidad BD | Mismas migraciones pasan en SQLite y MySQL/MariaDB | CI con matrices de prueba sobre ambos motores |
| Exportación YOLOv8 | ZIP descargable que abre en Ultralytics sin pasos manuales de conversión | Prueba con `yolo train` sobre el ZIP generado (dataset mínimo de smoke) |
| Versiones de dataset | Al menos dos versiones del mismo proyecto con conjuntos de imágenes distintos o el mismo con nombre distinto; listado y descarga por versión | Pruebas de API + UI: crear versión → exportar ZIP → listar versiones |

---

## 3. Alcance funcional

### 3.1 Creación de proyectos

- Un **proyecto** pertenece a una **empresa** y agrupa imágenes, grupos, clases y anotaciones.
- Campos mínimos: nombre (obligatorio), descripción (opcional), tipo de tarea (en v1: **detección de objetos**), fechas de creación/actualización (automáticas), usuario creador.
- Operaciones: crear, listar, abrir (detalle), editar metadatos básicos, archivar o eliminar.
- **Política de borrado:** soft delete (campo `deleted_at`); el proyecto y sus datos asociados se ocultan en la UI pero permanecen en BD hasta purga programada o manual.

### 3.2 Carga y gestión de imágenes por grupo

- Las imágenes se organizan en **grupos** dentro de un proyecto (análogo a "batches" o conjuntos en Roboflow).
- El usuario puede **crear grupos**, **asignar un nombre** al grupo y **subir un lote de archivos**.
  - Formatos aceptados: JPEG, PNG.
  - Límites configurables por backend: tamaño máximo por archivo (sugerido: 10 MB), cantidad máxima por subida (sugerido: 100).
- Operaciones por grupo: renombrar, listar imágenes, eliminar imágenes individuales o el grupo completo (con confirmación).
- Las imágenes se almacenan como **ficheros en disco** (ruta local en v1, compatible con S3 en evolución futura) y se referencian en BD con ruta relativa estable.

**Pertenencia al grupo (regla de negocio v1):**

- Toda imagen queda **asociada de forma permanente al grupo en el que se subió**. No existe en v1 la operación de **mover** una imagen a otro grupo del mismo proyecto; el identificador de grupo es **inmutable** tras la creación del registro (salvo eliminación del registro o del grupo según política de borrado).
- Las subidas adicionales al **mismo** grupo añaden más imágenes a ese grupo; no alteran la pertenencia de las imágenes ya existentes.
- Esta regla simplifica trazabilidad del lote, exportación por subconjuntos (por grupo) y permisos consistentes en API.

### 3.2.1 Etiquetado por grupos e integración al dataset del proyecto

- El **listado de grupos** y el **detalle de cada grupo** constituyen la **sección principal para trabajar por lotes**: el usuario elige un grupo, ve el progreso (imágenes etiquetadas vs. pendientes) y entra al flujo de etiquetado **sin perder el contexto del grupo** (rutas y breadcrumb incluyen siempre proyecto y grupo).
- **Dataset del proyecto (vista lógica):** es el conjunto de imágenes del proyecto que cumplen los criterios de exportación (típicamente estado `completed` y anotaciones coherentes con las clases del proyecto). Las imágenes **no** “cambian de dataset”: al marcar una imagen como completada en cualquier grupo, **pasa a contar** para el agregado del proyecto y puede **incluirse en el ZIP YOLOv8** cuando el usuario exporte.
- **Integración progresiva:** los equipos pueden ir **cerrando lotes** (grupos) dejando imágenes en `completed`; el hub del proyecto y los indicadores por grupo reflejan cuánto del volumen total ya es **exportable**. No es necesario terminar todos los grupos para exportar: la exportación opera sobre el **proyecto** con filtros (ver §3.8).
- **Coherencia:** todas las clases y anotaciones pertenecen al **mismo proyecto**; etiquetar en el grupo A o en el grupo B alimenta el **mismo** espacio de clases y el mismo archivo `data.yaml` en exportación.

### 3.2.2 Relación con la exportación (visión resumida)

- La exportación YOLOv8 (§3.8) **agrega** imágenes elegibles del proyecto; en implementación se debe permitir **restringir por uno o varios grupos** además de por estado (`completed`), para descargar solo el lote ya revisado o ir incorporando grupos al flujo de entrenamiento de forma ordenada.

### 3.3 Visualización en grupo: etiquetadas vs. no etiquetadas

- Vista de un **grupo seleccionado** con **pestañas o filtros**:
  - **Etiquetadas:** imágenes en estado `completed` (ver §3.6).
  - **No etiquetadas / pendientes:** imágenes en estado `pending` o `in_progress`.
- Indicadores visuales: miniaturas (aspecto 4:3), contador por pestaña, badge de estado.
- Filtros opcionales (mejora): por nombre de archivo, fecha de carga, usuario asignado.

### 3.4 Selección de imagen para editar o iniciar etiquetado

- Desde la vista de grupo, el usuario **elige una imagen** para:
  - **Iniciar** el flujo si no tiene anotaciones (estado `pending`).
  - **Continuar o editar** si ya existen anotaciones (estado `in_progress` o `completed`).
- Navegación: anterior / siguiente imagen dentro del mismo grupo sin salir del flujo de etiquetado.

### 3.5 Pantalla de etiquetado (detección de objetos)

- **Lienzo** sobre la imagen con zoom (rueda del ratón) y pan (Shift + arrastrar o botón central).
- **Herramienta de rectángulo (bounding box):** dibujar arrastrando, redimensionar con handles, mover arrastrando la caja.
- **Edición y eliminación** de cada rectángulo existente (tecla Delete / Backspace o botón en el panel lateral).
- **Asignación de clase** a cada rectángulo mediante selector; debe permitir **crear una nueva clase** en contexto (nombre único dentro del proyecto).
- Panel lateral de **objetos detectados** en la imagen actual: seleccionar, cambiar clase, eliminar.
- **Atajos de teclado** deseables (no bloqueantes en MVP): guardar (`Ctrl+S`), siguiente imagen (`→`), herramienta rectángulo (`R`), deshacer (`Ctrl+Z`).
- **Persistencia:** guardado explícito con botón + indicador de estado (guardado / sin guardar). Manejo de conflictos: **último guardado gana** (documentar en UI con timestamp de última modificación visible).

### 3.6 Estados de una imagen

Una imagen dentro de un grupo transita por los siguientes estados:

```
pending ──▶ in_progress ──▶ completed
                 ▲               │
                 └───────────────┘
                  (reapertura)
```

| Estado | Criterio |
|--------|----------|
| `pending` | Imagen recién subida, sin anotaciones. |
| `in_progress` | Al menos una anotación creada pero el usuario no ha marcado como lista. |
| `completed` | El usuario confirma que la imagen está completamente etiquetada. |

La transición `completed → in_progress` ocurre si el usuario edita una imagen previamente marcada como completa.

### 3.7 Formato de coordenadas de anotaciones

Cada anotación almacena las coordenadas del bounding box en **píxeles absolutos** respecto a la imagen original:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `x` | float | Coordenada X de la esquina superior izquierda |
| `y` | float | Coordenada Y de la esquina superior izquierda |
| `width` | float | Ancho del rectángulo |
| `height` | float | Alto del rectángulo |

La conversión a **coordenadas normalizadas** (centro y tamaño en fracción de ancho/alto de imagen) para el formato YOLO se realiza en la **capa de exportación** (§3.8). Otras exportaciones (p. ej. COCO) pueden añadirse en fases posteriores.

### 3.8 Exportación para YOLOv8 (ZIP)

El producto debe permitir **exportar** las imágenes etiquetadas de un **proyecto** (o subconjunto acotado por filtros definidos en implementación: p. ej. solo imágenes `completed`, **solo imágenes pertenecientes a uno o varios grupos seleccionados**, o todo el proyecto) en un **único archivo ZIP** listo para entrenar modelos de detección con **Ultralytics YOLOv8**.

Los filtros por **grupo** respetan la regla de §3.2: solo se incluyen imágenes que **pertenecen** a los grupos elegidos; no se mezcla la pertenencia de archivos entre grupos.

**Contenido mínimo del ZIP (convención compatible con YOLOv8 / Ultralytics):**

- **Imágenes:** copias de los ficheros originales (JPEG/PNG) en la estructura de carpetas esperada por el dataset YOLO (p. ej. `images/train` y, si aplica, `images/val` según el reparto elegido).
- **Etiquetas:** un archivo `.txt` por imagen en `labels/train` (y `labels/val` si aplica), con **una línea por bounding box**: `class_id x_center y_center width height`, valores **normalizados** en \[0, 1\] respecto al ancho y alto de la imagen, índices de clase coherentes con el `data.yaml`.
- **Metadatos del dataset:** archivo `data.yaml` en la raíz del ZIP con al menos: ruta o rutas a `train`/`val`, número de clases (`nc`) y lista ordenada de nombres de clase (`names`) alineada con los `class_id` de las etiquetas.

**Comportamiento y restricciones:**

- Además del export **puntual**, el producto admite **versiones de dataset** con ZIP asociado y listado histórico (§3.9); la descarga puede ser por **versión** o por export inmediato con filtros.
- La exportación debe ser **descargable desde la interfaz** (p. ej. acción en el hub del proyecto o en ajustes del proyecto) y/o vía **endpoint de API** autenticado; solo usuarios con permiso de lectura o superior sobre el proyecto pueden exportar (según rol en §4.2).
- Proyectos sin imágenes etiquetadas o sin anotaciones deben mostrar un mensaje claro o generar un ZIP vacío según decisión de UX (preferible: bloquear con mensaje explicativo).
- Para proyectos grandes, la generación del ZIP puede ser **asíncrona** (tarea en cola + enlace de descarga cuando esté listo); el límite de tamaño y tiempo máximo se documentará en el diseño técnico.

**Referencia de implementación:** [documentación Ultralytics — datasets](https://docs.ultralytics.com/datasets/) (estructura YOLO; validar contra la versión concreta de `ultralytics` usada en el proyecto de entrenamiento).

#### Aumento de datos en la exportación (opcional)

Además de las imágenes y etiquetas **originales** elegibles por filtros, la exportación puede **generar variantes aumentadas** para ampliar el dataset de entrenamiento sin modificar las anotaciones en la base de datos (solo en el ZIP generado).

- **Interfaz:** antes de generar el ZIP, el usuario puede activar uno o más **tipos de aumento** (p. ej. casillas o multiselect) y, donde aplique, parámetros simples (p. ej. rango de ángulo o intensidad) con valores por defecto sensatos.
- **Criterio de coherencia:** toda transformación **geométrica** (volteo, rotación, recorte escalado, etc.) debe aplicarse de forma conjunta a **imagen y bounding boxes**, recalculando las coordenadas en píxeles y volviendo a **normalizar** a formato YOLO en el archivo `.txt` correspondiente. Las transformaciones **fotométricas** (brillo, contraste, saturación, ruido, desenfoque leve, etc.) **no** alteran la geometría de las cajas; solo cambian los píxeles.
- **Nomenclatura en el ZIP:** cada par (imagen original, etiqueta) puede duplicarse como nuevos ficheros con sufijos o prefijos estables (p. ej. `img_001_aug_flip_h.jpg` / `img_001_aug_flip_h.txt`) para evitar colisiones y facilitar trazabilidad.
- **Alcance sugerido por tipo (implementación):**
  - **Geométricas:** volteo horizontal; volteo vertical (opcional según dominio); rotación en pequeño ángulo con recorte o padding para mantener dimensiones compatibles con YOLO.
  - **Fotométricas:** ajuste de brillo/contraste; variación HSV ligera; ruido gaussiano leve; desenfoque gaussiano leve.
- **Rendimiento:** los aumentos multiplican el tiempo de CPU y el tamaño del ZIP; conviene documentar límites (p. ej. máximo de variantes por imagen o tamaño total) y reforzar la exportación **asíncrona** cuando el volumen sea alto.
- **Por defecto:** si el usuario no selecciona ningún aumento, el comportamiento es idéntico al de un export **solo con originales** (sin variantes sintéticas).

### 3.9 Versiones del dataset del proyecto

El producto debe permitir **definir, listar y exportar múltiples versiones del dataset** dentro de un mismo **proyecto**, de modo que equipos de ML y etiquetado puedan **fijar hitos** (p. ej. “v1 baseline”, “abril-2026-revisado”) sin sobrescribir el trabajo previo.

**Concepto:**

- Una **versión de dataset** (`dataset_version`) es un **registro** asociado al proyecto con **nombre** (o etiqueta) obligatorio, **fecha de creación**, **autor**, notas opcionales y un **conjunto de imágenes materializado** en el momento de creación (qué `project_image` entran en esa versión según los filtros elegidos).
- Las versiones son **inmutables en su lista de inclusiones**: una vez creada la versión, el conjunto de IDs de imagen incluidos **no cambia** (aunque el usuario siga editando anotaciones en el lienzo sobre esas mismas imágenes u otras).
- El **etiquetado en vivo** (anotaciones en BD) puede seguir evolucionando; la **exportación ZIP asociada a una versión** debe especificar en documentación de producto si usa las **anotaciones vigentes** al momento del **descarga** o las del momento de **creación de la versión** — en MVP se recomienda **generar y almacenar el artefacto ZIP** al crear la versión (o al pulsar “Generar ZIP”) para **reproducibilidad**; alternativa documentada: re-generar desde anotaciones actuales solo para imágenes incluidas en la versión (menos estricto).

**Operaciones:**

- **Crear versión:** desde el hub del proyecto o la pantalla de versiones, el usuario define filtros equivalentes a los del export (p. ej. solo `completed`, uno o varios grupos, opciones de aumento si aplica) y confirma; el sistema **resuelve** la lista de imágenes elegibles, **persiste** la membresía en la versión y puede **disparar** la generación asíncrona del ZIP.
- **Listar versiones:** tabla o lista con nombre, fecha, recuento de imágenes, tamaño aproximado o estado del artefacto (pendiente / listo / error).
- **Descargar:** enlace a `GET` del ZIP de una versión concreta (o job asíncrono igual que §3.8).
- **Eliminar (opcional):** soft delete de la versión y limpieza del fichero generado según política de retención.

**Relación con §3.2.1 y §3.8:**

- La **vista lógica** “dataset del proyecto” sigue siendo el agregado de imágenes listas para exportar; las **versiones** son **cortes** nombrados sobre ese espacio, no sustituyen al proyecto ni mueven imágenes entre grupos.
- Un export “rápido” sin crear versión sigue siendo válido; **crear versión** añade trazabilidad y descargas repetibles.

**Fuera de alcance en v1 (explícito):** historial de cambios **por anotación** (diff fino) sigue fuera; las versiones de dataset son a nivel de **conjunto incluido** y artefacto exportado, no un VCS de cajas.

---

## 4. Multiempresa y multiusuario

### 4.1 Multiempresa

- Cada **empresa** es un **inquilino (tenant)** con datos lógicamente aislados: proyectos, usuarios de esa empresa, imágenes y anotaciones.
- En **v1**, un usuario pertenece a **una sola empresa** (simplifica modelo y UI). Soporte multi-empresa por usuario se evalúa en v1.1.
- Autenticación y autorización deben **filtrar siempre por empresa** en API y consultas (defensa en profundidad): todo queryset de Django incluye `.filter(company=request.user.company)`.

### 4.2 Multiusuario

- **Roles (MVP):**

| Rol | Permisos |
|-----|----------|
| **Administrador** | Todo: proyectos, grupos, imágenes, clases, anotaciones, usuarios. |
| **Editor** | Crear/editar proyectos y grupos, subir imágenes, crear clases, CRUD de anotaciones, **exportar ZIP YOLOv8**, **crear y descargar versiones de dataset**. |
| **Visualizador** | Solo lectura: ver proyectos, grupos, imágenes y anotaciones; **exportar ZIP YOLOv8**, **listar y descargar versiones de dataset** (sin crear versiones nuevas si se define así en implementación; por defecto mismo criterio que export). |

- **Trazabilidad:** campos `created_by` y `updated_by` en modelos de proyecto, imagen y anotación. Log de auditoría detallado se pospone a v1.1.

---

## 5. Requisitos no funcionales

### 5.1 Frontend

- **React** (con TypeScript) como framework principal.
- Interfaz **responsive** razonable (prioridad en escritorio para etiquetado, mínimo 1280 px de ancho).
- Accesibilidad: contraste AA en textos y formularios; el lienzo de canvas puede tener limitaciones pero debe ser operable con teclado donde sea viable.
- **Diseño visual de las pantallas:** debe aplicarse la skill de agente en `.agent/skills/design_system` como referencia normativa de tokens, componentes y patrones de UI (coherente con el stack siguiente).
- Design system basado en **Tailwind CSS** con paleta slate/sky (ver prototipos en `docs/ejemplos/`).

### 5.2 Backend

- **Python / Django** con **Django REST Framework** (API REST JSON).
- **Autenticación:** JWT (access + refresh tokens); HTTPS obligatorio en despliegue.
- **Validación** de pertenencia empresa → proyecto → grupo → imagen → anotación en cada endpoint.
- **Sin reasignación de grupo:** endpoints de actualización de imagen **no** deben permitir cambiar `group_id` (coherente con §3.2).
- Estructura de URLs de la API: `/api/v1/projects/`, `/api/v1/projects/{id}/groups/`, `/api/v1/projects/{id}/dataset-versions/`, etc.

### 5.3 Base de datos

- **SQLite** como motor por defecto en desarrollo y despliegues pequeños.
- El esquema y el uso de Django deben ser **compatibles con MySQL y MariaDB**: evitar `JSONField` sin fallback, usar `CharField(max_length=...)` en vez de `TextField` para campos indexados, no usar funciones específicas de SQLite.
- Estrategia: **mismas migraciones** para los tres motores; pruebas de migración documentadas antes de producción en MySQL/MariaDB.

### 5.4 Rendimiento y límites

| Parámetro | Valor sugerido |
|-----------|---------------|
| Paginación por defecto | 25 elementos por página |
| Tamaño máximo de archivo | 10 MB |
| Imágenes por subida | 100 máximo |
| Tiempo de respuesta (lectura, P95) | ≤ 500 ms bajo carga moderada (50 usuarios concurrentes) |
| Tiempo de respuesta (escritura, P95) | ≤ 1 000 ms bajo carga moderada |
| Generación de export ZIP (P95, proyectos de hasta 500 imágenes) | ≤ 120 s en servidor de referencia (definir en diseño técnico) |

### 5.5 Seguridad

- Aislamiento estricto multiempresa en cada capa (ORM, API, almacenamiento).
- Sanitización de nombres de archivo y validación de tipos MIME en subida.
- Protección CSRF en formularios web; CORS configurado exclusivamente para el origen del frontend.
- Rate limiting sugerido en endpoints de subida y autenticación.
- Contraseñas hasheadas con el backend por defecto de Django (PBKDF2).

---

## 6. Fuera de alcance (v1 explícito)

- Entrenamiento o despliegue de modelos ML en la plataforma (el usuario entrena YOLOv8 **fuera** de RoboLabel con el ZIP exportado).
- Segmentación, clasificación pura o keypoints (solo detección por rectángulos en v1).
- **Importación** de datasets externos en formatos COCO/YOLO (planificable para una fase posterior; la **exportación YOLOv8 en ZIP** sí está en alcance, §3.8).
- Exportación a formatos distintos de **YOLOv8 ZIP** (p. ej. COCO JSON) salvo que se incorporen explícitamente en el roadmap.
- Aplicación móvil nativa.
- Pre-etiquetado asistido por IA.
- Versionado de anotaciones (historial de cambios por anotación).

---

## 7. Dependencias y supuestos

- Los usuarios disponen de navegador moderno en escritorio (Chrome, Firefox, Edge; últimas dos versiones).
- El almacenamiento de ficheros es **local en v1**; la ruta relativa de las imágenes debe ser estable para el frontend.
- En v1, un usuario pertenece a exactamente una empresa.
- La definición exacta de "imagen completamente etiquetada" se basa en el estado `completed` definido en §3.6.

---

## 8. Roadmap sugerido

| Fase | Contenido | Entregable clave |
|------|-----------|-----------------|
| **MVP** | Auth (JWT), empresas, proyectos, **grupos con pertenencia fija de imágenes**, sección de trabajo por grupos (progreso por lote), subida de imágenes, vista etiquetadas/pendientes, lienzo de rectángulos + clases, estados de imagen, **export ZIP dataset YOLOv8** (filtros por estado y, en implementación, por grupo), **versiones de dataset** (crear, listar, descargar por versión), SQLite. | Aplicación desplegable con etiquetado por lotes, **histórico de versiones de dataset** e **integración incremental** al exportable, con **descarga ZIP lista para `yolo train`**. |
| **v1.1** | Roles finos con permisos granulares, auditoría ampliada, **export COCO** (u otros formatos), filtros avanzados, optimización de almacenamiento (thumbnails). | Exportaciones adicionales, log de auditoría visible. |
| **v1.2** | Migración documentada a MySQL/MariaDB, CI multi-motor, mejoras de rendimiento bajo carga. | Despliegue productivo con MySQL/MariaDB. |
| **v2.0** (exploratorio) | Multi-empresa por usuario, pre-etiquetado con modelos ML, segmentación, API pública. | Evaluación según demanda. |

---

## 9. Métricas de producto

| Métrica | Propósito |
|---------|-----------|
| Proyectos activos por empresa | Adopción y uso recurrente |
| Imágenes etiquetadas por semana | Velocidad de producción de datos |
| Tiempo medio en pantalla de etiquetado por imagen | Eficiencia del flujo de trabajo |
| % de imágenes en estado `completed` vs `pending` | Progreso del etiquetado por proyecto |
| % de imágenes completadas por grupo / grupos con 100 % completadas | Avance por lote e integración al dataset exportable |
| Errores de clase reportados | Calidad de las anotaciones |
| Versiones de dataset creadas por proyecto / descargas por versión | Adopción de cortes congelados y trazabilidad hacia entrenamiento |

---

## 10. Glosario

| Término | Significado |
|---------|-------------|
| **Empresa / Tenant** | Organización cuyos datos están aislados del resto. |
| **Proyecto** | Contenedor principal que agrupa grupos, clases y anotaciones para una tarea de etiquetado. |
| **Grupo** | Conjunto de imágenes dentro de un proyecto, utilizado para organización y flujo de trabajo por lotes. |
| **Pertenencia al grupo** | Relación fija entre una imagen y el grupo en el que se registró la subida; en v1 no se reasigna a otro grupo. |
| **Dataset del proyecto (vista lógica)** | Conjunto de imágenes (y anotaciones) del proyecto elegibles para exportación; suele alinearse con imágenes en estado `completed` y filtros aplicados (p. ej. por grupo). |
| **Versión de dataset** | Registro nombrado por proyecto que **materializa** un conjunto de imágenes incluidas en un instante (lista fija) y permite **listar y descargar** un ZIP YOLOv8 asociado sin perder versiones anteriores (ver §3.9). |
| **Imagen** | Archivo de imagen (JPEG/PNG) subido a un grupo, con un estado de etiquetado asociado. |
| **Clase** | Categoría de objeto (p. ej. "persona", "coche") que se asigna a un rectángulo. |
| **Anotación** | Bounding box (x, y, width, height) + clase + metadatos sobre una imagen. |
| **Bounding box** | Rectángulo alineado a los ejes que delimita un objeto en la imagen. |
| **Soft delete** | Borrado lógico: el registro se marca como eliminado pero permanece en BD. |
| **Export YOLOv8 (ZIP)** | Archivo comprimido con imágenes, etiquetas `.txt` en formato YOLO y `data.yaml` para entrenar con Ultralytics YOLOv8. |

---

*Documento vivo: actualizar conforme se tomen decisiones de implementación.*
