/* ============================================================================
   ETAAX — QUÉ ES EL NEGOCIO Y A QUÉ SE DEDICA CADA SUCURSAL

   Dos cosas distintas que hasta hoy estaban mezcladas en un solo campo:

     LA ORGANIZACIÓN es del NEGOCIO: cómo está armado por dentro. Una PYME de un
     local no se administra como una franquicia ni como un grupo con CEDIS.

     EL GIRO es de la SUCURSAL: a qué se dedica. Un mismo negocio puede tener
     una cafetería, una cantina y un food truck, y cada una se opera distinto.

   Antes el negocio guardaba un `tipo` que en realidad era el giro (Bar,
   Restaurante, Café…) y la sucursal tenía el giro escrito a mano en un campo de
   texto libre. Resultado: dos verdades sobre lo mismo, ninguna comparable entre
   negocios, y la tarjeta del negocio diciendo «RESTAURANTE» cuando lo que
   identifica al negocio es que es una cadena de cuatro.

   Esta es la lista buena, y vive aquí para que el hub, la configuración y
   cualquier pantalla futura usen las MISMAS claves. Las claves no se traducen
   ni se cambian: son lo que queda guardado. Lo que se cambia es el `nom`.
   ============================================================================ */
(function () {
    /* Cómo está armado el negocio. El icono es el de la familia `org-`. */
    var ORGANIZACIONES = [
        { k:'pyme',        nom:'PYME',            ic:'org-pyme',        pista:'Un negocio, una o pocas sucursales' },
        { k:'corporativo', nom:'Corporativo',     ic:'org-corporativo', pista:'Matriz que coordina varias unidades' },
        { k:'cadena',      nom:'Cadena',          ic:'org-cadena',      pista:'Varias sucursales con la misma marca' },
        { k:'franquicia',  nom:'Franquicia',      ic:'org-franquicia',  pista:'Unidades operadas por terceros' },
        { k:'mixto',       nom:'Grupo mixto',     ic:'org-mixto',       pista:'Marcas o modelos distintos bajo un grupo' },
        { k:'cedis',       nom:'Operación CEDIS', ic:'org-cedis',       pista:'Con centro de distribución propio' }
    ];

    /* A qué se dedica una sucursal. El icono es el de la familia `giro-`. */
    var GIROS = [
        { k:'cafeteria',       nom:'Cafetería',              ic:'giro-cafeteria' },
        { k:'bar',             nom:'Bar',                    ic:'giro-bar' },
        { k:'cantina',         nom:'Cantina',                ic:'giro-cantina' },
        { k:'cerveceria',      nom:'Cervecería',             ic:'giro-cerveceria' },
        { k:'bistro',          nom:'Bistró',                 ic:'giro-bistro' },
        { k:'restaurante-bar', nom:'Restaurante bar',        ic:'giro-restaurante-bar' },
        { k:'marisqueria',     nom:'Marisquería',            ic:'giro-marisqueria' },
        { k:'taqueria',        nom:'Taquería',               ic:'giro-taqueria' },
        { k:'fonda',           nom:'Fonda / cocina económica', ic:'giro-fonda' },
        { k:'rosticeria',      nom:'Rosticería',             ic:'giro-rosticeria' },
        { k:'pizzeria',        nom:'Pizzería',               ic:'giro-pizzeria' },
        { k:'panaderia',       nom:'Panadería',              ic:'giro-panaderia' },
        { k:'reposteria',      nom:'Repostería',             ic:'giro-reposteria' },
        { k:'neveria',         nom:'Nevería',                ic:'giro-neveria' },
        { k:'jugueria',        nom:'Juguería',               ic:'giro-jugueria' },
        { k:'fuente-sodas',    nom:'Fuente de sodas',        ic:'giro-fuente-sodas' },
        { k:'foodtruck',       nom:'Food truck',             ic:'giro-foodtruck' },
        { k:'ambulante',       nom:'Puesto ambulante',       ic:'giro-ambulante' },
        { k:'cocina-entrega',  nom:'Cocina de entrega',      ic:'giro-cocina-entrega' },
        { k:'cedis',           nom:'CEDIS / almacén',        ic:'giro-cedis' }
    ];

    function buscar(lista, k) {
        for (var i = 0; i < lista.length; i++) if (lista[i].k === k) return lista[i];
        return null;
    }

    /* El GIRO de antes era texto libre («Restaurante de mariscos», «cafetería
       pequeña»…). Esto intenta reconocerlo para no perder lo ya capturado: si
       acierta, el dueño ve su giro ya elegido; si no, no pasa nada y lo elige.
       Nunca se descarta el texto original — se guarda aparte. */
    function adivinarGiro(texto) {
        var t = String(texto || '').toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '');
        if (!t.trim()) return '';
        for (var i = 0; i < GIROS.length; i++) {
            var g = GIROS[i];
            var clave = g.k.replace(/-/g, ' ');
            var nom = g.nom.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
            if (t.indexOf(clave) > -1 || t.indexOf(nom.split(' / ')[0]) > -1) return g.k;
        }
        if (/marisc/.test(t)) return 'marisqueria';
        if (/caf[eé]/.test(t)) return 'cafeteria';
        if (/comida|comedor/.test(t)) return 'fonda';
        return '';
    }

    window.EtaaxNegocio = {
        ORGANIZACIONES: ORGANIZACIONES,
        GIROS: GIROS,
        org:  function (k) { return buscar(ORGANIZACIONES, k) || ORGANIZACIONES[0]; },
        giro: function (k) { return buscar(GIROS, k); },
        adivinarGiro: adivinarGiro,

        /* La rejilla de opciones, UNA sola para los dos casos. El que la usa
           dice qué lista, qué está elegido y a qué función avisar. El `onclick`
           recibe la clave — nunca el índice, que cambia si la lista se reordena. */
        rejilla: function (lista, elegido, fn, opc) {
            opc = opc || {};
            var h = '<div class="etx-rejilla">';
            for (var i = 0; i < lista.length; i++) {
                var o = lista[i];
                var on = (o.k === elegido);
                h += '<button type="button" class="etx-opcion' + (on ? ' on' : '') + '" ' +
                     'onclick="' + fn + '(\'' + o.k + '\')" title="' + (o.pista || o.nom) + '">' +
                     '<span class="etx-opcion-ic">' +
                        (typeof etaaxIcono === 'function' ? etaaxIcono(o.ic, { tam: opc.tam || 26 }) : '') +
                     '</span>' +
                     '<span class="etx-opcion-nom">' + o.nom + '</span>' +
                     '</button>';
            }
            return h + '</div>';
        }
    };
})();
