/* ============================================================
   ETAAX — Datos para pagar por transferencia

   UN SOLO LUGAR. Los ve el cliente al terminar su alta y también desde el hub
   si su negocio está esperando pago. Si estos datos viven en dos archivos, el
   día que cambie la cuenta uno de los dos va a seguir mandando dinero a la
   cuenta vieja.

   API: window.ETAAX_PAGO_DATOS
   ============================================================ */
window.ETAAX_PAGO_DATOS = {
    banco:    'BBVA',
    titular:  'Edwin Eduardo González González',
    cuenta:   '155 287 7511',
    tarjeta:  '4152 3141 2487 8433',
    clabe:    '0121 8001 5528 775118',
    nota:     'Manda tu comprobante y activamos tu negocio el mismo día.',

    /* Se pinta igual en los dos lados. `compacto` quita el título para cuando
       ya va dentro de una tarjeta que lo dice. */
    html: function (compacto) {
        var d = window.ETAAX_PAGO_DATOS;
        function fila(l, v, mono) {
            return '<div style="display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid rgba(128,128,128,.15)">' +
                '<span style="font-size:11px;letter-spacing:1.2px;text-transform:uppercase;opacity:.6;white-space:nowrap">' + l + '</span>' +
                '<span style="font-size:13px;text-align:right;' + (mono ? 'font-family:monospace;letter-spacing:.5px;' : '') + '">' + v + '</span>' +
            '</div>';
        }
        return (compacto ? '' :
            '<div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;opacity:.6;margin-bottom:6px">Datos para transferencia</div>') +
            fila('Banco', d.banco) +
            fila('Titular', d.titular) +
            fila('Cuenta', d.cuenta, true) +
            fila('Tarjeta', d.tarjeta, true) +
            fila('CLABE', d.clabe, true) +
            '<div style="font-size:11.5px;opacity:.7;line-height:1.55;margin-top:9px">' + d.nota + '</div>';
    }
};
