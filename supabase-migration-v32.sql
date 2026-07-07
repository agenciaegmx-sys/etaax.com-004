-- ============================================================================
-- ETAAX — Migración v32: REALTIME completo + recetas para el QR (mermas)
-- ----------------------------------------------------------------------------
-- 1) Agrega a la publicación supabase_realtime TODAS las tablas de negocio que
--    faltaban (auditoría 2026-07-06). Ya estaban: recetas, negocio_sucursales,
--    negocio_insumos, cortes, gastos, inventarios (v16/v17), perfiles_puesto,
--    organigrama (v25), evaluaciones, evaluacion_respuestas (v29).
--    Las que se suman ahora y POR QUÉ:
--      · entradas_log         → el QR de entradas/mermas aparece SOLO en el
--                               sistema (antes había que refrescar la página).
--      · capturas_pendientes  → el QR de fotos de evidencias (bandeja de cortes),
--                               mismo síntoma de refresh manual.
--      · depositos, ventas_extra, ventas_productos → módulo de ventas/caja
--                               fuerte entre dispositivos.
--      · staff, permisos      → cambios de colaboradores/permisos al instante.
--      · clientes, proveedores, gastos_cats_custom → catálogos administrativos.
--      · tarjetas_credito     → cuentas bancarias.
--      · gf_fijos, gf_nominas, gf_nomina_params, sf_metas, sf_otros,
--        kpi_targets, previsiones → módulo financiero.
--      · req_pedido, req_historial → requisiciones entre dispositivos.
--      · suscripciones, negocios → gestión de plataforma / nombre del negocio.
--    (RLS aplica igual en realtime: cada quien solo recibe eventos de lo suyo.)
--    Quedan fuera a propósito: papelera (solo admin, se abre bajo demanda),
--    login_intentos y pairing_sesiones (internas/efímeras), catalogo_* (solo
--    las edita el admin maestro en su propia página).
--
-- 2) RPC entrada_recetas(p_neg, p_token): lista LIGERA de recetas activas del
--    negocio para registrar MERMAS de producto del menú desde el QR (anónimo,
--    validado por token — mismo modelo que entrada_insumos de v27).
--
-- Idempotente: re-ejecutable sin error. Correr en: Supabase → SQL Editor.
-- ============================================================================

-- ── 1) Publicación realtime ──────────────────────────────────────────────────
DO $$
DECLARE
    t TEXT;
    tablas TEXT[] := ARRAY[
        'entradas_log', 'capturas_pendientes',
        'depositos', 'ventas_extra', 'ventas_productos',
        'staff', 'permisos',
        'clientes', 'proveedores', 'gastos_cats_custom',
        'tarjetas_credito',
        'gf_fijos', 'gf_nominas', 'gf_nomina_params',
        'sf_metas', 'sf_otros', 'kpi_targets', 'previsiones',
        'req_pedido', 'req_historial',
        'suscripciones', 'negocios'
    ];
BEGIN
    FOREACH t IN ARRAY tablas LOOP
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t)
           AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t)
        THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
        END IF;
    END LOOP;
END $$;

-- ── 2) ANON: recetas activas del negocio para MERMAS desde el QR ─────────────
-- Devuelve solo lo necesario para el buscador (id, nombre, tipo, grupo) — NO la
-- receta completa (ni ingredientes ni costos). Requiere el token del negocio.
CREATE OR REPLACE FUNCTION entrada_recetas(p_neg TEXT, p_token TEXT)
RETURNS SETOF JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT jsonb_build_object(
        'id',     r.id,
        'nombre', r.datos->>'nombre',
        'tipo',   r.datos->>'tipo',
        'grupo',  r.datos->>'grupo'
    )
    FROM recetas r
    WHERE r.negocio_id = p_neg
      AND COALESCE(r.datos->>'status', 'activa') <> 'inactiva'
      AND _entrada_token_ok(p_neg, p_token);
$$;
REVOKE ALL ON FUNCTION entrada_recetas(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION entrada_recetas(TEXT, TEXT) TO anon, authenticated;

-- ============================================================================
-- Fin v32. Después de correrla:
--   · Todas las tablas de negocio emiten eventos realtime (las páginas que ya
--     escuchan se actualizan solas; las nuevas suscripciones llegan por código).
--   · El QR puede listar recetas del menú para registrar mermas de producto.
-- ============================================================================
