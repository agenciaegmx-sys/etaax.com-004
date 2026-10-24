/* Presentaciones de porción de UNA subreceta. El cálculo vive en EtaaxCore. */
var _rendimientosSub = [], _rendimientosPendientes = false;
function _subInsumoEnSucursal(x) {
    if (sessionStorage.getItem('etaax_cat_global') === '1') return true;
    var suc = localStorage.getItem('etaax_sucursal_activa') || 'suc_principal';
    if (window._insumoEnSuc && window._insumoEnSuc(x, suc)) return true;
    return suc === 'suc_principal' && !Array.isArray(x.sucursales) && !x.sucursalId && !x.origenId;
}
function _subInsumoBorrado(id) {
    try { return !!JSON.parse(localStorage.getItem(_sk('ins_borrados')) || '{}')[id]; } catch(e) { return false; }
}
function cargarRendimientosSub(cx, nombre) {
    _rendimientosSub = EtaaxCore.rendimientosSubReceta(cx, nombre);
    _rendimientosPendientes = true;
}
function leerRendimientosSub() {
    if (!_rendimientosSub.length) cargarRendimientosSub({}, '');
    if (_rendimientosPendientes) return JSON.parse(JSON.stringify(_rendimientosSub));
    function valor(id, antes) { var el = document.getElementById(id); return el ? el.value : antes; }
    _rendimientosSub.forEach(function(r, i){
        if (r.inactiva) return;
        var pref = i ? 'sr_' + i + '_' : '';
        r.nombre = valor(i ? pref + 'nombre' : 'subRendNombre', r.nombre);
        ['porcionesQty','porcionesUnidad','pesoPorcion','unidadPesoPorcion'].forEach(function(k){
            r[k] = valor(pref + k, r[k]);
        });
    });
    return JSON.parse(JSON.stringify(_rendimientosSub));
}
function capturarRendimientosSub() { if (!_rendimientosPendientes) leerRendimientosSub(); }
function montarRendimientosSub() {
    var qty = document.getElementById('porcionesQty');
    if (!qty) return;
    if (!_rendimientosSub.length) cargarRendimientosSub({}, '');
    var primero = _rendimientosSub[0], nombre = (document.getElementById('nombreReceta') || {}).value || '';
    var bloque = qty.closest('.sr-principal');
    if (!bloque) return;
    var titulo = document.createElement('div'); titulo.className = 'sr-nombre';
    titulo.innerHTML = '<label for="subRendNombre">Nombre de la presentación · Rendimiento 1</label>' +
        '<input id="subRendNombre" data-autonombre="' + (primero.nombre ? '0' : '1') + '" value="' + etx(primero.nombre || nombre) + '" placeholder="' + etx(nombre || 'Nombre de la subreceta') + '" oninput="this.dataset.autonombre=\'0\';calcSubRecetaCostos()">';
    bloque.insertBefore(titulo, bloque.children[1] || null);
    var host = document.createElement('div'); host.id = 'subRendimientosExtra';
    host.innerHTML = _rendimientosSub.map(function(r, i){
        if (!i || r.inactiva) return '';
        var p = 'sr_' + i + '_';
        function input(k, tipo, placeholder) {
            return '<input id="' + p + k + '" type="' + tipo + '" value="' + etx(String(r[k] || '')) + '"' +
                (tipo === 'number' ? ' min="0" step="any"' : '') + ' placeholder="' + placeholder + '" oninput="cambiarDatoRendimientoSub(' + i + ',\'' + k + '\')">';
        }
        function select(k, opts) {
            return '<select id="' + p + k + '" onchange="calcSubRecetaCostos()">' + opts.map(function(u){
                return '<option' + (r[k] === u ? ' selected' : '') + '>' + u + '</option>';
            }).join('') + '</select>';
        }
        return '<section class="sr-presentacion"><div class="sr-presentacion-head"><strong>Rendimiento ' + (i+1) + '</strong>' +
            '<button type="button" class="btn-vista" onclick="quitarRendimientoSub(' + i + ')">Quitar</button></div>' +
            '<label>Nombre de la presentación' + input('nombre','text','Ej. Mediano') + '</label>' +
            '<div class="sr-presentacion-campos"><label>Cantidad de porciones por tanda<div>' + input('porcionesQty','number','Ej. 4') +
            select('porcionesUnidad',['pzas','porciones','raciones','tazas','copas']) + '</div></label>' +
            '<label>O peso / volumen de cada porción<div>' + input('pesoPorcion','number','Ej. 500') +
            select('unidadPesoPorcion',['G','KG','ML','LT']) + '</div></label></div>' +
            '<div id="' + p + 'resultado" class="sr-presentacion-resultado"></div></section>';
    }).join('') + '<button type="button" class="btn-vista sr-agregar" onclick="agregarRendimientoSub()">+ Agregar otra presentación</button>';
    bloque.after(host);
    _rendimientosPendientes = false;
}
function cambiarDatoRendimientoSub(i, campo) {
    if (campo === 'porcionesQty' || campo === 'pesoPorcion') {
        var otro = document.getElementById('sr_' + i + '_' + (campo === 'porcionesQty' ? 'pesoPorcion' : 'porcionesQty'));
        if (otro) otro.value = '';
    }
    calcSubRecetaCostos();
}
function agregarRendimientoSub() {
    leerRendimientosSub();
    _rendimientosSub.push({id:'r_' + genId(),nombre:'Presentación ' + (_rendimientosSub.length+1),
        porcionesQty:'',porcionesUnidad:'pzas',pesoPorcion:'',unidadPesoPorcion:recetaTipoActual === 'sub-bebidas' ? 'ML' : 'G'});
    renderRendimientoSub();
    _marcarRendimientosSub();
}
function quitarRendimientoSub(i) {
    leerRendimientosSub();
    if (!i || !_rendimientosSub[i]) return;
    var r = _rendimientosSub[i];
    if (!EtaaxCore.calcularPorcionSubReceta(datosBaseRendimientosSub(), r, 0).valido && typeof _buscarInsumoSubReceta === 'function') {
        var ins = _buscarInsumoSubReceta();
        var prev = EtaaxCore.porcionesInsumoSubReceta(ins).find(function(p){ return p.rendimientoId === r.id; });
        if (prev) { r.porcionesQty = prev.rendimiento; r.pesoPorcion = ''; }
    }
    // Se conserva su identidad para que las recetas que la usan sigan calculando.
    _rendimientosSub[i].inactiva = true;
    renderRendimientoSub();
    _marcarRendimientosSub();
}
function _marcarRendimientosSub() {
    window._escDirty = true;
    if (typeof window._avisarDirty === 'function') window._avisarDirty();
    if (typeof guardarEnHistorial === 'function') guardarEnHistorial();
}
function datosBaseRendimientosSub() {
    var el = document.getElementById('rendimientoFinal'), un = document.getElementById('unidadRendimientoFinal');
    return { rendimientoFinal:el ? el.value : (window._subBaseCalc || {}).cantidad,
        unidadRendimientoFinal:un ? un.value : (window._subBaseCalc || {}).unidad };
}
function validarRendimientosSub() {
    var cx = datosBaseRendimientosSub(), lista = leerRendimientosSub();
    var mala = lista.find(function(r, i){
        return !r.inactiva && (i > 0 || r.porcionesQty || r.pesoPorcion) &&
            !EtaaxCore.calcularPorcionSubReceta(cx, r, 0).valido;
    });
    if (!mala) return true;
    alert('Revisa «' + (mala.nombre || 'Rendimiento 1') + '»: define el rendimiento final y una cantidad de porciones o un peso/volumen compatible.');
    return false;
}
function actualizarRendimientosSub(costoTotal) {
    var cx = datosBaseRendimientosSub(), lista = leerRendimientosSub();
    function texto(c) {
        return c.valido ? c.cantidad.toLocaleString('es-MX',{maximumFractionDigits:3}) + ' porciones · ' +
            c.contenidoBase.toLocaleString('es-MX',{maximumFractionDigits:3}) + ' ' + c.unidadBase.toLowerCase() +
            ' por porción · $' + c.costo.toFixed(2) + ' / porción' : 'Define el rendimiento final y una cantidad o peso compatible.';
    }
    lista.forEach(function(r, i){
        var c = EtaaxCore.calcularPorcionSubReceta(cx, r, costoTotal);
        if (!i) {
            window._subPorcionCalc = c.valido ? {costo:c.costo,cantidad:c.cantidad} : null;
            var e = document.getElementById('sub-costoPorcion'); if (e) e.textContent = c.valido ? '$'+c.costo.toFixed(2) : '—';
            e = document.getElementById('sub-costoPorcionLabel'); if (e) e.textContent = c.valido ? 'por porción' : '';
            e = document.getElementById('sub-pesoAutoResult'); if (e) e.textContent = r.porcionesQty ? texto(c) : '';
            e = document.getElementById('sub-cantAutoResult'); if (e) e.textContent = r.pesoPorcion ? texto(c) : '';
        } else {
            var el = document.getElementById('sr_'+i+'_resultado'); if (el) el.textContent = texto(c);
        }
    });
}
var _refrescoRendimientosSub = null;
function refrescarInsumoSubReceta() {
    if (!document.getElementById('cardAgregarInsumo') || _refrescoRendimientosSub || typeof _sbInitInsumosCatalogo !== 'function') return;
    _refrescoRendimientosSub = Promise.resolve(_sbInitInsumosCatalogo()).finally(function(){
        _refrescoRendimientosSub = null;
        if (typeof _actualizarBotonAgregarInsumo === 'function') _actualizarBotonAgregarInsumo();
    });
}
window.addEventListener('focus', refrescarInsumoSubReceta);
document.addEventListener('input',function(e){
    if (e.target.id !== 'nombreReceta') return;
    var nombre = document.getElementById('subRendNombre');
    if (nombre && nombre.dataset.autonombre === '1') nombre.value = e.target.value;
});
document.addEventListener('visibilitychange',function(){ if (!document.hidden) refrescarInsumoSubReceta(); });
window.addEventListener('storage',function(e){ if (e.key && /_(insumos|ins_borrados)$/.test(e.key)) refrescarInsumoSubReceta(); });
