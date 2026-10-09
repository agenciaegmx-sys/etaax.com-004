/* ============================================================================
   ETAAX — EL TEMA DE LA CARTA PÚBLICA (window.CartaTema)

   La carta del QR es lo único de ETAAX que ve un cliente en la mesa, y tiene
   que parecer del restaurante, no del sistema. Aquí viven los colores, las
   tipografías y los estilos por campo (nombre, descripción, precio).

   UNA SOLA VERDAD, dos consumidores:
     · administrativo/menu.html → la maqueta de teléfono del editor
     · carta.html               → lo que de verdad abre el cliente
   Las dos piden el MISMO bloque de variables CSS con `CartaTema.vars(tema)`.
   Si el editor y la carta calcularan sus colores por separado, la maqueta
   mentiría — y una maqueta que miente es peor que no tenerla.

   LOS COLORES DERIVADOS SE CALCULAN, NO SE ESCRIBEN. El tema solo guarda
   cuatro colores (fondo, tarjeta, texto, acento); el gris de la letra chica y
   el de las líneas salen de MEZCLAR el texto con el fondo. Así el mismo tema
   funciona en oscuro y en claro: quien elija fondo blanco no se queda con
   bordes negros ni con grises invisibles.

   LAS TIPOGRAFÍAS SON SOLO LAS QUE YA ESTÁN. Las dos de la marca (Bebas Neue
   y DM Sans, que la página carga de Google Fonts) y las que trae cualquier
   teléfono. Ofrecer una fuente que hay que bajar significa que el nombre del
   platillo aparece medio segundo después que la foto; en la mesa, con el
   mesero esperando, eso se ve como una carta rota. Y la CSP del sitio solo
   deja hojas de estilo de Google Fonts, así que una fuente de otro CDN
   tampoco cargaría en producción.
   ============================================================================ */
