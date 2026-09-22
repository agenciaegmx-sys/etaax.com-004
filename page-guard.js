/* ============================================================
   ETAAX — Page Guard + Permisos por rol
   Incluir al inicio del <head> de toda página de módulo.
   hub.html también lo incluye, pero solo para usar los helpers
   (el guard no aplica ahí).
   NO incluir en: index.html (landing pública) ni páginas de
   admin (tienen su propia verificación por email).

   - Sin sesión (etaax_ctx) → redirige a /hub.html
   - Sesión de staff → verifica el permiso del rol para la
     página actual (permisos del negocio en localStorage, con
     fallback a los defaults). Dueño y admin: acceso total.
   ============================================================ */

/* Defaults canónicos de permisos por rol — fuente única.
   permisos.html y hub.html leen de aquí.

   El valor de cada módulo es:
   - boolean → acceso completo (true) o sin acceso (false) al módulo.
   - objeto  → acceso al módulo (truthy) con sub-permisos granulares
     (ver ETAAX_SUBPERMS). Una clave de sub-permiso en false niega esa
     acción aunque el módulo esté accesible.
   Compatibilidad: un módulo legacy en `true` equivale a "todo permitido"
   (todos sus sub-permisos en true). */
window.ETAAX_PERM_DEFAULTS = {
    admin:          { recetas:true,  insumos:true,  inventarios:true,  requisiciones:true,  ventas:true,  ventas_productos:true,  gastos:true,  menu:true,  proveedores:true,  clientes:true,  staff:true,  permisos:true,  financiero:true,  config:true  },
    gerente:        { recetas:true,  insumos:true,  inventarios:true,  requisiciones:true,
                      ventas:{ capturarCorte:true, verLista:true, editarHistorico:false, ventaExtra:true, hacerDeposito:true, verDepositos:false, cajaFuerte:false },
                      ventas_productos:true,
                      gastos:{ capturar:true, verCajaChica:true, verHistorico:true, gastosMayores:false, verCajaFuerte:true, verBanco:true, editarHistorico:false, verResumen:false },
                      menu:true,  proveedores:true,  clientes:true,  staff:true,  permisos:false, financiero:true,  config:false },
    jefe_cocina:    { recetas:true,  insumos:true,  inventarios:true,  requisiciones:true,  ventas:false, ventas_productos:false, gastos:false, menu:true,  proveedores:false, clientes:false, staff:false, permisos:false, financiero:false, config:false },
    chef:           { recetas:true,  insumos:true,  inventarios:true,  requisiciones:true,  ventas:false, ventas_productos:false, gastos:false, menu:true,  proveedores:false, clientes:false, staff:false, permisos:false, financiero:false, config:false },
    cocinero:       { recetas:true,  insumos:false, inventarios:true,  requisiciones:true,  ventas:false, ventas_productos:false, gastos:false, menu:false, proveedores:false, clientes:false, staff:false, permisos:false, financiero:false, config:false },
    barman:         { recetas:true,  insumos:true,  inventarios:true,  requisiciones:true,  ventas:false, ventas_productos:false, gastos:false, menu:true,  proveedores:false, clientes:false, staff:false, permisos:false, financiero:false, config:false },
    barista:        { recetas:true,  insumos:true,  inventarios:true,  requisiciones:true,  ventas:false, ventas_productos:false, gastos:false, menu:true,  proveedores:false, clientes:false, staff:false, permisos:false, financiero:false, config:false },
    mesero:         { recetas:false, insumos:false, inventarios:false, requisiciones:false, ventas:true,  ventas_productos:true,  gastos:false, menu:true,  proveedores:false, clientes:false, staff:false, permisos:false, financiero:false, config:false },
    administrativo: { recetas:false, insumos:true,  inventarios:true,  requisiciones:true,  ventas:true,  ventas_productos:true,  gastos:true,  menu:false, proveedores:true,  clientes:true,  staff:true,  permisos:false, financiero:true,  config:false },
    otro:           { recetas:false, insumos:false, inventarios:false, requisiciones:false, ventas:false, ventas_productos:false, gastos:false, menu:false, proveedores:false, clientes:false, staff:false, permisos:false, financiero:false, config:false },
};

