/* Negocio ficticio: dos sucursales, octubre y registros fuera del periodo.
   Importes elegidos para verificar compras, nómina, propinas y reservas. */
'use strict';
const targets = { fijos:10.5, variables:33, nomOp:20, nomAdm:8, prev:4, util:20,
    food:30, primo:65, nota:'conservar', operativos:{cocina:22,barra:15,staff:28,
    primo:60,cheque:310,propinas:20,extra:5,desconocida:77} };
const gasto = (id, fecha, sucursalId, categoria, monto, extra={}) => ({id,fecha,sucursalId,categoria,monto,estatus:'pagado',concepto:id,...extra});
const tables = {
    cortes:[{id:'c1',fecha:'2026-10-05',efectivo:180000,comensales:600,propEfectivo:12000},
        {id:'c2',fecha:'2026-10-06',sucursalId:'norte',efectivo:120000,comensales:400,propTarjeta:8000},
        {id:'c3',fecha:'2026-09-30',efectivo:50000,comensales:100,propEfectivo:1000}],
    sf_otros:[{id:'o1',fecha:'2026-10-08',monto:9000},{id:'o2',fecha:'2026-10-06',sucursalId:'norte',monto:3000}],
    gastos:[gasto('comida-M','2026-10-05','','Alimentos e ingredientes',36000),
        gasto('barra-M','2026-10-05','','Bebidas y licores',21000),
        gasto('personal-M','2026-10-05','','Nómina y personal',45000),
        gasto('imss-M','2026-10-05','','IMSS',3000),
        gasto('local-M','2026-10-05','','Renta',42000),
        gasto('comida-N','2026-10-06','norte','Alimentos e ingredientes',24000),
        gasto('barra-N','2026-10-06','norte','Bebidas y licores',15000),
        gasto('personal-N','2026-10-06','norte','Nómina y personal',30000),
        gasto('imss-N','2026-10-06','norte','IMSS',3000),
        gasto('local-N','2026-10-06','norte','Renta',21000),
        gasto('pedido-no-pagado','2026-10-05','','Alimentos e ingredientes',90000,{estatus:'pendiente'}),
        gasto('propinas-pass-through','2026-10-05','','Propinas',500)],
    depositos:[{id:'d1',fecha:'2026-10-05',tipo:'apartado',prevId:'_general',monto:2200},
        {id:'d2',fecha:'2026-10-06',sucursalId:'norte',tipo:'apartado',prevId:'_general',monto:2000}],
    gf_fijos:[],staff:[],previsiones:[],tarjetas_credito:[]
};
module.exports = {tables,targets};
