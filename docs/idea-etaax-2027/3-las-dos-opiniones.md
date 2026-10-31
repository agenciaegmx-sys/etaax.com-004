# 3 · Las dos opiniones: dónde coincidimos y dónde no

Codex y Claude revisamos la idea por separado. Coincidimos en casi todo; la
diferencia real es una sola y vale la pena que quede escrita, porque el día que
se retome la idea hay que decidirla.

## En lo que coincidimos

- **Una sola plataforma.** No partir ETAAX en aplicaciones independientes ni
  rehacer el frontend. Se habilita lo contratado por negocio y sucursal.
- **La validación va en el servidor.** Esconder botones no es un control.
- **Cada servicio trae sus dependencias por dentro**, invisibles para el
  cliente, y esa dependencia no se cobra dos veces cuando sube de plan.
- **Separar suscripción de implementación y consultoría** cuando el trabajo sea
  relevante. (Aporte de Codex; EGMx es consultoría y si las horas quedan
  enterradas en el mensual, el número se ve bien hasta que no cuadra.)
- **Distinguir tres modalidades**: mensual flexible, anual pagado por
  adelantado, y compromiso anual con cobros mensuales. No son lo mismo.
- **Los clientes actuales conservan sus condiciones** durante la transición.
  Una mejora comercial no puede quitarle funciones a quien ya pagaba.
- **El orden**: admin comercial + licencias + integridad de datos primero;
  piloto de Inventarios; luego paquetes, Stripe y landing; la migración de
  sucursales al final, con simulación y reversión probadas.
- **Inventarios necesita oferta propia** si se quiere vender solo. Si vive
  únicamente dentro de Costeo premium, se sigue obligando a comprar Costeo.

## En lo que no coincidimos: cuánto apretar al paquete completo

**Codex:** no inflar los individuales. Que cada servicio se venda por su propio
resultado y que el paquete ahorre frente a precios que realmente se cobran.
Inflar dificultaría justo la entrada de quien solo necesita una herramienta.

**Claude:** con la suma de los tres premium 5% arriba del completo, el paquete
no jala a nadie — y el cliente realista **no compra tres, compra dos**: Costeo
premium + Administrativo = $1,298, que es **28% menos de lo que paga hoy** y le
cubre casi todo lo que usa. El modelo solo suma si trae clientes nuevos; si le
da salida a quien ya paga $1,799, resta. Si la mitad de los clientes actuales
se mueve a dos módulos, hacen falta **+14% de clientes nuevos nada más para
quedarse en el mismo lugar**.

**Cómo se reconcilia** (y es lo que yo propondría el día que se retome): el
riesgo que señala Codex es real, pero se resuelve sin aplanar el paquete.
**La puerta barata es el escalón estándar, no el módulo premium.**

- Costeo estándar ~$399 es el gancho, y engancha de verdad: cuando sus 400
  recetas están capturadas, nadie se va.
- Los premium cerca de **$950** (≈53% del completo), para que **dos ya cuesten
  más que todo**. Entrada barata y presión al paquete, las dos cosas.

La objeción de Codex sigue en pie en una cosa: nada de esto se puede fijar sin
saber **cuánto soporte, implementación e infraestructura consume cada cliente**.
Eso no se sabe todavía, y es un dato de negocio, no de código.

## Lo que ninguno de los dos vio al principio, y es lo más caro

Con los números de la propuesta:

| Escenario | Mensual |
| --- | ---: |
| Completo con 50% (anual) | **$899.50** |
| Completo con 30% (anual) | **$1,259.30** |
| Módulo Administrativo solo, a lista | **$799** |
| Costeo premium + RH estándar, a lista | **$898** |

**El completo con 50% de descuento cuesta $100 más que un módulo suelto.** Y
con 30% cuesta menos que dos módulos a lista.

O sea: **el descuento anual se come el catálogo modular completo.** Nadie
compra una pieza si el sistema entero con compromiso anual cuesta casi lo
mismo. La regla tiene que ser que **el mismo porcentaje aplique a módulos y a
paquete**; si el descuento solo vive en el completo, la escalera de precios es
decoración.

Y los descuentos **no se apilan**. Edwin planteó 30–50% por anual *más* 10–25%
sin plan forzoso. Si se combinan, se acaba vendiendo a mitad de precio sin
compromiso: lo peor de los dos mundos. Codex lo dice igual: paquete, volumen,
anualidad y campaña necesitan reglas explícitas de combinación, y el servidor
debe decidir el descuento — nunca aceptar un importe que mande el navegador.

## Una nota sobre cuántos SKU

De las once herramientas de la lista original, venderlas como once productos es
infierno de soporte y de facturación, y no vende más. Tres paquetes + el
completo era lo razonable; **light/premium, que es lo que Edwin prefirió, es
todavía más simple** y por eso es el mejor punto de arranque.
