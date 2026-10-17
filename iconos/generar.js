/* ============================================================================
   ETAAX — DE LOS .SVG DE LA CARPETA AL SPRITE DE LA APP

       node iconos/generar.js

   Edwin dibuja un icono y lo suelta aquí como `nombre.svg`. El nombre del
   archivo ES el nombre del icono. Esto lo normaliza y lo mete en
   /etaax-iconos.js, que es lo que cargan las pantallas.

   QUÉ NORMALIZA, Y POR QUÉ HACE FALTA

   Los exportadores de diseño (Affinity, Illustrator, Figma) no sacan el SVG
   limpio: lo envuelven. El primer icono llegó con el dibujo en un grid de 24
   —correcto— pero metido en un lienzo de 720 con una escala de 27.68 encima, y
   con los colores escritos a mano. Tres cosas, y las tres rompen algo:

     · EL LIENZO DE 720. No es grave por sí solo, pero la escala deja el dibujo
       con un margen que los demás iconos no tienen, y el grosor del trazo acaba
       siendo distinto EN PROPORCIÓN. Dos iconos juntos, uno más delgado que el
       otro, sin que nadie sepa por qué.
     · EL COLOR DEL TRAZO ESCRITO (#f0ece4). Un icono con su color fijo no puede
       ir sobre el botón verde: se queda crema sobre verde. El trazo tiene que
       HEREDAR el color del texto que lo rodea.
     · EL VERDE ESCRITO (#3dbe7a). Si el día de mañana cambia el verde de la
       marca, cambia en un token… y estos iconos se quedan con el viejo.

   CÓMO LO HACE, SIN TOCAR UN SOLO TRAZO

   No reescribe geometría —ahí es donde un script se come un icono—. Comprueba
   que la transformación sea solo escalar y mover (nada de rotar ni deformar) y
   que las coordenadas de dentro caigan en el grid de 24. Si es así, las envolturas
   sobran y se tiran. Si no, SE NIEGA y dice exactamente qué pasa: más vale no
   generar que generar un icono torcido.
   ============================================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const AQUI = __dirname;
const DESTINO = path.join(AQUI, '..', 'etaax-iconos.js');
const GRID = 24;

/* El crema y los acentos verde/cian, en las formas en que los escriben los
   exportadores. Lo que coincida se vuelve «hereda el color» o la clase verde. */
const CREMA = ['rgb(240,236,228)', '#f0ece4', '#F0ECE4', 'white', '#fff', '#ffffff'];
const VERDE = ['rgb(61,190,122)', '#3dbe7a', '#3DBE7A', 'rgb(140,228,238)', '#8ce4ee', '#8CE4EE'];

/* ── DOS FAMILIAS CON PREFIJO ──────────────────────────────────────────────
   `acceso/` y `sucursales/` agrupan por PANTALLA: sus nombres son únicos y van
   tal cual. Las dos de abajo agrupan por CONCEPTO, y sus nombres chocan —cedis
   está en las dos— así que llevan prefijo:

       modelos-negocio/  → el GIRO de una sucursal   (giro-bar, giro-cafeteria…)
       organizacion/     → el TIPO de negocio        (org-pyme, org-corporativo…)

   De `organizacion` se usa la variante 2, que es la que eligió Edwin; las 1 y 3
   son propuestas alternativas del mismo concepto y se ignoran.

   Y de las dos familias se lee solo `oscuro/`: el archivo claro es el MISMO
   dibujo con otro color de línea, y aquí el color se normaliza igual. Tomar los
   dos sería tener cada icono dos veces, con el riesgo de que un día difieran. */
var FAMILIAS = { 'modelos-negocio': 'giro', 'organizacion': 'org', 'header': 'hd', 'subheader': 'sh', 'modulos': 'mod', 'catalogos': 'cat', 'financieros': 'fin', 'administrativo': 'adm', 'cortes-caja': 'cor', 'nominas': 'nom', 'autorizacion': 'aut', 'gastos-fijos': 'fij', 'movimientos-caja': 'mov' };

function clasificar(rel) {
    var partes = rel.split(path.sep);
    var fam = FAMILIAS[partes[0]];
    if (!fam) return { usar: true, prefijo: '' };              // acceso/, sucursales/
    if (partes.indexOf('claro') > -1) return { usar: false };  // el mismo dibujo, otro color
    var base = path.basename(rel, '.svg');
    if (fam === 'org' && !/^etaax-2-/.test(base)) return { usar: false };   // solo la variante 2
    return { usar: true, prefijo: fam + '-' };
}

