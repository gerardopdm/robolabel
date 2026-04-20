# Docker en Ubuntu — DNS en la red bridge y despliegue de RoboLabel

> **Versión:** 1.0 · **Fecha:** 2026-04-13 · **Estado:** referencia operativa  
> **Contexto:** droplets Ubuntu (p. ej. DigitalOcean) con Docker Engine y Docker Compose v2.  
> **Relacionado:** `docker-compose.yml` (build con `network: host`), `scripts/docker-diagnose.sh`.

---

## 1. Síntoma

Durante `docker build` o `docker compose build`, los pasos que ejecutan `apt-get` o `npm` fallan con mensajes como:

- `Temporary failure resolving 'deb.debian.org'`
- `Unable to locate package ...` (consecuencia de que `apt-get update` no descargó los índices)

En el **host**, `ping` y resolución de nombres suelen funcionar; el fallo aparece **dentro de contenedores** que usan la red por defecto (**bridge**), no la red del host.

---

## 2. Diagnóstico resumido

Lo relevante no es el Dockerfile en sí, sino **dónde** se resuelven los nombres:

| Comprobación | Resultado típico en este escenario |
|--------------|-------------------------------------|
| Host: `getent hosts deb.debian.org`, `ping deb.debian.org` | OK |
| Contenedor con `--network host`: `getent` + `apt-get update` | OK |
| Contenedor **sin** `--network host` (red bridge), incluso con `--dns 1.1.1.1` o `--dns 8.8.8.8` | Fallo de resolución (`getent` vacío o errores en `apt`) |

**Conclusión:** el sistema de resolución del **host** está bien; **la red bridge de Docker** en ese servidor no permite que los contenedores resuelvan nombres de forma fiable (suele apuntar a reglas de firewall, NAT/iptables o política de red).

Forzar `8.8.8.8` / `1.1.1.1` solo en `/etc/docker/daemon.json` **no corrige** el caso en que el propio camino desde el bridge hacia cualquier resolver esté roto.

---

## 3. Solución temporal (despliegue y builds)

Objetivo: que los pasos de build que necesitan salir a Internet usen la **misma pila de red que el host**, donde ya comprobaste que DNS y HTTP funcionan.

En este repositorio, el `build` de los servicios que ejecutan `apt` o `npm` incluye **`network: host`** en `docker-compose.yml` (backend y nginx). Eso hace que el proceso de construcción use la red del host durante esas capas.

Tras actualizar el código en el servidor:

```bash
cd /opt/robolabel
git pull
docker compose build --no-cache backend nginx
./scripts/docker-up.sh
```

**Nota:** `network: host` en el build aplica de forma fiable en **Linux**. En Docker Desktop (Windows/macOS) el comportamiento puede diferir; el escenario documentado aquí es **servidor Ubuntu**.

---

## 4. Recomendado a medio plazo

1. **Corregir la red bridge de Docker en el servidor** para que los contenedores en red por defecto puedan resolver nombres sin depender de `host` en el build.  
   Revisar habitualmente:
   - reglas `iptables` / `nftables` y cadena NAT asociada a `docker0`;
   - UFW u otro firewall que pueda bloquear tráfico DNS (UDP/TCP 53) desde la subred de contenedores;
   - políticas de red del proveedor (menos frecuente, pero posible en entornos restringidos).

2. Tras cambiar reglas o firewall, reiniciar Docker si hace falta:

   ```bash
   sudo systemctl restart docker
   ```

3. **`/etc/docker/daemon.json`:** usar `"dns"` solo si sabes qué resolvers son alcanzables **desde el bridge** en tu red. Los DNS del proveedor visibles en el host no garantizan el mismo comportamiento desde contenedores si el problema es el camino de red, no la IP del resolver.

4. Mantener **`scripts/docker-diagnose.sh`** como ayuda para comparar host vs contenedor y dejar constancia en logs (`/tmp/robolabel-docker-diagnose-*.log`).

---

## 5. Cómo comprobar conectividad y DNS

Ejecutar en el **servidor** (no hace falta estar en el directorio del repo salvo que uses Compose).

### 5.1 Host

```bash
getent hosts deb.debian.org
ping -c 2 -W 2 deb.debian.org
```

Opcional (herramientas DNS explícitas):

```bash
dig deb.debian.org +short
```

### 5.2 Contenedor con red del host (debe alinearse con el host)

```bash
docker run --rm --network host python:3.12-slim-bookworm sh -lc \
  'getent hosts deb.debian.org && apt-get update -o Acquire::Retries=1'
```

Si esto funciona y el siguiente bloque no, el problema está en la **bridge**, no en Debian ni en los mirrors.

### 5.3 Contenedor en red bridge por defecto

```bash
docker run --rm python:3.12-slim-bookworm sh -lc 'getent hosts deb.debian.org'
```

```bash
docker run --rm --dns 1.1.1.1 python:3.12-slim-bookworm sh -lc 'getent hosts deb.debian.org'
```

Si `getent` no devuelve nada o `apt-get update` falla con `Temporary failure resolving`, la bridge sigue mal para DNS.

### 5.4 Imagen sin `ping` (p. ej. `python:*-slim`)

La imagen slim puede no incluir `ping`; eso no implica que la red esté caída. Para pruebas mínimas de salida HTTP puedes usar otra imagen:

```bash
docker run --rm busybox wget -qO- --timeout=3 https://example.com/ -O /dev/null && echo OK || echo fallo
```

### 5.5 Diagnóstico automatizado del repo

Desde la raíz del repositorio:

```bash
chmod +x scripts/docker-diagnose.sh
./scripts/docker-diagnose.sh
```

Revisar el log indicado al final del script.

---

## 6. Referencias rápidas en el repositorio

| Recurso | Uso |
|---------|-----|
| `docker-compose.yml` | `build.network: host` en backend y nginx |
| `scripts/docker-diagnose.sh` | Comparar DNS del daemon, resolvers del host y builds mínimos |
| `scripts/docker-up.sh` | Levantar el stack con Compose tras configurar `.env.docker` |

---

## 7. Limitaciones

- Este documento describe un patrón observado en despliegue tipo VPS; cada red corporativa o restricción adicional puede exigir DNS interno o proxy HTTP/HTTPS documentados aparte.
- No sustituye la documentación oficial de Docker sobre [redes](https://docs.docker.com/network/) y resolución DNS en contenedores.
