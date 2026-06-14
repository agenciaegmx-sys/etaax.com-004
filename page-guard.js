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
                      ventas:{ capturarCorte:true, editarHistorico:false, ventaExtra:true, hacerDeposito:true, verDepositos:false, cajaFuerte:false },
                      ventas_productos:true,
                      gastos:{ capturar:true, gastosMayores:false, verCajaFuerte:false, verBanco:false, editarHistorico:false, verResumen:false },
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

/* Catálogo de sub-permisos por módulo — fuente única para la UI de
   permisos.html y para validar claves. El orden define cómo se listan. */
window.ETAAX_SUBPERMS = {
    ventas: [
        { key:'capturarCorte',  label:'Capturar cortes',          sub:'Registrar el corte del día' },
        { key:'editarHistorico',label:'Editar cortes anteriores',  sub:'El corte de hoy siempre es editable' },
        { key:'ventaExtra',     label:'Registrar venta extra',     sub:'Eventos, festivales, catering' },
        { key:'hacerDeposito',  label:'Hacer depósitos',           sub:'Registrar depósitos a caja fuerte o banco' },
        { key:'verDepositos',   label:'Ver lista de depósitos',    sub:'Consultar el historial de depósitos' },
        { key:'cajaFuerte',     label:'Ver caja fuerte',           sub:'Acumulado de efectivo y saldos' },
    ],
    gastos: [
        { key:'capturar',       label:'Capturar gastos',           sub:'Registrar gastos menores / normales' },
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
window.etaaxPermisosRol = function (negId, rol) {
    var p = null;
    try { p = JSON.parse(localStorage.getItem('etaax_' + negId + '_permisos') || 'null'); } catch (e) {}
    return (p && p[rol]) || window.ETAAX_PERM_DEFAULTS[rol] || {};
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

    var ctx = null;
    try { ctx = JSON.parse(localStorage.getItem('etaax_ctx') || 'null'); } catch (e) {}
    if (!ctx) { window.location.replace('/hub.html'); return; }

    // Dueño y admin maestro: acceso total
    if (ctx.ctxType !== 'staff') return;
    var rol = ctx.rol || 'otro';
    if (rol === 'admin') return;

    // Mapa ruta → clave(s) de permiso. El orden importa
    // (ventas-productos antes que ventas, etc.). Un array
    // significa "pasa con cualquiera de estas" (landings).
    var MAPA = [
        [/\/financiero\//,                      'financiero'],
        [/\/consultoria\//,                     'financiero'],
        [/\/administrativo\/ventas-productos/,  'ventas_productos'],
        [/\/administrativo\/ventas/,            'ventas'],
        [/\/administrativo\/gastos/,            'gastos'],
        [/\/administrativo\/menu/,              'menu'],
        [/\/administrativo\/proveedores/,       'proveedores'],
        [/\/administrativo\/clientes/,          'clientes'],
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

    var perms = window.etaaxPermisosRol(ctx.negId, rol);
    var keys  = Array.isArray(key) ? key : [key];
    var ok    = keys.some(function (k) { return perms[k]; });
    if (!ok) window.location.replace('/hub.html?denegado=' + keys[0]);
})();
