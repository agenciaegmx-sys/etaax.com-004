/* ============================================================================
   ETAAX — MIGRAR UNA SUCURSAL A OTRO NEGOCIO  (solo el admin maestro)

   La sucursal se va con TODO lo suyo: cortes, gastos, inventarios, entradas,
   horarios, checklists, evaluaciones, clientes, proveedores y, si se pide, su
   staff. Aquí se arma y se enseña el PLAN; lo aplica en una sola transacción
   la función admin_migrar_sucursal (supabase-migration-v86.sql).

   LAS REGLAS (las mismas que usa todo el sistema)
     · Un registro es de la sucursal S si datos.sucursalId === S. Vacío es la
       Matriz (EtaaxCore.esDeSuc). Por eso la Matriz no se migra con esto: sus
       registros viejos no traen sello y no se pueden separar con seguridad.
     · Insumos y recetas viven en una o varias sucursales (sucursales[] o
       sucursalId) y pueden tener COPIAS por sucursal (origenId → el maestro).
       Recetas, inventarios y entradas guardan el id del MAESTRO.

   QUÉ HACE CON CADA COSA
     · Registros de la sucursal → se MUDAN (mismo id; los horarios cambian el
       suyo porque lleva el negocio adentro).
     · Catálogo (insumos y recetas) → se COPIA al destino: en el origen puede
       ser compartido con otras sucursales, y moverlo las rompería. En el origen
       solo se le quita la sucursal; nada se borra.
         - Por cada insumo/receta se copia la versión que esa sucursal usa (su
           copia si la tiene, si no el maestro), sin lazos con el origen.
         - Insumos: mismo id (su llave es negocio + insumo). Si el destino ya lo
           tiene, se queda su ficha y solo se le suma la sucursal.
         - Recetas: id NUEVO (su llave es global). Las referencias a la receta
           vieja dentro de lo que se muda se cambian (remap).
         - También se copia lo que la sucursal USA sin tenerlo asignado (una
           sub-receta, un coctel vendido en un inventario viejo), fuera de las
           listas, para que su historia siga leyéndose.
     · Documentos de un renglón (sucursales, compuestos/bateo, parámetros de
       nómina) → se parte el de origen y se suma al de destino.
     · Fotos privadas (cortes, gastos, entradas, staff) → se copian a la
       carpeta del destino; su dueño nuevo no puede leer la del anterior.
     · Lo que es del negocio (cuentas y tarjetas, categorías de gasto, perfiles
       de puesto, permisos, metas) → se queda en el negocio original.

   MODO COPIA (Edwin, 23-nov) — el que usa el panel: la sucursal se COPIA al
   destino y el negocio original NO se toca, para revisar que todo llegó antes
   de eliminarla. Los registros copiados llevan id nuevo (su llave es global) y
   todo lo que los nombra se cambia con ellos (remap). El staff NO se copia: su
   usuario es único en ETAAX; pasa al destino cuando la sucursal se elimina del
   original (admin_archivar_sucursal, v87), y regresa si se restaura.
   ============================================================================ */
