/* ============================================================================
   ETAAX — LOS ICONOS DE LA MARCA, EN UN SOLO LUGAR

   Vienen del repo `iconos-etaax` (agenciaegmx-sys), de las dos propuestas que
   hizo Edwin. Aquí se adoptan tal cual: mismo dibujo, mismo trazo, mismo punto
   verde. Lo único que se normalizó es cómo se NOMBRA el acento, porque llegaba
   con tres nombres para dos cosas distintas:

       .accent / .dot  → RELLENO verde (el punto del usuario, la pupila)
       .g              → TRAZO verde (la línea del candado, la barra alta)
       y un style="stroke:var(--green)" suelto, haciendo lo mismo que .g

   Tres nombres para dos ideas es cómo un icono termina pintado distinto en dos
   pantallas. Aquí son dos, y con prefijo: `.g` ya existe en styles.css para
   otra cosa (el texto verde del título), y una clase de dos letras sin dueño
   choca el día que menos conviene.

       .etx-punto → relleno verde      .etx-trazo → trazo verde

   CÓMO SE USA

       <script src="/etaax-iconos.js"></script>
       ...
       elemento.innerHTML = etaaxIcono('user');            // 24 px
       elemento.innerHTML = etaaxIcono('arrow', {tam:20}); // otro tamaño
       elemento.innerHTML = etaaxIcono('eye', {clase:'mi-clase'});

   El color del trazo SE HEREDA (`stroke: currentColor`): el icono toma el color
   del texto que lo rodea, así que el mismo `arrow` se ve bien sobre el botón
   verde y sobre el fondo oscuro sin una sola línea extra. El verde del acento
   sale de `--green`, el token de siempre.

   POR QUÉ UN SPRITE Y NO UN ARCHIVO .SVG POR ICONO: `<use href="archivo.svg#id">`
   —la forma elegante— no carga en todos los navegadores cuando el archivo es
   externo, y esta app vive en tablets viejas. El sprite va dentro del documento
   y `<use>` apunta a algo que ya está ahí: funciona en todos, y sin una sola
   petición de red por icono.
   ============================================================================ */
