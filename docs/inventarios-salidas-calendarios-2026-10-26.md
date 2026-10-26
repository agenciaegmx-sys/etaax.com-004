# Inventarios: salidas por botella y calendarios — 26 de octubre de 2026

- El tema compartido aplica `color-scheme` a los controles nativos de fecha/hora y elimina los filtros de inversión locales. En oscuro el icono es blanco; en claro es negro. También se aplica a controles creados después de cargar una página y dentro de ventanas flotantes.
- Paso 3, captura directa por insumo: comentarios de venta, botellas de cortesía y botellas de merma en búsqueda y lista. Los comentarios usan tipografía normal, persisten por inventario y aparecen en el resultado y su desglose impreso.
- Las botellas se suman a las copas/onzas sueltas; no son otra representación del mismo campo. Se reutiliza `EtaaxCore.cantidadFilaInventario` con el contenido y tamaño de copa del insumo.

## Contrato de datos

`cortesiaCopas` y `mermaCopas` siguen siendo el total canónico que descuentan las existencias, el reparto de prebatch y los reportes:

```
total = manual suelto + QR + botellas × contenido / tamaño de copa
```

`cortesiaBotella` / `mermaBotella` guardan la cantidad explícita de botellas; `_cortesiaBotCopas` / `_mermaBotCopas` guardan su aporte anterior. Al recalcular QR o cambiar los parámetros del catálogo se quita ese aporte anterior antes de sumar el nuevo. Los inventarios antiguos no necesitan migración. Se conserva la presencia de los campos nuevos aun en cero/vacío para poder guardar su eliminación sin que la protección contra vaciados accidentales restaure el dato anterior.

Ejemplo: botella de 700 ml, copa de 45 ml. Una cortesía de 1 botella + 3 copas descuenta 835 ml. Dos botellas de merma + 4 copas descuentan 1,580 ml. Si el QR registra una salida adicional, se agrega una vez aunque se recalcule o reabra el inventario.

## Verificación

```sh
node tests/money-tests.js
node tests/store-tests.js
ETAAX_PRUEBA_SALIDAS=1 node tests/probar-ventanas-insumos.cjs
node versionar.js --revisar
```

Pruebas de cálculo: botellas de 700/750/1,750 ml, copas de 45/60/150 ml, onzas, edición/borrado, cambios del QR, medidas actualizadas, compatibilidad con filas antiguas y cerveza por pieza. La prueba de navegador usa Chrome con Supabase simulado: escritorio/móvil, guardado y recarga reales de la página, borrado de la última salida y calendario oscuro/claro en inventarios, diario, ventas financieras e insumos. No modifica datos de clientes.
