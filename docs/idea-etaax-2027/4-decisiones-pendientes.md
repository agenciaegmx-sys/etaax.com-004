# 4 · Decisiones pendientes

Ninguna de estas es de código. Son las que hay que responder **antes** de que
alguien escriba una línea, porque cada una cambia lo que se construye.

## De negocio

1. **¿Light/premium o catálogo de módulos?** Edwin prefirió light/premium. Es
   un solo eje en vez de una matriz, y simplifica la capa de licencias. Si se
   confirma, **¿dónde se corta?** La auditoría dice que los módulos comparten
   datos, así que el corte no puede ser por módulo: tendría que ser por
   capacidad (p. ej. light sin inventarios ni requisiciones ni RH operativo).
2. **¿Por sucursal o por negocio?** Crítico. Si los módulos son precio plano
   por negocio, el cliente de 10 sucursales pasa de $16,000 a $1,897 al mes.
   El cobro de hoy es por sucursal y la oferta tendría que decirlo claro.
3. **¿Cuánto cuesta atender a un cliente?** Soporte, implementación, carga
   inicial, infraestructura, cobro y abandono. Sin eso no hay margen que
   defender ni descuento que se pueda fijar.
4. **Reglas de descuento**: cuáles se combinan, por cuánto tiempo, qué pasa en
   la renovación. Y que el mismo porcentaje aplique a piezas y a paquete, o la
   escalera se cae (ver [3-las-dos-opiniones.md](3-las-dos-opiniones.md)).
5. **¿Dónde viven Menú digital y los reportes corporativos?** No están
   asignados en ninguna de las dos propuestas.
6. **Alcance de Inventarios independiente**: ¿incluye requisiciones? ¿Incluye
   la composición de recetas para calcular consumos, o eso es premium?
7. **Política de históricos al trasladar una sucursal**: ¿se mueve el histórico
   completo o se arranca con existencia inicial de corte y los documentos
   financieros cerrados se quedan en la entidad original? (Recomendación de
   Codex: lo segundo.)

## De producto

8. **Qué ve el cliente que no contrató un módulo** en cada cruce de datos. No
   puede ser un cero: tiene que decir dónde vive ese dato y cuánto cuesta.
9. **Qué pasa al cambiar de plan**: altas, bajas, prorrateo, y no cobrar dos
   veces una dependencia que ya venía incluida.
10. **La landing.** Codex propone tarjetas por resultado («Costea tus recetas»,
    «Controla tu inventario», «Administra tu operación», «Organiza a tu
    equipo», «Todo ETAAX») con alcance, sucursales incluidas, modalidad, precio
    y qué pasa al cambiar de plan; la comparación detallada abajo. Buena base.

## De arquitectura (para cuando ya haya respuestas arriba)

11. **Las cuatro identidades** que propone Codex y que conviene formalizar:
    producto maestro de ETAAX → maestro del negocio → ficha de sucursal →
    presentación/rendimiento. Cada una con ID estable y nombre editable; el
    maestro global sin existencias, precios propios ni datos privados de una
    sucursal.
12. **`origenId` hace demasiados trabajos** hoy (importación, maestro y copia)
    y los resolvers no recorren la misma profundidad. Habría que introducir
    relaciones explícitas + **tabla de alias** para no romper referencias
    históricas. **No regenerar IDs ni fusionar productos por parecerse de
    nombre.**
13. **`suc_principal` se reutiliza entre negocios** y la sucursal vive embebida
    en `negocio_sucursales.datos`. Cambiar solo `negocio_id` no basta para
    mover una sucursal.
14. **La licencia y la contabilidad de cobros son entidades separadas.**
    Presupuesto, documento por cobrar, pago recibido, asignación del pago y
    derecho de acceso son estados relacionados, no un mismo registro. Separarlos
    desde el principio es lo que después permite abonos, saldos, cancelaciones
    y MRR contractual sin confundir cotizaciones con ingresos.

## Lo que no hay que esperar a decidir

Los tres puntos del [README](README.md#lo-que-sí-conviene-no-perder-de-vista-aunque-la-idea-se-congele):
la columna que no existe en requisiciones, los 109 insumos huérfanos y el
esquema de `negocio_insumos` fuera de control de versiones. Esos son de hoy.