/* Acción transversal "cambiar de sucursal" (reasignar gastos/cortes/recetas/insumos):
   permitida por defecto en todos los roles; el dueño la apaga por rol en Permisos. */
Object.keys(window.ETAAX_PERM_DEFAULTS).forEach(function (rol) {
    if (window.ETAAX_PERM_DEFAULTS[rol].cambiarSucursal === undefined)
        window.ETAAX_PERM_DEFAULTS[rol].cambiarSucursal = true;
});

/* Catálogo de sub-permisos por módulo — fuente única para la UI de
   permisos.html y para validar claves. El orden define cómo se listan. */
window.ETAAX_SUBPERMS = {
    ventas: [
        { key:'capturarCorte',  label:'Capturar cortes',          sub:'Registrar el corte del día' },
        { key:'verLista',       label:'Ver cortes anteriores / lista', sub:'Consultar cortes de días pasados (solo lectura)' },
        { key:'editarHistorico',label:'Editar cortes anteriores',  sub:'El corte de hoy siempre es editable' },
        { key:'ventaExtra',     label:'Registrar venta extra',     sub:'Eventos, festivales, catering' },
        { key:'hacerDeposito',  label:'Hacer depósitos',           sub:'Registrar depósitos a caja fuerte o banco' },
        { key:'verDepositos',   label:'Ver lista de depósitos',    sub:'Consultar el historial de depósitos' },
        { key:'cajaFuerte',     label:'Ver caja fuerte',           sub:'Acumulado de efectivo y saldos' },
    ],
    /* ── RECETAS E INSUMOS ───────────────────────────────────────────────────
       `pendiente:true` = el interruptor EXISTE pero todavía no lo respeta el
       módulo. Se marca a la vista en vez de esconderlo: un permiso que se apaga
       y no pasa nada es peor que no tenerlo — ya pasó con "cambiar de sucursal"
       y costó una auditoría entera entender por qué. Al conectar uno, se le
       quita la marca en el mismo commit. */
    recetas: [
        { key:'crear',        label:'Crear recetas',            sub:'Dar de alta escandallos nuevos', pendiente:true },
        { key:'editar',       label:'Editar recetas',           sub:'Modificar y guardar escandallos', pendiente:true },
        { key:'eliminar',     label:'Eliminar recetas',         sub:'Borrar del catálogo', pendiente:true },
        { key:'verCostos',    label:'Ver costos y márgenes',    sub:'Sin esto ve la receta en vista operativa, sin dinero', pendiente:true },
        { key:'caratula',     label:'Carátula de costos',       sub:'Comparativo de costos y rentabilidad', pendiente:true },
        { key:'precioCarta',  label:'Cambiar precio en carta',  sub:'El precio de venta al público', pendiente:true },
        { key:'imprimir',     label:'Imprimir escandallos',     sub:'Ficha operativa y administrativa', pendiente:true },
    ],
    insumos: [
        { key:'crear',          label:'Crear insumos',            sub:'Dar de alta materias primas', pendiente:true },
        { key:'editar',         label:'Editar insumos',           sub:'Modificar presentaciones y datos', pendiente:true },
        { key:'eliminar',       label:'Eliminar insumos',         sub:'Borrar del catálogo', pendiente:true },
        { key:'verCostos',      label:'Ver precios de compra',    sub:'Costos y proveedor de cada insumo', pendiente:true },
        { key:'catalogoEtaax',  label:'Traer del catálogo ETAAX', sub:'Copiar insumos del catálogo de la plataforma', pendiente:true },
        { key:'catalogoNegocio',label:'Copiar de otra sucursal',  sub:'Traer insumos que ya existen en el negocio', pendiente:true },
        { key:'importar',       label:'Importar por archivo',     sub:'Alta masiva desde Excel o CSV', pendiente:true },
    ],
    inventarios: [
        { key:'capturar',   label:'Capturar inventario',      sub:'Conteo de existencias por área', pendiente:true },
        { key:'entradas',   label:'Registrar entradas',       sub:'Compras y recepciones de mercancía', pendiente:true },
        { key:'qr',         label:'Generar el QR de entradas',sub:'El código que usan desde el celular', pendiente:true },
        { key:'reporte',    label:'Ver reporte ejecutivo',    sub:'Variancias, mermas y resultado', pendiente:true },
        { key:'verCostos',  label:'Ver el capital invertido', sub:'Sin esto ve cantidades, no dinero', pendiente:true },
        { key:'cerrar',     label:'Cerrar el inventario',     sub:'Aplicarlo y dejarlo como existencia oficial', pendiente:true },
    ],
    requisiciones: [
        { key:'crear',        label:'Crear requisiciones',    sub:'Pedidos internos entre áreas', pendiente:true },
        { key:'verProyeccion',label:'Ver proyección de compra',sub:'Qué comprar por área y proveedor', pendiente:true },
        { key:'exportar',     label:'Exportar el pedido',     sub:'Mandar el pedido al proveedor', pendiente:true },
        { key:'historial',    label:'Ver historial',          sub:'Requisiciones de periodos anteriores', pendiente:true },
    ],
    gastos: [
        { key:'capturar',       label:'Capturar gastos',           sub:'Registrar gastos menores / normales' },
        { key:'verCajaChica',   label:'Ver gastos de caja chica',  sub:'Gastos pagados desde caja chica' },
        { key:'verHistorico',   label:'Ver gastos anteriores',     sub:'Consultar gastos de días pasados (solo lectura)' },
        { key:'gastosMayores',  label:'Gastos mayores',            sub:'Ver y gestionar gastos mayores' },
        { key:'verCajaFuerte',  label:'Ver gastos de caja fuerte', sub:'Gastos pagados desde caja fuerte' },
        { key:'verBanco',       label:'Ver gastos de banco',       sub:'Transferencia, débito y crédito' },
        { key:'editarHistorico',label:'Editar gastos anteriores',  sub:'El gasto de hoy siempre es editable' },
        { key:'verResumen',     label:'Ver resumen de gastos',     sub:'Totales y desgloses del período' },
    ],
};

