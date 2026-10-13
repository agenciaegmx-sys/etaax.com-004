# Header, Mi cuenta y Plan y facturación

El dueño pidió completar el rediseño del header, separar el subheader y dar destinos propios a los dos enlaces de cuenta. Se trabajó sobre `5b80f5a`, conservando los cambios locales previos de `hub.html` y `tests/money-tests.js`.

## Resultado

- **Header:** mide su altura con `ResizeObserver` y reserva ese espacio en el cuerpo. El menú se posiciona debajo de su altura real, conserva el nombre en móvil y cabe desde 320 px. Los textos se escapan aun cuando `security.js` todavía no haya cargado. Escape y clic fuera cierran el menú; su estado se expone mediante `aria-expanded`. El logo y el icono del tema siguen la preferencia actual. El interruptor flotante se oculta en las páginas que ya tienen el del header.
- **Hub:** separa 24 px el header de la barra del negocio; 18 px en móvil. Su altura mínima descuenta la altura medida del header. Se conservaron la eliminación local previa del cierre de `div` extra y los botones de salida repetidos.
- **Mi cuenta** (`mi-cuenta.html`): nombre, correo de acceso, negocios vinculados, apariencia, cambio de correo y contraseña. Las modificaciones de credenciales requieren la contraseña actual, comprobada con un cliente aislado que no reemplaza la sesión principal. El correo pendiente de confirmación mantiene visible el actual. Los formularios impiden un segundo envío mientras el primero sigue en curso. El nombre actualiza Auth, su espejo en `usuarios` y las cachés locales de sesión correspondientes.
- **Plan y facturación** (`plan-facturacion.html`): selección del negocio, estado leído mediante `negocio_cobro_estado`, fecha de cobro, costo y desglose por sucursal mediante `EtaaxPrecios`, transferencia, contacto para comprobantes y solicitud de factura por correo. Cambiar de negocio en esta vista conserva el negocio y sucursal de trabajo. Una respuesta vieja no puede reemplazar el plan recién seleccionado.
- **Navegación:** los enlaces del header llevan a las dos páginas. «Volver» conserva el módulo de origen y acepta únicamente destinos del mismo sitio. La configuración del negocio conserva su acceso existente.

Los dos documentos usan `cuenta.css` y `etaax-cuenta.js`, además del header, temas, iconos, precios y seguridad existentes. El contacto de cobro se centralizó en `ETAAX_PAGO_DATOS.contacto`, en `datos-pago.js`, y el hub lo consume desde allí. Se versionaron los scripts modificados que necesitan las nuevas páginas para evitar una mezcla inicial con sus copias anteriores de caché.

## Alcance del acceso y del cobro

La sesión se confirma mediante `auth.getUser()`. Los negocios del titular se consultan con su identificador real. Las cuentas compartidas de staff también se reconocen consultando `negocios.staff_uid`: cambiar el marcador de navegador a «owner» no habilita sus formularios. El colaborador ve su acceso y el estado del servicio; no se muestran el correo compartido ni los controles de credenciales o cobro.

La pantalla consulta suscripciones, pero no inserta ni modifica sus estados. El checkout existente se ofrece para un servicio no activo que no tenga una suscripción Stripe vinculada. Si ya existe una suscripción de tarjeta, se ofrece contactar a soporte para gestionar ese cobro; así esta nueva pantalla evita crear otra desde su botón.

Facturación abre una solicitud de correo con los datos del negocio y campos fiscales para completar. La generación automática de CFDI y la descarga de un historial no forman parte de este cambio: `pagos_suscripcion` mantiene su lectura restringida al administrador. No se ampliaron políticas ni permisos. R03 y R14 conservan el alcance pendiente de la auditoría.

## Verificación

- `node tests/money-tests.js`: **4,395 comprobaciones, 0 fallas**. Tres fixtures del hub ahora cargan también su dependencia real `datos-pago.js`.
- `node tests/store-tests.js`: **84 comprobaciones, 0 fallas**.
- `node tests/probar-cuenta-header.cjs`: **20 casos, 0 fallas**, con Chrome real, servidor local y Supabase simulado. El navegador bloquea cualquier petición fuera del origen de prueba.
- Sintaxis de los scripts y `git diff --check`: correctos.

El arnés del navegador comprueba cambios de nombre y contraseña, rechazo de contraseña incorrecta, correo pendiente de confirmación, aislamiento del colaborador aun con contexto alterado, textos escapados, regreso seguro, tema, menú, precios por sucursal, fallo y reintento de lectura, selección con una respuesta retenida, rechazo de URL insegura de checkout, prevención de una segunda suscripción y disposición de las pantallas en PC y móvil. Para la carrera, primero exige que existan dos consultas retenidas; después cambia de negocio y libera sus respuestas.

Capturas del navegador en la carpeta temporal del equipo: `etaax-mi-cuenta-pc.png`, `etaax-plan-pc.png`, `etaax-mi-cuenta-movil.png` y `etaax-plan-movil.png`. Los datos son ficticios.

## Entrega

Cambios preparados en el workspace. El dueño pidió conservar esta implementación en un commit local antes de evaluar la nueva paleta; no se hizo push. No se ejecutaron migraciones, se desplegaron funciones ni se modificaron datos de producción. Los cambios de credenciales y el checkout se comprobaron con el proveedor simulado; su uso real corresponde a las acciones explícitas del usuario en las nuevas páginas.
