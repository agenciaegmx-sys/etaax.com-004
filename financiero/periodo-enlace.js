/* Filtros del Resumen al abrir su fuente. Cada destino mantiene su propia
   inicialización; las fechas se validan y el alcance bloqueado se conserva. */
(function(){
    window.etaaxPeriodoEnlace=function(op){
        var q;try{q=new URLSearchParams(location.search);}catch(e){return false;}
        var desde=q.get('desde')||'',hasta=q.get('hasta')||'';
        if(!/^\d{4}-\d{2}-\d{2}$/.test(desde)||!/^\d{4}-\d{2}-\d{2}$/.test(hasta)||desde>hasta)return false;
        var tipo=q.get('tipo'),val=q.get('periodo');
        if(['dia','semana','mes','rango'].indexOf(tipo)<0){tipo='rango';val=desde;}
        var rg=EtaaxCore.getRange(tipo,val,hasta);
        if(rg.from!==desde||rg.to!==hasta){tipo='rango';val=desde;}
        op.periodo(tipo);
        var input=document.getElementById(op.input||'pickerInput'),end=document.getElementById('pickerEnd');
        if(input){input.type=tipo==='mes'?'month':tipo==='semana'?'week':'date';input.value=val;}
        if(end){end.value=hasta;end.style.display=tipo==='rango'?'':'none';}
        if(op.sucursal&&q.has('suc'))op.sucursal(q.get('suc')||'');
        if(op.render)op.render();return true;
    };
})();