(function (root) {
    'use strict';
    var MATRIZ = 'suc_principal';
    var BUCKET_PRIV = 'evidencias-priv';

    // Tablas de registros por sucursal (datos.sucursalId). El orden es el del resumen.
    var POR_SUCURSAL = [
        { t: 'cortes',                mod: 'Ventas y cortes', lbl: 'Cortes de caja' },
        { t: 'depositos',             mod: 'Ventas y cortes', lbl: 'Depósitos y retiros' },
        { t: 'ventas_extra',          mod: 'Ventas y cortes', lbl: 'Ventas extra' },
        { t: 'gastos',                mod: 'Gastos y finanzas', lbl: 'Gastos' },
        { t: 'gf_fijos',              mod: 'Gastos y finanzas', lbl: 'Gastos fijos' },
        { t: 'sf_otros',              mod: 'Gastos y finanzas', lbl: 'Otros movimientos' },
        { t: 'previsiones',           mod: 'Gastos y finanzas', lbl: 'Previsiones' },
        { t: 'inventarios',           mod: 'Inventarios', lbl: 'Inventarios' },
        { t: 'entradas_log',          mod: 'Inventarios', lbl: 'Entradas, mermas y cortesías' },
        { t: 'inventario_conteos',    mod: 'Inventarios', lbl: 'Conteos por QR' },
        { t: 'clientes',              mod: 'Administración', lbl: 'Clientes' },
        { t: 'proveedores',           mod: 'Administración', lbl: 'Proveedores' },
        { t: 'staff',                 mod: 'Staff', lbl: 'Colaboradores', opcion: 'conStaff' },
        { t: 'horarios',              mod: 'Staff', lbl: 'Horarios' },
        { t: 'checklists',            mod: 'Staff', lbl: 'Checklists' },
        { t: 'checklist_runs',        mod: 'Staff', lbl: 'Checklists por semana' },
        { t: 'checklist_ejecuciones', mod: 'Staff', lbl: 'Checklists contestados' },
        { t: 'evaluaciones',          mod: 'Staff', lbl: 'Evaluaciones' }
    ];
    // Siguen a su padre.
    var HIJOS = [
        { t: 'evaluacion_respuestas', padre: 'evaluaciones', campo: 'evaluacionId', mod: 'Staff', lbl: 'Respuestas de evaluaciones' },
        { t: 'nomina_recibos',        padre: 'staff',        campo: 'staffId',      mod: 'Staff', lbl: 'Recibos de nómina' }
    ];
    // Del negocio: se quedan en el original (se enseñan para que no sorprenda).
    var DEL_NEGOCIO = [
        'Cuentas y tarjetas', 'Categorías de gasto', 'Perfiles de puesto y organigrama',
        'Permisos por rol', 'Configuración del negocio', 'Metas de venta y de KPIs',
        'Nóminas manuales (las de antes del módulo de nómina)', 'Requisiciones'
    ];
    var DOCS = ['negocio_sucursales', 'inv_ajustes', 'gf_nomina_params'];

    function sucDe(d) { return (d && d.sucursalId) || MATRIZ; }
    function memb(x) {
        if (x && x.sucursales && x.sucursales.length) return x.sucursales.slice();
        if (x && x.sucursalId) return [x.sucursalId];
        return [];
    }
    function vive(x, S) { return memb(x).some(function (s) { return (s || MATRIZ) === S; }); }
    function clon(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
    // Un hash corto y estable (djb2): el id nuevo de una receta es el mismo si
    // el plan se vuelve a armar, así un reintento no duplica.
    function hash(s) {
        var h = 5381; s = String(s);
        for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
        return h.toString(36);
    }
    function idRecetaNueva(id, destino, suc) { return id + '-m' + hash(destino + '|' + suc); }
    function idHorario(neg, suc, semana) { return 'hor_' + Array.from(String(neg)).length + '_' + neg + '_' + (suc || MATRIZ) + '_' + semana; }

    // Todas las cadenas de un valor (valores y llaves).
    function cadenas(v, out) {
        if (v == null) return out;
        if (typeof v === 'string') { out[v] = 1; return out; }
        if (Array.isArray(v)) { for (var i = 0; i < v.length; i++) cadenas(v[i], out); return out; }
        if (typeof v === 'object') { for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) { out[k] = 1; cadenas(v[k], out); } }
        return out;
    }
    /* El mismo reemplazo que hace la función SQL (_mig_remap): ids como cadena
       EXACTA, en llaves y en valores. Se usa para los documentos que se arman
       aquí, así quedan igual que lo que se muda allá. */
    function remapear(v, mapa) {
        if (v == null) return v;
        if (typeof v === 'string') return Object.prototype.hasOwnProperty.call(mapa, v) ? mapa[v] : v;
        if (Array.isArray(v)) return v.map(function (x) { return remapear(x, mapa); });
        if (typeof v === 'object') {
            var o = {};
            Object.keys(v).forEach(function (k) {
                var k2 = Object.prototype.hasOwnProperty.call(mapa, k) ? mapa[k] : k;
                o[k2] = remapear(v[k], mapa);
            });
            return o;
        }
        return v;
    }
    function filas(datos, t) { return ((datos && datos.tablas && datos.tablas[t]) || []).filter(function (r) { return r && r.datos; }); }
    function doc(datos, t) { return (datos && datos.docs && datos.docs[t]) || null; }
    function nombreNeg(n) { return (n && n.datos && n.datos.nombre) || (n && n.id) || '—'; }

    /* ══ EL PLAN ═══════════════════════════════════════════════════════════
       e = {
         origen:  { negocio, tablas:{t:[{id|insumo_id, negocio_id, datos}]}, docs:{t:{datos, updated_at}} },
         destino: { negocio, tablas:{...}, docs:{...} },
         sucursal: S, llegaComo: 'nueva' | 'matriz', conStaff: true|false
       } */
    function planear(e) {
        e = e || {};
        var O = e.origen || {}, D = e.destino || {};
        var orig = O.negocio && O.negocio.id, dest = D.negocio && D.negocio.id, S = e.sucursal;
        var modoCopia = e.modo === 'copia';
        var conStaff = modoCopia ? false : e.conStaff !== false, comoMatriz = e.llegaComo === 'matriz';
        var avisos = [], bloqueos = [];
        var plan = {
            version: 1, origen: orig, destino: dest, sucursal: S, sucursalNueva: S,
            sucursalNombre: '', llegaComo: comoMatriz ? 'matriz' : 'nueva', conStaff: conStaff,
            tablas: [], hijos: [], docs: [], insumos: [], recetas: [], quitarInsumos: [], quitarRecetas: [],
            filas: [], remap: {}, fotos: [], resumen: [], seQueda: DEL_NEGOCIO.slice(), avisos: avisos, bloqueos: bloqueos,
            modo: modoCopia ? 'copia' : 'mover', recopia: false, filasCopia: [], catalogoCopia: { insumos: [], recetas: [] }
        };
        if (!orig || !dest) { bloqueos.push('Elige el negocio de origen y el de destino.'); return plan; }
        if (orig === dest) { bloqueos.push('El destino tiene que ser otro negocio.'); return plan; }
        if (!S) { bloqueos.push('Elige la sucursal que se va a migrar.'); return plan; }
        if (S === MATRIZ) {
            bloqueos.push('La Matriz no se migra como sucursal: sus registros de antes de las sucursales no traen sello y no se pueden separar del resto del negocio.');
            return plan;
        }

        // ── La sucursal: su ficha y su id en el destino ──
        var docSucO = doc(O, 'negocio_sucursales'), docSucD = doc(D, 'negocio_sucursales');
        var listaO = ((docSucO && docSucO.datos && docSucO.datos.sucursales) || []).slice();
        var listaD = ((docSucD && docSucD.datos && docSucD.datos.sucursales) || []).slice();
        var fichaS = listaO.filter(function (s) { return s && s.id === S; })[0];
        if (!fichaS) { bloqueos.push('Esa sucursal no está en la lista del negocio de origen.'); return plan; }
        plan.sucursalNombre = fichaS.nombre || S;
        var S2 = S;
        // Si ya hay una copia de esta sucursal en el destino, se ACTUALIZA (mismos ids).
        var previa = modoCopia ? listaD.filter(function (s) { return s && s.copiaDe && s.copiaDe.negocio === orig && s.copiaDe.sucursal === S; })[0] : null;
        if (previa) { S2 = previa.id; plan.recopia = true; }
        else if (comoMatriz) S2 = MATRIZ;
        else if (listaD.some(function (s) { return s && s.id === S; })) S2 = S + '_' + hash(dest).slice(0, 4);
        plan.sucursalNueva = S2;
        if (S2 !== S) plan.remap[S] = S2;

        // Llegar como Matriz solo si el destino no tiene operación todavía.
        if (comoMatriz && !plan.recopia) {
            var ocupado = POR_SUCURSAL.filter(function (x) { return filas(D, x.t).length > 0; }).map(function (x) { return x.lbl; });
            if (ocupado.length) bloqueos.push('Para llegar como la Matriz, el destino tiene que estar vacío, y ya tiene: ' + ocupado.join(', ') + '.');
        }

        // ── 1) Registros de la sucursal: se mudan por regla ──
        var mudan = {}, contenido = [];
        POR_SUCURSAL.forEach(function (x) {
            if (x.opcion === 'conStaff' && !conStaff) return;
            var rs = filas(O, x.t).filter(function (r) { return r.datos.sucursalId === S; });
            mudan[x.t] = rs;
            plan.tablas.push(x.t);
            rs.forEach(function (r) { contenido.push(r.datos); });
        });
        HIJOS.forEach(function (h) {
            if (h.padre === 'staff' && !conStaff) return;
            var padres = {}; (mudan[h.padre] || []).forEach(function (r) { padres[r.id || r.datos.id] = 1; });
            var rs = filas(O, h.t).filter(function (r) { return padres[r.datos[h.campo]]; });
            mudan[h.t] = rs;
            plan.hijos.push({ tabla: h.t, padre: h.padre, campo: h.campo });
            rs.forEach(function (r) { contenido.push(r.datos); });
        });
        // El menú público de la sucursal (su id lleva el negocio).
        var menu = filas(O, 'menu_publico').filter(function (r) { return r.id === orig + '|' + S; })[0];
        if (menu) { plan.filas.push({ tabla: 'menu_publico', id: menu.id, nuevo_id: dest + '|' + S2 }); contenido.push(menu.datos); }
        // Sin staff, sus colaboradores se quedan: se dice.
        var nStaff = filas(O, 'staff').filter(function (r) { return r.datos.sucursalId === S; }).length;
        if (modoCopia) {
            if (nStaff) avisos.push(nStaff + ' colaborador' + (nStaff !== 1 ? 'es' : '') + ' no se copia' + (nStaff !== 1 ? 'n' : '') +
                ': su usuario es único en ETAAX. Pasa' + (nStaff !== 1 ? 'n' : '') + ' al negocio nuevo cuando elimines la sucursal del original.');
        } else if (!conStaff && nStaff) {
            avisos.push(nStaff + ' colaborador' + (nStaff !== 1 ? 'es' : '') + ' de esta sucursal se quedan en el negocio original (con sus recibos de nómina).');
        }

        // ── 2) Catálogo: qué usa la sucursal ──
        var insO = filas(O, 'negocio_insumos'), recO = filas(O, 'recetas');
        var insPorId = {}, recPorId = {};
        insO.forEach(function (r) { insPorId[r.insumo_id || r.datos.id] = r; });
        recO.forEach(function (r) { recPorId[r.id || r.datos.id] = r; });
        var canonIns = function (r) { return (r.datos && r.datos.origenId) || r.insumo_id || r.datos.id; };
        var canonRec = function (r) { return (r.datos && r.datos.origenId) || r.id || r.datos.id; };
        // La versión que usa la sucursal: su copia si la tiene; si no, el maestro.
        var elegidosIns = {}, elegidosRec = {}, asignadosIns = {}, asignadosRec = {};
        insO.forEach(function (r) {
            if (!vive(r.datos, S)) return;
            var c = canonIns(r), ya = elegidosIns[c];
            if (!ya || (r.datos.origenId && !ya.datos.origenId)) elegidosIns[c] = r;
            asignadosIns[c] = 1;
        });
        recO.forEach(function (r) {
            if (!vive(r.datos, S)) return;
            var c = canonRec(r), ya = elegidosRec[c];
            if (!ya || (r.datos.origenId && !ya.datos.origenId)) elegidosRec[c] = r;
            asignadosRec[c] = 1;
        });
        // Lo que se usa sin estar asignado (cerradura: una receta trae sub-recetas).
        var revisar = contenido.slice();
        Object.keys(elegidosIns).forEach(function (c) { revisar.push(elegidosIns[c].datos); });
        Object.keys(elegidosRec).forEach(function (c) { revisar.push(elegidosRec[c].datos); });
        var invAj = doc(O, 'inv_ajustes');
        if (invAj && invAj.datos) {
            if (invAj.datos.compuestos && invAj.datos.compuestos[S]) revisar.push(invAj.datos.compuestos[S]);
            if (invAj.datos.bateo && invAj.datos.bateo[S]) revisar.push(invAj.datos.bateo[S]);
        }
        var vistos = {};
        while (revisar.length) {
            var cad = cadenas(revisar.pop(), {});
            Object.keys(cad).forEach(function (s) {
                if (vistos[s]) return; vistos[s] = 1;
                var ri = insPorId[s];
                if (ri) {
                    var ci = canonIns(ri);
                    if (!elegidosIns[ci]) { elegidosIns[ci] = insPorId[ci] || ri; revisar.push(elegidosIns[ci].datos); }
                }
                var rr = recPorId[s];
                if (rr) {
                    var cr = canonRec(rr);
                    if (!elegidosRec[cr]) { elegidosRec[cr] = recPorId[cr] || rr; revisar.push(elegidosRec[cr].datos); }
                }
            });
        }
        // Ids: insumos conservan el canónico; recetas, uno nuevo.
        var insD = {}; filas(D, 'negocio_insumos').forEach(function (r) { insD[r.insumo_id || r.datos.id] = 1; });
        var yaEnDestino = 0;
        Object.keys(elegidosIns).forEach(function (c) {
            var r = elegidosIns[c], desde = r.insumo_id || r.datos.id;
            plan.insumos.push({ desde: desde, id: c, sucursales: asignadosIns[c] ? [S2] : [] });
            if (desde !== c) plan.remap[desde] = c;     // una copia: quien la nombre, ahora nombra al canónico
            if (insD[c]) yaEnDestino++;
        });
        Object.keys(elegidosRec).forEach(function (c) {
            var r = elegidosRec[c], desde = r.id || r.datos.id, nuevo = idRecetaNueva(c, dest, S2);
            plan.recetas.push({ desde: desde, id: nuevo, sucursales: asignadosRec[c] ? [S2] : [], global: !asignadosRec[c] });
            plan.remap[c] = nuevo;
            if (desde !== c) plan.remap[desde] = nuevo;
        });
        // En el origen, a lo que vivía en la sucursal se le quita (al COPIAR, el origen no se toca).
        if (!modoCopia) {
            insO.forEach(function (r) { if (vive(r.datos, S)) plan.quitarInsumos.push(r.insumo_id || r.datos.id); });
            recO.forEach(function (r) { if (vive(r.datos, S)) plan.quitarRecetas.push(r.id || r.datos.id); });
        }
        if (yaEnDestino) avisos.push(yaEnDestino + ' insumo' + (yaEnDestino !== 1 ? 's' : '') + ' ya existía' + (yaEnDestino !== 1 ? 'n' : '') +
            ' en el destino (mismo id): se conserva su ficha del destino y solo se le suma la sucursal.');

        // ── 3) Fotos privadas: a la carpeta del destino ──
        var prefijo = 'priv:' + orig + '/', fotos = {};
        Object.keys(cadenas(contenido.concat(Object.keys(elegidosIns).map(function (c) { return elegidosIns[c].datos; })), {})).forEach(function (s) {
            if (s.indexOf(prefijo) !== 0) return;
            var resto = s.slice(prefijo.length);
            if (!resto) return;
            fotos[s] = 1;
            plan.remap[s] = 'priv:' + dest + '/' + resto;
            plan.fotos.push({ bucket: BUCKET_PRIV, desde: orig + '/' + resto, hacia: dest + '/' + resto });
        });

        // ── 3b) COPIA: cada registro con id nuevo, y lo que lo nombra cambia con él ──
        if (modoCopia) {
            var suf = hash(dest + '|' + S2).slice(0, 5), mapaFilas = {};
            var idCopia = function (t, r) {
                if (t === 'horarios') return idHorario(dest, S2, r.datos.semana || r.id);   // lleva el negocio adentro
                return (r.id || r.datos.id) + '-c' + suf;
            };
            Object.keys(mudan).forEach(function (t) { (mudan[t] || []).forEach(function (r) { mapaFilas[r.id || r.datos.id] = idCopia(t, r); }); });
            if (menu) mapaFilas[menu.id] = dest + '|' + S2;
            Object.keys(mapaFilas).forEach(function (k) { plan.remap[k] = mapaFilas[k]; });
            var copiar = function (t, r, id2) {
                var d = remapear(clon(r.datos), plan.remap);
                d.sucursalId = S2;
                if (Object.prototype.hasOwnProperty.call(d, 'negocioId')) d.negocioId = dest;
                if (Object.prototype.hasOwnProperty.call(d, 'id')) d.id = id2;
                plan.filasCopia.push({ tabla: t, id: id2, datos: d });
            };
            Object.keys(mudan).forEach(function (t) { (mudan[t] || []).forEach(function (r) { copiar(t, r, mapaFilas[r.id || r.datos.id]); }); });
            if (menu) copiar('menu_publico', menu, dest + '|' + S2);
            plan.filas = [];
            // El catálogo, ya armado: sin lazos con el origen.
            var fichaCat = function (datos, id, sucs, global) {
                var d = remapear(clon(datos), plan.remap);
                delete d.origenId; delete d._global; delete d.inactivoEn; delete d.inactivaEn;
                d.id = id; d.sucursales = sucs.slice();
                if (sucs.length) d.sucursalId = sucs[0]; else delete d.sucursalId;
                if (global) d._global = true;
                return d;
            };
            var insDatosD = {}; filas(D, 'negocio_insumos').forEach(function (r) { insDatosD[r.insumo_id || r.datos.id] = r.datos; });
            plan.insumos.forEach(function (x) {
                var ya = insDatosD[x.id], d;
                if (ya) {   // el destino ya lo tenía: se queda su ficha y solo suma la sucursal
                    d = clon(ya);
                    var m = memb(d); x.sucursales.forEach(function (s2) { if (m.indexOf(s2) < 0) m.push(s2); });
                    d.sucursales = m;
                } else d = fichaCat(insPorId[x.desde].datos, x.id, x.sucursales, false);
                plan.catalogoCopia.insumos.push({ insumo_id: x.id, datos: d });
            });
            plan.recetas.forEach(function (x) {
                plan.catalogoCopia.recetas.push({ id: x.id, datos: fichaCat(recPorId[x.desde].datos, x.id, x.sucursales, x.global) });
            });
        }

        // ── 4) Documentos de un renglón ──
        var remap = plan.remap;
        // Sucursales.
        var datosSucO = clon((docSucO && docSucO.datos) || {}), datosSucD = clon((docSucD && docSucD.datos) || {});
        var cfgS = (datosSucO.cfg || {})[S];
        datosSucO.sucursales = listaO.filter(function (s) { return s && s.id !== S; });
        if (datosSucO.cfg) delete datosSucO.cfg[S];
        var fichaNueva = Object.assign(clon(fichaS), { id: S2 });
        if (modoCopia) fichaNueva.copiaDe = { negocio: orig, sucursal: S, en: new Date().toISOString() };
        var listaNueva = listaD.slice();
        if (!listaNueva.length) listaNueva.push({ id: MATRIZ, nombre: 'Matriz', activa: true });
        if (previa) {
            listaNueva = listaNueva.map(function (s) { return (s && s.id === S2) ? Object.assign({}, s, fichaNueva) : s; });
        } else if (comoMatriz) {
            var hayM = false;
            listaNueva = listaNueva.map(function (s) { if (s && s.id === MATRIZ) { hayM = true; return Object.assign({}, s, fichaNueva); } return s; });
            if (!hayM) listaNueva.unshift(fichaNueva);
        } else listaNueva.push(fichaNueva);
        datosSucD.sucursales = listaNueva;
        if (cfgS) { datosSucD.cfg = datosSucD.cfg || {}; datosSucD.cfg[S2] = remapear(clon(cfgS), remap); }
        if (!modoCopia) plan.docs.push({ tabla: 'negocio_sucursales', negocio_id: orig, datos: datosSucO, si_updated_at: docSucO ? (docSucO.updated_at || null) : null });
        plan.docs.push({ tabla: 'negocio_sucursales', negocio_id: dest, datos: datosSucD, si_updated_at: docSucD ? (docSucD.updated_at || null) : null });
        // Compuestos y bateo de inventarios ({compuestos:{[suc]:[]}, bateo:{[suc]:[]}}).
        var ajD = doc(D, 'inv_ajustes');
        if (invAj && invAj.datos && ((invAj.datos.compuestos || {})[S] || (invAj.datos.bateo || {})[S])) {
            var aO = clon(invAj.datos), aD = clon((ajD && ajD.datos) || {});
            ['compuestos', 'bateo'].forEach(function (k) {
                if (!aO[k] || aO[k][S] === undefined) return;
                aD[k] = aD[k] || {};
                aD[k][S2] = remapear(aO[k][S], remap);
                delete aO[k][S];
            });
            if (!modoCopia) plan.docs.push({ tabla: 'inv_ajustes', negocio_id: orig, datos: aO, si_updated_at: invAj.updated_at || null });
            plan.docs.push({ tabla: 'inv_ajustes', negocio_id: dest, datos: aD, si_updated_at: ajD ? (ajD.updated_at || null) : null });
        }
        // Parámetros de nómina por sucursal ({…, porSucursal:{[suc]:{…}}}).
        var npO = doc(O, 'gf_nomina_params'), npD = doc(D, 'gf_nomina_params');
        if (npO && npO.datos && npO.datos.porSucursal && npO.datos.porSucursal[S]) {
            var pO = clon(npO.datos), pD = clon((npD && npD.datos) || {});
            pD.porSucursal = pD.porSucursal || {};
            pD.porSucursal[S2] = pO.porSucursal[S];
            delete pO.porSucursal[S];
            if (!modoCopia) plan.docs.push({ tabla: 'gf_nomina_params', negocio_id: orig, datos: pO, si_updated_at: npO.updated_at || null });
            plan.docs.push({ tabla: 'gf_nomina_params', negocio_id: dest, datos: pD, si_updated_at: npD ? (npD.updated_at || null) : null });
        }

        // ── 5) El resumen que se enseña ──
        POR_SUCURSAL.forEach(function (x) {
            if (x.opcion === 'conStaff' && !conStaff) return;
            var n = (mudan[x.t] || []).length;
            if (n) plan.resumen.push(modoCopia ? { mod: x.mod, lbl: x.lbl, copia: n } : { mod: x.mod, lbl: x.lbl, mueve: n });
        });
        HIJOS.forEach(function (h) { var n = (mudan[h.t] || []).length; if (n) plan.resumen.push(modoCopia ? { mod: h.mod, lbl: h.lbl, copia: n } : { mod: h.mod, lbl: h.lbl, mueve: n }); });
        if (menu) plan.resumen.push(modoCopia ? { mod: 'Administración', lbl: 'Carta pública (QR de las mesas)', copia: 1 } : { mod: 'Administración', lbl: 'Carta pública (QR de las mesas)', mueve: 1 });
        var nInsAsig = plan.insumos.filter(function (x) { return x.sucursales.length; }).length;
        var nRecAsig = plan.recetas.filter(function (x) { return x.sucursales.length; }).length;
        plan.resumen.push({ mod: 'Catálogo', lbl: 'Insumos', copia: plan.insumos.length,
            nota: nInsAsig + ' de la sucursal' + (plan.insumos.length - nInsAsig ? ' · ' + (plan.insumos.length - nInsAsig) + ' que usa sin tenerlos asignados' : '') });
        plan.resumen.push({ mod: 'Catálogo', lbl: 'Recetas y sub-recetas', copia: plan.recetas.length,
            nota: nRecAsig + ' de la sucursal' + (plan.recetas.length - nRecAsig ? ' · ' + (plan.recetas.length - nRecAsig) + ' que usa sin tenerlas asignadas' : '') });
        if (plan.fotos.length) plan.resumen.push({ mod: 'Evidencias', lbl: 'Fotos privadas', copia: plan.fotos.length, nota: 'se copian a la carpeta del negocio nuevo' });

        // ── 6) Lo que hay que saber ──
        avisos.push('Los QR impresos de esta sucursal (carta, entradas, portal del staff) hay que volver a generarlos desde el negocio nuevo.');
        if (modoCopia) {
            avisos.unshift('El negocio original NO se toca: la sucursal sigue ahí hasta que la elimines (y se puede restaurar).');
            if (plan.recopia) avisos.push('Ya había una copia de esta sucursal en el destino: se ACTUALIZA con lo de hoy (lo que se haya cambiado en la copia se reemplaza).');
            else avisos.push('Si la sucursal sigue trabajando en el original mientras revisas, vuelve a copiarla antes de eliminarla: la copia se actualiza.');
        } else avisos.push('Después de migrar, el dueño del negocio original debe recargar ETAAX en sus equipos para que la sucursal ya no le aparezca.');
        if (listaO.filter(function (s) { return s && s.id !== S && s.activa !== false; }).length === 0)
            avisos.push('El negocio original se queda sin sucursales activas además de la Matriz.');
        return plan;
    }

    /* Lo que viaja a la función SQL (sin el resumen para la pantalla). */
    function paraServidor(plan) {
        return {
            origen: plan.origen, destino: plan.destino, sucursal: plan.sucursal, sucursalNueva: plan.sucursalNueva,
            sucursalNombre: plan.sucursalNombre, tablas: plan.tablas, hijos: plan.hijos, docs: plan.docs,
            insumos: plan.insumos, recetas: plan.recetas, quitarInsumos: plan.quitarInsumos, quitarRecetas: plan.quitarRecetas,
            filas: plan.filas, remap: plan.remap,
            resumen: plan.resumen.map(function (r) { return { lbl: r.lbl, mueve: r.mueve || 0, copia: r.copia || 0 }; })
        };
    }

    /* ══ LEER LOS DATOS (con la sesión del admin) ════════════════════════════
       Página por página: Supabase devuelve 1000 renglones por consulta y un
       negocio con historia tiene más que eso en varias tablas. */
    async function leerTabla(sb, t, negId, cols) {
        var todo = [], desde = 0, PAG = 1000;
        for (;;) {
            var r = await sb.from(t).select(cols || '*').eq('negocio_id', negId).range(desde, desde + PAG - 1);
            if (r.error) throw new Error(t + ': ' + r.error.message);
            todo = todo.concat(r.data || []);
            if (!r.data || r.data.length < PAG) break;
            desde += PAG;
        }
        return todo;
    }
    async function leerDoc(sb, t, negId) {
        var r = await sb.from(t).select('datos,updated_at').eq('negocio_id', negId).maybeSingle();
        if (r.error) throw new Error(t + ': ' + r.error.message);
        return r.data || null;
    }
    async function cargar(sb, negocioOrigen, negocioDestino) {
        var tablasO = POR_SUCURSAL.map(function (x) { return x.t; }).concat(HIJOS.map(function (h) { return h.t; }), ['negocio_insumos', 'recetas', 'menu_publico']);
        var O = { negocio: negocioOrigen, tablas: {}, docs: {} }, D = { negocio: negocioDestino, tablas: {}, docs: {} };
        await Promise.all(tablasO.map(async function (t) { O.tablas[t] = await leerTabla(sb, t, negocioOrigen.id); }));
        await Promise.all(DOCS.map(async function (t) {
            O.docs[t] = await leerDoc(sb, t, negocioOrigen.id);
            D.docs[t] = await leerDoc(sb, t, negocioDestino.id);
        }));
        // Del destino basta saber qué insumos tiene y si ya opera (para llegar como Matriz).
        D.tablas.negocio_insumos = await leerTabla(sb, 'negocio_insumos', negocioDestino.id, 'insumo_id,datos');
        await Promise.all(POR_SUCURSAL.map(async function (x) {
            var r = await sb.from(x.t).select('id').eq('negocio_id', negocioDestino.id).limit(1);
            D.tablas[x.t] = (r.data || []).map(function (y) { return { id: y.id, datos: {} }; });
        }));
        return { origen: O, destino: D };
    }

    /* El respaldo que se descarga ANTES de migrar: todo lo que el plan toca,
       como estaba. Con esto se puede reconstruir a mano si algo saliera mal. */
    function respaldo(datos, plan) {
        var O = datos.origen, S = plan.sucursal, t = {};
        POR_SUCURSAL.concat(HIJOS).forEach(function (x) { t[x.t] = filas(O, x.t).filter(function (r) { return r.datos.sucursalId === S; }); });
        HIJOS.forEach(function (h) {
            var padres = {}; (t[h.padre] || []).forEach(function (r) { padres[r.id] = 1; });
            t[h.t] = filas(O, h.t).filter(function (r) { return padres[r.datos[h.campo]]; });
        });
        var qi = {}; plan.quitarInsumos.concat(plan.insumos.map(function (x) { return x.desde; })).forEach(function (i) { qi[i] = 1; });
        var qr = {}; plan.quitarRecetas.concat(plan.recetas.map(function (x) { return x.desde; })).forEach(function (i) { qr[i] = 1; });
        t.negocio_insumos = filas(O, 'negocio_insumos').filter(function (r) { return qi[r.insumo_id]; });
        t.recetas = filas(O, 'recetas').filter(function (r) { return qr[r.id]; });
        t.menu_publico = filas(O, 'menu_publico').filter(function (r) { return r.id === plan.origen + '|' + S; });
        return {
            _tipo: 'respaldo_migracion_sucursal_etaax', _version: 1, generado: new Date().toISOString(),
            plan: plan, origen: { negocio: O.negocio, tablas: t, docs: O.docs }, destino: { negocio: datos.destino.negocio, docs: datos.destino.docs }
        };
    }

    /* ══ EJECUTAR LA COPIA ══════════════════════════════════════════════════
       Desde el navegador, con la sesión del admin, por lotes. Copiar solo
       AGREGA y los ids nuevos son fijos (hash del destino): si se corta a la
       mitad, se vuelve a correr y termina donde se quedó, sin duplicar. La
       sucursal aparece en el destino al FINAL (su documento va al último), así
       que una copia a medias no se ve como sucursal. */
    function mismoInstante(a, b) {
        if (!a && !b) return true;
        if (!a || !b) return false;
        if (String(a) === String(b)) return true;
        return Date.parse(a) === Date.parse(b);
    }
    async function lotes(sb, t, rows, conflicto, avance, etiqueta) {
        var TAM = 100;
        for (var i = 0; i < rows.length; i += TAM) {
            avance(etiqueta, Math.min(i + TAM, rows.length), rows.length);
            var r = await sb.from(t).upsert(rows.slice(i, i + TAM), { onConflict: conflicto });
            if (r && r.error) throw new Error(etiqueta + ': ' + r.error.message);
        }
    }
    async function ejecutarCopia(sb, plan, avance) {
        avance = avance || function () {};
        if (!plan || plan.modo !== 'copia' || plan.bloqueos.length) throw new Error('El plan no es una copia lista para aplicar.');
        // 0) Los documentos del destino siguen como se revisaron.
        for (var i = 0; i < plan.docs.length; i++) {
            var d = plan.docs[i];
            var rv = await sb.from(d.tabla).select('updated_at').eq('negocio_id', d.negocio_id).maybeSingle();
            if (rv.error) throw new Error(d.tabla + ': ' + rv.error.message);
            if (!mismoInstante(rv.data ? rv.data.updated_at : null, d.si_updated_at))
                throw new Error('El negocio destino cambió mientras revisabas (' + d.tabla + '). Vuelve a revisar la copia.');
        }
        // 1) Fotos privadas a la carpeta del destino.
        for (var f = 0; f < plan.fotos.length; f++) {
            avance('Fotos de evidencia', f + 1, plan.fotos.length);
            var c = await sb.storage.from(plan.fotos[f].bucket).copy(plan.fotos[f].desde, plan.fotos[f].hacia);
            if (c && c.error && !/exist/i.test(c.error.message || '')) throw new Error('No se pudo copiar la foto «' + plan.fotos[f].desde + '»: ' + c.error.message);
        }
        // 2) Catálogo.
        await lotes(sb, 'negocio_insumos', plan.catalogoCopia.insumos.map(function (x) { return { negocio_id: plan.destino, insumo_id: x.insumo_id, datos: x.datos }; }),
            'negocio_id,insumo_id', avance, 'Insumos');
        await lotes(sb, 'recetas', plan.catalogoCopia.recetas.map(function (x) { return { id: x.id, negocio_id: plan.destino, datos: x.datos }; }),
            'id', avance, 'Recetas');
        // 3) Registros, tabla por tabla.
        var porTabla = {}, orden = [], cuenta = { insumos: plan.catalogoCopia.insumos.length, recetas: plan.catalogoCopia.recetas.length, fotos: plan.fotos.length };
        plan.filasCopia.forEach(function (x) { if (!porTabla[x.tabla]) { porTabla[x.tabla] = []; orden.push(x.tabla); } porTabla[x.tabla].push({ id: x.id, negocio_id: plan.destino, datos: x.datos }); });
        var LBL = {}; POR_SUCURSAL.concat(HIJOS).forEach(function (x) { LBL[x.t] = x.lbl; }); LBL.menu_publico = 'Carta pública';
        for (var o = 0; o < orden.length; o++) {
            await lotes(sb, orden[o], porTabla[orden[o]], 'id', avance, LBL[orden[o]] || orden[o]);
            cuenta[orden[o]] = porTabla[orden[o]].length;
        }
        // 4) Al final, los documentos: ahí aparece la sucursal en el destino.
        for (var k = 0; k < plan.docs.length; k++) {
            var dd = plan.docs[k];
            avance('Configuración de la sucursal', k + 1, plan.docs.length);
            var rd = await sb.from(dd.tabla).upsert({ negocio_id: dd.negocio_id, datos: dd.datos, updated_at: new Date().toISOString() }, { onConflict: 'negocio_id' });
            if (rd && rd.error) throw new Error(dd.tabla + ': ' + rd.error.message);
        }
        // 5) Bitácora (si falla, la copia ya quedó: no se revierte por esto).
        var id = 'cop_' + Date.now().toString(36) + '_' + hash(plan.destino + plan.sucursalNueva).slice(0, 4);
        try {
            await sb.from('admin_migraciones').insert({ id: id, datos: { tipo: 'copia', origen: plan.origen, destino: plan.destino, sucursal: plan.sucursal,
                sucursalNueva: plan.sucursalNueva, nombre: plan.sucursalNombre, cuenta: cuenta, recopia: plan.recopia, en: new Date().toISOString() } });
        } catch (e) {}
        return { ok: true, id: id, cuenta: cuenta };
    }

    root.MigSuc = {
        MATRIZ: MATRIZ, POR_SUCURSAL: POR_SUCURSAL, HIJOS: HIJOS, DEL_NEGOCIO: DEL_NEGOCIO, DOCS: DOCS,
        planear: planear, paraServidor: paraServidor, cargar: cargar, respaldo: respaldo, ejecutarCopia: ejecutarCopia,
        planearCopia: function (e) { return planear(Object.assign({}, e, { modo: 'copia' })); }, memb: memb,
        remapear: remapear, idRecetaNueva: idRecetaNueva, idHorario: idHorario, nombreNeg: nombreNeg
    };
})(typeof window !== 'undefined' ? window : globalThis);
