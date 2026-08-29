/* ============================================================
   ETAAX — El ÁREA de un colaborador, en un solo lugar

   Había dos mapeos escritos por separado (el editor de staff y el portal QR) y
   al necesitar un tercero (horarios) tocaba copiarlo otra vez. El área decide
   qué ve un colaborador en el QR y cómo se agrupa el rol impreso: dos versiones
   que se separan un día es un colaborador viendo la pantalla equivocada.

   API (window.StaffArea):
     .LISTA              → [{ k, nom, ico, label }]  en orden operativo
     .nom(k)             → '🍸 Barra'
     .norm(txt)          → normaliza texto libre a una clave conocida ('' si no)
     .deRol(rol)         → área que implica un rol del sistema ('' si ninguno)
     .de(colaborador)    → el área efectiva: override → rol → puesto escrito a mano
   ============================================================ */
(function () {
    /* El orden NO es alfabético: es el de la operación de un restaurante, que es
       como se lee un rol semanal y como se camina el local. */
    var LISTA = [
        { k: 'barra',          ico: '🍸', label: 'Barra' },
        { k: 'cocina',         ico: '🍳', label: 'Cocina' },
        { k: 'piso',           ico: '🍽️', label: 'Piso' },
        { k: 'administracion', ico: '🗃️', label: 'Administración' }
    ];
    LISTA.forEach(function (a) { a.nom = a.ico + ' ' + a.label; });

    var DE_ROL = {
        chef: 'cocina', jefe_cocina: 'cocina', cocinero: 'cocina',
        jefe_barra: 'barra', barman: 'barra', barista: 'barra',
        mesero: 'piso',
        admin: 'administracion', gerente: 'administracion', administrativo: 'administracion'
    };

    function nom(k) {
        for (var i = 0; i < LISTA.length; i++) if (LISTA[i].k === k) return LISTA[i].nom;
        return '';
    }

    /* Texto libre → clave. El puesto lo teclea una persona: "Ayudante de barra",
       "COCINA FRÍA", "mesero". Sin acentos y por contención, no por igualdad. */
    function norm(a) {
        a = String(a || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
        if (!a) return '';
        if (a.indexOf('barra') >= 0 || a.indexOf('bar') === 0 || a.indexOf('cantina') >= 0 ||
            a.indexOf('mixolog') >= 0) return 'barra';
        if (a.indexOf('cocina') >= 0 || a.indexOf('coc') === 0 || a.indexOf('chef') >= 0 ||
            a.indexOf('parrill') >= 0 || a.indexOf('pastel') >= 0 || a.indexOf('panad') >= 0 ||
            a.indexOf('lavaloza') >= 0 || a.indexOf('steward') >= 0) return 'cocina';
        if (a.indexOf('piso') >= 0 || a.indexOf('servicio') >= 0 || a.indexOf('mesero') >= 0 ||
            a.indexOf('mesera') >= 0 || a.indexOf('host') >= 0 || a.indexOf('garrot') >= 0 ||
            a.indexOf('capitan') >= 0 || a.indexOf('runner') >= 0) return 'piso';
        if (a.indexOf('admin') >= 0 || a.indexOf('gerent') >= 0 || a.indexOf('contab') >= 0 ||
            a.indexOf('contador') >= 0 || a.indexOf('oficina') >= 0 || a.indexOf('recursos hum') >= 0 ||
            a.indexOf('caj') === 0 || a.indexOf(' caj') >= 0) return 'administracion';
        return '';
    }

    function deRol(rol) { return DE_ROL[rol] || ''; }

    /* La jerarquía importa y es deliberada:
       1) el campo `area` — corregido A MANO, manda sobre todo lo demás;
       2) el ROL del sistema — es una lista cerrada, no se presta a interpretación;
       3) el PUESTO escrito a mano — último recurso, adivinando por texto.
       Adivinar antes de mirar el rol pondría "Jefe de Barra" en cocina porque
       alguien escribió "Encargado de cocina y barra" en el puesto. */
    function de(s) {
        if (!s) return '';
        var over = norm(s.area);
        if (over) return over;
        var porRol = deRol(s.rol);
        if (porRol) return porRol;
        return norm(s.puesto);
    }

    /* Los mapas se exponen TAL CUAL (objeto plano, no Proxy): las páginas viejas
       los usan como diccionario y estas tablets no son todas de este año. */
    var NOMBRES = {};
    LISTA.forEach(function (a) { NOMBRES[a.k] = a.nom; });

    window.StaffArea = {
        LISTA: LISTA, NOMBRES: NOMBRES, MAPA_ROL: DE_ROL,
        nom: nom, norm: norm, deRol: deRol, de: de
    };
})();
