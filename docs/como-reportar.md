# Cómo pedir un cambio o reportar un bug

Una captura de pantalla completa cuesta caro. Casi siempre **tres renglones de
texto valen más** — y me dejan encontrar la causa en el código, que es donde
estuvieron casi todos los bugs de verdad.

## La plantilla

```
DÓNDE:    Diario → Ver corte
ESPERABA: que apareciera el botón de conciliar
PASÓ:     no aparece nada abajo del resguardo
```

Con eso basta el 80% de las veces. Si hay un mensaje en pantalla o en la consola,
pégalo tal cual: **una línea de error vale más que cinco capturas.**

## Cuándo SÍ vale la pena la captura

Solo cuando el problema **es cómo se ve**:

- "está feo", "está apretado", "no se entiende"
- algo tapa a otra cosa
- un número se ve mal alineado o cortado

Para eso el texto no sirve y la imagen sí.

## Cuándo NO hace falta

- **"No aparece X"** → dime dónde y qué esperabas. Yo reviso el código.
- **"Sale un error"** → pega el texto del error.
- **"El número está mal"** → dime el número que ves y el que esperabas.
  Ej: *"dice $8.78 de comisión y deberían ser $12.46"*. Con eso reproduzco la
  cuenta exacta en el candado.
- **"Quiero que haga X"** → descríbelo. Una captura de cómo se ve HOY no me dice
  cómo lo quieres mañana.

## Si mandas captura, recórtala

**Solo el pedazo del problema**, no la pantalla entera. Una tarjeta recortada
cuesta una fracción de una captura de 1125×2436, y se entiende mejor.

En Mac: `Cmd + Shift + 4` y arrastras sobre el área.
En iPhone: captura normal → tocar la miniatura → recortar antes de mandarla.

## Cuando algo se rompe en un negocio real

Ahí lo más útil es el diagnóstico, no la foto:

- `_sbColaDiag()` en la consola — estado de la cola de salida
- `_sbDescartes()` — lo que no se pudo guardar y por qué
- `_invDiag()` — estado del inventario abierto

Pega la salida y con eso trabajo.

## Lo que igual conviene mandar aunque cueste

Si dudas, mándala. Un bug mal entendido cuesta más caro que cualquier captura.
Esto es para lo rutinario, no para lo raro.
