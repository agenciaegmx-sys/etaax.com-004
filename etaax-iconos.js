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
        'add': ['0 0 24 24', '<path d="M3 11v10h14M2 11l3-7h12l2 5M8 4l-1 7M3 11h8M7 21v-6h4"/><path class="etx-trazo" d="M18 11v10m-5-5h10"/>'],
        'arrow': ['0 0 24 24', '<path d="M3 12h18m-7-7 7 7-7 7"/>'],
        'branch': ['0 0 24 24', '<path d="M4 10v11h16V10M2 10l3-7h14l3 7H2M8 3l-1 7m9-7 1 7M4 15h4"/><path class="etx-trazo" d="M12 21v-7h5v7"/>'],
        'catalog': ['0 0 24 24', '<path d="M5 18H3V3h14v2M8 21H6V6h14v2"/><rect x="9" y="9" width="13" height="13" rx="2"/><path class="etx-trazo" d="M13 13h5"/><path d="M13 17h5"/>'],
        'eye': ['0 0 24 24', '<path d="M2 12s3.7-7 10-7 10 7 10 7-3.7 7-10 7S2 12 2 12Z"/><circle class="etx-punto" cx="12" cy="12" r="3"/>'],
        'eye-off': ['0 0 24 24', '<path d="M8 5.8A10 10 0 0 1 12 5c6.3 0 10 7 10 7a19 19 0 0 1-3.3 4.2M15.8 18.2A10 10 0 0 1 12 19c-6.3 0-10-7-10-7a19 19 0 0 1 3.3-4.2"/><circle class="etx-punto" cx="12" cy="12" r="3"/><path d="m3 3 18 18"/>'],
        'finance': ['0 0 24 24', '<path d="M3 3v18h19M7 17v-5m5 5V8"/><path class="etx-trazo" d="M17 17V4" style="stroke-width:3.4"/><circle class="etx-punto" cx="17" cy="4" r="1.7"/>'],
        'lock': ['0 0 24 24', '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><circle class="etx-punto" cx="12" cy="15" r="1.8"/><path d="M12 15v3" class="etx-trazo"/>'],
        'logout': ['0 0 24 24', '<path d="M10 3H4v18h6M10 12h11m-4-4 4 4-4 4"/>'],
        'main': ['0 0 24 24', '<path d="M3 12v9h17v-9M2 12l3-6h11l3 6H2M8 6l-1 6m6-6 1 6M6 16h3"/><path class="etx-trazo" d="M12 21v-6h4v6M19 11V2h4l-1 2 1 2h-4"/>'],
        'restaurant': ['0 0 24 24', '<circle cx="12" cy="12" r="6"/><circle class="etx-punto" cx="12" cy="12" r="2.6"/><path d="M2 3v6m3-6v6M2 6h3M3.5 9v12M22 3c-2 2-2 5-2 8h2V3v18"/>'],
        'settings': ['0 0 24 24', '<path d="m9 3 1-1h4l1 3 2 1 3-1 2 4-2 2v2l2 2-2 4-3-1-2 1-1 3h-4l-1-3-2-1-3 1-2-4 2-2v-2L2 9l2-4 3 1 2-1Z"/><circle class="etx-punto" cx="12" cy="12" r="3"/>'],
        'shield': ['0 0 24 24', '<path d="m12 2 8 3v6c0 5-4 9-8 11-4-2-8-6-8-11V5Z"/><rect class="etx-trazo" x="9" y="10" width="6" height="6" rx="1.4"/><path class="etx-trazo" d="M10 10V8a2 2 0 0 1 4 0v2"/>'],
        'user': ['0 0 24 24', '<circle class="etx-punto" cx="12" cy="6" r="3.2"/><path d="M4 21v-1a8 8 0 0 1 16 0v1"/>'],
        'asesor': ['0 0 24 24', '<path d="M7,3L17,3C19.194,3 21,4.806 21,7L21,15C21,17.194 19.194,19 17,19L9,19L4,22L4,18C3.269,17.18 2.907,16.094 3,15L3,7C3,4.806 4.806,3 7,3Z"/><circle class="etx-punto" cx="15" cy="9" r="2.3"/>'],
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
        st.textContent =
            '.etx-ic{width:24px;height:24px;flex-shrink:0;fill:none;stroke:currentColor;' +
            'stroke-width:2.3;stroke-linecap:round;stroke-linejoin:round}' +
            '.etx-ic .etx-punto{fill:var(--green,#3DBE7A);stroke:none}' +
            '.etx-ic .etx-trazo{stroke:var(--green,#3DBE7A)}';
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
