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
    // ── Resolver CANÓNICO por sucursal (independencia insumo/receta por sucursal) ──
    // Las recetas e inventarios guardan el id del MAESTRO (id canónico). Si existe una
    // COPIA para la sucursal activa (registro con `origenId` = ese canónico y que vive en
    // esa sucursal), el resolver devuelve la COPIA de forma TRANSPARENTE — así el mismo id
    // referenciado por todos ve el dato de su sucursal. Sin copias, se comporta idéntico a
    // antes (100% backward-compatible). El índice de copias es independiente de la sucursal;
    // la variante se elige en cada llamada según la sucursal activa (no requiere reindexar).
    window._makeInsumoResolver = function (getArr, getSig) {
        var _ix = null, _byCanon = null, _key = null;
        function _sucAct() { try { return localStorage.getItem('etaax_sucursal_activa') || ''; } catch (e) { return ''; } }
        function _eff(s) { return s || 'suc_principal'; }
        return function (id) {
            var k = getSig ? getSig() : getArr();
            if (_ix === null || k !== _key) {
                _ix = {}; _byCanon = {};
                (getArr() || []).forEach(function (x) {
                    if (!x || !x.id) return;
                    _ix[x.id] = x;
                    if (x.origenId) { // COPIA por sucursal → indexar canónico → {sucursal: copia}
                        var mem = window._insumoSucursales ? window._insumoSucursales(x) : (x.sucursalId ? [x.sucursalId] : []);
                        var bag = (_byCanon[x.origenId] = _byCanon[x.origenId] || {});
                        mem.forEach(function (m) { bag[_eff(m)] = x; });
                    }
                });
                _key = k;
            }
            if (!id) return null;
            var base = _ix[id] || null;
            var canonical = (base && base.origenId) || id; // si te pasan el id de una copia, usa su canónico
            var byS = _byCanon[canonical];
            if (byS) { var v = byS[_eff(_sucAct())]; if (v) return v; } // copia de la sucursal activa
            return _ix[canonical] || base;                              // si no, el maestro
        };
    };

    // Resolver CANÓNICO de RECETAS por sucursal — misma mecánica que insumos, pero la
    // membresía usa `sucursales`/`sucursalId` de la receta. Recetas/inventarios guardan el
    // id del MAESTRO; si hay una copia de receta para la sucursal activa (origenId = ese
    // canónico), la devuelve transparente. Sin copias, idéntico a un find por id.
    window._makeRecetaResolver = function (getArr, getSig) {
        var _ix = null, _byCanon = null, _key = null;
        function _sucAct() { try { return localStorage.getItem('etaax_sucursal_activa') || ''; } catch (e) { return ''; } }
        function _eff(s) { return s || 'suc_principal'; }
        function _mem(r) { return (r && r.sucursales && r.sucursales.length) ? r.sucursales : (r && r.sucursalId ? [r.sucursalId] : []); }
        return function (id) {
            var k = getSig ? getSig() : getArr();
            if (_ix === null || k !== _key) {
                _ix = {}; _byCanon = {};
                (getArr() || []).forEach(function (r) {
                    if (!r || !r.id) return;
                    _ix[r.id] = r;
                    if (r.origenId) {
                        var bag = (_byCanon[r.origenId] = _byCanon[r.origenId] || {});
                        _mem(r).forEach(function (m) { bag[_eff(m)] = r; });
                    }
                });
                _key = k;
            }
            if (!id) return null;
            var base = _ix[id] || null;
            var canonical = (base && base.origenId) || id;
            var byS = _byCanon[canonical];
            if (byS) { var v = byS[_eff(_sucAct())]; if (v) return v; }
            return _ix[canonical] || base;
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

    // ── VISIBILIDAD activo/pausado (regla ÚNICA para todo el ecosistema) ─────
    // Dos niveles:
    //  · activo === '0' (insumo) / status === 'inactiva' (receta) → INACTIVO
    //    GLOBAL: desaparece de TODO el negocio; solo se ve en el catálogo global
    //    con el filtro de inactivos.
    //  · inactivoEn/inactivaEn: [sucId,…] → PAUSADO en esas sucursales: sigue
    //    viviendo ahí (membresía intacta, historial intacto) pero no aparece en
    //    su ecosistema (inventarios, escandallo, requisiciones, QR, menú).
    function _enLista(arr, effSuc) {
        arr = arr || [];
        for (var i = 0; i < arr.length; i++) { if ((arr[i] || 'suc_principal') === effSuc) return true; }
        return false;
    }
    // PAUSA POR SUCURSAL RETIRADA (Edwin): el "Pausar aquí" externo era redundante
    // con el activar/desactivar del editor (activo global) + la membresía por
    // sucursal. El helper queda neutralizado (nunca pausa) para no dejar insumos
    // atorados ocultos; los datos inactivoEn quedan dormidos (reversible).
    window._insumoPausadoEn = function () { return false; };
    // ¿El insumo es OPERABLE en la sucursal? (vive ahí + activo global + no pausado ahí)
    window._insumoActivoEnSuc = function (x, effSuc) {
        if (!x || x.activo === '0') return false;
        if (!window._insumoEnSuc(x, effSuc)) return false;
        return !window._insumoPausadoEn(x, effSuc);
    };

    // Recetas: mismas reglas (regla histórica: receta SIN sucursal vive en Matriz).
    window._recetaEnSuc = function (r, suc) {
        if (!r) return false;
        var s = (r.sucursales && r.sucursales.length) ? r.sucursales : (r.sucursalId ? [r.sucursalId] : []);
        if (!s.length) return suc === 'suc_principal' || !suc; // sin sucursal = Matriz
        for (var i = 0; i < s.length; i++) { if ((s[i] || 'suc_principal') === (suc || 'suc_principal')) return true; }
        return false;
    };
    window._recetaPausadaEn = function () { return false; }; // pausa por sucursal RETIRADA (ver _insumoPausadoEn)
    window._recetaActivaEnSuc = function (r, suc) {
        if (!r || r.status === 'inactiva') return false;
        if (!window._recetaEnSuc(r, suc)) return false;
        return !window._recetaPausadaEn(r, suc);
    };
})();
