# Nóminas: recibo digital, cola de trabajo y correcciones con rastro
### Reporte para auditoría · 3 → 6 nov 2026 · trabajo de Claude

Codex: esto es lo que toqué del módulo de nóminas en estos cuatro días, para
que lo audites. Escribo el **por qué** de cada decisión y, sobre todo, **dónde
creo que puede estar mal**: si solo quisiera que pasara la revisión, te
escribiría un resumen bonito.

Todo vive en `administrativo/diario.html` salvo lo que se diga.
Commits: `9bce5f9 … 9fbb217` (14, dos de ellos de Edwin/tuyos).
Candado: **5351 fórmulas, 0 fallas** · almacén **84, 0 fallas** ·
`tests/probar-sql-v85.mjs` **13 casos, 0 fallas** contra PGlite.

---

## 0 · Lo que hay que correr en Supabase

**`supabase-migration-v85.sql` NO está corrida todavía.** Crea la tabla
`nomina_recibos` (patrón `id/negocio_id/datos`), sus dos índices, las tres
políticas de siempre (`own`, `staff_acceso`, `admin_all`) y un trigger que
impide que un recibo cambie de negocio y sella `updated_at`.

El cliente está escrito para aguantar que no esté: si la consulta falla,
`_cacheRecibos` queda en `[]`, se avisa por consola y el panel sigue
funcionando. **Ese camino es de los que más me gustaría que mires**: la
degradación silenciosa es cómoda hasta que esconde un error real.

---

## 1 · El cambio de fondo: generar el recibo ≠ pagarlo

Antes, para que existiera un recibo tenía que existir primero el gasto: el
modal de nómina terminaba empujando al modal de pago y, si no lo concluías, lo
capturado se perdía. No se podían preparar las dieciséis nóminas de la semana,
revisarlas y pagarlas después.

Ahora son dos pasos:

| paso | función | qué escribe |
|---|---|---|
| Generar recibo | `_confirmarPagoNom` (rama `!_edit`) | fila en `nomina_recibos`, **sin gasto** |
| Generar gasto | `generarGastoNomina` | abre el modal de gasto con los números del recibo |
| (al guardar) | `_sellarReciboPagado` | le pega `gastoId` + `pagadoEn` al recibo |

**Por qué tabla propia y no un «gasto pendiente»:** un gasto pendiente aparece
en la lista de gastos y en el total del panel desde que lo generas, aunque no
haya salido dinero. La tabla aparte no ensucia nada hasta que se paga.

### Dónde mirar con lupa
- **`_sellarReciboPagado` se llama dentro de `guardarGasto`**, después del
  `_sbUp('gastos', …)`. Si el upsert del gasto fallara y el del recibo no, el
  recibo quedaría marcado como pagado sin gasto. Los dos van al outbox de
  `etaax-db.js`, así que creo que caen juntos, pero no lo probé contra una red
  caída.
- **`_reciboRegId`** es `nr_<staffId>_<desdeSinGuiones>`, con sufijo `_2`, `_3`…
  si el id base ya lo ocupa un recibo **pagado**. Eso cierra que una segunda
  nómina del mismo periodo pise el comprobante de un pago hecho (lo encontró la
  batería de mutaciones, no yo). **Lo que NO cubrí:** dos pestañas generando el
  mismo recibo a la vez. Ganaría la última; no hay versión ni `updated` que se
  compare al escribir.
- **`_traslapa`** compara fechas como TEXTO (`'2026-11-01' <= '2026-11-30'`).
  Funciona porque son ISO, pero si alguna vez entra una fecha con otro formato
  el resultado es silenciosamente falso. Lo dejé así por simetría con el resto
  del archivo; dime si prefieres que pase por `Date`.

---

## 2 · La cola de trabajo (el selector de colaborador)

Tres estados: **POR PAGAR** / **RECIBO LISTO** / **PAGADA**, más PARCIAL cuando
el periodo está a medias (`EtaaxCore.coberturaPeriodo`, suite BH61).

- **PARCIAL va con los pendientes.** A esa persona todavía le deben algo.
- **Lo pagado sale de la cola a las 24 h** (`_NOM_24H`), contadas desde
  `pagadoEn` —el instante en que se registró el pago, no la fecha tecleada—.
  Después vive solo en su historial (📜).
- **Escotilla:** si hay texto en el buscador, se enseña a todos los que
  coincidan aunque ya hayan salido de la cola. Sin eso, pagarle algo extra a
  quien cobró ayer sería imposible.

### Dónde mirar con lupa
- Los pagos **anteriores a la v85 no tienen `pagadoEn`**, así que nunca
  aparecen en «Pagadas»: nacen en el historial. Es a propósito (se pagaron hace
  días) pero es un cambio de conducta que no se anuncia en pantalla.
- `_nomPagadoEn` solo lee el recibo. Si alguien borra el recibo de un pago y
  deja el gasto, la persona vuelve a «por pagar» aunque esté pagada. El camino
  de borrado que yo hice (`eliminarPagoNomina`) borra los dos, pero
  `eliminarGasto` —el genérico, desde la lista de gastos— **borra solo el
  gasto y deja el recibo huérfano**. Lo sé y no lo cerré: dime si lo ves como
  agujero o como caso raro.

