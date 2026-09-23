/**
 * 2026-09-23 — Resumen semanal de alertas para el cliente.
 *
 * Un correo por semana a cada usuario suscrito, con las alertas que siguen
 * abiertas en SUS sitios. No reemplaza a nada: el aviso inmediato por
 * incidencia sigue igual, y el resumen interno de Emeltec (health_digest_*)
 * también. Este es un recap para el cliente.
 *
 * Tres piezas:
 *
 *  1. `usuario.recibe_resumen_semanal` — la suscripción, APAGADA por defecto.
 *     Se prende usuario por usuario desde la pantalla de usuarios. Con el
 *     default en true el correo le llegaría la primera semana a gente que no
 *     lo pidió, que con clientes se paga caro.
 *  2. `weekly_digest_config` — fila única con el día y la hora de envío.
 *  3. `weekly_digest_envios` — el candado del slot. La PK evita el envío doble
 *     y es la base de la ventana de rescate: un slot que no salió a su hora
 *     sale en el ciclo siguiente en vez de perderse. Es la misma lección que
 *     dejó `health_digest_envios` (un `Set` en memoria más `minute === 0`
 *     perdía el correo en silencio).
 *
 * Idempotente y no-op sobre una base que ya la tiene.
 */
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST || process.env.DB_HOST || 'timescaledb',
  port: Number(process.env.PGPORT || process.env.DB_PORT || 5432),
  database: process.env.PGDATABASE || process.env.DB_NAME || 'postgres',
  user: process.env.PGUSER || process.env.DB_USER || 'postgres',
  password: process.env.PGPASSWORD || process.env.DB_PASSWORD || '',
});

const SQL = `
-- 1. Suscripción por usuario. Apagada por defecto, a propósito.
ALTER TABLE usuario
  ADD COLUMN IF NOT EXISTS recibe_resumen_semanal BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN usuario.recibe_resumen_semanal IS
  'Suscripción al resumen semanal de alertas abiertas. Apagada por defecto: se '
  'prende usuario por usuario desde la pantalla de usuarios.';

-- 2. Programación. Fila única: el día y la hora son globales, no por cliente.
CREATE TABLE IF NOT EXISTS weekly_digest_config (
  id              BOOLEAN     PRIMARY KEY DEFAULT TRUE CHECK (id),
  -- Día ISO: 1 = lunes … 7 = domingo.
  dia_semana      INTEGER     NOT NULL DEFAULT 5 CHECK (dia_semana BETWEEN 1 AND 7),
  -- Hora de PARED de Chile (America/Santiago, con horario de verano).
  hora            INTEGER     NOT NULL DEFAULT 7 CHECK (hora BETWEEN 0 AND 23),
  activo          BOOLEAN     NOT NULL DEFAULT TRUE,
  actualizado_por VARCHAR(10),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CREATE TABLE IF NOT EXISTS no agrega columnas a una tabla que ya existe.
ALTER TABLE weekly_digest_config
  ADD COLUMN IF NOT EXISTS dia_semana INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS hora       INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS activo     BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON TABLE weekly_digest_config IS
  'Fila única con el día y la hora del resumen semanal de alertas del cliente. '
  'Viernes 07:00 por defecto: lo que sigue abierto se revisa antes de cerrar '
  'la semana, con la jornada del viernes todavía por delante para actuar.';

INSERT INTO weekly_digest_config (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

-- 3. Bitácora y candado de slots.
CREATE TABLE IF NOT EXISTS weekly_digest_envios (
  slot_ts       TIMESTAMPTZ PRIMARY KEY,
  enviado_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  destinatarios INTEGER     NOT NULL DEFAULT 0,
  alertas       INTEGER     NOT NULL DEFAULT 0
);

ALTER TABLE weekly_digest_envios
  ADD COLUMN IF NOT EXISTS destinatarios INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS alertas       INTEGER NOT NULL DEFAULT 0;

COMMENT ON TABLE weekly_digest_envios IS
  'Un registro por resumen semanal ya enviado. La PK es el candado contra el '
  'envío duplicado y la base de la ventana de rescate.';
`;

async function migrate() {
  try {
    console.log('[migration 015] resumen semanal de alertas...');
    await pool.query(SQL);
    console.log('[migration 015] OK');
    process.exit(0);
  } catch (err) {
    console.error('[migration 015] ERROR:', err);
    process.exit(1);
  }
}

migrate();
