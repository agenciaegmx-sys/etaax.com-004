/* Cuenta personal y plan del negocio. Usa la sesión existente, los precios
   compartidos y el checkout actual; las suscripciones se consultan, no se editan. */
(function () {
    'use strict';
    var vista = document.body.dataset.cuentaVista;
    var estado = { usuario: null, staff: false, negocios: [], compartidos: [], volver: '/hub.html', vuelta: 0 };
    var verificador = null;
    var $ = function (id) { return document.getElementById(id); };
    function esc(x) { return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
    function leer(almacen, clave) { try { return JSON.parse(almacen.getItem(clave) || 'null'); } catch (e) { return null; } }
    function icono(n, tam) { return typeof etaaxIcono === 'function' ? etaaxIcono(n, { tam: tam || 20 }) : ''; }
    function pesos(v) { return Number(v || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 }); }
    function fecha(v) {
        if (!v) return 'Por definir';
        var d = new Date(String(v).slice(0, 10) + 'T12:00:00');
        return isNaN(d.getTime()) ? 'Por definir' : d.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
    }
    function regreso() {
        var raw = new URLSearchParams(location.search).get('volver') || document.referrer || '/hub.html';
        try {
            var u = new URL(raw, location.origin);
            if (u.origin === location.origin && /\.html$/.test(u.pathname) && !/\/(mi-cuenta|plan-facturacion)\.html$/.test(u.pathname)) return u.pathname + u.search;
        } catch (e) {}
        return '/hub.html';
    }
    function rutas() {
        estado.volver = regreso();
        $('cuentaVolver').href = estado.volver;
        $('cuentaTab').href = '/mi-cuenta.html?volver=' + encodeURIComponent(estado.volver);
        $('planTab').href = '/plan-facturacion.html?volver=' + encodeURIComponent(estado.volver);
    }
    function contacto(asunto, texto, whats) {
        var c = ETAAX_PAGO_DATOS.contacto;
        return whats ? 'https://wa.me/' + c.whatsapp + '?text=' + encodeURIComponent(texto)
            : 'mailto:' + c.email + '?subject=' + encodeURIComponent(asunto) + '&body=' + encodeURIComponent(texto);
    }
    function botonContacto(asunto, texto, etiqueta, whats) {
        return '<a class="cuenta-btn secundario" href="' + esc(contacto(asunto, texto, whats)) + '">' + esc(etiqueta) + '</a>';
    }
    function conPlazo(promesa) {
        var timer;
        return Promise.race([Promise.resolve(promesa), new Promise(function (_, reject) {
            timer = setTimeout(function () { reject(new Error('La conexión tardó demasiado.')); }, 12000);
        })]).finally(function () { clearTimeout(timer); });
    }
    function identidad() {
        var ses = leer(sessionStorage, 'etaax_sesion_hub') || {};
        var ctx = leer(localStorage, 'etaax_ctx') || {};
        return estado.staff ? (ses.type === 'staff' && ses.nombre || ctx.ctxType === 'staff' && ctx.userName || 'Colaborador')
            : ((estado.usuario.user_metadata || {}).nombre || estado.usuario.email || 'Mi cuenta');
    }
    function pintarHeader(activa) {
        etaaxHeader({ activa: activa, usuario: activa ? identidad() : 'Sin sesión', inicio: '/hub.html', cerrarSesion: salir });
    }
    async function salir() {
        if (typeof etaaxConfirmSalir !== 'function' || !(await etaaxConfirmSalir())) return;
        var neg = estado.staff && estado.compartidos[0];
        await etaaxCerrarSesion(estado.staff, neg && neg.id);
        if (typeof _etaaxWipeCache === 'function') _etaaxWipeCache();
        ['etaax_ctx', 'etaax_negocio_activo', 'etaax_sucursal_activa', 'etaax_qses'].forEach(function (k) { localStorage.removeItem(k); });
        sessionStorage.clear();
        location.href = '/hub.html?salir=1';
    }
    function vacio(titulo, texto, sesion) {
        $('cuentaContenido').innerHTML = '<section class="cuenta-card cuenta-empty cuenta-wide"><h2>' + esc(titulo) + '</h2><p>' + esc(texto) + '</p>' +
            '<div class="cuenta-actions"><button class="cuenta-btn secundario" id="cuentaReintentar">Reintentar</button>' +
            '<a class="cuenta-btn" href="/hub.html">' + (sesion ? 'Ir a Inicio' : 'Iniciar sesión') + '</a></div></section>';
        $('cuentaReintentar').onclick = iniciar;
    }
    async function iniciar() {
        rutas();
        estado.usuario = null;
        pintarHeader(false);
        $('cuentaContenido').innerHTML = '<div class="cuenta-card cuenta-loading" role="status">Cargando ' + (vista === 'plan' ? 'tu plan' : 'tu cuenta') + '…</div>';
        try {
            var r = await conPlazo(_supabase.auth.getUser());
            if (r.error || !r.data || !r.data.user) {
                if (r.error && r.error.name !== 'AuthSessionMissingError' && r.error.status !== 401 && r.error.status !== 403) throw r.error;
                vacio('Entra a tu cuenta', 'Inicia sesión para consultar tus datos y el servicio de tu negocio.', false);
                return;
            }
            estado.usuario = r.data.user;
            // La cuenta compartida se reconoce también contra la base. Una
            // preferencia de navegador no basta para habilitar cambios de acceso.
            var rs = await Promise.all([
                conPlazo(_supabase.from('negocios').select('id,usuario_id,datos').eq('usuario_id', estado.usuario.id).order('created_at', { ascending: true })),
                conPlazo(_supabase.from('negocios').select('id,usuario_id,datos').eq('staff_uid', estado.usuario.id).order('created_at', { ascending: true }))
            ]);
            if (rs[0].error || rs[1].error) throw new Error('No pudimos verificar los negocios de tu cuenta.');
            estado.negocios = rs[0].data || [];
            estado.compartidos = rs[1].data || [];
            var ctx = leer(localStorage, 'etaax_ctx') || {}, ses = leer(sessionStorage, 'etaax_sesion_hub') || {};
            estado.staff = estado.compartidos.length > 0 || ctx.ctxType === 'staff' || ses.type === 'staff';
            pintarHeader(true);
            if (vista === 'plan') pintarSelector(); else pintarCuenta();
        } catch (e) { vacio('No pudimos cargar esta información', 'Revisa tu conexión y vuelve a intentarlo. Tus datos siguen guardados.', !!estado.usuario); }
    }
    function listaNegocios() {
        var lista = estado.staff ? estado.compartidos : estado.negocios;
        return lista.length ? '<ul class="cuenta-lista">' + lista.map(function (n) {
            return '<li>' + esc((n.datos || {}).nombre || 'Negocio') + '<span>' + (estado.staff ? 'Acceso de colaborador' : 'Cuenta titular') + '</span></li>';
        }).join('') + '</ul>' : '<p>Todavía no tienes un negocio registrado.</p>';
    }
    function pintarCuenta() {
        var u = estado.usuario, nombre = identidad();
        var hero = '<section class="cuenta-card cuenta-hero"><div class="cuenta-avatar">' + icono('perfil', 28) + '</div><div><h2>' + esc(nombre) + '</h2><p>' +
            esc(estado.staff ? 'Acceso con usuario y NIP' : u.email || '') + '</p><span class="cuenta-badge activa">' + (estado.staff ? 'Colaborador' : 'Mi cuenta') + '</span></div></section>';
        var lateral = '<aside class="cuenta-stack"><section class="cuenta-card"><h2>' + icono('org-corporativo') + 'Mis negocios</h2><p>Los negocios vinculados a este acceso.</p>' + listaNegocios() +
            '<div class="cuenta-actions"><a class="cuenta-btn secundario" href="' + esc($('planTab').href) + '">Ver plan y facturación</a></div></section>' +
            '<section class="cuenta-card"><h2>' + icono('hd-sistema') + 'Apariencia</h2><p>Elige cómo se ve ETAAX. Tu preferencia se aplica en todas las pantallas.</p>' +
            '<div class="cuenta-field" style="margin-top:16px"><label for="cuentaTema">Tema</label><select id="cuentaTema"><option value="dark">Oscuro</option><option value="light">Claro</option><option value="auto">Usar tema del dispositivo</option></select></div></section></aside>';
        var perfil;
        if (estado.staff) {
            perfil = '<section class="cuenta-card"><h2>' + icono('usuario') + 'Tu acceso</h2><p>Tu nombre, NIP y permisos los administra el responsable de tu negocio.</p>' +
                '<div class="cuenta-nota" style="margin-top:16px">Para actualizar tus datos, solicita el cambio a tu gerente o al titular del negocio.</div></section>';
        } else {
            perfil = '<section class="cuenta-card"><div class="cuenta-card-head"><h2>' + icono('usuario') + 'Datos de la cuenta</h2><p>Identifica este acceso con el nombre del titular o del corporativo. El nombre del negocio se edita en Configurar negocio.</p></div>' +
                '<form id="cuentaNombreForm" class="cuenta-form"><div class="cuenta-field"><label for="cuentaNombre">Nombre del titular o corporativo</label><input id="cuentaNombre" name="nombre" autocomplete="name" maxlength="120" required value="' + esc(nombre) + '"></div>' +
                '<div class="cuenta-field"><label for="cuentaEmail">Correo de acceso</label><input id="cuentaEmail" type="email" value="' + esc(u.email || '') + '" readonly></div>' +
                '<div class="cuenta-actions"><button class="cuenta-btn" type="submit">Guardar nombre</button></div><div class="cuenta-msg" id="cuentaNombreMsg" role="status"></div></form>' +
                '<details class="cuenta-details"><summary>Cambiar correo de acceso</summary><form id="cuentaEmailForm" class="cuenta-form">' +
                '<div class="cuenta-field"><label for="cuentaEmailNuevo">Nuevo correo</label><input id="cuentaEmailNuevo" type="email" autocomplete="email" required></div>' +
                '<div class="cuenta-field"><label for="cuentaEmailPass">Contraseña actual</label><input id="cuentaEmailPass" type="password" autocomplete="current-password" required></div>' +
                '<p>El cambio puede requerir confirmación por correo.</p><div class="cuenta-actions"><button class="cuenta-btn secundario" type="submit">Actualizar correo</button></div>' +
                '<div class="cuenta-msg" id="cuentaEmailMsg" role="status"></div></form></details></section>' +
                '<section class="cuenta-card"><div class="cuenta-card-head"><h2>' + icono('candado') + 'Contraseña</h2><p>Actualiza la contraseña con la que entras a ETAAX.</p></div>' +
                '<form id="cuentaPasswordForm" class="cuenta-form"><div class="cuenta-field"><label for="cuentaPassActual">Contraseña actual</label><input id="cuentaPassActual" type="password" autocomplete="current-password" required></div>' +
                '<div class="cuenta-fields"><div class="cuenta-field"><label for="cuentaPassNueva">Nueva contraseña</label><input id="cuentaPassNueva" type="password" autocomplete="new-password" minlength="6" required></div>' +
                '<div class="cuenta-field"><label for="cuentaPassConfirmar">Confirmar contraseña</label><input id="cuentaPassConfirmar" type="password" autocomplete="new-password" minlength="6" required></div></div>' +
                '<div class="cuenta-actions"><button class="cuenta-btn secundario" type="submit">Actualizar contraseña</button></div><div class="cuenta-msg" id="cuentaPassMsg" role="status"></div></form></section>';
        }
        $('cuentaContenido').innerHTML = hero + '<div class="cuenta-layout"><div class="cuenta-stack">' + perfil + '</div>' + lateral + '</div>';
        $('cuentaTema').value = EtaaxTheme.elegido();
        $('cuentaTema').onchange = function () {
            if (this.value === 'auto') EtaaxTheme.auto();
            else EtaaxTheme.set(this.value);
        };
        if (!estado.staff) {
            conectarFormulario('cuentaNombreForm', 'cuentaNombreMsg', guardarNombre);
            conectarFormulario('cuentaEmailForm', 'cuentaEmailMsg', guardarCorreo);
            conectarFormulario('cuentaPasswordForm', 'cuentaPassMsg', guardarPassword);
        }
    }
    function conectarFormulario(id, msgId, fn) {
        $(id).addEventListener('submit', async function (ev) {
            ev.preventDefault();
            if (estado.staff || !estado.usuario || this.dataset.ocupado) return;
            var form = this, b = form.querySelector('button[type="submit"]'), texto = b.textContent;
            form.dataset.ocupado = '1'; b.disabled = true; b.textContent = 'Guardando…';
            $(msgId).textContent = ''; $(msgId).className = 'cuenta-msg';
            try { var msg = await fn(); $(msgId).textContent = msg; $(msgId).className = 'cuenta-msg exito'; }
            catch (e) { $(msgId).textContent = e.message || 'No se pudo guardar. Inténtalo de nuevo.'; $(msgId).className = 'cuenta-msg error'; }
            finally { delete form.dataset.ocupado; b.disabled = false; b.textContent = texto; }
        });
    }
    function actualizarCache() {
        var u = estado.usuario;
        [[localStorage, 'etaax_qses'], [sessionStorage, 'etaax_sesion_hub']].forEach(function (par) {
            var d = leer(par[0], par[1]);
            if (d && d.usuarioId === u.id && d.type !== 'staff') {
                d.nombre = identidad(); d.email = u.email;
                par[0].setItem(par[1], JSON.stringify(d));
            }
        });
        var ctx = leer(localStorage, 'etaax_ctx');
        if (ctx && ctx.ctxType === 'owner' && !ctx.ctxAdmin) {
            ctx.userName = identidad(); localStorage.setItem('etaax_ctx', JSON.stringify(ctx));
        }
        pintarHeader(true);
    }
    async function guardarNombre() {
        var nombre = $('cuentaNombre').value.trim();
        if (!nombre) throw new Error('Escribe tu nombre.');
        var r = await conPlazo(_supabase.auth.updateUser({ data: { nombre: nombre } }));
        if (r.error || !r.data || !r.data.user) throw new Error('No se pudo actualizar tu nombre. Inténtalo de nuevo.');
        estado.usuario = r.data.user; actualizarCache();
        var hero = document.querySelector('.cuenta-hero h2'); if (hero) hero.textContent = nombre;
        try {
            var copia = await conPlazo(_supabase.from('usuarios').update({ nombre: nombre }).eq('id', estado.usuario.id));
            if (copia.error) throw copia.error;
        } catch (e) { return 'Tu nombre se actualizó. Vuelve a guardar para completar la actualización de todos tus datos.'; }
        return 'Nombre actualizado.';
    }
    async function verificarPassword(pass) {
        if (!pass) throw new Error('Escribe tu contraseña actual.');
        if (!verificador) verificador = supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'etaax-verificar-cuenta' }
        });
        var r = await conPlazo(verificador.auth.signInWithPassword({ email: estado.usuario.email, password: pass }));
        if (r.error) throw new Error('No pudimos confirmar tu contraseña actual. Revísala e inténtalo de nuevo.');
        try { await conPlazo(verificador.auth.signOut({ scope: 'local' })); } catch (e) {}
    }
    async function guardarCorreo() {
        var email = $('cuentaEmailNuevo').value.trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Escribe un correo válido.');
        if (email === String(estado.usuario.email || '').toLowerCase()) throw new Error('Ese ya es tu correo de acceso.');
        await verificarPassword($('cuentaEmailPass').value);
        var r = await conPlazo(_supabase.auth.updateUser({ email: email }));
        if (r.error) throw new Error('No se pudo cambiar el correo. Inténtalo de nuevo.');
        $('cuentaEmailPass').value = '';
        if (r.data && r.data.user && r.data.user.email === email) {
            estado.usuario = r.data.user; actualizarCache(); $('cuentaEmail').value = email; $('cuentaEmailNuevo').value = '';
            document.querySelector('.cuenta-hero p').textContent = email;
            return 'Correo actualizado.';
        }
        return 'Revisa tus correos de confirmación. Tu correo actual seguirá funcionando hasta completar el cambio.';
    }
    async function guardarPassword() {
        var actual = $('cuentaPassActual').value, nueva = $('cuentaPassNueva').value;
        if (nueva.length < 6) throw new Error('Usa al menos 6 caracteres para la nueva contraseña.');
        if (nueva !== $('cuentaPassConfirmar').value) throw new Error('Las contraseñas nuevas no coinciden.');
        if (nueva === actual) throw new Error('Elige una contraseña diferente a la actual.');
        await verificarPassword(actual);
        var r = await conPlazo(_supabase.auth.updateUser({ password: nueva }));
        if (r.error) throw new Error('No se pudo actualizar la contraseña. Inténtalo de nuevo.');
        ['cuentaPassActual', 'cuentaPassNueva', 'cuentaPassConfirmar'].forEach(function (id) { $(id).value = ''; });
        return 'Contraseña actualizada. Úsala la próxima vez que entres.';
    }
    function pintarSelector() {
        var lista = estado.staff ? estado.compartidos : estado.negocios;
        if (!lista.length) { vacio('Tu plan comienza con un negocio', 'Registra tu negocio desde Inicio para consultar su servicio y sus opciones de pago.', true); return; }
        $('cuentaContenido').innerHTML = '<div class="cuenta-field cuenta-selector"><label for="planNegocio">Negocio</label><select id="planNegocio">' +
            lista.map(function (n) { return '<option value="' + esc(n.id) + '">' + esc((n.datos || {}).nombre || 'Negocio') + '</option>'; }).join('') + '</select></div><div id="planContenido"></div>';
        var activo = localStorage.getItem('etaax_negocio_activo');
        if (lista.some(function (n) { return n.id === activo; })) $('planNegocio').value = activo;
        $('planNegocio').onchange = cargarPlan;
        cargarPlan();
    }
    async function cargarPlan() {
        var turno = ++estado.vuelta, id = $('planNegocio').value;
        var lista = estado.staff ? estado.compartidos : estado.negocios;
        var negocio = lista.find(function (n) { return n.id === id; });
        if (!negocio) return;
        $('planContenido').innerHTML = '<div class="cuenta-card cuenta-loading" role="status">Consultando el servicio de ' + esc((negocio.datos || {}).nombre || 'tu negocio') + '…</div>';
        try {
            var rs = await Promise.all([
                conPlazo(_supabase.from('negocio_sucursales').select('datos').eq('negocio_id', id).maybeSingle()),
                conPlazo(_supabase.from('suscripciones').select('estado,activa_hasta,proximo_cobro,dias_tolerancia,stripe_subscription_id').eq('negocio_id', id).maybeSingle()),
                conPlazo(_supabase.rpc('negocio_cobro_estado', { p_neg: id }))
            ]);
            if (turno !== estado.vuelta) return;
            if (rs.some(function (r) { return r.error; })) throw new Error('No pudimos consultar el servicio completo.');
            pintarPlan(negocio, rs[0].data, rs[1].data, rs[2].data);
        } catch (e) {
            if (turno !== estado.vuelta) return;
            $('planContenido').innerHTML = '<section class="cuenta-card"><h2>No pudimos consultar este plan</h2><p>Revisa tu conexión. El estado de tu servicio y los importes no pudieron verificarse.</p><div class="cuenta-actions"><button class="cuenta-btn secundario" id="planReintentar">Reintentar</button></div></section>';
            $('planReintentar').onclick = cargarPlan;
        }
    }
    function pintarPlan(negocio, doc, sub, cobro) {
        var sucursales = doc && doc.datos && doc.datos.sucursales;
        var cantidad = Math.max(1, Array.isArray(sucursales) ? sucursales.length : 0);
        sub = sub || {};
        if (!cobro || typeof cobro.activo !== 'boolean') throw new Error('Falta confirmar el estado del servicio.');
        var nombre = (negocio.datos || {}).nombre || 'Tu negocio';
        var categoria = cantidad > 7 ? 'Corporativo' : cantidad > 3 ? 'Gran Pyme' : 'Pequeña Pyme';
        var corte = cobro.proximoCobro || sub.proximo_cobro || sub.activa_hasta;
        var tol = EtaaxCore.estadoCobro({ estado: cobro.estado, proximoCobro: corte, diasTolerancia: cobro.diasTolerancia });
        var est = cobro.activo ? 'activa' : cobro.estado === 'activa' ? 'vencida' : cobro.estado || 'pendiente';
        var etiqueta = cobro.activo && tol.enTolerancia ? 'En periodo de tolerancia' : ({activa:'Servicio activo',vencida:'Pago pendiente',pendiente:'Pendiente de activación',cancelada:'Servicio cancelado'})[est] || 'Estado por confirmar';
        var texto = 'Hola, soy ' + identidad() + '. Mi negocio es ' + nombre + ' (' + negocio.id + ').';
        var costo = pesos(EtaaxPrecios.precioMensual(cantidad));
        var filas = Array.from({ length: cantidad }, function (_, i) {
            var suc = Array.isArray(sucursales) && sucursales[i];
            return '<tr><td>' + esc(suc && suc.nombre || (i ? 'Sucursal ' + (i + 1) : 'Matriz')) + '</td><td>' + pesos(EtaaxPrecios.precioSucursal(i + 1)) + '</td></tr>';
        }).join('');
        var servicio = '<section class="cuenta-card"><h2>' + icono('org-corporativo') + esc(categoria) + '</h2><p>' + esc(nombre) + '</p><span class="cuenta-badge ' + esc(est) + '">' + esc(etiqueta) + '</span>' +
            (estado.staff ? '' : '<div class="cuenta-precio">' + costo + ' <small>MXN / mes</small></div><p>Importe del servicio según las sucursales registradas.</p>') +
            '<dl class="cuenta-datos"><div><dt>Sucursales</dt><dd>' + cantidad + '</dd></div><div><dt>' + (cobro.activo ? 'Próxima fecha de cobro' : 'Fecha de cobro') + '</dt><dd>' + esc(fecha(corte)) + '</dd></div></dl>' +
            (tol.enTolerancia && cobro.activo ? '<div class="cuenta-nota">Tu servicio sigue activo durante la tolerancia. Regulariza el pago antes del ' + esc(fecha(tol.limite)) + '.</div>' : '') + '</section>';
        if (estado.staff) {
            $('planContenido').innerHTML = '<div class="cuenta-layout">' + servicio + '<section class="cuenta-card"><h2>Servicio del negocio</h2><p>El titular administra la suscripción, los pagos y las solicitudes de factura. Puedes consultar aquí el estado de tu servicio.</p></section></div>';
            return;
        }
        var pago = '<section class="cuenta-card"><h2>' + icono('finanzas') + 'Pago del servicio</h2><p>' +
            (sub.stripe_subscription_id ? 'Tu negocio tiene una suscripción con tarjeta. Para revisar el cobro o actualizar tu forma de pago, contacta a soporte.' : cobro.activo ? 'Tu servicio está activo. Aquí tienes los datos para tu próximo pago por transferencia.' : 'Puedes pagar con tarjeta o hacer una transferencia para activar tu servicio.') + '</p>' +
            '<div class="cuenta-actions">' + (!sub.stripe_subscription_id && !cobro.activo ? '<button class="cuenta-btn" id="planPagar">Pagar con tarjeta</button>' : '') +
            botonContacto('Consulta de pago ETAAX', texto + ' Quiero consultar mi pago de ETAAX.', 'Consultar mi pago', true) + '</div>' +
            '<details class="cuenta-details"><summary>Ver datos para transferencia</summary><div style="margin-top:14px">' + ETAAX_PAGO_DATOS.html(true) + '</div><div class="cuenta-actions">' +
            botonContacto('Comprobante de pago ETAAX', texto + ' Quiero enviar el comprobante de mi transferencia.', 'Enviar comprobante', true) + '</div></details></section>';
        var factura = '<section class="cuenta-card"><h2>' + icono('catalogos') + 'Facturación</h2><p>Solicita la factura de tu pago de ETAAX con tus datos fiscales y el comprobante correspondiente.</p>' +
            '<div class="cuenta-nota" style="margin-top:14px">Ten a la mano tu RFC, razón social, código postal fiscal, régimen fiscal y uso de CFDI.</div>' +
            '<div class="cuenta-actions">' + botonContacto('Solicitud de factura ETAAX · ' + nombre, texto + '\n\nSolicito la factura de mi pago.\nRFC:\nRazón social:\nCódigo postal fiscal:\nRégimen fiscal:\nUso de CFDI:\nFecha e importe del pago:', 'Solicitar factura por correo', false) + '</div>' +
            '<p style="margin-top:14px">Las facturas y los comprobantes se atienden con soporte.</p></section>';
        var detalle = '<section class="cuenta-card"><h2>Costo por sucursal</h2><p>La tarifa de cada sucursal viene de la tabla de precios de ETAAX.</p><div class="cuenta-table-wrap"><table class="cuenta-table"><thead><tr><th>Sucursal</th><th>MXN / mes</th></tr></thead><tbody>' + filas +
            '</tbody><tfoot><tr><td><b>Total mensual</b></td><td><b>' + costo + '</b></td></tr></tfoot></table></div></section>';
        $('planContenido').innerHTML = '<div class="cuenta-layout"><div class="cuenta-stack">' + servicio + detalle + '</div><div class="cuenta-stack">' + pago + factura + '</div></div>';
        if ($('planPagar')) $('planPagar').onclick = function () { pagar(negocio.id, this); };
    }
    async function pagar(id, btn) {
        if (estado.staff || btn.disabled) return;
        btn.disabled = true; btn.textContent = 'Preparando tu pago…';
        try {
            var r = await conPlazo(_supabase.functions.invoke('crear-checkout', { body: { negocioId: id } }));
            var url = r.data && r.data.url;
            if (r.error || !url) throw new Error('No se pudo abrir el pago. Inténtalo de nuevo o consulta a soporte.');
            var destino = new URL(url);
            if (destino.protocol !== 'https:' || destino.hostname !== 'checkout.stripe.com') throw new Error('No pudimos verificar el enlace de pago. Consulta a soporte.');
            location.href = destino.href;
        } catch (e) {
            btn.disabled = false; btn.textContent = 'Pagar con tarjeta';
            var msg = $('planPagoMsg');
            if (!msg) { msg = document.createElement('p'); msg.id = 'planPagoMsg'; msg.className = 'cuenta-msg error'; msg.setAttribute('role', 'alert'); btn.parentNode.after(msg); }
            msg.textContent = e.message;
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
