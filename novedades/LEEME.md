# Las capturas del anuncio de novedades

Aquí van las fotos que acompañan a «Actualizamos el sistema, ve las novedades».
El recuadro lo arma [`/novedades.js`](../novedades.js); este folder es solo el
álbum.

## Qué hacer

Arrastra cada captura aquí **con el nombre exacto** de la tabla. Nada más: la
pantalla ya las está esperando y no hay que tocar código.

| # | Novedad | Capturas |
|---|---|---|
| 1 | Un nuevo diseño, desde que entras | `01-acceso.png` |
| 2 | Una barra arriba, igual en todo el sistema | `02-barra-1.png` |
| 3 | Tu cuenta, tu plan y tu salida | `03-cuenta-1/2/3.png` |
| 4 | Tu organización, y el giro de cada sucursal | `04-sucursales.png` |
| 5 | Los accesos globales, con su propia entrada | `05-globales-2/3.png` |
| 6 | Una guía de operación en tu inicio | `05-globales-1.png` |
| 7 | Tus cuatro módulos, y una vista previa de cada uno | `06-modulos-1/2.png` |
| 8 | Una barra lateral dentro del módulo | `07-lateral.png` |
| 9 | Cambiar de módulo sin perder tu sucursal | `08-cambiar-1/2.png` |
| 10 | Un botón para volver, siempre en el mismo sitio | `09-inicio-1/2.png` |
| 11 | Iconos propios de ETAAX | `11-iconos.png` |
| 12 | Los reportes avisan si leyeron todo | — |
| 13 | Freno a quien intente adivinar un NIP | — |

**Las dos últimas no llevan captura**, y está bien: no hay foto de «ahora el
reporte lee hasta el final». Sin captura no se dibuja marco — un recuadro vacío
al lado de su texto parecería un error, no una novedad sin foto. Si alguna de
las tres merece una, se agrega a su `fotos: []` y aparece sola.

**Un solo par de botones.** «Siguiente» recorre las capturas de la novedad y,
cuando se acaban, pasa a la siguiente; «Atrás» desanda lo mismo y cae en la
ÚLTIMA captura de la anterior, porque volver es regresar por donde se vino. El
recorrido completo son **19 pasos**.

## Cómo se llama esta actualización

**ETAAX 2.0 · Mise en Place.** Las grandes llevan número y nombre: el número
ordena —2.0 es la primera después de la etapa de desarrollo— y el nombre es el
que la gente repite («la de Mise en Place»). Un «2026.10» no se le queda a
nadie.

*Mise en place* es el término que todo cocinero conoce: tener **todo en su lugar
antes del servicio**. Es exactamente lo que hizo esta versión —cada herramienta,
cada título y cada botón en su sitio— y habla el idioma del negocio al que se le
está anunciando.

El **número manda también por dentro**: es la marca de «ya lo vi», así que
subirlo vuelve a anunciar a todo el mundo. Una actualización chica sube el
decimal (2.1) y no necesita nombre. Se cambian en `NUMERO` y `NOMBRE`, arriba de
`novedades.js`.

## Cuándo sale, y por cuánto tiempo

Al iniciar sesión aparece una **portada**: qué se actualizó, la pregunta
«¿Quieres ver las novedades?» y dos salidas — **Ver novedades** y **Omitir
novedades**.

Sale en **cada inicio de sesión durante tres días** desde la publicación, lo
haya visto o no: un anuncio que solo sale una vez se lo pierde quien ese día
entró con prisa. Lo que no hace es insistir dos veces en la misma sesión.

La cuenta arranca sola el día del push, porque se mide contra la misma `FECHA`
que el hook de pre-commit estampa al publicar. **Si se vuelve a publicar dentro
de esos tres días, la ventana se reinicia** — es a propósito: la referencia es
siempre la última publicación.

Pasados los tres días deja de asomarse, pero **no desaparece**: sigue en el menú
de la cuenta para quien quiera verlo o repasarlo.

Para cambiar la duración: `VIGENCIA_ANUNCIO` en `novedades.js`.

## Reglas de la foto

- **Proporción 16:9.** El marco la recorta al centro si viene de otra forma, así
  que lo importante va al medio, no en una esquina.
- **1600 × 900 px está de sobra**, y pesa poco. Una captura de pantalla de 4 MB
  hace que el anuncio tarde más que el sistema.
- **`.png` para pantallas** (texto nítido). `.jpg` solo si es una foto real.
- **Nada de datos de clientes.** Esto lo ve todo el mundo al entrar: si la
  captura trae nombres, teléfonos o importes de un negocio de verdad, cámbialos
  antes. Un negocio de prueba es la forma fácil.
- **El tema oscuro se ve mejor** sobre el recuadro, que también es oscuro — pero
  si la novedad es justo el tema claro, esa va en claro, obvio.

## Mientras no estén

No pasa nada: cada novedad se muestra con su texto y un marco que dice «captura
en camino», del mismo tamaño que tendrá la foto. Lo que **no** se ve nunca es el
icono de imagen rota del navegador, que es la forma más rápida de que una buena
noticia parezca un error.

## Para verlo otra vez

En la consola del navegador:

```js
EtaaxNovedades.olvidar()   // y recargar
```

O desde el menú de la cuenta → **Novedades**, que está siempre disponible.

## El interruptor del anuncio

`VERSION` arriba de `novedades.js`. Al subirla, **todos** vuelven a ver el
aviso una vez. Es una línea: no hay que ir borrando nada por usuario.
