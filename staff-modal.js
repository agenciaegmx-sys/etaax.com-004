/* ============================================================
   ETAAX — Componente compartido: Modal de colaborador (staff)
   Permite abrir el mismo formulario "Agregar/editar colaborador"
   del catálogo de staff desde otras páginas (p. ej. Gastos
   globales → Nóminas) como ventana flotante, sin duplicar la
   pantalla completa de staff.

   Requiere (cargados antes): supabase-config.js (_supabase),
   security.js (_hashPwdStaff), y opcionalmente admin-guard.js
   (_pedirClaveAdmin) para el candado de acceso.

   API:
     window.StaffModal.open({ negId, staffId, onSaved, skipGate })
     window.StaffModal.load(negId)        → array de colaboradores
     await window.StaffModal.save(negId, lista)
   ============================================================ */
(function () {
    var _tmpDocs = [];
    var _onSaved = null;
    var _negId   = '';

    /* ── Estilos propios del modal (los base .modal* viven en styles.css) ── */
    function _ensureStyles() {
        if (document.getElementById('smStyles')) return;
        var st = document.createElement('style');
        st.id = 'smStyles';
        st.textContent =
            '#sm_overlay .modal{max-width:700px}' +
            '.sm-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}' +
            '.sm-grp{display:flex;flex-direction:column;gap:5px}' +
            '.sm-grp.full{grid-column:1/-1}' +
            '.sm-grp label{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--text-dim)}' +
            '.sm-grp input,.sm-grp select,.sm-grp textarea{background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:9px 12px;border-radius:6px;font-family:"DM Sans",sans-serif;font-size:14px;outline:none;transition:border-color .2s;width:100%;box-sizing:border-box}' +
            '.sm-grp input:focus,.sm-grp select:focus,.sm-grp textarea:focus{border-color:var(--green)}' +
            '.sm-grp textarea{min-height:80px;resize:vertical}' +
            '.sm-sec{font-size:10px;letter-spacing:2.5px;text-transform:uppercase;color:var(--text-dim);border-bottom:1px solid var(--border);padding-bottom:6px;margin:20px 0 14px}' +
            '.sm-hint{font-size:11px;color:var(--text-dim);margin-top:4px}' +
            '.sm-pwd{position:relative}.sm-pwd input{padding-right:40px}' +
            '.sm-pwd-btn{position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;padding:3px;color:var(--text-dim);line-height:0}' +
            '.sm-drop{border:1px dashed var(--border2);border-radius:8px;padding:20px;text-align:center;cursor:pointer;transition:border-color .2s;background:var(--surface2)}' +
            '.sm-drop:hover{border-color:var(--green)}.sm-drop input[type=file]{display:none}' +
            '.sm-drop-text{font-size:12px;color:var(--text-dim);line-height:1.6}' +
            '.sm-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}' +
            '.sm-chip{display:flex;align-items:center;gap:8px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:12px;color:var(--text);max-width:220px}' +
            '.sm-chip-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}' +
            '.sm-chip-btn{background:transparent;border:none;cursor:pointer;font-size:11px;padding:2px 4px;border-radius:3px;line-height:1}' +
            '.sm-chip-btn.rm{color:var(--red)}' +
            '.sm-btn{font-family:"DM Sans",sans-serif;font-size:13px;padding:9px 18px;border-radius:6px;cursor:pointer;transition:all .2s}' +
            '.sm-btn-primary{background:var(--green);border:none;color:#fff;font-weight:500}' +
            '.sm-btn-primary:hover{opacity:.85}' +
            '.sm-btn-ghost{background:transparent;border:1px solid var(--border);color:var(--text-muted)}' +
            '.sm-btn-ghost:hover{border-color:var(--border2);color:var(--text)}';
        document.head.appendChild(st);
    }

    function _esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function _genId(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,5); }

    /* ── Inyecta el HTML del modal una sola vez ── */
    function _ensureModal() {
        if (document.getElementById('sm_overlay')) return;
        var el = document.createElement('div');
        el.id = 'sm_overlay';
        el.className = 'modal-overlay';
        el.addEventListener('click', function(e){ if (e.target === el) _close(); });
        el.innerHTML =
          '<div class="modal">' +
            '<div class="modal-header">' +
              '<h2 id="sm_title">Agregar colaborador</h2>' +
              '<button class="modal-close" onclick="StaffModal._close()">✕</button>' +
            '</div>' +
            '<div class="modal-body">' +
              '<div class="sm-sec">Datos personales</div>' +
              '<div class="sm-grid">' +
                '<div class="sm-grp full"><label>Nombre completo *</label><input type="text" id="sm_nombre" placeholder="Ej. María Guadalupe Torres"></div>' +
                '<div class="sm-grp"><label>Puesto desempeñado</label><input type="text" id="sm_puesto" placeholder="Mesero, Cocinero, Cajero…"></div>' +
                '<div class="sm-grp"><label>Fecha de ingreso</label><input type="date" id="sm_fechaIngreso" onchange="StaffModal._calcPrima()"></div>' +
                '<div class="sm-grp"><label>Celular / WhatsApp</label><input type="tel" id="sm_celular" placeholder="55 1234 5678"></div>' +
                '<div class="sm-grp"><label>Correo (opcional)</label><input type="email" id="sm_correo" placeholder="nombre@correo.com"></div>' +
                '<div class="sm-grp"><label>Fecha de nacimiento</label><input type="date" id="sm_fechaNacimiento"></div>' +
                '<div class="sm-grp"><label>CURP</label><input type="text" id="sm_curp" maxlength="18" placeholder="18 caracteres" style="text-transform:uppercase"></div>' +
                '<div class="sm-grp"><label>N° Seguro Social (NSS)</label><input type="text" id="sm_nss" maxlength="11" placeholder="11 dígitos" inputmode="numeric"></div>' +
                '<div class="sm-grp full"><label>Dirección actual</label><input type="text" id="sm_direccion" placeholder="Calle, colonia, municipio, CP"></div>' +
                '<div class="sm-grp full"><label>Estado</label><select id="sm_estado"><option>Activo</option><option>Baja temporal</option><option>Baja definitiva</option></select></div>' +
                '<div class="sm-grp full"><label>Rol del sistema</label><select id="sm_rol" onchange="StaffModal._sugCat()">' +
                  '<option value="">— Sin acceso al sistema —</option><option value="admin">👑 Administrador</option><option value="gerente">🎯 Gerente</option>' +
                  '<option value="jefe_cocina">👨‍🍳 Jefe de Cocina</option><option value="chef">🍳 Chef</option><option value="cocinero">🥘 Cocinero</option>' +
                  '<option value="barman">🍸 Barman</option><option value="barista">☕ Barista</option><option value="mesero">🛎️ Mesero</option>' +
                  '<option value="administrativo">📋 Administrativo</option><option value="otro">👤 Otro</option></select></div>' +
              '</div>' +

              '<div class="sm-sec">Acceso al sistema</div>' +
              '<div class="sm-grid">' +
                '<div class="sm-grp"><label>Usuario</label><input type="text" id="sm_usuario" placeholder="ej. juan.garcia" autocomplete="off"><span class="sm-hint">Único por negocio, sin espacios</span></div>' +
                '<div class="sm-grp"><label>Contraseña</label><div class="sm-pwd"><input type="password" id="sm_pwd" placeholder="Mínimo 6 caracteres" autocomplete="new-password"><button type="button" class="sm-pwd-btn" onclick="StaffModal._togglePwd(this)" tabindex="-1">👁</button></div><span class="sm-hint">Dejar vacío para no cambiar</span></div>' +
              '</div>' +

              '<div class="sm-sec">Datos de nómina</div>' +
              '<div class="sm-grid">' +
                '<div class="sm-grp full"><label>Categoría de nómina</label><select id="sm_categoriaNomina">' +
                  '<option value="operativa">⚙️ Operativa — cocina, bar, servicio</option>' +
                  '<option value="administrativa">📋 Administrativa — gerencia, oficina</option>' +
                  '<option value="socios">🤝 Socios Operativos</option></select>' +
                  '<span class="sm-hint">Grupo en el que suma este colaborador en Gastos globales.</span></div>' +
                '<div class="sm-grp"><label>Esquema de pago</label><select id="sm_esquemaSueldo" onchange="StaffModal._togEsq()"><option value="periodo">Sueldo fijo por periodo</option><option value="diario">Sueldo por día (× días trabajados)</option></select></div>' +
                '<div class="sm-grp" id="grpSmDiario" style="display:none"><label>Sueldo diario</label><input type="number" id="sm_sueldoDiario" min="0" step="0.01" placeholder="0.00" oninput="StaffModal._updPrev();StaffModal._calcPrima()"><span class="sm-hint">Al pagar: sueldo diario × días trabajados.</span></div>' +
                '<div class="sm-grp" id="grpSmBase"><label>Salario base (por periodo)</label><input type="number" id="sm_salarioBase" min="0" step="0.01" placeholder="0.00" oninput="StaffModal._calcPrima()"></div>' +
                '<div class="sm-grp full" id="grpSmPreview" style="display:none"><div id="sm_sueldoPreview" style="background:var(--surface2);border:1px solid var(--green);border-radius:8px;padding:10px 14px;font-size:12px;color:var(--text-muted)"></div></div>' +
                '<div class="sm-grp"><label>Periodicidad de pago</label><select id="sm_periodicidad" onchange="StaffModal._calcPrima()"><option value="">— Seleccionar —</option><option value="semanal">Semanal</option><option value="quincenal">Quincenal</option><option value="mensual">Mensual</option></select></div>' +
                '<div class="sm-grp"><label>Día de pago</label><select id="sm_diaPago"><option value="">— Seleccionar —</option><option value="lunes">Lunes</option><option value="martes">Martes</option><option value="miercoles">Miércoles</option><option value="jueves">Jueves</option><option value="viernes">Viernes</option><option value="sabado">Sábado</option><option value="dia1_15">Días 1 y 15</option><option value="dia15_ultimo">Días 15 y último</option><option value="dia1">Día 1 del mes</option><option value="dia15">Día 15 del mes</option><option value="ultimo">Último día del mes</option></select></div>' +
                '<div class="sm-grp"><label>Forma de pago de nómina</label><select id="sm_formaPago"><option value="">— Seleccionar —</option><option>Transferencia Bancaria</option><option>Efectivo</option><option>Cheque</option></select></div>' +
                '<div class="sm-grp full"><label>Datos bancarios (CLABE / cuenta, opcional)</label><input type="text" id="sm_datosBancarios" placeholder="18 dígitos o cuenta"></div>' +
                '<div class="sm-grp full"><label>Prima dominical ($) — calculada automáticamente</label><input type="number" id="sm_primaVacacional" min="0" step="0.01" placeholder="0.00" readonly style="opacity:.85"><span class="sm-hint" id="sm_primaVacHint"></span><label style="display:flex;align-items:center;gap:8px;font-size:12px;margin-top:8px;cursor:pointer;text-transform:none;letter-spacing:0;color:var(--text-muted)"><input type="checkbox" id="sm_primaVacacionalEnPago" style="width:auto"> Trabaja domingos — sumar prima dominical al pago</label></div>' +
                '<div class="sm-grp"><label>Bono / incentivo extra ($)</label><input type="number" id="sm_bonoIncentivo" min="0" step="0.01" placeholder="0.00"></div>' +
              '</div>' +

              '<div class="sm-sec">Referencias personales</div>' +
              '<div class="sm-grid"><div class="sm-grp full"><label>Referencias (nombre y teléfono)</label><textarea id="sm_referencias" placeholder="Nombre: Juan Pérez  Tel: 55 0000 1111"></textarea></div></div>' +

              '<div class="sm-sec">Expediente digital</div>' +
              '<p style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Máximo 5 archivos (INE, contrato, CURP, etc.). PDF, JPG, PNG, DOCX.</p>' +
              '<div class="sm-drop" onclick="document.getElementById(\'sm_fileInput\').click()"><input type="file" id="sm_fileInput" accept=".pdf,.jpg,.jpeg,.png,.docx" multiple onchange="StaffModal._handleFiles(this)"><div style="font-size:24px;margin-bottom:6px">📎</div><div class="sm-drop-text">Haz clic para seleccionar archivos<br><span style="font-size:11px;color:var(--text-dim)">PDF · JPG · PNG · DOCX</span></div></div>' +
              '<div class="sm-chips" id="sm_chips"></div>' +

              '<div class="sm-sec">Notas</div>' +
              '<textarea id="sm_notas" style="width:100%;box-sizing:border-box;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:9px 12px;border-radius:6px;font-family:\'DM Sans\',sans-serif;font-size:14px;min-height:70px;resize:vertical" placeholder="Observaciones generales, horario, condiciones…"></textarea>' +
              '<input type="hidden" id="sm_id">' +
            '</div>' +
            '<div class="modal-footer">' +
              '<button class="sm-btn sm-btn-ghost" onclick="StaffModal._close()">Cancelar</button>' +
              '<button class="sm-btn sm-btn-primary" onclick="StaffModal._save()">Guardar</button>' +
            '</div>' +
          '</div>';
        document.body.appendChild(el);
    }

    /* ── Persistencia (idéntico patrón a staff.html: reemplaza la tabla) ── */
    function _load(negId) {
        try { return JSON.parse(localStorage.getItem('etaax_' + negId + '_staff')) || []; } catch (e) { return []; }
    }
    async function _save(negId, d) {
        localStorage.setItem('etaax_' + negId + '_staff', JSON.stringify(d));
        if (!negId || !window._supabase) return;
        var rDel = await _supabase.from('staff').delete().eq('negocio_id', negId);
        if (rDel.error) { if (window._sbToastError) _sbToastError('staff delete: ' + rDel.error.message); return; }
        if (d.length) {
            var rIns = await _supabase.from('staff').insert(d.map(function(m){ return { id: m.id, negocio_id: negId, datos: m }; }));
            if (rIns.error && window._sbToastError) _sbToastError('staff insert: ' + rIns.error.message);
        }
    }

    function _categoriaPorRol(rol) {
        if (rol === 'gerente' || rol === 'administrativo' || rol === 'admin') return 'administrativa';
        return 'operativa';
    }

    function _fill(staffId) {
        _tmpDocs = [];
        ['sm_nombre','sm_puesto','sm_fechaIngreso','sm_fechaNacimiento','sm_curp','sm_nss','sm_celular','sm_correo','sm_direccion','sm_usuario','sm_pwd','sm_salarioBase','sm_diaPago','sm_formaPago','sm_datosBancarios','sm_primaVacacional','sm_bonoIncentivo','sm_referencias','sm_notas'].forEach(function(id){ document.getElementById(id).value=''; });
        document.getElementById('sm_estado').value = 'Activo';
        document.getElementById('sm_rol').value = '';
        document.getElementById('sm_periodicidad').value = '';
        document.getElementById('sm_categoriaNomina').value = 'operativa';
        document.getElementById('sm_esquemaSueldo').value = 'periodo';
        document.getElementById('sm_sueldoDiario').value = '';
        document.getElementById('sm_fechaNacimiento').value = '';
        document.getElementById('sm_curp').value = '';
        document.getElementById('sm_nss').value = '';
        document.getElementById('sm_primaVacacionalEnPago').checked = false;
        window.StaffModal._togEsq();
        document.getElementById('sm_pwd').placeholder = 'Mínimo 6 caracteres';
        document.getElementById('sm_id').value = '';
        document.getElementById('sm_title').textContent = staffId ? 'Editar colaborador' : 'Agregar colaborador';

        if (staffId) {
            var s = _load(_negId).find(function(x){ return x.id === staffId; });
            if (s) {
                document.getElementById('sm_id').value = s.id;
                document.getElementById('sm_nombre').value = s.nombre || '';
                document.getElementById('sm_puesto').value = s.puesto || '';
                document.getElementById('sm_fechaIngreso').value = s.fechaIngreso || '';
                document.getElementById('sm_celular').value = s.celular || '';
                document.getElementById('sm_correo').value = s.correo || '';
                document.getElementById('sm_direccion').value = s.direccion || '';
                document.getElementById('sm_estado').value = s.estado || 'Activo';
                document.getElementById('sm_fechaNacimiento').value = s.fechaNacimiento || '';
                document.getElementById('sm_curp').value = s.curp || '';
                document.getElementById('sm_nss').value = s.nss || '';
                document.getElementById('sm_rol').value = s.rol || '';
                document.getElementById('sm_usuario').value = s.usuario || '';
                document.getElementById('sm_pwd').placeholder = s.passwordHash ? '•••••••• guardada — vacía para conservarla' : 'Mínimo 6 caracteres';
                document.getElementById('sm_salarioBase').value = s.salarioBase || '';
                document.getElementById('sm_esquemaSueldo').value = s.esquemaSueldo || 'periodo';
                document.getElementById('sm_sueldoDiario').value = s.sueldoDiario || '';
                window.StaffModal._togEsq();
                document.getElementById('sm_categoriaNomina').value = s.categoriaNomina || _categoriaPorRol(s.rol);
                document.getElementById('sm_periodicidad').value = s.periodicidad || '';
                document.getElementById('sm_diaPago').value = s.diaPago || '';
                document.getElementById('sm_formaPago').value = s.formaPagoNomina || '';
                document.getElementById('sm_datosBancarios').value = s.datosBancarios || '';
                document.getElementById('sm_primaVacacional').value = s.primaVacacional || '';
                document.getElementById('sm_bonoIncentivo').value = s.bonoIncentivo || '';
                document.getElementById('sm_referencias').value = s.referencias || '';
                document.getElementById('sm_notas').value = s.notas || '';
                document.getElementById('sm_primaVacacionalEnPago').checked = !!s.primaVacacionalEnPago;
                _tmpDocs = (s.documentos || []).slice();
            }
        }
        window.StaffModal._calcPrima(); // recalcular con todos los datos cargados
        _renderChips();
    }

    function _renderChips() {
        var list = document.getElementById('sm_chips');
        if (!list) return;
        if (!_tmpDocs.length) { list.innerHTML = ''; return; }
        list.innerHTML = _tmpDocs.map(function(doc, i){
            var icon = doc.tipo && doc.tipo.includes('image') ? '🖼️' : (doc.tipo && doc.tipo.includes('pdf') ? '📄' : '📎');
            return '<div class="sm-chip"><span>' + icon + '</span><span class="sm-chip-name" title="' + _esc(doc.nombre) + '">' + _esc(doc.nombre) + '</span>' +
                '<button class="sm-chip-btn rm" title="Eliminar" onclick="StaffModal._removeDoc(' + i + ')">✕</button></div>';
        }).join('');
    }

    function _close() { var ov = document.getElementById('sm_overlay'); if (ov) ov.classList.remove('open'); _tmpDocs = []; }

    async function _saveColaborador() {
        var nombre  = document.getElementById('sm_nombre').value.trim();
        var usuario = document.getElementById('sm_usuario').value.trim().toLowerCase().replace(/\s+/g,'');
        var pwd     = document.getElementById('sm_pwd').value;
        if (!nombre) { alert('El nombre del colaborador es requerido.'); return; }
        if (usuario && pwd && pwd.length < 6) { alert('La contraseña debe tener mínimo 6 caracteres.'); return; }

        var editId = document.getElementById('sm_id').value;
        var data = _load(_negId);
        if (usuario) {
            var dup = data.find(function(s){ return s.usuario === usuario && s.id !== editId; });
            if (dup) { alert('El usuario "' + usuario + '" ya está registrado en este negocio.'); return; }
        }
        var existing = editId ? (data.find(function(s){ return s.id === editId; }) || {}) : {};
        var obj = {
            id: editId || _genId(),
            nombre: nombre,
            puesto: document.getElementById('sm_puesto').value.trim(),
            rol: document.getElementById('sm_rol').value,
            usuario: usuario,
            passwordHash: pwd ? await window._hashPwdStaff(pwd) : (existing.passwordHash || ''),
            fechaIngreso: document.getElementById('sm_fechaIngreso').value,
            fechaNacimiento: document.getElementById('sm_fechaNacimiento').value,
            curp: document.getElementById('sm_curp').value.trim().toUpperCase(),
            nss: document.getElementById('sm_nss').value.trim(),
            celular: document.getElementById('sm_celular').value.trim(),
            correo: document.getElementById('sm_correo').value.trim(),
            direccion: document.getElementById('sm_direccion').value.trim(),
            estado: document.getElementById('sm_estado').value || 'Activo',
            salarioBase: parseFloat(document.getElementById('sm_salarioBase').value) || 0,
            esquemaSueldo: document.getElementById('sm_esquemaSueldo').value || 'periodo',
            sueldoDiario: parseFloat(document.getElementById('sm_sueldoDiario').value) || 0,
            categoriaNomina: document.getElementById('sm_categoriaNomina').value || 'operativa',
            periodicidad: document.getElementById('sm_periodicidad').value,
            diaPago: document.getElementById('sm_diaPago').value,
            formaPagoNomina: document.getElementById('sm_formaPago').value,
            datosBancarios: document.getElementById('sm_datosBancarios').value.trim(),
            primaVacacional: parseFloat(document.getElementById('sm_primaVacacional').value) || 0,
            primaVacacionalEnPago: document.getElementById('sm_primaVacacionalEnPago').checked,
            bonoIncentivo: parseFloat(document.getElementById('sm_bonoIncentivo').value) || 0,
            referencias: document.getElementById('sm_referencias').value.trim(),
            notas: document.getElementById('sm_notas').value.trim(),
            documentos: _tmpDocs.slice()
        };
        var idx = data.findIndex(function(s){ return s.id === obj.id; });
        if (idx > -1) { data[idx] = obj; } else { data.push(obj); }
        await _save(_negId, data);
        _close();
        if (typeof _onSaved === 'function') _onSaved(obj);
    }

    window.StaffModal = {
        open: function (opts) {
            opts = opts || {};
            _negId   = opts.negId || localStorage.getItem('etaax_negocio_activo') || '';
            _onSaved = opts.onSaved || null;
            var go = function () { _ensureStyles(); _ensureModal(); _fill(opts.staffId || ''); document.getElementById('sm_overlay').classList.add('open'); };
            if (window._pedirClaveAdmin && !opts.skipGate) {
                _pedirClaveAdmin('Colaboradores — Acceso restringido', go, '🔓 Desbloquear');
            } else { go(); }
        },
        load: _load,
        save: _save,
        categoriaPorRol: _categoriaPorRol,
        _close: _close,
        _save: _saveColaborador,
        _sugCat: function () { document.getElementById('sm_categoriaNomina').value = _categoriaPorRol(document.getElementById('sm_rol').value); },
        _togEsq: function () {
            var diario = document.getElementById('sm_esquemaSueldo').value === 'diario';
            document.getElementById('grpSmDiario').style.display = diario ? '' : 'none';
            document.getElementById('grpSmBase').style.display  = diario ? 'none' : '';
            if (diario && !document.getElementById('sm_sueldoDiario').value && window.NominaParams) {
                var def = NominaParams.get(_negId || localStorage.getItem('etaax_negocio_activo') || '').salarioDiarioDefault;
                if (def > 0) document.getElementById('sm_sueldoDiario').value = def;
            }
            window.StaffModal._updPrev();
            window.StaffModal._calcPrima();
        },
        _calcPrima: function () {
            // Prima DOMINICAL = domingos del mes × sueldo diario × %
            var negId = _negId || localStorage.getItem('etaax_negocio_activo') || '';
            var pct = (window.NominaParams ? NominaParams.get(negId).primaVacacionalPct : 25) || 25;
            var diario;
            if (document.getElementById('sm_esquemaSueldo').value === 'diario') diario = parseFloat(document.getElementById('sm_sueldoDiario').value) || 0;
            else { var b = parseFloat(document.getElementById('sm_salarioBase').value) || 0, per = document.getElementById('sm_periodicidad').value; diario = per === 'semanal' ? b / 7 : per === 'quincenal' ? b / 15 : b / 30; }
            var d = new Date(), y = d.getFullYear(), m = d.getMonth(), ult = new Date(y, m + 1, 0).getDate(), domingos = 0;
            for (var i = 1; i <= ult; i++) if (new Date(y, m, i).getDay() === 0) domingos++;
            var prima = domingos * diario * (pct / 100);
            document.getElementById('sm_primaVacacional').value = prima > 0 ? prima.toFixed(2) : '';
            var hint = document.getElementById('sm_primaVacHint');
            if (hint) hint.textContent = diario > 0
                ? (domingos + ' domingos del mes × $' + diario.toFixed(2) + ' × ' + pct + '% (si trabaja domingos)')
                : 'Define el sueldo del colaborador para calcular la prima dominical.';
        },
        _updPrev: function () {
            var prev = document.getElementById('grpSmPreview');
            if (document.getElementById('sm_esquemaSueldo').value !== 'diario') { prev.style.display = 'none'; return; }
            var diario = parseFloat(document.getElementById('sm_sueldoDiario').value) || 0;
            var dMes = new Date(); var diasMes = new Date(dMes.getFullYear(), dMes.getMonth()+1, 0).getDate();
            var fmt = function(v){ return '$' + v.toLocaleString('es-MX', {minimumFractionDigits:2, maximumFractionDigits:2}); };
            document.getElementById('sm_sueldoPreview').innerHTML =
                '💡 Equivale a — Semana: <strong style="color:var(--text)">' + fmt(diario*7) + '</strong> · ' +
                'Quincena: <strong style="color:var(--text)">' + fmt(diario*15) + '</strong> · ' +
                'Mes (' + diasMes + ' días): <strong style="color:var(--text)">' + fmt(diario*diasMes) + '</strong>';
            prev.style.display = '';
        },
        _togglePwd: function (btn) { var inp = btn.parentNode.querySelector('input'); inp.type = inp.type === 'password' ? 'text' : 'password'; },
        _handleFiles: function (input) {
            var files = Array.prototype.slice.call(input.files);
            var avail = 5 - _tmpDocs.length;
            if (avail <= 0) { alert('Máximo 5 archivos por colaborador.'); input.value = ''; return; }
            files = files.slice(0, avail);
            var pending = files.length;
            files.forEach(function (file) {
                var reader = new FileReader();
                reader.onload = function (e) { _tmpDocs.push({ nombre: file.name, tipo: file.type, data: e.target.result }); pending--; if (pending === 0) _renderChips(); };
                reader.readAsDataURL(file);
            });
            input.value = '';
        },
        _removeDoc: function (i) { _tmpDocs.splice(i, 1); _renderChips(); }
    };
})();
