/* ============================================================
   ETAAX - Insumos
   insumos.js · v2 — Importador por posición de fila
   ============================================================ */

   const UNIDADES     = ['ML','LT','G','KG','PZA','CARGA','PORCION'];
   const UNIDADES_REN = ['OZ','ML','LT','G','KG','PZA','PORCION','COPA'];
   const OZ_ML        = 29.5735;   // ml por onza líquida
   const COPA_ML      = 44.36;     // ml por copa estándar
   const _MXN         = '<span style="font-size:9px;letter-spacing:1px;color:var(--text-muted);font-weight:400;margin-left:4px">MXN</span>';
   
   // ── Helpers de sesión (mirror de app.js para páginas sin app.js) ──
   function getNegocioActivo() { return localStorage.getItem('etaax_negocio_activo') || ''; }
   function _sk(key) {
       var id = getNegocioActivo();
       return id ? ('etaax_' + id + '_' + key) : ('etaax_' + key);
   }
   function _skGet(key) {
       var k = _sk(key), raw = localStorage.getItem(k);
       if (raw !== null) return raw;
       var id = getNegocioActivo();
       if (!id) return null;
       var legacy = localStorage.getItem('etaax_' + key);
       if (legacy && legacy !== 'null') { localStorage.setItem(k, legacy); return legacy; }
       return null;
   }

   // ── localStorage ──────────────────────────────────────────────
   function getInsumos() {
       try { return JSON.parse(_skGet('insumos')) || []; }
       catch { return []; }
   }

   function setInsumos(data) {
       localStorage.setItem(_sk('insumos'), JSON.stringify(data));
   }
   
   function genId() {
       return Date.now().toString(36) + Math.random().toString(36).slice(2,5);
   }
   
   // ── Stats ─────────────────────────────────────────────────────
   function renderStats() {
       const insumos = getInsumos();
       const cats    = [...new Set(insumos.map(x => x.categoria).filter(Boolean))];
       const provs   = [...new Set(insumos.flatMap(x =>
           (x.presentaciones||[]).map(p => p.proveedor).filter(Boolean)
       ))];
       const totalPres = insumos.reduce((s,x) => s + (x.presentaciones||[]).length, 0);
   
       document.getElementById('statTotal').textContent = insumos.length;
       document.getElementById('statCats').textContent  = cats.length;
       document.getElementById('statPres').textContent  = totalPres;
       document.getElementById('statProvs').textContent = provs.length;
   }
   
   // ── Filtros ───────────────────────────────────────────────────
   function cargarFiltros() {
       const insumos  = getInsumos();
       const familias = [...new Set(insumos.map(x => x.familia).filter(Boolean))].sort();
       const cats     = [...new Set(insumos.map(x => x.categoria).filter(Boolean))].sort();
   
       const fFam = document.getElementById('filtroFamilia');
       const fCat = document.getElementById('filtroCategoria');
       const selFam = fFam.value;
       const selCat = fCat.value;
   
       fFam.innerHTML = '<option value="">Todas las familias</option>' +
           familias.map(f => `<option value="${f}" ${f===selFam?'selected':''}>${f}</option>`).join('');
       fCat.innerHTML = '<option value="">Todas las categorías</option>' +
           cats.map(c => `<option value="${c}" ${c===selCat?'selected':''}>${c}</option>`).join('');
   }
   
   // ── Toggle vista lista / cuadrícula ───────────────────────────
   var vistaInsumos = 'grid';

   function setVistaInsumos(modo) {
       vistaInsumos = modo;
       var contLista = document.getElementById('contenedorLista');
       var contGrid  = document.getElementById('contenedorGrid');
       var btnLista  = document.getElementById('btnVistaLista');
       var btnGrid   = document.getElementById('btnVistaGrid');
       if (modo === 'lista') {
           contLista.style.display = '';
           contGrid.style.display  = 'none';
           btnLista.style.background = 'var(--accent)';
           btnLista.style.color      = '#0f0e0c';
           btnGrid.style.background  = 'transparent';
           btnGrid.style.color       = 'var(--text-muted)';
       } else {
           contLista.style.display = 'none';
           contGrid.style.display  = '';
           btnGrid.style.background  = 'var(--accent)';
           btnGrid.style.color       = '#0f0e0c';
           btnLista.style.background = 'transparent';
           btnLista.style.color      = 'var(--text-muted)';
       }
       filtrar();
   }

   const _PG_SIZE = 100;
   let _paginaActual = 0;
   let _listaFiltrada = [];

   function filtrar() {
       const q   = document.getElementById('searchInput').value.toLowerCase();
       const fam = document.getElementById('filtroFamilia').value;
       const cat = document.getElementById('filtroCategoria').value;

       let lista = getInsumos();
       if (q)   lista = lista.filter(x =>
           x.nombre.toLowerCase().includes(q) ||
           (x.marca||'').toLowerCase().includes(q) ||
           (x.categoria||'').toLowerCase().includes(q)
       );
       if (fam) lista = lista.filter(x => x.familia === fam);
       if (cat) lista = lista.filter(x => x.categoria === cat);

       _listaFiltrada = lista;
       _paginaActual  = 0;
       _renderPagina();
   }

   function _renderPagina() {
       const lista    = _listaFiltrada;
       const total    = lista.length;
       const totalPgs = Math.max(1, Math.ceil(total / _PG_SIZE));
       const desde    = _paginaActual * _PG_SIZE;
       const pagina   = lista.slice(desde, desde + _PG_SIZE);

       if (vistaInsumos === 'grid') {
           renderGrid(pagina);
       } else {
           renderTabla(pagina);
       }
       document.getElementById('countLabel').textContent = `${total} insumos`;
       _renderPaginacion(totalPgs);
   }

   function _renderPaginacion(totalPgs) {
       var bar = document.getElementById('pgBar');
       if (!bar) return;
       if (totalPgs <= 1) { bar.innerHTML = ''; return; }
       var prev = _paginaActual > 0
           ? `<button onclick="_irPagina(${_paginaActual-1})" style="background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:5px 14px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:12px">← Anterior</button>`
           : `<button disabled style="background:transparent;border:1px solid var(--border);color:var(--text-dim);padding:5px 14px;border-radius:6px;font-family:inherit;font-size:12px;opacity:.35;cursor:default">← Anterior</button>`;
       var next = _paginaActual < totalPgs - 1
           ? `<button onclick="_irPagina(${_paginaActual+1})" style="background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:5px 14px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:12px">Siguiente →</button>`
           : `<button disabled style="background:transparent;border:1px solid var(--border);color:var(--text-dim);padding:5px 14px;border-radius:6px;font-family:inherit;font-size:12px;opacity:.35;cursor:default">Siguiente →</button>`;
       bar.innerHTML = prev
           + `<span style="font-size:12px;color:var(--text-muted)">Página ${_paginaActual+1} de ${totalPgs}</span>`
           + next;
   }

   function _irPagina(n) {
       _paginaActual = n;
       _renderPagina();
       var cont = document.getElementById('contenedorTabla') || document.getElementById('contenedorGrid');
       if (cont) cont.scrollTop = 0;
   }

   // ── Tabla ─────────────────────────────────────────────────────
   function renderTabla(lista) {
       const tbody = document.getElementById('tbodyInsumos');
       const empty = document.getElementById('emptyState');
   
       if (!lista.length) {
           tbody.innerHTML = '';
           empty.style.display = 'block';
           return;
       }
       empty.style.display = 'none';
   
       tbody.innerHTML = lista.map(ins => {
           const pres = ins.presentaciones || [];
           const p0   = pres[0];

           // Costo base: precio por presentación de compra (ej. $346.00 / 700 ML)
           let costo = '—';
           if (p0) {
               const precio = parseFloat(p0.precio) || 0;
               const cont   = p0.contNeto || '';
               const um     = p0.umContenido || '';
               if (precio > 0 && cont) {
                   costo = `$${precio.toFixed(2)} / ${cont} ${um}`;
               } else if (precio > 0) {
                   costo = `$${precio.toFixed(2)}`;
               } else if (p0.costoUnitario) {
                   costo = `$${(+p0.costoUnitario).toFixed(2)} / ${p0.umCosto||'LT'}`;
               }
           }
           const prov = p0?.proveedor || '—';
   
           return `<tr>
               <td>
                   <div style="display:flex;align-items:center;gap:10px">
                       ${ins.foto
                           ? `<img src="${ins.foto}" style="width:36px;height:36px;border-radius:6px;object-fit:cover;border:1px solid var(--border)">`
                           : `<div style="width:36px;height:36px;border-radius:6px;background:var(--surface2);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:16px">📦</div>`
                       }
                       <div>
                           <div style="font-weight:500">${ins.nombre} ${ins.variedad ? '<span style="font-weight:400;color:var(--text-muted)">'+ins.variedad+'</span>' : ''}</div>
                           <div style="font-size:11px;color:var(--text-dim)">${ins.marca||''} ${ins.maduracion ? '· '+ins.maduracion : ''}</div>
                       </div>
                   </div>
               </td>
               <td style="color:var(--text-muted)">${ins.categoria||''} ${ins.subcategoria ? '· '+ins.subcategoria : ''}</td>
               <td style="white-space:nowrap">
                   ${pres.map(p =>
                       `<span class="pill pill-amber" style="margin:2px;font-size:9px;white-space:nowrap">${p.contNeto} ${p.umContenido} · ${p.rendimiento||'—'} ${p.umRendimiento||''}</span>`
                   ).join('')}
               </td>
               <td style="color:var(--green);font-weight:500;white-space:nowrap">${costo}</td>
               <td style="color:var(--text-muted)">${prov}</td>
               <td style="text-align:right;white-space:nowrap">
                   <button class="btn-vista" style="padding:6px 14px;font-size:12px;margin-right:6px;
                       display:inline-flex;align-items:center;gap:5px"
                       onclick="verFicha('${ins.id}')">
                       <span style="font-size:14px">👁️</span> Ver
                   </button>
                   <button class="btn-vista" style="padding:6px 14px;font-size:12px;margin-right:6px;
                       color:var(--accent);border-color:var(--accent);
                       display:inline-flex;align-items:center;gap:5px"
                       onclick="editarInsumo('${ins.id}')">
                       <span style="font-size:14px">✏️</span> Editar
                   </button>
                   <button class="btn-vista" style="padding:6px 12px;font-size:12px;
                       color:var(--red);border-color:var(--red);
                       display:inline-flex;align-items:center;justify-content:center"
                       onclick="eliminarInsumo('${ins.id}')">
                       <span style="font-size:14px">🗑️</span>
                   </button>
               </td>
           </tr>`;
       }).join('');
   }

   // ── Cuadrícula ────────────────────────────────────────────────
   function renderGrid(lista) {
       var grid  = document.getElementById('gridInsumos');
       var empty = document.getElementById('emptyStateGrid');

       if (!lista.length) {
           grid.innerHTML = '';
           empty.style.display = 'block';
           return;
       }
       empty.style.display = 'none';

       var tipoEmojis = {
           destilado:'🥃', vino:'🍷', refresco:'🥤', cerveza:'🍺',
           destilado:'🥃', licor:'🍹', vino:'🍷', refresco:'🥤', cerveza:'🍺', cerveza_barril:'🛢️',
       };

       grid.innerHTML = lista.map(function(ins) {
           var pres  = ins.presentaciones || [];
           var p0    = pres[0];
           var emoji = tipoEmojis[ins.tipoInsumo] || '📦';

           var costo = '—';
           if (p0) {
               var precio = parseFloat(p0.precio) || 0;
               var cont   = p0.contNeto || '';
               var um     = p0.umContenido || '';
               if (precio > 0 && cont)    costo = '$' + precio.toFixed(2) + ' / ' + cont + ' ' + um;
               else if (precio > 0)       costo = '$' + precio.toFixed(2);
               else if (p0.costoUnitario) costo = '$' + (+p0.costoUnitario).toFixed(2) + ' / ' + (p0.umCosto||'LT');
           }

           var prov    = (p0 && p0.proveedor) ? p0.proveedor : '';
           var variedad = [ins.marca, ins.variedad].filter(Boolean).join(' · ');
           var cat      = [ins.categoria, ins.subcategoria].filter(Boolean).join(' · ');
           var nPres    = pres.length;

           var fotoHTML = ins.foto
               ? '<img src="' + ins.foto + '" alt="">'
               : '<span class="card-emoji">' + emoji + '</span>';

           var tipoBadge = ins.categoria
               ? '<div class="insumo-card-tipo-badge">' + ins.familia + '</div>'
               : '';

           var presChips = pres.slice(0,3).map(function(p) {
               return '<span class="pill pill-amber" style="font-size:9px;white-space:nowrap">' +
                   (p.contNeto||'') + ' ' + (p.umContenido||'') + '</span>';
           }).join('');
           if (nPres > 3) presChips += '<span style="font-size:9px;color:var(--text-dim)">+' + (nPres-3) + '</span>';

           return '<div class="insumo-card">' +
               '<div class="insumo-card-foto">' +
                   fotoHTML +
                   tipoBadge +
               '</div>' +
               '<div class="insumo-card-body">' +
                   '<div class="insumo-card-nombre" title="' + ins.nombre + '">' + ins.nombre + '</div>' +
                   (variedad ? '<div class="insumo-card-variedad">' + variedad + '</div>' : '') +
                   (cat ? '<div class="insumo-card-cat">' + cat + '</div>' : '') +
                   '<div class="insumo-card-costo">' + costo + '</div>' +
                   (prov ? '<div class="insumo-card-prov">📍 ' + prov + '</div>' : '') +
                   (presChips ? '<div class="insumo-card-pres">' + presChips + '</div>' : '') +
               '</div>' +
               '<div class="insumo-card-actions">' +
                   '<button class="btn-ver" onclick="verFicha(\'' + ins.id + '\')">👁️ Ver</button>' +
                   '<button class="btn-edit" onclick="editarInsumo(\'' + ins.id + '\')">✏️ Editar</button>' +
                   '<button class="btn-del" onclick="eliminarInsumo(\'' + ins.id + '\')">🗑️</button>' +
               '</div>' +
           '</div>';
       }).join('');
   }

   // ── Modal insumo ──────────────────────────────────────────────
   let editandoId = null;
   let presentacionesTemp = [];
   let fotoInsumoBase64 = '';
   
   // ── Tipo de insumo activo ────────────────────────────────────
   let tipoInsumoActual = 'destilado';
   
   const SUBCATS_DESTILADO = [
       '— Seleccionar —',
       'Tequila', 'Mezcal', 'Ron', 'Vodka', 'Ginebra',
       'Whiskey (Escocés)', 'Whiskey (Irlandés)', 'Whiskey (Japonés)',
       'Bourbon / Whiskey Americano',
       'Brandy', 'Cognac', 'Pisco',
       'Sotol', 'Bacanora', 'Raicilla'
   ];

   const SUBCATS_LICOR = [
       '— Seleccionar —',
       'Aperitivo', 'Bitter', 'Vermouth', 'Vino Fortificado',
       'Licor de Frutas', 'Licor de Cítricos', 'Licor de Hierbas', 'Licor de Especias',
       'Licor Botánico', 'Licor de Semillas', 'Licor de Frutos Secos',
       'Licor de Café', 'Licor de Cacao',
       'Crema', 'Crema Irlandesa',
       'Anís', 'Sambuca', 'Absenta',
       'Triple Sec', 'Curacao',
       'Otros Licores'
   ];

   var CATS_REFRESCO = [
       'Refrescos / Sodas',
       'Jugos y Néctares',
       'Aguas',
       'Energizantes',
       'Jarabes y Siropes',
   ];

   var GRUPOS_ABARROTE = [
       '— Seleccionar grupo —',
       'Secos y Semillas',
       'Enlatados y Conservas',
       'Aceites y Grasas',
       'Lácteos',
       'Huevo y Proteínas',
       'Especias y Condimentos',
       'Líquidos y Mezcladores',
       'Panadería y Repostería',
   ];

   const TIPO_CONFIG = {
       destilado: { label:'Destilado',       icon:'🥃', familia:'Bebidas', categoria:'Destilados',
           campos: ['contenido','rendimiento','peso','proveedor','costeo','copa','precioManual','presentacionCompra'] },
       licor:     { label:'Licor',           icon:'🍹', familia:'Bebidas', categoria:'Licores',
           campos: ['contenido','rendimiento','peso','proveedor','costeo','copa','precioManual','presentacionCompra'] },
       vino:      { label:'Vinos de mesa', icon:'🍷', familia:'Bebidas', categoria:'Vinos',
           campos: ['contenido','rendimiento','peso','proveedor','costeo','copa','precioManual','presentacionCompra'] },
       refresco:  { label:'Refrescos, sodas, jugos...', icon:'🧃', familia:'Bebidas', categoria:'',
           campos: ['contenido','rendimiento','proveedor','costeo','precioManual','presentacionCompra'] },
       cerveza:   { label:'Cerveza',           icon:'🍺', familia:'Bebidas', categoria:'Cervezas',
           campos: ['contenido','rendimiento','proveedor','costeo','precioManual','presentacionCompra'] },
       cerveza_barril: { label:'Cerveza de barril', icon:'🛢️', familia:'Bebidas', categoria:'Cervezas',
           campos: ['contenido','rendimiento','proveedor','costeo','precioManual','presentacionCompra'] },
       abarrote:  { label:'Abarrotes y más',   icon:'🧂', familia:'Abarrotes', categoria:'',
           campos: ['contenido','rendimiento','proveedor','costeo','presentacionCompra'] },
       carne:     { label:'Proteínas',           icon:'🥩', familia:'Proteínas', categoria:'',
           campos: ['pesoCompra','proveedor','costeo','presentacionCompra'] },
       fruta:     { label:'Fruta y Verdura',   icon:'🥬', familia:'Frutas y Verduras', categoria:'',
           campos: ['pesoCompra','proveedor','costeo','presentacionCompra'] },
       otro:      { label:'Otro',              icon:'📦', familia:'', categoria:'',
           campos: ['contenido','proveedor','costeo','presentacionCompra'] },
   };
   
   // ── Listas para vinos ────────────────────────────────────────
   var TIPOS_VINO = [
       'Vino Tinto',
       'Vino Blanco',
       'Vino Rosado',
       'Vino Espumoso / Cava / Champagne',
       'Vino Naranja (Orange Wine)',
       'Vino Dulce / De Postre (Late Harvest, Ice Wine)',
       'Vino Generoso / Fortificado (Oporto, Jerez)',
       'Vino Sin Alcohol / Desalcoholizado'
   ];

   var UVAS_VINO = [
       'Cabernet Sauvignon','Merlot','Syrah / Shiraz','Pinot Noir','Malbec',
       'Tempranillo','Nebbiolo','Carmenère','Sangiovese','Zinfandel',
       'Garnacha / Grenache','Cabernet Franc','Petit Verdot',
       'Chardonnay','Sauvignon Blanc','Chenin Blanc','Riesling',
       'Pinot Grigio / Pinot Gris','Albariño','Moscato / Moscatel',
       'Macabeo','Verdejo',
       'Ensamble Tinto (Blend)','Ensamble Blanco (Blend)','Sin Especificar / Vino de Casa'
   ];

   var TEMPS_VINO = [
       '4°C a 8°C (Refrigeración Profunda / Espumosos y Dulces)',
       '8°C a 12°C (Cava Fría / Blancos y Rosados)',
       '13°C a 15°C (Cava Templada / Tintos Jóvenes y Ligeros)',
       '16°C a 18°C (Cava Clásica / Tintos de Crianza, Reserva y Gran Reserva)',
       '19°C a 22°C (Temperatura Ambiente Controlada / Almacén)'
   ];

   // ── Listas para proteínas ────────────────────────────────────
   var CATS_PROTEINA = ['— Seleccionar —','Res','Cerdo','Pollo','Pescado','Marisco','Molusco','Ave','Caza'];
   var ESTADOS_PROTEINA = [
       'Fresco / Refrigerado (0°C a 4°C)',
       'Congelado (-18°C o menos)',
       'IQF — Congelado Individual (-18°C)'
   ];
   var TEMPS_PROTEINA = [
       '0°C a 4°C (Refrigeración — Frescos)',
       '-18°C o menos (Congelación profunda)',
       '-25°C a -30°C (Ultracongelación / IQF)'
   ];

   // ── Listas para frutas y verduras ────────────────────────────
   var CATS_FRUTA = [
       '— Seleccionar —',
       'Fruta tropical','Fruta de temporada','Fruta cítrica','Fruta seca / deshidratada',
       'Verdura de hoja verde','Verdura de raíz','Verdura crucífera',
       'Allium (cebolla, ajo, poro)','Legumbre fresca','Hierba aromática / Quelite',
       'Hongo / Seta','Tubérculo','Germinado / Microgreen','Flor comestible'
   ];
   var TIPOS_COMPRA_FRUTA = [
       '— Seleccionar —',
       'A granel — por kg (peso exacto)',
       'Por pieza (peso variable)',
       'Por manojo / atado (peso variable)',
       'Por caja o cubeta',
       'Por bolsa o red (peso aprox.)',
       'Por charola o bandeja'
   ];
   var ALMACENAJE_FRUTA = [
       'Refrigeración 0°C a 4°C (hoja verde, hierbas, setas)',
       'Refrigeración 4°C a 8°C (cítricos, crucíferas, raíces)',
       'Temperatura fresca 8°C a 12°C (tomate maduro, aguacate abierto)',
       'Temperatura ambiente 15°C a 20°C (plátano, aguacate verde, mango verde)',
       'Oscuridad seca — bodega (papa, cebolla, ajo)',
       'Sumergida en agua fría (hierbas frescas, flores comestibles)'
   ];

   function toggleUvaChip(uva) {
       var hidden = document.getElementById('ins-variedad');
       if (!hidden) return;
       var vals = hidden.value ? hidden.value.split(',').map(function(s){return s.trim();}).filter(Boolean) : [];
       var idx = vals.indexOf(uva);
       if (idx >= 0) vals.splice(idx, 1); else vals.push(uva);
       hidden.value = vals.join(', ');
       modalDirty = true;
       document.querySelectorAll('#uva-picker .uva-chip').forEach(function(c) {
           c.classList.toggle('active', vals.includes(c.dataset.uva));
       });
   }

   // ── Ajustar campos del modal según tipo de insumo ────────────
   var FAMILIA_POR_TIPO = {
       destilado: 'Bebidas', licor: 'Bebidas', vino: 'Bebidas', cerveza: 'Bebidas', cerveza_barril: 'Bebidas', refresco: 'Bebidas',
       carne: 'Proteínas', fruta: 'Frutas y Verduras', abarrote: 'Abarrotes', otro: ''
   };

   function ajustarCamposPorTipo(tipo) {
       var SEL = 'width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:9px 10px;border-radius:6px;font-family:sans-serif;font-size:14px;outline:none';

       // Reset order, spans y visibilidad de empaque (limpio antes de aplicar carne)
       ['row-nombre','row-familia','row-categoria','row-marca','row-variedad',
        'row-maduracion','row-temp-conservacion','row-vida-util-abrir','row-subcategoria','row-empaque']
           .forEach(function(id) {
               var el = document.getElementById(id);
               if (el) el.style.order = '';
           });
       var _rvag = document.getElementById('row-vida-util-abrir');
       var _rsag = document.getElementById('row-subcategoria');
       if (_rvag) _rvag.style.gridColumn = '';
       if (_rsag) _rsag.style.gridColumn = '';
       var _remp = document.getElementById('row-empaque');
       if (_remp) _remp.style.display = '';

       // Reset filas exclusivas de frutas
       var _rcong = document.getElementById('row-como-congelar');
       var _rvidc = document.getElementById('row-vida-congelado');
       if (_rcong) { _rcong.style.display = 'none'; _rcong.style.gridColumn = ''; _rcong.style.order = ''; }
       if (_rvidc) { _rvidc.style.display = 'none'; _rvidc.style.gridColumn = ''; _rvidc.style.order = ''; }

       // Auto-rellenar familia
       var elFam = document.getElementById('ins-familia');
       if (elFam && !elFam.value) elFam.value = FAMILIA_POR_TIPO[tipo] || '';

       // Marca base
       var rowMarca = document.getElementById('row-marca');
       if (rowMarca) {
        var ocultarMarca = ['destilado','licor','cerveza','cerveza_barril','refresco','abarrote'].includes(tipo);
           rowMarca.style.display = ocultarMarca ? 'none' : '';
           var lblMarca = rowMarca.querySelector('label');
           if (lblMarca) lblMarca.textContent = tipo === 'vino' ? 'Bodega / Productor' : tipo === 'carne' ? 'Marca / Empacador' : 'Marca base';
           var elMarca = document.getElementById('ins-marca');
           if (elMarca) elMarca.placeholder = tipo === 'vino' ? 'Ej. Casillero del Diablo, Zuccardi' : tipo === 'carne' ? 'Ej. La Superior, Don Jorge, Rancho Campestre' : 'Ej. La Costeña';
       }

       // ── Variedad / Tipo de uva (ins-variedad) ──────────────────
       var varEl = document.getElementById('ins-variedad');
       var varWrap = varEl ? varEl.closest('.meta-item') : null;
       if (varWrap) {
           var currentVar = varEl.value || '';
           if (tipo === 'vino') {
               varWrap.style.gridColumn = 'span 2';
               var selUvas = currentVar ? currentVar.split(',').map(function(s){return s.trim();}).filter(Boolean) : [];
               var chips = UVAS_VINO.map(function(u) {
                   var esc = u.replace(/'/g, "\\'");
                   return '<div class="uva-chip' + (selUvas.includes(u) ? ' active' : '') + '" ' +
                       'data-uva="' + u + '" onclick="toggleUvaChip(\'' + esc + '\')">' + u + '</div>';
               }).join('');
               varWrap.innerHTML = '<label id="lbl-variedad" style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--text-dim);display:block;margin-bottom:4px">'
                   + 'Tipo de uva <span style="opacity:.5;font-weight:400">(selección múltiple)</span></label>'
                   + '<div id="uva-picker" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;'
                   + 'max-height:150px;overflow-y:auto;padding:6px 2px;border-top:1px solid var(--border)">'
                   + chips + '<input type="hidden" id="ins-variedad" value="' + currentVar + '"></div>';
           } else {
               varWrap.style.gridColumn = '';
               if (document.getElementById('uva-picker')) {
                   varWrap.innerHTML = '<label id="lbl-variedad">Marca del producto</label>'
                       + '<input type="text" id="ins-variedad" value="' + currentVar + '" placeholder="Ej. Absolut">';
               }
               var lblV = document.getElementById('lbl-variedad');
               if (lblV) {
                   if (['destilado','licor','cerveza','cerveza_barril','refresco'].includes(tipo)) lblV.textContent = 'Marca del producto';
                   else if (tipo === 'abarrote') lblV.textContent = 'Marca / Variedad';
                   else if (tipo === 'carne') lblV.textContent = 'Corte / Variedad';
                   else if (tipo === 'fruta') lblV.textContent = 'Variedad comercial';
                   else lblV.textContent = 'Variedad';
               }
           }
       }

       // ── Añejamiento / Tipo de vino / Tipo de compra (ins-maduracion) ──
       var rowMad = document.getElementById('row-maduracion');
       if (rowMad) {
        rowMad.style.display = ['destilado','licor','vino','refresco','cerveza','cerveza_barril','carne','fruta'].includes(tipo) ? '' : 'none';
           var madEl = document.getElementById('ins-maduracion');
           var currentMad = madEl ? madEl.value || '' : '';
           if (tipo === 'vino') {
               rowMad.innerHTML = '<label id="lbl-maduracion">Añejamiento</label>' +
                   '<input type="text" id="ins-maduracion" value="' + currentMad + '" ' +
                   'placeholder="Ej. 10 años en roble, Reserva, Crianza, Sin roble">';
           } else if (tipo === 'refresco') {
               if (madEl && madEl.tagName === 'SELECT') {
                   rowMad.innerHTML = '<label id="lbl-maduracion">Sabor / Variedad</label>' +
                       '<input type="text" id="ins-maduracion" value="' + currentMad + '" ' +
                       'placeholder="Ej. Original, Light, Zero, Sin Azúcar">';
               } else if (madEl) {
                   var lblMadR = document.getElementById('lbl-maduracion');
                   if (lblMadR) lblMadR.textContent = 'Sabor / Variedad';
                   madEl.placeholder = 'Ej. Original, Light, Zero, Sin Azúcar';
               }
           } else if (['cerveza','cerveza_barril'].includes(tipo)) {
               if (madEl && madEl.tagName === 'SELECT') {
                   rowMad.innerHTML = '<label id="lbl-maduracion">Estilo / Variedad</label>' +
                       '<input type="text" id="ins-maduracion" value="' + currentMad + '" ' +
                       'placeholder="Ej. Clara, Oscura, Stout, IPA, Weizen, Artesanal">';
               } else if (madEl) {
                   var lblMadC = document.getElementById('lbl-maduracion');
                   if (lblMadC) lblMadC.textContent = 'Estilo / Variedad';
                   madEl.placeholder = 'Ej. Clara, Oscura, Stout, IPA, Weizen, Artesanal';
               }
           } else if (tipo === 'carne') {
               var currentMadC = madEl ? madEl.value || '' : '';
               var optEst = ESTADOS_PROTEINA.map(function(t) {
                   return '<option value="' + t + '"' + (currentMadC === t ? ' selected' : '') + '>' + t + '</option>';
               }).join('');
               rowMad.innerHTML = '<label id="lbl-maduracion">Estado de compra</label>' +
                   '<select id="ins-maduracion" style="' + SEL + '">' +
                   '<option value="">— Seleccionar estado —</option>' + optEst + '</select>';
           } else if (tipo === 'fruta') {
               var currentMadF = madEl ? madEl.value || '' : '';
               var optCompraF = TIPOS_COMPRA_FRUTA.map(function(t) {
                   var val = t === '— Seleccionar —' ? '' : t;
                   return '<option value="' + val + '"' + (currentMadF === val ? ' selected' : '') + '>' + t + '</option>';
               }).join('');
               rowMad.innerHTML = '<label id="lbl-maduracion">Tipo de compra</label>' +
                   '<select id="ins-maduracion" style="' + SEL + '">' + optCompraF + '</select>';
           } else {
               if (madEl && madEl.tagName === 'SELECT') {
                   rowMad.innerHTML = '<label id="lbl-maduracion">Variedad / Añejamiento</label>' +
                       '<input type="text" id="ins-maduracion" value="' + currentMad + '" ' +
                       'placeholder="Ej. Reposado, Original, 12 años...">';
               } else if (madEl) {
                   var lblMad = document.getElementById('lbl-maduracion');
                   if (lblMad) lblMad.textContent = 'Variedad / Añejamiento';
               }
           }
       }

       // ── Placeholders ────────────────────────────────────────────
       var elNombre  = document.getElementById('ins-nombre');
       var elEmpaque = document.getElementById('ins-empaque');
       var elMad2    = document.getElementById('ins-maduracion');
       var elVar2    = document.getElementById('ins-variedad');
       if (tipo === 'licor') {
           if (elVar2 && elVar2.type !== 'hidden') elVar2.placeholder = 'Ej. Baileys, Aperol, Licor 43, Kahlúa';
           if (elNombre)  elNombre.placeholder  = 'Ej. Original Irish Cream, Licor de Café, Bitter';
           if (elMad2 && elMad2.tagName !== 'SELECT') elMad2.placeholder = 'Ej. Original, Menta, Rosso, Seco';
           if (elEmpaque) elEmpaque.placeholder = 'Ej. Botella de vidrio, Garrafa, Lata';
       } else if (tipo === 'destilado') {
           if (elVar2 && elVar2.type !== 'hidden') elVar2.placeholder = "Ej. Absolut, Jack Daniel's, Patrón";
           if (elNombre)  elNombre.placeholder  = 'Ej. Vodka Absolut, Tequila Patrón';
           if (elMad2 && elMad2.tagName !== 'SELECT') elMad2.placeholder = 'Ej. Reposado, Original, 12 años...';
           if (elEmpaque) elEmpaque.placeholder = 'Ej. Botella vidrio, Garrafa, Lata';
       } else if (tipo === 'vino') {
           if (elNombre)  elNombre.placeholder  = 'Ej. Casillero del Diablo, Don Melchor, Zuccardi';
           if (elEmpaque) elEmpaque.placeholder = 'Ej. Vidrio, Tetrapack, Bag in Box, Magnum';
       } else if (tipo === 'refresco') {
           if (elVar2 && elVar2.type !== 'hidden') elVar2.placeholder = 'Ej. Coca-Cola, Jarritos, Sidral Mundet';
           if (elNombre)  elNombre.placeholder  = 'Ej. Coca, Fanta, Sprite, Naranjada';
           if (elEmpaque) elEmpaque.placeholder = 'Ej. Lata 355ml, PET 600ml, Vidrio 355ml';
       } else if (tipo === 'cerveza') {
           if (elVar2 && elVar2.type !== 'hidden') elVar2.placeholder = 'Ej. Corona, Modelo, Heineken, Pacifico, Artesanal';
           if (elNombre)  elNombre.placeholder  = 'Ej. Corona Extra, Modelo Especial, Bohemia Oscura';
           if (elEmpaque) elEmpaque.placeholder = 'Ej. Botella 355ml, Lata 355ml, Caguama 940ml';
       } else if (tipo === 'cerveza_barril') {
           if (elVar2 && elVar2.type !== 'hidden') elVar2.placeholder = 'Ej. Corona, Modelo, Heineken, Artesanal';
           if (elNombre)  elNombre.placeholder  = 'Ej. Corona Extra de barril, Modelo de grifo';
           if (elEmpaque) elEmpaque.placeholder = 'Ej. Barril 20L, Tina 50L, Barril americano 58.7L';
       } else if (tipo === 'abarrote') {
           if (elVar2 && elVar2.type !== 'hidden') elVar2.placeholder = 'Ej. Del Monte, La Costeña, Herdez, Lala, Nestlé';
           if (elNombre)  elNombre.placeholder  = 'Ej. Arroz, Atún en agua, Aceite de oliva, Harina, Sal';
           if (elEmpaque) elEmpaque.placeholder = 'Ej. Bolsa 1kg, Lata 400g, Botella 1L, Frasco 250g';
       } else if (tipo === 'carne') {
           if (elVar2 && elVar2.type !== 'hidden') elVar2.placeholder = 'Ej. Rib Eye, T-Bone, Pechuga s/h, Lomo entero';
           if (elNombre)  elNombre.placeholder  = 'Ej. Rib Eye Black Angus, Camarón 21/25, Pechuga de Pollo';
           if (elEmpaque) elEmpaque.placeholder = 'Ej. Caja 10kg, Bolsa cryovac, Bolsa individual 200g';
       } else if (tipo === 'fruta') {
           if (elVar2 && elVar2.type !== 'hidden') elVar2.placeholder = 'Ej. Hass, Roma, Tabasco, Cherry, Manila';
           if (elNombre)  elNombre.placeholder  = 'Ej. Aguacate Hass, Jitomate Roma, Plátano Tabasco';
           if (elEmpaque) elEmpaque.placeholder = 'Ej. Caja 20kg, Costal 25kg, Bolsa 5kg';
       } else if (tipo === 'otro') {
           if (elVar2 && elVar2.type !== 'hidden') elVar2.placeholder = 'Ej. Látex, Nitrilo, Talla M, 500ml';
           if (elNombre)  elNombre.placeholder  = 'Ej. Guantes desechables, Charolas aluminio, Palillos';
           if (elEmpaque) elEmpaque.placeholder = 'Ej. Caja 100 pzas, Paquete x50, Frasco 1L';
       }

       // ── Categoría: ocultar para abarrote (usa familia+grupo) ─────
       var catEl = document.getElementById('ins-categoria');
       var catWrap = catEl ? catEl.closest('.meta-item') : null;
       if (catWrap) {
           catWrap.style.display = tipo === 'abarrote' ? 'none' : '';
           if (tipo === 'abarrote') catEl.value = 'Abarrotes'; // valor silencioso
       }
       if (catWrap && tipo !== 'abarrote') {
           var currentCat = catEl.value || '';
           if (tipo === 'vino') {
               var optCats = TIPOS_VINO.map(function(t) {
                   return '<option value="' + t + '"' + (currentCat === t ? ' selected' : '') + '>' + t + '</option>';
               }).join('');
               catWrap.innerHTML = '<label>Tipo de vino</label>' +
                   '<select id="ins-categoria" style="' + SEL + '">' +
                   '<option value="">— Tipo de vino —</option>' + optCats + '</select>';
           } else if (tipo === 'refresco') {
               var optRef = CATS_REFRESCO.map(function(t) {
                   return '<option value="' + t + '"' + (currentCat === t ? ' selected' : '') + '>' + t + '</option>';
               }).join('');
               catWrap.innerHTML = '<label>Categoría</label>' +
                   '<select id="ins-categoria" style="' + SEL + '">' +
                   '<option value="">— Seleccionar —</option>' + optRef + '</select>';
           } else if (tipo === 'carne') {
               var optCarne = CATS_PROTEINA.map(function(t) {
                   var val = t === '— Seleccionar —' ? '' : t;
                   return '<option value="' + val + '"' + (currentCat === val ? ' selected' : '') + '>' + t + '</option>';
               }).join('');
               catWrap.innerHTML = '<label>Tipo de proteína</label>' +
                   '<select id="ins-categoria" style="' + SEL + '">' + optCarne + '</select>';
           } else if (tipo === 'fruta') {
               var optFruta = CATS_FRUTA.map(function(t) {
                   var val = t === '— Seleccionar —' ? '' : t;
                   return '<option value="' + val + '"' + (currentCat === val ? ' selected' : '') + '>' + t + '</option>';
               }).join('');
               catWrap.innerHTML = '<label>Tipo de producto</label>' +
                   '<select id="ins-categoria" style="' + SEL + '">' + optFruta + '</select>';
           } else {
               if (catEl.tagName === 'SELECT') {
                   catWrap.innerHTML = '<label>Categoría</label>' +
                       '<input type="text" id="ins-categoria" value="' + currentCat + '" placeholder="Ej. Destilados"' +
                       ' readonly style="opacity:.55;cursor:default;pointer-events:none">';
               }
           }
       }

       // ── Temperatura de conservación / almacenaje ────────────────
       var rowTemp = document.getElementById('row-temp-conservacion');
       var rowVida = document.getElementById('row-vida-util-abrir');
       if (rowTemp) {
           rowTemp.style.display = (tipo === 'vino' || tipo === 'carne' || tipo === 'fruta') ? '' : 'none';
           if (tipo === 'vino') {
               var tempEl = document.getElementById('ins-tempConservacion');
               var currentTemp = tempEl ? tempEl.value || '' : '';
               var optTemps = TEMPS_VINO.map(function(t) {
                   return '<option value="' + t + '"' + (currentTemp === t ? ' selected' : '') + '>' + t + '</option>';
               }).join('');
               rowTemp.innerHTML = '<label>Temperatura de conservación</label>' +
                   '<select id="ins-tempConservacion" style="' + SEL + '">' +
                   '<option value="">— Seleccionar temperatura —</option>' + optTemps + '</select>';
           } else if (tipo === 'carne') {
               var tempElC = document.getElementById('ins-tempConservacion');
               var currentTempC = tempElC ? tempElC.value || '' : '';
               var optTempsC = TEMPS_PROTEINA.map(function(t) {
                   return '<option value="' + t + '"' + (currentTempC === t ? ' selected' : '') + '>' + t + '</option>';
               }).join('');
               rowTemp.innerHTML = '<label>Temperatura de almacenaje</label>' +
                   '<select id="ins-tempConservacion" style="' + SEL + '">' +
                   '<option value="">— Seleccionar temperatura —</option>' + optTempsC + '</select>';
           } else if (tipo === 'fruta') {
               var tempElF = document.getElementById('ins-tempConservacion');
               var currentTempF = tempElF ? tempElF.value || '' : '';
               var optAlmF = ALMACENAJE_FRUTA.map(function(t) {
                   return '<option value="' + t + '"' + (currentTempF === t ? ' selected' : '') + '>' + t + '</option>';
               }).join('');
               rowTemp.innerHTML = '<label>Almacenaje fresco</label>' +
                   '<select id="ins-tempConservacion" style="' + SEL + '">' +
                   '<option value="">— Cómo almacenar —</option>' + optAlmF + '</select>';
           } else {
               var tempEl2 = document.getElementById('ins-tempConservacion');
               if (tempEl2 && tempEl2.tagName === 'SELECT') {
                   rowTemp.innerHTML = '<label>Temperatura de conservación</label>' +
                       '<input type="text" id="ins-tempConservacion" placeholder="Ej. 12-16°C">';
               }
           }
       }
       if (rowVida) {
           rowVida.style.display = (tipo === 'vino' || tipo === 'carne' || tipo === 'fruta') ? '' : 'none';
           if (tipo === 'vino') {
               var vidaEl = document.getElementById('ins-vidaUtilAbrir');
               var vidaEl2 = document.getElementById('ins-vidaUtilAbrirNum');
               // Solo reemplazar si aún no se ha convertido
               if (vidaEl && !vidaEl2) {
                   var selVida = '<select id="ins-vidaUtilAbrirUnidad" style="flex:1;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:9px 10px;border-radius:6px;font-family:sans-serif;font-size:14px;outline:none">' +
                       ['días','semanas','meses'].map(function(u){ return '<option>' + u + '</option>'; }).join('') + '</select>';
                   rowVida.innerHTML = '<label>Vida útil al abrir</label>' +
                       '<div style="display:flex;gap:6px">' +
                       '<input type="number" id="ins-vidaUtilAbrirNum" placeholder="3" min="1" ' +
                       'style="width:80px;flex-shrink:0">' + selVida + '</div>';
               }
           } else if (tipo === 'carne') {
               var vidaElC  = document.getElementById('ins-vidaUtilAbrir');
               var vidaNumC = document.getElementById('ins-vidaUtilAbrirNum');
               if (!vidaNumC) {
                   var existingVidaC = vidaElC ? vidaElC.value || '' : '';
                   var matchVidaC    = existingVidaC.match(/^(\d+)\s+(.+)$/);
                   var numValC  = matchVidaC ? matchVidaC[1] : '';
                   var unitValC = matchVidaC ? matchVidaC[2] : 'horas';
                   var selVidaC = '<select id="ins-vidaUtilAbrirUnidad" style="flex:1;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:9px 10px;border-radius:6px;font-family:sans-serif;font-size:14px;outline:none">' +
                       ['horas','días','semanas'].map(function(u){ return '<option value="'+u+'"'+(unitValC===u?' selected':'')+'>'+u+'</option>'; }).join('') + '</select>';
                   rowVida.innerHTML = '<label>Vida útil post-descongelación</label>' +
                       '<div style="display:flex;gap:6px">' +
                       '<input type="number" id="ins-vidaUtilAbrirNum" placeholder="48" min="1" value="'+numValC+'" ' +
                       'style="width:80px;flex-shrink:0">' + selVidaC + '</div>';
               }
           } else if (tipo === 'fruta') {
               var vidaElF  = document.getElementById('ins-vidaUtilAbrir');
               var vidaNumF = document.getElementById('ins-vidaUtilAbrirNum');
               if (!vidaNumF) {
                   var existingVidaF = vidaElF ? vidaElF.value || '' : '';
                   var matchVidaF    = existingVidaF.match(/^(\d+)\s+(.+)$/);
                   var numValF  = matchVidaF ? matchVidaF[1] : '';
                   var unitValF = matchVidaF ? matchVidaF[2] : 'días';
                   var selVidaF = '<select id="ins-vidaUtilAbrirUnidad" style="flex:1;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:9px 10px;border-radius:6px;font-family:sans-serif;font-size:14px;outline:none">' +
                       ['horas','días','semanas','meses'].map(function(u){ return '<option value="'+u+'"'+(unitValF===u?' selected':'')+'>'+u+'</option>'; }).join('') + '</select>';
                   rowVida.innerHTML = '<label>Vida útil fresca</label>' +
                       '<div style="display:flex;gap:6px">' +
                       '<input type="number" id="ins-vidaUtilAbrirNum" placeholder="7" min="1" value="'+numValF+'" ' +
                       'style="width:80px;flex-shrink:0">' + selVidaF + '</div>';
               }
           } else {
               // Restaurar texto si venía de vino o carne
               var numEl3 = document.getElementById('ins-vidaUtilAbrirNum');
               if (numEl3) {
                   rowVida.innerHTML = '<label>Vida útil al abrir</label>' +
                       '<input type="text" id="ins-vidaUtilAbrir" ' +
                       'placeholder="Ej. 3 días, 1 semana, 2-3 semanas">';
               }
           }
       }

       // ── Subcategoría ────────────────────────────────────────────
       var rowSub = document.getElementById('row-subcategoria');
       if (rowSub) rowSub.style.display = (tipo === 'vino' || tipo === 'refresco' || tipo === 'cerveza') ? 'none' : '';

       if (tipo !== 'vino') {
           var subcatEl = document.getElementById('ins-subcategoria');
           var subcatWrap = subcatEl ? subcatEl.parentElement : null;
           if (subcatWrap) {
               var currentSub = subcatEl.value || '';
               var listaSub = tipo === 'destilado' ? SUBCATS_DESTILADO
                            : tipo === 'licor'     ? SUBCATS_LICOR
                            : tipo === 'abarrote'  ? GRUPOS_ABARROTE
                            : null;
               if (listaSub) {
                   subcatWrap.innerHTML = '<label>' + (tipo === 'abarrote' ? 'Grupo de abarrote' : 'Subcategoría') + '</label>' +
                       '<select id="ins-subcategoria" style="' + SEL + '">' +
                       listaSub.map(function(s) {
                           var val = s === '— Seleccionar —' ? '' : s;
                           return '<option value="' + val + '"' +
                               (currentSub === val ? ' selected' : '') + '>' + s + '</option>';
                       }).join('') + '</select>';
               } else {
                   var esDesce  = tipo === 'carne' || tipo === 'fruta';
                   var subLabel = esDesce ? 'Método de descongelación'
                                : tipo === 'otro' ? 'Subcategoría / Uso' : 'Subcategoría';
                   var subPh    = esDesce ? 'Ej. Refrigeración gradual, Chorro de agua fría, Cocción directa'
                                : tipo === 'otro' ? 'Ej. Limpieza de cocina, Protección personal, Servicio'
                                : 'Ej. Vodka';
                   var subOpc   = esDesce ? '(opcional)' : '';
                   subcatWrap.innerHTML = '<label>' + subLabel + ' <span style="opacity:.4;font-weight:400;font-size:10px">' + subOpc + '</span></label>' +
                       '<input type="text" id="ins-subcategoria" ' +
                       'value="' + currentSub + '" placeholder="' + subPh + '">';
               }
           }
       }

       // ── Jerarquía y visibilidad exclusiva para Proteínas ────────
       if (tipo === 'carne') {
           ['row-nombre','row-familia','row-categoria','row-marca','row-variedad',
            'row-maduracion','row-temp-conservacion','row-vida-util-abrir','row-subcategoria']
               .forEach(function(id, idx) {
                   var el = document.getElementById(id);
                   if (el) el.style.order = String(idx + 1);
               });
           var _rowEmpC = document.getElementById('row-empaque');
           if (_rowEmpC) { _rowEmpC.style.order = '99'; _rowEmpC.style.display = 'none'; }
           var _rowVidaC = document.getElementById('row-vida-util-abrir');
           if (_rowVidaC) _rowVidaC.style.gridColumn = 'span 2';
           var _rowSubC = document.getElementById('row-subcategoria');
           if (_rowSubC) _rowSubC.style.gridColumn = 'span 2';
       }

       // ── Jerarquía y visibilidad exclusiva para Frutas y Verduras ─
       if (tipo === 'fruta') {
           ['row-nombre','row-categoria','row-variedad',
            'row-maduracion','row-temp-conservacion',
            'row-vida-util-abrir','row-vida-congelado',
            'row-como-congelar','row-subcategoria']
               .forEach(function(id, idx) {
                   var el = document.getElementById(id);
                   if (el) el.style.order = String(idx + 1);
               });
           // Ocultar marca, empaque y familia (siempre "Frutas y Verduras")
           var _rowMarcaF = document.getElementById('row-marca');
           if (_rowMarcaF) _rowMarcaF.style.display = 'none';
           var _rowEmpF = document.getElementById('row-empaque');
           if (_rowEmpF) { _rowEmpF.style.order = '99'; _rowEmpF.style.display = 'none'; }
           var _rowFamF = document.getElementById('row-familia');
           if (_rowFamF) _rowFamF.style.display = 'none';
           // Mostrar y configurar nuevas filas
           var _rowCongF = document.getElementById('row-como-congelar');
           if (_rowCongF) { _rowCongF.style.display = ''; _rowCongF.style.gridColumn = 'span 2'; }
           var _rowVidCF = document.getElementById('row-vida-congelado');
           if (_rowVidCF) {
               _rowVidCF.style.display = '';
               // Convertir a num+select si aún es texto plano
               if (!document.getElementById('ins-vidaUtilCongeladoNum')) {
                   var _vcExist  = document.getElementById('ins-vidaUtilCongelado');
                   var _vcVal    = _vcExist ? _vcExist.value || '' : '';
                   var _vcMatch  = _vcVal.match(/^(\d+)\s+(.+)$/);
                   var _vcNum    = _vcMatch ? _vcMatch[1] : '';
                   var _vcUnit   = _vcMatch ? _vcMatch[2] : 'meses';
                   var _vcSel    = '<select id="ins-vidaUtilCongeladoUnidad" style="flex:1;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:9px 10px;border-radius:6px;font-family:sans-serif;font-size:14px;outline:none">' +
                       ['días','semanas','meses'].map(function(u){ return '<option value="'+u+'"'+(_vcUnit===u?' selected':'')+'>'+u+'</option>'; }).join('') + '</select>';
                   _rowVidCF.innerHTML = '<label>Vida útil congelado</label>' +
                       '<div style="display:flex;gap:6px">' +
                       '<input type="number" id="ins-vidaUtilCongeladoNum" placeholder="3" min="1" value="'+_vcNum+'" ' +
                       'style="width:80px;flex-shrink:0">' + _vcSel + '</div>';
               }
           }
           var _rowSubF = document.getElementById('row-subcategoria');
           if (_rowSubF) _rowSubF.style.gridColumn = 'span 2';
           var _rowVidaF = document.getElementById('row-vida-util-abrir');
           if (_rowVidaF) _rowVidaF.style.gridColumn = '';
       }
   }

   function abrirSelectorCategoria() {
       document.getElementById('modalCategoria').style.display = 'flex';
   }
   
   function cerrarModalCategoria(e) {
       if (e.target === document.getElementById('modalCategoria'))
           document.getElementById('modalCategoria').style.display = 'none';
   }
   
   function abrirModalConTipo(tipo) {
       tipoInsumoActual = tipo;
       document.getElementById('modalCategoria').style.display = 'none';
       const cfg = TIPO_CONFIG[tipo];
       // Pre-llenar familia y categoría según tipo
       abrirModal(null, cfg.familia, cfg.categoria);
   }
   
   const _soloMode = new URLSearchParams(location.search).get('solo') === '1';

   // Delegado listener registrado una sola vez al inicio
   document.addEventListener('DOMContentLoaded', () => {
       const overlay = document.getElementById('modalOverlay');
       if (overlay) {
           overlay.addEventListener('input',  e => { if (e.target.closest('.modal')) modalDirty = true; });
           overlay.addEventListener('change', e => { if (e.target.closest('.modal')) modalDirty = true; });
       }
       const urlId = new URLSearchParams(location.search).get('id');
       if (urlId) setTimeout(() => editarInsumo(urlId), 150);

       if (_soloMode) {
           const s = document.createElement('style');
           s.textContent = '.top-bar,.app-shell{display:none!important}' +
                           'html,body{background:transparent!important}' +
                           '#modalOverlay{background:transparent!important}';
           document.head.appendChild(s);
       }
   });

   function abrirModal(ins = null, familiaDefault = '', categoriaDefault = '') {
       editandoId = ins ? ins.id : null;
       const cfg = TIPO_CONFIG[tipoInsumoActual] || TIPO_CONFIG['destilado'];
       const tituloTipo = ins ? 'Editar insumo' : `Nuevo insumo · ${cfg.icon} ${cfg.label}`;
       document.getElementById('modalTitulo').textContent = tituloTipo;
   
       document.getElementById('ins-nombre').value       = ins?.nombre       || '';
       document.getElementById('ins-familia').value      = ins?.familia      || familiaDefault;
       document.getElementById('ins-categoria').value    = ins?.categoria    || categoriaDefault;
       document.getElementById('ins-subcategoria').value = ins?.subcategoria || '';
       document.getElementById('ins-marca').value        = ins?.marca        || '';
       document.getElementById('ins-variedad').value     = ins?.variedad     || '';
       var _madEl = document.getElementById('ins-maduracion'); if (_madEl) _madEl.value = ins?.maduracion || '';
       var _tmpEl = document.getElementById('ins-tempConservacion'); if (_tmpEl) _tmpEl.value = ins?.tempConservacion || '';
       var _vidaEl = document.getElementById('ins-vidaUtilAbrir'); if (_vidaEl) _vidaEl.value = ins?.vidaUtilAbrir || '';
       document.getElementById('ins-empaque').value          = ins?.empaque           || '';
       var _congEl = document.getElementById('ins-comoCongelar'); if (_congEl) _congEl.value = ins?.comoCongelar || '';
       var _vcEl   = document.getElementById('ins-vidaUtilCongelado'); if (_vcEl) _vcEl.value = ins?.vidaUtilCongelado || '';
       document.getElementById('ins-notas').value        = ins?.notas        || '';
   
       // Si es edición, detectar tipo desde tipoInsumo guardado o desde familia/categoria
       if (ins) {
           if (ins.tipoInsumo && TIPO_CONFIG[ins.tipoInsumo]) {
               tipoInsumoActual = ins.tipoInsumo;
           } else {
               const fam = (ins.familia||'').toLowerCase();
               const cat = (ins.categoria||'').toLowerCase();
               if (fam.includes('carne'))  tipoInsumoActual = 'carne';
               else if (fam.includes('fruta') || fam.includes('verdura')) tipoInsumoActual = 'fruta';
               else if (fam.includes('abarro')) tipoInsumoActual = 'abarrote';
               else if (cat.includes('refresco') || cat.includes('soda') || cat.includes('agua')) tipoInsumoActual = 'refresco';
               else if (cat.includes('cerveza')) tipoInsumoActual = 'cerveza';
               else if (cat.includes('vino') || cat.includes('espumoso')) tipoInsumoActual = 'vino';
               else if (cat.includes('licor')) tipoInsumoActual = 'licor';
               else tipoInsumoActual = 'destilado';
           }
       }
   
       // Pill activo/inactivo
       const activo = ins ? (ins.activo === '0' ? '0' : '1') : '1';
       document.getElementById('ins-activo').value = activo;
       actualizarPillActivo(activo);
   
       // Foto
       fotoInsumoBase64 = '';
       const fotoImg = document.getElementById('insFotoImg');
       const fotoPh  = document.getElementById('insFotoPlaceholder');
       if (ins?.foto) {
           fotoImg.src           = ins.foto;
           fotoImg.style.display = 'block';
           fotoPh.style.display  = 'none';
       } else {
           fotoImg.src           = '';
           fotoImg.style.display = 'none';
           fotoPh.style.display  = 'flex';
       }
   
       presentacionesTemp = ins ? JSON.parse(JSON.stringify(ins.presentaciones||[])) : [];
       if (!presentacionesTemp.length) agregarPresentacion();
       else renderPresentaciones();

       ajustarCamposPorTipo(tipoInsumoActual);

       // Pre-rellenar vida útil num+unidad si es vino editado
       if (tipoInsumoActual === 'vino' && ins && ins.vidaUtilAbrir) {
           var _match = ins.vidaUtilAbrir.match(/^(\d+)\s+(.+)$/);
           var _numEl = document.getElementById('ins-vidaUtilAbrirNum');
           var _unEl  = document.getElementById('ins-vidaUtilAbrirUnidad');
           if (_match && _numEl && _unEl) {
               _numEl.value = _match[1];
               _unEl.value  = _match[2];
           }
       }

       // Pre-rellenar campos de fruta editada
       if (tipoInsumoActual === 'fruta' && ins) {
           if (ins.vidaUtilAbrir) {
               var _matchF = ins.vidaUtilAbrir.match(/^(\d+)\s+(.+)$/);
               var _numFEl = document.getElementById('ins-vidaUtilAbrirNum');
               var _unFEl  = document.getElementById('ins-vidaUtilAbrirUnidad');
               if (_matchF && _numFEl && _unFEl) { _numFEl.value = _matchF[1]; _unFEl.value = _matchF[2]; }
           }
           var _congEl2 = document.getElementById('ins-comoCongelar');
           if (_congEl2 && ins.comoCongelar) _congEl2.value = ins.comoCongelar;
           // Pre-rellenar vida útil congelado (num+unidad)
           if (ins.vidaUtilCongelado) {
               var _matchVC = ins.vidaUtilCongelado.match(/^(\d+)\s+(.+)$/);
               var _numVC = document.getElementById('ins-vidaUtilCongeladoNum');
               var _unVC  = document.getElementById('ins-vidaUtilCongeladoUnidad');
               if (_matchVC && _numVC && _unVC) { _numVC.value = _matchVC[1]; _unVC.value = _matchVC[2]; }
               else { var _vcEl2 = document.getElementById('ins-vidaUtilCongelado'); if (_vcEl2) _vcEl2.value = ins.vidaUtilCongelado; }
           }
       }

       modalDirty = false;
       document.getElementById('modalOverlay').style.display = 'flex';
       setTimeout(() => document.getElementById('ins-nombre').focus(), 100);
   }
   
   function toggleActivoInsumo() {
       const inp = document.getElementById('ins-activo');
       const nuevoVal = inp.value === '1' ? '0' : '1';
       inp.value = nuevoVal;
       actualizarPillActivo(nuevoVal);
   }
   
   function actualizarPillActivo(val) {
       const pill = document.getElementById('ins-activo-pill');
       if (!pill) return;
       if (val === '1') {
           pill.textContent = 'Activo';
           pill.className   = 'pill pill-green';
       } else {
           pill.textContent = 'Inactivo';
           pill.className   = 'pill pill-red';
       }
   }
   
   var modalDirty = false;

   function cerrarModal(e) {
       if (e.target !== document.getElementById('modalOverlay')) return;
       if (modalDirty && !confirm('¿Salir sin guardar? Los cambios se perderán.')) return;
       modalDirty = false;
       document.getElementById('modalOverlay').style.display = 'none';
   }
   
   function cerrarModalBtn() {
       if (modalDirty && !confirm('¿Salir sin guardar? Los cambios se perderán.')) return;
       modalDirty = false;
       document.getElementById('modalOverlay').style.display = 'none';
       if (_soloMode) window.parent.postMessage({ type: 'cerrarEditor' }, '*');
   }
   
   function editarInsumo(id) {
       const ins = getInsumos().find(x => x.id === id);
       if (ins) abrirModal(ins);
   }
   
   function eliminarInsumo(id) {
       const ins = getInsumos().find(x => x.id === id);
       if (!ins) return;
       _pedirClaveAdmin('Eliminar insumo "' + ins.nombre + '"', function() {
           setInsumos(getInsumos().filter(x => x.id !== id));
           init();
       });
   }
   
   // ── Foto ──────────────────────────────────────────────────────
   function cargarFotoInsumo(input) {
       const file = input.files[0];
       if (!file) return;
       const reader = new FileReader();
       reader.onload = e => {
           fotoInsumoBase64 = e.target.result;
           const img = document.getElementById('insFotoImg');
           const ph  = document.getElementById('insFotoPlaceholder');
           img.src           = e.target.result;
           img.style.display = 'block';
           ph.style.display  = 'none';
       };
       reader.readAsDataURL(file);
   }
   
   // ── Helpers de presentaciones ────────────────────────────────
   /** Factor de precio según selección de impuesto y checkboxes manuales */
   function calcImpFactor(p) {
       if (p.incluyeImpuesto !== '0') return 1; // precio ya incluye impuesto
       let f = 1;
       if (p.ivaCheck  === '1') f *= 1.16;
       if (p.iepsCheck === '1') f *= (1 + parseFloat(p.iepsTasa || '26.5') / 100);
       return f;
   }

   // ── Presentaciones ────────────────────────────────────────────
   function agregarPresentacion() {
       var hoy = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
       presentacionesTemp.push({
           id: genId(), contNeto: '', umContenido: 'ML',
           pesoUnidad: '', umPeso: 'G', pesoCristal: '',
           masaDrenada: '', umMasaDrenada: 'G', rendimiento: '', umRendimiento: 'OZ',
           tamanoCopa: '', umTamanoCopa: 'ML',
           factorCopa: '3.3', factorBotella: '2.5', factorPieza: '2.0', costoPieza: '',
           proveedor: '', zona: '', fecha: hoy,
           precio: '', costoUnitario: '', umCosto: 'LT',
           incluyeImpuesto: '0', ivaCheck: '0', iepsCheck: '0', iepsTasa: '26.5', notas: '',
           precioCarta: '', precioCartaBot: '',
           stockMin: '', stockMax: ''
       });
       renderPresentaciones();
   }
   
   function eliminarPresentacion(i) {
       if (presentacionesTemp.length <= 1) { alert('Mínimo una presentación'); return; }
       presentacionesTemp.splice(i, 1);
       renderPresentaciones();
   }
   
   // ── Auxiliares de cálculo para updPres ────────────────────────────────────
   function _calcCostosAbarrote(p, precioEfectivo, contML) {
       const cantPres = parseFloat(p.cantPresCompra) || 1;
       const presCompra = p.presentacionCompra || 'Pieza';

       const piezasEnPack = ['Caja','Paquete','Costal'].includes(presCompra) && cantPres > 1
           ? cantPres : 1;
       const costoPieza = precioEfectivo / piezasEnPack;
       p.costoPieza = costoPieza.toFixed(2);

       // Si hay masa drenada usar ese contenido para el costo, si no el contenido del producto
       const masaDrena  = parseFloat(p.masaDrenada) || 0;
       const umEfectivo = masaDrena > 0
           ? (p.umMasaDrenada || 'G').toUpperCase()
           : (p.umContenido   || 'G').toUpperCase();
       const contEfML   = masaDrena > 0 ? toML(masaDrena, umEfectivo) : contML;

       if (umEfectivo === 'ML') {
           p.costoUnitario = contEfML > 0 ? (costoPieza / contEfML).toFixed(4) : '0';
           p.umCosto = 'ML';
       } else if (umEfectivo === 'LT') {
           p.costoUnitario = contEfML > 0 ? (costoPieza / (contEfML / 1000)).toFixed(2) : '0';
           p.umCosto = 'LT';
       } else if (umEfectivo === 'G') {
           p.costoUnitario = contEfML > 0 ? (costoPieza / contEfML).toFixed(4) : '0';
           p.umCosto = 'G';
       } else if (umEfectivo === 'KG') {
           p.costoUnitario = contEfML > 0 ? (costoPieza / (contEfML / 1000)).toFixed(2) : '0';
           p.umCosto = 'KG';
       } else if (['PZA','CARGA','PORCION'].includes(umEfectivo)) {
           p.costoUnitario = costoPieza.toFixed(2);
           p.umCosto = 'PZA';
       } else {
           p.costoUnitario = contEfML > 0 ? (costoPieza / (contEfML / 1000)).toFixed(2) : '0';
           p.umCosto = 'KG';
       }
   }

   function _calcCostosBarril(p, precioEfectivo, contML) {
       const litrosBarril = parseFloat(p.cantPresCompra) || 1;
       const barrilML     = litrosBarril * 1000;
       const vasoML       = contML > 0 ? contML : 1;
       p.costoPieza    = barrilML > 0 ? (precioEfectivo * vasoML / barrilML).toFixed(2) : '0';
       p.costoUnitario = litrosBarril > 0 ? (precioEfectivo / litrosBarril).toFixed(2) : '0';
       p.umCosto       = 'LT';
   }

   // Proteínas: usa cantPresCompra + umPresCompra como peso/volumen total de compra
   function _calcCostosProteina(p, precioEfectivo) {
       const cantPres = parseFloat(p.cantPresCompra) || 0;
       const umPres   = (p.umPresCompra || 'KG').toUpperCase();
       const isPiezas = ['PZA','PORCION'].includes(umPres);

       if (!isPiezas && cantPres > 0) {
           // Compra por peso/volumen total (Rack 24 KG, Bolsa 5 KG, Granel 10 KG, etc.)
           p.costoPieza = precioEfectivo.toFixed(2);
           const totalML  = toML(cantPres, umPres); // KG→1000 G→1 LT→1000 ML→1
           const isWeight = ['KG','G'].includes(umPres);
           if (totalML > 0) {
               // costoUnitario = $/KG o $/LT (unidad "grande")
               p.costoUnitario = (precioEfectivo / (totalML / 1000)).toFixed(4);
               p.umCosto = isWeight ? 'KG' : 'LT';
           } else {
               p.costoUnitario = '0';
               p.umCosto = 'KG';
           }
       } else {
           // Compra por piezas (10 PZA de 200G c/u)
           const piezas     = cantPres > 0 ? cantPres : 1;
           const costoPieza = precioEfectivo / piezas;
           p.costoPieza = costoPieza.toFixed(2);
           const contML2 = toML(p.contNeto, p.umContenido || 'G');
           const umCont  = (p.umContenido || 'G').toUpperCase();
           const isWeight = ['KG','G'].includes(umCont);
           if (contML2 > 0) {
               p.costoUnitario = (costoPieza / (contML2 / 1000)).toFixed(4);
               p.umCosto = isWeight ? 'KG' : 'LT';
           } else {
               p.costoUnitario = '0';
               p.umCosto = isWeight ? 'KG' : 'LT';
           }
       }
   }

   function _calcCostosRefrescoCerveza(p, precioEfectivo, contML) {
       const presCompra = p.presentacionCompra || 'Pieza';
       const cantPres   = parseFloat(p.cantPresCompra) || 1;
       const costoPieza = ['Caja','Rejilla'].includes(presCompra) && cantPres > 0
           ? precioEfectivo / cantPres
           : precioEfectivo;
       p.costoPieza = costoPieza.toFixed(2);
       if (contML > 0) {
           const _um = (p.umCosto || 'LT').toUpperCase();
           p.costoUnitario = (_um === 'PZA')
               ? costoPieza.toFixed(2)
               : (costoPieza / (contML / 1000)).toFixed(2);
       }
   }

   function _updateDisplaysRefrescoCerv(p, i) {
       const _cp  = parseFloat(p.costoPieza)||0;
       const _fp  = parseFloat(p.factorPieza)||2.0;
       const { oz: _ozV, lt: _ltV } = calcOzLt(p.costoPieza, p.contNeto, p.umContenido);
       var _elP     = document.getElementById('ref-pieza-'+i);
       var _elO     = document.getElementById('ref-onza-'+i);
       var _elL     = document.getElementById('ref-litro-'+i);
       var _elCarta = document.getElementById('ref-precio-carta-'+i);
       if (_elP) _elP.textContent = fmtMXN(_cp);
       if (_elO) _elO.textContent = _ozV;
       if (_elL) _elL.textContent = _ltV;
       if (_elCarta) _elCarta.textContent = fmtMXN(_cp * _fp);
       if (tipoInsumoActual === 'cerveza_barril') {
           const _ltNum = _ltV !== '\u2014' ? parseFloat(_ltV.replace('$ ','').replace(/,/g,'')) : 0;
           if (_elCarta) _elCarta.textContent = fmtMXN(_ltNum * _fp);
           var _elVaso = document.getElementById('ref-precio-vaso-'+i);
           if (_elVaso) _elVaso.textContent = fmtMXN(_cp * _fp);
       }
   }

   function updPres(i, campo, val) {
       presentacionesTemp[i][campo] = val;
       const p = presentacionesTemp[i];
   
       // ── 1. Auto-calcular costoUnitario desde precio + contenido ──
       // Solo si el usuario no lo ha llenado manualmente o si cambia precio/contenido
       const precio         = parseFloat(p.precio) || 0;
       const precioEfectivo = precio * calcImpFactor(p);
       const contML         = toML(p.contNeto, p.umContenido || 'ML');
   
       const _triggerCosto = ['precio','contNeto','umContenido','cantPresCompra','presentacionCompra','umPresCompra','factorPieza','tamanoCopa','ivaCheck','iepsCheck','iepsTasa','incluyeImpuesto','masaDrenada','umMasaDrenada'];
       if (_triggerCosto.includes(campo) && precioEfectivo > 0) {
           if (tipoInsumoActual === 'cerveza_barril') {
               _calcCostosBarril(p, precioEfectivo, contML);
           } else if (['refresco','cerveza'].includes(tipoInsumoActual)) {
               _calcCostosRefrescoCerveza(p, precioEfectivo, contML);
           } else if (tipoInsumoActual === 'carne' || tipoInsumoActual === 'fruta') {
               _calcCostosProteina(p, precioEfectivo);
           } else if (tipoInsumoActual === 'abarrote') {
               _calcCostosAbarrote(p, precioEfectivo, contML);
           } else if (contML > 0) {
               p.costoUnitario = (precioEfectivo / (contML / 1000)).toFixed(2);
               p.umCosto = 'LT';
           }
           const elCU = document.querySelector(`#listaPresentaciones [oninput*="updPres(${i},'costoUnitario"]`);
           if (elCU) elCU.value = p.costoUnitario;
           // Actualizar displays de refresco/cerveza/abarrote
           if (['refresco','cerveza','cerveza_barril'].includes(tipoInsumoActual)) {
               _updateDisplaysRefrescoCerv(p, i);
           }
           if (tipoInsumoActual === 'abarrote' || tipoInsumoActual === 'carne' || tipoInsumoActual === 'fruta') {
               const _cp    = parseFloat(p.costoPieza)||0;
               const _cu    = parseFloat(p.costoUnitario)||0;
               const _um2   = (p.umCosto || 'KG').toUpperCase();
               const _cuBig2   = ['ML','G'].includes(_um2) ? _cu * 1000 : _cu;
               const _cuSmall2 = ['LT','KG'].includes(_um2) ? _cu / 1000 : _cu;
               const _elP  = document.getElementById('ref-pieza-'+i);
               const _elC  = document.getElementById('ref-costoum-'+i);
               const _elS  = document.getElementById('ref-costomlgr-'+i);
               if (_elP) _elP.textContent = fmtMXN(_cp);
               if (_elC) _elC.textContent = fmtMXN(_cuBig2);
               if (_elS) _elS.textContent = fmtMXN(_cuSmall2, 3);
           }
       }
   
       // ── Auto-calcular rendimiento desde contenido neto ────────────
       // Convierte contML a la unidad de rendimiento elegida
       if ((campo === 'contNeto' || campo === 'umContenido' || campo === 'umRendimiento') && contML > 0) {
           const umRen  = (p.umRendimiento || 'OZ').toUpperCase();
           const rend   = contML / toML(1, umRen);
           p.rendimiento = rend.toFixed(2);
           // Actualizar input visual — buscar por atributo oninput
           const allInputs = document.querySelectorAll('#listaPresentaciones input[type="number"]');
           allInputs.forEach(el => {
               if (el.getAttribute('oninput') === `updPres(${i},'rendimiento',this.value)`) {
                   el.value = p.rendimiento;
               }
           });
           // Actualizar costo/um label
           const elCostoUm  = document.getElementById(`costo-um-${i}`);
           const elLblCosto = document.getElementById(`lbl-costoum-${i}`);
           if (elCostoUm) {
               const c = calcCostoPorUm(p.costoUnitario, p.umCosto||'LT', umRen);
               elCostoUm.textContent = c ? '$'+c : '—';
           }
           if (elLblCosto) elLblCosto.textContent = `Costo / ${umRen} (auto)`;
       }
   
       // ── 2. Recalcular peso cristal ────────────────────────────────
       const pesoUnidad = parseFloat(p.pesoUnidad) || 0;
       const umPeso     = (p.umPeso || 'G').toUpperCase();
       const pesoUnidag = umPeso === 'KG' ? pesoUnidad * 1000 : pesoUnidad;
       // contML ya está en ML (mismo que gramos para líquidos densidad≈1)
       if (contML > 0 && pesoUnidag > 0) {
           p.pesoCristal = (pesoUnidag - contML).toFixed(0);
       }
   
       // ── 3. Actualizar campos calculados en DOM ────────────────────
       const CALCULA_CRISTAL = ['contNeto','pesoUnidad','umContenido','umPeso'];
       const CALCULA_COPA    = ['costoUnitario','umCosto','tamanoCopa','umTamanoCopa','contNeto','umContenido','precio','factorCopa','factorBotella','factorPieza'];
   
       if (CALCULA_CRISTAL.includes(campo)) {
           const el = document.getElementById(`cristal-${i}`);
           if (el) el.textContent = p.pesoCristal ? `${p.pesoCristal} g` : '— g';
       }
   
       if (CALCULA_COPA.includes(campo)) {
           actualizarCopaCosto(i);
       }
   
       // Costo por UM — actualizar siempre que cambie algo relevante
       if (['rendimiento','umRendimiento','costoUnitario','umCosto','precio','contNeto','umContenido'].includes(campo)) {
           const elCostoUm  = document.getElementById(`costo-um-${i}`);
           const elLblCosto = document.getElementById(`lbl-costoum-${i}`);
           if (elCostoUm) {
               const c = calcCostoPorUm(p.costoUnitario, p.umCosto||'LT', p.umRendimiento||'OZ');
               elCostoUm.textContent = c ? '$'+c : '—';
           }
           if (elLblCosto) elLblCosto.textContent = `Costo / ${p.umRendimiento||'OZ'} (auto)`;
       }
   
       if (campo === 'tamanoCopa' || campo === 'umTamanoCopa') {
           const el = document.getElementById(`copa-equiv-${i}`);
           if (el) {
               const tc = parseFloat(p.tamanoCopa)||0;
               const um = p.umTamanoCopa||'ML';
               el.textContent = !tc ? '\u2014'
                   : um==='ML' ? `${tc} ML = ${(tc/OZ_ML).toFixed(2)} OZ`
                   : `${tc} OZ = ${(tc*OZ_ML).toFixed(1)} ML`;
           }
           actualizarCopaCosto(i);
       }
   }
   
   function actualizarCopaCosto(i) {
       const p    = presentacionesTemp[i];
       const wrap = document.getElementById(`copa-cards-${i}`);
       if (!wrap) return;
   
       const copa = calcCostoCopa(p.costoUnitario, p.umCosto||'LT', p.tamanoCopa, p.umTamanoCopa||'ML');
       if (!copa) {
           wrap.innerHTML = `<div style="font-size:11px;color:var(--text-dim);margin-bottom:10px">
               Ingresa costo unitario y tamaño de copa para ver el costeo automático</div>`;
           return;
       }
   
       const costoCopaNum = parseFloat(copa.costoCopa) || 0;
       const cu           = parseFloat(p.costoUnitario) || 0;
       const contML       = (()=>{
           const cn = parseFloat(p.contNeto)||0;
           const uc = (p.umContenido||'ML').toUpperCase();
           return uc==='LT' ? cn*1000 : cn;
       })();
       const costoBot       = cu > 0 && contML > 0 ? cu*(contML/1000) : 0;
       const fCopa          = parseFloat(p.factorCopa)    || 3.3;
       const fBot           = parseFloat(p.factorBotella) || 2.5;
       const precioCopaAuto = (costoCopaNum * fCopa).toFixed(2);
       const precioBotAuto  = costoBot > 0 ? (costoBot * fBot).toFixed(2) : null;

       // Actualizar rendimiento en copas
       const tc    = parseFloat(p.tamanoCopa) || 0;
       const tML   = toML(p.tamanoCopa, p.umTamanoCopa||'ML');
       const elRend = document.getElementById('copas-rend-' + i);
       if (elRend) elRend.textContent = (contML > 0 && tML > 0) ? Math.floor(contML / tML) + ' copas' : '—';
   
       wrap.innerHTML = `
           <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px">
               <div style="background:var(--surface);border:1px solid var(--border);
                   border-radius:8px;padding:10px;text-align:center">
                   <div style="font-size:8px;letter-spacing:2px;text-transform:uppercase;
                       color:var(--text-dim);margin-bottom:4px">Costo copa</div>
                   <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;
                       color:var(--text);letter-spacing:1px">${fmtMXN(copa.costoCopa)}</div>
                   <div style="font-size:9px;color:var(--text-dim)">${p.tamanoCopa||0} ${p.umTamanoCopa||'ML'}</div>
               </div>
               <div style="background:var(--surface);border:1px solid var(--accent);
                   border-radius:8px;padding:10px;text-align:center">
                   <div style="font-size:8px;letter-spacing:2px;text-transform:uppercase;
                       color:var(--accent);margin-bottom:4px">Precio copa ×3.3</div>
                   <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;
                       color:var(--accent);letter-spacing:1px">${fmtMXN(precioCopaAuto)}</div>
                   <div style="font-size:9px;color:var(--text-dim)">sugerido carta</div>
               </div>
               <div style="background:var(--surface);border:1px solid var(--border);
                   border-radius:8px;padding:10px;text-align:center">
                   <div style="font-size:8px;letter-spacing:2px;text-transform:uppercase;
                       color:var(--text-dim);margin-bottom:4px">Costo botella</div>
                   <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;
                       color:var(--text);letter-spacing:1px">${fmtMXN(costoBot)}</div>
                   <div style="font-size:9px;color:var(--text-dim)">${contML>0?contML+' ML':'sin contenido'}</div>
               </div>
               <div style="background:var(--surface);border:1px solid var(--green);
                   border-radius:8px;padding:10px;text-align:center">
                   <div style="font-size:8px;letter-spacing:2px;text-transform:uppercase;
                       color:var(--green);margin-bottom:4px">Precio bot. ×2.5</div>
                   <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;
                       color:var(--green);letter-spacing:1px">${fmtMXN(precioBotAuto)}</div>
                   <div style="font-size:9px;color:var(--text-dim)">sugerido carta</div>
               </div>
           </div>`;
   }
   
   // ── Helpers de formato de precio ─────────────────────────────
   function fmtPrecio(val) {
       const n = parseFloat(String(val).replace(/,/g,''));
       if (!n) return '';
       return n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
   }

   function focusCurrency(el) {
       el.value = el.value.replace(/,/g, '');
   }

   function blurCurrency(el, idx, campo) {
       const raw = el.value.replace(/,/g, '');
       const n = parseFloat(raw);
       if (n) el.value = n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
       updPres(idx, campo, raw);
   }

   function inputCurrency(el, idx, campo) {
       updPres(idx, campo, el.value.replace(/,/g, ''));
   }

   // aliases para compatibilidad con llamadas existentes
   function focusPrecioInput(el)        { focusCurrency(el); }
   function blurPrecioInput(el, idx)    { blurCurrency(el, idx, 'precio'); }
   function inputPrecioRaw(el, idx)     { inputCurrency(el, idx, 'precio'); }

   // Formatea número con comas de miles para mostrar en displays (no inputs)
   function fmtMXN(val, dec) {
       if (dec === undefined) dec = 2;
       const n = parseFloat(val) || 0;
       if (!n) return '\u2014';
       const parts = n.toFixed(dec).split('.');
       parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
       return '$ ' + parts.join('.');
   }

   // ── Helpers de conversión ─────────────────────────────────────
   /** Convierte una cantidad en `um` a mililitros */
   function toML(valor, um) {
       const v = parseFloat(valor) || 0;
       const u = (um || 'ML').toUpperCase();
       const factor = { LT:1000, ML:1, OZ:OZ_ML, G:1, KG:1000, PZA:1, PORCION:1, COPA:COPA_ML };
       return v * (factor[u] || 1);
   }

   /**
    * Calcula costo por onza y por litro a partir de costoPieza y contenido.
    * Devuelve { oz, lt } como strings con '$' o '—'.
    */
   function calcOzLt(costoPieza, contNeto, umContenido) {
       const cp  = parseFloat(costoPieza) || 0;
       const cML = toML(contNeto, umContenido);
       if (!cp || !cML) return { oz: '\u2014', lt: '\u2014' };
       return {
           oz: fmtMXN(cp / (cML / OZ_ML)),
           lt: fmtMXN(cp / (cML / 1000)),
       };
   }

   // ── Costo por unidad de medida (auto) ────────────────────────
   // Convierte costoUnitario (en umCosto) al costo por 1 unidad de umRendimiento
   function calcCostoPorUm(costoUnitario, umCosto, umRendimiento) {
       const cu = parseFloat(costoUnitario) || 0;
       if (!cu) return null;
   
       // Factores de conversión a ML (base)
       const aML = { LT:1000, ML:1, OZ:OZ_ML, G:1, KG:1000, PZA:1, PORCION:1, COPA:COPA_ML };
   
       // 1 umCosto → ML
       const mlPorUmCosto = aML[umCosto] || 1000;
       // costo por ML
       const costoPorML = cu / mlPorUmCosto;
   
       // 1 umRendimiento → ML
       const mlPorUmRen = aML[umRendimiento] || 1;
       const costoPorUm = costoPorML * mlPorUmRen;
   
       return costoPorUm.toFixed(2);
   }
   
   // ── Calcular costo de copa ────────────────────────────────────
   // costoUnitario siempre en $/LT
   // tamaño copa en ML u OZ → convierte a ML → costo = $/LT × (ml/1000)
   function calcCostoCopa(costoUnitario, umCosto, tamanoCopa, umTamano) {
       const cu = parseFloat(costoUnitario) || 0;
       const tc = parseFloat(tamanoCopa)   || 0;
       if (!cu || !tc) return null;
   
       // Normalizar costo a $/LT
       let costoPorLt = cu;
       if (umCosto === 'KG') costoPorLt = cu; // asumimos densidad 1 para líquidos
   
       // Tamaño copa a ML
       const tamML = umTamano === 'OZ' ? tc * OZ_ML : tc;
   
       const costoCopa = costoPorLt * (tamML / 1000);
       const costoOz   = costoPorLt * (OZ_ML / 1000);
   
       return {
           costoCopa: costoCopa.toFixed(2),
           costoOz:   costoOz.toFixed(2),
           tamML:     tamML.toFixed(1)
       };
   }
   
   // ── Sub-render helpers para renderPresentaciones ─────────────────────────

   function _renderImpuestosBlock(p, i) {
       if (p.incluyeImpuesto === undefined) return '';
       const dis     = p.incluyeImpuesto !== '0';
       const ivaChk  = p.ivaCheck==='1' || p.incluyeImpuesto==='1' || p.incluyeImpuesto==='2';
       const iepsChk = p.iepsCheck==='1' || p.incluyeImpuesto==='2';

       const _hasMasaDrenada = parseFloat(p.masaDrenada) > 0;
       const _hasImpuesto    = !dis && (p.ivaCheck==='1' || p.iepsCheck==='1');
       let precioFinalHtml = '';
       if (_hasMasaDrenada || _hasImpuesto) {
           const base   = parseFloat(p.precio)||0;
           let factor   = 1;
           let tags     = '';
           if (_hasImpuesto) {
               if (p.ivaCheck==='1')  factor *= 1.16;
               if (p.iepsCheck==='1') factor *= (1 + parseFloat(p.iepsTasa||'26.5')/100);
               tags = [p.ivaCheck==='1'?'+ IVA 16%':'', p.iepsCheck==='1'?'+ IEPS '+(p.iepsTasa||'26.5')+'%':''].filter(Boolean).join(' · ');
           }
           const masaLabel = _hasMasaDrenada
               ? `<div style="font-size:9px;color:var(--text-dim);margin-top:2px">Masa drenada: ${p.masaDrenada} ${p.umMasaDrenada||'G'}</div>`
               : '';
           precioFinalHtml = `<div class="meta-item" style="margin-top:10px" id="precio-final-block-${i}">
               <label>${_hasImpuesto ? 'Precio final (c/impuestos)' : 'Precio base (masa drenada)'} ${_MXN}</label>
               <div style="background:var(--surface);border:1px solid var(--green-dim);border-radius:6px;padding:8px 12px">
                   <div style="font-size:15px;font-weight:700;color:var(--green)">${fmtMXN(base * factor)}</div>
                   ${tags ? `<div style="font-size:9px;color:var(--text-dim);margin-top:2px">${tags}</div>` : ''}
                   ${masaLabel}
               </div>
           </div>`;
       }

       return `<div style="background:rgba(245,200,66,.04);border:1px solid rgba(245,200,66,.15);border-radius:8px;padding:12px 14px;margin-bottom:10px">
           <div style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--accent);opacity:.7;margin-bottom:10px">Impuestos</div>
           <div class="meta-grid" style="grid-template-columns:1fr 1fr;gap:8px">
               <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--surface);border:1px solid var(--border);border-radius:6px">
                   <input type="checkbox" id="iva-${i}" ${ivaChk?'checked':''} ${dis?'disabled':''}
                       onchange="updPres(${i},'ivaCheck',this.checked?'1':'0');renderPresentaciones()"
                       style="width:16px;height:16px;accent-color:var(--accent);cursor:${dis?'default':'pointer'}">
                   <label for="iva-${i}" style="cursor:pointer;font-size:12px;flex:1">
                       <span style="font-weight:600">IVA</span><span style="color:var(--accent);margin-left:4px">16%</span>
                   </label>
               </div>
               <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--surface);border:1px solid var(--border);border-radius:6px">
                   <input type="checkbox" id="ieps-${i}" ${iepsChk?'checked':''} ${dis?'disabled':''}
                       onchange="updPres(${i},'iepsCheck',this.checked?'1':'0');renderPresentaciones()"
                       style="width:16px;height:16px;accent-color:var(--accent);cursor:${dis?'default':'pointer'}">
                   <label for="ieps-${i}" style="cursor:pointer;font-size:12px;flex:1;display:flex;align-items:center;gap:6px">
                       <span style="font-weight:600">IEPS</span>
                       <select onchange="updPres(${i},'iepsTasa',this.value);renderPresentaciones()"
                           style="flex:1;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:3px 6px;border-radius:4px;font-size:11px;font-family:inherit">
                           ${['26.5','30','8','50','160'].map(t =>
                               '<option value="'+t+'"'+((p.iepsTasa||'26.5')===t?' selected':'')+'>'+t+'%</option>'
                           ).join('')}
                       </select>
                   </label>
               </div>
           </div>
           ${precioFinalHtml}
       </div>`;
   }

   function _renderFilaCostosBlock(p, i, flags) {
       const { esBarril, esRefrescoCerv, esBebidaCompleta, esAbarrote, esCarne } = flags;
       const show = true;
       const _cp  = parseFloat(p.costoPieza)||0;
       const { oz: _ozV, lt: _ltV } = calcOzLt(p.costoPieza, p.contNeto, p.umContenido);
       const _fp  = parseFloat(p.factorPieza)||2.0;
       const _csV = _ltV !== '\u2014' ? fmtMXN(parseFloat(_ltV.replace('$ ','').replace(/,/g,'')) * _fp) : '\u2014';

       let innerHtml = '';
       if (esBarril) {
           innerHtml = '<div class="meta-item"><label>Costo por onza '+_MXN+'</label>'
               + '<div id="ref-onza-'+i+'" style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:8px 12px;font-size:14px;color:var(--accent);font-weight:600">'+_ozV+'</div></div>'
               + '<div class="meta-item"><label>Costo por litro '+_MXN+'</label>'
               + '<div id="ref-litro-'+i+'" style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:8px 12px;font-size:14px;color:var(--text-dim);font-weight:600">'+_ltV+'</div></div>'
               + '<div class="meta-item"><label>Costo sugerido por litro '+_MXN+'</label>'
               + '<div id="ref-precio-carta-'+i+'" style="background:var(--surface);border:1px solid var(--accent);border-radius:6px;padding:8px 12px;font-size:15px;color:var(--accent);font-weight:700">'+_csV+'</div></div>';
       } else if (esRefrescoCerv) {
           innerHtml = '<div class="meta-item"><label>Costo por pieza '+_MXN+'</label>'
               + '<div id="ref-pieza-'+i+'" style="background:var(--surface);border:1px solid var(--green-dim);border-radius:6px;padding:8px 12px;font-size:14px;color:var(--green);font-weight:600">'+fmtMXN(_cp)+'</div></div>'
               + '<div class="meta-item"><label>Costo por onza '+_MXN+'</label>'
               + '<div id="ref-onza-'+i+'" style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:8px 12px;font-size:14px;color:var(--accent);font-weight:600">'+_ozV+'</div></div>'
               + '<div class="meta-item"><label>Costo por litro '+_MXN+'</label>'
               + '<div id="ref-litro-'+i+'" style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:8px 12px;font-size:14px;color:var(--text-dim);font-weight:600">'+_ltV+'</div></div>';
       } else if (esAbarrote || esCarne) {
           const _um      = (p.umCosto || 'KG').toUpperCase();
           const _cu      = parseFloat(p.costoUnitario)||0;
           const _umCont  = (p.umContenido || 'G').toUpperCase();
           const _esPieza = ['PZA','CARGA','PORCION'].includes(_umCont);

           const _cuBig   = ['ML','G'].includes(_um) ? _cu * 1000 : _cu;
           const _cuSmall = ['LT','KG'].includes(_um) ? _cu / 1000 : _cu;

           innerHtml = (!_esPieza
               ? '<div class="meta-item"><label>Costo por pieza '+_MXN+'</label>'
                 + '<div id="ref-pieza-'+i+'" style="background:var(--surface);border:1px solid var(--green-dim);border-radius:6px;padding:8px 12px;font-size:14px;color:var(--green);font-weight:600">'+fmtMXN(_cp)+'</div></div>'
               : '')
               + (!_esPieza ? '<div class="meta-item"><label>Costo por KG/LT '+_MXN+'</label>'
               + '<div id="ref-costoum-'+i+'" style="background:var(--surface);border:1px solid var(--accent);border-radius:6px;padding:8px 12px;font-size:14px;color:var(--accent);font-weight:700">'+fmtMXN(_cuBig)+'</div></div>' : '')
               + (!_esPieza ? '<div class="meta-item"><label>Costo por ML/GR '+_MXN+'</label>'
               + '<div id="ref-costomlgr-'+i+'" style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:8px 12px;font-size:13px;color:var(--text-dim);font-weight:600">'+fmtMXN(_cuSmall, 3)+'</div></div>' : '');
       } else {
           innerHtml = `<div class="meta-item">
               <label>Rendimiento</label>
               <input type="number" value="${p.rendimiento||''}" placeholder="23.33"
                   oninput="updPres(${i},'rendimiento',this.value)">
           </div>
           <div class="meta-item">
               <label>Unidad rendimiento</label>
               <select onchange="updPres(${i},'umRendimiento',this.value)">
                   ${UNIDADES_REN.map(u =>
                       '<option value="'+u+'"'+((p.umRendimiento||'OZ')===u?' selected':'')+'>'+u+'</option>'
                   ).join('')}
               </select>
           </div>
           <div class="meta-item">
               <label id="lbl-costoum-${i}">Costo / ${p.umRendimiento||'OZ'} (auto) ${_MXN}</label>
               <div id="costo-um-${i}" style="background:var(--surface);border:1px solid var(--green-dim);border-radius:6px;padding:8px 12px;font-size:14px;color:var(--green);font-weight:600">
                   ${(()=>{ const c = calcCostoPorUm(p.costoUnitario, p.umCosto||'LT', p.umRendimiento||'OZ'); return c ? '$'+c : '—'; })()}
               </div>
           </div>`;
       }
       return `<div class="mg-3"${show ? '' : ' style="display:none"'}>${innerHtml}</div>`;
   }

   function _renderCosteoAutoBlock(p, i, tieneCopa, esVino) {
       if (!tieneCopa) return '';

       const copaInputs = esVino ? `
           <div class="mg-3">
               <div class="meta-item">
                   <label>Tamaño de copa</label>
                   <input type="number" value="${p.tamanoCopa||''}" placeholder="150" min="0" step="0.5"
                       oninput="updPres(${i},'tamanoCopa',this.value)">
               </div>
               <div class="meta-item">
                   <label>Unidad copa</label>
                   <select onchange="updPres(${i},'umTamanoCopa',this.value);renderPresentaciones()">
                       <option value="ML" ${(p.umTamanoCopa||'ML')==='ML'?'selected':''}>ML</option>
                       <option value="OZ" ${(p.umTamanoCopa||'ML')==='OZ'?'selected':''}>OZ</option>
                   </select>
               </div>
               <div class="meta-item">
                   <label>Rendimiento en copas</label>
                   <div id="copas-rend-${i}" style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:8px 12px;font-size:14px;color:var(--accent);font-weight:600">
                       ${(()=>{ const cML=toML(p.contNeto,p.umContenido||'ML'); const tML=toML(p.tamanoCopa,p.umTamanoCopa||'ML'); return (cML>0&&tML>0)?Math.floor(cML/tML)+' copas':'\u2014'; })()}
                   </div>
               </div>
           </div>` : `
           <div class="meta-grid" style="grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-bottom:10px">
               <div class="meta-item">
                   <label>Tamaño de copa</label>
                   <input type="number" value="${p.tamanoCopa||''}" placeholder="45" min="0" step="0.5"
                       oninput="updPres(${i},'tamanoCopa',this.value)">
               </div>
               <div class="meta-item">
                   <label>Unidad copa</label>
                   <select onchange="updPres(${i},'umTamanoCopa',this.value);renderPresentaciones()">
                       <option value="ML" ${(p.umTamanoCopa||'ML')==='ML'?'selected':''}>ML</option>
                       <option value="OZ" ${(p.umTamanoCopa||'ML')==='OZ'?'selected':''}>OZ</option>
                   </select>
               </div>
               <div class="meta-item">
                   <label>Mezcladores (pzas)</label>
                   <input type="number" value="${p.mezcladores||''}" placeholder="0" min="0" step="1"
                       oninput="updPres(${i},'mezcladores',this.value)">
               </div>
               <div class="meta-item">
                   <label>Tipo mezclador</label>
                   <select onchange="updPres(${i},'tipoMezclador',this.value)">
                       ${['—','Refresco','Agua','Soda','Jugo','Cerveza','Otro'].map(t =>
                           '<option value="'+t+'"'+((p.tipoMezclador||'—')===t?' selected':'')+'>'+t+'</option>'
                       ).join('')}
                   </select>
               </div>
           </div>`;

       const copa = calcCostoCopa(p.costoUnitario, p.umCosto||'LT', p.tamanoCopa, p.umTamanoCopa||'ML');
       let cardsHtml;
       if (!copa) {
           cardsHtml = '<div style="font-size:11px;color:var(--text-dim);margin-bottom:10px">Ingresa costo unitario y tamaño de copa para ver el costeo automático</div>';
       } else {
           const costoCopaNum   = parseFloat(copa.costoCopa) || 0;
           const cu             = parseFloat(p.costoUnitario)||0;
           const contML_        = toML(p.contNeto, p.umContenido||'ML');
           const costoBot       = cu > 0 && contML_ > 0 ? cu*(contML_/1000) : 0;
           const fCopa          = parseFloat(p.factorCopa) || 3.3;
           const fBot           = parseFloat(p.factorBotella) || 2.5;
           const precioCopaAuto = (costoCopaNum * fCopa).toFixed(2);
           const precioBotAuto  = costoBot > 0 ? (costoBot * fBot).toFixed(2) : null;
           cardsHtml = '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px">'
               + '<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px;text-align:center">'
               +   '<div style="font-size:8px;letter-spacing:2px;text-transform:uppercase;color:var(--text-dim);margin-bottom:4px">Costo copa</div>'
               +   '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:20px;color:var(--text);letter-spacing:1px">$'+copa.costoCopa+'</div>'
               +   '<div style="font-size:9px;color:var(--text-dim)">'+(p.tamanoCopa||0)+' '+(p.umTamanoCopa||'ML')+'</div>'
               + '</div>'
               + '<div style="background:var(--surface);border:1px solid var(--accent);border-radius:8px;padding:10px;text-align:center">'
               +   '<div style="font-size:8px;letter-spacing:2px;text-transform:uppercase;color:var(--accent);margin-bottom:4px">Precio copa \xd7'+fCopa+'</div>'
               +   '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:20px;color:var(--accent);letter-spacing:1px">$'+precioCopaAuto+'</div>'
               +   '<div style="font-size:9px;color:var(--text-dim)">sugerido carta</div>'
               + '</div>'
               + '<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px;text-align:center">'
               +   '<div style="font-size:8px;letter-spacing:2px;text-transform:uppercase;color:var(--text-dim);margin-bottom:4px">Costo botella</div>'
               +   '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:20px;color:var(--text);letter-spacing:1px">'+(costoBot>0?'$'+costoBot.toFixed(2):'—')+'</div>'
               +   '<div style="font-size:9px;color:var(--text-dim)">'+(contML_>0?contML_+' ML':'sin contenido')+'</div>'
               + '</div>'
               + '<div style="background:var(--surface);border:1px solid var(--green);border-radius:8px;padding:10px;text-align:center">'
               +   '<div style="font-size:8px;letter-spacing:2px;text-transform:uppercase;color:var(--green);margin-bottom:4px">Precio bot. \xd7'+fBot+'</div>'
               +   '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:20px;color:var(--green);letter-spacing:1px">'+(precioBotAuto?'$'+precioBotAuto:'—')+'</div>'
               +   '<div style="font-size:9px;color:var(--text-dim)">sugerido carta</div>'
               + '</div>'
               + '</div>';
       }

       return `<div style="padding-top:12px;border-top:1px solid var(--border)">
           <div style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--accent);margin-bottom:10px">Costeo automático</div>
           ${copaInputs}
           <div style="display:flex;align-items:center;gap:16px;margin-bottom:10px;padding:5px 10px;background:rgba(255,255,255,0.03);border-radius:6px">
               <span style="font-size:10px;color:var(--text-dim);letter-spacing:.05em;opacity:.5;white-space:nowrap;text-transform:uppercase">Factores \xd7</span>
               <div style="display:flex;align-items:center;gap:6px;flex:1">
                   <label style="font-size:11px;color:var(--text-dim);opacity:.6;white-space:nowrap;margin:0">copa</label>
                   <span style="color:var(--text-dim);font-size:11px;opacity:.4">\xd7</span>
                   <input type="number" value="${p.factorCopa||'3.3'}" placeholder="3.3" min="0.1" step="0.1"
                       style="color:var(--accent);flex:1;min-width:0;font-size:13px;padding:4px 8px;background:rgba(245,200,66,.06);border-color:rgba(245,200,66,.2)"
                       oninput="updPres(${i},'factorCopa',this.value)">
               </div>
               <div style="display:flex;align-items:center;gap:6px;flex:1">
                   <label style="font-size:11px;color:var(--text-dim);opacity:.6;white-space:nowrap;margin:0">botella</label>
                   <span style="color:var(--text-dim);font-size:11px;opacity:.4">\xd7</span>
                   <input type="number" value="${p.factorBotella||'2.5'}" placeholder="2.5" min="0.1" step="0.1"
                       style="color:var(--green);flex:1;min-width:0;font-size:13px;padding:4px 8px;background:rgba(61,190,122,.06);border-color:rgba(61,190,122,.2)"
                       oninput="updPres(${i},'factorBotella',this.value)">
               </div>
           </div>
           <div id="copa-cards-${i}">${cardsHtml}</div>
       </div>`;
   }

   function _renderPrecioManualBlock(p, i, campos, tieneCopa) {
       if (!campos.includes('precioManual')) return '';
       return `<div style="padding-top:12px;border-top:1px solid var(--border)">
           <div style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--green);margin-bottom:8px">Precio carta (dato del negocio)</div>
           <div class="meta-grid" style="grid-template-columns:1fr 1fr 1fr 1fr;gap:8px">
               <div class="meta-item">
                   <label>${tieneCopa ? 'Precio copa' : 'Precio unitario'} <span style="font-size:9px;letter-spacing:1px;color:var(--text-muted);font-weight:400;margin-left:4px">MXN</span></label>
                   <div style="display:flex;align-items:center;gap:4px">
                       <span style="color:var(--green);font-weight:600">$</span>
                       <input type="text" inputmode="decimal" value="${fmtPrecio(p.precioCarta)}" placeholder="0.00"
                           oninput="inputCurrency(this,${i},'precioCarta')"
                           onfocus="focusCurrency(this)"
                           onblur="blurCurrency(this,${i},'precioCarta')"
                           style="border-color:var(--green-dim);color:var(--green)">
                   </div>
               </div>
               ${tieneCopa ? `
               <div class="meta-item">
                   <label>Precio botella <span style="font-size:9px;letter-spacing:1px;color:var(--text-muted);font-weight:400;margin-left:4px">MXN</span></label>
                   <div style="display:flex;align-items:center;gap:4px">
                       <span style="color:var(--green);font-weight:600">$</span>
                       <input type="text" inputmode="decimal" value="${fmtPrecio(p.precioCartaBot)}" placeholder="0.00"
                           oninput="inputCurrency(this,${i},'precioCartaBot')"
                           onfocus="focusCurrency(this)"
                           onblur="blurCurrency(this,${i},'precioCartaBot')"
                           style="border-color:var(--green-dim);color:var(--green)">
                   </div>
               </div>` : '<div class="meta-item"></div>'}
               <div class="meta-item">
                   <label>Stock mínimo</label>
                   <input type="number" value="${p.stockMin||''}" placeholder="0" min="0" step="1"
                       oninput="updPres(${i},'stockMin',this.value)">
               </div>
               <div class="meta-item">
                   <label>Stock máximo</label>
                   <input type="number" value="${p.stockMax||''}" placeholder="0" min="0" step="1"
                       oninput="updPres(${i},'stockMax',this.value)">
               </div>
           </div>
       </div>`;
   }

   function renderPresentaciones() {
       const cfg    = TIPO_CONFIG[tipoInsumoActual] || TIPO_CONFIG['destilado'];
       const campos = cfg.campos;
       const esBebidaCompleta = ['destilado','licor','vino'].includes(tipoInsumoActual);
       const esVino           = tipoInsumoActual === 'vino';
       const esRefresco       = tipoInsumoActual === 'refresco';
       const esCerveza        = ['cerveza','cerveza_barril'].includes(tipoInsumoActual);
       const esBarril         = tipoInsumoActual === 'cerveza_barril';
       const esRefrescoCerv   = esRefresco || esCerveza;
       const esCarne          = tipoInsumoActual === 'carne';
       const esFruta          = tipoInsumoActual === 'fruta';
       const esCarneOFruta    = esCarne || esFruta;
       const esAbarrote       = tipoInsumoActual === 'abarrote';
       const tienePeso        = campos.includes('peso');
       const tieneCopa        = campos.includes('copa');
       const tienePresCompra  = campos.includes('presentacionCompra');
   
       document.getElementById('listaPresentaciones').innerHTML =
           presentacionesTemp.map((p, i) => {
               const contNeto   = parseFloat(p.contNeto)   || 0;
               const pesoUnidad = parseFloat(p.pesoUnidad) || 0;
               const umCont = (p.umContenido || 'ML').toUpperCase();
               const umPeso = (p.umPeso     || 'G').toUpperCase();
               const contNetog  = umCont === 'LT' ? contNeto * 1000 : contNeto;
               const pesoUnidag = umPeso === 'KG' ? pesoUnidad * 1000 : pesoUnidad;
               const pesoCristal = pesoUnidag > 0 && contNetog > 0
                   ? (pesoUnidag - contNetog).toFixed(0)
                   : '—';
   
               return `
               <div style="background:var(--surface2);border:1px solid var(--border);
                   border-radius:8px;padding:12px;margin-bottom:10px">
                   <div style="display:flex;justify-content:space-between;
                       align-items:center;margin-bottom:10px">
                       <span style="font-size:10px;letter-spacing:2px;
                           text-transform:uppercase;color:var(--accent)">Presentación ${i+1}</span>
                       <button class="btn-vista"
                           style="padding:2px 8px;font-size:11px;color:var(--red);border-color:var(--red)"
                           onclick="eliminarPresentacion(${i})">✕ Quitar</button>
                   </div>
   
                   ${tienePresCompra ? `
                   <!-- Presentación de compra -->
                   <div class="mg-3">
                       <div class="meta-item"><label>Presentación de compra</label>
                           <select onchange="updPres(${i},'presentacionCompra',this.value);renderPresentaciones()">
                               ${esBarril
                                   ? ['Barril','Barriles'].map(t =>
                                       `<option value="${t}" ${(p.presentacionCompra||'Barril')===t?'selected':''}>${t}</option>`).join('')
                                   : esCarne
                                   ? ['Caja','Pieza completa / Corte primario','Rack','Bolsa','Granel','Paquete porcionado','Kilo','Otro'].map(t =>
                                       `<option value="${t}" ${(p.presentacionCompra||'Caja')===t?'selected':''}>${t}</option>`).join('')
                                   : esFruta
                                   ? ['A granel — kg','Por pieza','Por manojo / atado','Por caja','Por bolsa / red','Por charola','Kilo','Otro'].map(t =>
                                       `<option value="${t}" ${(p.presentacionCompra||'A granel — kg')===t?'selected':''}>${t}</option>`).join('')
                                   : esAbarrote
                                   ? ['Pieza','Caja','Paquete','Bolsa','Costal','Tarro','Frasco','Lata','Kilo','Litro','Otro'].map(t =>
                                       `<option value="${t}" ${(p.presentacionCompra||'Pieza')===t?'selected':''}>${t}</option>`).join('')
                                   : ['Pieza','Caja','Rejilla','Paquete','Rack','Bolsa','Lata','Botella','Frasco','Kilo','Gramo','Litro','Otro'].map(t =>
                                       `<option value="${t}" ${(p.presentacionCompra||'Pieza')===t?'selected':''}>${t}</option>`).join('')
                               }
                           </select>
                       </div>
                       <div class="meta-item"><label>${esBarril ? 'Litros del barril' : esCarne ? 'Cantidad / Piezas' : esFruta ? 'Cantidad / Kilos o Piezas' : esAbarrote ? 'Piezas / Cantidad' : 'Cantidad'}</label>
                           <input type="number" value="${p.cantPresCompra||''}" placeholder="${esBarril?'20':esCarneOFruta?'10':'1'}"
                               oninput="updPres(${i},'cantPresCompra',this.value)">
                       </div>
                       <div class="meta-item"><label>Unidad</label>
                           ${esBarril
                               ? `<div style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:9px 12px;font-size:14px;color:var(--text-dim)">LT</div>`
                               : `<select onchange="updPres(${i},'umPresCompra',this.value);renderPresentaciones()">
                                   ${(esFruta ? ['KG','G','PZA','CARGA','PORCION'] : ['PZA','G','KG','ML','LT','PORCION']).map(u =>
                                       `<option value="${u}" ${(p.umPresCompra||(esFruta?'KG':'PZA'))===u?'selected':''}>${u}</option>`
                                   ).join('')}
                                  </select>`
                           }
                       </div>
                   </div>` : ''}

                   <!-- Proveedor/Zona (todos los tipos) -->
                   <div class="mg-2">
                       <div class="meta-item">
                           <label>Proveedor</label>
                           <input type="text" value="${p.proveedor||''}" placeholder="${esCarne ? 'Ej. Carnes Selectas, La Superior, Don Jorge' : esFruta ? 'Ej. Mercado Central, Central de Abasto, Distribuidor local' : esRefrescoCerv ? 'Ej. Grupo Modelo' : 'Ej. Viños América'}"
                               oninput="updPres(${i},'proveedor',this.value)">
                       </div>
                       <div class="meta-item">
                           <label>Zona / Ciudad</label>
                           <input type="text" value="${p.zona||''}" placeholder="${esRefrescoCerv ? 'Ej. CDMX' : 'Ej. Morelia'}"
                               oninput="updPres(${i},'zona',this.value)">
                       </div>
                   </div>

                   <!-- FILA 1: Contenido / Peso compra · Unidad -->
                   <div class="mg-2">
                       <div class="meta-item">
                           <label>${esBarril ? 'Contenido por vaso/jarra' : 'Contenido por pieza'}</label>
                           <input type="number" value="${p.contNeto}" placeholder="${esCarne?'1000':esAbarrote?'500':'700'}"
                               oninput="updPres(${i},'contNeto',this.value)">
                       </div>
                       <div class="meta-item">
                           <label>Unidad</label>
                           <select onchange="updPres(${i},'umContenido',this.value);renderPresentaciones()">
                               ${UNIDADES.map(u =>
                                   `<option value="${u}" ${p.umContenido===u?'selected':''}>${u}</option>`
                               ).join('')}
                           </select>
                       </div>
                   </div>

                   <!-- Masa drenada (solo abarrotes) -->
                   ${esAbarrote ? `<div class="mg-2">
                       <div class="meta-item">
                           <label>Masa drenada</label>
                           <input type="number" value="${p.masaDrenada||''}" placeholder="0"
                               oninput="updPres(${i},'masaDrenada',this.value)">
                       </div>
                       <div class="meta-item">
                           <label>Unidad</label>
                           <select onchange="updPres(${i},'umMasaDrenada',this.value);renderPresentaciones()">
                               ${['G','KG','ML','LT'].map(u =>
                                   `<option value="${u}" ${(p.umMasaDrenada||'G')===u?'selected':''}>${u}</option>`
                               ).join('')}
                           </select>
                       </div>
                   </div>` : ''}


                   <!-- Precio de compra -->
                   <div class="mg-1">
                       <div class="meta-item">
                           <label>Precio de compra <span style="font-size:9px;letter-spacing:1px;color:var(--text-muted);font-weight:400;margin-left:4px">MXN</span></label>
                           <div style="display:flex;align-items:center;gap:4px">
                               <span style="color:var(--accent);font-weight:600;font-size:14px">$</span>
                               <input type="text" inputmode="decimal" value="${fmtPrecio(p.precio)}" placeholder="0.00"
                                   style="color:var(--accent);border-color:var(--accent-dim)"
                                   oninput="inputPrecioRaw(this,${i})"
                                   onfocus="focusPrecioInput(this)"
                                   onblur="blurPrecioInput(this,${i})">
                           </div>
                       </div>
                   </div>

                   <!-- Incluye impuesto -->
                   <div class="mg-1">
                       <div class="meta-item">
                           <label>Incluye impuesto</label>
                           <select onchange="updPres(${i},'incluyeImpuesto',this.value);renderPresentaciones()">
                               <option value="0" ${p.incluyeImpuesto==='0'?'selected':''}>No</option>
                               <option value="1" ${p.incluyeImpuesto==='1'?'selected':''}>Sí (IVA)</option>
                               <option value="2" ${p.incluyeImpuesto==='2'?'selected':''}>Sí (IVA + IEPS)</option>
                           </select>
                       </div>
                   </div>

                   <!-- IMPUESTOS -->
                   ${_renderImpuestosBlock(p, i)}
   
                   <!-- FILA 2: Costos calculados -->
                   ${_renderFilaCostosBlock(p, i, {esBarril, esRefrescoCerv, esBebidaCompleta, esAbarrote, esCarne: esCarneOFruta})}
   
   


                   <!-- FILA 4: Precio sugerido (bebidas, no abarrotes ni proteínas ni fruta) -->
                   ${!esAbarrote && !esCarneOFruta ? `<div class="mg-3">
                       ${esBarril ? `
                       <div class="meta-item">
                           <label>Precio sugerido por vaso/jarra ${_MXN}</label>
                           <div id="ref-precio-vaso-${i}" style="background:var(--surface);
                               border:1px solid var(--accent);border-radius:6px;
                               padding:8px 12px;font-size:15px;color:var(--accent);font-weight:700">
                               ${(()=>{
                                   const cp = parseFloat(p.costoPieza)||0;
                                   const fp = parseFloat(p.factorPieza)||2.0;
                                   return fmtMXN(cp * fp);
                               })()}
                           </div>
                       </div>` : esRefrescoCerv ? `
                       <div class="meta-item">
                           <label>Precio sugerido / carta ${_MXN}</label>
                           <div id="ref-precio-carta-${i}" style="background:var(--surface);
                               border:1px solid var(--accent);border-radius:6px;
                               padding:8px 12px;font-size:15px;color:var(--accent);font-weight:700">
                               ${(()=>{
                                   const cp = parseFloat(p.costoPieza)||0;
                                   const fp = parseFloat(p.factorPieza)||2.0;
                                   return fmtMXN(cp * fp);
                               })()}
                           </div>
                       </div>` : `
                       <div class="meta-item">
                           <label>Costo unitario <span style="font-size:9px;letter-spacing:1px;color:var(--text-muted);font-weight:400;margin-left:4px">MXN</span></label>
                           <div style="display:flex;align-items:center;gap:4px">
                               <span style="color:var(--accent);font-weight:600;font-size:14px">$</span>
                               <input type="text" inputmode="decimal" value="${fmtPrecio(p.costoUnitario)}" placeholder="0.00"
                                   style="color:var(--accent)"
                                   oninput="inputCurrency(this,${i},'costoUnitario')"
                                   onfocus="focusCurrency(this)"
                                   onblur="blurCurrency(this,${i},'costoUnitario')">
                           </div>
                       </div>`}
                       ${esRefrescoCerv ? `
                       <div class="meta-item">
                           <label>Factor × pieza</label>
                           <div style="display:flex;align-items:center;gap:6px">
                               <span style="color:var(--text-dim);font-size:11px;opacity:.5">×</span>
                               <input type="number" value="${p.factorPieza||'2.0'}"
                                   placeholder="2.0" min="0.1" step="0.1"
                                   style="color:var(--accent);font-size:13px;padding:4px 8px;
                                       background:rgba(245,200,66,.06);border-color:rgba(245,200,66,.2)"
                                   oninput="updPres(${i},'factorPieza',this.value)">
                           </div>
                       </div>` : `
                       <div class="meta-item">
                           <label>UM costo</label>
                           <select onchange="updPres(${i},'umCosto',this.value)">
                               ${['LT','ML','KG','G','PZA','OZ','PORCION'].map(u =>
                                   '<option value="'+u+'"'+((p.umCosto||'LT')===u?' selected':'')+'>'+u+'</option>'
                               ).join('')}
                           </select>
                       </div>`}
                   </div>` : ''}
   

                   <!-- FILA 5: Peso botella (solo destilados/vinos) -->
                   ${tienePeso ? `
                   <div class="mg-3">` : '<div style="display:none">'}
                       <div class="meta-item">
                           <label>Peso botella llena</label>
                           <input type="number" value="${p.pesoUnidad||''}" placeholder="1310"
                               oninput="updPres(${i},'pesoUnidad',this.value)">
                       </div>
                       <div class="meta-item">
                           <label>Unidad peso</label>
                           <select onchange="updPres(${i},'umPeso',this.value);renderPresentaciones()">
                               ${['G','KG','ML','LT'].map(u =>
                                   `<option value="${u}" ${(p.umPeso||'G')===u?'selected':''}>${u}</option>`
                               ).join('')}
                           </select>
                       </div>
                       <div class="meta-item">
                           <label>Peso cristal (auto)</label>
                           <div id="cristal-${i}" style="background:var(--surface);border:1px solid var(--border);
                               border-radius:6px;padding:8px 12px;font-size:13px;
                               color:var(--green);font-weight:500">
                               ${pesoCristal} g
                           </div>
                       </div>
                   </div>
                   ${tienePeso ? '' : '</div>'}
   


                   <!-- NOTAS -->
                   <div class="mg-1">
                       <div class="meta-item">
                           <label>Notas de presentación y compra</label>
                           <input type="text" value="${p.notas||''}" placeholder="Opcional"
                               oninput="updPres(${i},'notas',this.value)">
                       </div>
                   </div>
   
                   <!-- ── COSTEO AUTOMÁTICO (solo bebidas) ──── -->
                   ${_renderCosteoAutoBlock(p, i, tieneCopa, esVino)}
   
                   <!-- ── PRECIO CARTA (dato manual) ──────────── -->
                   ${_renderPrecioManualBlock(p, i, campos, tieneCopa)}
   
               </div>`;
           }).join('');
   }
   
   // ── Guardar insumo ────────────────────────────────────────────
   function guardarInsumo() {
       const nombre = document.getElementById('ins-nombre').value.trim();
       if (!nombre) { alert('El nombre es obligatorio'); return; }
   
       const fotoAnterior = editandoId
           ? getInsumos().find(x => x.id === editandoId)?.foto || ''
           : '';
   
       // Asegurar familia auto-rellenada antes de guardar
       var famEl = document.getElementById('ins-familia');
       if (famEl && !famEl.value) famEl.value = FAMILIA_POR_TIPO[tipoInsumoActual] || '';

       const insumo = {
           id:           editandoId || genId(),
           tipoInsumo:   tipoInsumoActual,
           nombre,
           familia:      document.getElementById('ins-familia').value.trim(),
           categoria:    document.getElementById('ins-categoria').value.trim(),
           subcategoria: document.getElementById('ins-subcategoria').value.trim(),
           marca:        document.getElementById('ins-marca').value.trim(),
           variedad:     document.getElementById('ins-variedad').value.trim(),
           maduracion:        document.getElementById('ins-maduracion').value.trim(),
           tempConservacion:  document.getElementById('ins-tempConservacion').value.trim(),
           vidaUtilAbrir:     (function(){
               var n = document.getElementById('ins-vidaUtilAbrirNum');
               var u = document.getElementById('ins-vidaUtilAbrirUnidad');
               if (n && u) return (n.value + ' ' + u.value).trim();
               var el = document.getElementById('ins-vidaUtilAbrir');
               return el ? el.value.trim() : '';
           })(),
           empaque:           document.getElementById('ins-empaque').value.trim(),
           comoCongelar:      (function(){ var el = document.getElementById('ins-comoCongelar'); return el ? el.value.trim() : ''; })(),
           vidaUtilCongelado: (function(){
               var n = document.getElementById('ins-vidaUtilCongeladoNum');
               var u = document.getElementById('ins-vidaUtilCongeladoUnidad');
               if (n && u) return (n.value + ' ' + u.value).trim();
               var el = document.getElementById('ins-vidaUtilCongelado');
               return el ? el.value.trim() : '';
           })(),
           notas:        document.getElementById('ins-notas').value.trim(),
           activo:       document.getElementById('ins-activo').value || '1',
           foto:         fotoInsumoBase64 || fotoAnterior,
           presentaciones: presentacionesTemp
       };
   
       const lista = getInsumos();
       if (editandoId) {
           const i = lista.findIndex(x => x.id === editandoId);
           if (i >= 0) lista[i] = insumo; else lista.push(insumo);
       } else {
           lista.push(insumo);
       }
   
       setInsumos(lista);
       modalDirty = false;
       if (_soloMode) {
           window.parent.postMessage({ type: 'insumoGuardado', insumoId: insumo.id }, '*');
           return;
       }
       cerrarModalBtn();
       init();
   }
   
   // ── Ficha técnica ─────────────────────────────────────────────
   function verFicha(id) {
       const ins = getInsumos().find(x => x.id === id);
       if (!ins) return;
   
       const pres = ins.presentaciones || [];
   
       document.getElementById('fichaContenido').innerHTML = `
           <div style="display:flex;gap:16px;align-items:flex-start;
               padding-bottom:16px;border-bottom:1px solid var(--border);margin-bottom:16px">
               <div style="width:90px;height:90px;background:var(--surface2);border-radius:8px;
                   border:1px solid var(--border);overflow:hidden;flex-shrink:0;
                   display:flex;align-items:center;justify-content:center;font-size:28px;color:var(--text-dim)">
                   ${ins.foto ? `<img src="${ins.foto}" style="width:100%;height:100%;object-fit:cover">` : '📦'}
               </div>
               <div style="flex:1">
                   <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;
                       color:var(--accent);margin-bottom:4px">
                       ${[ins.familia, ins.categoria, ins.subcategoria].filter(Boolean).join(' · ')}
                   </div>
                   <div style="font-size:22px;font-weight:600;color:var(--text);margin-bottom:4px">${ins.nombre}</div>
                   <div style="font-size:13px;color:var(--text-muted)">
                       ${[ins.marca, ins.variedad, ins.maduracion].filter(Boolean).join(' · ')}
                   </div>
                   ${ins.empaque ? `<div style="font-size:11px;color:var(--text-dim);margin-top:4px">${ins.empaque}</div>` : ''}
               </div>
               <span class="pill ${ins.activo==='1'?'pill-amber':'pill-red'}" style="flex-shrink:0">
                   ${ins.activo==='1'?'Activo':'Inactivo'}
               </span>
           </div>
   
           <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;
               color:var(--text-dim);margin-bottom:10px">Presentaciones</div>
   
           ${pres.length ? pres.map(p => `
               <div style="background:var(--surface2);border:1px solid var(--border);
                   border-radius:8px;padding:12px;margin-bottom:8px">
                   <div style="display:flex;justify-content:space-between;
                       align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px">
                       <div>
                           <span style="font-size:15px;font-weight:500;color:var(--text)">
                               ${p.contNeto} ${p.umContenido}
                           </span>
                           ${p.pesoUnidad ? `<span style="font-size:11px;color:var(--text-dim);margin-left:8px">· ${p.pesoUnidad} ${p.umPeso||'G'} llena</span>` : ''}
                           ${p.pesoCristal ? `<span style="font-size:11px;color:var(--text-dim);margin-left:4px">· cristal ${p.pesoCristal}g</span>` : ''}
                       </div>
                       <div style="text-align:right">
                           ${p.precio ? `
                           <div style="font-size:16px;font-weight:600;color:var(--text)">
                               $${(+p.precio).toFixed(2)}
                           </div>
                           <div style="font-size:10px;color:var(--text-dim);margin-top:1px">precio de compra</div>` : ''}
                           ${p.costoUnitario ? `
                           <div style="font-size:12px;font-weight:500;color:var(--green);margin-top:4px">
                               $${(+p.costoUnitario).toFixed(2)} / ${p.umCosto||'LT'}
                           </div>` : ''}
                       </div>
                   </div>
                   <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:6px">
                       ${p.rendimiento ? `<span style="font-size:12px;font-weight:500;color:var(--accent)">🥃 ${p.rendimiento} ${p.umRendimiento||'OZ'} por botella</span>` : ''}
                       ${p.proveedor   ? `<span style="font-size:11px;color:var(--text-muted)">🏪 ${p.proveedor}</span>` : ''}
                       ${p.zona        ? `<span style="font-size:11px;color:var(--text-muted)">📍 ${p.zona}</span>` : ''}
                       ${p.marcaComercial ? `<span style="font-size:11px;color:var(--text-muted)">🏷️ ${p.marcaComercial}</span>` : ''}
                       ${p.incluyeImpuesto==='1' ? `<span style="font-size:11px;color:var(--accent)">IVA incluido</span>` : ''}
                   </div>
                   ${(p.precioCarta || p.precioCartaBot) ? `
                   <div style="background:var(--surface);border-radius:6px;padding:8px 10px;display:flex;gap:16px;flex-wrap:wrap">
                       ${p.precioCarta    ? `<span style="font-size:12px;color:var(--green)">Copa: $${(+p.precioCarta).toFixed(2)}</span>` : ''}
                       ${p.precioCartaBot ? `<span style="font-size:12px;color:var(--green)">Botella: $${(+p.precioCartaBot).toFixed(2)}</span>` : ''}
                       ${p.stockMin ? `<span style="font-size:11px;color:var(--text-dim)">Stock min: ${p.stockMin}</span>` : ''}
                       ${p.stockMax ? `<span style="font-size:11px;color:var(--text-dim)">Stock max: ${p.stockMax}</span>` : ''}
                   </div>` : ''}
                   ${p.notas ? `<div style="font-size:11px;color:var(--text-dim);margin-top:6px">${p.notas}</div>` : ''}
               </div>`).join('')
           : '<div style="color:var(--text-dim);font-size:13px">Sin presentaciones registradas</div>'}
   
           ${(ins.tipoInsumo === 'fruta' && (ins.maduracion || ins.tempConservacion || ins.vidaUtilAbrir || ins.vidaUtilCongelado || ins.comoCongelar || ins.subcategoria)) ? `
               <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
                   <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--text-dim);margin-bottom:10px">🥬 Almacenaje y vida útil</div>
                   <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;color:var(--text-muted)">
                       ${ins.maduracion       ? `<div><span style="color:var(--text-dim)">Tipo de compra: </span>${ins.maduracion}</div>` : ''}
                       ${ins.tempConservacion ? `<div><span style="color:var(--text-dim)">Almacenaje: </span>${ins.tempConservacion}</div>` : ''}
                       ${ins.vidaUtilAbrir    ? `<div><span style="color:var(--text-dim)">Vida útil fresca: </span>${ins.vidaUtilAbrir}</div>` : ''}
                       ${ins.vidaUtilCongelado? `<div><span style="color:var(--text-dim)">V. útil congelado: </span>${ins.vidaUtilCongelado}</div>` : ''}
                       ${ins.comoCongelar     ? `<div style="grid-column:span 2"><span style="color:var(--text-dim)">Cómo congelar: </span>${ins.comoCongelar}</div>` : ''}
                       ${ins.subcategoria     ? `<div style="grid-column:span 2"><span style="color:var(--text-dim)">Descongelación: </span>${ins.subcategoria}</div>` : ''}
                   </div>
               </div>` : ''}

           ${ins.notas ? `
               <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
                   <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;
                       color:var(--text-dim);margin-bottom:6px">Notas</div>
                   <p style="font-size:13px;color:var(--text-muted);line-height:1.7">${ins.notas}</p>
               </div>` : ''}
       `;
   
       document.getElementById('modalFicha').style.display = 'flex';
   }
   
   function cerrarFicha(e) {
       if (e.target === document.getElementById('modalFicha'))
           document.getElementById('modalFicha').style.display = 'none';
   }
   
   // ══════════════════════════════════════════════════════════════
   // IMPORTADOR CSV — vinculación por POSICIÓN DE FILA
   // Las 3 hojas tienen 201 filas alineadas: fila N de productos
   // corresponde a fila N de presentaciones y costos.
   // ══════════════════════════════════════════════════════════════
   
   function abrirImportar() {
       document.getElementById('modalImportar').style.display = 'flex';
       ['status1','status2','status3'].forEach(id => {
           document.getElementById(id).textContent = '—';
           document.getElementById(id).style.color = 'var(--text-dim)';
       });
   }
   
   function cerrarImportar(e) {
       if (e.target === document.getElementById('modalImportar'))
           document.getElementById('modalImportar').style.display = 'none';
   }
   
   function onDropCSV(e, tipo) {
       e.preventDefault();
       const file = e.dataTransfer.files[0];
       if (file) importarArchivo(file, tipo);
   }
   
   function importarProductos(input)     { if (input.files[0]) importarArchivo(input.files[0], 'prod'); }
   function importarPresentaciones(input){ if (input.files[0]) importarArchivo(input.files[0], 'pres'); }
   function importarCostos(input)        { if (input.files[0]) importarArchivo(input.files[0], 'cost'); }
   
   // ── Parser CSV robusto ────────────────────────────────────────
   function parseCSV(texto) {
       // Divide respetando comillas
       function splitLine(line) {
           const result = [];
           let cur = '', inQ = false;
           for (let i = 0; i < line.length; i++) {
               const c = line[i];
               if (c === '"') { inQ = !inQ; continue; }
               if (c === ',' && !inQ) { result.push(cur.trim()); cur = ''; continue; }
               cur += c;
           }
           result.push(cur.trim());
           return result;
       }
   
       const lines = texto.split('\n').filter(l => l.trim());
       const header = splitLine(lines[0]).map(h =>
           h.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
            .replace(/\s+/g,'_')
       );
   
       return lines.slice(1).map((line, rowIndex) => {
           const cols = splitLine(line);
           const obj  = { _rowIndex: rowIndex };
           header.forEach((h, i) => obj[h] = (cols[i] || '').trim());
           return obj;
       }).filter(r => Object.values(r).some(v => v && v !== ''));
   }
   
   // ── Importar archivo ──────────────────────────────────────────
   function importarArchivo(file, tipo) {
       const reader = new FileReader();
       reader.onload = e => {
           const rows = parseCSV(e.target.result);
           if (!rows.length) { setStatus(tipo==='prod'?1:tipo==='pres'?2:3, '❌ Archivo vacío'); return; }
           if (tipo === 'prod') procesarProductos(rows);
           if (tipo === 'pres') procesarPresentaciones(rows);
           if (tipo === 'cost') procesarCostos(rows);
       };
       reader.readAsText(file, 'UTF-8');
   }
   
   // ── PASO 1: Productos ─────────────────────────────────────────
   function procesarProductos(rows) {
       // Limpiamos insumos importados anteriormente y reconstruimos
       const lista    = getInsumos().filter(x => !x._csvRow && x._csvRow !== 0);
       let nuevos = 0, actualizados = 0;
   
       rows.forEach((r, idx) => {
           const nombre = (r['nombre_base'] || r['nombre'] || '').trim();
           if (!nombre) return;
   
           const activo = (r['activo_inactivo']||'').toUpperCase();
   
           const datos = {
               _csvRow:      idx,                          // índice para vincular con las otras hojas
               nombre,
               familia:      r['familia']       || 'Bebidas',
               categoria:    r['categoria']     || r['categoría'] || '',
               subcategoria: r['sub__categoria']|| r['sub_categoria'] || '',
               variedad:     r['variedad_base'] || '',
               maduracion:   r['maduracion']    || r['maduración'] || '',
               marca:        r['marca_base']    || '',
               empaque:      r['tipo_de_empaque']|| '',
               notas:        r['notas_detalles'] || '',
               activo:       activo === 'FALSE' ? '0' : '1',
               foto:         '',
               presentaciones: []
           };
   
           // Si ya existe por nombre lo actualizamos
           const existe = lista.find(x =>
               x.nombre.toLowerCase() === nombre.toLowerCase() &&
               (x.variedad||'').toLowerCase() === (datos.variedad||'').toLowerCase()
           );
   
           if (existe) {
               Object.assign(existe, datos);
               actualizados++;
           } else {
               lista.push({ id: genId(), ...datos });
               nuevos++;
           }
       });
   
       setInsumos(lista);
       setStatus(1, `✅ ${nuevos} nuevos · ${actualizados} actualizados`);
       // No llamar init() aquí — se renderiza solo al finalizar el paso 3
   }
   
   // ── PASO 2: Presentaciones — vincula por posición de fila ─────
   function procesarPresentaciones(rows) {
       const lista = getInsumos();
       // Ordenar por _csvRow para asegurar el índice correcto
       const porFila = lista
           .filter(x => x._csvRow !== undefined)
           .sort((a,b) => a._csvRow - b._csvRow);
   
       let vinculados = 0, sinVincular = 0;
   
       rows.forEach((r, idx) => {
           // Buscar el insumo que corresponde a esta fila
           const insumo = porFila[idx] || lista.find(x => x._csvRow === idx);
   
           if (!insumo) { sinVincular++; return; }
   
           const contNeto   = parseFloat(r['cont_neto'])   || 0;
           const pesoUnidad = parseFloat(r['peso_unidad']) || 0;
           // Normalizar unidades: el CSV puede traer "ml" con valor 0.700 (que es LT)
           // o "gr"/"g" con valor 1.310 (que es KG). Detectamos por magnitud.
           let umCont = (r['um_cont_neto']   || 'ML').toUpperCase().replace('GR','G');
           let umPeso = (r['um_peso_unidad'] || 'G').toUpperCase().replace('GR','G');
           // Si contNeto < 5 con ML → casi seguro está en LT
           if (umCont === 'ML' && contNeto > 0 && contNeto < 5) umCont = 'LT';
           // Si pesoUnidad < 5 con G → casi seguro está en KG
           if (umPeso === 'G'  && pesoUnidad > 0 && pesoUnidad < 5) umPeso = 'KG';
           const contNetog  = umCont === 'LT' ? contNeto * 1000 : contNeto;
           const pesoUnidag = umPeso === 'KG' ? pesoUnidad * 1000 : pesoUnidad;
           const pesoCristal = contNetog > 0 && pesoUnidag > 0
               ? (pesoUnidag - contNetog).toFixed(0)
               : '';
   
           const pres = {
               id:            genId(),
               contNeto:      r['cont_neto']    || '',
               umContenido:   umCont,
               masaDrenada:   r['masa_drenada'] || '',
               rendimiento:   r['rendimiento']  || '',
               umRendimiento: (r['um_rendimiento'] || 'OZ').toUpperCase(),
               pesoUnidad:    r['peso_unidad']  || '',
               umPeso:        umPeso,
               pesoCristal,
               proveedor:     '',
               zona:          '',
               fecha:         '',
               precio:        '',
               costoUnitario: '',
               umCosto:       'LT',
               marcaComercial:'',
               incluyeImpuesto: '0',
               notas:         r['notas'] || '',
               precioCarta:   '',
               precioCartaBot:'',
               stockMin:      '',
               stockMax:      ''
           };
   
           // Reemplazar presentaciones existentes de esta importación
           insumo.presentaciones = [pres];
           vinculados++;
       });
   
       setInsumos(lista);
       setStatus(2, `✅ ${vinculados} vinculadas · ${sinVincular} sin vincular`);
       // No llamar init() aquí — se renderiza solo al finalizar el paso 3
   }
   
   // ── PASO 3: Costos — vincula por posición de fila ─────────────
   function procesarCostos(rows) {
       const lista = getInsumos();
       const porFila = lista
           .filter(x => x._csvRow !== undefined)
           .sort((a,b) => a._csvRow - b._csvRow);
   
       let vinculados = 0, sinVincular = 0;
   
       // Limpia $, comas y espacios — devuelve string numérico o vacío
       const limpiarNum = v => {
           const s = (v || '').toString().replace(/[$,\s]/g, '');
           const n = parseFloat(s);
           return isNaN(n) ? '' : String(n);
       };
   
       rows.forEach((r, idx) => {
           const insumo = porFila[idx] || lista.find(x => x._csvRow === idx);
           if (!insumo || !insumo.presentaciones?.length) { sinVincular++; return; }
   
           const pres = insumo.presentaciones[0];
   
           pres.proveedor       = (r['provedor']         || r['proveedor']        || '').trim();
           pres.zona            = (r['zona']              || '').trim();
           pres.fecha           = (r['fecha']             || '').trim();
           pres.precio          = limpiarNum(r['precio_compra']);
           pres.marcaComercial  = (r['marca_comercial']   || r['marca comercial'] || '').trim();
           pres.costoUnitario   = limpiarNum(r['costo_unitario']);
           pres.umCosto         = (r['um_costo_unitario'] || r['um_costo_unitarioi'] || 'LT').trim().toUpperCase();
           pres.incluyeImpuesto = (r['incluye_impuesto']  || '').toUpperCase().includes('IVA') ? '1' : '0';
           pres.observaciones   = (r['observaciones']     || '').trim();
   
           vinculados++;
       });
   
       setInsumos(lista);
       setStatus(3, `✅ ${vinculados} costos vinculados · ${sinVincular} sin vincular`);
       init();
   }
   
   // ── Status helper ─────────────────────────────────────────────
   function setStatus(paso, msg) {
       const el = document.getElementById(`status${paso}`);
       if (!el) return;
       el.textContent = msg;
       el.style.color = msg.includes('✅') ? 'var(--green)' : 'var(--red)';
   }
   
   // ── Navegación Enter / Tab en modal ──────────────────────────
   document.addEventListener('keydown', function(e) {
       // Solo actuar dentro del modal de insumo
       const modal = document.getElementById('modalOverlay');
       if (!modal || modal.style.display === 'none') return;
       if (e.key !== 'Enter' && e.key !== 'Tab') return;
       if (e.target.tagName === 'TEXTAREA') return;
       if (e.target.tagName === 'SELECT') return;
   
       // En inputs de texto/número: Enter avanza al siguiente campo
       if (e.key === 'Enter') {
           e.preventDefault();
           const focusable = [...modal.querySelectorAll('input, select, button, textarea')]
               .filter(el => !el.disabled && el.offsetParent !== null);
           const idx = focusable.indexOf(e.target);
           if (idx >= 0 && focusable[idx + 1]) focusable[idx + 1].focus();
       }
   });
   
   // ── Init ──────────────────────────────────────────────────────
   function init() {
       renderStats();
       cargarFiltros();
       filtrar();
   }
   
   init();