/* Presentación de Staff. No escribe registros, roles ni permisos: conserva
   los nodos y handlers originales, incluso los valores emoji de los roles. */
(function () {
    'use strict';
    var pagina = location.pathname.split('/').filter(Boolean).pop() || '';
    if (pagina.indexOf('.') < 0) pagina += '.html';
    if (pagina === 'staff.html') document.body.classList.add('etx-staff-page');
    if (pagina === 'permisos.html') document.body.classList.add('etx-permisos-page');
    var pendiente = false;
    var perfiles = {
        '👑':['admin','Administrador'], '🎯':['gerente','Gerente'],
        '👨‍🍳':['chef','Jefe de cocina'], '🧑‍🍳':['chef','Cocina'], '🍳':['cocina','Chef'],
        '🍷':['jefe-barra','Jefe de barra'], '🥘':['cocina','Cocinero'],
        '🍸':['barman','Barman'], '☕':['barista','Barista'], '🛎️':['mesero','Mesero'],
        '📋':['administrativo','Administrativo'], '👤':['persona','Colaborador'],
        '💁':['recepcion','Recepción'], '🧾':['expediente','Comprobantes'], '💵':['salario','Salario'],
        '🧹':['limpieza','Limpieza'], '🧑‍💼':['asesoria','Asesoría'], '🚚':['transporte','Transporte'],
        '🎧':['soporte','Soporte'], '🔑':['llave','Acceso']
    };
    var prefijo = /^(?:\s|[🔍🔐🔓🔒👥💵🗂✏🗑↩←✕✖＋+−—📎⬇💡🎂⚙🤝🍸🍳🍽🗃]|\uFE0F)+/u;
    function cada(s, fn) { document.querySelectorAll(s).forEach(fn); }
    function icono(el, nombre, prefijoExacto) {
        if (!el || typeof window.etaaxIcono !== 'function') return;
        el.querySelectorAll(':scope > span[aria-hidden="true"]:not(.s-ui-icon)').forEach(function (s) {
            if (!s.querySelector('svg') && /^[\s—−✕✖]+$/.test(s.textContent)) s.remove();
        });
        var actual = el.querySelector(':scope > .s-ui-icon');
        if (actual && actual.dataset.icono === nombre) return;
        if (actual) actual.remove();
        el.querySelectorAll(':scope > .etx-emoji-slot').forEach(function (s) { s.remove(); });
        // Solo el primer texto: no tocar nombres ni separadores tras un <b>.
        var inicio = true;
        Array.from(el.childNodes).forEach(function (n) {
            if (n.nodeType === 3 && inicio) {
                var t = n.textContent.trimStart();
                n.textContent = prefijoExacto !== undefined
                    ? (t.indexOf(prefijoExacto) === 0 ? t.slice(prefijoExacto.length).trimStart() : n.textContent)
                    : n.textContent.replace(prefijo, '');
                inicio = false;
            }
        });
        var s = document.createElement('span'); s.className = 's-ui-icon';
        s.dataset.icono = nombre; s.setAttribute('aria-hidden', 'true');
        s.innerHTML = window.etaaxIcono(nombre.indexOf(':') >= 0 ? nombre.split(':')[1] : 'stf-' + nombre, {tam:20});
        el.insertBefore(s, el.firstChild); el.dataset.etxEmoji = '1';
    }
    function perfil(el, emoji) {
        if (!el) return;
        var p = perfiles[emoji];
        if (p) icono(el, p[0], emoji);
    }
    function emojiInicial(el) {
        var t = el.textContent.trimStart();
        return Object.keys(perfiles).find(function (e) { return t.indexOf(e) === 0; });
    }
    function titulo(el, nombre) {
        if (!el || el.querySelector(':scope > .s-title-plate')) return;
        var t = el.textContent.replace(prefijo, '').trim();
        el.textContent = '';
        var placa = document.createElement('span'); placa.className = 's-title-plate'; icono(placa, nombre);
        var copia = document.createElement('span'); copia.className = 's-title-copy'; copia.textContent = t;
        el.appendChild(placa); el.appendChild(copia); el.dataset.etxEmoji = '1';
    }
    function opciones(selector) {
        cada(selector, function (o) {
            // Solo opciones con value explícito: el texto de las otras ES su valor.
            if (!o.hasAttribute('value')) return;
            var e = emojiInicial(o);
            if (e) o.textContent = o.textContent.trimStart().slice(e.length).trimStart();
            else {
                var limpio = o.textContent.replace(/^(?:⚙️|🤝|🍽️|🗃️)\s*/u, '');
                if (limpio !== o.textContent) o.textContent = limpio;
            }
        });
    }
    function pintarStaff() {
        var botones = {
            '#btnRolesPermisos':'roles', '#btnSalarioMinimo':'parametros', '#btnBajas':'bajas',
            '#btnAgregarColaborador':'agregar', '#modalStaff [onclick="saveStaff()"]':'guardar',
            '#btnFoto':'subir', '#btnQuitarFoto':'eliminar',
            '#modalStaff [onclick="_bonoAgregar()"]':'agregar', '#modalStaff .file-drop-icon':'subir',
            '#expBtnVer':'candado', '#np_overlay .np-btn-primary':'guardar',
            '#bajasList [onclick^="reactivarStaff"]':'reactivar',
            '#bajasList [onclick^="cerrarBajas();verExpediente"]':'expediente',
            '#expOverlay [onclick^="_expCerrar();openModal"]':'editar',
            '#expOverlay [onclick="_expCerrar()"]':'cerrar',
            '#docVisor [onclick^="downloadDoc"]':'descargar', '#docVisor [onclick="cerrarDoc()"]':'cerrar',
            '#emptyState [onclick^="desbloquearCatalogo"]':'desbloquear'
        };
        Object.keys(botones).forEach(function (s) { cada(s, function (el) { icono(el, botones[s]); }); });
        [['btnModUsuario','fUsuario'],['btnModPwd','fPwd'],['btnModSueldoDiario','fSueldoDiario'],['btnModSalarioBase','fSalarioBase']].forEach(function (par) {
            var b = document.getElementById(par[0]), campo = document.getElementById(par[1]);
            if (b && campo) { icono(b, campo.readOnly ? 'candado' : 'desbloquear'); b.classList.toggle('s-unlocked', !campo.readOnly); }
        });
        cada('#np_overlay .np-grp > label', function (el, i) { icono(el, ['prima','horas','salario'][i]); });
        cada('.search-icon', function (el) { icono(el, 'buscar'); });
        titulo(document.getElementById('modalTitle'), 'persona');
        titulo(document.querySelector('#modalBajas .modal-header h2'), 'bajas');
        titulo(document.querySelector('#np_overlay .modal-header h2'), 'parametros');
        cada('#modalStaff,#modalBajas,#np_overlay', function (raiz) {
            raiz.querySelectorAll('.modal-close').forEach(function (el) { icono(el, 'cerrar'); el.setAttribute('aria-label','Cerrar'); });
            raiz.querySelectorAll('.etx-min-btn').forEach(function (el) { icono(el, 'minimizar'); });
        });
        cada('#modalStaff .modal-section', function (el, i) {
            icono(el, ['persona','llave','nomina','referencias','expediente','notas'][i]);
            el.dataset.paso = ('0' + (i + 1)).slice(-2);
        });
        cada('#staffTbody .rol-badge,#expOverlay .rol-badge', function (el) {
            var e = emojiInicial(el); if (e) perfil(el, e);
        });
        cada('#staffTbody [title="Opciones"]', function (el) {
            if (!el.querySelector('.s-ui-icon')) el.textContent = '';
            icono(el, 'mas'); el.setAttribute('aria-label', 'Opciones del colaborador');
        });
        cada('[title="Hoy cumple años"]', function (el) { icono(el, 'cumpleanos'); });
        var vacio = document.querySelector('#emptyState .empty-state-icon');
        if (vacio) icono(vacio, window._bloqueado ? 'candado' : 'staff');
        var foto = document.getElementById('fotoPrev');
        if (foto && !document.getElementById('fFoto').value) icono(foto, 'persona', '👤');
        var resumen = document.getElementById('sueldoPreviewTxt');
        if (resumen && resumen.textContent.trim()) icono(resumen, 'salario');
        opciones('#fRol option,#fArea option,#fCategoriaNomina option');
        var rol = document.getElementById('fRol');
        if (rol && typeof window.getRol === 'function') {
            var r = window.getRol(rol.value); icono(rol.parentElement.querySelector('label'), r && perfiles[r.icon] ? perfiles[r.icon][0] : 'roles');
        }
        cada('.st-menu > div[onclick]', function (el) {
            var h = el.getAttribute('onclick');
            var nombre = /deleteStaff/.test(h) ? 'eliminar' : /darDeBajaStaff/.test(h) ? 'bajas' : /reactivarStaff/.test(h) ? 'reactivar' : /openModal/.test(h) ? 'editar' : 'expediente';
            var dibujo = el.querySelector(':scope > span');
            if (dibujo && !dibujo.querySelector('.s-ui-icon')) dibujo.textContent = '';
            icono(dibujo, nombre);
        });
        var exp = document.querySelector('#expOverlay > div');
        if (exp) {
            exp.classList.add('s-exp-card');
            exp.children[0].classList.add('s-exp-header'); exp.children[1].classList.add('s-exp-grid');
            Array.from(exp.children[1].children).forEach(function (sec, i) {
                sec.classList.add('s-exp-section');
                var t = sec.firstElementChild.firstElementChild;
                t.classList.add('s-exp-section-title');
                icono(t, ['contacto','persona','nomina','llave','expediente','notas'][i]);
            });
            cada('#expOverlay [onclick^="verDoc"]', function (el) { icono(el, 'adjunto', '📎'); });
        }
        cada('#bajasList > div:has(button)', function (el) { el.classList.add('s-baja-row'); });
        cada('#bajasList [onclick^="reactivarStaff"]', function (el) { el.classList.add('s-reactivar'); });
        cada('#bonosLista [onclick^="_bonoQuitar"]', function (el) { icono(el, 'eliminar'); });
    }
    function pintarPermisos() {
        var botones = {
            '[onclick="renombrarRol()"]':'editar',
            '[onclick="borrarRol()"]':'eliminar', '[onclick="editarRol()"]':'editar',
            '[onclick="resetarRol()"]':'restablecer', '[onclick="guardarPermisos()"]':'guardar',
            '#adminLockNote':'candado', '#permLockOverlay [onclick="_gatePermisos()"]':'desbloquear',
            '#permLockOverlay a':'volver'
        };
        Object.keys(botones).forEach(function (s) { cada(s, function (el) { icono(el, botones[s]); }); });
        cada('[onclick="nuevoRol()"] .rol-tab-icon', function (el) {
            if (!el.querySelector('.s-ui-icon')) el.textContent = '';
            icono(el, 'agregar');
        });
        var lock = document.querySelector('#permLockOverlay > div:first-child');
        if (lock) icono(lock, 'roles');
        cada('.rol-tab-icon', function (el) { var e = emojiInicial(el); if (e) perfil(el, e); });
        cada('.suc-tab', function (el) {
            var dibujo = el.querySelector(':scope > span');
            if (dibujo && (dibujo.textContent === '🌐' || dibujo.querySelector('.s-ui-icon'))) {
                if (!dibujo.querySelector('.s-ui-icon')) dibujo.textContent = '';
                icono(dibujo, 'sucursal');
            }
        });
        var modulos = {recetas:'mod-escandallos',insumos:'mod-insumos',inventarios:'mod-inventarios',
            requisiciones:'mod-requisiciones',ventas:'fin-ventas',ventas_productos:'fin-ventas',gastos:'adm-gastos-diarios',
            menu:'cat-recetas',proveedores:'cat-proveedores',clientes:'cat-clientes',staff:'stf-staff',
            permisos:'stf-roles',financiero:'fin-estadisticas',config:'stf-parametros'};
        cada('.mod-card', function (el) {
            var k = el.id.replace('pcard_',''), ic = el.querySelector('.mod-icon');
            if (ic && !ic.querySelector('.s-ui-icon')) ic.textContent = '';
            icono(ic, ':' + (modulos[k] || 'stf-roles'));
        });
        cada('.rm-emo', function (el) {
            var m = (el.getAttribute('onclick') || '').match(/_rmElegirIcono\('([^']+)'\)/);
            if (!m || !perfiles[m[1]]) return;
            perfil(el, m[1]); el.setAttribute('aria-label', perfiles[m[1]][1]); el.title = perfiles[m[1]][1];
            el.setAttribute('aria-pressed', el.classList.contains('sel') ? 'true' : 'false');
        });
        perfil(document.getElementById('rmPrevIcon'), window._rmIcono);
        var kick = document.getElementById('rmKickIcon');
        if (kick) {
            var texto = kick.textContent.trim();
            if (texto && !kick.querySelector('.s-ui-icon')) {
                kick.textContent = ''; icono(kick, /🗑|⚠/u.test(texto) ? 'eliminar' : /✏/u.test(texto) ? 'editar' : 'roles');
            }
        }
        opciones('#rmBase option');
    }
    function pintarTool() {
        var raiz = document.getElementById('toolModal');
        if (!raiz) return;
        var staff = window._toolBase === 'staff.html';
        raiz.classList.toggle('s-staff-tool', staff);
        if (!staff) return;
        var perms = typeof window._tmArchivo === 'function' && window._tmArchivo() === 'permisos.html';
        var ic = document.getElementById('tmIcon');
        if (ic && !ic.querySelector('.s-ui-icon')) ic.textContent = '';
        icono(ic, perms ? 'roles' : 'staff');
        icono(document.getElementById('tmBack'), 'volver');
        icono(document.getElementById('tmClose'), 'cerrar');
        cada('#toolModal .etx-min-btn', function (el) { icono(el, 'minimizar'); });
    }
    function pintar() {
        pendiente = false;
        if (typeof window.etaaxIcono !== 'function') return;
        if (pagina === 'staff.html') pintarStaff();
        if (pagina === 'permisos.html') pintarPermisos();
        if (pagina === 'staff-hub.html') pintarTool();
    }
    function agendar() { if (!pendiente) { pendiente = true; requestAnimationFrame(pintar); } }
    pintar();
    document.addEventListener('change', agendar);
    new MutationObserver(agendar).observe(document.body, {childList:true,subtree:true,characterData:true});
    var frame = document.getElementById('tmFrame');
    if (frame) { frame.addEventListener('load', agendar); new MutationObserver(agendar).observe(frame,{attributes:true,attributeFilter:['src']}); }
})();