---

## 3 · Correcciones con rastro

Corregir un pago YA registrado (`editarReciboNomina` → `_pnAbrirCorreccion` →
`_confirmarPagoNom` con `_pnEditandoGasto`) exige motivo y escribe
`nomina.correcciones[]` con lo que decía antes. El papel lo imprime.

Reglas que defendí con pruebas:
- **Folio y fecha de emisión se conservan**: un recibo corregido es el mismo
  recibo. Renumerarlo lo haría parecer un segundo pago.
- **Los conceptos «pagados aparte» NO se vuelven a registrar** en una
  corrección: cada uno ya es su propio gasto y recrearlos pagaría el bono dos
  veces con el total del recibo intacto.
- **El tipo (mayor/menor) se conserva**: ahí vive su autorización.
- **Las dos cosas o ninguna**: el botón dice «Actualizar gasto →» y nada se
  guarda hasta que se guarda el gasto. Cancelar ahí pierde también el recibo.

### Dónde mirar con lupa
- **Reconstrucción de pagos viejos.** Los pagos anteriores no guardaron la
  captura, solo el desglose en `notas`. `_reciboNominaReconstruido` lo parsea y
  `_origenDesdeReconstruido` arma una captura. **Esto es lo más frágil de todo
  el trabajo**: es un parser de texto escrito por otra función
  (`_confirmarPagoNom`). Si el formato del escritor cambia, el lector miente en
  silencio. Hay prueba que fija el formato, pero el acoplamiento es real.
- Dentro de eso encontré un bug propio: una sanción se escribe
  `+ Sanción: $-200.00` —el `+` es del formato, el menos es del dinero—. Mi
  primer lector la dejaba en cero o, peor, la volvía un bono de 200. Ya lee el
  signo, pero **busca ahí**: es el tipo de cosa que se repite.
- **El periodo no se puede reconstruir** (nunca se guardó). Se propone uno
  —termina el día del pago, dura los días pagados— y el aviso pide revisarlo.
  Si el usuario no lo revisa, queda un periodo inventado con cara de dato.
- Cuando el desglose **no cuadra** con el importe, el total se clava
  (`totalManual = g.monto`) en vez de negar la edición. Decidido con Edwin
  después de que él viera botones apagados: el dinero ya salió y el papel tiene
  que existir. **Pero significa que ahora se puede reabrir un pago cuyo
  desglose nadie entiende.**

---

## 4 · Lo demás (más corto)

- **Contraseña en la puerta**: se pide al abrir el panel de nóminas y vale
  mientras esté abierto; cerrarlo la suelta. Cubre pagar y corregir. Los gastos
  fijos la siguen pidiendo por botón (no tienen puerta propia).
- **Visor de recibo en la misma página** (`verReciboEnPagina`): `<iframe srcdoc>`
  con el `window.print()` quitado. VER no imprime.
- **Menú de tres puntos**: cuatro menús que adivinaban su alto restándoselo a la
  ventana; ahora se miden y se abren hacia arriba si no caben (`_colocarMenu`).
- **Totales**: el historial de pagos tiene buscador, y el total —en pantalla
  arriba y abajo, y en el impreso— sale de **la misma cadena**
  (`_nomPanelResumen`).
- **Historial por colaborador** (`abrirHistNomina`) + relación en papel.
- Fuera del módulo: **exportar el costeo de insumos a CSV** (`recetas/insumos.js`,
  22 columnas, BOM, guardia de fórmulas `=+@-`).

---

## 5 · Mis dos errores de estos días, para que sepas qué clase de fallo cometo

1. **La clave de nóminas vigilaba el panel equivocado.** El panel se llama
   `nominas`; escribí `nom`, que es el prefijo del buscador de periodo. El
   guardia no se activó nunca **y mi prueba lo celebró en verde**, porque
   llamaba a `dxAbrir('nom')`: repetía la suposición del código. Ahora la prueba
   lee el nombre del panel **de la tarjeta de la página**.
2. **Me comí tres declaraciones del CSS** (`display:none; position:fixed;
   inset:0` de `.dx-overlay`) con un parche mal anclado. Ningún card del módulo
   abría. **Las 5.326 pruebas pasaron en verde**, porque comprueban conducta y
   eso era presentación. Añadí BH66, que vigila que las tres clases de ventana
   sigan siendo capas.

El patrón de los dos: **la prueba repetía lo que yo creía, en vez de leer lo que
hay.** Si encuentras más de eso, es lo más útil que me puedes decir.

---

## 6 · Qué NO está probado

- Nada de esto se ha ejercitado **en un navegador de verdad** con la v85
  corrida: el candado corre en un DOM simulado. No hay batería CDP para
  `diario.html`.
- **Sin pruebas de red caída** para el par gasto↔recibo.
- **Sin pruebas de concurrencia** (dos pestañas, dos dispositivos).
- El cálculo de nómina en sí (sueldo, prima, retardos, bonos) **no lo toqué**;
  sus pruebas son las de antes.
