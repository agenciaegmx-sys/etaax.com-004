# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es

ETAAX: plataforma SaaS multi-negocio para restaurantes (costeos de recetas, ventas, gastos, inventarios, finanzas) de EGMx Consultoría. Sitio estático en español — HTML/CSS/JS vanilla, sin framework, sin bundler, sin package.json — desplegado en Netlify con backend Supabase (auth + Postgres con RLS).

## Comandos

No hay build ni lint. Para probar localmente sirve los archivos estáticos:

```bash
python3 -m http.server 8000   # luego abrir http://localhost:8000/hub.html
```

**Tests — correr SIEMPRE antes de push:**

```bash
node tests/money-tests.js   # sale con código 1 si alguna fórmula cambió
node tests/store-tests.js   # candado del almacenamiento local (etaax-store.js)
```

`money-tests.js` ejecuta el código REAL de producción (etaax-core.js + los `<script>` de diario.html e inventarios.js) en Node con DOM simulado y verifica las fórmulas de dinero (resguardo, comisiones bancarias, netos de tarjeta, existencias teórico/físico, prebatch y su reparto, metas por días operativos, efectos de depósitos/retiros…). Si un test falla, el test tiene razón hasta demostrar lo contrario. Al tocar una fórmula de dinero o crear una nueva, agregar/ajustar su test en el mismo commit.

`store-tests.js` levanta `etaax-store.js` sobre un IndexedDB de mentira con el reloj en la mano (se decide a propósito qué termina primero). Cubre la carrera entre hidratar y escribir: si la hidratación pisa lo ya escrito, resucita el estado viejo — ahí vivía el bug de la cola de salida clavada en 314 pendientes. Al tocar el almacenamiento, ajustar su test en el mismo commit.

Hay un hook pre-push que corre los dos candados y bloquea el push si alguno falla (`.githooks/pre-push`; en una máquina nueva activarlo con `git config core.hooksPath .githooks`).

**Núcleo de fórmulas `/etaax-core.js` (`window.EtaaxCore`):** una sola verdad para dinero de corte (flujoNeto, comisiones, netos, resguardo, depEfecto), periodos (getRange/semana ISO) y metas (calcMetaDiaria/diasOperativos). Las páginas lo cargan con `<script src="/etaax-core.js">` ANTES de su script y mantienen alias delgados (`function flujoNeto(c){return EtaaxCore.flujoNeto(c);}`). Al necesitar una de estas fórmulas en una página nueva, DELEGAR al núcleo — nunca copiar el cuerpo. Recibe datos por parámetro (cuentas, caja chica, factores), sin DOM.

**Costeo por TIPO DE PLATILLO (v90, 25-nov):** el costo y el gasto operativo ya no son un 30/40 fijo. `EtaaxCore.COSTEO_PERFILES` trae dos ÁREAS: **cocina** (FOOD cost: Entradas 18–25%, Comida rápida 25–32%, Platos fuertes 28–35%, Postres 15–22%) y **barra** (BAR cost: Coctelería de autor 12–18%, Destilados y tragos largos 18–25%, Cerveza/refrescos/aguas 28–35%), más **General** (30-40-30); cada tipo con su rango sano de costo (`foodMin/foodMax`, es el SEMÁFORO: `semaforoCosto`, verde dentro, ámbar hasta 3 pts arriba, rojo más), su rango de gasto operativo (`opMin/opMax`) y su meta (centro del rango, con ella sale el precio sugerido). `perfilCosteo(receta, cfg)` resuelve lo que manda en UNA receta: su `perfilCosteo` elegido (solo de su área: `areaReceta`/`perfilesDeArea`) o adivinado por grupo/categoría (`perfilAdivinado`: tacos/hamburguesas → comida rápida, clásicos/shots → destilados…; lo de cocina que no se reconoce queda en General para no cambiar números viejos), los % del negocio (`cfg` = `costeo_config`, se ajustan en la carátula → «Ajustar porcentajes», pestañas Cocina/Barra) y, encima, lo propio de la receta (`multiploCosteo` = 100 ÷ su meta, `gastoOpPct`). `costeoConPerfil(costo, receta, cfg)` da sugerido + aplicado + `diagnosticoCosteo`. Toda pantalla u hoja con costeo de receta (escandallo, ficha, carátula en pantalla e impresa, ventanita de costeo) pasa por ahí con `_costeoCfg()` de `app.js` — nunca un `/1.16` ni un `-40` a mano. **Venta directa de barra** (Insumos → Costeo): el factor de la copa sale de «Destilados» y el de la pieza de «Cerveza, refrescos y aguas» (`factorVentaDirecta` = 100 ÷ meta × 1.16, la misma vara que la carátula); el factor escrito en el insumo manda, pero los viejos 3.3/2.0 (se escribían solos al crear) cuentan como «sin factor propio»; la botella sigue en ×2.5. Suite BH91, `tests/inventarios-stock-casos.cjs` y `tests/probar-caratula.cjs`.

