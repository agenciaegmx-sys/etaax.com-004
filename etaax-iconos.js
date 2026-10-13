/* ============================================================================
   ETAAX — LOS ICONOS DE LA MARCA, EN UN SOLO LUGAR

   Vienen del repo `iconos-etaax` (agenciaegmx-sys), de las dos propuestas que
   hizo Edwin. Aquí se adoptan tal cual: mismo dibujo, mismo trazo, mismo punto
   verde. Lo único que se normalizó es cómo se NOMBRA el acento, porque llegaba
   con tres nombres para dos cosas distintas:

       .accent / .dot  → RELLENO verde (el punto del usuario, la pupila)
       .g              → TRAZO verde (la línea del candado, la barra alta)
       y un style="stroke:var(--green)" suelto, haciendo lo mismo que .g

   Tres nombres para dos ideas es cómo un icono termina pintado distinto en dos
   pantallas. Aquí son dos, y con prefijo: `.g` ya existe en styles.css para
   otra cosa (el texto verde del título), y una clase de dos letras sin dueño
   choca el día que menos conviene.

       .etx-punto → relleno verde      .etx-trazo → trazo verde

   CÓMO SE USA

       <script src="/etaax-iconos.js"></script>
       ...
       elemento.innerHTML = etaaxIcono('user');            // 24 px
       elemento.innerHTML = etaaxIcono('arrow', {tam:20}); // otro tamaño
       elemento.innerHTML = etaaxIcono('eye', {clase:'mi-clase'});

   El color del trazo SE HEREDA (`stroke: currentColor`): el icono toma el color
   del texto que lo rodea, así que el mismo `arrow` se ve bien sobre el botón
   verde y sobre el fondo oscuro sin una sola línea extra. El verde del acento
   sale de `--green`, el token de siempre.

   POR QUÉ UN SPRITE Y NO UN ARCHIVO .SVG POR ICONO: `<use href="archivo.svg#id">`
   —la forma elegante— no carga en todos los navegadores cuando el archivo es
   externo, y esta app vive en tablets viejas. El sprite va dentro del documento
   y `<use>` apunta a algo que ya está ahí: funciona en todos, y sin una sola
   petición de red por icono.
   ============================================================================ */
