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

/* "Cambiar de sucursal" YA NO ES UNA ACCIÓN GENERAL. Era un interruptor único
   para toda la app y por eso no acababa de servir: apagarlo para que la cajera
   no moviera cortes le quitaba también las recetas y los insumos, y prenderlo se
   los daba todos. Ahora cada herramienta trae el suyo —ventas, gastos, recetas,
   insumos, clientes— y se apaga donde estorba, no en todas partes.

   La clave general se SIGUE escribiendo aquí, en falso, por una sola razón: es
   el respaldo de los negocios que ya la tenían configurada. Donde un módulo no
   declare la suya, manda esta. No se muestra en la pantalla de permisos. */
Object.keys(window.ETAAX_PERM_DEFAULTS).forEach(function (rol) {
    if (window.ETAAX_PERM_DEFAULTS[rol].cambiarSucursal === undefined)
        window.ETAAX_PERM_DEFAULTS[rol].cambiarSucursal = true;
});

/* Catálogo de sub-permisos por módulo — fuente única para la UI de
   permisos.html y para validar claves. El orden define cómo se listan. */
window.ETAAX_SUBPERMS = {
    /* ── VENTAS Y GASTOS DIARIOS · lado VENTAS ───────────────────────────────
       El módulo es UNA pantalla con ocho tarjetas. Aquí van las cuatro del lado
       de ventas —corte, movimientos, caja fuerte y ventas especiales— y cada
       tarjeta tiene su propio interruptor: apagarlo la quita de la pantalla y
       niega su panel, no solo esconde un botón de adentro. */
    ventas: [
        { key:'capturarCorte',  label:'Registrar corte de caja',   sub:'La tarjeta del corte del día, por turno y sucursal' },
        { key:'verLista',       label:'Ver cortes anteriores',     sub:'Sin esto solo ve el corte de hoy' },
        { key:'editarHistorico',label:'Editar cortes anteriores',  sub:'El corte de hoy siempre es editable' },
        /* Reasignar de sucursal, SOLO para cortes. Antes era un interruptor
           general para toda la app: apagarlo le quitaba también las recetas y
           los insumos, y prenderlo se los daba todos. */
        { key:'cambiarSucursal',label:'Cambiar el corte de sucursal', sub:'Reasignar un corte a otra sucursal' },
        { key:'hacerDeposito',  label:'Depósitos y retiros',       sub:'La tarjeta de movimientos entre caja, caja fuerte y banco' },
        { key:'verDepositos',   label:'Ver la lista de movimientos', sub:'Consultar el historial de depósitos y retiros' },
        { key:'previsiones',    label:'Apartar previsiones',       sub:'Guardar dinero para un gasto que viene' },
        { key:'ventaExtra',     label:'Ventas especiales',         sub:'Eventos, banquetes y ventas fuera de la operación diaria' },
        { key:'anticipos',      label:'Registrar anticipos',       sub:'Lo que dejan a cuenta por un evento' },
        { key:'cajaFuerte',     label:'Ver caja fuerte',           sub:'La tarjeta del resguardo: saldo, comisiones y movimientos a banco' },
    ],
    /* ── RECETAS E INSUMOS ───────────────────────────────────────────────────
       `pendiente:true` = el interruptor EXISTE pero todavía no lo respeta el
       módulo. Se marca a la vista en vez de esconderlo: un permiso que se apaga
       y no pasa nada es peor que no tenerlo — ya pasó con "cambiar de sucursal"
       y costó una auditoría entera entender por qué. Al conectar uno, se le
       quita la marca en el mismo commit. */
    /* Escandallos: los diez están CONECTADOS — cada interruptor lo obedecen la
       pantalla (esconde el botón) y la función (se niega aunque la llamen por
       otro camino). El orden es el del trabajo real: ver, crear, editar,
       imprimir, dinero, borrar. */
    recetas: [
        { key:'verCatalogo',      label:'Ver catálogo de recetas y sub-recetas', sub:'Entrar al recetario y abrir una ficha técnica' },
        { key:'crear',            label:'Crear recetas / receta simple', sub:'Dar de alta escandallos de alimentos y bebidas' },
        { key:'crearSub',         label:'Crear sub-recetas',           sub:'Salsas, fondos, masas, jarabes, bases' },
        { key:'editar',           label:'Editar escandallos',          sub:'Recetas y sub-recetas: modificar y guardar' },
        { key:'imprimir',         label:'Imprimir recetas',            sub:'Ficha operativa y administrativa' },
        { key:'verCostos',        label:'Ver costos y márgenes',       sub:'Sin esto ve la receta en vista operativa, sin dinero' },
        { key:'caratula',         label:'Ver carátula de costos',      sub:'Comparativo de costos y rentabilidad' },
        { key:'caratulaImprimir', label:'Imprimir carátula de costos', sub:'Sacar el comparativo en papel o PDF' },
        { key:'eliminar',         label:'Eliminar recetas / sub-recetas', sub:'Borrar del catálogo' },
        { key:'cambios',          label:'Ver cambios recientes',       sub:'Qué se modificó por sucursal y qué sube al catálogo global' },
        { key:'cambiarSucursal',label:'Cambiar la receta de sucursal', sub:'Reasignar un escandallo a otra sucursal' },
    ],
    /* Insumos: los ocho CONECTADOS. Igual que Escandallos, cada uno lo obedecen
       la pantalla (esconde el botón) y la función (se niega aunque la llamen por
       otro camino). */
    insumos: [
        { key:'crear',          label:'Crear insumos',            sub:'Dar de alta materias primas' },
        { key:'editar',         label:'Editar insumos',           sub:'Modificar presentaciones y datos' },
        { key:'eliminar',       label:'Eliminar insumos',         sub:'Borrar del catálogo' },
        { key:'verCostos',      label:'Ver precios de compra',    sub:'Sin esto ve el catálogo, pero no el costo ni el proveedor' },
        { key:'verCosteo',      label:'Ver costeos',              sub:'La vista de costeo del catálogo: copa, trago y margen' },
        { key:'catalogoEtaax',  label:'Traer del catálogo ETAAX', sub:'Copiar insumos del catálogo de la plataforma' },
        { key:'catalogoNegocio',label:'Copiar de otra sucursal',  sub:'Traer insumos que ya existen en el negocio' },
        { key:'importar',       label:'Importar por archivo',     sub:'Alta masiva desde Excel o CSV' },
        { key:'cambiarSucursal',label:'Cambiar el insumo de sucursal', sub:'Reasignar un insumo a otra sucursal' },
    ],
    inventarios: [
        { key:'capturar',   label:'Capturar inventario',      sub:'Abrir un inventario y contar existencias por área' },
        { key:'entradas',   label:'Registrar entradas',       sub:'Compras y recepciones de mercancía' },
        { key:'qr',         label:'Generar el QR de entradas',sub:'El código que usan desde el celular' },
        { key:'reporte',    label:'Ver reporte ejecutivo',    sub:'El Resultado y los reportes: variancias, mermas y mermas por insumo' },
        { key:'verCostos',  label:'Ver el capital invertido', sub:'Sin esto ve el reporte en cantidades, sin importes' },
        { key:'cerrar',     label:'Cerrar el inventario',     sub:'Aplicarlo y dejarlo como existencia oficial' },
    ],
    requisiciones: [
        { key:'crear',        label:'Capturar la requisición',sub:'Registrar existencias y armar el pedido' },
        { key:'verProyeccion',label:'Ver proyección de compra',sub:'Qué comprar por área y proveedor' },
        { key:'exportar',     label:'Exportar el pedido',     sub:'Mandarlo al proveedor en CSV o impreso' },
        { key:'historial',    label:'Ver historial',          sub:'Requisiciones de periodos anteriores' },
    ],
    /* ── VENTAS Y GASTOS DIARIOS · lado GASTOS ───────────────────────────────
       Las otras cuatro tarjetas de la misma pantalla: gastos del día, gastos
       mayores, nóminas y gastos fijos. Nóminas y fijos NO tenían interruptor:
       quien podía capturar un gasto de $80 podía pagar la nómina completa. */
    /* Clientes solo necesita uno por ahora: el resto del módulo se gobierna con
       el interruptor del módulo entero. */
    clientes: [
        { key:'cambiarSucursal',label:'Cambiar el cliente de sucursal', sub:'Reasignar un cliente a otra sucursal' },
    ],
    /* ── GESTIÓN DE STAFF ────────────────────────────────────────────────────
       El hub tiene seis herramientas; la primera —el Catálogo— es la que se
       desglosa, porque ahí viven los sueldos, los datos bancarios y el
       expediente. Las otras cinco llevan por ahora un interruptor cada una: se
       afinan cuando toque, y mientras tanto el que existe SÍ manda.

       Reglamento Interno no aparece a propósito: su pantalla todavía no existe
       y un permiso que no gobierna nada es una mentira silenciosa. Entra el día
       que entre el módulo. */
    staff: [
        { key:'verCatalogo',  label:'Entrar al catálogo de staff', sub:'Ver la lista del personal. Sin esto, no abre la tarjeta' },
        { key:'crear',        label:'Agregar colaborador',       sub:'Dar de alta a alguien nuevo' },
        { key:'editar',       label:'Editar colaborador',        sub:'Cambiar sus datos, su sueldo y su expediente' },
        { key:'salarioMinimo',label:'Definir el salario mínimo', sub:'El sueldo con el que nacen todos los nuevos' },
        { key:'bajas',        label:'Ver y editar bajas',        sub:'El archivo de quien ya no está, y reactivarlo' },
        { key:'darBaja',      label:'Dar de baja a un colaborador', sub:'Sale de la operación; su expediente se conserva' },
        { key:'eliminar',     label:'Eliminar un colaborador',   sub:'Lo ÚNICO irreversible: borra el expediente completo' },
        { key:'horarios',     label:'Horarios operativos',       sub:'El rol semanal de turnos por puesto y sucursal' },
        { key:'checklists',   label:'Checklists operativos',     sub:'Rutinas de apertura, cierre y limpiezas' },
        { key:'organigrama',  label:'Organigrama',               sub:'El mapa de la organización' },
        { key:'perfiles',     label:'Perfiles de puesto',        sub:'Qué se espera de cada puesto y cómo se mide' },
        { key:'evaluaciones', label:'Evaluaciones',              sub:'Formularios de desempeño y sus resultados' },
    ],
    gastos: [
        { key:'capturar',       label:'Registrar gastos diarios',  sub:'La tarjeta de egresos operativos del día' },
        { key:'verCajaChica',   label:'Ver gastos de caja chica',  sub:'Gastos pagados desde caja chica' },
        { key:'verHistorico',   label:'Ver gastos anteriores',     sub:'Sin esto solo ve los gastos de hoy' },
        { key:'editarHistorico',label:'Editar gastos anteriores',  sub:'El gasto de hoy siempre es editable' },
        { key:'cambiarSucursal',label:'Cambiar el gasto de sucursal', sub:'Reasignar un gasto a otra sucursal' },
        { key:'gastosMayores',  label:'Registrar gasto mayor',     sub:'La tarjeta de egresos grandes, con clave de administrador' },
        { key:'nominas',        label:'Pagar nóminas',             sub:'La tarjeta de nómina del staff por periodo' },
        { key:'fijos',          label:'Pagar gastos fijos',        sub:'La tarjeta de renta, servicios y obligaciones del mes' },
        { key:'verCajaFuerte',  label:'Ver gastos de caja fuerte', sub:'Gastos pagados desde caja fuerte' },
        { key:'verBanco',       label:'Ver gastos de banco',       sub:'Transferencia, débito y crédito' },
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
                /* La página ya se pintó con lo que había en caché. Ahora que
                   llegó lo de verdad, avisar para que se vuelva a aplicar: sin
                   esto, un permiso recién cambiado por el dueño no se respeta
                   hasta la siguiente carga. */
                try { window.dispatchEvent(new CustomEvent('etaax:permisos', { detail:{ negId:negId } })); }
                catch (e) {}
            })
            .catch(function (e) { console.warn('[etaax] permisos sin refrescar:', e); });
    })();
};

