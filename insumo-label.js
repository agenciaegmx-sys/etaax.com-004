/* ============================================================================
   ETAAX — Etiqueta canónica de insumo (usada en TODOS los módulos)
   Orden legible único:  subcategoría · nombre · variedad · contenido · marca
   (omite las partes vacías). Evita que cada pantalla arme su propio formato.

   API global:
     insumoEtiqueta(o)  → "Mezcal · Kurikhua · Espadín · 750 ml · Destilería Don José"
     insumoTitulo(o)    → "Kurikhua · Espadín"           (línea principal de tarjetas)
     insumoMeta(o)      → "Mezcal · 750 ml · Destilería…" (subtítulo de tarjetas)
     insumoPartes(o)    → { sub, nombre, variedad, contenido, marca }
     insumoContenido(o) → "750 ml"

   `o` puede ser un objeto insumo del catálogo O una fila/ingrediente con
   `insumoId`: cada página registra window._insumoResolver(id) → insumo del
   catálogo, así la etiqueta SIEMPRE se arma con los campos limpios (no con el
   "nombre" que en datos viejos viene con la variedad pegada).
   ============================================================================ */
(function () {
    var UM = { ML:'ml', L:'L', LT:'L', LTS:'L', GR:'g', G:'g', KG:'kg', PZA:'pza', PZ:'pza', PIEZA:'pza', OZ:'oz' };

    // Solo el contenido: "750 ml" / "4 L" / "350 g".
    function _soloContenido(ins) {
        if (!ins) return '';
        if (ins.contenido) return ins.contenido; // ya normalizado en la fila
        var p = (ins.presentaciones && ins.presentaciones[0]) || null;
        if (!p) return '';
        var cn = parseFloat(p.contNeto) || 0;
        if (!cn) return '';
        var um = (p.umContenido || '').toString().toUpperCase();
        var uml = UM[um] || (p.umContenido || '').toLowerCase();
        return (cn % 1 ? cn.toFixed(1) : cn) + (uml ? ' ' + uml : '');
    }
    // Empaque + contenido juntos para leer rápido: "Botella 750 ml" / "Garrafa 4 L".
    function _contenido(ins) {
        if (!ins) return '';
        var emp  = (ins.empaque || '').toString().trim();
        var cont = _soloContenido(ins);
        return [emp, cont].filter(Boolean).join(' ');
    }

    // Devuelve el insumo del catálogo si `o` es una fila/ingrediente con insumoId.
    function _canon(o) {
        o = o || {};
        if (o.insumoId && typeof window._insumoResolver === 'function') {
            var ins = window._insumoResolver(o.insumoId);
            if (ins) return ins;
        }
        return o;
    }

    function _partes(o) {
        o = _canon(o) || {};
        return {
            sub:       o.subcategoria || o.categoria || '',
            nombre:    o.nombreBase || o.nombre || '',
            variedad:  o.variedad || o.maduracion || '',
            contenido: _contenido(o),
            marca:     o.marca || ''
        };
    }

    function _join(arr) { return arr.filter(Boolean).join(' · '); }

    function _esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    window.insumoContenido = function (o) { return _contenido(_canon(o)); };
    window.insumoPartes    = _partes;
    // Orden legible único pedido: nombre · variedad · envase contenido · marca (marca al final, lo menos relevante).
    window.insumoEtiqueta  = function (o) { var p = _partes(o); return _join([p.nombre, p.variedad, p.contenido, p.marca]); };
    window.insumoTitulo    = function (o) { var p = _partes(o); return _join([p.nombre, p.variedad]); };
    window.insumoMeta      = function (o) { var p = _partes(o); return _join([p.contenido, p.marca]); };
    // Variante HTML del subtítulo: envase+contenido normal y la MARCA en gris pequeño.
    window.insumoMetaHTML  = function (o) {
        var p = _partes(o);
        var out = _esc(p.contenido);
        if (p.marca) out += (out ? ' ' : '') + '<span style="color:var(--text-dim);font-size:.85em">' + (out ? '· ' : '') + _esc(p.marca) + '</span>';
        return out;
    };

    // ── Identidad canónica del insumo (ÚNICA fuente de verdad) ──────────────────
    // Dos insumos con la misma clave = "el mismo" (en otra sucursal, o duplicado).
    // Antes estaba duplicada en insumos.html (_keyIns) e insumos.js (_keyInsLocal) y
    // divergieron → colapsaba Hennessy V.S. con V.S.O.P. (faltaba variedad). Ahora
    // ambas delegan aquí para que NUNCA vuelvan a desincronizarse.
    // Clave = nombre | marca | (variedad ó maduración), en minúsculas y sin espacios extremos.
    window._keyInsumo = function (x) {
        return (((x && x.nombre) || '') + '|' +
                ((x && x.marca) || '') + '|' +
                ((x && (x.variedad || x.maduracion)) || '')).toLowerCase().trim();
    };

    // ── Fábrica de resolver id→insumo (misma LÓGICA en todas las páginas) ─────────
    // Cada página tiene su propia FUENTE de datos (getInsumos / getCatalogoInsumos) y
    // su propia clave de invalidación de caché, pero el algoritmo de indexado es uno
    // solo → se acaban las 3 copias divergentes de _insumoResolver.
    //   getArr : function() → array de insumos del catálogo.
    //   getSig : function() → valor de firma; si cambia, se reconstruye el índice.
    //            (por defecto usa la identidad del array — sirve cuando getArr cachea).
    window._makeInsumoResolver = function (getArr, getSig) {
        var _ix = null, _key = null;
        return function (id) {
            var k = getSig ? getSig() : getArr();
            if (_ix === null || k !== _key) {
                _ix = {};
                (getArr() || []).forEach(function (x) { if (x && x.id) _ix[x.id] = x; });
                _key = k;
            }
            return _ix[id] || null;
        };
    };

    // ── Membresía por sucursal (igual que recetas): en qué sucursales VIVE un insumo ──
    // Usa el array `sucursales` si existe; si no, cae al `sucursalId` único (backward-compatible).
    // Vacío = Matriz (todas). Así "Copiar aquí" agrega la sucursal SIN duplicar el registro.
    window._insumoSucursales = function (x) {
        if (x && x.sucursales && x.sucursales.length) return x.sucursales;
        if (x && x.sucursalId) return [x.sucursalId];
        return [];
    };
    // ¿El insumo x vive en la sucursal effSuc? (Matriz es una sucursal más = 'suc_principal').
    // Sin `sucursales` = está en el ALMACÉN GLOBAL pero NO asignado a ninguna sucursal → no
    // aparece en ninguna (ni en Matriz). Global (almacén) y Matriz (sucursal) son cosas distintas.
    window._insumoEnSuc = function (x, effSuc) {
        var s = window._insumoSucursales(x);
        if (!s.length) return false; // sin asignar = solo en el catálogo global
        for (var i = 0; i < s.length; i++) { if ((s[i] || 'suc_principal') === effSuc) return true; }
        return false;
    };
})();
