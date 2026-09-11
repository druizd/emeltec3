-- 2026-08-20 — Las alertas de seguridad eligen destinatario.
--
-- Hasta ahora `auditAlerts` (cambios de rol, logins fallidos) mandaba a
-- `WHERE tipo = 'SuperAdmin'`, hardcodeado. Con 14 SuperAdmin activos, cada
-- alerta salía 14 veces y no había forma de decidir a quién le llega sin
-- cambiarle el rol a alguien. Esta columna las trae a la misma pantalla que ya
-- administra el monitoreo: /administration → "Alertas por correo".
--
-- Casilla PROPIA y no reutilizar `recibe_eventos` a propósito: las audiencias
-- son distintas. El resumen de sitios caídos es operación; un cambio de rol o
-- una ráfaga de logins fallidos es seguridad (Ley 21.719). Poder darle lo
-- primero a un operador sin darle lo segundo es justo el punto.
--
-- SIN FALLBACK, por decisión explícita: lista vacía = no se manda nada. A
-- diferencia de `recibe_resumen`, que cae a MONITOR_PRIMARY_EMAIL, acá nadie
-- suscrito significa silencio. La contraparte vive en la UI, que avisa en
-- amarillo cuando la lista queda vacía — el silencio es visible, no accidental.
--
-- DOWN-MIGRATION:
--   ALTER TABLE health_digest_destinatario DROP COLUMN recibe_seguridad;
--   (requiere revertir también el código: sin la columna, auditAlerts falla).

BEGIN;

-- El bloque envuelve el ALTER y la semilla juntos para que la semilla corra
-- EXACTAMENTE una vez: en la aplicación que crea la columna. El deploy corre
-- todas las migraciones en cada push, y un `UPDATE ... SET recibe_seguridad =
-- TRUE` suelto le desharía la configuración al usuario en el siguiente push.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name  = 'health_digest_destinatario'
           AND column_name = 'recibe_seguridad'
    ) THEN
        ALTER TABLE health_digest_destinatario
            ADD COLUMN recibe_seguridad BOOLEAN NOT NULL DEFAULT FALSE;

        -- Semilla: quien ya está en la lista y activo hereda las alertas de
        -- seguridad. Sin esto el deploy dejaría la plataforma sin avisar
        -- cambios de rol a nadie hasta que alguien entre a configurarlo, y una
        -- ventana de cero cobertura no se nota justo cuando importa.
        --
        -- Es igual una reducción fuerte frente al comportamiento anterior: de
        -- los 14 SuperAdmin a los destinatarios ya curados de esta tabla.
        UPDATE health_digest_destinatario
           SET recibe_seguridad = TRUE
         WHERE activo = TRUE;
    END IF;
END $$;

COMMENT ON COLUMN health_digest_destinatario.recibe_seguridad IS
    'Recibe las alertas de auditoría de seguridad (cambios de rol, logins fallidos). '
    'Independiente de recibe_resumen y recibe_eventos. Sin nadie suscrito no se envía '
    'nada: esta alerta no tiene buzón de respaldo.';

-- El worker de auditoría filtra por (activo, recibe_seguridad) en cada ciclo.
CREATE INDEX IF NOT EXISTS idx_health_digest_dest_seguridad
    ON health_digest_destinatario (email)
    WHERE activo = TRUE AND recibe_seguridad = TRUE;

COMMIT;