/* ── ¿Puede este colaborador hacer ESTO, aquí? ───────────────────────────────
   La misma pregunta se hacía en cada módulo con su propia copia (_puedeRec,
   _puedeIns…). Cuatro copias de la misma regla es garantía de que una se queda
   atrás, así que la regla vive aquí y los módulos solo le ponen su nombre.

   Quién pasa siempre: el dueño y el admin maestro (no son "staff"), y el rol
   `admin` del negocio — ese atajo es a propósito, para que nadie se deje fuera
   de sus propios números por un descuido al editar permisos.

   Y si el ayudante no cargó, NO se cierra nada: un permiso que falla cerrado
   deja a la gente fuera por un problema de red, y la puerta de verdad la guarda
   el servidor con RLS, no esta lista. */
window.etaaxPuedeSub = function (modulo, sub) {
    var ctx = null;
    try { ctx = JSON.parse(localStorage.getItem('etaax_ctx') || 'null'); } catch (e) {}
    if (!ctx || ctx.ctxType !== 'staff') return true;
    if ((ctx.rol || '') === 'admin') return true;
    if (typeof window.etaaxPerm !== 'function') return true;
    return window.etaaxPerm(ctx.negId || localStorage.getItem('etaax_negocio_activo'),
                            ctx.rol, modulo + '.' + sub);
};
/* El "no" que sí se oye. Esconder el botón NO es negar: la función se puede
   llamar desde la consola, desde un link o reaparecer en el siguiente repintado.
   Cada acción pregunta por su cuenta; lo que se esconde es para no ofrecer lo
   que no se puede. Las dos capas, siempre. */
