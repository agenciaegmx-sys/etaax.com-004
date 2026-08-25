-- ════════════════════════════════════════════════════════════════
-- ETAAX · Migración v45 — Guías de uso (módulo Aprende y Analiza)
--
-- Las guías son de LA PLATAFORMA, no de cada negocio. Edwin sube el
-- PDF una vez y lo ven todos los clientes. Por eso esta tabla NO
-- lleva `negocio_id` — es la primera del sistema que no lo hace, y
-- es a propósito: ponerle negocio obligaría a subir el mismo archivo
-- una vez por cliente y a mantener siete copias del mismo tutorial.
--
-- Lectura: cualquiera con sesión (incluidos los colaboradores — un
-- barman necesita el manual tanto como el dueño).
-- Escritura: SOLO el admin de plataforma.
--
-- Idempotente: se puede correr varias veces sin romper nada.
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS guias (
    id          TEXT PRIMARY KEY,
    titulo      TEXT NOT NULL,
    descripcion TEXT,
    categoria   TEXT,                       -- agrupa las tarjetas: "Primeros pasos", "Inventarios"…
    tipo        TEXT NOT NULL DEFAULT 'pdf',-- pdf | video
    url         TEXT NOT NULL,              -- URL pública del PDF en Storage, o link de YouTube
    modulo      TEXT,                       -- de qué módulo habla (recetas, administrativo…), opcional
    orden       INT  DEFAULT 0,             -- para acomodarlas a mano; empate se rompe por fecha
    activa      BOOLEAN DEFAULT true,       -- borrador o retirada sin perder el registro
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE guias DROP CONSTRAINT IF EXISTS guias_tipo_chk;
ALTER TABLE guias ADD  CONSTRAINT guias_tipo_chk CHECK (tipo IN ('pdf','video','link'));

CREATE INDEX IF NOT EXISTS guias_orden_idx ON guias (categoria, orden, created_at);

ALTER TABLE guias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lectura_todos" ON guias;
DROP POLICY IF EXISTS "admin_all"     ON guias;

-- Cualquier usuario con sesión puede LEER las guías activas. No hay dato sensible
-- aquí: son manuales de uso del producto.
CREATE POLICY "lectura_todos" ON guias
    FOR SELECT TO authenticated USING (activa);

-- Solo el admin de plataforma las crea, edita o borra.
CREATE POLICY "admin_all" ON guias
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

-- ── Secciones del catálogo ───────────────────────────────────────
-- Una sección tiene que poder existir ANTES de tener guías: así se arma el
-- índice del manual primero y se va llenando después. Si las secciones solo
-- salieran de las guías ya publicadas, no habría forma de crear una vacía y
-- reservarla. Al cliente NO se le muestran vacías — eso lo decide la vista.
CREATE TABLE IF NOT EXISTS guia_secciones (
    nombre     TEXT PRIMARY KEY,
    orden      INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE guia_secciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lectura_todos" ON guia_secciones;
DROP POLICY IF EXISTS "admin_all"     ON guia_secciones;

CREATE POLICY "lectura_todos" ON guia_secciones
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_all" ON guia_secciones
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

-- Semilla: si ya había guías con categoría, sus secciones se dan de alta solas.
INSERT INTO guia_secciones (nombre)
SELECT DISTINCT categoria FROM guias WHERE categoria IS NOT NULL AND categoria <> ''
ON CONFLICT (nombre) DO NOTHING;

-- ── Storage: los PDF viven en el bucket `evidencias`, bajo `_guias/` ─────
-- Se reusa el bucket que ya existe en vez de crear uno nuevo: mismo backup,
-- mismas cuotas, una cosa menos que administrar. El prefijo `_guias/` los separa
-- de las evidencias de los negocios (que van bajo su propio id).
-- El guion bajo del prefijo evita que choque con el id de un negocio real.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='storage' AND tablename='objects') THEN
        DROP POLICY IF EXISTS "guias_lectura"  ON storage.objects;
        DROP POLICY IF EXISTS "guias_escritura" ON storage.objects;

        -- Leer un PDF de guía: cualquiera con sesión.
        CREATE POLICY "guias_lectura" ON storage.objects
            FOR SELECT TO authenticated
            USING (bucket_id = 'evidencias' AND name LIKE '\_guias/%');

        -- Subirlas/borrarlas: solo el admin de plataforma.
        CREATE POLICY "guias_escritura" ON storage.objects
            FOR ALL TO authenticated
            USING (bucket_id = 'evidencias' AND name LIKE '\_guias/%' AND is_platform_admin())
            WITH CHECK (bucket_id = 'evidencias' AND name LIKE '\_guias/%' AND is_platform_admin());
    END IF;
END $$;

-- ── Comprobación tras correrla ───────────────────────────────────
-- SELECT id, titulo, categoria, tipo, orden, activa FROM guias ORDER BY categoria, orden;
-- SELECT * FROM guia_secciones ORDER BY orden, nombre;
