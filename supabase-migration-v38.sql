-- ════════════════════════════════════════════════════════════════
-- ETAAX · Migración v38 — QR de CHECK LIST operativo (cumplimiento por colaborador)
-- Idempotente. Correr a mano en Supabase → SQL Editor.
--
-- Un colaborador escanea el QR del negocio (mismo token que el QR de entradas),
-- pone su NIP de 5 dígitos, elige un checklist (plantilla) y marca sus tareas.
-- Cada ejecución queda registrada con SU nombre → historial de cumplimiento.
--
-- Modelo de seguridad idéntico al QR de entradas (v27): TODO pasa por funciones
-- SECURITY DEFINER que validan el token del negocio; el anon nunca toca tablas.
-- Reutiliza _entrada_token_ok() y entrada_validar_nip() de v27.
--
-- Tabla per-record (id/negocio_id/datos JSONB). datos =
--   { id, plantillaId, plantillaNombre, tipo, area, sucursalId,
--     colaborador (lo sella el servidor desde el NIP),
--     fecha, hora, marcas:{tareaId:'ok'|'no'|'pend'},
--     totalTareas, cumplidas, noRealizadas, pendientes, pct,
--     notas, foto_url, foto_urls, registrado, origen:'qr' }
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS checklist_ejecuciones (
    id         TEXT PRIMARY KEY,
    negocio_id TEXT NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    datos      JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_checklist_ejec_neg ON checklist_ejecuciones(negocio_id);
ALTER TABLE checklist_ejecuciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own" ON checklist_ejecuciones;
CREATE POLICY "own" ON checklist_ejecuciones FOR ALL
    USING  (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()));
DROP POLICY IF EXISTS "admin_all" ON checklist_ejecuciones;
CREATE POLICY "admin_all" ON checklist_ejecuciones FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

-- Realtime (sync en vivo del historial)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='checklist_ejecuciones')
        THEN ALTER PUBLICATION supabase_realtime ADD TABLE checklist_ejecuciones; END IF;
END $$;

-- ANON (con token válido): plantillas del negocio para elegir en el QR.
CREATE OR REPLACE FUNCTION checklist_plantillas(p_neg TEXT, p_token TEXT)
RETURNS SETOF JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT c.datos
    FROM checklists c
    WHERE c.negocio_id = p_neg AND _entrada_token_ok(p_neg, p_token);
$$;

-- ANON: registra la ejecución (valida token + NIP; sella `colaborador` en el servidor).
CREATE OR REPLACE FUNCTION checklist_registrar(p_neg TEXT, p_token TEXT, p_niphash TEXT, p_datos JSONB)
RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_nombre TEXT; v_id TEXT;
BEGIN
    v_nombre := entrada_validar_nip(p_neg, p_token, p_niphash);
    IF v_nombre IS NULL THEN
        RAISE EXCEPTION 'no autorizado';
    END IF;
    v_id := COALESCE(NULLIF(p_datos->>'id', ''), replace(gen_random_uuid()::text, '-', ''));
    INSERT INTO checklist_ejecuciones (id, negocio_id, datos)
    VALUES (v_id, p_neg, p_datos || jsonb_build_object('colaborador', v_nombre, 'origen', 'qr'));
    RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION checklist_plantillas(TEXT, TEXT)             TO anon, authenticated;
GRANT EXECUTE ON FUNCTION checklist_registrar(TEXT, TEXT, TEXT, JSONB) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- Fin v38. El QR apunta a /checklist.html?n=<negocio>&t=<entrada_token>&s=<sucursal>.
-- checklist.html usa SOLO estas RPC + entrada_validar_nip (no inicia sesión).
-- ════════════════════════════════════════════════════════════════
