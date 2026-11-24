/* ============================================================================
   ETAAX — STAFF ETAAX (window.StaffEtx)

   El equipo de ETAAX (auditores, consultores) entra con su usuario y
   contraseña a los negocios que el admin le dio. Este archivo es la ÚNICA
   verdad de las reglas que comparten las tres pantallas que lo tocan:
     · admin.html        → da de alta, da accesos, cambia contraseñas;
     · staff-etaax.html  → la portada con «mis negocios»;
     · hub.html          → al entrar a un negocio: sus sucursales y módulos.

   La puerta de verdad es la base (supabase-migration-v88.sql): sin acceso a un
   negocio no hay ni un renglón. Lo de aquí decide lo que se OFRECE —qué
   sucursales y qué módulos—, como los permisos de cualquier colaborador.

   Un acceso (etaax_staff_accesos.datos) se ve así:
     { sucursales: ['suc_mia'] | [] (= todas),
       permisos:   { recetas:true, inventarios:{ capturar:true, cerrar:false }, … },
       activo:     true }
   `permisos` tiene la MISMA forma que la de un rol en la tabla `permisos`, así
   que page-guard la resuelve con el mismo etaaxPerm de toda la app.
   ============================================================================ */
(function () {
    'use strict';
    var DOMINIO = '@staff.etaax.app';
    var ROL = 'etaax_staff';   // page-guard: ETAAX_ROL_ETX

    /* Los módulos que se pueden dar, con los rótulos de Roles y Permisos (los
       mismos que usa cada módulo por dentro). Agrupados como el menú. */
    var MODULOS = [
        { key:'recetas',          label:'Escandallos',        grupo:'Cost·ax' },
        { key:'insumos',          label:'Insumos',            grupo:'Cost·ax' },
        { key:'inventarios',      label:'Inventarios',        grupo:'Cost·ax' },
        { key:'requisiciones',    label:'Requisiciones',      grupo:'Cost·ax' },
        { key:'menu',             label:'Menú',               grupo:'Cost·ax' },
        { key:'ventas',           label:'Ventas y Cortes',    grupo:'Admin·ax' },
        { key:'gastos',           label:'Gastos Diarios',     grupo:'Admin·ax' },
        { key:'proveedores',      label:'Proveedores',        grupo:'Admin·ax' },
        { key:'clientes',         label:'Clientes',           grupo:'Admin·ax' },
        { key:'staff',            label:'Gestión de Staff',   grupo:'Admin·ax' },
        { key:'ventas_productos', label:'Ventas por Producto',grupo:'Learn·ax' },
        { key:'financiero',       label:'Financiero',         grupo:'Fin·ax' },
        { key:'config',           label:'Configuración',      grupo:'Negocio' }
    ];
    /* Con lo que nace un acceso nuevo: escandallos, insumos, inventarios y
       requisiciones (Cost·ax), que es para lo que se pensó: auditar. */
    function permisosIniciales() {
        var p = {};
        var INICIALES = ['recetas', 'insumos', 'inventarios', 'requisiciones'];
        MODULOS.forEach(function (m) { p[m.key] = INICIALES.indexOf(m.key) > -1; });
        p.cambiarSucursal = false;
        return p;
    }

    /* El usuario: minúsculas, sin espacios ni acentos; letras, números, punto,
       guion y guion bajo. Es lo que se teclea en el login. */
    function normalizarUsuario(u) {
        return String(u || '').trim().toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/\s+/g, '.').replace(/[^a-z0-9._-]/g, '');
    }
    function usuarioValido(u) { return /^[a-z0-9][a-z0-9._-]{2,39}$/.test(String(u || '')); }
    function email(usuario) { return normalizarUsuario(usuario) + DOMINIO; }
    function esCorreo(correo) {
        var c = String(correo || '').toLowerCase();
        return c.length > DOMINIO.length && c.slice(-DOMINIO.length) === DOMINIO;
    }
    function usuarioDeCorreo(correo) { return esCorreo(correo) ? String(correo).toLowerCase().slice(0, -DOMINIO.length) : ''; }

    function activo(x) { return !!x && !(x.datos ? x.datos.activo === false : x.activo === false); }

    /* ¿Qué sucursales le tocan? Vacío = todas las del negocio. Las que ya no
       existen se ignoran (una sucursal eliminada no se ofrece). */
    function todas(acceso) { var s = acceso && acceso.sucursales; return !s || !s.length; }
    function sucursalesPermitidas(acceso, sucursales) {
        var lista = (sucursales || []).filter(function (s) { return s && s.activa !== false; });
        if (todas(acceso)) return lista;
        var ok = {};
        acceso.sucursales.forEach(function (id) { ok[id] = true; });
        return lista.filter(function (s) { return ok[s.id]; });
    }
    function puedeSucursal(acceso, sucId) {
        if (!acceso) return false;
        if (todas(acceso)) return true;
        return acceso.sucursales.indexOf(sucId) !== -1;
    }

    /* Cuántos módulos tiene prendidos (para la tarjeta del negocio). */
    function modulosPrendidos(acceso) {
        var p = (acceso && acceso.permisos) || {};
        return MODULOS.filter(function (m) { return !!p[m.key]; });
    }

    /* ── El acceso en este equipo ────────────────────────────────────────────
       page-guard lo lee de aquí (etaaxPermisosRol con el rol ETAAX_ROL_ETX): la
       portada y el hub lo escriben al entrar, recién leído de la base. */
    function claveAcceso(negId) { return 'etaax_' + negId + '_acceso_etx'; }
    function guardarAcceso(negId, acceso) {
        try { localStorage.setItem(claveAcceso(negId), JSON.stringify(acceso || {})); } catch (e) {}
    }
    function leerAcceso(negId) {
        try { return JSON.parse(localStorage.getItem(claveAcceso(negId)) || 'null'); } catch (e) { return null; }
    }

    /* Lo que la portada pide a la base: mis negocios con su ficha y mi acceso. */
    function misNegocios(sb) {
        return sb.rpc('etx_mis_negocios').then(function (r) {
            if (r.error) throw r.error;
            return (r.data || []).map(function (x) {
                var d = x.negocio || {};
                return { id: x.negocio_id, nombre: d.nombre || x.negocio_id, tipo: d.tipo, emoji: d.emoji,
                         color: d.color, organizacion: d.organizacion || '', fechaCreado: d.fechaCreado,
                         logo: d.logo || '', acceso: x.acceso || {} };
            });
        });
    }

    window.StaffEtx = {
        DOMINIO: DOMINIO, ROL: ROL, MODULOS: MODULOS,
        permisosIniciales: permisosIniciales,
        normalizarUsuario: normalizarUsuario, usuarioValido: usuarioValido,
        email: email, esCorreo: esCorreo, usuarioDeCorreo: usuarioDeCorreo,
        activo: activo, todas: todas,
        sucursalesPermitidas: sucursalesPermitidas, puedeSucursal: puedeSucursal,
        modulosPrendidos: modulosPrendidos,
        claveAcceso: claveAcceso, guardarAcceso: guardarAcceso, leerAcceso: leerAcceso,
        misNegocios: misNegocios
    };
})();