/* Permisos efectivos de un rol en un negocio:
   los guardados por el dueño (localStorage, sync de Supabase)
   o los defaults del rol si no hay personalizados. */
/* ── CATÁLOGO DE ROLES ───────────────────────────────────────────────────────
   Cada negocio llama distinto a lo mismo: donde uno dice "Mesero" otro dice
   "Hostess" o "Cajera". Antes la lista estaba escrita a mano en TRES archivos
   (permisos, el modal de staff y el catálogo de staff), así que agregar un rol
   pedía tocar los tres y acordarse de los tres.

   REGLA QUE NO SE PUEDE ROMPER: renombrar cambia la ETIQUETA, nunca la LLAVE.
   La llave (`gerente`, `mesero`…) es lo que amarra a cada colaborador con sus
   permisos: vive en `staff.datos.rol`, en la tabla `permisos` y en la sesión
   abierta. Si al renombrar cambiara, todos los colaboradores de ese rol se
   quedarían sin permisos de un día para otro, y sin forma de saber por qué.

   Los roles NUEVOS sí estrenan llave, con prefijo `rx_` para no chocar nunca con
   una de las de fábrica, ni con las que se agreguen al producto después.        */
window.ETAAX_ROLES_BASE = [
    { key:'admin',          label:'Administrador',  icon:'👑', color:'#c87a6a' },
    { key:'gerente',        label:'Gerente',        icon:'🎯', color:'#f5c842' },
    { key:'jefe_cocina',    label:'Jefe de Cocina', icon:'👨‍🍳', color:'#3dbe7a' },
    { key:'chef',           label:'Chef',           icon:'🍳', color:'#3dbe7a' },
    { key:'jefe_barra',     label:'Jefe de Barra',  icon:'🍷', color:'#c89b6a' },
    { key:'cocinero',       label:'Cocinero',       icon:'🥘', color:'#3dbe7a' },
    { key:'barman',         label:'Barman',         icon:'🍸', color:'#7ab8f5' },
    { key:'barista',        label:'Barista',        icon:'☕', color:'#c4a882' },
    { key:'mesero',         label:'Mesero',         icon:'🛎️', color:'#9b8de8' },
    { key:'administrativo', label:'Administrativo', icon:'📋', color:'#f5c842' },
    { key:'otro',           label:'Otro',           icon:'👤', color:'#7a7570' },
];
/* Los ajustes del negocio viajan en la MISMA tabla de permisos, bajo una llave
   reservada. Así se sincronizan solos con lo que ya baja cada página y no hace
   falta una migración ni otra tabla que mantener al día. */
