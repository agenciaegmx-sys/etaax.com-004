# Plan para Claude · accesos QR y portal del colaborador

Fecha: **14 de octubre de 2026**. Petición de Edwin: llevar las vistas por QR y
el portal de staff al nuevo estilo de ETAAX, con SVG, paleta actual, botones
consistentes y un regreso al menú mucho más visible.

**Esta entrega es solo el plan.** Codex revisó las rutas y componentes; no
modificó las pantallas, generó iconos ni implementó el rediseño. Claude debe
ejecutar las etapas de este documento cuando reciba el encargo.

## Punto de partida comprobado

Repo: `/Users/macbookpro/Proyectos/etaax.com-004-2`. HEAD al preparar el plan:
`6407752`. El árbol estaba limpio. La actualización anterior está en
`ebb97fd`; después Claude corrigió Ventas en `907b3c6` y ajustó el anuncio de
novedades. Los reportes del 13-oct describen etapas anteriores: no tomar sus
pendientes de Ventas ni su estado «sin commit» como diagnóstico de hoy.

| Vista real | Archivo | Contenido que debe conservar |
|---|---|---|
| Registro de barra/cocina por QR | `entrada.html` | NIP; entradas; mermas; cortesías/préstamos; conteos; historial |
| Portal del colaborador por QR | `checklist.html` | NIP; Mis checklists; ejecución/evidencias/resultado; recetario y ficha; guías |
| Captura de evidencia desde el teléfono | `captura.html` | Cámara/galería; carga; éxito/error; enlace temporal inválido/expirado |
| Equivalente instalado de esos flujos | `app-movil/index.html`, `app.js`, `app.css` | Inicio; NIP; registro; portal; navegación propia |

El portal solicitado es **`checklist.html`**, cuya URL se conservó cuando el
checklist se convirtió en portal. **`administrativo/staff-hub.html` es la
gestión del equipo**, ya rediseñada; no sustituirla ni confundirla con el acceso
del colaborador.

`evaluacion.html` también es un enlace público, pero pertenece a evaluaciones;
queda fuera de la primera entrega. La carta pública `carta.html` tiene su
propio tema configurado por cada negocio y tampoco entra en este rediseño.

## Resultado visual buscado

Una interfaz de operación pensada primero para teléfono: marca discreta arriba,
contexto del colaborador y área cuando exista, título claro, acciones grandes,
una tarea principal por pantalla y navegación fácil de encontrar. En PC queda
una columna centrada, sin estirar formularios a todo el ancho.

Las tarjetas del menú mostrarán SVG, título, descripción y flecha; el área
completa será un botón. Los formularios conservarán la secuencia operativa
actual, cantidades, unidades, listas, fotos y validaciones. El cambio de estilo
no añade una segunda puerta de login al QR.

### Paleta y papeles

Tomar como fuente `hub-paleta.css` y los tokens de `etaax-modulos-ui.css`,
sin cargar sus layouts de escritorio dentro del portal.

| Papel | Oscuro | Claro | Aplicación |
|---|---|---|---|
| Fondo | `#0F0E0C` | `#F4F3F0` | Fondo sólido, sin grid ni degradados |
| Panel | `#171611` | Blanco | Tarjetas y bloques |
| Texto | Crema `#F0ECE4` | Token de texto del tema claro | Títulos y datos |
| Marca/navegación | Cian `#8CE4EE` | Azul `#247681` | Iconos, bordes, pestaña activa, regreso al menú |
| Acción principal | Terracota `#FB9B6F` | Terracota `#AD4B27` | Entrar, Registrar lote, Guardar conteo, Registrar cumplimiento |
| Estado | Tokens de verde/ámbar/rojo existentes | Variantes del tema | Éxito, pendiente, incidencia y error |

Crear variables propias de presentación, por ejemplo `--portal-marca`,
`--portal-accion`, `--portal-panel`, `--portal-linea`. **No reemplazar
globalmente `--green` por cian**: el verde sigue comunicando éxito. Los acentos
del sprite se pueden adaptar dentro de `.etx-ic`, sin recolorear mensajes.

Botones principales: terracota sólido con tinta contrastante. Secundarios:
cian con contorno/tinte. Terciarios: superficie neutra y borde fino.
Destructivos: rojo, separados del guardado. Respetar los colores de estado de
las tareas; una tarea «no realizada» no debe tomar el color de un botón.

Usar DM Sans en controles, textos y títulos; título de 26–32 px en mayúsculas,
peso 600, siguiendo las herramientas nuevas. Labels discretos y texto de ayuda
legible. Bordes de 1 px, radios de 10–16 px, sin sombras fuertes ni animaciones
de dock dentro de formularios.

