---
name: Python Environment Manager
description: Gestión estandarizada de ambientes virtuales de Python fuera de OneDrive usando pyenv y venv.
---

# Gestión de Ambientes Python (pyenv + venv)

Esta skill define el estándar para crear, detectar y administrar ambientes virtuales de Python en sistemas Windows, asegurando que los ambientes permanezcan fuera de rutas sincronizadas con OneDrive.

## Configuración Base
- **Ruta de Almacenamiento:** `%USERPROFILE%\.venvs\`
- **Gestor de Versiones:** `pyenv`
- **Motor de Ambientes:** `python -m venv`

## Procedimientos

### 1. Consultar Versiones de Python Disponibles
Para ver qué versiones de Python están instaladas localmente:
```powershell
pyenv versions
```

### 2. Verificar o Instalar una Versión Específica
Antes de crear un ambiente, se debe asegurar que la versión necesaria existe:
1. Listar disponibles en línea: `pyenv install --list`
2. Instalar si falta: `pyenv install <version>`
3. Rehash para actualizar binarios: `pyenv rehash`

### 3. Crear un Nuevo Ambiente Virtual
Los ambientes deben llevar preferiblemente el nombre del proyecto.
1. Seleccionar la versión deseada en la sesión actual: `pyenv shell <version>`
2. Crear el ambiente fuera de OneDrive:
   ```powershell
   python -m venv $env:USERPROFILE\.venvs\<nombre_del_proyecto>
   ```

### 4. Detección y Activación Automática (PowerShell)
Para que el ambiente se active automáticamente y se muestre en el prompt:

1. **Configurar el perfil de PowerShell:** Ejecuta `notepad $PROFILE` y pega el siguiente código. Nota: Si el comando falla porque el archivo no existe, utiliza `New-Item -Path $PROFILE -Type File -Force` antes.
2. **Código de Activación (Compatible con PS 5.1 y 7+):**

```powershell
# --- Python Environment Manager Logic ---
function Update-PythonVenv {
    if (Test-Path ".python-version") {
        try {
            $envName = (Get-Content ".python-version" -Raw -ErrorAction SilentlyContinue).Trim()
            if ($envName) {
                # Rutas de búsqueda estándar
                $paths = @("$HOME\venvs\$envName\Scripts\Activate.ps1", "$HOME\.venvs\$envName\Scripts\Activate.ps1")
                foreach ($p in $paths) {
                    if (Test-Path $p) {
                        # Activar solo si no es el ambiente actual
                        if ($env:VIRTUAL_ENV -notmatch [regex]::Escape($envName)) { & $p }
                        break
                    }
                }
            }
        } catch {}
    }
}
# Personalización del Prompt para mostrar el ambiente
function prompt {
    $v = ""; if ($env:VIRTUAL_ENV) { $v = "($(Split-Path $env:VIRTUAL_ENV -Leaf)) " }
    $f = Split-Path (Get-Location).Path -Leaf
    if (-not $f) { $f = (Get-Location).Path }
    "$v`PS $f> "
}
# Hooks de navegación
function cd { param([string]$Path) if ($Path) { Set-Location $Path } else { Set-Location $HOME }; Update-PythonVenv }
function set-location { Microsoft.PowerShell.Management\Set-Location @args; Update-PythonVenv }
Update-PythonVenv
```

### 5. Configuración de VS Code (Opcional pero Recomendado)
Para asegurar que VS Code detecte el entorno correcto sin intervención manual, crea el archivo `.vscode/settings.json` en la raíz del proyecto:
```json
{
    "python.defaultInterpreterPath": "C:\\Users\\<TuUsuario>\\.venvs\\<nombre_del_ambiente>\\Scripts\\python.exe",
    "python.terminal.activateEnvInCurrentTerminal": true
}
```

## Reglas Críticas
- **NUNCA** crear la carpeta `.venv` o `venv` dentro de una carpeta del proyecto que esté dentro de `OneDrive`.
- **SIEMPRE** usar la variable de entorno `%USERPROFILE%\.venvs` (o `$env:USERPROFILE\.venvs` en PowerShell) como base.
- **IDENTIFICACIÓN:** El archivo `.python-version` debe contener el **nombre de la carpeta** del ambiente virtual, no el número de versión (ej: `mi_proyecto_env`). 
- **COMPATIBILIDAD:** No usar variables como `$PSStyle` sin verificar su existencia, ya que rompen la compatibilidad con PowerShell 5.1 (default en muchos sistemas Windows).
- **PERFILES:** Siempre usar la variable automática `$PROFILE` para localizar el archivo de configuración del usuario, evitando asumir nombres de archivo fijos.
