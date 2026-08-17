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
            'padding:0 6px;user-select:none;letter-spacing:-1px}';
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

    function aplicar(cont, opts) {
        if (!cont) return;
        opts = opts || {};
        var sel = opts.item || '[data-ord-id]';
        quitar(cont);

        var items = cont.querySelectorAll(sel);
        for (var i = 0; i < items.length; i++) {
            items[i].setAttribute('draggable', 'true');
            items[i].classList.add('ord-mov');
        }

        var origen = null;
        cont.__ord = {
            start: function (e) {
                var it = e.target.closest && e.target.closest(sel);
                if (!it || !cont.contains(it)) return;
                origen = it;
                it.classList.add('ord-arrastrando');
                try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', _idDe(it, opts) || ''); } catch (x) {}
            },
            over: function (e) {
                if (!origen) return;
                var it = e.target.closest && e.target.closest(sel);
                if (!it || it === origen || !cont.contains(it)) return;
                e.preventDefault();
                try { e.dataTransfer.dropEffect = 'move'; } catch (x) {}
                var r = it.getBoundingClientRect();
                var arriba = (e.clientY - r.top) < r.height / 2;
                _limpiarMarcas(cont);
                it.classList.add(arriba ? 'ord-antes' : 'ord-despues');
            },
            drop: function (e) {
                if (!origen) return;
                var it = e.target.closest && e.target.closest(sel);
                _limpiarMarcas(cont);
                if (!it || it === origen || !cont.contains(it)) return;
                e.preventDefault(); e.stopPropagation();
                var r = it.getBoundingClientRect();
                var antes = (e.clientY - r.top) < r.height / 2;
                var a = _idDe(origen, opts), b = _idDe(it, opts);
                origen.classList.remove('ord-arrastrando');
                origen = null;
                if (a && b && opts.onMover) opts.onMover(a, b, antes);
            },
            end: function () {
                if (origen) origen.classList.remove('ord-arrastrando');
                origen = null;
                _limpiarMarcas(cont);
            }
        };
        cont.addEventListener('dragstart', cont.__ord.start);
        cont.addEventListener('dragover',  cont.__ord.over);
        cont.addEventListener('drop',      cont.__ord.drop);
        cont.addEventListener('dragend',   cont.__ord.end);
    }

    function quitar(cont) {
        if (!cont || !cont.__ord) return;
        cont.removeEventListener('dragstart', cont.__ord.start);
        cont.removeEventListener('dragover',  cont.__ord.over);
        cont.removeEventListener('drop',      cont.__ord.drop);
        cont.removeEventListener('dragend',   cont.__ord.end);
        cont.__ord = null;
        cont.querySelectorAll('.ord-mov').forEach(function (x) {
            x.removeAttribute('draggable'); x.classList.remove('ord-mov');
        });
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
