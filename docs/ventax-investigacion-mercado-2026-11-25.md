# Vent·ax · investigación de mercado de POS (25-nov-2026)

Página con la matriz completa: https://claude.ai/artifact/X98c7wFZnAodV9gpeN7XNY (privada, de Edwin).

Doce POS de restaurante cotejados contra lo que ETAAX ya hace, para decidir qué trae la
beta de Vent·ax. Las fuentes son comparativas publicadas por los propios proveedores o por
sitios con enlaces de afiliado: un «?» es «sin dato confirmado», no «no lo tiene», y los
precios hay que confirmarlos con cotización antes de citarlos.

## Hallazgos

1. **El mercado cobra por piezas.** Fudo $360 + $100 mesas + $200 cocina + $200 CFDI +
   $200 delivery; Poster $361 por terminal extra; Soft Restaurant con timbres y delivery
   aparte. Un restaurante completo paga **$660–$1,050 al mes por sucursal**.
2. **Casi nadie hace bien el costo.** Inventario que descuenta por receta sí hay; costeo
   por platillo con metas por tipo, neto al banco con comisiones y nómina con propinas,
   casi ninguno. ETAAX ya lo tiene.
3. **A ETAAX le falta el piso:** mesas, comandas, cobro y ticket.
4. **La competencia real es local.** Toast no opera en México y Square no cobra con
   tarjeta aquí. Rivales: Soft Restaurant, Parrot, PoloTab, Fudo, Poster, OlaClick.
5. **Diferenciador:** cada venta trae su costo. Al cobrar, ETAAX descuenta la receta del
   inventario, suma al food cost del día por tipo y arma el corte del turno con comisiones.
   Sin contrato y en la tablet que ya tengan.

## Precios de referencia en México (al mes, por sucursal)

| Sistema | Precio | Nota |
|---|---|---|
| TuMenuDigital | $149 – $899 | Sin CFDI ni apps de delivery |
| OlaClick | $200 – $1,203 | Pago anual; gratis hasta 75 pedidos |
| Fudo | $360 – $660 + IVA | + $200 CFDI, + $200 delivery |
| Colega Menus | $499 – $799 | Varias funciones «pronto» |
| Poster POS | $495 – $550 | + $361 por terminal |
| Soft Restaurant | $699 – $799 + IVA | Timbres y delivery aparte |
| Parrot | desde $949 | Con terminal Parrot Pay |
| PoloTab | desde $990 + IVA | Hardware aparte |
| Loyverse | $0 + US$5 por empleado | Inventario avanzado US$25 |
| Toast (EE.UU.) | US$0–165 + 2.49% | No opera en México |
| Square (EE.UU.) | US$0–149 | No cobra con tarjeta en México |
| Lightspeed | US$69–399 + US$30 por KDS | IA de ingeniería de menú (2026) |

## Propuesta de beta (pendiente de que Edwin confirme)

**Fase 1:** menú = recetas activas con precio; cuentas por mesa o para llevar; comandas a
cocina y barra con pantalla de cocina; cobro con propina, cuenta dividida, pago mixto,
descuento con clave y ticket de 80 mm; turno con fondo que al cerrar prellena el corte de
Admin·ax, manda ventas por producto a Fin·ax y descarga el inventario; sigue vendiendo sin
internet con la cola de salida.

**Fase 2:** terminal integrada (Clip o Mercado Pago), CFDI con Timbr·ax, Rappi/Uber
Eats/DiDi, pedidos desde la carta QR, plano visual de mesas, reservaciones, lealtad,
impresión directa a la térmica.

**Decisiones abiertas:**
1. Tipo de servicio: se recomendó mesas y mostrador con el mismo modelo de cuenta.
2. Dispositivo: se recomendó tablet de la sucursal y NIP de 5 dígitos por mesero.
3. Ticket: se recomendó imprimir desde el navegador en la beta.
4. Precio: se sugirió $699 por sucursal y dentro del paquete completo.

## Fuentes

- https://www.polotab.com/blog/mejor-punto-de-venta-para-cafeterias-y-restaurantes-en-mexico-2026
- https://www.bitsperfoods.com/blog/mejores-sistemas-pos-restaurantes-mexico-2026
- https://tumenudigital.mx/mejores-sistemas-pos-para-restaurantes
- https://olaclick.com/es/punto-de-venta/mejores-sistemas-pos-restaurantes-mexico-colombia-2026/
- https://puntodeventa.com.mx/blog/top-8-mejores-puntos-de-venta.php
- https://restauranttools.ai/blog/best-restaurant-pos-systems
- https://www.upmenu.com/blog/best-restaurant-pos-systems/
- https://www.directorders.com/blog/restaurant-pos-system-cost
- https://www.capterra.com/p/220120/Parrot-Software/
- https://www.capterra.com/p/200701/Soft-Restaurant/