Deploy: push a `main` → Netlify publica la raíz del repo tal cual (`netlify.toml`).

Cambios de esquema: los archivos `supabase-migration-v*.sql` NO se aplican automáticamente — se corren a mano en Supabase → SQL Editor. Cada migración es idempotente (`IF NOT EXISTS`, `DROP POLICY IF EXISTS`). Para un cambio nuevo de esquema, crear `supabase-migration-v<siguiente>.sql` siguiendo ese patrón.

## Arquitectura

### Páginas / módulos

- `index.html` — landing pública de marketing (sin scripts de app, sin guarda).
- `carta.html` — la carta que abre el cliente al escanear el QR de la mesa. **Pública y SIN sesión** (no lleva page-guard): pide todo con una sola RPC `menu_publico_ver(negocio, token)` que arma cada platillo campo por campo. Es la única página donde un desconocido toca la tabla `recetas`, así que se arma con **lista blanca** —lo que no esté enumerado no viaja— y nunca con una lista negra, que se queda vieja en cuanto alguien agrega un campo al escandallo. Se edita desde `administrativo/menu.html`. Al tocarla, correr la suite BH23/BH47/BH48 del candado: vigilan los tres candados (nada visible hasta prenderlo platillo por platillo, sub-recetas fuera, solo esa sucursal) contra la ÚLTIMA definición SQL de la función, no contra la migración que la creó.
- `hub.html` — login (Supabase Auth) y selector de negocio + módulos. Es el punto de entrada; al elegir negocio escribe el contexto en localStorage.
- `recetas/index.html` + `app.js` — módulo de costeos/escandallos de recetas (el más grande).
- **Los módulos y sus submódulos** (orden del hub y de «Cambiar módulo»: Cost·ax, Admin·ax, Fin·ax, Equip·ax, Learn·ax; Vent·ax y Timbr·ax irán antes de Learn·ax). Varias páginas viven en una carpeta y son de OTRO módulo: `moduloDeRuta()` de `etaax-modulos-ui.js` decide a cuál pertenecen.
  - **Cost·ax** (`recetas/`): escandallos, insumos, inventarios, requisiciones, más `administrativo/menu.html` y `administrativo/proveedores.html` (Proveedores se mudó de Admin·ax; su permiso va con Cost·ax o Fin·ax).
  - **Admin·ax** (`administrativo/index.html`): **Ingresos**, **Egresos** y **Gestión** son VISTAS de `administrativo/diario.html` (`?vista=ingresos|egresos|gestion`; el bloque `VISTAS` junto a las tarjetas: solo esconde lo que no es de la vista, no toca fórmulas), **Configuración** = `financiero/cuentas-bancarias.html` y `financiero/previsiones.html` (viven en /financiero/, son de Admin·ax), y **Clientes**.
  - **Fin·ax** (`financiero/`): resumen, ventas, gastos globales, KPIs, estadísticas; su barra la arma `financiero/nav.js`.
  - **Equip·ax** (`equipo/index.html`, portada): las páginas del equipo viven en `administrativo/` (staff, horarios, checklists, organigrama, perfiles-puesto, evaluaciones, permisos; `RE_EQUIPO`) y se abren como PÁGINAS (ya no en ventana flotante). Submódulos: Catálogo, Operativo (Horarios, Checklists), Evaluaciones, Estructura de staff (Organigrama, Perfiles, Reglamento «próximamente»). La puerta de cada herramienta (su sub-permiso de staff) la pone page-guard (`SUB_RUTA`). `staff-hub.html` solo redirige a la portada.
  - **Las barras «Sub módulos»** de Equip·ax y Admin·ax (y Proveedores en Cost·ax) se arman de un solo lugar: `NAVS` en `etaax-modulos-ui.js` (renglón = submódulo; `g` = grupo con `hijos`; `sub` = sub-permiso de staff, `perm` = permiso de módulo).
  - Al agregar un módulo: `MODULOS` de `etaax-modulos-ui.js` **y** de `hub-modulos.js` (una prueba exige que coincidan), `MAPA` de `page-guard.js`, `etaax-sidebar.js` y `CATEGORIAS` de `administrativo/permisos.html`.
