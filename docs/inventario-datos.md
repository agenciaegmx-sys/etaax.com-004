# Inventario de datos personales — ETAAX

Documento interno. **Es la base del aviso de privacidad**: cualquier dato que la
app guarde y no esté aquí, no está declarado, y un aviso que no declara un dato
no lo ampara.

Levantado leyendo el código el **8 de septiembre de 2026**. Al agregar un campo
que identifique a una persona, actualizar esta tabla **en el mismo commit**.

---

## 1 · De quién contrata ETAAX (el dueño del negocio)

| Dato | Dónde vive | Para qué |
|---|---|---|
| Nombre completo | `usuarios`, `negocios` | Identificar la cuenta |
| Correo electrónico | Supabase Auth, `usuarios` | Acceso, avisos del servicio |
| Contraseña | Supabase Auth (hash, nunca en claro) | Acceso |
| Nombre, tipo, RFC y contacto del negocio | `negocios`, config de sucursal | Prestar el servicio, facturar |
| Datos de suscripción y pagos | `suscripciones`, `pagos_suscripcion` | Cobro |

## 2 · De los COLABORADORES del negocio ⚠️

**Aquí está lo delicado.** Estas personas **no** contratan con ETAAX y muchas
nunca vieron un aviso. El responsable de sus datos es **el negocio**; ETAAX es
encargado.

| Dato | Dónde vive | Sensibilidad |
|---|---|---|
| Nombre, puesto, área | `staff` | Normal |
| **CURP** | `staff.datos.curp` | **Identificación oficial** |
| **NSS** (Seguro Social) | `staff.datos.nss` | **Identificación oficial** |
| Fecha de nacimiento | `staff.datos.fechaNacimiento` | Normal |
| Domicilio | `staff.datos.direccion` | Normal |
| Celular, correo | `staff.datos.celular/correo` | Normal |
| **CLABE interbancaria y banco** | `staff.datos.clabeNomina` | **Financiero** |
| **Salario, esquema, bonos, prima** | `staff.datos` | **Financiero** |
| Fotografía del colaborador | Storage `evidencias` | Normal |
| **Documentos: INE, contrato, comprobantes** | Storage `evidencias` | **Identificación oficial** |
| Usuario, contraseña y NIP de acceso | `staff` (hash) | Credenciales |
| Asistencias y horarios | `horarios` | Normal |
| Evaluaciones de desempeño | `evaluaciones`, `evaluacion_respuestas` | **Laboral** |
| Checklists firmados con su nombre | `checklist_runs`, `checklist_ejecuciones` | Normal |
| Pagos de nómina recibidos | `gf_nominas`, `gastos` | **Financiero** |
| Sanciones y su motivo | dentro del pago de nómina | **Laboral** |

## 3 · De los clientes del negocio

| Dato | Dónde vive |
|---|---|
| Nombre, teléfono, correo, notas | `clientes` |

## 4 · Del negocio (no personales, pero confidenciales)

Ventas, cortes de caja, gastos, proveedores, inventarios, recetas y escandallos,
metas, KPIs, cuentas bancarias (banco, alias y **últimos 4 dígitos**),
conciliaciones y folios de abonos, previsiones y apartados.

**No se guarda** el número completo de tarjeta ni CVV: los cobros pasan por
Stripe y ETAAX nunca ve esos datos.

---

## 5 · A dónde salen los datos (subencargados)

Declararlos es obligatorio. Salen de México.

| Proveedor | Qué recibe | Dónde |
|---|---|---|
| **Supabase** | TODO: base de datos, autenticación y archivos | Estados Unidos |
| **Netlify** | Sirve la app; registros de acceso | Estados Unidos |
| **Stripe** | Datos de pago de la suscripción del negocio | Estados Unidos |
| **Resend** | Correos del servicio (altas, recuperación) | Estados Unidos |
| **jsDelivr** | Entrega la librería de Supabase al navegador | CDN global |
| **Google Fonts** | Tipografías | CDN global |

Verificable en la CSP de `netlify.toml`: el navegador solo puede conectarse a
esos destinos. Si aparece uno nuevo ahí, va también en esta tabla.

---

## 6 · Cuánto se conserva

Mientras la cuenta esté activa. Al cancelar, la política vigente da **6 meses de
solo lectura** antes del borrado (ver `exportar-negocio-retencion`). Los datos
fiscales y de pago se conservan lo que exija la ley.

## 7 · Lo que ETAAX NO hace

- No vende ni renta datos.
- No hace publicidad con datos del negocio ni de sus colaboradores.
- No usa los datos de un negocio para otro.
- No hay analítica de terceros ni rastreadores en la app.

---

## 8 · Huecos conocidos (a cerrar)

1. **El bucket `evidencias` es público** — con la URL, cualquiera abre el archivo.
   Ahí viven INE y contratos. Pendiente pasarlo a privado con URLs firmadas.
2. La sesión de colaborador guarda credenciales en el navegador del dispositivo
   (`staff_cred`).
3. Varios colaboradores comparten una cuenta por negocio; falta cuenta propia por
   persona para poder rastrear quién hizo qué.
