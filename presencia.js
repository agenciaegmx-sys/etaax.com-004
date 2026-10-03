/* ============================================================================
   ETAAX — QUIÉN ESTÁ TRABAJANDO AQUÍ, AHORA MISMO

   El problema real: dos personas capturando el mismo corte, o el mismo
   inventario, sin saber que la otra está. No se enteran hasta que uno pisa lo
   del otro — y entonces ya no hay forma de saber qué número era el bueno.

   Esto no lo impide (eso sería bloqueo, y bloquear a medio turno es peor), pero
   sí lo HACE VISIBLE: los avatares de quién está dentro, arriba, como en un
   documento compartido. Con verlos, la conversación ocurre antes del choque.

   POR QUÉ NO HAY TABLA: la presencia es efímera por naturaleza. Guardar un
   latido por persona cada pocos segundos llenaría la base de ruido para
   responder una pregunta que solo importa AHORA — y dejaría fantasmas cada vez
   que alguien cierra la laptop sin salir. Supabase Realtime trae Presence
   justo para esto: vive en memoria, y cuando la conexión se corta la persona
   desaparece sola. Lo que SÍ se guarda es el acceso (bitácora, v62), que es
   otra pregunta: «quién entró», no «quién está».

   ALCANCE: se comparte canal por NEGOCIO + SUCURSAL. Dos personas en sucursales
   distintas no se estorban, así que verse ahí sería ruido. En la vista global
   del negocio el canal es el del negocio entero.

   API (window.EtaaxPresencia):
     .entrar()            → se une al canal de donde estés parado
     .salir()             → se va (lo llama ctxSalir; cerrar la pestaña también)
     .gente()             → [{nombre, inicial, color, rol, tipo, yo}]
     .alCambiar(fn)       → avisa cuando entra o sale alguien
   ============================================================================ */
