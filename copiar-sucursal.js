/* ============================================================================
   ETAAX — COPIAR ALGO A OTRAS SUCURSALES: una sola ventanita para todos

   El caso real: el negocio arma un checklist de cierre de barra en una
   sucursal, le toma dos horas afinarlo, y en las otras cuatro hay que volver a
   escribirlo tarea por tarea. Lo mismo con una evaluación de 27 preguntas.

   Lo que se copia queda INDEPENDIENTE, no vinculado. Es a propósito: el
   checklist de una sucursal chica no tiene por qué cambiar cuando alguien
   afina el de la grande — y una copia que se actualiza sola a espaldas de
   quien la usa es peor que volver a escribirla. Quien quiera propagar un
   cambio, vuelve a copiar.

   Uso:
     etaaxCopiarASucursal({
       titulo:   'Copiar checklist a otras sucursales',
       queEs:    'el checklist',             // para los textos
       nombre:   'Cierre de barra',          // qué se está copiando
       sucursales: [{id, nombre}, ...],      // catálogo del negocio
       actual:   'suc_centro',               // dónde vive hoy (se excluye)
       onCopiar: function (idsDestino) { ... }
     });

   El que llama decide CÓMO se clona (ids nuevos, qué campos se limpian): esta
   pieza solo pregunta a dónde.
   ============================================================================ */