window.ETAAX_ROLES_KEY = '__roles__';

function _rolesCfg(negId) {
    try {
        var p = JSON.parse(localStorage.getItem('etaax_' + negId + '_permisos') || 'null');
        var c = p && p[window.ETAAX_ROLES_KEY];
        return (c && typeof c === 'object') ? c : {};
    } catch (e) { return {}; }
}

/* El catálogo EFECTIVO de un negocio: los de fábrica con su nombre puesto, más
   los suyos. `base` de un rol propio dice de cuál hereda los permisos de salida. */
window.etaaxRoles = function (negId) {
    var cfg = _rolesCfg(negId), nom = cfg.nombres || {};
    var out = window.ETAAX_ROLES_BASE.map(function (r) {
        return { key:r.key, label: nom[r.key] || r.label, icon:r.icon, color:r.color,
                 base:r.key, propio:false, renombrado: !!nom[r.key] };
    });
    (cfg.extra || []).forEach(function (r) {
        if (!r || !r.key) return;
        out.push({ key:r.key, label: nom[r.key] || r.label || r.key,
                   icon: r.icon || '👤', color: r.color || '#7a7570',
                   base: r.base || 'otro', propio:true, renombrado:false });
    });
    return out;
};
window.etaaxRol = function (negId, key) {
    var l = window.etaaxRoles(negId);
    for (var i = 0; i < l.length; i++) if (l[i].key === key) return l[i];
    return null;
};
window.etaaxRolLabel = function (negId, key) {
    var r = window.etaaxRol(negId, key);
    return r ? r.label : (key || '');
};
/* Llave para un rol nuevo: `rx_` + el nombre normalizado. El prefijo la aparta
   para siempre del espacio de las de fábrica. */
window.etaaxRolNuevaKey = function (negId, label) {
    var base = 'rx_' + String(label || 'rol').toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24);
    if (base === 'rx_') base = 'rx_rol';
    var usadas = {}; window.etaaxRoles(negId).forEach(function (r) { usadas[r.key] = 1; });
    if (!usadas[base]) return base;
    for (var i = 2; i < 999; i++) if (!usadas[base + '_' + i]) return base + '_' + i;
    return base + '_' + Date.now().toString(36);
};

/* ── LOS PERMISOS TIENEN QUE LLEGAR AL DISPOSITIVO ───────────────────────────
   Aquí estaba el bug que hacía que apagar un permiso "no sirviera de nada".

   `etaaxPermisosRol` lee `etaax_<neg>_permisos` de localStorage. Esa clave la
   escribía SOLO administrativo/permisos.html, en el equipo del dueño. Ningún
   otro lugar la bajaba de Supabase — y el cierre de sesión la borra, porque no
   está en la lista de claves que `_etaaxWipeCache` conserva.

   Resultado: en el celular del colaborador (o en el del dueño después de salir
   y volver a entrar) la clave no existía, `etaaxPermisosRol` caía al DEFAULT del
   rol, y el default es permisivo. El dueño apagaba un permiso, lo veía apagado
   en su pantalla, y en el dispositivo del colaborador seguía abierto.

   No afectaba a un permiso: afectaba a los 23.

   Ahora cada página los baja al cargar. Se llama una sola vez por carga y
   FALLA ABIERTO: si no hay red, se queda con lo que haya en caché o con el
   default. Dejar a la gente fuera por un problema de conexión sería peor que el
   hueco que esto tapa — y la puerta de cada módulo la sigue guardando el
   servidor con RLS, no esta lista.                                            */
