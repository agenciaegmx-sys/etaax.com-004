/* ============================================================================
   ETAAX — etaaxJsArg(v): un dato dentro de un onclick, sin que se vuelva código

   EL PROBLEMA QUE RESUELVE
   Los paneles arman sus botones concatenando HTML:

       '<button onclick="borrar(\'' + fila.id + '\')">'

   Ese `fila.id` termina DENTRO de una cadena de JavaScript que a su vez va
   dentro de un atributo HTML. Son DOS lenguajes anidados, y el navegador los
   lee en ese orden: primero el parser de HTML decodifica las entidades del
   atributo, y lo que queda se lo entrega al parser de JavaScript.

   Por eso un id como   n');alert(1);//   cierra la cadena, cierra la llamada y
   escribe instrucciones nuevas. No hace falta una etiqueta <script>: el
   atributo YA es un contexto ejecutable.

   POR QUÉ NO SIRVE `etx()` (NI `esc()`)
   `etx()` escapa la comilla simple como `&#39;`. Eso es correcto para TEXTO
   —entre dos etiquetas no pasa nada— pero aquí el parser de HTML la
   DESCODIFICA antes de que JavaScript la vea: `&#39;` vuelve a ser `'` y la
   cadena se rompe igual. Escapar para HTML no es escapar para JavaScript, y
   esa confusión es justo la que deja la puerta abierta.

   CÓMO LO HACE
   En el orden en que el navegador lo va a deshacer, pero al revés:
     1. nivel JavaScript — la barra invertida primero (si no, duplicaría lo
        que viene después), luego la comilla y los saltos de línea, que
        también cortan una cadena;
     2. nivel HTML — `&`, `"`, `<` y `>`, para que nada pueda salirse del
        atributo ni cerrar un <script> que contenga la página.
   Al descodificar, el parser de HTML devuelve exactamente la cadena del paso
   1, y JavaScript recibe un literal con todo escapado.

   DÓNDE VA
   Entre comillas SIMPLES dentro de un atributo con comillas DOBLES, que es el
   patrón de todo el sistema:  onclick="fn('<aquí>')"
   Para texto normal se sigue usando `etx()`; esto es solo para argumentos.
   ============================================================================ */
window.etaaxJsArg = function (v) {
    return String(v == null ? '' : v)
        /* 1 · que sea un literal de JavaScript válido */
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n')
        /* Estos dos son saltos de línea para JavaScript aunque no lo parezcan:
           sin escaparlos, un id que los traiga parte la cadena en dos. */
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029')
        /* 2 · que no pueda salirse del atributo */
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
};