(function () {
    if (window.etaaxCopiarASucursal) return;

    var MATRIZ = 'suc_principal';

    function _esc(s) {
        return window.etx ? etx(String(s == null ? '' : s))
                          : String(s == null ? '' : s)
                              .replace(/&/g, '&amp;').replace(/</g, '&lt;')
                              .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    /* El nombre que el negocio le puso, no la etiqueta del sistema. "Matriz"
       queda de último recurso: la sucursal que no está en el catálogo. */
    function _nombre(sucs, id) {
        var s = (sucs || []).find(function (x) { return x.id === id; });
        if (s) return s.nombre || s.id;
        return id === MATRIZ ? 'Matriz' : id;
    }
    function _eff(id) { return id || MATRIZ; }

    function _css() {
        if (document.getElementById('etx-cps-css')) return;
        var st = document.createElement('style');
        st.id = 'etx-cps-css';
        st.textContent =
            '.cps-bg{position:fixed;inset:0;z-index:9600;background:rgba(10,9,8,.72);' +
            '  display:none;align-items:center;justify-content:center;padding:20px}' +
            '.cps-bg.on{display:flex}' +
            '.cps{background:var(--surface,#141210);border:1px solid var(--border,#2a2825);' +
            '  border-radius:14px;width:100%;max-width:460px;box-shadow:0 24px 60px rgba(0,0,0,.5);' +
            "  font-family:'DM Sans',system-ui,sans-serif;max-height:86vh;display:flex;flex-direction:column}" +
            '.cps-hd{padding:16px 20px 12px;border-bottom:1px solid var(--border,#2a2825)}' +
            '.cps-kick{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--text-dim,#7a7570)}' +
            ".cps-tit{font-family:'Bebas Neue',sans-serif;font-size:21px;letter-spacing:1.2px;" +
            '  color:var(--text,#f0ece4);margin-top:3px}' +
            '.cps-body{padding:14px 20px;overflow-y:auto}' +
            '.cps-msg{font-size:12.5px;line-height:1.55;color:var(--text-muted,#a8a29a);margin-bottom:12px}' +
            '.cps-msg b{color:var(--text,#f0ece4)}' +
            '.cps-op{display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:9px;' +
            '  border:1px solid var(--border,#2a2825);background:var(--surface2,#1c1a17);' +
            '  cursor:pointer;margin-bottom:7px;transition:border-color .15s}' +
            '.cps-op:hover{border-color:var(--green,#3dbe7a)}' +
            '.cps-op input{width:16px;height:16px;accent-color:var(--green,#3dbe7a);cursor:pointer;flex-shrink:0}' +
            '.cps-op span{font-size:13px;color:var(--text,#f0ece4)}' +
            '.cps-nota{font-size:11.5px;line-height:1.5;color:var(--text-dim,#7a7570);margin-top:10px}' +
            '.cps-ft{display:flex;justify-content:flex-end;gap:9px;padding:13px 20px;' +
            '  border-top:1px solid var(--border,#2a2825)}' +
            '.cps-b{font-family:inherit;font-size:12.5px;padding:8px 16px;border-radius:8px;cursor:pointer;' +
            '  border:1px solid var(--border,#2a2825);background:transparent;color:var(--text-muted,#a8a29a)}' +
            '.cps-b:hover{color:var(--text,#f0ece4)}' +
            '.cps-b.ok{background:var(--green,#3dbe7a);border:none;color:#0a0908;font-weight:600}' +
            '.cps-b.ok:disabled{opacity:.45;cursor:not-allowed}';
        document.head.appendChild(st);
    }

    function _cerrar() {
        var bg = document.getElementById('etx-cps');
        if (bg) bg.classList.remove('on');
    }

    window.etaaxCopiarASucursal = function (cfg) {
        cfg = cfg || {};
        _css();
        var sucs   = cfg.sucursales || [];
        var actual = _eff(cfg.actual);
        var queEs  = cfg.queEs || 'esto';

        /* Los destinos son TODAS menos donde ya vive. Copiarlo encima de sí
           mismo solo deja un duplicado que nadie pidió. */
        var destinos = sucs.filter(function (s) { return _eff(s.id) !== actual; });

        var bg = document.getElementById('etx-cps');
        if (!bg) {
            bg = document.createElement('div');
            bg.id = 'etx-cps';
            bg.className = 'cps-bg';
            bg.addEventListener('click', function (e) { if (e.target === bg) _cerrar(); });
            document.body.appendChild(bg);
        }

        if (!destinos.length) {
            /* Con una sola sucursal no hay a dónde copiar. Decirlo es mejor que
               abrir una lista vacía. */
            bg.innerHTML =
                '<div class="cps"><div class="cps-hd">' +
                    '<div class="cps-kick">Copiar a sucursal</div>' +
                    '<div class="cps-tit">No hay a dónde copiar</div></div>' +
                '<div class="cps-body"><div class="cps-msg">' +
                    'Este negocio solo tiene una sucursal. Cuando des de alta otra, ' +
                    'vas a poder copiar ' + _esc(queEs) + ' aquí.' +
                '</div></div>' +
                '<div class="cps-ft"><button class="cps-b" id="cpsX">Entendido</button></div></div>';
            bg.classList.add('on');
            document.getElementById('cpsX').onclick = _cerrar;
            return;
        }

        bg.innerHTML =
            '<div class="cps">' +
                '<div class="cps-hd">' +
                    '<div class="cps-kick">Copiar a sucursal</div>' +
                    '<div class="cps-tit">' + _esc(cfg.titulo || 'Copiar a otras sucursales') + '</div>' +
                '</div>' +
                '<div class="cps-body">' +
                    '<div class="cps-msg">Se va a copiar <b>' + _esc(cfg.nombre || '') + '</b>, ' +
                        'que hoy vive en <b>' + _esc(_nombre(sucs, actual)) + '</b>. ' +
                        '¿A cuáles?</div>' +
                    destinos.map(function (s, i) {
                        return '<label class="cps-op"><input type="checkbox" class="cps-ck" ' +
                               'value="' + _esc(s.id) + '" id="cpsck' + i + '">' +
                               '<span>' + _esc(s.nombre || s.id) + '</span></label>';
                    }).join('') +
                    '<div class="cps-nota">Cada copia queda <b>independiente</b>: editarla allá no ' +
                        'cambia esta, y afinar esta no cambia las copias. Si más adelante quieres ' +
                        'propagar un cambio, vuelve a copiar.</div>' +
                '</div>' +
                '<div class="cps-ft">' +
                    '<button class="cps-b" id="cpsCancel">Cancelar</button>' +
                    '<button class="cps-b ok" id="cpsOk" disabled>Copiar</button>' +
                '</div>' +
            '</div>';
        bg.classList.add('on');

        var cks = [].slice.call(bg.querySelectorAll('.cps-ck'));
        var ok  = document.getElementById('cpsOk');
        /* El botón no se enciende hasta que haya al menos un destino: "Copiar" a
           ninguna parte es un clic que no hace nada y parece que falló. */
        function _sync() {
            var n = cks.filter(function (c) { return c.checked; }).length;
            ok.disabled = !n;
            ok.textContent = n ? ('Copiar a ' + n + ' sucursal' + (n !== 1 ? 'es' : '')) : 'Copiar';
        }
        cks.forEach(function (c) { c.addEventListener('change', _sync); });
        _sync();

        document.getElementById('cpsCancel').onclick = _cerrar;
        ok.onclick = function () {
            var ids = cks.filter(function (c) { return c.checked; })
                         .map(function (c) { return c.value; });
            if (!ids.length) return;
            _cerrar();
            if (typeof cfg.onCopiar === 'function') cfg.onCopiar(ids);
        };
    };

    window.etaaxCopiarASucursal.cerrar = _cerrar;
})();
