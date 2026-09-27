-- ═══════════════════════════════════════════════════════════════════════════
-- ETAAX · Migración v60 — La columna que nunca llegó: permisos.updated_at
-- Corre esto en: Supabase → SQL Editor. Seguro de re-ejecutar.
--
-- QUÉ PASÓ, porque vale la pena entenderlo:
--
-- La tabla `permisos` la creó la v2, SIN columna updated_at. La v11 la volvió a
-- declarar CON esa columna… pero usando `CREATE TABLE IF NOT EXISTS`. Como la
-- tabla YA EXISTÍA, ese bloque no hizo absolutamente nada: la columna nunca se
-- agregó, y nadie se enteró porque la migración corrió "sin errores".
--
-- Desde entonces, CADA vez que se guardaba un permiso el cliente mandaba
-- `updated_at` y PostgREST rechazaba la escritura completa:
--     Could not find the 'updated_at' column of 'permisos' in the schema cache
-- O sea: los permisos NUNCA llegaron a la nube. Vivían solo en el navegador de
-- quien los tocó. Eso es exactamente lo que se veía como "los permisos se
-- activan y desactivan de manera local" y "el cambio de mi tablet no aparece
-- en la compu".
--
-- LA LECCIÓN: `CREATE TABLE IF NOT EXISTS` NO actualiza una tabla existente.
-- Para agregar una columna a algo que ya está, va `ALTER TABLE ... ADD COLUMN
-- IF NOT EXISTS`, que es lo que hace esta migración.
--
-- `staff` arrastra el mismo hueco (la v10 la re-declaró igual). Ahí no rompió
-- nada porque su guardado nunca mandó updated_at — pero se le agrega también,
-- para que la próxima vez que alguien lo mande no se repita la historia.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE permisos ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE staff    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Comprobación: debe devolver las dos filas, una por tabla.
SELECT table_name, column_name
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name IN ('permisos', 'staff')
   AND column_name = 'updated_at'
 ORDER BY table_name;

-- ============================================================================
-- Fin v60.