(function () {

    var DEF = {
        fondo:'#13120f', tarjeta:'#1b1915', texto:'#f0ece4', acento:'#c9a227',
        fuente:'dm', fuenteTit:'bebas',
        nomB:1, nomI:0, nomC:'',
        desB:0, desI:1, desC:'',
        preB:1, preI:0, preC:''
    };

    var FUENTES = [
        { k:'dm',    lbl:'DM Sans',            css:"'DM Sans',system-ui,sans-serif" },
        { k:'bebas', lbl:'Bebas Neue',         css:"'Bebas Neue','DM Sans',sans-serif" },
        { k:'serif', lbl:'Serif clásica',      css:"Georgia,'Times New Roman',serif" },
        { k:'mono',  lbl:'Máquina de escribir',css:"ui-monospace,'Courier New',monospace" },
        { k:'sis',   lbl:'La del teléfono',    css:"system-ui,-apple-system,sans-serif" }
    ];

    /* Devuelve la clave si está en el catálogo, '' si no. Una fuente inventada
       —de una versión futura del editor, o de alguien escribiendo en la fila a
       mano— cae al default en vez de dejar la carta sin tipografía. */
    function _conocida(k) {
        for (var i = 0; i < FUENTES.length; i++) if (FUENTES[i].k === k) return k;
        return '';
    }

    function fuente(k) {
        for (var i = 0; i < FUENTES.length; i++) if (FUENTES[i].k === k) return FUENTES[i].css;
        return FUENTES[0].css;
    }

    /* Un hex válido o nada. Lo que llega de la fila de la base de datos lo
       escribió el editor, pero igual se filtra: esto termina dentro de un
       atributo `style`, y un valor sin revisar ahí es una puerta abierta. */
    function hex(v, fb) {
        v = String(v == null ? '' : v).trim();
        if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
        if (/^#[0-9a-fA-F]{3}$/.test(v)) {
            return ('#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3]).toLowerCase();
        }
        return fb || '';
    }

    function rgb(h) {
        h = hex(h, '#000000');
        return [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
    }
    function hx(n) { n = Math.max(0, Math.min(255, Math.round(n))); return (n < 16 ? '0' : '') + n.toString(16); }

    /* Mezcla `a` sobre `b`: p=1 devuelve `a`, p=0 devuelve `b`. */
    function mix(a, b, p) {
        var x = rgb(a), y = rgb(b);
        return '#' + hx(x[0]*p + y[0]*(1-p)) + hx(x[1]*p + y[1]*(1-p)) + hx(x[2]*p + y[2]*(1-p));
    }

    /* Luminancia relativa y contraste, como los define WCAG. Sirve para el
       aviso del editor: un texto a 2:1 contra su fondo se ve bien en el
       monitor del dueño y no se lee en la mesa, de noche, con brillo bajo. */
    function lum(h) {
        return rgb(h).map(function (v) {
            v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4);
        }).reduce(function (a, c, i) { return a + c * [0.2126, 0.7152, 0.0722][i]; }, 0);
    }
    function contraste(a, b) {
        var x = lum(a), y = lum(b);
        return (Math.max(x,y) + 0.05) / (Math.min(x,y) + 0.05);
    }

    /* Completa lo que falte con el default y descarta lo que no sea un color.
       Un tema a medias —porque se guardó con una versión vieja del editor— no
       puede dejar la carta sin fondo. */
    function norm(t) {
        t = t || {};
        var o = {};
        o.fondo   = hex(t.fondo,   DEF.fondo);
        o.tarjeta = hex(t.tarjeta, DEF.tarjeta);
        o.texto   = hex(t.texto,   DEF.texto);
        o.acento  = hex(t.acento,  DEF.acento);
        o.fuente    = _conocida(t.fuente)    || DEF.fuente;
        o.fuenteTit = _conocida(t.fuenteTit) || DEF.fuenteTit;
        /* `=== undefined`, no `||`: un cero APAGADO a propósito —quitarle la
           cursiva a la descripción, que la trae por default— tiene que ganarle
           al default. Con `||` el apagado revivía en cada recarga. */
        ['nom','des','pre'].forEach(function (k) {
            o[k+'B'] = (t[k+'B'] === undefined ? DEF[k+'B'] : t[k+'B']) ? 1 : 0;
            o[k+'I'] = (t[k+'I'] === undefined ? DEF[k+'I'] : t[k+'I']) ? 1 : 0;
            o[k+'C'] = hex(t[k+'C'], '');
        });
        return o;
    }

    /* El bloque de variables. Vale igual dentro de `:root{…}` que como valor
       de un atributo `style` — por eso la maqueta del editor puede pintarse
       con exactamente lo mismo que la carta real. */
    function vars(t) {
        var o = norm(t);
        var dim    = mix(o.texto, o.fondo, 0.55);
        var borde  = mix(o.texto, o.fondo, 0.18);
        var hueco  = mix(o.texto, o.tarjeta, 0.10);   /* el fondo de «sin foto» */
        return [
            '--ct-bg:' + o.fondo,
            '--ct-sup:' + o.tarjeta,
            '--ct-txt:' + o.texto,
            '--ct-dim:' + dim,
            '--ct-borde:' + borde,
            '--ct-hueco:' + hueco,
            '--ct-ac:' + o.acento,
            '--ct-ac-10:' + mix(o.acento, o.fondo, 0.14),
            '--ct-f:' + fuente(o.fuente),
            '--ct-ft:' + fuente(o.fuenteTit),
            '--ct-nom-w:' + (o.nomB ? 700 : 400),
            '--ct-nom-i:' + (o.nomI ? 'italic' : 'normal'),
            '--ct-nom-c:' + (o.nomC || o.texto),
            '--ct-des-w:' + (o.desB ? 700 : 400),
            '--ct-des-i:' + (o.desI ? 'italic' : 'normal'),
            '--ct-des-c:' + (o.desC || dim),
            '--ct-pre-w:' + (o.preB ? 700 : 400),
            '--ct-pre-i:' + (o.preI ? 'italic' : 'normal'),
            '--ct-pre-c:' + (o.preC || o.acento)
        ].join(';') + ';';
    }

    /* Pinta el tema en un elemento (el `<html>` de la carta, la maqueta del
       editor). Propiedad por propiedad y no con `cssText`, que borraría
       cualquier otro estilo en línea que el elemento ya traiga. */
    function aplicar(el, t) {
        el = el || document.documentElement;
        vars(t).split(';').forEach(function (p) {
            var i = p.indexOf(':');
            if (i > 0) el.style.setProperty(p.slice(0, i).trim(), p.slice(i + 1).trim());
        });
    }

    window.CartaTema = {
        DEF: DEF, FUENTES: FUENTES,
        fuente: fuente, hex: hex, mix: mix, norm: norm, vars: vars, aplicar: aplicar,
        contraste: contraste
    };
})();