var _permsPedidos = false;
window.etaaxPermisosRefrescar = function (negId, luego) {
    if (_permsPedidos || !negId) return; _permsPedidos = true;
    /* page-guard va PRIMERO en el <head>, antes del cliente de Supabase: hay que
       esperarlo. Si en 8 s no apareció, no hay nada que pedir. */
    var intentos = 0;
    (function esperar() {
        if (typeof window._supabase === 'undefined') {
            if (++intentos > 80) return;
            return setTimeout(esperar, 100);
        }
        window._supabase.from('permisos').select('rol, datos').eq('negocio_id', negId)
            .then(function (res) {
                if (res.error || !res.data || !res.data.length) return;
                var comb = {};
                res.data.forEach(function (row) { comb[row.rol] = row.datos; });
                try { localStorage.setItem('etaax_' + negId + '_permisos', JSON.stringify(comb)); } catch (e) {}
                if (typeof luego === 'function') luego();
            })
            .catch(function (e) { console.warn('[etaax] permisos sin refrescar:', e); });
    })();
};

window.etaaxPermisosRol = function (negId, rol) {
    var p = null;
    try { p = JSON.parse(localStorage.getItem('etaax_' + negId + '_permisos') || 'null'); } catch (e) {}
    if (p && p[rol]) return p[rol];
    if (window.ETAAX_PERM_DEFAULTS[rol]) return window.ETAAX_PERM_DEFAULTS[rol];
    /* Un rol PROPIO del negocio no tiene defaults de fábrica. Se cae a los de su
       rol base: sin esto, `{}` deja todo apagado y el dueño crea "Hostess" y
       descubre que no puede entrar a nada, sin una pista de por qué. */
    var r = window.etaaxRol(negId, rol);
    if (r && r.base && window.ETAAX_PERM_DEFAULTS[r.base]) return window.ETAAX_PERM_DEFAULTS[r.base];
    return {};
};

/* Resuelve un permiso por ruta 'modulo' o 'modulo.subpermiso'.
   - 'ventas'              → ¿tiene acceso al módulo? (truthy)
   - 'ventas.cajaFuerte'   → ¿tiene ese sub-permiso?
   Reglas de sub-permiso:
   - módulo en true  → sub-permiso true (legacy "todo permitido").
   - módulo en false → sub-permiso false.
   - módulo objeto   → lee la clave; si falta, cae al default del rol. */
window.etaaxPerm = function (negId, rol, path) {
    var parts = String(path || '').split('.');
    var mod = parts[0], sub = parts[1];
    var perms = window.etaaxPermisosRol(negId, rol);
    var v = perms[mod];
    if (!sub) return !!v;
    if (v === true) return true;
    if (!v) return false;
    if (typeof v === 'object') {
        if (sub in v) return v[sub] !== false;
        var def = (window.ETAAX_PERM_DEFAULTS[rol] || {})[mod];
        if (def && typeof def === 'object' && sub in def) return def[sub] !== false;
        return false;
    }
    return false;
};