## Prioridad: Regresar al menú

Hoy `.volver` en Entrada y Checklist es texto apagado de 13 px, sin fondo ni
borde y con solo 4 px de padding. En la app instalada `#btnVolver` muestra solo
una flecha. Cambiar ese tratamiento antes de pulir detalles secundarios.

Especificación:

1. Texto visible **«Regresar al menú»**, con flecha SVG hacia la izquierda.
   No dejar una flecha sola ni el texto ambiguo «Regresar».
2. Botón cian con fondo suave, contorno de marca y texto contrastante; altura
   mínima de **48 px**, texto de 15–16 px y área de toque completa. A 320–390 px
   ocupará el ancho disponible de la columna; en PC podrá ajustar al contenido.
3. Colocarlo debajo de la marca/contexto, **antes del título del flujo**.
   Mantenerlo visible mediante un encabezado compacto `position:sticky`, con
   fondo opaco y altura real reservada. Debe seguir accesible al recorrer una
   lista larga, sin tapar inputs ni evidencias.
4. Aparece después de identificar al colaborador en las vistas de trabajo;
   se oculta en NIP y en el propio menú. También estará disponible en el
   resultado de un checklist, junto a Hacer otro checklist.
5. Debe volver al **menú de esa misma puerta**: Entrada → menú de registros;
   Checklist → portal del colaborador. Conservar NIP validado, negocio,
   sucursal y área; nunca enviar al hub del dueño ni a la landing.
6. En receta y ejecución de checklist, conservar el retorno de un nivel
   («Volver al recetario» / «Volver a checklists») como acción secundaria
   local. Regresar al menú sigue siendo el acceso persistente y explícito.
7. No usar `history.back()`: se llega escaneando un QR y el historial puede
   sacar al colaborador de la herramienta. Conectar con el estado local actual
   (`volverMenu`, `_verMenu`, `irMenu` en la app) según la puerta y contexto.
8. Navegar no debe ejecutar guardados, enviar lotes ni borrar el NIP. Mantener
   el tratamiento actual de borradores y cargas en curso; un nuevo atajo no
   debe introducir un descarte silencioso de `RUN` o de listas pendientes.
   Revisar los resets de `volverLista` y `abrirRun` al conectarlo: un repintado
   visual no puede volver a iniciar el checklist.

`captura.html` no tiene menú ni NIP: su QR empareja una foto con una captura en
la computadora. Aplicar el estilo, pero **no inventar un Regresar al menú**
que envíe al usuario a una puerta sin contexto.

## Iconos

Leer `iconos/LEEME.md`; reutilizar `etaaxIcono(nombre, {tam:…})`. Los nombres
reales son `flecha`, `usuario`, `candado`, etc.; **`arrow` y `user` de algunos
ejemplos antiguos no son nombres canónicos**. La flecha de retorno puede ser
`flecha` rotada 180° dentro del botón.

| Concepto | Reutilizar o crear |
|---|---|
| Colaborador/NIP | `usuario`, `candado` |
| Regresar/abrir | `flecha`; `hd-inicio` solo cuando su significado sea inicio |
| Conteo de existencias | `mod-inventarios` |
| Recetario | `cat-recetas` o `mod-escandallos` según nivel |
| Entradas | SVG operativo de caja con entrada |
| Merma | SVG operativo de producto con marca de pérdida |
| Cortesía | SVG de regalo |
| Préstamo | SVG de intercambio |
| Lo registrado | SVG de historial/documento |
| Mis checklists | SVG de lista verificada |
| Guías | SVG de manual |
| Cámara/galería/video | SVG propios de esos controles |
| Agregar/registrar/quitar | SVG de más, confirmación y eliminar, con etiquetas |

Para conceptos sin SVG adecuado, crear la fuente en
`iconos/operativo/etaax-op-<concepto>.svg`. El nombre `op-<concepto>` evita
colisiones sin requerir otra familia del generador. Mantener trazo y margen de
los iconos actuales, `viewBox`, color heredado y detalle de marca normalizado.
No usar un icono de finanzas para representar merma solo porque ya existe.

Regenerar con `node iconos/generar.js`; no editar `etaax-iconos.js` a mano ni
introducir un CDN de iconos. Revisar el símbolo generado antes de usarlo.
Tamaños orientativos: 28–32 px en tarjetas, 20–22 px en acciones. SVG
decorativos con etiqueta textual accesible; las fotografías de productos y
recetas siguen siendo fotografías.

