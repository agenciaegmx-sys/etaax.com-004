-- ═══════════════════════════════════════════════════════════════
-- ETAAX · Migración v10 — Tabla staff + candados server-side de plan
-- Corre esto en: Supabase → SQL Editor
-- Seguro de re-ejecutar (IF NOT EXISTS / OR REPLACE / DROP IF EXISTS)
-- ═══════════════════════════════════════════════════════════════

/* ──────────────────────────────────────────────────────────
   1. STAFF — la tabla que administrativo/staff.html ya usa
      (v2 la borró y ninguna migración la recreó: los sync
      de colaboradores fallaban en silencio)
   ────────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS staff (
    id         TEXT PRIMARY KEY,
    negocio_id TEXT NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    datos      JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_staff_neg ON staff(negocio_id);
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own" ON staff;
CREATE POLICY "own" ON staff
    FOR ALL
    USING  (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()));

DROP POLICY IF EXISTS "admin_all" ON staff;
CREATE POLICY "admin_all" ON staff
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

/* ──────────────────────────────────────────────────────────
   2. USUARIOS — fila automática al registrarse + backfill
      (la tabla existía desde v2 pero nada la poblaba; el plan
      vivía solo en user_metadata, que el cliente puede editar)
   ────────────────────────────────────────────────────────── */
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO usuarios (id, nombre, plan)
    VALUES (NEW.id,
            NEW.raw_user_meta_data ->> 'nombre',
            COALESCE(NEW.raw_user_meta_data ->> 'plan', 'pyme'))
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Backfill: usuarios ya registrados
INSERT INTO usuarios (id, nombre, plan)
SELECT id,
       raw_user_meta_data ->> 'nombre',
       COALESCE(raw_user_meta_data ->> 'plan', 'pyme')
FROM auth.users
ON CONFLICT (id) DO NOTHING;

/* ──────────────────────────────────────────────────────────
   3. USUARIOS — políticas: el usuario lee y edita su fila,
      pero NO puede insertar/borrar (eso lo hace el trigger)
      y el admin gestiona todo (incluido el plan)
   ────────────────────────────────────────────────────────── */
DROP POLICY IF EXISTS "own" ON usuarios;
DROP POLICY IF EXISTS "own_select" ON usuarios;
CREATE POLICY "own_select" ON usuarios
    FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "own_update" ON usuarios;
CREATE POLICY "own_update" ON usuarios
    FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "admin_all" ON usuarios;
CREATE POLICY "admin_all" ON usuarios
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

/* ──────────────────────────────────────────────────────────
   4. Candado: solo el admin puede cambiar el plan
   ────────────────────────────────────────────────────────── */
CREATE OR REPLACE FUNCTION proteger_plan()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NEW.plan IS DISTINCT FROM OLD.plan AND NOT is_platform_admin() THEN
        RAISE EXCEPTION 'Solo el administrador de la plataforma puede cambiar el plan';
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_proteger_plan ON usuarios;
CREATE TRIGGER trg_proteger_plan
    BEFORE UPDATE ON usuarios
    FOR EACH ROW EXECUTE FUNCTION proteger_plan();

/* ──────────────────────────────────────────────────────────
   5. Candado: límite de sucursales (negocios) según plan
      pyme = 3 · gran = 10 · cualquier otro = 3
   ────────────────────────────────────────────────────────── */
CREATE OR REPLACE FUNCTION validar_limite_negocios()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_plan   text;
    v_limite int;
    v_actual int;
BEGIN
    IF is_platform_admin() THEN RETURN NEW; END IF;
    SELECT plan INTO v_plan FROM usuarios WHERE id = NEW.usuario_id;
    v_limite := CASE COALESCE(v_plan, 'pyme')
                    WHEN 'gran' THEN 10
                    WHEN 'pyme' THEN 3
                    ELSE 3
                END;
    SELECT COUNT(*) INTO v_actual FROM negocios WHERE usuario_id = NEW.usuario_id;
    IF v_actual >= v_limite THEN
        RAISE EXCEPTION 'Límite de sucursales del plan alcanzado (máximo %)', v_limite;
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_limite_negocios ON negocios;
CREATE TRIGGER trg_limite_negocios
    BEFORE INSERT ON negocios
    FOR EACH ROW EXECUTE FUNCTION validar_limite_negocios();
