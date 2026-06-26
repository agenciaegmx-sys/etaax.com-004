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

    window.insumoContenido = function (o) { return _contenido(_canon(o)); };
    window.insumoPartes    = _partes;
    window.insumoEtiqueta  = function (o) { var p = _partes(o); return _join([p.sub, p.nombre, p.variedad, p.contenido, p.marca]); };
    window.insumoTitulo    = function (o) { var p = _partes(o); return _join([p.nombre, p.variedad]); };
    window.insumoMeta      = function (o) { var p = _partes(o); return _join([p.sub, p.contenido, p.marca]); };
})();