(function () {
    /* [viewBox, dibujo]. No se editan a mano: salen del repo de iconos. */
    var SIMBOLOS = {
        'asesor': ['0 0 24 24', '<path d="M7 3h10a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H9l-5 3v-4a4 4 0 0 1-1-3V7a4 4 0 0 1 4-4Z"/><circle class="etx-punto" stroke="none" cx="15" cy="9" r="2.3"/>'],
        'candado': ['0 0 24 24', '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><circle class="etx-punto" stroke="none" cx="12" cy="15" r="1.8"/><path class="etx-trazo" d="M12 15v3"/>'],
        'flecha': ['0 0 24 24', '<path d="M3 12h18m-7-7 7 7-7 7"/>'],
        'ojo-oculto': ['0 0 24 24', '<path d="M8 5.8A10 10 0 0 1 12 5c6.3 0 10 7 10 7a19 19 0 0 1-3.3 4.2M15.8 18.2A10 10 0 0 1 12 19c-6.3 0-10-7-10-7a19 19 0 0 1 3.3-4.2"/><circle class="etx-punto" stroke="none" cx="12" cy="12" r="3"/><path d="m3 3 18 18"/>'],
        'ojo': ['0 0 24 24', '<path d="M2 12s3.7-7 10-7 10 7 10 7-3.7 7-10 7S2 12 2 12Z"/><circle class="etx-punto" stroke="none" cx="12" cy="12" r="3"/>'],
        'usuario': ['0 0 24 24', '<circle class="etx-punto" stroke="none" cx="12" cy="6" r="3.2"/><path d="M4 21v-1a8 8 0 0 1 16 0v1"/>'],
        'administrar': ['0 0 24 24', '<g stroke-width="2"><path d="M3 12h18m-7-7 7 7-7 7"/></g>'],
        'ajustes': ['0 0 24 24', '<g stroke-width="2"><path d="m9 3 1-1h4l1 3 2 1 3-1 2 4-2 2v2l2 2-2 4-3-1-2 1-1 3h-4l-1-3-2-1-3 1-2-4 2-2v-2L2 9l2-4 3 1 2-1Z"/><circle class="etx-punto" stroke="none" cx="12" cy="12" r="3"/></g>'],
        'anadir-sucursal': ['0 0 24 24', '<g stroke-width="2"><path d="M3 11v10h14M2 11l3-7h12l2 5M8 4l-1 7M3 11h8M7 21v-6h4"/><path class="etx-trazo" d="M18 11v10m-5-5h10"/></g>'],
        'catalogos': ['0 0 24 24', '<g stroke-width="2"><path d="M5 18H3V3h14v2M8 21H6V6h14v2"/><rect x="9" y="9" width="13" height="13" rx="2"/><path class="etx-trazo" d="M13 13h5"/><path d="M13 17h5"/></g>'],
        'cerrar-sesion': ['0 0 24 24', '<g stroke-width="2"><path d="M10 3H4v18h6M10 12h11m-4-4 4 4-4 4"/></g>'],
        'finanzas': ['0 0 24 24', '<g stroke-width="2"><path d="M3 3v18h19M7 17v-5m5 5V8"/><path class="etx-trazo" d="M17 17V4" style="stroke-width:3.4"/><circle class="etx-punto" stroke="none" cx="17" cy="4" r="1.7"/></g>'],
        'matriz': ['0 0 24 24', '<g stroke-width="2"><path d="M3 12v9h17v-9M2 12l3-6h11l3 6H2M8 6l-1 6m6-6 1 6M6 16h3"/><path class="etx-trazo" d="M12 21v-6h4v6M19 11V2h4l-1 2 1 2h-4"/></g>'],
        'perfil': ['0 0 24 24', '<g stroke-width="2"><circle class="etx-punto" stroke="none" cx="12" cy="6" r="3.2"/><path d="M4 21v-1a8 8 0 0 1 16 0v1"/></g>'],
        'privacidad': ['0 0 24 24', '<g stroke-width="2"><path d="m12 2 8 3v6c0 5-4 9-8 11-4-2-8-6-8-11V5Z"/><rect class="etx-trazo" x="9" y="10" width="6" height="6" rx="1.4"/><path class="etx-trazo" d="M10 10V8a2 2 0 0 1 4 0v2"/></g>'],
        'restaurante': ['0 0 24 24', '<g stroke-width="2"><circle cx="12" cy="12" r="6"/><circle class="etx-punto" stroke="none" cx="12" cy="12" r="2.6"/><path d="M2 3v6m3-6v6M2 6h3M3.5 9v12M22 3c-2 2-2 5-2 8h2V3v18"/></g>'],
        'sucursal': ['0 0 24 24', '<g stroke-width="2"><path d="M4 10v11h16V10M2 10l3-7h14l3 7H2M8 3l-1 7m9-7 1 7M4 15h4"/><path class="etx-trazo" d="M12 21v-7h5v7"/></g>'],
        'giro-ambulante': ['0 0 24 24', '<g stroke-width="1.8"><path d="M3 14h15v6H3Zm9-6v6M2 8c1-7 19-7 20 0H2Z"/><circle cx="6" cy="21" r="1.5"/><circle cx="16" cy="21" r="1.5"/><path class="etx-trazo" d="M8 8c0-5 8-5 8 0M6 17h8"/></g>'],
        'giro-bar': ['0 0 24 24', '<g stroke-width="1.8"><path d="m3 5 9 10 9-10H3Zm9 10v6m-4 1h8"/><path class="etx-trazo" d="M7 9h10m-3 0 3-7"/></g>'],
        'giro-bistro': ['0 0 24 24', '<g stroke-width="1.8"><path d="M5 11h14M8 11v10m8-10v10M2 13v7h3m17-7v7h-3"/><path class="etx-trazo" d="M12 10V6m-2-3h4l-1 3h-2Z"/></g>'],
        'giro-cafeteria': ['0 0 24 24', '<g stroke-width="1.8"><path d="M4 9h12v6a6 6 0 0 1-12 0V9Zm12 1h2a3 3 0 0 1 0 6h-2M3 22h15"/><path class="etx-trazo" d="M8 6V3m4 3V2"/></g>'],
        'giro-cantina': ['0 0 24 24', '<g stroke-width="1.8"><path d="M5 3h4v5l2 3v10H3V11l2-3V3Zm0 0V2h4v1M15 12h6l-1 9h-4Z"/><path class="etx-trazo" d="M3 15h8m5 1h4"/></g>'],
        'giro-cedis': ['0 0 24 24', '<g stroke-width="1.8"><path d="m2 9 10-7 10 7M4 8v14h16V8M8 22v-9h8v9"/><path class="etx-trazo" d="M9 17h6m-3-4v4"/></g>'],
        'giro-cerveceria': ['0 0 24 24', '<g stroke-width="1.8"><path d="M4 9h12v12H4V9Zm12 2h3a3 3 0 0 1 0 6h-3M4 9c-4-4 2-8 5-5 3-4 8-1 7 5"/><path class="etx-trazo" d="M8 12v6m4-6v6"/></g>'],
        'giro-cocina-entrega': ['0 0 24 24', '<g stroke-width="1.8"><path d="M3 7h14v15H3V7Zm4 0V5a3 3 0 0 1 6 0v2"/><path class="etx-trazo" d="M10 14h12m-3-3 3 3-3 3"/></g>'],
        'giro-fonda': ['0 0 24 24', '<g stroke-width="1.8"><path d="M4 11h16v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5v-5ZM2 12h2m16 0h2M3 8h18m-12 0V6h6v2"/><path class="etx-trazo" d="M9 3V1m6 2V1"/></g>'],
        'giro-foodtruck': ['0 0 24 24', '<g stroke-width="1.8"><path d="M2 5h13v14H2V5Zm13 6h4l3 5v3h-7M19 11v5h3"/><circle cx="6" cy="20" r="2"/><circle cx="18" cy="20" r="2"/><path class="etx-trazo" d="M5 8h7v6H5V8Zm0 3h7"/></g>'],
        'giro-fuente-sodas': ['0 0 24 24', '<g stroke-width="1.8"><path d="M6 8h12l-2 13H8L6 8Zm-1 0h14"/><path class="etx-trazo" d="M13 8V3h6M8 12h8"/><circle class="etx-punto" stroke="none" cx="11" cy="16" r="1"/><circle class="etx-punto" stroke="none" cx="14" cy="14.5" r=".8"/></g>'],
        'giro-jugueria': ['0 0 24 24', '<g stroke-width="1.8"><path d="M3 9h11l-2 13H5L3 9Zm5 0V3h5"/><circle class="etx-trazo" cx="18" cy="8" r="4"/><path class="etx-trazo" d="M18 4v8m-4-4h8M4 14h9"/></g>'],
        'giro-marisqueria': ['0 0 24 24', '<g stroke-width="1.8"><path d="M3 11c5-7 11-7 16 0-5 7-11 7-16 0Zm16 0 3-4v8l-3-4Z"/><circle class="etx-punto" stroke="none" cx="7" cy="10" r="1.2"/><path class="etx-trazo" d="M3 20c3-3 4 3 7 0s4 3 7 0 3 1 4 0"/></g>'],
        'giro-neveria': ['0 0 24 24', '<g stroke-width="1.8"><path d="m6 11 6 11 6-11H6Zm2 0a4 4 0 1 1 8 0"/><path class="etx-trazo" d="M6 10C0 7 7 0 10 4c3-6 10 0 8 4 4 0 3 4 0 4"/></g>'],
        'giro-panaderia': ['0 0 24 24', '<g stroke-width="1.8"><path d="M3 12c0-9 18-9 18 0v5a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4v-5Z"/><path class="etx-trazo" d="m7 12 2-4m2 5 2-5m2 5 2-4"/></g>'],
        'giro-pizzeria': ['0 0 24 24', '<g stroke-width="1.8"><path d="M3 6c5-4 13-4 18 0l-9 16L3 6Zm2 3c4-3 10-3 14 0"/><circle class="etx-punto" stroke="none" cx="10" cy="11" r="1.4"/><circle class="etx-punto" stroke="none" cx="14" cy="12" r="1.2"/><circle class="etx-punto" stroke="none" cx="12" cy="16" r="1"/></g>'],
        'giro-reposteria': ['0 0 24 24', '<g stroke-width="1.8"><path d="M4 12h16v9H4Zm-2 10h20M4 15c2 3 4-3 6 0s4-3 6 0 3-1 4 0"/><path class="etx-trazo" d="M8 12V8h8v4M12 8V4"/><circle class="etx-punto" stroke="none" cx="12" cy="2.5" r="1.2"/></g>'],
        'giro-restaurante-bar': ['0 0 24 24', '<g stroke-width="1.8"><circle cx="8" cy="13" r="5"/><ellipse cx="2" cy="5" rx="1.3" ry="2.8"/><path d="M2 8v12m18-5v6m-3 1h6m-7-16 4 9 3-9h-7Z"/><circle class="etx-punto" stroke="none" cx="8" cy="13" r="2"/><path class="etx-trazo" d="M17 9h5"/></g>'],
        'giro-rosticeria': ['0 0 24 24', '<g stroke-width="1.8"><path d="M2 13h20M4 10v10m16-10v10M2 21h20M8 13c-3-8 8-9 9-3s-6 9-9 3Z"/><path class="etx-trazo" d="m15 8 3-3m-1 1 2 1m-8 3 2 3"/></g>'],
        'giro-taqueria': ['0 0 24 24', '<g stroke-width="1.8"><path d="M2 18a10 10 0 0 1 20 0H2Zm3 3h14"/><path class="etx-trazo" d="m6 14 2-2 2 1 2-2 2 2 2-1 2 2"/></g>'],
        'org-cadena': ['0 0 24 24', '<g stroke-width="1.8"><rect x="2" y="8" width="5" height="8" rx="2"/><rect x="9.5" y="8" width="5" height="8" rx="2"/><rect x="17" y="8" width="5" height="8" rx="2"/><path class="etx-trazo" d="M7 12h2.5m5 0H17"/></g>'],
        'org-cedis': ['0 0 24 24', '<g stroke-width="1.8"><rect x="8" y="8" width="8" height="8" rx="2"/><path class="etx-trazo" d="M12 8V2m-2 2 2-2 2 2M16 12h6m-2-2 2 2-2 2M12 16v6m-2-2 2 2 2-2M8 12H2m2-2-2 2 2 2"/></g>'],
        'org-corporativo': ['0 0 24 24', '<g stroke-width="1.8"><rect x="8" y="8" width="8" height="8" rx="2"/><path d="M12 8V3M8 12H3m13 0h5m-9 4v5"/><circle class="etx-punto" stroke="none" cx="12" cy="3" r="2"/><circle cx="3" cy="12" r="2"/><circle cx="21" cy="12" r="2"/><circle cx="12" cy="21" r="2"/></g>'],
        'org-franquicia': ['0 0 24 24', '<g stroke-width="1.8"><circle class="etx-trazo" cx="12" cy="5" r="3"/><path d="M12 8v4H4m8 0h8M4 12v4m8-4v4m8-4v4"/><rect x="2" y="16" width="4" height="5" rx="1"/><rect x="10" y="16" width="4" height="5" rx="1"/><rect x="18" y="16" width="4" height="5" rx="1"/></g>'],
        'org-mixto': ['0 0 24 24', '<g stroke-width="1.8"><circle class="etx-trazo" cx="12" cy="12" r="3"/><path d="m10 10-5-5m9 5 5-5m-9 9-5 5m9-5 5 5"/><circle cx="4" cy="4" r="2"/><rect x="18" y="2" width="4" height="4" rx="1"/><path d="m2 22 2-5 2 5H2"/><rect x="18" y="18" width="4" height="4" rx="1"/></g>'],
        'org-pyme': ['0 0 24 24', '<g stroke-width="1.8"><circle cx="12" cy="10" r="5"/><path d="M5 21v-2l4-5m10 7v-2l-4-5"/><circle class="etx-punto" stroke="none" cx="12" cy="10" r="2"/></g>'],
        'hd-desplegar': ['0 0 24 24', '<g stroke-width="2"><path d="m6 9 6 6 6-6"/></g>'],
        'hd-inicio': ['0 0 24 24', '<g stroke-width="2"><path d="m3 10 9-7 9 7v11H3V10Z"/><path class="etx-trazo" d="M9 21v-7h6v7"/></g>'],
        'hd-luna': ['0 0 24 24', '<g stroke-width="2"><path d="M18 16A8 8 0 0 1 8 4a9 9 0 1 0 10 12Z"/><circle class="etx-punto" stroke="none" cx="17" cy="5" r="2"/></g>'],
        'hd-sistema': ['0 0 24 24', '<g stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="3"/><path d="M12 17v4m-5 1h10"/><circle class="etx-punto" stroke="none" cx="17" cy="7" r="1.5"/></g>'],
        'hd-sol': ['0 0 24 24', '<g stroke-width="2"><circle class="etx-punto" stroke="none" cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></g>'],
        'cat-clientes': ['0 0 24 24', '<g stroke-width="1.8"><rect x="2" y="4" width="20" height="16" rx="3"/><circle class="etx-punto" stroke="none" cx="8" cy="9" r="2"/><path d="M4 16a4 4 0 0 1 8 0m3-7h4m-4 4h4"/></g>'],
        'cat-colaboradores': ['0 0 24 24', '<g stroke-width="1.8"><circle class="etx-punto" stroke="none" cx="8" cy="6" r="3"/><circle cx="17" cy="7" r="2.5"/><path d="M2 21v-3a6 6 0 0 1 12 0v3m2-8a5 5 0 0 1 6 5v3"/></g>'],
        'cat-horarios': ['0 0 24 24', '<g stroke-width="1.8"><rect x="2" y="4" width="16" height="16" rx="3"/><path d="M6 2v4m8-4v4M2 9h16"/><circle class="etx-trazo" cx="17" cy="17" r="5"/><path class="etx-trazo" d="M17 14v3l2 1"/></g>'],
        'cat-insumos': ['0 0 24 24', '<g stroke-width="1.8"><path d="m3 7 9-4 9 4v13H3V7Zm0 0 9 4 9-4m-9 4v9"/><path class="etx-trazo" d="m8 5 8 4v5"/></g>'],
        'cat-proveedores': ['0 0 24 24', '<g stroke-width="1.8"><path d="M2 5h13v14H2V5Zm13 6h4l3 5v3h-7M19 11v5h3"/><circle cx="6" cy="20" r="2"/><circle cx="18" cy="20" r="2"/><path class="etx-trazo" d="M5 8h7v7H5V8Zm3.5 0v3"/></g>'],
        'cat-recetas': ['0 0 24 24', '<g stroke-width="1.8"><path d="M3 4h15a3 3 0 0 1 3 3v14H6a3 3 0 0 1-3-3V4Zm0 13h18M7 4v13"/><circle cx="14" cy="10" r="4"/><circle class="etx-punto" stroke="none" cx="14" cy="10" r="1.5"/></g>'],
        'cat-sub-recetas': ['0 0 24 24', '<g stroke-width="1.8"><path d="M3 11h13a6.5 6.5 0 0 1-13 0ZM5 19h9M5 7h8"/><path class="etx-trazo" d="M16 7h5V3m0 4-5-5"/></g>'],
        'fin-cuentas-bancarias': ['0 0 24 24', '<g stroke-width="1.8"><path d="m2 8 10-5 10 5H2Zm2 3v7m5-7v7m6-7v7m5-7v7M2 21h20"/><circle class="etx-punto" stroke="none" cx="12" cy="6" r="1.3"/><path class="etx-trazo" d="M7 21h10"/></g>'],
        'fin-estadisticas': ['0 0 24 24', '<g stroke-width="1.8"><path d="M2 3v19h20M6 18v-5h3v5H6Zm6 0V9h3v9h-3"/><path class="etx-trazo" d="M18 18V4h3v14h-3"/></g>'],
        'fin-gastos': ['0 0 24 24', '<g stroke-width="1.8"><path d="M3 10h18v11H3V10ZM5 10V5h14v5"/><path class="etx-trazo" d="M12 2v12m-3-3 3 3 3-3"/><circle cx="12" cy="17" r="2"/></g>'],
        'fin-kpis': ['0 0 24 24', '<g stroke-width="1.8"><circle cx="11" cy="13" r="9"/><circle cx="11" cy="13" r="5"/><circle class="etx-punto" stroke="none" cx="11" cy="13" r="1.6"/><path class="etx-trazo" d="m11 13 10-10m-4 0h4v4"/></g>'],
        'fin-previsiones': ['0 0 24 24', '<g stroke-width="1.8"><path d="M3 3v18h19M6 17l5-6 4 2"/><path class="etx-trazo" d="m15 13 2-3m2-2 3-4m-4 0h4v4"/></g>'],
        'fin-resumen-resultados': ['0 0 24 24', '<g stroke-width="1.8"><rect x="4" y="2" width="16" height="20" rx="3"/><path d="M8 6h8M8 10h3m-3 4h3m-3 4h3"/><path class="etx-trazo" d="M15 10h1m-1 4h1m-1 4h1"/></g>'],
        'fin-ventas': ['0 0 24 24', '<g stroke-width="1.8"><path d="M3 10h18v11H3V10ZM5 10V5h14v5"/><path class="etx-trazo" d="M12 14V2m-3 3 3-3 3 3"/><circle cx="12" cy="17" r="2"/></g>'],
        'sh-cambiar-negocio': ['0 0 24 24', '<g stroke-width="1.8"><path d="M3 7h18m-4-4 4 4-4 4M21 17H3m4-4-4 4 4 4"/><circle class="etx-punto" stroke="none" cx="6" cy="7" r="1.7"/><circle class="etx-punto" stroke="none" cx="18" cy="17" r="1.7"/></g>'],
        'sh-info-negocio': ['0 0 24 24', '<g stroke-width="1.8"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M3 22h18M9 6h1m4 0h1M9 10h1m4 0h1M9 14h1m4 0h1"/><path class="etx-trazo" d="M10 22v-4h4v4"/></g>'],
        'sh-info-sucursal': ['0 0 24 24', '<g stroke-width="1.8"><path d="M4 10v11h16V10M2 10l3-7h14l3 7H2M8 3l-1 7m9-7 1 7M4 15h4"/><path class="etx-trazo" d="M12 21v-7h5v7"/></g>'],
        'sh-matriz': ['0 0 24 24', '<g stroke-width="1.8"><path d="M19 10c0 5-7 12-7 12S5 15 5 10a7 7 0 0 1 14 0Z"/><circle class="etx-punto" stroke="none" cx="12" cy="9" r="2.5"/></g>'],
        'mod-aprende-analiza': ['0 0 24 24', '<g stroke-width="1.8"><path d="M12 5C8 2 4 3 2 4v15c3-1 7-1 10 2 3-3 7-3 10-2V4c-2-1-6-2-10 1Zm0 0v16M5 8h4m-4 4h4"/><path class="etx-trazo" d="M15 15v-3m3 3V8"/></g>'],
        'mod-control-administrativo': ['0 0 24 24', '<g stroke-width="1.8"><rect x="3" y="4" width="18" height="18" rx="3"/><path d="M8 2v4m8-4v4M3 9h18M7 13h3m-3 4h3"/><path class="etx-trazo" d="m13 16 2 2 4-5"/></g>'],
        'mod-recetas-insumos': ['0 0 24 24', '<g stroke-width="1.8"><path d="M2 3h11v17H5a3 3 0 0 1-3-3V3Zm0 13h11M6 7h3m-3 4h3M15 12l4-2 4 2v8l-4 2-4-2v-8Zm0 0 4 2 4-2"/><path class="etx-trazo" d="M19 14v8"/></g>'],
        'mod-salud-financiera': ['0 0 24 24', '<g stroke-width="1.8"><path d="M3 3v18h19M6 17v-4m4 4V9m4 8V5"/><path class="etx-trazo" d="M17 9h2l1-3 2 6"/></g>'],
        'mod-escandallos': ['0 0 24 24', '<g stroke-width="1.8"><path d="M4 4h16v18H4V4ZM9 4V2h6v2"/><circle cx="12" cy="11" r="4"/><circle class="etx-punto" stroke="none" cx="12" cy="11" r="1.5"/><path class="etx-trazo" d="M8 18h3m3 0h2"/></g>'],
        'mod-insumos': ['0 0 24 24', '<g stroke-width="1.8"><path d="M4 7h16v15H4V7ZM7 7V4h10v3M8 17h8"/><path class="etx-trazo" d="M12 13c-4 0-5-4-5-4s5 0 5 4Zm0 0c0-4 5-4 5-4s-1 4-5 4Z"/></g>'],
        'mod-inventarios': ['0 0 24 24', '<g stroke-width="1.8"><path d="M2 2v20m20-20v20M2 11h20M2 21h20M5 11V4h5v7m4 0V4h5v7M5 21v-7h5v7m4 0v-7h5v7"/><path class="etx-trazo" d="M6 7h3m6 10h3"/></g>'],
        'mod-requisiciones': ['0 0 24 24', '<g stroke-width="1.8"><path d="M3 2h12l4 4v15H3V2Zm12 0v5h4M7 7h3m-3 4h6m-6 4h3"/><path class="etx-trazo" d="M12 17h10m-3-3 3 3-3 3"/></g>'],
        'adm-adjunto': ['0 0 24 24', '<g stroke-width="1.8"><path d="m8 13 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9"/><path class="etx-trazo" d="m7 14 7-7"/></g>'],
        'adm-agregar': ['0 0 24 24', '<g stroke-width="1.8"><path d="M12 4v16"/><path class="etx-trazo" d="M4 12h16"/></g>'],
        'adm-autorizar': ['0 0 24 24', '<g stroke-width="1.8"><path d="m12 2 8 3v6c0 5-4 9-8 11-4-2-8-6-8-11V5z"/><path class="etx-trazo" d="m8 11 3 3 5-5"/></g>'],
        'adm-banco': ['0 0 24 24', '<g stroke-width="1.8"><path d="m2 7 10-5 10 5H2Zm1 14h18M5 10v7m5-7v7m4-7v7m5-7v7"/><path class="etx-trazo" d="M3 18h18"/></g>'],
        'adm-buscar': ['0 0 24 24', '<g stroke-width="1.8"><circle cx="10" cy="10" r="6"/><path class="etx-trazo" d="m15 15 6 6"/></g>'],
        'adm-caja-chica': ['0 0 24 24', '<g stroke-width="1.8"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V4h8v3M3 12h18"/><path class="etx-trazo" d="M10 11v4h4v-4"/></g>'],
        'adm-caja-fuerte': ['0 0 24 24', '<g stroke-width="1.8"><rect x="3" y="3" width="18" height="17" rx="2"/><path d="M6 20v2m12-2v2M6 7v8"/><circle cx="14" cy="11" r="4"/><path class="etx-trazo" d="M14 7v8m-4-4h8"/></g>'],
        'adm-calendario': ['0 0 24 24', '<g stroke-width="1.8"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M7 2v4m10-4v4M3 9h18"/><path class="etx-trazo" d="M7 13h3m4 0h3m-10 4h3"/></g>'],
        'adm-categoria': ['0 0 24 24', '<g stroke-width="1.8"><path d="M3 3h8l10 10-8 8L3 11z"/><circle class="etx-trazo" cx="7.5" cy="7.5" r="1.5"/></g>'],
        'adm-celular': ['0 0 24 24', '<g stroke-width="1.8"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 19h2"/><path class="etx-trazo" d="M12 15V7m-3 3 3-3 3 3"/></g>'],
        'adm-cerrar': ['0 0 24 24', '<g stroke-width="1.8"><path d="m6 6 12 12M18 6 6 18"/></g>'],
        'adm-comprobante': ['0 0 24 24', '<g stroke-width="1.8"><path d="M5 2h14v20l-3-2-4 2-4-2-3 2V2ZM8 6h8m-8 4h8m-8 4h3"/><path class="etx-trazo" d="m13 16 2 2 4-4"/></g>'],
        'adm-datos-gasto': ['0 0 24 24', '<g stroke-width="1.8"><path d="M8 4H4v18h16V4h-4M8 2h8v4H8zM8 10h8m-8 4h5"/><path class="etx-trazo" d="M8 18h4"/></g>'],
        'adm-exportar-csv': ['0 0 24 24', '<g stroke-width="1.8"><path d="M13 3H3v18h18v-9M3 9h8M3 15h18M9 3v18m6-8v8"/><path class="etx-trazo" d="M15 3h6v6m0-6-8 8"/></g>'],
        'adm-gasto-mayor': ['0 0 24 24', '<g stroke-width="1.8"><path d="M4 3h12l4 4v14H4zM15 3v5h5M7 12h5m-5 4h4"/><path class="etx-trazo" d="M16 11v4m0 3h.01"/></g>'],
        'adm-gastos-diarios': ['0 0 24 24', '<g stroke-width="1.8"><path d="M4 9h16v12H4zM6 9V5h12v4"/><path class="etx-trazo" d="M12 2v11m-3-3 3 3 3-3"/><circle cx="12" cy="17" r="2"/></g>'],
        'adm-guardar': ['0 0 24 24', '<g stroke-width="1.8"><path d="M3 3h15l3 3v15H3zM7 3v6h10V3M7 21v-8h10v8"/><path class="etx-trazo" d="M14 5v2"/></g>'],
        'adm-imprimir': ['0 0 24 24', '<g stroke-width="1.8"><path d="M6 8V2h12v6M6 17H3V8h18v9h-3M6 14h12v8H6z"/><path class="etx-trazo" d="M16 11h2"/></g>'],
        'adm-limite': ['0 0 24 24', '<g stroke-width="1.8"><path d="M5 3v18M12 3v18M19 3v18"/><path class="etx-trazo" d="M2 8h6m1 8h6m1-10h6"/></g>'],
        'adm-minimizar': ['0 0 24 24', '<g stroke-width="1.8"><path d="M5 16h14"/></g>'],
        'adm-notas': ['0 0 24 24', '<g stroke-width="1.8"><path d="M13 3H3v18h18v-8M7 7h3m-3 4h2m-2 4h2"/><path class="etx-trazo" d="m12 12 7-9 3 3-7 9-4 1z"/></g>'],
        'adm-pagado': ['0 0 24 24', '<g stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path class="etx-trazo" d="m7 12 3 3 7-7"/></g>'],
        'adm-pendiente': ['0 0 24 24', '<g stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path class="etx-trazo" d="M12 6v6l4 2"/></g>'],
        'adm-prevision': ['0 0 24 24', '<g stroke-width="1.8"><path d="M5 8h14v13H5zM7 5h10M9 2h6"/><path class="etx-trazo" d="M12 11v7m-3-4h6"/></g>'],
        'adm-programado': ['0 0 24 24', '<g stroke-width="1.8"><path d="M8 2v4m8-4v4M3 9h18M10 21H3V4h18v7"/><circle cx="17" cy="17" r="5"/><path class="etx-trazo" d="M17 14v3l2 1"/></g>'],
        'adm-proveedor': ['0 0 24 24', '<g stroke-width="1.8"><path d="M2 5h12v13H2zM14 10h4l4 5v3h-8M5 8h6v5H5z"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="19" r="2"/><path class="etx-trazo" d="M17 11v4h4"/></g>'],
        'adm-sin-registros': ['0 0 24 24', '<g stroke-width="1.8"><path d="M5 3h14v18H5zM8 7h8m-8 4h5"/><path class="etx-trazo" d="M9 17h6"/></g>'],
        'adm-subir-archivo': ['0 0 24 24', '<g stroke-width="1.8"><path d="M3 15v6h18v-6"/><path class="etx-trazo" d="M12 16V3m-5 5 5-5 5 5"/></g>'],
        'adm-sucursal': ['0 0 24 24', '<g stroke-width="1.8"><path d="M5 13v8h14v-8M3 8l2-5h14l2 5v4H3zM9 21v-6h6v6"/><path class="etx-trazo" d="M8 3v9m8-9V3"/></g>'],
        'cor-agregar': ['0 0 24 24', '<g stroke-width="1.8"><path d="M12 4v16"/><path class="etx-trazo" d="M4 12h16"/></g>'],
        'cor-alimentos': ['0 0 24 24', '<g stroke-width="1.8"><path d="M3 17a9 9 0 0 1 18 0H3ZM2 21h20M12 8V4m-2 0h4"/><path class="etx-trazo" d="M7 13a6 6 0 0 1 5-3"/></g>'],
        'cor-anticipo': ['0 0 24 24', '<g stroke-width="1.8"><rect x="3" y="9" width="18" height="12" rx="2"/><path d="M7 9V5h10v4"/><path class="etx-trazo" d="M8 15h8m-3-3 3 3-3 3"/></g>'],
        'cor-bebidas': ['0 0 24 24', '<g stroke-width="1.8"><path d="m4 3 8 10 8-10H4Zm8 10v8m-5 0h10"/><path class="etx-trazo" d="M7 7h10"/></g>'],
        'cor-canal-venta': ['0 0 24 24', '<g stroke-width="1.8"><path d="M12 3v6M4 15v-4h16v4M2 16h5v5H2zM10 16h5v5h-5zM18 16h5v5h-5z"/><path class="etx-trazo" d="M9 2h6v5H9z"/></g>'],
        'cor-celular': ['0 0 24 24', '<g stroke-width="1.8"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 19h2"/><path class="etx-trazo" d="M12 15V7m-3 3 3-3 3 3"/></g>'],
        'cor-cerrar': ['0 0 24 24', '<g stroke-width="1.8"><path d="m6 6 12 12M18 6 6 18"/></g>'],
        'cor-cheque-promedio': ['0 0 24 24', '<g stroke-width="1.8"><path d="M5 2h14v20l-3-2-4 2-4-2-3 2zM8 6h8"/><path class="etx-trazo" d="M8 13h8m-4-4h.01m0 8h.01"/></g>'],
        'cor-comedor': ['0 0 24 24', '<g stroke-width="1.8"><path d="M3 10h18M5 10v11m14-11v11M7 6h10M9 2v4m6-4v4"/><path class="etx-trazo" d="M5 15h14"/></g>'],
        'cor-comensales': ['0 0 24 24', '<g stroke-width="1.8"><circle cx="9" cy="7" r="3"/><path d="M3 21v-4a6 6 0 0 1 12 0v4M17 4a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v3"/><path class="etx-trazo" d="M7 17h4"/></g>'],
        'cor-comparativo': ['0 0 24 24', '<g stroke-width="1.8"><path d="M3 21V3M3 21h18M7 17v-5m5 5V8m5 9V5"/><path class="etx-trazo" d="m15 5 2-2 3 2"/></g>'],
        'cor-corte-caja': ['0 0 24 24', '<g stroke-width="1.8"><rect x="3" y="10" width="18" height="11" rx="2"/><path d="M6 10V3h12v7M7 17h3m4 0h3"/><path class="etx-trazo" d="m9 6 2 2 4-4"/></g>'],
        'cor-datos-corte': ['0 0 24 24', '<g stroke-width="1.8"><path d="M8 4H4v18h16V4h-4M8 2h8v4H8zM8 10h8m-8 4h5"/><path class="etx-trazo" d="M8 18h4"/></g>'],
        'cor-desglose': ['0 0 24 24', '<g stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M10 9v12"/><path class="etx-trazo" d="M14 13h3m-3 4h3"/></g>'],
        'cor-efectivo': ['0 0 24 24', '<g stroke-width="1.8"><rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="12" cy="12" r="3"/><path class="etx-trazo" d="M5 8h2m10 8h2M5 16h2m10-8h2"/></g>'],
        'cor-entrada-efectivo': ['0 0 24 24', '<g stroke-width="1.8"><path d="M3 15v6h18v-6M6 15h12"/><path class="etx-trazo" d="M12 3v13m-4-4 4 4 4-4"/></g>'],
        'cor-escanear-qr': ['0 0 24 24', '<g stroke-width="1.8"><path d="M2 7V2h5m10 0h5v5M2 17v5h5m10 0h5v-5M6 6h4v4H6zM14 6h4v4h-4zM6 14h4v4H6z"/><path class="etx-trazo" d="M14 14h4v4h-2m-2-2v2"/></g>'],
        'cor-evidencia-visual': ['0 0 24 24', '<g stroke-width="1.8"><path d="M3 6h4l2-3h6l2 3h4v15H3z"/><circle cx="12" cy="13" r="4"/><path class="etx-trazo" d="M17 9h1"/></g>'],
        'cor-exportar-csv': ['0 0 24 24', '<g stroke-width="1.8"><path d="M13 3H3v18h18v-9M3 9h8M3 15h18M9 3v18m6-8v8"/><path class="etx-trazo" d="M15 3h6v6m0-6-8 8"/></g>'],
        'cor-formas-pago': ['0 0 24 24', '<g stroke-width="1.8"><path d="m2 7 10-5 10 5H2Zm1 14h18M5 10v7m5-7v7m4-7v7m5-7v7"/><path class="etx-trazo" d="M3 18h18"/></g>'],
        'cor-gastos-dia': ['0 0 24 24', '<g stroke-width="1.8"><path d="M4 9h16v12H4zM6 9V5h12v4"/><path class="etx-trazo" d="M12 2v11m-3-3 3 3 3-3"/><circle cx="12" cy="17" r="2"/></g>'],
        'cor-guardar': ['0 0 24 24', '<g stroke-width="1.8"><path d="M3 3h15l3 3v15H3zM7 3v6h10V3M7 21v-8h10v8"/><path class="etx-trazo" d="M14 5v2"/></g>'],
        'cor-imprimir': ['0 0 24 24', '<g stroke-width="1.8"><path d="M6 8V2h12v6M6 17H3V8h18v9h-3M6 14h12v8H6z"/><path class="etx-trazo" d="M16 11h2"/></g>'],
        'cor-minimizar': ['0 0 24 24', '<g stroke-width="1.8"><path d="M5 16h14"/></g>'],
        'cor-movimientos-caja': ['0 0 24 24', '<g stroke-width="1.8"><path d="M3 7h17m-4-4 4 4-4 4"/><path class="etx-trazo" d="M21 17H4m4-4-4 4 4 4"/></g>'],
        'cor-notas': ['0 0 24 24', '<g stroke-width="1.8"><path d="M13 3H3v18h18v-8M7 7h3m-3 4h2m-2 4h2"/><path class="etx-trazo" d="m12 12 7-9 3 3-7 9-4 1z"/></g>'],
        'cor-operativo': ['0 0 24 24', '<g stroke-width="1.8"><circle cx="13" cy="12" r="6"/><path d="M3 3v7m3-7v7M3 7h3M4.5 10v11M22 3v18"/><path class="etx-trazo" d="M13 8a4 4 0 0 1 4 4"/></g>'],
        'cor-otros-pagos': ['0 0 24 24', '<g stroke-width="1.8"><path d="M5 2h14v20l-3-2-4 2-4-2-3 2V2ZM8 6h8m-8 4h8m-8 4h3"/><path class="etx-trazo" d="m13 16 2 2 4-4"/></g>'],
        'cor-pagar-propinas': ['0 0 24 24', '<g stroke-width="1.8"><path d="M2 17h4l4 4h7l5-7a2 2 0 0 0-3-2l-4 4h-5m-4 1v-5h7a2 2 0 0 1 0 4"/><path class="etx-trazo" d="m11 2 1.5 3 3.5.5-2.5 2.5.5 3-3-1.5L8 11l.5-3L6 5.5 9.5 5z"/></g>'],
        'cor-para-llevar': ['0 0 24 24', '<g stroke-width="1.8"><path d="M4 7h16l1 14H3L4 7ZM8 7V5a4 4 0 0 1 8 0v2"/><path class="etx-trazo" d="M8 14h8m-3-3 3 3-3 3"/></g>'],
        'cor-programado': ['0 0 24 24', '<g stroke-width="1.8"><path d="M8 2v4m8-4v4M3 9h18M10 21H3V4h18v7"/><circle cx="17" cy="17" r="5"/><path class="etx-trazo" d="M17 14v3l2 1"/></g>'],
        'cor-propinas': ['0 0 24 24', '<g stroke-width="1.8"><path d="m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/><path class="etx-trazo" d="M10 11h4m-2-2v5"/></g>'],
        'cor-resguardo': ['0 0 24 24', '<g stroke-width="1.8"><rect x="3" y="3" width="18" height="17" rx="2"/><path d="M6 20v2m12-2v2M6 7v8"/><circle cx="14" cy="11" r="4"/><path class="etx-trazo" d="M14 7v8m-4-4h8"/></g>'],
        'cor-restringido': ['0 0 24 24', '<g stroke-width="1.8"><rect x="5" y="10" width="14" height="12" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/><path class="etx-trazo" d="M12 15v3"/></g>'],
        'cor-salida-efectivo': ['0 0 24 24', '<g stroke-width="1.8"><path d="M3 15v6h18v-6M6 15h12"/><path class="etx-trazo" d="M12 16V3m-4 4 4-4 4 4"/></g>'],
        'cor-sin-cortes': ['0 0 24 24', '<g stroke-width="1.8"><path d="M5 3h14v18H5zM8 7h8m-8 4h5"/><path class="etx-trazo" d="M9 17h6"/></g>'],
        'cor-subir-evidencia': ['0 0 24 24', '<g stroke-width="1.8"><path d="M3 15v6h18v-6"/><path class="etx-trazo" d="M12 16V3m-5 5 5-5 5 5"/></g>'],
        'cor-sucursal': ['0 0 24 24', '<g stroke-width="1.8"><path d="M5 13v8h14v-8M3 8l2-5h14l2 5v4H3zM9 21v-6h6v6"/><path class="etx-trazo" d="M8 3v9m8-9V3"/></g>'],
        'cor-tarjeta': ['0 0 24 24', '<g stroke-width="1.8"><rect x="2" y="4" width="20" height="16" rx="3"/><path d="M2 9h20"/><path class="etx-trazo" d="M6 15h4m5 0h3"/></g>'],
        'cor-transferencia': ['0 0 24 24', '<g stroke-width="1.8"><path d="M3 7h17m-4-4 4 4-4 4"/><path class="etx-trazo" d="M21 17H4m4-4-4 4 4 4"/></g>'],
    };

    var ID = 'etaax-sprite-iconos';

    function pintarSprite() {
        if (document.getElementById(ID)) return;        // una sola vez por página
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('id', ID);
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('width', '0');
        svg.setAttribute('height', '0');
        svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
        var defs = '';
        for (var k in SIMBOLOS) {
            if (!SIMBOLOS.hasOwnProperty(k)) continue;
            defs += '<symbol id="etx-' + k + '" viewBox="' + SIMBOLOS[k][0] + '">' +
                    SIMBOLOS[k][1] + '</symbol>';
        }
        svg.innerHTML = '<defs>' + defs + '</defs>';
        (document.body || document.documentElement).appendChild(svg);
    }

    function pintarEstilo() {
        if (document.getElementById(ID + '-css')) return;
        var st = document.createElement('style');
        st.id = ID + '-css';
        /* El grosor y los remates son los del diseño original (2.3, redondos).
           Van aquí y no en styles.css para que el archivo sea uno solo: quien
           incluya el script tiene los iconos completos, sin depender de que
           además haya cargado la hoja de estilos correcta. */
        /* ══ OJO CON EL SELECTOR: TIENE QUE SER SIMPLE ══════════════════════
           `<use>` no pega el dibujo en la página: hace una COPIA aparte, en una
           especie de compartimento propio. Lo que SÍ cruza hacia esa copia son
           las propiedades que se heredan —`fill`, `stroke`, `color`— y por eso
           el contorno toma el color del texto que lo rodea.

           Lo que NO cruza es un selector con descendencia. La primera versión
           de esto decía `.etx-ic .etx-punto`, y ese espacio obliga a saltar
           desde el <svg> de la página hasta dentro de la copia: el salto no
           existe, la regla nunca aplicó, y el punto verde se quedó sin color
           heredando el `fill:none` del contorno. En pantalla: un aro hueco en
           vez de un punto verde. Se veía como «sigue el icono viejo».

           Por eso `.etx-punto` y `.etx-trazo` van SOLOS. El prefijo ya evita
           que choquen con nada; no hacía falta anidarlos, y anidarlos los
           apagaba. */
        /* ══ EL COLOR DEL TRAZO LO DECIDE EL ICONO, NO EL BOTÓN ════════════
           `stroke:currentColor` solo no alcanza: el icono heredaba el color del
           texto que lo rodeara, y media pantalla usa gris apagado a propósito
           para sus botones. Resultado: iconos en gris oscuro sobre fondo
           oscuro, invisibles — y en el tema claro, al revés.

           La referencia de Edwin es clara: trazo CREMA sobre oscuro, con el
           verde solo en el acento. O sea, el color del TEXTO principal, que ya
           cambia solo entre los dos temas (#f0ece4 ↔ #1a1916). Eso es lo que se
           pone aquí, y gana sobre lo que herede del botón.

           Y donde el icono SÍ debe tomar otro color —la flecha sobre el botón
           verde, el icono de una sucursal con su color propio— se le dice con
           `--etx-color`, que es una variable y por lo tanto SÍ se hereda hacia
           dentro de la copia que hace `<use>`. Un color escrito en el botón no
           entraría; una variable sí. */
        st.textContent =
            '.etx-ic{width:24px;height:24px;flex-shrink:0;fill:none;' +
            'color:var(--etx-color, var(--text, #f0ece4));stroke:currentColor;' +
            'stroke-width:2.3;stroke-linecap:round;stroke-linejoin:round}' +
            '.etx-punto{fill:var(--green,#3DBE7A);stroke:none}' +
            '.etx-trazo{stroke:var(--green,#3DBE7A)}';
        (document.head || document.documentElement).appendChild(st);
    }

    function listo() { pintarEstilo(); pintarSprite(); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', listo);
    else listo();

    /* Devuelve el marcado de un icono. Si el nombre no existe devuelve CADENA
       VACÍA y lo dice en consola: un icono que no está no puede dejar un hueco
       con el nombre escrito dentro, y sobre todo no puede dejar pasar texto de
       nadie a un innerHTML. Por eso el nombre se busca en la lista —no se
       concatena— y el tamaño y la clase se limpian antes de usarse. */
    window.etaaxIcono = function (nombre, opc) {
        opc = opc || {};
        if (!SIMBOLOS.hasOwnProperty(String(nombre))) {
            if (window.console) console.warn('[etaax] icono desconocido: ' + nombre);
            return '';
        }
        var t = parseInt(opc.tam, 10); if (!(t > 0 && t <= 512)) t = 24;
        var cl = String(opc.clase || '').replace(/[^A-Za-z0-9 _-]/g, '');
        return '<svg class="etx-ic' + (cl ? ' ' + cl : '') + '" width="' + t + '" height="' + t +
               '" aria-hidden="true"><use href="#etx-' + nombre + '"></use></svg>';
    };

    /* Los nombres disponibles, para que una pantalla pueda preguntar en vez de
       adivinar (y para que el candado los recorra). */
    window.etaaxIconos = function () {
        var l = []; for (var k in SIMBOLOS) if (SIMBOLOS.hasOwnProperty(k)) l.push(k);
        return l.sort();
    };
})();