(function () {
    /* [viewBox, dibujo]. No se editan a mano: salen del repo de iconos. */
    var SIMBOLOS = {
        'asesor': ['0 0 24 24', '<path d="M7 3h10a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H9l-5 3v-4a4 4 0 0 1-1-3V7a4 4 0 0 1 4-4Z"/><circle class="etx-punto" stroke="none" cx="15" cy="9" r="2.3"/>'],
        'candado': ['0 0 24 24', '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><circle class="etx-punto" stroke="none" cx="12" cy="15" r="1.8"/><path class="etx-trazo" d="M12 15v3"/>'],
        'flecha': ['0 0 24 24', '<path d="M3 12h18m-7-7 7 7-7 7"/>'],
        'ojo-oculto': ['0 0 24 24', '<path d="M8 5.8A10 10 0 0 1 12 5c6.3 0 10 7 10 7a19 19 0 0 1-3.3 4.2M15.8 18.2A10 10 0 0 1 12 19c-6.3 0-10-7-10-7a19 19 0 0 1 3.3-4.2"/><circle class="etx-punto" stroke="none" cx="12" cy="12" r="3"/><path d="m3 3 18 18"/>'],
        'ojo': ['0 0 24 24', '<path d="M2 12s3.7-7 10-7 10 7 10 7-3.7 7-10 7S2 12 2 12Z"/><circle class="etx-punto" stroke="none" cx="12" cy="12" r="3"/>'],
        'usuario': ['0 0 24 24', '<circle class="etx-punto" stroke="none" cx="12" cy="6" r="3.2"/><path d="M4 21v-1a8 8 0 0 1 16 0v1"/>'],
        'administrar': ['0 0 24 24', '<g stroke-width="2"><path d="M3 12h18m-7-7 7 7-7 7"/></g>'],
        'ajustes': ['0 0 24 24', '<g stroke-width="2"><path d="m9 3 1-1h4l1 3 2 1 3-1 2 4-2 2v2l2 2-2 4-3-1-2 1-1 3h-4l-1-3-2-1-3 1-2-4 2-2v-2L2 9l2-4 3 1 2-1Z"/><circle class="etx-punto" stroke="none" cx="12" cy="12" r="3"/></g>'],
        'anadir-sucursal': ['0 0 24 24', '<g stroke-width="2"><path d="M3 11v10h14M2 11l3-7h12l2 5M8 4l-1 7M3 11h8M7 21v-6h4"/><path class="etx-trazo" d="M18 11v10m-5-5h10"/></g>'],
        'catalogos': ['0 0 24 24', '<g stroke-width="2"><path d="M5 18H3V3h14v2M8 21H6V6h14v2"/><rect x="9" y="9" width="13" height="13" rx="2"/><path class="etx-trazo" d="M13 13h5"/><path d="M13 17h5"/></g>'],
        'cerrar-sesion': ['0 0 24 24', '<g stroke-width="2"><path d="M10 3H4v18h6M10 12h11m-4-4 4 4-4 4"/></g>'],
        'finanzas': ['0 0 24 24', '<g stroke-width="2"><path d="M3 3v18h19M7 17v-5m5 5V8"/><path class="etx-trazo" d="M17 17V4" style="stroke-width:3.4"/><circle class="etx-punto" stroke="none" cx="17" cy="4" r="1.7"/></g>'],
        'matriz': ['0 0 24 24', '<g stroke-width="2"><path d="M3 12v9h17v-9M2 12l3-6h11l3 6H2M8 6l-1 6m6-6 1 6M6 16h3"/><path class="etx-trazo" d="M12 21v-6h4v6M19 11V2h4l-1 2 1 2h-4"/></g>'],
        'perfil': ['0 0 24 24', '<g stroke-width="2"><circle class="etx-punto" stroke="none" cx="12" cy="6" r="3.2"/><path d="M4 21v-1a8 8 0 0 1 16 0v1"/></g>'],
        'privacidad': ['0 0 24 24', '<g stroke-width="2"><path d="m12 2 8 3v6c0 5-4 9-8 11-4-2-8-6-8-11V5Z"/><rect class="etx-trazo" x="9" y="10" width="6" height="6" rx="1.4"/><path class="etx-trazo" d="M10 10V8a2 2 0 0 1 4 0v2"/></g>'],
        'restaurante': ['0 0 24 24', '<g stroke-width="2"><circle cx="12" cy="12" r="6"/><circle class="etx-punto" stroke="none" cx="12" cy="12" r="2.6"/><path d="M2 3v6m3-6v6M2 6h3M3.5 9v12M22 3c-2 2-2 5-2 8h2V3v18"/></g>'],
        'sucursal': ['0 0 24 24', '<g stroke-width="2"><path d="M4 10v11h16V10M2 10l3-7h14l3 7H2M8 3l-1 7m9-7 1 7M4 15h4"/><path class="etx-trazo" d="M12 21v-7h5v7"/></g>'],
        'giro-ambulante': ['0 0 24 24', '<g stroke-width="1.8"><path d="M3 14h15v6H3Zm9-6v6M2 8c1-7 19-7 20 0H2Z"/><circle cx="6" cy="21" r="1.5"/><circle cx="16" cy="21" r="1.5"/><path class="etx-trazo" d="M8 8c0-5 8-5 8 0M6 17h8"/></g>'],
        'giro-bar': ['0 0 24 24', '<g stroke-width="1.8"><path d="m3 5 9 10 9-10H3Zm9 10v6m-4 1h8"/><path class="etx-trazo" d="M7 9h10m-3 0 3-7"/></g>'],
        'giro-bistro': ['0 0 24 24', '<g stroke-width="1.8"><path d="M5 11h14M8 11v10m8-10v10M2 13v7h3m17-7v7h-3"/><path class="etx-trazo" d="M12 10V6m-2-3h4l-1 3h-2Z"/></g>'],
        'giro-cafeteria': ['0 0 24 24', '<g stroke-width="1.8"><path d="M4 9h12v6a6 6 0 0 1-12 0V9Zm12 1h2a3 3 0 0 1 0 6h-2M3 22h15"/><path class="etx-trazo" d="M8 6V3m4 3V2"/></g>'],
        'giro-cantina': ['0 0 24 24', '<g stroke-width="1.8"><path d="M5 3h4v5l2 3v10H3V11l2-3V3Zm0 0V2h4v1M15 12h6l-1 9h-4Z"/><path class="etx-trazo" d="M3 15h8m5 1h4"/></g>'],
        'giro-cedis': ['0 0 24 24', '<g stroke-width="1.8"><path d="m2 9 10-7 10 7M4 8v14h16V8M8 22v-9h8v9"/><path class="etx-trazo" d="M9 17h6m-3-4v4"/></g>'],
        'giro-cerveceria': ['0 0 24 24', '<g stroke-width="1.8"><path d="M4 9h12v12H4V9Zm12 2h3a3 3 0 0 1 0 6h-3M4 9c-4-4 2-8 5-5 3-4 8-1 7 5"/><path class="etx-trazo" d="M8 12v6m4-6v6"/></g>'],
        'giro-cocina-entrega': ['0 0 24 24', '<g stroke-width="1.8"><path d="M3 7h14v15H3V7Zm4 0V5a3 3 0 0 1 6 0v2"/><path class="etx-trazo" d="M10 14h12m-3-3 3 3-3 3"/></g>'],
        'giro-fonda': ['0 0 24 24', '<g stroke-width="1.8"><path d="M4 11h16v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5v-5ZM2 12h2m16 0h2M3 8h18m-12 0V6h6v2"/><path class="etx-trazo" d="M9 3V1m6 2V1"/></g>'],
        'giro-foodtruck': ['0 0 24 24', '<g stroke-width="1.8"><path d="M2 5h13v14H2V5Zm13 6h4l3 5v3h-7M19 11v5h3"/><circle cx="6" cy="20" r="2"/><circle cx="18" cy="20" r="2"/><path class="etx-trazo" d="M5 8h7v6H5V8Zm0 3h7"/></g>'],
        'giro-fuente-sodas': ['0 0 24 24', '<g stroke-width="1.8"><path d="M6 8h12l-2 13H8L6 8Zm-1 0h14"/><path class="etx-trazo" d="M13 8V3h6M8 12h8"/><circle class="etx-punto" stroke="none" cx="11" cy="16" r="1"/><circle class="etx-punto" stroke="none" cx="14" cy="14.5" r=".8"/></g>'],
        'giro-jugueria': ['0 0 24 24', '<g stroke-width="1.8"><path d="M3 9h11l-2 13H5L3 9Zm5 0V3h5"/><circle class="etx-trazo" cx="18" cy="8" r="4"/><path class="etx-trazo" d="M18 4v8m-4-4h8M4 14h9"/></g>'],
        'giro-marisqueria': ['0 0 24 24', '<g stroke-width="1.8"><path d="M3 11c5-7 11-7 16 0-5 7-11 7-16 0Zm16 0 3-4v8l-3-4Z"/><circle class="etx-punto" stroke="none" cx="7" cy="10" r="1.2"/><path class="etx-trazo" d="M3 20c3-3 4 3 7 0s4 3 7 0 3 1 4 0"/></g>'],
        'giro-neveria': ['0 0 24 24', '<g stroke-width="1.8"><path d="m6 11 6 11 6-11H6Zm2 0a4 4 0 1 1 8 0"/><path class="etx-trazo" d="M6 10C0 7 7 0 10 4c3-6 10 0 8 4 4 0 3 4 0 4"/></g>'],
        'giro-panaderia': ['0 0 24 24', '<g stroke-width="1.8"><path d="M3 12c0-9 18-9 18 0v5a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4v-5Z"/><path class="etx-trazo" d="m7 12 2-4m2 5 2-5m2 5 2-4"/></g>'],
        'giro-pizzeria': ['0 0 24 24', '<g stroke-width="1.8"><path d="M3 6c5-4 13-4 18 0l-9 16L3 6Zm2 3c4-3 10-3 14 0"/><circle class="etx-punto" stroke="none" cx="10" cy="11" r="1.4"/><circle class="etx-punto" stroke="none" cx="14" cy="12" r="1.2"/><circle class="etx-punto" stroke="none" cx="12" cy="16" r="1"/></g>'],
        'giro-reposteria': ['0 0 24 24', '<g stroke-width="1.8"><path d="M4 12h16v9H4Zm-2 10h20M4 15c2 3 4-3 6 0s4-3 6 0 3-1 4 0"/><path class="etx-trazo" d="M8 12V8h8v4M12 8V4"/><circle class="etx-punto" stroke="none" cx="12" cy="2.5" r="1.2"/></g>'],
        'giro-restaurante-bar': ['0 0 24 24', '<g stroke-width="1.8"><circle cx="8" cy="13" r="5"/><ellipse cx="2" cy="5" rx="1.3" ry="2.8"/><path d="M2 8v12m18-5v6m-3 1h6m-7-16 4 9 3-9h-7Z"/><circle class="etx-punto" stroke="none" cx="8" cy="13" r="2"/><path class="etx-trazo" d="M17 9h5"/></g>'],
        'giro-rosticeria': ['0 0 24 24', '<g stroke-width="1.8"><path d="M2 13h20M4 10v10m16-10v10M2 21h20M8 13c-3-8 8-9 9-3s-6 9-9 3Z"/><path class="etx-trazo" d="m15 8 3-3m-1 1 2 1m-8 3 2 3"/></g>'],
        'giro-taqueria': ['0 0 24 24', '<g stroke-width="1.8"><path d="M2 18a10 10 0 0 1 20 0H2Zm3 3h14"/><path class="etx-trazo" d="m6 14 2-2 2 1 2-2 2 2 2-1 2 2"/></g>'],
        'org-cadena': ['0 0 24 24', '<g stroke-width="1.8"><rect x="2" y="8" width="5" height="8" rx="2"/><rect x="9.5" y="8" width="5" height="8" rx="2"/><rect x="17" y="8" width="5" height="8" rx="2"/><path class="etx-trazo" d="M7 12h2.5m5 0H17"/></g>'],
        'org-cedis': ['0 0 24 24', '<g stroke-width="1.8"><rect x="8" y="8" width="8" height="8" rx="2"/><path class="etx-trazo" d="M12 8V2m-2 2 2-2 2 2M16 12h6m-2-2 2 2-2 2M12 16v6m-2-2 2 2 2-2M8 12H2m2-2-2 2 2 2"/></g>'],
        'org-corporativo': ['0 0 24 24', '<g stroke-width="1.8"><rect x="8" y="8" width="8" height="8" rx="2"/><path d="M12 8V3M8 12H3m13 0h5m-9 4v5"/><circle class="etx-punto" stroke="none" cx="12" cy="3" r="2"/><circle cx="3" cy="12" r="2"/><circle cx="21" cy="12" r="2"/><circle cx="12" cy="21" r="2"/></g>'],
        'org-franquicia': ['0 0 24 24', '<g stroke-width="1.8"><circle class="etx-trazo" cx="12" cy="5" r="3"/><path d="M12 8v4H4m8 0h8M4 12v4m8-4v4m8-4v4"/><rect x="2" y="16" width="4" height="5" rx="1"/><rect x="10" y="16" width="4" height="5" rx="1"/><rect x="18" y="16" width="4" height="5" rx="1"/></g>'],
        'org-mixto': ['0 0 24 24', '<g stroke-width="1.8"><circle class="etx-trazo" cx="12" cy="12" r="3"/><path d="m10 10-5-5m9 5 5-5m-9 9-5 5m9-5 5 5"/><circle cx="4" cy="4" r="2"/><rect x="18" y="2" width="4" height="4" rx="1"/><path d="m2 22 2-5 2 5H2"/><rect x="18" y="18" width="4" height="4" rx="1"/></g>'],
        'org-pyme': ['0 0 24 24', '<g stroke-width="1.8"><circle cx="12" cy="10" r="5"/><path d="M5 21v-2l4-5m10 7v-2l-4-5"/><circle class="etx-punto" stroke="none" cx="12" cy="10" r="2"/></g>'],
        'hd-desplegar': ['0 0 24 24', '<g stroke-width="2"><path d="m6 9 6 6 6-6"/></g>'],
        'hd-inicio': ['0 0 24 24', '<g stroke-width="2"><path d="m3 10 9-7 9 7v11H3V10Z"/><path class="etx-trazo" d="M9 21v-7h6v7"/></g>'],
        'hd-luna': ['0 0 24 24', '<g stroke-width="2"><path d="M18 16A8 8 0 0 1 8 4a9 9 0 1 0 10 12Z"/><circle class="etx-punto" stroke="none" cx="17" cy="5" r="2"/></g>'],
        'hd-sistema': ['0 0 24 24', '<g stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="3"/><path d="M12 17v4m-5 1h10"/><circle class="etx-punto" stroke="none" cx="17" cy="7" r="1.5"/></g>'],
        'hd-sol': ['0 0 24 24', '<g stroke-width="2"><circle class="etx-punto" stroke="none" cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></g>'],
    };

    var ID = 'etaax-sprite-iconos';

    function pintarSprite() {
        if (document.getElementById(ID)) return;        // una sola vez por página
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('id', ID);
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('width', '0');
        svg.setAttribute('height', '0');
        svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
        var defs = '';
        for (var k in SIMBOLOS) {
            if (!SIMBOLOS.hasOwnProperty(k)) continue;
            defs += '<symbol id="etx-' + k + '" viewBox="' + SIMBOLOS[k][0] + '">' +
                    SIMBOLOS[k][1] + '</symbol>';
        }
        svg.innerHTML = '<defs>' + defs + '</defs>';
        (document.body || document.documentElement).appendChild(svg);
    }

    function pintarEstilo() {
        if (document.getElementById(ID + '-css')) return;
        var st = document.createElement('style');
        st.id = ID + '-css';
        /* El grosor y los remates son los del diseño original (2.3, redondos).
           Van aquí y no en styles.css para que el archivo sea uno solo: quien
           incluya el script tiene los iconos completos, sin depender de que
           además haya cargado la hoja de estilos correcta. */
        /* ══ OJO CON EL SELECTOR: TIENE QUE SER SIMPLE ══════════════════════
           `<use>` no pega el dibujo en la página: hace una COPIA aparte, en una
           especie de compartimento propio. Lo que SÍ cruza hacia esa copia son
           las propiedades que se heredan —`fill`, `stroke`, `color`— y por eso
           el contorno toma el color del texto que lo rodea.

           Lo que NO cruza es un selector con descendencia. La primera versión
           de esto decía `.etx-ic .etx-punto`, y ese espacio obliga a saltar
           desde el <svg> de la página hasta dentro de la copia: el salto no
           existe, la regla nunca aplicó, y el punto verde se quedó sin color
           heredando el `fill:none` del contorno. En pantalla: un aro hueco en
           vez de un punto verde. Se veía como «sigue el icono viejo».

           Por eso `.etx-punto` y `.etx-trazo` van SOLOS. El prefijo ya evita
           que choquen con nada; no hacía falta anidarlos, y anidarlos los
           apagaba. */
        /* ══ EL COLOR DEL TRAZO LO DECIDE EL ICONO, NO EL BOTÓN ════════════
           `stroke:currentColor` solo no alcanza: el icono heredaba el color del
           texto que lo rodeara, y media pantalla usa gris apagado a propósito
           para sus botones. Resultado: iconos en gris oscuro sobre fondo
           oscuro, invisibles — y en el tema claro, al revés.

           La referencia de Edwin es clara: trazo CREMA sobre oscuro, con el
           verde solo en el acento. O sea, el color del TEXTO principal, que ya
           cambia solo entre los dos temas (#f0ece4 ↔ #1a1916). Eso es lo que se
           pone aquí, y gana sobre lo que herede del botón.

           Y donde el icono SÍ debe tomar otro color —la flecha sobre el botón
           verde, el icono de una sucursal con su color propio— se le dice con
           `--etx-color`, que es una variable y por lo tanto SÍ se hereda hacia
           dentro de la copia que hace `<use>`. Un color escrito en el botón no
           entraría; una variable sí. */
        st.textContent =
            '.etx-ic{width:24px;height:24px;flex-shrink:0;fill:none;' +
            'color:var(--etx-color, var(--text, #f0ece4));stroke:currentColor;' +
            'stroke-width:2.3;stroke-linecap:round;stroke-linejoin:round}' +
            '.etx-punto{fill:var(--green,#3DBE7A);stroke:none}' +
            '.etx-trazo{stroke:var(--green,#3DBE7A)}';
        (document.head || document.documentElement).appendChild(st);
    }

    function listo() { pintarEstilo(); pintarSprite(); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', listo);
    else listo();

    /* Devuelve el marcado de un icono. Si el nombre no existe devuelve CADENA
       VACÍA y lo dice en consola: un icono que no está no puede dejar un hueco
       con el nombre escrito dentro, y sobre todo no puede dejar pasar texto de
       nadie a un innerHTML. Por eso el nombre se busca en la lista —no se
       concatena— y el tamaño y la clase se limpian antes de usarse. */
    window.etaaxIcono = function (nombre, opc) {
        opc = opc || {};
        if (!SIMBOLOS.hasOwnProperty(String(nombre))) {
            if (window.console) console.warn('[etaax] icono desconocido: ' + nombre);
            return '';
        }
        var t = parseInt(opc.tam, 10); if (!(t > 0 && t <= 512)) t = 24;
        var cl = String(opc.clase || '').replace(/[^A-Za-z0-9 _-]/g, '');
        return '<svg class="etx-ic' + (cl ? ' ' + cl : '') + '" width="' + t + '" height="' + t +
               '" aria-hidden="true"><use href="#etx-' + nombre + '"></use></svg>';
    };

    /* Los nombres disponibles, para que una pantalla pueda preguntar en vez de
       adivinar (y para que el candado los recorra). */
    window.etaaxIconos = function () {
        var l = []; for (var k in SIMBOLOS) if (SIMBOLOS.hasOwnProperty(k)) l.push(k);
        return l.sort();
    };
})();
