# Barra lateral: emojis en producción y SVG en Live Server

Fecha: **14 de octubre de 2026**. Base local: `beb79da`. Diagnóstico y
corrección preparados por Codex a petición de Edwin. El diagnóstico se cerró
con el arreglo local; **Edwin autorizó después el commit y push** de esta
corrección. El plan de QR/portal de staff sigue como plan.

## Causa comprobada

El HTML servido por Netlify modifica los enlaces al publicarlo:

| En el repo / Live Server | En el HTML de etaax.com |
|---|---|
| `staff-hub.html` | `/administrativo/staff-hub` |
| `diario.html` | `/administrativo/diario` |
| `clientes.html` | `/administrativo/clientes` |
| `index.html` del módulo | `/administrativo/` |

Se descargaron por HTTP los archivos públicos de
[Diario](https://etaax.com/administrativo/diario.html) y
[Staff](https://etaax.com/administrativo/staff-hub.html), sin abrir una sesión ni
consultar el backend. Ambos menús ya contienen esos `href` sin `.html` antes
de ejecutar JavaScript. El HTML local conserva la extensión.

`etaax-sidebar.js` buscaba el pathname exacto en `RUTAS`, cuyos nombres llevan
`.html`. `/administrativo/staff-hub` no encontraba
`/administrativo/staff-hub.html`, y `pintar` dejaba el emoji original.

Las descripciones tienen la misma causa: `etaax-modulos-ui.js` buscaba
`DESCRIPCIONES['staff-hub']` en una tabla con `staff-hub.html`. Por eso también
desaparecían «Personal y horarios», «Abastecimiento», etc. El icono superior del
módulo sí aparecía porque se decide con el primer segmento de la ruta, que
sigue siendo `administrativo`.

Eso explica **todos los detalles de la captura** y por qué más reintentos del
pintor no ayudaban: podía estar disponible el sprite desde el inicio, pero el
nombre del icono continuaba siendo desconocido por el cambio del enlace.

## Comprobación de los recursos publicados

Los tres JS descargados coincidían byte por byte con el HEAD local anterior
al arreglo. Las versiones nuevas de Claude sí estaban publicadas:

| Archivo descargado | Huella SHA-256, primeros 8 caracteres |
|---|---|
| `etaax-sidebar.js` | `7ca56cbf` |
| `etaax-iconos.js` | `83b0b21d` |
| `etaax-modulos-ui.js` | `37ddc7aa` |

Respondían HTTP 200, tipo JavaScript y `age: 0` en esta lectura. Los HTML
pedían esas mismas versiones. El hallazgo es una diferencia real entre el
HTML local y el HTML procesado al publicar; no se diagnosticó a partir de una
suposición sobre caché o tiempo de carga.

El fragmento exacto del menú publicado se conserva en
[`tests/fixtures/sidebar-netlify.nav.txt`](../tests/fixtures/sidebar-netlify.nav.txt).
No contiene sesión, NIP, token ni datos de un negocio. Es un fragmento de
prueba, no otra página de la app.

## Arreglo aplicado

1. **`etaax-sidebar.js`** normaliza internamente las rutas de los cuatro
   módulos. Reconoce `.html`, URL limpia y raíz de módulo con/sin slash
   (`/recetas/` → clave `index.html`). La API `etaaxIconoRuta` y el pintor usan
   esa misma resolución. Los enlaces conservan su `href` y comportamiento.
2. **`etaax-modulos-ui.js`** reutiliza la normalización para encontrar las
   descripciones; también siguen funcionando las tarjetas que consultan
   `etaaxIconoRuta`.
3. **Observador del menú:** excluye «Volver a módulos» al buscar iconos
   pendientes. Ese botón ya trae su SVG, pero no llevaba la marca del pintor;
   el observador lo consideraba pendiente y repintaba los otros SVG en cada
   cuadro. La prueba comprueba que el nodo SVG se mantiene estable en reposo
   y que un menú realmente reemplazado recupera los iconos.
4. **`etaax-modulos-ui.css`:** declara visible `.nav-text` en la barra nueva.
   La regla móvil antigua de `styles.css` ocultaba los nombres incluso al
   expandir. El estado `.cerrado` sigue ocultándolos mediante su regla más
   específica; la barra abierta muestra nombre y descripción en móvil/tablet.
5. **`node versionar.js`** actualizó las referencias por huella en las **29
   páginas consumidoras**. Los demás cambios de esos HTML son solo las tres
   versiones de recursos compartidos. `netlify.toml` y el sprite se conservan.

Huellas que deben viajar en esta publicación: **`etaax-sidebar.js?v=fd2dac1b`**,
**`etaax-modulos-ui.js?v=63332541`** y
**`etaax-modulos-ui.css?v=dc47c144`**.

Se mantuvieron los reintentos y la vigilancia de menús introducidos por Claude;
se corrigió el reconocimiento del enlace que esos reintentos no resolvían.
No se tocaron permisos, contexto de negocio/sucursal, fórmulas, RPC ni datos.

## Regresión y evidencia

Nueva batería: **`node tests/probar-sidebar.cjs`**. Usa Chrome real, servidor
local y el menú publicado conservado como fixture. Ejecuta el pintor y el
estilizador reales, sin Supabase ni otro backend. Bloquea toda petición fuera
del origen local.

Con los **JS originales descargados**: **11 casos, 7 fallas**. Las cuatro
variantes de Live Server conservan sus SVG; las cuatro variantes publicadas
dejan emojis. También fallan el reconocimiento de rutas limpias, la
recuperación del menú publicado y la estabilidad del repintado en reposo.

Con el arreglo: **11 casos, 0 fallas**. Incluye cinco SVG y sus descripciones,
destinos intactos, rutas de los cuatro módulos, raíz de Recetas, reconstrucción
del menú, estabilidad en reposo y nombres visibles. Anchos: **1440, 768, 390 y
320 px**, para formato local y publicado. Sin errores JavaScript ni
desbordamiento horizontal.

Se prueba el fragmento real del menú con CSS y scripts compartidos; no se
presenta como una prueba del cálculo ni de la carga de todo Diario. La batería
de cuenta/header cubre por separado la navegación/contexto existente.

Validación final:

- **4,496** comprobaciones de dinero, 0 fallas.
- **84** comprobaciones de almacén, 0 fallas.
- **58** casos de cuenta/header, 0 fallas.
- **11** casos de barra lateral, 0 fallas con el arreglo.
- Sintaxis de los JS, `node versionar.js --revisar` y `git diff --check`.

[Evidencia y logs](sidebar-produccion-2026-10-14/): comparación antes/después
con los mismos enlaces, capturas y registros de las baterías. «Antes» ejecuta
los JS publicados previos sobre el fixture; «Después» ejecuta el arreglo
local, conservando el procesamiento de enlaces en ese fixture.

## Integración y comprobación de la publicación

Revisar y conservar juntos:

- `etaax-sidebar.js`, `etaax-modulos-ui.js`, `etaax-modulos-ui.css`.
- Las referencias nuevas generadas en los 29 HTML.
- `tests/probar-sidebar.cjs` y `tests/fixtures/sidebar-netlify.nav.txt`.
- Este diagnóstico y su evidencia.

Comandos:

```sh
node versionar.js --revisar
node tests/money-tests.js
node tests/store-tests.js
node tests/probar-cuenta-header.cjs
node tests/probar-sidebar.cjs
git diff --check
```

Título sugerido: **Fix: resolver SVG y descripciones con las URLs limpias de Netlify**.

La publicación de este arreglo fue solicitada después del diagnóstico para
llevarlo a la computadora y tablet del usuario. Después del despliegue,
verificar en el HTML publicado las tres
nuevas huellas y abrir una herramienta con los enlaces sin `.html`: todos los
iconos y descripciones deben aparecer. No basta comprobar el Live Server.
No hace falta desactivar el procesamiento de enlaces ni pedir al usuario que
cambie la configuración de su navegador para que la resolución sea correcta.

Opciones de la batería: `CHROME_BIN`, `SIDEBAR_CAPTURES` y `SIDEBAR_SOURCE`.
La última permite usar una carpeta de JS exportados del commit anterior para
reproducir el fallo; no depende de consultar producción durante el test.