- `admin.html`, `admin-catalogo-insumos.html` — panel de administración de plataforma (solo platform admins).
- `staff-etaax.html` — portada del **Staff ETAAX** (equipo de ETAAX: auditores/consultores). Entran en el login del hub con su usuario (sin @); el hub lo intenta al final, contra la cuenta de Auth `<usuario>@staff.etaax.app`. La portada lista sus negocios (`etx_mis_negocios()`); al elegir uno, el hub (`_etxEntrar`) vuelve a leer el acceso, enseña SOLO sus sucursales y luego sus módulos. Se da de alta y se le dan accesos en `admin.html` → «Staff ETAAX» (`admin-staff-etaax.js`).

### Interfaz compartida de los módulos

Una sola cara para todas las páginas de módulo (no se dibuja página por página):

- **`etaax-header.js`** (`etaaxHeader(opc)`): la barra de arriba (marca, «Módulos» con Atrás/Adelante, tema, menú de la cuenta). `opc.extras` agrega entradas al menú de la cuenta (`{id, icono, texto, fn}`; así llegó «Información de sucursal»).
- **`etaax-modulos-ui.js`** + `.css` (no aplica embebido, `?embed=1`/`?solo=1`):
  - **La isla del negocio** (`etaaxDisenoCtxBar`, la llama `ctx-bar.js`): cápsula fija con el título de la pantalla a la izquierda, la sucursal (logo, pin, nombre y giro) centrada contra la PÁGINA, y a la derecha Cambiar sucursal / Cambiar módulo como botones chicos que despliegan su `<dialog>` debajo (`.etx-pop`).
  - **El título sube a la isla** (`subirTitulo`/`pintarTitulo`): toma el `.brand-title`/`.dx-hero-title`/… visible, lo deja solo para lectores de pantalla y quita su rótulo y párrafo. Copia TEXTO, nunca HTML.
  - **«Sub módulos»** (`subModulos` + `NAVS`): la barra lateral es un desplegable a la izquierda de la isla; el contenido usa todo el ancho (`--etx-sidebar-space` = 0).
  - **Las portadas** de módulo llevan el nombre en una isla (`.etx-isla`, se encoge a «A·» al bajar: `vigilarIsla`) y sus tarjetas compactas en dos columnas con su grupo adentro (`portadaCompacta`; el pasillo central es para la isla).
  - Las cabeceras pegajosas de cada página llevan arriba una franja del color del fondo (`--etx-ctx-fade`) para que nada se asome bajo la isla.
- **Hub** (`hub-modulos.js` + `hub-modulos.css`): los módulos se eligen en una **media luna 3D** (`colocarRueda`: el elegido al centro, con tope en los extremos, NO da la vuelta); debajo, centrado, su nombre y lo que se hace ahí. La franja de la sucursal es la misma isla.
- **`etaax-iconos.js`**: `etaaxIcono(nombre, {tam})` (iconos de la marca; nada de emojis en el cromo) y `etaaxIslaHTML(nombre)` (el nombre ·ax partido para la isla).