## Estructura técnica propuesta

Crear **`portal-operativo.css`** compartido por Entrada, Checklist y Captura,
con reglas acotadas a una clase de body, por ejemplo `.etx-portal-operativo`.
Concentrar paleta, botones, tarjetas, campos, mensajes y navegación allí.
Conservar el CSS específico que resuelve cada flujo y retirar únicamente las
reglas visuales duplicadas sustituidas por el nuevo archivo.

Un **`portal-operativo.js`** pequeño es adecuado para helpers de presentación,
iconos, tema y foco. No debe manejar NIP, RPC, subir evidencias, decidir
permisos o copiar fórmulas. La transición de pantallas seguirá en cada archivo;
puede avisar al helper para actualizar el título y la visibilidad del regreso.
No usar un observador que repinte formularios y borre campos.

Las pantallas QR son públicas con token y NIP, no páginas del panel privado.
**No añadir `page-guard.js`, header de cuenta, sidebar ni `ctx-bar.js`** para
obtener su diseño. Mantener los identificadores y handlers existentes.
Convertir las tarjetas `div onclick` del portal en botones nativos para
Enter/Espacio, conservando su acción y estado deshabilitado.

Conservar `theme.js` como única preferencia de tema. Poner el control de tema
en la cabecera compacta mediante su API y SVG sol/luna, y evitar que quede
además el control flotante. Resolverlo desde el portal sin cambiar la
geometría de todas las otras páginas. Respetar el logo claro/oscuro existente.

Campos de 16 px o más en móvil; foco cian visible, labels asociados,
botones táctiles de 48 px, textos que envuelvan y `min-width:0`. Permitir zoom
quitando `maximum-scale=1.0` de estas vistas. Usar espacio seguro del teléfono
con `env(safe-area-inset-*)`. El teclado no puede ocultar cantidad o Guardar.

## Orden de ejecución

### Etapa 1 · base y primer recorrido

Crear los tokens, componentes e iconos, y aplicarlos primero en
`entrada.html`: NIP → menú → Entrada de insumos → regreso. Validar en oscuro y
claro a 320/390 px antes de extenderlo. Conservar el máximo de renglones,
unidades y lógica de lote que ya aplica el código.

### Etapa 2 · completar los registros por QR

Aplicar la misma estructura a Merma, Cortesía/préstamo, Conteos e Historial.
Revisar también productos/recetas seleccionados, chips de área, listas vacías,
miniaturas, quitar renglón, progreso de envío, error y éxito. El menú conserva
sus cinco opciones; no mezclar préstamos con entradas pagadas ni cambiar el
significado del conteo.

### Etapa 3 · portal del colaborador

Actualizar `checklist.html`: acceso NIP, menú con sus tres opciones según
área, lista de checklists, ejecución, evidencias, resultado, recetario,
sub-recetas, ficha y guías. Mantener recetas solo para las áreas actualmente
habilitadas y fichas **sin costos**. El progreso y los estados de tareas
conservan su cálculo. Añadir regreso visible sin reiniciar una tarea por
repintar el layout.

### Etapa 4 · captura temporal de fotos

Aplicar marca, paleta, iconos y botones en `captura.html`: Cámara/Galería,
miniaturas, cargando, éxito, error y expiración. Mantener la vigencia actual,
emparejamiento por token y evidencia privada. No añadir fecha ni login.

### Etapa 5 · coherencia con la app instalada

Aplicar los mismos papeles e iconos a `app-movil/index.html`, `app.css` y las
plantillas de presentación de `app.js`. Conservar su navegación propia,
teclado NIP, inicio con cuenta/NIP y selección de negocio/sucursal. En la app,
`irMenu()` depende de la puerta activa: comprobar registros, portal y cuenta
antes de ampliar la etiqueta de `#btnVolver`.

La app tiene una cáscara cacheada. Si cambia esta etapa, actualizar la versión
de caché en `app-movil/sw.js` y añadir los nuevos recursos de presentación y
sprite que se carguen a `CASCARA`, con las mismas URLs que el HTML. Mantener
los datos/RPC/fotos fuera de caché. Comprobar actualización desde la cáscara
anterior y apertura sin señal con su aviso. No añadir guardado offline como
parte del rediseño.

Esta etapa puede ser una segunda entrega; cerrar primero los accesos web QR
y el portal solicitados, dejando explícito si la PWA ya se actualizó.

## Contratos que debe respetar Claude

- Las URLs impresas `entrada.html?n=…&t=…&s=…` y
  `checklist.html?n=…&t=…&s=…` siguen funcionando. No regenerar tokens ni QR.