window.etaaxExigeSub = function (modulo, sub, msg) {
    if (window.etaaxPuedeSub(modulo, sub)) return true;
    alert('🔒 ' + (msg || 'Tu rol no tiene permiso para esta acción.') +
          '\n\nPídeselo al administrador del negocio, en Roles y Permisos.');
    return false;
};

/* ¿Puede reasignar un registro a otra sucursal, EN ESTE MÓDULO?
   Manda el permiso del módulo; si no está puesto, decide el general de antes —
   así lo que ya estaba configurado no cambia de comportamiento. Fail-open. */
window.etaaxPuedeReasignar = function (modulo) {
    var ctx = null;
    try { ctx = JSON.parse(localStorage.getItem('etaax_ctx') || 'null'); } catch (e) {}
    if (!ctx || ctx.ctxType !== 'staff') return true;
    if ((ctx.rol || '') === 'admin') return true;
    if (typeof window.etaaxPermisosRol !== 'function') return true;
    var perms = window.etaaxPermisosRol(ctx.negId || localStorage.getItem('etaax_negocio_activo'), ctx.rol) || {};
    var m = perms[modulo];
    if (m && typeof m === 'object' && 'cambiarSucursal' in m) return m.cambiarSucursal !== false;
    return perms.cambiarSucursal !== false;
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
        /* La clave no estaba cuando el dueño guardó. Si el default de su rol es
           "todo permitido", este permiso NUEVO nace permitido: negarlo sería
           quitarle al colaborador algo que nunca le quitaron — pasa cada vez que
           se agrega un sub-permiso a un módulo con permisos ya guardados. */
        if (def === true) return true;
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
