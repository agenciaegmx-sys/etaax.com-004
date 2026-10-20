/* ============================================================
   ETAAX — Parámetros globales de nómina por negocio
   Un solo registro por negocio (tabla gf_nomina_params):
     { primaVacacionalPct, jornadaHoras, salarioDiarioDefault, referenciasSueldo }
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
            salarioDiarioDefault:_num(p.salarioDiarioDefault, DEFAULTS.salarioDiarioDefault),
            referenciasSueldo: p.referenciasSueldo || {}
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
        if (!negId) throw new Error('No hay negocio activo.');
        var previo = _get(negId), remoto = !!window._supabase;
        if (remoto) {
            var actual = await _supabase.from('gf_nomina_params').select('datos').eq('negocio_id', negId).maybeSingle();
            if (actual.error) throw new Error(actual.error.message);
            if (actual.data && actual.data.datos) previo = actual.data.datos;
        }
        var refs = Object.assign(Object.create(null), previo.referenciasSueldo || {});
        if (_num(params.salarioDiarioDefault, _num(previo.salarioDiarioDefault, 0)) !== _num(previo.salarioDiarioDefault, 0)) {
            var staff;
            if (remoto) {
                var r = await _supabase.from('staff').select('datos').eq('negocio_id', negId);
                if (r.error || !Array.isArray(r.data)) throw new Error(r.error ? r.error.message : 'No se pudo revisar el personal.');
                staff = r.data.map(function(row){ return row.datos; });
            } else {
                staff = JSON.parse(localStorage.getItem('etaax_' + negId + '_staff') || '[]');
            }
            if (!window.EtaaxCore) throw new Error('No se pudo cargar el cálculo de nómina.');
            /* Clasificar una sola vez, usando el mínimo ANTERIOR. Guardamos la
               referencia en el MISMO documento del parámetro, sin reescribir
               fichas, credenciales ni expedientes de otras sucursales. */
            (staff || []).forEach(function(s){
                if (!s || !s.id || s.esquemaSueldo !== 'diario' || s.origenSueldo ||
                    Object.prototype.hasOwnProperty.call(refs, s.id)) return;
                refs[s.id] = { origen: EtaaxCore.sueldoUsaMinimo(s, previo) ? 'minimo' : 'personalizado',
                    sueldoDiario: _num(s.sueldoDiario, 0) };
            });
        }
        var siguiente = Object.assign({}, previo, params, { referenciasSueldo: refs });
        if (remoto) {
            var guardado = await _supabase.from('gf_nomina_params').upsert(
                { negocio_id: negId, datos: siguiente, updated_at: new Date().toISOString() },
                { onConflict: 'negocio_id' }
            );
            if (guardado.error) throw new Error(guardado.error.message);
        }
        localStorage.setItem(_key(negId), JSON.stringify(siguiente));
        if (typeof window.dispatchEvent === 'function') window.dispatchEvent(new CustomEvent('etaax:nomina-params', { detail: { negocioId: negId } }));
        return siguiente;
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
            '.np-inw{position:relative;display:flex;align-items:center}' +
            '.np-suf{position:absolute;right:12px;color:var(--text-dim);font-size:13px;pointer-events:none}' +
            '.np-pre{position:absolute;left:12px;color:var(--text-dim);font-size:14px;pointer-events:none}' +
            '.np-inw.suf input{padding-right:46px}' +
            '.np-inw.pre input{padding-left:24px}' +
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
            '<div class="modal-header"><h2>💵 Definir salario mínimo</h2><button class="modal-close" onclick="NominaParams._close()">✕</button></div>' +
            '<div class="modal-body">' +
              '<p style="font-size:12px;color:var(--text-dim);margin:0 0 16px;line-height:1.6">Se definen una vez y aplican a todos los colaboradores del negocio. Cada quien puede ajustar su sueldo en su propio expediente.</p>' +
              '<div class="np-grp"><label>Prima dominical</label><div class="np-inw suf"><input type="number" id="np_prima" min="0" step="1" placeholder="25"><span class="np-suf">%</span></div><span class="np-hint">Por ley es 25% sobre el sueldo de los domingos trabajados.</span></div>' +
              '<div class="np-grp"><label>Jornada (horas por día)</label><div class="np-inw suf"><input type="number" id="np_jornada" min="1" max="24" step="0.5" placeholder="8"><span class="np-suf">hrs</span></div><span class="np-hint">Base para el pago por hora de las horas extra (sueldo diario ÷ jornada).</span></div>' +
              '<div class="np-grp"><label>Salario mínimo diario (default)</label><div class="np-inw pre"><span class="np-pre">$</span><input type="number" id="np_diario" min="0" step="0.01" placeholder="0.00"></div><span class="np-hint">Actualiza a los colaboradores vinculados al mínimo, incluidos los registros anteriores. Los sueldos personalizados se conservan.</span></div>' +
              '<p id="np_error" role="alert" style="display:none;color:var(--red);font-size:12px"></p>' +
            '</div>' +
            '<div class="modal-footer"><button class="np-btn np-btn-ghost" onclick="NominaParams._close()">Cancelar</button>' +
              '<button id="np_guardar" class="np-btn np-btn-primary" onclick="NominaParams._save()">Guardar parámetros</button></div>' +
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
                _pedirClaveAdmin('Definir salario mínimo — Autorización requerida',
                    function () { self._openReal(negId, onSaved); }, '💵 Continuar');
            } else { this._openReal(negId, onSaved); }
        },
        _openReal: function (negId, onSaved) {
            _negId = negId || localStorage.getItem('etaax_negocio_activo') || '';
            _onSaved = onSaved || null;
            _ensureModal();
            document.getElementById('np_error').style.display = 'none';
            var p = _get(_negId);
            document.getElementById('np_prima').value   = p.primaVacacionalPct;
            document.getElementById('np_jornada').value = p.jornadaHoras;
            document.getElementById('np_diario').value  = p.salarioDiarioDefault || '';
            document.getElementById('np_overlay').classList.add('open');
        },
        _close: _close,
        _save: async function () {
            var btn = document.getElementById('np_guardar');
            if (btn.disabled) return;
            btn.disabled = true;
            var params = {
                primaVacacionalPct:  _num(document.getElementById('np_prima').value, DEFAULTS.primaVacacionalPct),
                jornadaHoras:        _num(document.getElementById('np_jornada').value, DEFAULTS.jornadaHoras) || 8,
                salarioDiarioDefault:_num(document.getElementById('np_diario').value, 0)
            };
            try {
                var guardado = await _save(_negId, params);
                _close();
                if (typeof _onSaved === 'function') _onSaved(guardado);
            } catch (e) {
                var err = document.getElementById('np_error');
                err.textContent = 'No se guardaron los parámetros: ' + e.message;
                err.style.display = '';
            } finally { btn.disabled = false; }
        }
    };
})();
