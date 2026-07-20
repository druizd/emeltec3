/**
 * 2026-07-20 — Migra los contactos de la ficha (JSONB) a contacto_operativo.
 *
 * Los contactos de acceso a planta vivían denormalizados en
 * pozo_config.ficha_critica.contactos[]. Pasan a ser filas de
 * contacto_operativo (id estable, scoping por sitio, vínculo a usuario), que
 * es la fuente única de esa PII. La ficha los lee por sitio_id.
 *
 * - empresa_id / sub_empresa_id se derivan del sitio (ambos NOT NULL en sitio).
 * - rol → cargo + tipo_contacto (Responsable se preserva; el resto → Operacion).
 * - Se SALTAN los contactos sin email ni teléfono (CHECK de contacto_operativo
 *   exige al menos uno). Quedan reportados en el NOTICE de conteo.
 * - Tras migrar, se vacía ficha_critica.contactos → idempotente (un re-run no
 *   encuentra contactos que migrar).
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
DO $$
DECLARE
  total_contactos INT;
  migrados        INT;
BEGIN
  -- Total de contactos con nombre en todas las fichas (antes de migrar).
  SELECT COUNT(*) INTO total_contactos
  FROM pozo_config pc
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(pc.ficha_critica->'contactos','[]'::jsonb)) AS c
  WHERE NULLIF(trim(c->>'nombre'),'') IS NOT NULL;

  -- Inserta como contacto_operativo los que tengan email o teléfono.
  WITH ins AS (
    INSERT INTO contacto_operativo
      (empresa_id, sub_empresa_id, sitio_id, nombre, apellido, email, telefono, cargo, tipo_contacto)
    SELECT
      s.empresa_id,
      s.sub_empresa_id,
      pc.sitio_id,
      c->>'nombre',
      '',
      NULLIF(c->>'email',''),
      NULLIF(c->>'telefono',''),
      COALESCE(NULLIF(trim(c->>'rol'),''), 'Operacion'),
      CASE WHEN c->>'rol' = 'Responsable' THEN 'Responsable' ELSE 'Operacion' END
    FROM pozo_config pc
    JOIN sitio s ON s.id = pc.sitio_id
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(pc.ficha_critica->'contactos','[]'::jsonb)) AS c
    WHERE NULLIF(trim(c->>'nombre'),'') IS NOT NULL
      AND (NULLIF(c->>'email','') IS NOT NULL OR NULLIF(c->>'telefono','') IS NOT NULL)
    RETURNING 1
  )
  SELECT COUNT(*) INTO migrados FROM ins;

  -- Vacía la lista de contactos del JSONB (ya viven en contacto_operativo).
  UPDATE pozo_config
     SET ficha_critica = jsonb_set(COALESCE(ficha_critica,'{}'::jsonb), '{contactos}', '[]'::jsonb),
         updated_at    = NOW()
   WHERE ficha_critica ? 'contactos'
     AND jsonb_array_length(ficha_critica->'contactos') > 0;

  RAISE NOTICE 'Ficha contactos → contacto_operativo: % migrados de % (saltados % sin email/teléfono).',
    migrados, total_contactos, total_contactos - migrados;
END $$;
`;

async function migrate() {
  try {
    console.log('[migration 011] ficha.contactos → contacto_operativo...');
    await pool.query(SQL);
    console.log('[migration 011] OK');
    process.exit(0);
  } catch (err) {
    console.error('[migration 011] ERROR:', err);
    process.exit(1);
  }
}

migrate();