function nombreDe(archivo) {
    return path.basename(archivo, '.svg')
        .replace(/^etaax[ _-]*\d+[ _-]/, 'etaax-')     // "etaax-2-pyme" → "etaax-pyme"
        .normalize('NFD').replace(/[̀-ͯ]/g, '')   // sin acentos
        .toLowerCase()
        .replace(/^icono[ _-]*/, '')                        // "Icono asesor" → "asesor"
        .replace(/^etaax[ _-]*/, '')                        // "etaax-usuario" → "usuario"
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

/* La matriz neta de un elemento: el producto de los transform de sus padres.
   Solo se acepta escalar y mover; rotar o deformar se rechaza, porque entonces
   tirar las envolturas SÍ movería el dibujo. */
function matrizNeta(cadena) {
    let s = 1, tx = 0, ty = 0;
    const re = /(matrix|translate|scale)\(([^)]+)\)/g;
    let m;
    const ops = [];
    while ((m = re.exec(cadena))) ops.push([m[1], m[2].split(/[\s,]+/).map(Number)]);
    for (const [tipo, n] of ops) {
        if (tipo === 'matrix') {
            const [a, b, c, d, e, f] = n;
            if (Math.abs(b) > 1e-9 || Math.abs(c) > 1e-9) throw new Error('el icono viene rotado o deformado');
            if (Math.abs(a - d) > 1e-6) throw new Error('el icono viene estirado (escala distinta en X y Y)');
            tx += s * e; ty += s * f; s *= a;
        } else if (tipo === 'translate') {
            tx += s * (n[0] || 0); ty += s * (n[1] || 0);
        } else if (tipo === 'scale') {
            if (n[1] !== undefined && Math.abs(n[0] - n[1]) > 1e-6) throw new Error('el icono viene estirado');
            s *= n[0];
        }
    }
    return { s, tx, ty };
}