**Pruebas de navegador** (Playwright en `~/.cache/etaax-pw`, nunca dentro del repo): `NODE_PATH=~/.cache/etaax-pw/node_modules node tests/<arnés>.cjs` — `probar-isla-negocio` (isla, títulos, Sub módulos, media luna, portadas), `probar-planes-apps`, `probar-staff-etaax`, `probar-requisiciones`, `probar-caratula` (carátula de costos, tipos de platillo, v90 sin correr), `probar-inventario-navegador` (~5 min). `probar-cuenta-header`, `probar-sidebar` y `probar-ventanas-insumos` piden el Chrome de Mac.

### Scripts compartidos (se incluyen con `<script src>` en cada página)

- `supabase-config.js` — crea el cliente global `_supabase` (sesión en sessionStorage, se pierde al cerrar el navegador). Cargar siempre después del CDN de supabase-js y antes de cualquier script que lo use.
- `page-guard.js` — redirige a `/hub.html` si no hay `etaax_ctx`. Va al inicio del `<head>` de toda página de módulo (no en hub, landing ni admin). Toda página de módulo nueva debe incluirlo.
- `ctx-bar.js` — barra de contexto del negocio activo; expone `window._ctxBarInit` y `ctxSalir()`.
- `security.js` — auto-logout por inactividad (30 min) y el helper global `etx()` para escapar HTML. Usar `etx()` en toda concatenación de HTML con datos de usuario.
- `admin-guard.js` — modal `_pedirClaveAdmin(accion, callback)` que re-verifica la contraseña antes de acciones destructivas.
- `admin-migrar-sucursal.js` (`window.MigSuc`) — pasar una sucursal (no Matriz) a otro negocio desde el panel admin, en tres pasos: **copiar** (`planearCopia` + `ejecutarCopia`, desde el navegador por lotes: el original no se toca; los registros con `datos.sucursalId` se copian con id nuevo y todo lo que los nombra cambia con ellos; insumos y recetas se copian —recetas con id nuevo—; las cuentas bancarias y tarjetas (`tarjetas_credito`, del negocio) que nombran sus registros, más la base de débito, también —sin ellas la comisión y el neto al banco de sus cortes se calcularían con otras cuentas—; el staff NO se copia porque su usuario es único), **revisar**, y **eliminar del original** con `admin_archivar_sucursal` (`supabase-migration-v87.sql`: no borra, guarda cada renglón en `admin_archivo_filas`; el staff pasa al negocio de la copia) y **restaurar** con `admin_restaurar_sucursal` (lo regresa idéntico). La v86 (`admin_migrar_sucursal`, mover directo) queda en la base pero el panel ya no la usa. Prueba de punta a punta contra Postgres real: `PGLITE_DIR=<carpeta con @electric-sql/pglite> node tests/probar-sql-v86.mjs` (corre v86 y v87).
- `staff-etaax.js` (`window.StaffEtx`) — reglas compartidas del Staff ETAAX (admin, portada y hub): usuario → correo interno, módulos que se pueden dar, sucursales permitidas, el acceso guardado en `etaax_<neg>_acceso_etx`. En el hub entra como colaborador (`type:'staff'`, `etx:true`) con el rol reservado `etaax_staff`: page-guard (`etaaxPermisosEtx`) resuelve sus permisos de SU acceso (misma forma que un rol, con sub-permisos), no de la tabla `permisos` del dueño; una sucursal que no le toca no le da nada. La puerta de verdad es `supabase-migration-v88.sql`: `es_staff_de()` (la llave de todas las políticas «staff_acceso») suma al Staff ETAAX con acceso ACTIVO al negocio, así entra a lo mismo que la cuenta de colaboradores y a ningún otro negocio; `negocios` NO se le abre (trae `staff_cred`). Crear la cuenta, cambiar contraseña y dar de baja van por la Edge Function `supabase/functions/admin-staff-etaax` (llave de servicio, solo sesión del admin, solo cuentas `@staff.etaax.app`): los **registros abiertos están APAGADOS** en Supabase a propósito, así que `auth.signUp` desde el navegador contesta «Signups not allowed» — nunca usarlo para crear cuentas. Las RPC `admin_etx_*` de la v88 quedan sin uso. Pruebas: `PGLITE_DIR=… node tests/probar-sql-v88.mjs` (RLS real) y `NODE_PATH=… node tests/probar-staff-etaax.cjs` (navegador).
- **Venta por apps (v89).** ETAAX se vende como Adobe: **Cost·ax** (escandallos, insumos, inventarios, requisiciones) $899, **Fin·ax** (administración + salud financiera) $999, **Equip·ax** (RH: horarios, checklists, evaluaciones, organigrama, perfiles, nómina) $599, o el **paquete completo** $1,799; Vent·ax (POS) y Timbr·ax (facturación) están como «próximamente». **Cada sucursal contrata las suyas** y la escalera de descuento por sucursal corre igual sobre su precio; anual = paga `ANUAL_MESES` (9) y usa 12; cobro junto o por sucursal. Los precios y la cotización viven en `precios.js` (`APPS`, `cotizar`, `appsDe`, `precioSucursalApps`) — nunca recalcular en otra página. El plan se guarda en `suscripciones.plan` (NULL = paquete completo: así quedan los negocios de antes) y lo lee `negocio_plan()`; la invitación lleva `invitaciones.plan` y un trigger se lo pasa al negocio. **Lo no contratado NO SE VE, para nadie (dueño incluido):** page-guard (`etaaxPermEnPlan`, `ETAAX_APP_PERMISO`, `ETAAX_APP_SUB`, `ETAAX_APP_RUTAS`, caché `etaax_<neg>_plan`) bloquea páginas, `etaaxPerm` y `etaaxPuedeSub` lo respetan, y el hub esconde módulos/herramientas (también lo que el rol no permite: se oculta, no se apaga). Es control de operación como los roles; la base no cierra tablas por app. Selector compartido: `etaax-apps-ui.js` (`EtaaxAppsUI`). Admin: `admin-planes.js` (editar plan, invitar con apps, activar solicitudes tipo `apps`). El dueño pide cambios desde Plan y facturación (`etaax-cuenta.js`) como solicitud. En Stripe solo existe el precio del paquete mensual: lo demás se paga por transferencia hasta dar de alta sus precios. Pruebas: suite BH87, `PGLITE_DIR=… node tests/probar-sql-v89.mjs`, `NODE_PATH=… node tests/probar-planes-apps.cjs` (usa `tests/sdk-cuentas.cjs`, el Supabase de mentira con cuentas).
- `carta-tema.js` (`window.CartaTema`) — colores, tipografías y estilos por campo de la carta pública. **Una sola verdad para dos pantallas**: la maqueta de teléfono del editor (`administrativo/menu.html`) y `carta.html` piden el MISMO bloque de variables `--ct-*` con `CartaTema.vars(tema)`. Nunca escribir un color fijo en ninguna de las dos: una maqueta que calcula por su cuenta miente, y el dueño ya pegó los códigos en las mesas. Los grises (letra chica, líneas) se CALCULAN mezclando texto con fondo — por eso el mismo tema funciona en fondo claro.

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

