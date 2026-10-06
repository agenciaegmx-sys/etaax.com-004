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

    /* ══ LAS ÁREAS DE UN INSUMO ════════════════════════════════════════════════
       OJO: esto NO es lo mismo que el área de un colaborador, aunque se llamen
       parecido. El área del colaborador dice QUIÉN ES; la del insumo dice DÓNDE
       SE GUARDA Y QUIÉN LO MANEJA. Se cruzan en VE_AREAS, abajo.

       Había un solo «Bodega» para todo, y con eso no se puede trabajar: el de
       barra tenía que bucear entre la harina y el aceite para encontrar su
       ginebra de reserva. Ahora el almacén está partido en tres:

         · almacen_barra   → lo que la barra guarda cerrado
         · almacen_cocina  → lo que la cocina guarda cerrado
         · almacen_general → lo de todos: desechables, limpieza, papelería…
                             lo que piden piso y administración

       'bodega' sigue siendo válida: es lo que tienen capturado cientos de
       insumos y reescribirles el campo en masa movería de lugar cosas que nadie
       pidió mover. Se lee como almacén general —que es lo que era— y el editor
       ya ofrece las tres nuevas. */
    var AREAS_INSUMO = [
        { k: 'barra',           ico: '🍸', label: 'Barra' },
        { k: 'cocina',          ico: '🍳', label: 'Cocina' },
        { k: 'almacen_barra',   ico: '📦', label: 'Almacén barra' },
        { k: 'almacen_cocina',  ico: '📦', label: 'Almacén cocina' },
        { k: 'almacen_general', ico: '🏷️', label: 'Almacén general' }
    ];
    AREAS_INSUMO.forEach(function (a) { a.nom = a.ico + ' ' + a.label; });

    /* Texto libre → área de insumo. Admite las claves nuevas, las viejas y lo
       que alguien pudo teclear a mano en una importación. */
    function normIns(a) {
        a = String(a || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
        if (!a) return '';
        if (a === 'bodega' || a === 'almacen' || a === 'general' ||
            a.indexOf('general') >= 0) return 'almacen_general';
        var esAlm = a.indexOf('almacen') >= 0 || a.indexOf('bodega') >= 0;
        if (esAlm && a.indexOf('barra') >= 0) return 'almacen_barra';
        if (esAlm && (a.indexOf('cocina') >= 0 || a.indexOf('coc') >= 0)) return 'almacen_cocina';
        if (esAlm) return 'almacen_general';
        if (a.indexOf('barra') >= 0 || a.indexOf('bar') === 0) return 'barra';
        if (a.indexOf('cocina') >= 0 || a.indexOf('coc') === 0) return 'cocina';
        return '';
    }
    function nomIns(k) {
        var n2 = normIns(k);
        for (var i = 0; i < AREAS_INSUMO.length; i++) if (AREAS_INSUMO[i].k === n2) return AREAS_INSUMO[i].nom;
        return k ? String(k) : '';
    }

    /* ══ QUIÉN VE QUÉ ══════════════════════════════════════════════════════════
       El de barra trabaja con lo de barra y con lo que la barra guarda. No tiene
       nada que hacer en el almacén de cocina, y enseñárselo solo le da más
       lista donde buscar —y más formas de registrar una merma en el insumo
       equivocado—.

       Piso y administración ven TODO: son quienes levantan el inventario
       general y quienes piden lo de uso común. `null` = sin límite, a
       propósito, para que quien llame esto no tenga que enumerar todas las
       áreas existentes ni acordarse de actualizarlo al agregar una. */
    var VE_AREAS = {
        barra:  ['barra',  'almacen_barra'],
        cocina: ['cocina', 'almacen_cocina']
    };
    function veAreas(areaColab) {
        return VE_AREAS[norm(areaColab)] || null;     // null = todas
    }
    /* ¿Este insumo le toca a esta persona? FALLA ABIERTO: un insumo sin área
       capturada se le muestra a todos. Esconderlo dejaría a alguien sin poder
       registrar su merma, y no hay forma de que lo resuelva desde el celular. */
    function veInsumo(areaColab, areaInsumo) {
        var permitidas = veAreas(areaColab);
        if (!permitidas) return true;
        var a = normIns(areaInsumo);
        if (!a) return true;
        return permitidas.indexOf(a) >= 0;
    }

    /* Los mapas se exponen TAL CUAL (objeto plano, no Proxy): las páginas viejas
       los usan como diccionario y estas tablets no son todas de este año. */
    var NOMBRES = {};
    LISTA.forEach(function (a) { NOMBRES[a.k] = a.nom; });

    window.StaffArea = {
        LISTA: LISTA, NOMBRES: NOMBRES, MAPA_ROL: DE_ROL,
        nom: nom, norm: norm, deRol: deRol, de: de,
        AREAS_INSUMO: AREAS_INSUMO, VE_AREAS: VE_AREAS,
        normIns: normIns, nomIns: nomIns, veAreas: veAreas, veInsumo: veInsumo
    };
})();
