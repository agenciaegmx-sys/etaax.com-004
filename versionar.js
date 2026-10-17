#!/usr/bin/env node
/* ============================================================================
   ETAAX — PONERLE SU HUELLA A CADA ARCHIVO COMPARTIDO

   Netlify sirve el JS y el CSS con `stale-while-revalidate` de una semana: al
   publicar, el navegador puede quedarse con la copia anterior durante días
   mientras ya recibió el HTML nuevo. Por eso cada archivo compartido viaja con
   `?v=` — y por eso ese `?v=` tiene que CAMBIAR cuando el archivo cambia.

   Ponerlo a mano no funciona. Hoy costó dos diagnósticos equivocados: el aviso
   de novedades se arregló tres veces y el navegador seguía ejecutando el de
   ayer, porque iba sin versión en sus 42 páginas. Nadie relaciona nunca ese
   síntoma con esta causa.

   Aquí la versión es la HUELLA DEL CONTENIDO (ocho caracteres de su sha-256),
   así que no hay nada que recordar: si el archivo cambió, su huella cambió, y
   todas las páginas que lo piden se actualizan solas. Si no cambió, tampoco
   cambia la URL y la caché sigue sirviendo.

       node versionar.js            → reescribe las páginas
       node versionar.js --revisar  → solo dice si algo está desfasado

   El candado (suite BE18) comprueba lo mismo, así que un archivo cambiado sin
   su huella nueva no llega a producción.
   ============================================================================ */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const RAIZ = __dirname;

/* La capa compartida: lo que cargan varias páginas y cambia con el producto.
   No entra `app-movil/` (tiene su propio service worker) ni lo de un solo uso. */
const COMPARTIDOS = [
    'etaax-core.js', 'etaax-db.js', 'etaax-store.js', 'etaax-iconos.js', 'etaax-header.js',
    'etaax-sidebar.js', 'etaax-sidebar.css', 'etaax-modulos-ui.js', 'etaax-modulos-ui.css',
    'hub-modulos.js', 'hub-modulos.css', 'hub-paleta.css', 'hub-globales.css', 'hub-interacciones.js',
    'novedades.js', 'theme.js', 'ctx-bar.js', 'global-nav.js', 'financiero/nav.js',
    'security.js', 'page-guard.js', 'negocio-tab.js', 'embed.js', 'presencia.js', 'modal-drag.js',
    'modal-dock.js', 'precios.js', 'datos-pago.js', 'negocio-tipos.js', 'insumo-label.js',
    'reporte-marca.js', 'carta-tema.js', 'nav-pref.js', 'styles.css',
    'portal-operativo.css', 'portal-operativo.js', 'staff-area.js', 'recetas/inventarios.js', 'recetas/insumos.js',
    'administrativo/gastos-ui.css', 'administrativo/gastos-ui.js',
    'administrativo/cortes-ui.css', 'administrativo/cortes-ui.js'
].filter(f => fs.existsSync(path.join(RAIZ, f)));

const huella = (f) =>
    crypto.createHash('sha256').update(fs.readFileSync(path.join(RAIZ, f))).digest('hex').slice(0, 8);

function paginas(dir, out) {
    out = out || [];
    fs.readdirSync(path.join(RAIZ, dir) || RAIZ, { withFileTypes: true }).forEach(e => {
        const rel = dir ? dir + '/' + e.name : e.name;
        if (e.isDirectory()) {
            if (!['.git', 'node_modules', 'docs', 'iconos', 'marca', 'tests', 'guia', 'novedades'].includes(e.name)) paginas(rel, out);
        } else if (e.name.endsWith('.html')) out.push(rel);
    });
    return out;
}

const revisar = process.argv.includes('--revisar');
const esperado = {};
COMPARTIDOS.forEach(f => { esperado[f] = huella(f); });

/* La app instalada guarda su cáscara con las MISMAS URLs que su HTML. Si una
   versión cambia en la página y no en `sw.js`, el service worker se queda
   cacheando un archivo que ya nadie pide — y la app instalada se congela en la
   versión anterior hasta que alguien borre los datos del sitio. Nadie relaciona
   nunca ese síntoma con esta causa, así que el service worker entra aquí. */
const SW = 'app-movil/sw.js';
let tocadas = 0, desfasadas = [];
paginas('').concat(fs.existsSync(path.join(RAIZ, SW)) ? [SW] : []).forEach(rel => {
    const p = path.join(RAIZ, rel);
    let txt = fs.readFileSync(p, 'utf8'), antes = txt;
    COMPARTIDOS.forEach(f => {
        /* `/archivo.js`, `archivo.js`, `../archivo.js`: todas las formas en que
           las páginas lo piden, con o sin versión previa. */
        const esc = f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        /* En el HTML viaja como `src="…"`; en el service worker, como una cadena
           suelta dentro de su lista de cáscara. Las dos formas, una regla. */
        const re = rel === SW
            ? new RegExp("(['\"]\\.\\.\\/" + esc + ")(\\?[^'\"]*)?(['\"])", 'g')
            /* La comilla final se CAPTURA también en el HTML aunque siempre sea
               la misma: si una expresión tiene tres grupos y la otra dos, el
               cuarto argumento del reemplazo deja de ser la comilla y pasa a ser
               la POSICIÓN —un número— que se escribe tal cual dentro del
               atributo. Así quedó un `?v=f7366b4c14248>` que nadie entiende. */
            : new RegExp('((?:src|href)="(?:\\.\\.\\/|\\.\\/|\\/)?' + esc + ')(\\?[^"]*)?(")', 'g');
        txt = txt.replace(re, (m, inicio, q, comilla) => {
            if (q === '?v=' + esperado[f]) return m;
            desfasadas.push(rel + ' → ' + f);
            return inicio + '?v=' + esperado[f] + (comilla || '"');
        });
    });
    if (txt !== antes) { tocadas++; if (!revisar) fs.writeFileSync(p, txt); }
});

if (revisar) {
    if (desfasadas.length) {
        console.log('🚨 ' + desfasadas.length + ' referencias desfasadas en ' + tocadas + ' páginas:');
        [...new Set(desfasadas.map(d => d.split(' → ')[1]))].forEach(f => console.log('   · ' + f));
        process.exit(1);
    }
    console.log('✅ todas las páginas piden la versión vigente de cada compartido');
} else {
    console.log(tocadas ? '✅ ' + tocadas + ' páginas actualizadas (' +
        [...new Set(desfasadas.map(d => d.split(' → ')[1]))].length + ' archivos con huella nueva)'
        : '✅ nada que actualizar');
}
