/* ============================================================================
   ETAAX — Reordenar a mano las filas/tarjetas de un catálogo (arrastrar y soltar).

   El orden alfabético o el de captura casi nunca es el orden en el que se trabaja:
   la barra quiere sus destilados arriba y la cocina sus proteínas primero. Aquí se
   arrastra y el catálogo queda en ese orden para todos.

   Se activa por MODO (un botón lo prende): con el modo apagado no se toca nada, y
   un clic sigue abriendo la ficha en vez de arrastrarla sin querer.

   API:
     etaaxReordenar.aplicar(contenedor, {
        item:     'tr',                       // selector de cada elemento movible
        id:       function(el){...},          // id del elemento (default: data-ord-id)
        onMover:  function(idQueSeMueve, idDestino, antes){...}
     })
     etaaxReordenar.quitar(contenedor)
   ============================================================================ */
(function () {
    var CSS =
        '.ord-mov{cursor:grab}' +
        '.ord-mov:active{cursor:grabbing}' +
        '.ord-arrastrando{opacity:.4}' +
        // La marca de dónde va a caer: una línea, no un recuadro — se ve el hueco
        // sin que la fila de abajo salte y cambie de sitio mientras arrastras.
        '.ord-antes{box-shadow:inset 0 3px 0 0 var(--accent,#f5c842)}' +
        '.ord-despues{box-shadow:inset 0 -3px 0 0 var(--accent,#f5c842)}' +
        '.ord-grip{cursor:grab;color:var(--text-dim,#6b665e);font-size:13px;' +
            'padding:0 6px;user-select:none;letter-spacing:-1px;' +
            // touch-action:none SOLO en el tirador: así el dedo lo arrastra en
            // vez de hacer scroll, y el resto de la lista se sigue deslizando.
            'touch-action:none;-webkit-user-select:none}' +
        // Sin tirador, el asa es el renglón entero: ahí sí se toma el dedo.
        '.ord-mov{touch-action:none}' +
        '.ord-con-grip .ord-mov{touch-action:auto}' +
        // Mientras se arrastra, que no se seleccione texto ni salga la lupa de iOS.
        '.ord-arrastrando-doc{user-select:none;-webkit-user-select:none;' +
            '-webkit-touch-callout:none}';
    var st = document.createElement('style');
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);

    function _idDe(el, opts) {
        return opts.id ? opts.id(el) : el.getAttribute('data-ord-id');
    }
    function _limpiarMarcas(cont) {
        cont.querySelectorAll('.ord-antes,.ord-despues').forEach(function (x) {
            x.classList.remove('ord-antes', 'ord-despues');
        });
    }
    /* El contenedor que de verdad hace scroll. Se necesita para arrastrar más
       allá de lo que se ve: en una lista de 200 recetas, mover la última hasta
       arriba sin esto es imposible. */
    function _scroller(el) {
        for (var n = el; n && n !== document.body; n = n.parentElement) {
            var ov = getComputedStyle(n).overflowY;
            if ((ov === 'auto' || ov === 'scroll') && n.scrollHeight > n.clientHeight + 4) return n;
        }
        return null;
    }

    /* ══ POR QUÉ NO SE USA EL ARRASTRE DEL NAVEGADOR ══════════════════════
       Esto estaba con HTML5 drag & drop (draggable + dragstart/dragover/drop).
       En la computadora funcionaba; en tablet NO FUNCIONA EN ABSOLUTO — el
       dedo no dispara `dragstart`, así que no hay nada que arreglar ahí: esa
       API simplemente no existe para el tacto. Y el catálogo se usa en tablet
       detrás de la barra, que es justo donde se quiere reacomodar.

       Con Pointer Events hay UN solo camino para ratón, dedo y lápiz.

       El tirador ⠿ no es decoración: en tablet, arrastrar desde cualquier
       parte del renglón pelearía con el scroll de la lista —los dos son un
       dedo moviéndose hacia abajo— y no habría forma de bajar a ver el resto.
       Soltando el scroll en todo lo demás y tomando solo el tirador, las dos
       cosas conviven. Cuando no hay tirador, el renglón entero es el asa (así
       sigue sirviendo donde no se pinta uno). */
    function aplicar(cont, opts) {
        if (!cont) return;
        opts = opts || {};
        var sel = opts.item || '[data-ord-id]';
        quitar(cont);

        var items = cont.querySelectorAll(sel);
        var hayGrip = !!cont.querySelector('.ord-grip');
        for (var i = 0; i < items.length; i++) items[i].classList.add('ord-mov');
        if (hayGrip) cont.classList.add('ord-con-grip');

        var origen = null, destino = null, antes = false, pid = null, asa = null;
        var scr = null, autoT = null, lastY = 0;

        function _bajo(x, y) {
            var el = document.elementFromPoint(x, y);
            var it = el && el.closest ? el.closest(sel) : null;
            return (it && cont.contains(it)) ? it : null;
        }
        function _marcar(x, y) {
            var it = _bajo(x, y);
            _limpiarMarcas(cont);
            destino = null;
            if (!it || it === origen) return;
            var r = it.getBoundingClientRect();
            antes = (y - r.top) < r.height / 2;
            it.classList.add(antes ? 'ord-antes' : 'ord-despues');
            destino = it;
        }
        /* Arrastrar pegado al borde desplaza la lista. Sin esto, en una lista
           larga solo se puede mover dentro de la pantalla actual. */
        function _auto() {
            if (!scr || !origen) return;
            var r = scr.getBoundingClientRect(), MARGEN = 48, PASO = 12;
            var d = 0;
            if (lastY < r.top + MARGEN)         d = -PASO;
            else if (lastY > r.bottom - MARGEN) d = PASO;
            if (d) { scr.scrollTop += d; _marcar(lastX, lastY); }
        }
        var lastX = 0;

        cont.__ord = {
            down: function (e) {
                if (e.button != null && e.button !== 0) return;      // solo el principal
                var t = e.target;
                if (hayGrip && !(t.closest && t.closest('.ord-grip'))) return;
                var it = t.closest && t.closest(sel);
                if (!it || !cont.contains(it)) return;
                origen = it; asa = t; pid = e.pointerId;
                lastX = e.clientX; lastY = e.clientY;
                scr = _scroller(cont);
                it.classList.add('ord-arrastrando');
                document.body.classList.add('ord-arrastrando-doc');
                /* El puntero se captura en el ASA, no en el contenedor: la lista
                   se repinta al soltar y capturar en algo que va a morir deja
                   el puntero huérfano. */
                try { asa.setPointerCapture(pid); } catch (x) {}
                e.preventDefault();
                autoT = setInterval(_auto, 60);
            },
            move: function (e) {
                if (!origen || e.pointerId !== pid) return;
                e.preventDefault();
                lastX = e.clientX; lastY = e.clientY;
                _marcar(e.clientX, e.clientY);
            },
            up: function (e) {
                if (!origen || (pid !== null && e.pointerId !== pid)) return;
                if (autoT) { clearInterval(autoT); autoT = null; }
                try { asa.releasePointerCapture(pid); } catch (x) {}
                var o = origen, d = destino, ant = antes;
                origen = null; destino = null; pid = null; asa = null;
                o.classList.remove('ord-arrastrando');
                document.body.classList.remove('ord-arrastrando-doc');
                _limpiarMarcas(cont);
                if (!d || d === o) return;
                var a = _idDe(o, opts), b = _idDe(d, opts);
                if (a && b && opts.onMover) opts.onMover(a, b, ant);
            },
            cancel: function () {
                if (autoT) { clearInterval(autoT); autoT = null; }
                if (origen) origen.classList.remove('ord-arrastrando');
                document.body.classList.remove('ord-arrastrando-doc');
                origen = null; destino = null; pid = null; asa = null;
                _limpiarMarcas(cont);
            }
        };
        cont.addEventListener('pointerdown', cont.__ord.down);
        /* move/up van en el DOCUMENTO: con la captura puesta los eventos llegan
           al asa, pero si el dedo sale del contenedor sin captura (algún
           navegador la niega) se perderían y el renglón se quedaría pegado. */
        document.addEventListener('pointermove',   cont.__ord.move);
        document.addEventListener('pointerup',     cont.__ord.up);
        document.addEventListener('pointercancel', cont.__ord.cancel);
    }

    function quitar(cont) {
        if (!cont || !cont.__ord) return;
        cont.removeEventListener('pointerdown', cont.__ord.down);
        document.removeEventListener('pointermove',   cont.__ord.move);
        document.removeEventListener('pointerup',     cont.__ord.up);
        document.removeEventListener('pointercancel', cont.__ord.cancel);
        cont.__ord = null;
        cont.classList.remove('ord-con-grip');
        cont.querySelectorAll('.ord-mov').forEach(function (x) {
            x.removeAttribute('draggable');
            x.classList.remove('ord-mov', 'ord-arrastrando');
        });
        _limpiarMarcas(cont);
    }

    /* Mueve `idA` junto a `idB` dentro de la lista COMPLETA y renumera.
       Se mueve sobre el catálogo entero, no sobre lo que se ve: así arrastrar con
       un filtro puesto o en la página 3 deja el orden que uno esperaría, y lo que
       no está a la vista conserva su lugar relativo. Devuelve true si cambió. */
    function mover(lista, idA, idB, antes, campo) {
        campo = campo || 'orden';
        var ia = -1, ib = -1;
        for (var i = 0; i < lista.length; i++) {
            if (lista[i] && lista[i].id === idA) ia = i;
            if (lista[i] && lista[i].id === idB) ib = i;
        }
        if (ia < 0 || ib < 0 || ia === ib) return false;
        var it = lista.splice(ia, 1)[0];
        ib = lista.indexOf(lista.find(function (x) { return x && x.id === idB; }));
        lista.splice(antes ? ib : ib + 1, 0, it);
        for (var k = 0; k < lista.length; k++) if (lista[k]) lista[k][campo] = k;
        return true;
    }

    /* Orden efectivo: primero lo acomodado a mano, y lo que nunca se tocó
       (o se agregó después) al final, en el orden en el que ya venía. */
    function ordenar(lista, campo) {
        campo = campo || 'orden';
        return lista.map(function (x, i) { return { x: x, i: i }; })
            .sort(function (a, b) {
                var oa = (a.x && typeof a.x[campo] === 'number') ? a.x[campo] : Infinity;
                var ob = (b.x && typeof b.x[campo] === 'number') ? b.x[campo] : Infinity;
                if (oa !== ob) return oa - ob;
                return a.i - b.i;                 // estable
            })
            .map(function (p) { return p.x; });
    }

    window.etaaxReordenar = { aplicar: aplicar, quitar: quitar, mover: mover, ordenar: ordenar };
})();