- Conservar RPC y parámetros de NIP, perfil, catálogo, registro, conteos,
  historial, recetas, guías y checklist. No sustituirlos por lectura directa
  de tablas desde estas puertas públicas.
- Área y sucursal siguen las reglas existentes del perfil y QR; el rediseño
  no añade un selector que permita ampliar ese alcance.
- Conteos conservan identidad única y suma de envíos; no volver a IDs estables
  que sobrescriban capturas, ni introducir peso de botellas abiertas donde se
  retiró. Mantener el vocabulario de `StaffArea`.
- La evidencia sigue en almacenamiento privado y los mensajes dependen del
  resultado real. Cambiar un botón a terracota no puede convertir un error de
  RPC en «Guardado».
- No tocar SQL, RLS, fórmulas, cuotas o autenticación para resolver apariencia.
  Si se encuentra un defecto funcional independiente, documentarlo separado.
- Versionar CSS/JS nuevos y actualizar de forma coherente los consumidores del
  sprite. Las versiones compartidas se comprueban en el candado.

## Comprobación y criterios de cierre

No ejecutar capturas con NIP/token ni datos reales. Usar Chrome/Chromium con
Supabase simulado, servidor local y peticiones externas bloqueadas, como los
arneses actuales. Preparar una batería `tests/probar-portal-qr.cjs` que recorra
los documentos reales y acciones, en vez de probar solo HTML de maqueta.

Casos de aceptación:

1. NIP correcto/incorrecto y QR inválido muestran su estado; el menú no se
   habilita antes de validar.
2. Regresar al menú se ve en el primer viewport y tras scroll, responde al
   toque/teclado y conserva identidad/alcance; se oculta en menú y NIP.
3. Todos los flujos regresan a su puerta correcta. Recetario y ejecución
   conservan también el regreso al nivel anterior.
4. Un clic de registrar conserva el payload y realiza una sola operación.
   Volver no registra nada. Un error mantiene la posibilidad de reintentar.
5. Dos conteos conservan sus dos identidades; fotografías y listas no se
   pierden por un repintado. Confirmar especialmente `RUN` al navegar.
6. Opciones por área, recetas sin costos, tareas y resultado funcionan como
   antes. Entrar/Guardar deshabilitados siguen deshabilitados cuando procede.
7. SVG visibles, ningún icono roto, contraste legible, foco y nombres
   accesibles; la marca no reemplaza los colores de estado.
8. Sin desbordamiento a 320, 360, 390 y 768 px; columna cómoda a 1440 px.
   Probar nombres largos, cantidades, cámaras/galería, tema claro/oscuro,
   zoom, movimiento reducido y teclado abierto. Safari iOS debe revisar date,
   safe area y teclado cuando esté disponible; no declarar esa revisión por
   haber emulado solo Chrome.
9. Captura temporal conserva expiración y emparejamiento. PWA, si se incluye,
   actualiza su cáscara y mantiene señal/error de red visibles.

Ejecutar antes de cerrar la implementación:

```sh
node tests/money-tests.js
node tests/store-tests.js
node tests/probar-portal-qr.cjs
git diff --check
```

Si se cambian sprite o scripts compartidos, ejecutar también
`node tests/probar-cuenta-header.cjs`. Las suites existentes de Portal, áreas,
conteos, historial, NIP y evidencia deben seguir pasando. Algunas buscan CSS
dentro del HTML: al extraerlo, adaptar su lectura al CSS real sin retirar la
intención de la aserción. No inventar una cantidad de pruebas esperada desde
los logs del día anterior.

Conservar un reporte final y capturas con datos ficticios de menú, Entrada,
Conteo, Checklist, receta y botón de regreso en PC y móvil. Indicar qué fases
se implementaron y qué navegadores se comprobaron; no marcar PWA/evaluaciones
como terminadas si quedaron fuera.

## Encargo listo para pasar a Claude

> Ejecuta `docs/plan-qr-portal-staff-2026-10-14.md`. Empieza por Entrada y el
> regreso persistente al menú, completa el portal de `checklist.html` y la
> captura de fotos. Usa la paleta actual y el sistema SVG del repo; crea los
> iconos operativos que falten. Conserva URLs impresas, NIP, RPC, contexto,
> estados y datos. Valida documentos reales con servidor simulado en PC y
> móvil, ambos temas. Deja reporte y evidencia; distingue si la app instalada
> se incluye en esta entrega o queda para la segunda fase. Este plan no
> solicita commit, push ni cambios de servidor.