(function () {
    if (window.EtaaxPresencia) return;

    var _canal = null, _clave = '', _yo = null, _oyentes = [], _gente = [];

    /* Un id por PESTAÑA, no por persona: la misma persona con el corte abierto
       en la laptop y el inventario en la tablet son dos presencias de verdad —
       y si compartieran clave, cerrar una borraría la otra. */
    var _sesionId = (function () {
        try {
            var k = 'etaax_pres_sid';
            var v = sessionStorage.getItem(k);
            if (!v) { v = Date.now().toString(36) + Math.random().toString(36).slice(2, 8); sessionStorage.setItem(k, v); }
            return v;
        } catch (e) { return Date.now().toString(36); }
    })();

    /* Color estable por nombre: el mismo colaborador sale siempre del mismo
       color, en cualquier pantalla y sin guardar nada. Un color al azar por
       sesión haría imposible reconocer a nadie de un vistazo. */
    var COLORES = ['#3dbe7a', '#7ab8f5', '#c87a6a', '#9b8de8', '#e0a93d',
                   '#5fb3a1', '#d4788f', '#8aa6d6', '#c4a882', '#6fae6f'];
    function _color(nombre) {
        var s = String(nombre || '?'), h = 0;
        for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
        return COLORES[h % COLORES.length];
    }
    function _inicial(nombre) {
        var p = String(nombre || '?').trim().split(/\s+/);
        var a = (p[0] || '?').charAt(0);
        var b = p.length > 1 ? (p[1] || '').charAt(0) : '';
        return (a + b).toUpperCase() || '?';
    }

    function _ctx() {
        try { return JSON.parse(localStorage.getItem('etaax_ctx') || 'null'); } catch (e) { return null; }
    }
    function _sucActiva() {
        try { return localStorage.getItem('etaax_sucursal_activa') || ''; } catch (e) { return ''; }
    }

    /* Quién soy, para que los demás me vean. Nada sensible: nombre, rol y si
       soy dueño o del equipo. Esto viaja a los otros navegadores conectados, así
       que no lleva correo ni id. */
    function _quienSoy() {
        var c = _ctx();
        if (!c) return null;
        var nombre = c.userName || c.nombre || 'Alguien';
        var esStaff = c.ctxType === 'staff';
        return {
            sid:     _sesionId,
            nombre:  String(nombre).slice(0, 40),
            inicial: _inicial(nombre),
            color:   _color(nombre),
            rol:     String(c.rol || '').slice(0, 24),
            tipo:    esStaff ? 'staff' : 'dueno',
            desde:   Date.now()
        };
    }

    /* Se recorre el estado del canal y se arma la lista. Presence entrega un
       mapa de clave → metadatos; una misma persona puede tener varias entradas
       (dos pestañas) y se cuentan una sola vez: ver «Ana (2)» no dice nada. */
    function _releer() {
        if (!_canal) { _gente = []; return; }
        var est = {};
        try { est = _canal.presenceState() || {}; } catch (e) { est = {}; }
        var porNombre = {};
        Object.keys(est).forEach(function (k) {
            (est[k] || []).forEach(function (m) {
                if (!m || !m.nombre) return;
                var prev = porNombre[m.nombre];
                /* De dos pestañas de la misma persona se conserva la MÁS VIEJA:
                   «lleva 40 min aquí» es más útil que «llegó hace 3 segundos». */
                if (!prev || (m.desde || 0) < (prev.desde || 0)) {
                    porNombre[m.nombre] = {
                        nombre: m.nombre, inicial: m.inicial, color: m.color,
                        rol: m.rol, tipo: m.tipo, desde: m.desde,
                        yo: !!(_yo && m.sid === _yo.sid)
                    };
                }
                if (_yo && m.sid === _yo.sid) porNombre[m.nombre].yo = true;
            });
        });
        _gente = Object.keys(porNombre).map(function (n) { return porNombre[n]; })
            .sort(function (a, b) {
                /* Yo primero —es el ancla para leer la fila— y el resto por
                   antigüedad, que es el orden en que fueron llegando. */
                if (a.yo !== b.yo) return a.yo ? -1 : 1;
                return (a.desde || 0) - (b.desde || 0);
            });
    }

    function _avisar() {
        _releer();
        for (var i = 0; i < _oyentes.length; i++) { try { _oyentes[i](_gente); } catch (e) {} }
    }

    function entrar() {
        var c = _ctx();
        if (!c || !c.negId || typeof window._supabase === 'undefined') return;
        var clave = 'pres:' + c.negId + ':' + (_sucActiva() || '_global');
        if (_canal && _clave === clave) return;   // ya estoy donde debo
        salir();
        _yo = _quienSoy();
        if (!_yo) return;
        _clave = clave;
        try {
            _canal = window._supabase.channel(clave, { config: { presence: { key: _sesionId } } });
            _canal
                .on('presence', { event: 'sync' },  _avisar)
                .on('presence', { event: 'join' },  _avisar)
                .on('presence', { event: 'leave' }, _avisar)
                .subscribe(function (estado) {
                    if (estado === 'SUBSCRIBED') { try { _canal.track(_yo); } catch (e) {} }
                });
        } catch (e) { _canal = null; _clave = ''; }
    }

    function salir() {
        if (!_canal) return;
        try { _canal.untrack(); } catch (e) {}
        try { window._supabase.removeChannel(_canal); } catch (e) {}
        _canal = null; _clave = ''; _gente = []; _avisar();
    }

    /* Cambiar de sucursal es cambiar de sala: si no, el de la sucursal 2
       seguiría apareciendo entre los de la 1. */
    try {
        window.addEventListener('storage', function (e) {
            if (!e) return;
            if (e.key === 'etaax_sucursal_activa' || e.key === 'etaax_ctx') entrar();
        });
    } catch (e) {}

    /* Cerrar la pestaña avisa; y si no alcanza a avisar (se cortó la luz),
       Presence lo nota solo cuando el socket muere. */
    try { window.addEventListener('pagehide', salir); } catch (e) {}

    window.EtaaxPresencia = {
        entrar: entrar,
        salir: salir,
        gente: function () { return _gente.slice(); },
        alCambiar: function (fn) { if (typeof fn === 'function') { _oyentes.push(fn); fn(_gente); } },
        _color: _color, _inicial: _inicial
    };

    /* Se entra solo: una pieza que hay que acordarse de encender en cada página
       es una pieza que la mitad de las páginas no van a tener. */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(entrar, 400); });
    } else { setTimeout(entrar, 400); }
})();