**Guardados PARCIALES (RPC que mezclan en vez de reemplazar):** cuando varias pantallas escriben en la misma fila `datos`, el guardado no manda el objeto completo —pisaría lo de las otras— sino solo sus llaves, y el servidor hace `datos || v_limpio`. OJO con el borrado: `jsonb_strip_nulls` + `NULLIF(x,'')` convierte un texto vacío en «no mandé esa llave», y el merge deja la vieja en su sitio → **borrar un campo se vuelve imposible**. La regla es distinguir las dos cosas con `p_cfg ? 'llave'` (ausente = no se toca; vacía = se quita), y restar las vacías DESPUÉS del merge, nunca antes. Ver `menu_cfg_guardar` en `supabase-migration-v69.sql`.

### Restricciones importantes

- CSP en `netlify.toml`: scripts solo de `self` + jsdelivr, `connect-src` solo al proyecto Supabase. Cualquier CDN o API nueva requiere actualizar la CSP o no funcionará en producción.
- IDs de registros se generan en el cliente con `genId()` (base36 timestamp + random).
- El estilo de código existente es ES5-ish (`var`, funciones de concatenación de strings para HTML); mantener consistencia con el archivo que se edita.
- Mensajes de commit en español, formato `Módulo: descripción` o `Fix: descripción` (ver `git log`).
