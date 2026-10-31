# Histórico del administrador maestro — 31 de octubre de 2026

Acceso desde el botón **Historial de recibos**, junto a Presupuesto / Recibo, o desde la pestaña del mismo nombre. Incluye recibos y presupuestos, búsqueda por folio/cliente, estados pendiente/pagado/anulado, reimpresión, importación de originales PDF y CSV.

El generador archiva antes de imprimir. El servidor conserva folio, importe y documento original, rechaza folios repetidos y utiliza versión para evitar que dos ventanas sobrescriban el estado. La conversión de un presupuesto generado conserva sus conceptos y tarifas; solo admite un recibo asociado. Los PDF anteriores se conservan como originales y no se reconstruyen con las tarifas actuales.

Resumen: emitido por fecha de emisión, cobrado por fecha de pago, saldo pendiente de todos los periodos y MRR documentado por meses cubiertos. El MRR excluye presupuestos, anulaciones y servicios adicionales. Un anual se distribuye entre sus meses. Este indicador proviene de documentos archivados, no reemplaza el MRR de contratos activos. Las operaciones manuales no activan suscripciones ni modifican cobros de Stripe.

La migración `supabase-migration-v81.sql` se aplicó al proyecto enlazado. Crea una tabla privada del admin con RLS y dos RPC de escritura. Se recuperaron cuatro recibos y dos presupuestos de PDF locales; estos archivos y los datos de clientes no se incluyen en el repositorio. Dos recibos requieren clasificar la parte de suscripción por contener servicios sin desglose suficiente. Los presupuestos antiguos sin folio usan un identificador ARCH derivado del archivo.

El catálogo ETAAX detecta fotos nuevas aunque el precio no cambie, resuelve copias por sucursal hasta el maestro y permite revisar la foto antes de aplicarla. Una caché sin foto no elimina la imagen existente. Si una carga o escritura falla, no se da por aplicada la actualización.

Validación:

- `node tests/money-tests.js`: fórmulas de dinero y MRR.
- `node tests/store-tests.js`: almacenamiento y cola de sincronización.
- `ETAAX_PRUEBA_DOCUMENTOS=1 node tests/probar-ventanas-insumos.cjs`: navegador real con backend simulado, escritorio y móvil; persistencia, doble clic, pago, reimpresión, conversión y fallo de guardado.
- `node tests/probar-fotos-admin.cjs`: aplicación de foto, opt-out, preservación de imagen y fallos.
- `node tests/probar-sql-v81.mjs`: SQL real en PGlite, idempotencia, RLS, importes inmutables y control de versión. Requiere `@electric-sql/pglite` en `PGLITE_DIR` (por defecto `/tmp/etaax-billing-sql`).

Las pruebas de navegador no representan una sesión autenticada real del administrador. La verificación adicional en producción revisa las políticas y la integridad SHA-256 de los PDF recuperados.
