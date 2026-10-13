# Supervisión del lote 11: freno de NIP

**Código revisado:** `7330663`. **v78:** aplicada en Supabase según Edwin. No hice llamadas a producción ni modifiqué código de la aplicación.

**Verificación local:** 4190 comprobaciones de dinero y 84 del almacén, sin fallas. El arnés original de v78 pasa. También pasa la reproducción del cierre con el SDK real y la red retenida. Las pruebas adicionales siguientes encuentran fallos que impiden cerrar el freno de NIP.

## 1. Tres puertas permiten probar NIP sin acumular fallos

Probé las definiciones reales de `entrada_registrar` (v27), `checklist_registrar` (v38) e `inventario_conteo_registrar` (v76), con v78 instalada en PGlite. Cada caso empieza con el contador vacío.

| Función | NIP incorrectos distintos | Rechazos | Bloqueos `nip_espera` | Contador al terminar |
|---|---:|---:|---:|---|
| `entrada_registrar` | 30 | 30 | 0 | vacío |
| `checklist_registrar` | 30 | 30 | 0 | vacío |
| `inventario_conteo_registrar` | 30 | 30 | 0 | vacío |

Las tres siguen aceptando su operación legítima con el NIP correcto.

**Causa:** el guardia escribe el fallo y devuelve falso. La función de escritura recibe NULL y ejecuta `RAISE EXCEPTION 'no autorizado'`. La excepción revierte toda la operación, incluida la actualización del contador. El NIP incorrecto no consigue guardar datos, pero su intento desaparece y puede seguir adivinando por esa misma puerta.

**Hueco del arnés actual:** `tests/probar-sql-v78.mjs:181` prueba las llamadas alternativas cuando el contador ya quedó bloqueado por `entrada_validar_nip`. Eso demuestra que obedecen un bloqueo existente; no demuestra que acumulen sus propios intentos fallidos.

**Corrección requerida:** mantener el rechazo de las tres operaciones y conseguir que sus fallos persistan. Añadir una prueba desde contador vacío para cada una, usando su definición real. Si cambia la respuesta de rechazo, comprobar que ningún cliente la interprete como un registro guardado.

## 2. La espera de una hora desaparece al pasar 15 minutos

`supabase-migration-v78.sql:133` solo revisa la espera si el último fallo ocurrió hace menos de 15 minutos. El mismo plazo reinicia el contador en el UPSERT.

Sembré 24 fallos con el último hace 16 minutos: la siguiente llamada fue admitida para intentar el NIP y dejó el contador en 1, aunque `_nip_espera(24)` promete 60 minutos. Debía seguir bloqueada unos 44 minutos más.

**Corrección requerida:** separar la duración del bloqueo del plazo que olvida los fallos. Probar los cuatro escalones y sus límites de tiempo; conservar la recuperación legítima al vencer la espera.

## 3. Aviso de espera al guardar un lote

En `entrada.html:1259` se convierte `nip_espera` a texto amigable, pero luego se descarta el mensaje. La pantalla termina mostrando únicamente «0 guardados · 1 fallaron (quedan en la lista, reintenta)».

Ejecuté `_registrarBatch` con el error simulado `nip_espera:60`: la captura permanece en la lista, pero nunca se muestra cuánto esperar. Conservar esa captura y mostrar también la explicación del bloqueo.

## Comprobaciones en pantalla

- El aviso aparece en la llamada **13**, después de 12 fallos; el intento 12 todavía devuelve rechazo normal.
- Dos aparatos en el mismo Wi-Fi pueden compartir contador. Alcanzado el límite, el guardia rechaza también el NIP correcto hasta vencer la espera: la prueba propuesta de que el otro aparato nunca se frena no corresponde al diseño actual.
- Validar el recorrido normal en producción; hacer los intentos deliberados en el arnés o con un negocio de prueba y sin operación en curso.

**Siguiente entrega:** corrección posterior a v78, pruebas ampliadas y reporte actualizado. R03 continúa abierto. Después de verificar este bloque, seguir con el Resumen financiero.

**Artefactos locales de esta supervisión:** `/private/tmp/etaax-v78-supervision.mjs`, `/private/tmp/etaax-v78-supervision-evidencia.json` y `/private/tmp/etaax-v78-supervision.log`. Se ejecuta con `PGLITE_DIR=/private/tmp/etaax-v77-audit node /private/tmp/etaax-v78-supervision.mjs` mientras esa dependencia local esté disponible.
