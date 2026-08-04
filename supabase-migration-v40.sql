-- ════════════════════════════════════════════════════════════════
-- ETAAX · Migración v40 — Auto-confirmar las cuentas INTERNAS de colaboradores
-- Idempotente. Correr a mano en Supabase → SQL Editor.
--
-- POR QUÉ:
-- Al activar "Confirmar registro" (Auth → Correos electrónicos), Supabase deja
-- a TODO usuario nuevo sin confirmar hasta que abra el link que le llega por
-- correo. El problema es que staff-auth.js crea una cuenta interna por negocio
-- para los colaboradores:
--
--     staff.<negocioId>@etaax.app     (creada con signUp desde el navegador)
--
-- Ese buzón NO existe: nadie va a abrir ese correo nunca. Con la confirmación
-- activada, la cuenta nacería sin confirmar y el login de colaboradores fallaría
-- con "Email not confirmed" en CADA NEGOCIO NUEVO (los negocios que ya existen
-- siguen bien: nacieron cuando la confirmación estaba apagada).
--
-- QUÉ HACE:
-- Un trigger BEFORE INSERT sobre auth.users que marca como confirmadas ÚNICAMENTE
-- las cuentas de ese dominio interno. Los correos de clientes reales siguen
-- pidiendo confirmación, que es justo lo que se quiere.
--
-- SEGURIDAD: el dominio etaax.app es nuestro y no acepta registros públicos —
-- el signUp de esas cuentas solo lo dispara el ERP al aprovisionar un negocio, y
-- la contraseña es aleatoria y se guarda en negocios.staff_cred (protegida por
-- RLS). Aun así, el filtro es por patrón EXACTO: 'staff.%@etaax.app'.
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.autoconfirmar_cuenta_staff()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Solo las cuentas internas de colaboradores. OJO: se toca únicamente
    -- email_confirmed_at; confirmed_at es una columna GENERADA por Supabase y
    -- escribirla revienta el insert.
    IF NEW.email IS NOT NULL
       AND lower(NEW.email) LIKE 'staff.%@etaax.app'
       AND NEW.email_confirmed_at IS NULL THEN
        NEW.email_confirmed_at := now();
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_autoconfirm_staff ON auth.users;
CREATE TRIGGER on_auth_user_autoconfirm_staff
    BEFORE INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.autoconfirmar_cuenta_staff();

-- Red de seguridad: confirma las cuentas internas que ya existan sin confirmar
-- (por si alguna se creó con la confirmación ya activada, antes de esta migración).
UPDATE auth.users
   SET email_confirmed_at = COALESCE(email_confirmed_at, now())
 WHERE lower(email) LIKE 'staff.%@etaax.app'
   AND email_confirmed_at IS NULL;

-- Verificación rápida (debe devolver 0 filas):
--   SELECT email FROM auth.users
--    WHERE lower(email) LIKE 'staff.%@etaax.app' AND email_confirmed_at IS NULL;
