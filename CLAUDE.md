# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es

ETAAX: plataforma SaaS multi-negocio para restaurantes (costeos de recetas, ventas, gastos, inventarios, finanzas) de EGMx Consultoría. Sitio estático en español — HTML/CSS/JS vanilla, sin framework, sin bundler, sin package.json — desplegado en Netlify con backend Supabase (auth + Postgres con RLS).

## Comandos

No hay build ni lint. Para probar localmente sirve los archivos estáticos:

```bash
python3 -m http.server 8000   # luego abrir http://localhost:8000/hub.html
```

**Tests de fórmulas de dinero — correr SIEMPRE antes de push:**

```bash
node tests/money-tests.js   # sale con código 1 si alguna fórmula cambió
```

Ejecuta el código REAL de producción (los `<script>` de diario.html e inventarios.js) en Node con DOM simulado y verifica ~43 fórmulas (resguardo, comisiones bancarias, netos de tarjeta, existencias teórico/físico, metas por días operativos, efectos de depósitos/retiros…). Si un test falla, el test tiene razón hasta demostrar lo contrario. Al tocar una fórmula de dinero o crear una nueva, agregar/ajustar su test en el mismo commit.

Deploy: push a `main` → Netlify publica la raíz del repo tal cual (`netlify.toml`).

Cambios de esquema: los archivos `supabase-migration-v*.sql` NO se aplican automáticamente — se corren a mano en Supabase → SQL Editor. Cada migración es idempotente (`IF NOT EXISTS`, `DROP POLICY IF EXISTS`). Para un cambio nuevo de esquema, crear `supabase-migration-v<siguiente>.sql` siguiendo ese patrón.

## Arquitectura

### Páginas / módulos

- `index.html` — landing pública de marketing (sin scripts de app, sin guarda).
- `hub.html` — login (Supabase Auth) y selector de negocio + módulos. Es el punto de entrada; al elegir negocio escribe el contexto en localStorage.
- `recetas/index.html` + `app.js` — módulo de costeos/escandallos de recetas (el más grande).
- `administrativo/` — ventas, gastos, clientes, proveedores, staff, menú, permisos.
- `financiero/` — KPIs, utilidades, previsiones, gastos globales.
- `recetas/` — insumos, inventarios, requisiciones.
- `admin.html`, `admin-catalogo-insumos.html` — panel de administración de plataforma (solo platform admins).

### Scripts compartidos (se incluyen con `<script src>` en cada página)

- `supabase-config.js` — crea el cliente global `_supabase` (sesión en sessionStorage, se pierde al cerrar el navegador). Cargar siempre después del CDN de supabase-js y antes de cualquier script que lo use.
- `page-guard.js` — redirige a `/hub.html` si no hay `etaax_ctx`. Va al inicio del `<head>` de toda página de módulo (no en hub, landing ni admin). Toda página de módulo nueva debe incluirlo.
- `ctx-bar.js` — barra de contexto del negocio activo; expone `window._ctxBarInit` y `ctxSalir()`.
- `security.js` — auto-logout por inactividad (30 min) y el helper global `etx()` para escapar HTML. Usar `etx()` en toda concatenación de HTML con datos de usuario.
- `admin-guard.js` — modal `_pedirClaveAdmin(accion, callback)` que re-verifica la contraseña antes de acciones destructivas.

### Contexto de sesión (localStorage)

- `etaax_negocio_activo` — id del negocio seleccionado.
- `etaax_ctx` — JSON con nombre/emoji/color del negocio y datos del usuario; lo renderiza ctx-bar.
- Claves de datos legacy usan prefijo por negocio: `etaax_{negocioId}_{key}` (ver `_sk()`/`_skGet()` en `app.js`, que migra desde la clave plana una sola vez).

### Modelo de datos en Supabase

Todas las tablas siguen el mismo patrón "per record":

```sql
id TEXT PRIMARY KEY, negocio_id TEXT REFERENCES negocios(id), datos JSONB, created_at, updated_at
```

El objeto completo de la app vive en `datos` (JSONB); las columnas solo dan identidad e índice. Cada tabla tiene dos políticas RLS: `"own"` (el `usuario_id` del negocio debe ser `auth.uid()`) y `"admin_all"` (función `is_platform_admin()`). Tablas raíz: `usuarios` (espejo de auth.users) y `negocios`.

Patrón de acceso en el cliente:
1. Al cargar la página, `select('datos').eq('negocio_id', negId)` → cache en memoria (`_cacheRecetas` etc.) con fallback a localStorage si falla.
2. Escrituras: usar los helpers de `etaax-db.js` — `sbUpsert(tabla, record)` para tablas per-record, `sbUpsertDoc(tabla, datos)` para documento único por negocio (onConflict negocio_id), `sbDelete(tabla, id)`. Reportan fallos al usuario con `_sbToastError`. Incluir `/etaax-db.js` después de `supabase-config.js`. OJO: las queries de supabase-js v2 NO se ejecutan sin `await` o `.then()` — nunca dejar un builder suelto.
3. localStorage se mantiene como respaldo (sin fotos base64, por la quota).

La migración localStorage→Supabase ya está completa para todos los módulos; al tocar persistencia, seguir este patrón y no inventar otro.

### Restricciones importantes

- CSP en `netlify.toml`: scripts solo de `self` + jsdelivr, `connect-src` solo al proyecto Supabase. Cualquier CDN o API nueva requiere actualizar la CSP o no funcionará en producción.
- IDs de registros se generan en el cliente con `genId()` (base36 timestamp + random).
- El estilo de código existente es ES5-ish (`var`, funciones de concatenación de strings para HTML); mantener consistencia con el archivo que se edita.
- Mensajes de commit en español, formato `Módulo: descripción` o `Fix: descripción` (ver `git log`).
