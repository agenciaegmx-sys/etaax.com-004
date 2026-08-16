-- ============================================================================
-- ETAAX · Migración v42 — CONTEO DE EXISTENCIAS DESDE EL QR
--
-- Barra cuenta sus botellas la noche anterior desde el celular (QR de entradas,
-- sin sesión) y al abrir el inventario esos conteos aparecen para aplicarse.
--
-- POR QUÉ UNA TABLA APARTE Y NO ESCRIBIR EN `inventarios`:
--   el celular no tiene sesión. Dejarlo escribir directo en el inventario
--   significaría abrirle esa tabla a `anon`, y un inventario cerrado es un
--   documento contable. El conteo aterriza en su propia tabla, marcado con quién
--   lo capturó, y quien abre el inventario decide si lo aplica.
--
-- Idempotente: se puede correr varias veces sin romper nada.
-- Correr a mano en Supabase → SQL Editor.
-- ============================================================================

-- 1) Tabla de conteos capturados desde el QR ---------------------------------
CREATE TABLE IF NOT EXISTS inventario_conteos (
    id         TEXT PRIMARY KEY,
    negocio_id TEXT NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    datos      JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inv_conteos_neg ON inventario_conteos(negocio_id);
-- Consulta típica: "conteos pendientes de esta sucursal y área"
CREATE INDEX IF NOT EXISTS idx_inv_conteos_suc ON inventario_conteos(negocio_id, (datos->>'sucursalId'), (datos->>'area'));

ALTER TABLE inventario_conteos ENABLE ROW LEVEL SECURITY;

-- Solo el dueño del negocio (y el admin de plataforma) leen/editan sus conteos.
DROP POLICY IF EXISTS "own" ON inventario_conteos;
CREATE POLICY "own" ON inventario_conteos FOR ALL
    USING  (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()));

DROP POLICY IF EXISTS "admin_all" ON inventario_conteos;
CREATE POLICY "admin_all" ON inventario_conteos FOR ALL
    USING (is_platform_admin()) WITH CHECK (is_platform_admin());

-- 2) RPC: registrar un conteo desde el QR ------------------------------------
--    Valida el NIP con la MISMA función que las entradas (entrada_validar_nip),
--    así el colaborador usa el NIP que ya tiene y no hay un segundo padrón.
--    SECURITY DEFINER: escribe pese al RLS, pero solo por esta puerta.
CREATE OR REPLACE FUNCTION inventario_conteo_registrar(
    p_neg TEXT, p_token TEXT, p_niphash TEXT, p_datos JSONB
)
RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_nombre TEXT; v_id TEXT;
BEGIN
    v_nombre := entrada_validar_nip(p_neg, p_token, p_niphash);
    IF v_nombre IS NULL THEN
        RAISE EXCEPTION 'no autorizado';
    END IF;

    -- id estable por insumo + sucursal + área + fecha: si el colaborador corrige
    -- su conteo, SOBREESCRIBE el suyo en vez de dejar dos verdades.
    v_id := COALESCE(NULLIF(p_datos->>'id', ''), replace(gen_random_uuid()::text, '-', ''));

    INSERT INTO inventario_conteos (id, negocio_id, datos)
    VALUES (v_id, p_neg, p_datos || jsonb_build_object(
                'contadoPor', v_nombre,
                'origen',     'qr',
                'registrado', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
    ON CONFLICT (id) DO UPDATE
        SET datos = EXCLUDED.datos;

    RETURN v_id;
END;
$$;

-- 3) RPC: qué insumos puede contar (nombre, unidad y cómo se cuenta) ---------
--    Reusa entrada_insumos, que ya devuelve el catálogo del negocio validando
--    el token. No se duplica esa lógica aquí.

-- 4) Permisos -----------------------------------------------------------------
GRANT EXECUTE ON FUNCTION inventario_conteo_registrar(TEXT, TEXT, TEXT, JSONB) TO anon, authenticated;

-- ============================================================================
-- Fin v42.
-- El celular llama inventario_conteo_registrar(); la app (con sesión) lee
-- inventario_conteos por RLS y, al aplicar un conteo, lo marca como aplicado.
-- Los conteos NO tocan `inventarios`: eso lo hace la app cuando el encargado
-- acepta, y queda registrado quién contó y quién aplicó.
-- ============================================================================
