-- 2026-09-16 — El resumen interno se programa desde la plataforma.
--
-- Los horarios (06:00/15:00) y el umbral de horas vivían en constantes y
-- variables de entorno: cambiarlos exigía editar el `.env` de la VM y recrear
-- el container. Ahora se administran en /administration → "Alertas por correo",
-- que es donde ya se administran los destinatarios.
--
-- `health_digest_envios` es el candado de idempotencia del slot, igual que
-- `alertas_digest_envios` lo era para el consolidado de alertas. Hasta ahora el
-- control era un Set en memoria Y la condición `minute === 0`: si ningún ciclo
-- caía en el minuto 0 exacto —el `setInterval` de 60 s deriva con el trabajo de
-- cada ciclo— el slot se perdía en silencio, sin ventana de rescate. Esa es la
-- causa de "se guarda la configuración y no llega ningún correo".
--
-- Idempotente y no-op en una base vacía.

BEGIN;

CREATE TABLE IF NOT EXISTS health_digest_config (
    -- Fila única: la config es global, no por destinatario.
    id              BOOLEAN      PRIMARY KEY DEFAULT TRUE CHECK (id),
    -- Horas de envío en hora de PARED de Chile (con horario de verano).
    horas           INTEGER[]    NOT NULL DEFAULT '{7,16}',
    -- Horas sin transmitir para que un equipo entre en el resumen.
    umbral_horas    NUMERIC(5,2) NOT NULL DEFAULT 6,
    actualizado_por VARCHAR(10),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- CREATE TABLE IF NOT EXISTS no agrega columnas a una tabla que ya existe.
ALTER TABLE health_digest_config
    ADD COLUMN IF NOT EXISTS horas        INTEGER[]    NOT NULL DEFAULT '{7,16}',
    ADD COLUMN IF NOT EXISTS umbral_horas NUMERIC(5,2) NOT NULL DEFAULT 6;

COMMENT ON TABLE health_digest_config IS
    'Fila única con la programación del resumen interno de monitoreo: a qué '
    'horas sale y desde cuántas horas sin transmitir se informa un equipo. '
    'Se edita en /administration → Alertas por correo.';
COMMENT ON COLUMN health_digest_config.horas IS
    'Horas de envío en hora de pared de Chile (America/Santiago, con horario de '
    'verano). 7 y 16 preservan la intención original: el correo en la bandeja '
    'antes de que llegue el cliente y otro a media tarde.';

INSERT INTO health_digest_config (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

-- Bitácora de slots enviados. La PK es el candado contra el envío doble; la
-- ventana de rescate del worker mira esta tabla, no memoria del proceso.
CREATE TABLE IF NOT EXISTS health_digest_envios (
    slot_ts       TIMESTAMPTZ PRIMARY KEY,
    enviado_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    equipos       INTEGER     NOT NULL DEFAULT 0,
    dga           INTEGER     NOT NULL DEFAULT 0,
    destinatarios INTEGER     NOT NULL DEFAULT 0
);

ALTER TABLE health_digest_envios
    ADD COLUMN IF NOT EXISTS equipos       INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS dga           INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS destinatarios INTEGER NOT NULL DEFAULT 0;

COMMENT ON TABLE health_digest_envios IS
    'Un registro por resumen interno ya enviado. La PK es el candado contra el '
    'envío duplicado y la base de la ventana de rescate: un slot que no se pudo '
    'mandar a su hora sale en el ciclo siguiente, en vez de perderse.';

-- Las escalaciones inmediatas (3h/6h/12h) se retiraron el 16-09-2026: el
-- resumen de dos veces al día las reemplaza. Las columnas quedan por si se
-- quieren reactivar, pero el worker ya no las lee.
COMMENT ON COLUMN health_digest_destinatario.recibe_eventos IS
    'SIN USO desde el 16-09-2026 (se retiraron las escalaciones inmediatas). '
    'Se conserva la columna para no perder la preferencia guardada.';
COMMENT ON COLUMN health_digest_destinatario.umbral_evento IS
    'SIN USO desde el 16-09-2026, junto con recibe_eventos.';

COMMIT;