function limpiarEstilo(el, conservarGrosor) {
    /* `style="..."` y los atributos sueltos se tratan igual: lo que importa es
       el color que acabe aplicándose. */
    let clase = '';
    let out = el;
    for (const c of CREMA) {
        if (out.includes('stroke:' + c) || out.includes('stroke="' + c + '"')) {
            out = out.replace(new RegExp('stroke:\\s*' + c.replace(/[()#]/g, '\\$&') + ';?', 'g'), '')
                     .replace(new RegExp('stroke="' + c.replace(/[()#]/g, '\\$&') + '"', 'g'), '');
        }
    }
    for (const c of VERDE) {
        const esc = c.replace(/[()#]/g, '\\$&');
        if (new RegExp('fill:\\s*' + esc).test(out) || new RegExp('fill="' + esc + '"').test(out)) {
            clase = 'etx-punto';
            out = out.replace(new RegExp('fill:\\s*' + esc + ';?', 'g'), '')
                     .replace(new RegExp('fill="' + esc + '"', 'g'), '');
        }
        if (new RegExp('stroke:\\s*' + esc).test(out) || new RegExp('stroke="' + esc + '"').test(out)) {
            clase = 'etx-trazo';
            out = out.replace(new RegExp('stroke:\\s*' + esc + ';?', 'g'), '')
                     .replace(new RegExp('stroke="' + esc + '"', 'g'), '');
        }
    }
    /* `fill:none` y el grosor ya los pone la hoja del sprite: dejarlos aquí
       sería una segunda verdad sobre el mismo trazo. */
    out = out.replace(/fill:\s*none;?/g, '')
             .replace(/fill="none"/g, '');
    /* El grosor normalmente sobra —lo pone la hoja del sprite— salvo cuando el
       dibujo viaja escalado: ahí el 2.3 del archivo ya está en las unidades de
       su propio lienzo y quitarlo lo dejaría finísimo. */
    if (!conservarGrosor) {
        out = out.replace(/stroke-width:\s*[\d.]+px?;?/g, '')
                 .replace(/stroke-width="[\d.]+"/g, '');
    }
    out = out
             .replace(/fill-rule:\s*[a-z]+;?/g, '')
             .replace(/style="\s*"/g, '')
             .replace(/\s{2,}/g, ' ')
             .replace(/\s+\/>/, '/>');
    if (clase) out = out.replace(/^<(\w+)/, '<$1 class="' + clase + '"');
    return out;
}

/* Los <g transform> que envuelven el dibujo, tal cual, para poder reconstruir
   la envoltura cuando se conserva el lienzo del archivo. */
function pilaCompleta(crudo) {
    const re = /<g\b([^>]*)>/g;
    let m, abre = '', cierra = '';
    while ((m = re.exec(crudo))) {
        const tr = (m[1].match(/transform="([^"]*)"/) || [])[1];
        if (!tr) continue;
        abre += '<g transform="' + tr + '">';
        cierra += '</g>';
    }
    return { abre, cierra };
}

/* EL GROSOR NO ES UNO SOLO, Y ES A PROPÓSITO. Los iconos de la pantalla de
   acceso van a 2.3 y los de sucursales a 2: a tamaño chico el trazo grueso se
   empasta, y esas pantallas los usan a 18-20 px. Si se perdiera, media docena
   de iconos engordarían de golpe sin que nadie supiera por qué. */
function grosorRaiz(crudo) {
    const m = crudo.match(/<svg[^>]*stroke-width="([\d.]+)"/);
    return m ? m[1] : null;
}

function normalizar(archivo) {
    const crudo = fs.readFileSync(archivo, 'utf8');
    const nombre = nombreDe(archivo);

    /* Los elementos que dibujan, con el transform acumulado de sus padres. */
    const dibujables = [];
    const pila = [];
    const re = /<(g|path|circle|rect|line|polyline|polygon|ellipse)\b([^>]*?)(\/?)>|<\/g>/g;
    let m;
    while ((m = re.exec(crudo))) {
        if (m[0] === '</g>') { pila.pop(); continue; }
        const tag = m[1], attrs = m[2] || '', cerrado = m[3] === '/';
        const tr = (attrs.match(/transform="([^"]*)"/) || [])[1] || '';
        if (tag === 'g') { pila.push(tr); continue; }
        dibujables.push({ tag, attrs, cadena: pila.join(' ') + ' ' + tr, bruto: m[0], cerrado });
    }
    if (!dibujables.length) throw new Error('no tiene ningún trazo');

    /* ── EL CASO FÁCIL, Y EL MÁS COMÚN ──────────────────────────────────
       El archivo ya viene en 24×24 y sin envolturas: no hay nada que analizar
       ni que desenvolver. Se toma tal cual.

       Esto no es un atajo: la comprobación de abajo —«¿las coordenadas caen en
       el grid?»— suma los NÚMEROS de los trazos, y en un trazo relativo esos
       números son desplazamientos, no posiciones. Un `h18m-7-7` tiene un −7 que
       no está fuera de ningún lienzo: es «muévete siete a la izquierda». Por
       eso casi todos los iconos limpios caían al camino largo y perdían su
       grosor propio. */
    const vbArchivo = (crudo.match(/viewBox="([^"]+)"/) || [])[1] || '';
    const sinEnvoltura = !/<g\b[^>]*transform=/.test(crudo) && !/transform=/.test(crudo);
    if (vbArchivo.replace(/\s+/g, ' ').trim() === '0 0 ' + GRID + ' ' + GRID && sinEnvoltura) {
        const cuerpo = dibujables.map(d => {
            let el = d.bruto;
            if (!d.cerrado) el = el.replace(/>$/, '/>');
            return limpiarEstilo(el);
        }).join('');
        return { nombre, viewBox: '0 0 ' + GRID + ' ' + GRID, cuerpo, limpio: true,
                 grosor: grosorRaiz(crudo) };
    }

    /* ¿Se pueden tirar las envolturas sin mover el dibujo? Solo si todas las
       piezas comparten la misma escala y el mismo origen, y sin girar ni
       deformar. Esto YA NO ES UN REQUISITO: es solo la pregunta que decide si
       se puede dejar el símbolo limpio de 24 o si hay que conservar el lienzo
       del archivo. Un «no» aquí no rechaza nada. */
    let mismasPiezas = true;
    try {
        const netas = dibujables.map(d => matrizNeta(d.cadena));
        const base = netas[0];
        for (const n of netas) {
            if (Math.abs(n.s - base.s) > 1e-6 || Math.abs(n.tx - base.tx) > 1e-3 ||
                Math.abs(n.ty - base.ty) > 1e-3) { mismasPiezas = false; break; }
        }
    } catch (e) { mismasPiezas = false; }   // rotado, estirado: se conserva tal cual

    /* ¿Las coordenadas de dentro están ya en el grid de 24? Si lo están, las
       envolturas solo colocan el dibujo y se pueden tirar: queda un símbolo
       limpio de 24×24, idéntico en forma a los demás.

       Y SI NO LO ESTÁN, NO PASA NADA. Antes esto se negaba, y era una
       limitación mía disfrazada de regla: el lienzo donde dibuja Edwin —720 o
       el que sea— jamás llega al CSS, porque un SVG es vectorial y el símbolo
       se escala al tamaño que pida cada pantalla. Así que en ese caso se
       conserva el lienzo del archivo y sus transformaciones TAL CUAL, y el
       icono se ve exactamente como él lo dibujó, márgenes incluidos.

       Lo único que cambia entre un camino y el otro es de dónde sale el marco:
       del grid de 24 o del lienzo del archivo. Nada más. */
    const numeros = [];
    for (const d of dibujables) {
        const g = d.attrs.replace(/transform="[^"]*"/g, '').replace(/style="[^"]*"/g, '');
        (g.match(/-?\d+(\.\d+)?/g) || []).forEach(x => numeros.push(parseFloat(x)));
    }
    const min = Math.min.apply(null, numeros), max = Math.max.apply(null, numeros);
    const enGrid = mismasPiezas && numeros.length > 0 && min >= -1 && max <= GRID + 1;

    if (enGrid) {
        const cuerpo = dibujables.map(d => {
            let el = d.bruto.replace(/\s*transform="[^"]*"/g, '');
            if (!d.cerrado) el = el.replace(/>$/, '/>');
            return limpiarEstilo(el);
        }).join('');
        return { nombre, viewBox: '0 0 ' + GRID + ' ' + GRID, cuerpo, limpio: true,
                 grosor: grosorRaiz(crudo) };
    }

    /* El camino de respeto: su lienzo, sus transformaciones, solo sin colores
       escritos. El grosor del trazo se escala con el dibujo, así que se deja
       pasar (es el único caso en que `stroke-width` no sobra). */
    const vb = (crudo.match(/viewBox="([^"]+)"/) || [])[1];
    if (!vb) throw new Error('no declara viewBox, así que no se sabe de qué tamaño es su lienzo');
    const cuerpo = dibujables.map(d => {
        let el = d.bruto;
        if (!d.cerrado) el = el.replace(/>$/, '/>');
        return limpiarEstilo(el, true);
    }).join('');
    /* Hay que volver a abrir los grupos que envolvían: sin ellos las
       transformaciones de los padres se pierden y el dibujo se va de sitio. */
    const envoltura = pilaCompleta(crudo);
    return { nombre, viewBox: vb, cuerpo: envoltura.abre + cuerpo + envoltura.cierra,
             limpio: false, grosor: grosorRaiz(crudo) };
}

/* ── Se reescribe el bloque de símbolos del sprite ───────────────────────── */
/* Recursivo: Edwin los organiza por pantalla (acceso/, sucursales/) y esa
   separación significa algo —el mismo perfil tiene dos variantes de trazo—,
   así que se respeta la carpeta y se toma el nombre del archivo. */
function svgsDe(dir) {
    let out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) out = out.concat(svgsDe(full));
        else if (/\.svg$/i.test(e.name)) out.push(full);
    }
    return out.sort();
}
const archivos = svgsDe(AQUI).map(f => path.relative(AQUI, f));
if (!archivos.length) { console.log('No hay .svg en iconos/. Nada que hacer.'); process.exit(0); }

const nuevos = {};
const problemas = [];
for (const f of archivos) {
    const cl = clasificar(f);
    if (!cl.usar) continue;
    try {
        const r = normalizar(path.join(AQUI, f));
        r.nombre = cl.prefijo + r.nombre;
        if (nuevos[r.nombre]) { problemas.push('  ✗ ' + f + ' → ya hay otro icono llamado «' + r.nombre + '»'); continue; }
        nuevos[r.nombre] = r;
    }
    catch (e) { problemas.push('  ✗ ' + f + ' → ' + e.message); }
}
if (problemas.length) {
    console.log('\nEstos NO se pudieron usar:\n' + problemas.join('\n'));
    console.log('\nLas reglas, en corto: lienzo de 24×24, sin rotar, trazo sin color\n' +
                'escrito (lo hereda) y el detalle verde marcado como clase.\n');
}

let js = fs.readFileSync(DESTINO, 'utf8');
for (const nombre in nuevos) {
    const r = nuevos[nombre];
    /* El grosor propio viaja PEGADO al dibujo, en un envoltorio: así no depende
       de que la pantalla se acuerde de pedirlo. */
    const cuerpo = (r.grosor && r.grosor !== '2.3')
        ? '<g stroke-width="' + r.grosor + '">' + r.cuerpo + '</g>'
        : r.cuerpo;
    const linea = "        '" + nombre + "': ['" + r.viewBox + "', '" + cuerpo.replace(/'/g, "\\'") + "'],";
    const re = new RegExp("^ {8}'" + nombre + "': \\[.*$", 'm');
    if (re.test(js)) js = js.replace(re, linea);
    else js = js.replace(/(\n    };\n\n    var ID)/, '\n' + linea + '$1');
}
fs.writeFileSync(DESTINO, js);
console.log('\n✓ ' + Object.keys(nuevos).length + ' icono(s) de la carpeta en el sprite: ' +
            Object.keys(nuevos).sort().join(', '));
console.log('  (' + archivos.length + ' archivo(s) revisado(s))');
