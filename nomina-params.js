/* ============================================================
   ETAAX — Parámetros globales de nómina por negocio
   Un solo registro por negocio (tabla gf_nomina_params):
     { primaVacacionalPct, jornadaHoras, salarioDiarioDefault }
   Se definen una vez y aplican a todos los colaboradores.

   Requiere: supabase-config.js (_supabase). Opcional: etaax-db.js.

   API:
     NominaParams.get(negId)            → {primaVacacionalPct,jornadaHoras,salarioDiarioDefault}
     await NominaParams.sync(negId)     → carga de Supabase a localStorage
     await NominaParams.save(negId, p)  → guarda (localStorage + Supabase)
     NominaParams.open(negId, onSaved)  → abre el modal de edición
   ============================================================ */
(function () {
    var DEFAULTS = { primaVacacionalPct: 25, jornadaHoras: 8, salarioDiarioDefault: 0 };
    var _negId = '';
    var _onSaved = null;

    function _key(negId) { return 'etaax_' + negId + '_nomina_params'; }
    function _num(v, d) { var x = parseFloat(v); return isNaN(x) ? d : x; }

    function _get(negId) {
        var p = {};
        try { p = JSON.parse(localStorage.getItem(_key(negId)) || '{}') || {}; } catch (e) {}
        return {
            primaVacacionalPct:  _num(p.primaVacacionalPct,  DEFAULTS.primaVacacionalPct),
            jornadaHoras:        _num(p.jornadaHoras,         DEFAULTS.jornadaHoras),
            salarioDiarioDefault:_num(p.salarioDiarioDefault, DEFAULTS.salarioDiarioDefault)
        };
    }

    async function _sync(negId) {
        if (!negId || !window._supabase) return;
        try {
            var r = await _supabase.from('gf_nomina_params').select('datos').eq('negocio_id', negId).maybeSingle();
            if (!r.error && r.data && r.data.datos) localStorage.setItem(_key(negId), JSON.stringify(r.data.datos));
        } catch (e) {}
    }

    async function _save(negId, params) {
        localStorage.setItem(_key(negId), JSON.stringify(params));
        if (!negId || !window._supabase) return;
        try {
            await _supabase.from('gf_nomina_params').upsert(
                { negocio_id: negId, datos: params, updated_at: new Date().toISOString() },
                { onConflict: 'negocio_id' }
            );
        } catch (e) { if (window._sbToastError) _sbToastError('nómina params: ' + e.message); }
    }

    function _ensureStyles() {
        if (document.getElementById('npStyles')) return;
        var st = document.createElement('style');
        st.id = 'npStyles';
        st.textContent =
            '#np_overlay .modal{max-width:460px}' +
            '.np-grp{display:flex;flex-direction:column;gap:6px;margin-bottom:16px}' +
            '.np-grp label{font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--text-dim)}' +
            '.np-grp input{background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:10px 12px;border-radius:8px;font-family:"DM Sans",sans-serif;font-size:14px;outline:none;width:100%;box-sizing:border-box}' +
            '.np-grp input:focus{border-color:var(--green)}' +
            '.np-hint{font-size:11px;color:var(--text-dim)}' +
            '.np-btn{font-family:"DM Sans",sans-serif;font-size:13px;padding:9px 18px;border-radius:6px;cursor:pointer}' +
            '.np-btn-primary{background:var(--green);border:none;color:#0a0908;font-weight:600}' +
            '.np-btn-ghost{background:transparent;border:1px solid var(--border);color:var(--text-muted)}';
        document.head.appendChild(st);
    }

    function _ensureModal() {
        if (document.getElementById('np_overlay')) return;
        _ensureStyles();
        var el = document.createElement('div');
        el.id = 'np_overlay';
        el.className = 'modal-overlay';
        el.addEventListener('click', function (e) { if (e.target === el) _close(); });
        el.innerHTML =
          '<div class="modal">' +
            '<div class="modal-header"><h2>⚙️ Parámetros de nómina</h2><button class="modal-close" onclick="NominaParams._close()">✕</button></div>' +
            '<div class="modal-body">' +
              '<p style="font-size:12px;color:var(--text-dim);margin:0 0 16px;line-height:1.6">Se definen una vez y aplican a todos los colaboradores del negocio. Cada quien puede ajustar su sueldo en su propio expediente.</p>' +
              '<div class="np-grp"><label>Prima dominical (%)</label><input type="number" id="np_prima" min="0" step="1" placeholder="25"><span class="np-hint">Por ley es 25% sobre el sueldo de los domingos trabajados.</span></div>' +
              '<div class="np-grp"><label>Jornada (horas por día)</label><input type="number" id="np_jornada" min="1" max="24" step="0.5" placeholder="8"><span class="np-hint">Base para el pago por hora de las horas extra (sueldo diario ÷ jornada).</span></div>' +
              '<div class="np-grp"><label>Sueldo diario estándar (default $)</label><input type="number" id="np_diario" min="0" step="0.01" placeholder="0.00"><span class="np-hint">Se precarga a cada colaborador nuevo con esquema "por día". Cada quien puede cambiarlo.</span></div>' +
            '</div>' +
            '<div class="modal-footer"><button class="np-btn np-btn-ghost" onclick="NominaParams._close()">Cancelar</button>' +
              '<button class="np-btn np-btn-primary" onclick="NominaParams._save()">Guardar parámetros</button></div>' +
          '</div>';
        document.body.appendChild(el);
    }

    function _close() { var ov = document.getElementById('np_overlay'); if (ov) ov.classList.remove('open'); }

    window.NominaParams = {
        get: _get,
        sync: _sync,
        save: _save,
        open: function (negId, onSaved) {
            var self = this;
            // Los parámetros de nómina afectan todos los pagos: requiere autorización.
            if (window._pedirClaveAdmin) {
                _pedirClaveAdmin('Parámetros de nómina — Autorización requerida',
                    function () { self._openReal(negId, onSaved); }, '⚙️ Continuar');
            } else { this._openReal(negId, onSaved); }
        },
        _openReal: function (negId, onSaved) {
            _negId = negId || localStorage.getItem('etaax_negocio_activo') || '';
            _onSaved = onSaved || null;
            _ensureModal();
            var p = _get(_negId);
            document.getElementById('np_prima').value   = p.primaVacacionalPct;
            document.getElementById('np_jornada').value = p.jornadaHoras;
            document.getElementById('np_diario').value  = p.salarioDiarioDefault || '';
            document.getElementById('np_overlay').classList.add('open');
        },
        _close: _close,
        _save: async function () {
            var params = {
                primaVacacionalPct:  _num(document.getElementById('np_prima').value, DEFAULTS.primaVacacionalPct),
                jornadaHoras:        _num(document.getElementById('np_jornada').value, DEFAULTS.jornadaHoras) || 8,
                salarioDiarioDefault:_num(document.getElementById('np_diario').value, 0)
            };
            await _save(_negId, params);
            _close();
            if (typeof _onSaved === 'function') _onSaved(params);
        }
    };
})();
