# Equivalencias en productos agrupados — 7 de noviembre de 2026

Se agregó el desglose de botellas, onzas y copas debajo de **existencia actual** y **diferencia** en:

- La fila del compuesto y cada presentación desplegada del Resultado.
- La tarjeta agrupada de Galería.
- El total del compuesto en el impreso de desglose; sus presentaciones ya tenían equivalencias.

Cada presentación se convierte usando `EtaaxCore.equivalenciasBarra`, con su contenido de botella y su tamaño de copa. Luego se suman esas equivalencias, sin redondear hasta mostrarlas. No se usa la capacidad ni la copa del primer miembro para convertir el grupo entero.

Ejemplo: media botella de 950 ml + una de 700 ml = **1.50 bot · 39.7 oz · 26.1 cp**, si ambas copas son de 45 ml. Una diferencia de +1 copa de la presentación de 950 ml = **+0.05 bot · +1.5 oz · +1.0 cp**.

Las diferencias se suman con signo en cada unidad. Si las copas tienen tamaños distintos, pueden compensarse en número de copas sin compensarse en volumen. Si falta una referencia, no se muestra una suma parcial como total. Los productos por pieza o peso mantienen sus unidades existentes.

Este cambio añade información visual; no cambia existencias, consumo, cancelaciones, porcentajes ni importes.

Validación: 12 casos nuevos en `tests/inventarios-compuestos-equivalencias.cjs`, incluidos en `money-tests.js`: HTML real de la tabla y galería, salida real del reporte, envases y copas diferentes, signos, referencias incompletas y conservación de datos/importes. La suite completa pasó 5,431 comprobaciones. También se revisó visualmente el grupo desplegado en Chrome y se actualizó la huella de caché del JavaScript.
