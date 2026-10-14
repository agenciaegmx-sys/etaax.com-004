/* Referencias iniciales, visibles y editables. Revisadas el 13-oct-2026.
   Ninguna sugerencia reemplaza una meta del negocio sin pulsar Guardar. */
(function(){
    'use strict';
    var NRA='https://restaurant.org/research-and-media/media/press-releases/new-resource-from-national-restaurant-association-provides-insights-into-operational-realities/';
    var SH='https://www.sculpturehospitality.com/blog/what-is-the-average-liquor-cost-for-a-bar';
    var SPEC={
        cocina:{nombre:'Costo de cocina',texto:'Referencia: 28–35% sobre ventas de alimentos. Sugerimos el límite de 35%, adaptado a la participación de cocina en las ventas totales. Aquí medimos compras pagadas; el referente de industria usa consumo.',url:'https://www.sculpturehospitality.com/blog/what-is-the-average-restaurant-food-cost',fuente:'Sculpture Hospitality · referencia de alimentos'},
        barra:{nombre:'Costo de barra',texto:'Referencia de programas de bebidas alcohólicas: 18–24% sobre ventas de bebidas. Propuesta inicial: 22%, adaptada a la participación de barra en la venta total. Ajusta la mezcla para cafeterías y otros conceptos.',url:SH,fuente:'Sculpture Hospitality · julio 2025'},
        staff:{nombre:'Staff cost',texto:'Propuesta inicial: máximo 35%. La muestra de restaurantes con servicio completo reportó 36.5% de nómina y beneficios; los rentables, 34.2%. Es una referencia internacional para ajustar a tu operación.',url:'https://restaurant.org/research-and-media/research/restaurant-economic-insights/analysis-commentary/elevated-labor-costs-had-a-significant-impact-on-restaurant-profitability-in-2024/',fuente:'National Restaurant Association · octubre 2025'},
        primo:{nombre:'Prime cost',texto:'Propuesta inicial: máximo 65% de ventas. La muestra de servicio rápido reportó 65% combinado de alimentos, bebidas y personal. Aquí la base son compras pagadas y nómina; revisa inventario y formato antes de compararlo.',url:NRA,fuente:'National Restaurant Association · agosto 2025'},
        utilidad:{nombre:'Utilidad',texto:'Propuesta inicial: mínimo 5%. La referencia de industria sitúa el margen típico antes de impuestos en torno a 5%; ETAAX muestra utilidad después de egresos y apartados. Úsala como objetivo inicial de disponibilidad, ajustable a tu negocio.',url:'https://restaurant.org/research-and-media/research/inflation/',fuente:'National Restaurant Association · consulta octubre 2026'},
        cheque:{nombre:'Cheque promedio',monto:true,texto:'Propuesta inicial: $300 MXN por comensal. Una encuesta puntual de CANIRAC durante el Mundial 2026 situó el rango más frecuente en $251–400 por persona. Es una referencia de esa temporada, no un promedio universal: ajusta por concepto y ciudad.',url:'https://portal.canirac.org.mx/noticias/canirac-reporta-aumento-focalizado-en-restaurantes-durante-el-arranque-del-mundial-2026-el-dia-del-padre-impulso-el-consumo/',fuente:'CANIRAC · junio 2026 · México'},
        propinas:{nombre:'Propinas promedio',monto:true,texto:'Parámetro inicial ETAAX: 10% del cheque objetivo, expresado por comensal. Es una propuesta de seguimiento del servicio, no una media de mercado ni un cargo. La propina es voluntaria.',url:'https://mundialsocial.profeco.gob.mx/blog/propina-voluntaria/',fuente:'Profeco · mayo 2026 · propina voluntaria'},
        extra:{nombre:'Consumo extra vs. receta',texto:'Parámetro inicial ETAAX: tolerancia de 2% frente al consumo teórico. Es un objetivo interno de control, no una media de mercado. El indicador seguirá sin cifra hasta tener consumos comparables.',url:SH,fuente:'Referencia de método: controlar recetas e inventario'}
    };
    function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
    function formatear(k,v){return SPEC[k].monto?Number(v).toLocaleString('es-MX',{style:'currency',currency:'MXN'}):Number(v).toFixed(1)+'%';}
    function abrir(k,op){
        if(!SPEC[k]||!op||!op.listo)return;
        var spec=SPEC[k],sug=EtaaxCore.sugerenciasRestaurante(op.cortes,op.targets),reg=sug.mezcla.origen==='registrada';
        var d=document.getElementById('metaIndicadorDialog');
        if(!d){d=document.createElement('dialog');d.id='metaIndicadorDialog';d.className='meta-ind-dialog';document.body.appendChild(d);}
        var regreso=document.activeElement,negId=EtaaxCore.getNegocioActivo();
        d.innerHTML='<form id="metaIndicadorForm"><div class="meta-ind-head"><div><small>OBJETIVO DEL NEGOCIO</small><h2 id="metaIndicadorTitulo">'+esc(spec.nombre)+'</h2></div><button type="button" id="metaIndicadorCerrar" aria-label="Cerrar">×</button></div>'+
            '<div class="meta-ind-cuerpo"><p>'+esc(spec.texto)+'</p><a class="meta-ind-fuente" href="'+spec.url+'" target="_blank" rel="noopener noreferrer">'+esc(spec.fuente)+' ↗</a>'+
            ((k==='cocina'||k==='barra')?'<label>Participación de '+(k==='cocina'?'cocina':'barra')+' en las ventas totales · %<input id="metaIndicadorMix" type="number" min="0" max="100" step="0.01" value="'+sug.mezcla[k]+'" required></label><p class="meta-ind-contexto" id="metaIndicadorContexto">'+(reg?'Mezcla registrada en los cortes de este periodo.':'Supuesto inicial editable; falta un desglose completo de ventas por área.')+' La sugerencia adapta el referente a la base del tablero.</p>':'')+
            '<div class="meta-ind-sugerencia"><span>Sugerencia inicial</span><strong id="metaIndicadorSugerida">'+formatear(k,sug[k])+'</strong><button type="button" id="metaIndicadorUsar">Usar sugerencia</button></div>'+
            '<label>Tu meta · '+(spec.monto?'MXN por comensal':k==='utilidad'?'porcentaje mínimo':'porcentaje '+(k==='propinas'?'mínimo':'máximo'))+'<input id="metaIndicadorValor" type="number" min="0" '+(spec.monto?'':'max="100" ')+'step="0.01" value="'+(op.actual===null?sug[k]:op.actual)+'" required></label>'+
            '<p id="metaIndicadorEstado" role="status"></p></div><div class="meta-ind-pie"><button type="button" id="metaIndicadorCancelar">Cancelar</button><button type="submit" id="metaIndicadorGuardar">Guardar meta</button></div></form>';
        d.setAttribute('aria-labelledby','metaIndicadorTitulo');
        function cerrar(){d.close();if(regreso&&regreso.isConnected)regreso.focus();else {var nuevo=document.querySelector('[data-kpi="'+k+'"] .kpi-definir-meta');if(nuevo)nuevo.focus();}}
        ['Cerrar','Cancelar'].forEach(function(x){document.getElementById('metaIndicador'+x).onclick=cerrar;});
        d.onclick=function(e){if(e.target===d){var r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)cerrar();}};
        d.onclose=function(){if(regreso&&regreso.isConnected)regreso.focus();else {var nuevo=document.querySelector('[data-kpi="'+k+'"] .kpi-definir-meta');if(nuevo)nuevo.focus();}};
        var mixEl=document.getElementById('metaIndicadorMix');
        function calcular(){
            var mix=null;if(mixEl){mix={};mix[k]=Number(mixEl.value);}
            if(mixEl){var c=document.getElementById('metaIndicadorContexto');c.textContent=reg&&Math.abs(Number(mixEl.value)-sug.mezcla[k])<.001?'Mezcla registrada en los cortes. La sugerencia se adapta a venta total.':'Mezcla estimada de planeación. La sugerencia se adapta a venta total.';}
            var s=EtaaxCore.sugerenciasRestaurante(op.cortes,op.targets,mix);
            document.getElementById('metaIndicadorSugerida').textContent=formatear(k,s[k]);return s[k];
        }
        if(mixEl)mixEl.oninput=calcular;
        document.getElementById('metaIndicadorUsar').onclick=function(){document.getElementById('metaIndicadorValor').value=calcular();};
        document.getElementById('metaIndicadorForm').onsubmit=function(e){
            e.preventDefault();var el=document.getElementById('metaIndicadorValor'),v=Number(el.value),estado=document.getElementById('metaIndicadorEstado');
            if(!el.checkValidity()||!isFinite(v)||v<0||(!spec.monto&&v>100)||(mixEl&&!mixEl.checkValidity())){estado.textContent='Revisa el valor de la meta y la mezcla de ventas.';return;}
            if(EtaaxCore.getNegocioActivo()!==negId){estado.textContent='Cambió el negocio activo. Cierra y vuelve a abrir la meta.';return;}
            if(op.guardar(k,v)!==false)cerrar();
        };
        d.showModal();
    }
    window.EtaaxMetas={abrir:abrir,formatear:formatear,spec:SPEC};
})();
