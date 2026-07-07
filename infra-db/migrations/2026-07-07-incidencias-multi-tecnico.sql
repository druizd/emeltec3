-- ============================================================================
-- Incidencias: múltiples técnicos asignados (equipo Emeltec)
-- ============================================================================
-- Antes: incidencias.tecnico_id (un solo técnico, FK usuario).
-- Ahora: tabla puente incidencia_tecnicos (N técnicos por incidencia).
--
-- La columna tecnico_id QUEDA (deprecada, dual-write con el primer técnico
-- del array) para no romper lectores existentes durante la transición.
-- Idempotente: safe re-run.
-- ============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS incidencia_tecnicos (
  incidencia_id BIGINT      NOT NULL REFERENCES incidencias(id) ON DELETE CASCADE,
  usuario_id    VARCHAR(10) NOT NULL REFERENCES usuario(id)     ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (incidencia_id, usuario_id)
);

CREATE INDEX IF NOT EXISTS idx_incidencia_tecnicos_usuario
  ON incidencia_tecnicos (usuario_id);

COMMENT ON TABLE incidencia_tecnicos IS
  'Técnicos (equipo Emeltec, usuario.tipo=SuperAdmin) asignados a una '
  'incidencia. Reemplaza incidencias.tecnico_id (deprecada, dual-write).';

-- Backfill: asignaciones existentes de la columna única.
INSERT INTO incidencia_tecnicos (incidencia_id, usuario_id)
SELECT id, tecnico_id
  FROM incidencias
 WHERE tecnico_id IS NOT NULL
ON CONFLICT (incidencia_id, usuario_id) DO NOTHING;

COMMENT ON COLUMN incidencias.tecnico_id IS
  'DEPRECADA — usar incidencia_tecnicos. Se mantiene con el primer técnico '
  'del array (dual-write) para lectores legacy.';

COMMIT;
