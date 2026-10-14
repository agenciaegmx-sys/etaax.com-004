/* Selector de módulos del hub. Las herramientas conservan sus páginas y guardas.
   Permisos de entrada: mismas claves que los destinos en page-guard.js. */
(function () {
    'use strict';
    var dock = document.getElementById('hubModuloDock');
    if (!dock) return;
    var MODULOS = [
        { id: 'administrativo', portada: 'administrativo/index.html', nombre: 'Control administrativo', icono: 'mod-control-administrativo', descripcion: 'Registra y coordina la operación diaria de esta sucursal.', herramientas: [
            { nombre: 'Ventas y gastos diarios', clave: 'diario', ruta: 'administrativo/diario.html', icono: 'mod-control-administrativo', etiqueta: 'Captura diaria', permiso: ['ventas', 'gastos'], descripcion: 'Registra cortes, gastos, depósitos y los movimientos de tu operación.', funciones: ['Todo lo que puedes hacer aquí', 'Los cortes del período, con su venta y su resguardo', 'Capturar el corte del día, forma de pago por forma de pago', 'Los gastos del día, con factura y evidencia', 'Registrar un gasto: método, previsión y comprobante', 'Pagar las nóminas del período', 'Gastos fijos: renta, servicios y obligaciones del mes', 'Depósitos, retiros y dinero apartado en previsiones', 'Ventas especiales y anticipos, fuera de la operación diaria', 'Caja fuerte: efectivo acumulado, bancos y tarjetas'] },
            { nombre: 'Gestión de colaboradores', clave: 'staff', ruta: 'administrativo/staff-hub.html', icono: 'cat-colaboradores', etiqueta: 'Equipo', permiso: ['staff'], descripcion: 'Consulta personal, nóminas, horarios, perfiles y evaluaciones.', funciones: ['Todo lo que hay en Gestión de Staff', 'El catálogo: puesto, rol de acceso y pago de nómina', 'El rol semanal, con la cobertura de cada día', 'Checklists de apertura, cierre y limpieza', 'Su QR: el colaborador entra con su NIP y queda su firma', 'El organigrama: quién reporta a quién', 'Perfiles de puesto, listos para imprimir', 'Evaluaciones tipo formulario, con puntuación automática'] },
            { nombre: 'Proveedores', clave: 'proveedores', ruta: 'administrativo/proveedores.html', icono: 'cat-proveedores', etiqueta: 'Directorios', permiso: ['proveedores'], descripcion: 'Organiza contactos y condiciones de abastecimiento del negocio.', funciones: ['El directorio: contactos, sucursal y forma de pago', 'Agregar proveedor: contacto, pago, facturación y expediente', 'El proveedor guardado en el directorio'] },
            { nombre: 'Clientes', clave: 'clientes', ruta: 'administrativo/clientes.html', icono: 'cat-clientes', etiqueta: 'Directorios', permiso: ['clientes'], descripcion: 'Mantén los datos y notas de tus clientes frecuentes.', funciones: ['El directorio: clientes, teléfono y correo', 'Nuevo cliente: contacto, notas y sucursal', 'El cliente guardado, con sus datos y notas'] },
            { nombre: 'Menú de la sucursal', clave: 'menu', ruta: 'administrativo/menu.html', icono: 'mod-escandallos', etiqueta: 'Carta y precios', permiso: ['menu'], descripcion: 'Organiza los platillos, bebidas y precios de tu carta activa.', funciones: ['Gestión de menú: platillos, precios y disponibilidad', 'El QR de la carta para compartirla en las mesas', 'Ajustes de la carta: apariencia, colores y tipografía'] }
        ]},
        { id: 'recetas', portada: 'recetas/index.html', nombre: 'Recetas e Insumos', icono: 'mod-recetas-insumos', descripcion: 'Costea recetas y controla las materias primas de esta sucursal.', herramientas: [
            { nombre: 'Escandallos', clave: 'escandallos', ruta: 'recetas/index.html?escandallos=1', icono: 'mod-escandallos', etiqueta: 'Costeo', permiso: ['recetas'], descripcion: 'Costea tus recetas, revisa el precio aplicado y consulta su rentabilidad.', funciones: ['Consultar recetas y costos, o crear una preparación', 'Receta de alimentos: datos, ingredientes y procedimiento', 'Receta de bebidas: preparación, rendimiento y costos', 'Sub-receta de alimentos: envasado, vida útil y rendimiento', 'Sub-receta de bebidas: bases, almacenamiento y costos', 'Receta simple: empieza con el nombre y sus ingredientes', 'El catálogo: buscar, filtrar y ordenar tus recetas'] },
            { nombre: 'Insumos', clave: 'insumos', ruta: 'recetas/insumos.html', icono: 'mod-insumos', etiqueta: 'Abastecimiento', permiso: ['insumos'], descripcion: 'Organiza materias primas, presentaciones y costos por proveedor.', funciones: ['El catálogo: buscar, filtrar y consultar tus insumos', 'Ficha técnica: presentaciones, proveedor y costo base', 'Editar insumo: foto, datos y presentaciones', 'Cambiar el tipo de insumo', 'Costeo: precios por copa o botella y niveles de stock', 'Agregar insumo: elige su tipo', 'Catálogo global ETAAX: encuentra y agrega productos'] },
            { nombre: 'Inventarios', clave: 'inventarios', ruta: 'recetas/inventarios.html', icono: 'mod-inventarios', etiqueta: 'Abastecimiento', permiso: ['inventarios'], descripcion: 'Controla existencias por área y registra entradas, salidas y movimientos.', funciones: ['El catálogo: inventarios, áreas y capital en existencias', 'QR de entradas: registrar movimientos desde el celular', 'Reporte de existencias y capital por área', 'Productos compuestos: unir presentaciones del mismo producto', 'Historial de entradas, mermas y cortesías', 'Nuevo inventario: sucursal, área y existencia de referencia', 'Capturar existencias: buscar productos y revisar pendientes'] },
            { nombre: 'Requisiciones', clave: 'requisiciones', ruta: 'recetas/requisiciones.html', icono: 'mod-requisiciones', etiqueta: 'Abastecimiento', permiso: ['requisiciones'], descripcion: 'Gestiona pedidos internos y compras entre áreas y sucursales.', funciones: ['Existencias: búsqueda rápida y seguimiento de pendientes', 'Lista completa: stock, existencia actual y pedido final', 'Proyección del pedido por área y proveedor', 'Pedido y exportación: compra contra venta y formatos de salida'] }
        ]},
        { id: 'financiero', portada: 'financiero/index.html', nombre: 'Salud financiera', icono: 'mod-salud-financiera', descripcion: 'Consulta los resultados y la rentabilidad de esta sucursal.', herramientas: [
            { nombre: 'Resumen financiero', clave: 'resumen', ruta: 'financiero/resumen.html', icono: 'fin-resumen-resultados', etiqueta: 'Resultados', permiso: ['financiero'], descripcion: 'Revisa ventas, egresos y utilidad del periodo en una sola vista.', funciones: ['Ingresos y egresos del periodo', 'Utilidad y margen', 'Comparativo entre sucursales'] },
            { nombre: 'Ventas totales', clave: 'ventas', ruta: 'financiero/ventas.html', icono: 'fin-ventas', etiqueta: 'Ingresos', permiso: ['financiero'], descripcion: 'Consulta tus ingresos, metas y avance de ventas por periodo.', funciones: ['Ventas por día, semana o mes', 'Meta y cumplimiento', 'Histórico semanal'] },
            { nombre: 'Gastos totales', clave: 'gastos', ruta: 'financiero/gastos-globales.html', icono: 'fin-gastos', etiqueta: 'Egresos', permiso: ['financiero'], descripcion: 'Revisa gastos fijos, variables y nóminas con sus desgloses.', funciones: ['Fijos, variables y nómina', 'Desglose por categoría', 'Egresos de todo el negocio'] },
            { nombre: 'Previsiones', clave: 'previsiones', ruta: 'financiero/previsiones.html', icono: 'fin-previsiones', etiqueta: 'Planeación', permiso: ['financiero'], descripcion: 'Planea compromisos futuros y da seguimiento al dinero apartado.', funciones: ['Compromisos futuros', 'Dinero ya apartado', 'Seguimiento de pagos'] },
            { nombre: 'Cuentas bancarias', clave: 'cuentas', ruta: 'financiero/cuentas-bancarias.html', icono: 'fin-cuentas-bancarias', etiqueta: 'Cuentas', permiso: ['financiero'], descripcion: 'Administra las cuentas y comisiones bancarias de esta sucursal.', funciones: ['Saldo por cuenta', 'Comisiones reales del corte', 'Conciliación bancaria'] },
            { nombre: 'KPIs', clave: 'kpis', ruta: 'financiero/kpis.html', icono: 'fin-kpis', etiqueta: 'Indicadores', permiso: ['financiero'], descripcion: 'Compara los porcentajes de tu operación con las metas del negocio.', funciones: ['Indicadores contra tu meta', 'Costo de insumos y nómina', 'Semáforo por rubro'] },
            { nombre: 'Estadísticas', clave: 'estadisticas', ruta: 'financiero/estadisticas.html', icono: 'fin-estadisticas', etiqueta: 'Análisis', permiso: ['financiero'], descripcion: 'Explora las tendencias de ventas, gastos y cheque promedio.', funciones: ['Tendencia de ventas', 'Cheque promedio', 'Comparativo de periodos'] }
        ]},
        { id: 'consultoria', portada: 'consultoria/index.html', nombre: 'Aprende y analiza', icono: 'mod-aprende-analiza', descripcion: 'Aprende a usar ETAAX y explora tus productos, metas y escenarios.', herramientas: [
            { nombre: 'Guías de uso', clave: 'guias', ruta: 'consultoria/guias.html', icono: 'mod-aprende-analiza', etiqueta: 'Aprende', permiso: [], descripcion: 'Consulta los manuales de ETAAX para aprovechar sus herramientas.', funciones: ['Manuales en PDF', 'Paso a paso por módulo', 'Material para tu equipo'] },
            { nombre: 'Ventas por producto', clave: 'ventas-productos', ruta: 'consultoria/ventas-productos.html', icono: 'fin-estadisticas', etiqueta: 'Analiza', permiso: ['ventas_productos'], descripcion: 'Compara periodos y descubre qué productos aportan más a tus ventas.', funciones: ['Qué producto vende más', 'Comparativo de periodos', 'Aporte de cada uno a la venta'] },
            { nombre: 'Simulador de metas', clave: 'simulador', ruta: 'consultoria/simulador-kpis.html', icono: 'fin-kpis', etiqueta: 'Planeación', permiso: ['financiero'], descripcion: 'Explora las ventas, comensales y cheque promedio necesarios para tus metas.', funciones: ['Meta de venta del mes', 'Comensales y cheque necesarios', 'Escenarios lado a lado'] }
        ]}
    ];
    var estado = null, seleccionado = '', CLAVE = 'etaax_hub_modulo', ultimoAcceso = '';
    var marcoDock = document.getElementById('hubModuloSelector') || dock;
    var acciones = document.getElementById('hubModuloAcciones');
    var panel = document.getElementById('hubHerramientas');
    var tarjetas = document.getElementById('hubHerramientasTarjetas');
    function esc(x) {
        return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    /* El visor de capturas de una herramienta. El marco reserva su alto SIEMPRE
       —con foto o sin ella—: si creciera al cargar la imagen, la fila de abajo
       se correría sola mientras alguien la está leyendo. Si la captura todavía
       no se subió, el hueco se cierra con un marco neutro y nunca con el icono
       de imagen rota, que es cómo una guía acaba pareciendo un error. */
    function visor(h, pasos) {
        if (!pasos.length) return '';
        return '<div class="hub-visor" data-paso="0" data-clave="' + esc(h.clave) + '" data-total="' + pasos.length + '">' +
            '<button type="button" class="hub-visor-marco" disabled aria-label="Ampliar captura de ' + esc(h.nombre) + '" aria-haspopup="dialog">' +
                '<img alt="" src="" hidden>' +
                '<span class="hub-visor-falta">Captura en camino</span>' +
                '<span class="hub-visor-ampliar" aria-hidden="true">' + icono('ojo', 16) + 'Ampliar</span>' +
            '</button>' +
            '<div class="hub-visor-pie">' +
                '<button type="button" class="hub-visor-nav" data-dir="-1" aria-label="Paso anterior">' + icono('flecha', 16) + '</button>' +
                '<span class="hub-visor-texto"><b class="hub-visor-cuenta"></b><span class="hub-visor-pie-txt"></span></span>' +
                '<button type="button" class="hub-visor-nav" data-dir="1" aria-label="Paso siguiente">' + icono('flecha', 16) + '</button>' +
            '</div>' +
        '</div>';
    }
    /* Pintar un paso: la imagen por su nombre previsible (`/guia/<clave>-<n>.png`)
       y el pie que explica qué se está viendo. */
    function pintarPaso(v, paso) {
        var m = buscar(seleccionado); if (!m) return;
        var fila = v.closest('[data-hub-tool]');
        var h = m.herramientas[Number(fila.dataset.hubTool)];
        var pasos = (h && h.funciones) || []; if (!pasos.length) return;
        var total = pasos.length;
        paso = ((paso % total) + total) % total;          // da la vuelta por los dos lados
        v.dataset.paso = String(paso);
        var img = v.querySelector('img'), falta = v.querySelector('.hub-visor-falta'), marco = v.querySelector('.hub-visor-marco');
        marco.disabled = true;
        falta.hidden = false; img.hidden = true;
        img.onload = function () { img.hidden = false; falta.hidden = true; marco.disabled = false; };
        img.onerror = function () { img.hidden = true; falta.hidden = false; };
        img.src = '/guia/' + h.clave + '-' + (paso + 1) + '.png';
        img.alt = h.nombre + ': ' + pasos[paso];
        v.querySelector('.hub-visor-cuenta').textContent = (paso + 1) + '/' + total;
        v.querySelector('.hub-visor-pie-txt').textContent = pasos[paso];
    }
    /* La captura ampliada comparte paso y pie con la fila original. Un dialog
       mantiene el foco dentro del visor y deja inerte el contenido de fondo. */
    var capturaDialogo = null, capturaAbierta = null;
    function cerrarCaptura(restaurarFoco) {
        if (!capturaAbierta) return;
        var anterior = capturaAbierta;
        capturaAbierta = null;
        capturaDialogo.close();
        document.body.style.overflow = anterior.overflow;
        var img = capturaDialogo.querySelector('img');
        img.onload = img.onerror = null; img.removeAttribute('src'); img.hidden = true;
        if (restaurarFoco !== false && anterior.visor.isConnected) {
            var boton = anterior.visor.querySelector('.hub-visor-marco');
            if (boton.disabled) boton = anterior.visor.querySelector('[data-dir="1"]');
            boton.focus({ preventScroll:true });
        }
    }
    function asegurarCaptura() {
        if (capturaDialogo) return;
        capturaDialogo = document.createElement('dialog');
        capturaDialogo.id = 'hubCapturaAmpliada';
        capturaDialogo.className = 'hub-captura-dialogo';
        capturaDialogo.setAttribute('aria-labelledby','hubCapturaTitulo');
        capturaDialogo.setAttribute('aria-describedby','hubCapturaPie');
        capturaDialogo.innerHTML =
            '<div class="hub-captura-head"><div><span class="hub-captura-eyebrow">Guía visual</span><h2 id="hubCapturaTitulo"></h2></div>' +
                '<div class="hub-captura-acciones"><button type="button" class="hub-captura-detalle" aria-pressed="false" disabled>Ver detalle</button>' +
                '<button type="button" class="hub-captura-cerrar" aria-label="Cerrar captura ampliada">×</button></div></div>' +
            '<div class="hub-captura-imagen"><img alt="" hidden><span class="hub-captura-estado" role="status">Cargando captura…</span></div>' +
            '<div class="hub-captura-pie"><button type="button" class="hub-visor-nav" data-dir="-1" aria-label="Captura anterior">' + icono('flecha',20) + '</button>' +
                '<div class="hub-visor-texto" aria-live="polite"><b class="hub-visor-cuenta"></b><span id="hubCapturaPie"></span></div>' +
                '<button type="button" class="hub-visor-nav" data-dir="1" aria-label="Captura siguiente">' + icono('flecha',20) + '</button></div>';
        document.body.appendChild(capturaDialogo);
        capturaDialogo.querySelector('.hub-captura-cerrar').onclick = function () { cerrarCaptura(); };
        capturaDialogo.addEventListener('cancel',function(e){e.preventDefault();cerrarCaptura();});
        capturaDialogo.addEventListener('close',function(){
            /* El cierre nativo se notifica después: no debe cerrar una captura
               que ya se abrió de nuevo durante ese intervalo. */
            if (!capturaDialogo.open) cerrarCaptura();
        });
        capturaDialogo.addEventListener('keydown',function(e){
            if (e.key === 'Escape') { e.preventDefault();e.stopPropagation();cerrarCaptura(); }
            else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault();e.stopPropagation();moverCaptura(e.key === 'ArrowLeft' ? -1 : 1); }
        });
        capturaDialogo.addEventListener('click',function(e){
            var nav = e.target.closest('.hub-visor-nav');
            if (nav) moverCaptura(Number(nav.dataset.dir));
            if (e.target === capturaDialogo) {
                var r = capturaDialogo.getBoundingClientRect();
                if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) cerrarCaptura();
            }
        });
        capturaDialogo.querySelector('.hub-captura-detalle').onclick = function () {
            var marco = capturaDialogo.querySelector('.hub-captura-imagen');
            var img = marco.querySelector('img'), ancho = Math.max(img.naturalWidth,img.clientWidth*2);
            var ampliada = marco.classList.toggle('hub-captura-natural');
            img.style.width = ampliada ? ancho + 'px' : '';
            this.setAttribute('aria-pressed',String(ampliada));this.textContent = ampliada ? 'Ajustar imagen' : 'Ver detalle';
            marco.scrollTop = marco.scrollLeft = 0;
        };
    }
    function pintarCaptura() {
        if (!capturaAbierta) return;
        var c = capturaAbierta, pasos = c.herramienta.funciones;
        var img = capturaDialogo.querySelector('img'), marco = capturaDialogo.querySelector('.hub-captura-imagen');
        var mensaje = capturaDialogo.querySelector('.hub-captura-estado'), detalle = capturaDialogo.querySelector('.hub-captura-detalle');
        marco.classList.remove('hub-captura-natural');marco.scrollTop = marco.scrollLeft = 0;
        detalle.disabled = true;detalle.setAttribute('aria-pressed','false');detalle.textContent = 'Ver detalle';
        img.style.width = '';img.hidden = true;mensaje.hidden = false;mensaje.textContent = 'Cargando captura…';
        capturaDialogo.querySelector('#hubCapturaTitulo').textContent = c.herramienta.nombre;
        capturaDialogo.querySelector('#hubCapturaPie').textContent = pasos[c.paso];
        capturaDialogo.querySelector('.hub-visor-cuenta').textContent = (c.paso+1) + '/' + pasos.length;
        img.onload = function () { if (!capturaAbierta) return;img.hidden = false;mensaje.hidden = true;detalle.disabled = false; };
        img.onerror = function () { if (!capturaAbierta) return;img.hidden = true;mensaje.hidden = false;mensaje.textContent = 'Esta captura todavía no está disponible.';detalle.disabled = true; };
        img.alt = c.herramienta.nombre + ': ' + pasos[c.paso];
        img.src = '/guia/' + c.herramienta.clave + '-' + (c.paso+1) + '.png';
    }
    function moverCaptura(dir) {
        if (!capturaAbierta) return;
        var c = capturaAbierta, total = c.herramienta.funciones.length;
        c.paso = (c.paso + dir + total) % total;
        pintarPaso(c.visor,c.paso);pintarCaptura();
    }
    function ampliarCaptura(v) {
        if (capturaAbierta) return;
        var img = v.querySelector('img'), m = buscar(seleccionado);
        if (!m || img.hidden || !img.complete || !img.naturalWidth) return;
        var h = m.herramientas[Number(v.closest('[data-hub-tool]').dataset.hubTool)];
        if (!h || !h.funciones.length) return;
        asegurarCaptura();
        capturaAbierta = {visor:v,herramienta:h,paso:Number(v.dataset.paso),overflow:document.body.style.overflow};
        pintarCaptura();document.body.style.overflow = 'hidden';capturaDialogo.showModal();
    }
    function icono(nombre, tam) { return typeof window.etaaxIcono === 'function' ? etaaxIcono(nombre, { tam: tam }) : ''; }
    function buscar(id) { return MODULOS.find(function (m) { return m.id === id; }); }
    function permite(h) {
        if (!h || !estado || !estado.negId) return false;
        if (!estado.staff || !h.permiso.length) return true;
        if (typeof window.etaaxPerm === 'function') return h.permiso.some(function (p) { return etaaxPerm(estado.negId, estado.rol, p, estado.sucId); });
        return false;
    }
    function disponible(m) { return m.herramientas.some(permite); }
    dock.innerHTML = MODULOS.map(function (m, i) {
        return '<button type="button" class="hub-module-tab" id="hub-tab-' + m.id + '" data-modulo="' + m.id + '" role="tab" aria-controls="hubHerramientas" aria-selected="false" tabindex="-1" disabled>' +
            '<span class="hub-module-icon" aria-hidden="true">' + icono(m.icono, 38) + '</span><span class="hub-module-numero">Módulo ' + (i + 1) + '</span><span class="hub-module-nombre">' + m.nombre + '</span></button>';
    }).join('');
    function mostrarSeleccion() {
        var tab = dock.querySelector('[aria-selected="true"]');
        if (!tab || !marcoDock.getClientRects().length) return;
        if (tab.offsetLeft < marcoDock.scrollLeft + 14 || tab.offsetLeft + tab.offsetWidth > marcoDock.scrollLeft + marcoDock.clientWidth - 14) {
            marcoDock.scrollLeft = Math.max(0, tab.offsetLeft - 14);
        }
    }
    function pintar() {
        cerrarCaptura(false);
        var activo = buscar(seleccionado);
        if (!activo || !disponible(activo)) activo = MODULOS.find(disponible);
        seleccionado = activo ? activo.id : '';
        dock.querySelectorAll('[data-modulo]').forEach(function (tab) {
            tab.disabled = !disponible(buscar(tab.dataset.modulo));
            var elegido = tab.dataset.modulo === seleccionado;
            tab.setAttribute('aria-selected', String(elegido));
            tab.tabIndex = elegido ? 0 : -1;
            tab.title = tab.disabled ? 'Sin acceso a las herramientas de este módulo' : '';
        });
        var aviso = document.getElementById('hubHerramientasEstado');
        document.querySelector('.hub-herramientas-head').hidden = !activo;
        var ir = document.getElementById('hubIrAlModulo');
        if (acciones) acciones.hidden = !activo;
        if (ir) ir.hidden = !activo || !activo.portada;
        if (!activo) {
            if (ir) ir.removeAttribute('href');
            ultimoAcceso = '';
            tarjetas.innerHTML = '';
            aviso.textContent = 'Elige un negocio para ver sus herramientas.';
            panel.removeAttribute('aria-labelledby');
            panel.setAttribute('aria-label', 'Herramientas');
            return;
        }
        aviso.textContent = '';
        panel.removeAttribute('aria-label');
        panel.setAttribute('aria-labelledby', 'hub-tab-' + activo.id);
        document.getElementById('hubModuloIcono').innerHTML = icono(activo.icono, 38);
        document.getElementById('hubModuloNumero').textContent = 'Módulo ' + (MODULOS.indexOf(activo) + 1) + ' · activo';
        document.getElementById('hubModuloTitulo').textContent = activo.nombre;
        document.getElementById('hubModuloDescripcion').textContent = activo.descripcion;
        /* La acción queda en la columna del módulo elegido, debajo de su
           tarjeta y fuera del tablist. Comparte su portada y permisos. */
        if (ir) {
            ir.href = activo.portada;
            ir.style.gridColumn = String(MODULOS.indexOf(activo) + 1);
            ir.setAttribute('aria-label', 'Ir al módulo ' + activo.nombre);
            var flecha = ir.querySelector('.hub-module-entry-arrow');
            if (flecha) flecha.innerHTML = icono('flecha', 16);
            if (ultimoAcceso !== seleccionado) {
                ir.classList.remove('hub-acceso-aparece');
                void ir.offsetWidth;
                ir.classList.add('hub-acceso-aparece');
                ultimoAcceso = seleccionado;
            }
        }
        requestAnimationFrame(mostrarSeleccion);
        /* UNA FILA POR HERRAMIENTA, Y DENTRO SU GUÍA VISUAL.
           Estas filas NO llevan a ningún lado: enseñan. Cada una pasa las
           capturas de su herramienta —el menú, la pantalla, el modal— con el pie
           que explica cada paso. Para entrar está «Ir al módulo», arriba: una
           sola puerta, en vez de diecinueve atajos compitiendo con ella.

           Por qué informativa y no un enlace más: el nombre de una herramienta
           no dice lo que hace. «Escandallos» no significa nada la primera vez;
           la foto de la pantalla, sí. */
        tarjetas.innerHTML = activo.herramientas.map(function (h, i) {
            var ok = permite(h), pasos = h.funciones || [];
            return '<article class="hub-tool-fila' + (ok ? '' : ' hub-tool-bloqueada') + '"' +
                ' data-hub-tool="' + i + '" data-ruta="' + esc(h.ruta) + '">' +
                '<div class="hub-fila-id">' +
                    '<span class="hub-fila-icono" aria-hidden="true">' + icono(h.icono, 28) + '</span>' +
                    '<div class="hub-fila-texto">' +
                        '<span class="hub-tool-etiqueta">' + esc(h.etiqueta) + '</span>' +
                        '<h3>' + esc(h.nombre) + '</h3>' +
                        '<p>' + esc(h.descripcion) + '</p>' +
                        (ok ? '' : '<span class="hub-fila-sinacceso">Sin acceso para tu rol</span>') +
                    '</div>' +
                '</div>' + visor(h, pasos) +
            '</article>';
        }).join('');
        tarjetas.querySelectorAll('.hub-visor').forEach(function (v) { pintarPaso(v, 0); });
        try { sessionStorage.setItem(CLAVE, seleccionado); } catch (e) {}
    }
    window.etaaxSeleccionarModulo = function (id) {
        var m = buscar(id);
        if (!m || !disponible(m)) return false;
        seleccionado = id;
        pintar();
        return true;
    };
    window.etaaxPintarModulos = function (ctx) {
        estado = ctx;
        if (!seleccionado) { try { seleccionado = sessionStorage.getItem(CLAVE) || ''; } catch (e) {} }
        pintar();
    };
    dock.addEventListener('click', function (e) {
        var tab = e.target.closest('button[data-modulo]');
        if (tab && !tab.disabled) window.etaaxSeleccionarModulo(tab.dataset.modulo);
    });
    dock.addEventListener('keydown', function (e) {
        if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
        var opciones = Array.from(dock.querySelectorAll('button:not(:disabled)'));
        if (!opciones.length) return;
        e.preventDefault();
        var i = opciones.indexOf(document.activeElement);
        var siguiente = e.key === 'Home' ? 0 : e.key === 'End' ? opciones.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + opciones.length) % opciones.length;
        var tab = opciones[siguiente];
        window.etaaxSeleccionarModulo(tab.dataset.modulo);
        tab.focus({ preventScroll: true });
        mostrarSeleccion();
    });
    /* Las filas enseñan. Las flechas pasan las capturas; tocar la imagen abre
       su vista ampliada, conservando el paso que se estaba leyendo. */
    tarjetas.addEventListener('click', function (e) {
        var marco = e.target.closest('.hub-visor-marco');
        if (marco && !marco.disabled) { ampliarCaptura(marco.closest('.hub-visor'));return; }
        var nav = e.target.closest('.hub-visor-nav');
        if (!nav) return;
        var v = nav.closest('.hub-visor');
        pintarPaso(v, Number(v.dataset.paso || 0) + Number(nav.dataset.dir));
    });
    window.addEventListener('etaax:permisos', function (e) {
        if (estado && (!e.detail || !e.detail.negId || e.detail.negId === estado.negId)) pintar();
    });
    var entrada = document.getElementById('hubIrAlModulo');
    if (entrada) entrada.addEventListener('click', function (e) {
        var m = buscar(seleccionado);
        if (!m || !disponible(m)) { e.preventDefault(); pintar(); }
    });
    if (typeof window.etaaxDock === 'function') window.etaaxDock(marcoDock, '.hub-module-tab');
})();