(function () {
    // hub.html solo consume los helpers de arriba
    if (/hub\.html$/.test(window.location.pathname)) return;

    // Embebido en un modal flotante del hub (?embed=1): la página padre ya
    // validó la sesión. Nunca rebotar al hub aquí dentro (se vería el hub
    // dentro del iframe). embed.js ya sembró el contexto desde la URL.
    var _embed = /[?&]embed=1/.test(window.location.search);

    var ctx = null;
    try { ctx = JSON.parse(localStorage.getItem('etaax_ctx') || 'null'); } catch (e) {}
    if (!ctx) { if (_embed) return; window.location.replace('/hub.html'); return; }

    // Dueño y admin maestro: acceso total
    if (ctx.ctxType !== 'staff') return;
    var rol = ctx.rol || 'otro';
    if (rol === 'admin') return;

    /* Se pide ANTES de mirar el mapa: así una página sin candado (una landing)
       también deja la caché caliente para la siguiente navegación. */
    window.etaaxPermisosRefrescar(ctx.negId, function () { if (_reEvaluar) _reEvaluar(); });
    var _reEvaluar = null;

    // Mapa ruta → clave(s) de permiso. El orden importa
    // (ventas-productos antes que ventas, etc.). Un array
    // significa "pasa con cualquiera de estas" (landings).
    var MAPA = [
        [/\/financiero\//,                      'financiero'],
        /* Las GUÍAS de uso quedan abiertas a cualquiera con sesión: son el manual
           del producto, y un barman las necesita tanto como el dueño. Va ANTES de
           la regla del módulo, que exige 'financiero' y se las cerraría. */
        [/\/consultoria\/guias/,                null],
        /* Ventas por Producto se mudó de administrativo a consultoria (ago 2026),
           pero conserva SU permiso: quien no lo tenía no debe ganarlo por la mudanza.
           Va antes que la regla del módulo por el mismo motivo. */
        [/\/consultoria\/ventas-productos/,     'ventas_productos'],
        /* La PORTADA del módulo también queda abierta: es la puerta a las guías.
           Si pidiera 'financiero', un colaborador no podría ni llegar al manual.
           Las herramientas de análisis de adentro sí conservan su permiso, y la
           portada atenúa las que no le tocan (ver consultoria/index.html). */
        [/\/consultoria\/(index\.html)?$/,       null],
        [/\/consultoria\//,                     'financiero'],
        [/\/administrativo\/ventas-productos/,  'ventas_productos'],
        [/\/administrativo\/ventas/,            'ventas'],
        [/\/administrativo\/gastos/,            'gastos'],
        // Sub-módulo unificado: pasa con ventas O gastos (los permisos finos
        // ocultan adentro los cards/botones que no le tocan al rol).
        [/\/administrativo\/diario/,            ['ventas','gastos']],
        [/\/administrativo\/menu/,              'menu'],
        [/\/administrativo\/proveedores/,       'proveedores'],
        [/\/administrativo\/clientes/,          'clientes'],
        // Gestión de Staff: organigrama, perfiles y evaluaciones (mudadas desde
        // consultoría) comparten el permiso 'staff'. staff.html y staff-hub.html
        // también caen en el patrón /administrativo/staff.
        [/\/administrativo\/horarios/,          'staff'],
        [/\/administrativo\/checklists/,        'staff'],
        [/\/administrativo\/organigrama/,       'staff'],
        [/\/administrativo\/perfiles-puesto/,   'staff'],
        [/\/administrativo\/evaluaciones/,      'staff'],
        [/\/administrativo\/staff/,             'staff'],
        // permisos.html NO va aquí: la página se protege sola con el
        // candado de contraseña de administrador (solo dueño/admin)
        [/\/recetas\/insumos/,                  'insumos'],
        [/\/recetas\/inventarios/,              'inventarios'],
        [/\/recetas\/requisiciones/,            'requisiciones'],
        [/\/recetas\/landing/,                  ['recetas','insumos','inventarios','requisiciones']],
        [/\/recetas\//,                         'recetas'],
        [/\/configuracion/,                     'config'],
    ];
    var key = null;
    var path = window.location.pathname;
    for (var i = 0; i < MAPA.length; i++) {
        if (MAPA[i][0].test(path)) { key = MAPA[i][1]; break; }
    }
    if (!key) return; // landings de módulo (administrativo/index) pasan

    function _evaluar(quieto) {
        var perms = window.etaaxPermisosRol(ctx.negId, rol);
        var keys  = Array.isArray(key) ? key : [key];
        var ok    = keys.some(function (k) { return perms[k]; });
        if (!ok && !_embed) {
            if (quieto) console.warn('[etaax] permiso denegado al refrescar:', keys[0]);
            window.location.replace('/hub.html?denegado=' + keys[0]);
        }
        return ok;
    }
    _reEvaluar = function () { _evaluar(true); };
    _evaluar(false);
})();
