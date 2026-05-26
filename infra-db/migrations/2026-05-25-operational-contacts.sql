-- ============================================================================
-- 2026-05-25 - Contactos operativos por empresa/subempresa/sitio
-- ============================================================================
-- Agenda operacional separada de usuario:
-- - Puede vincular un usuario registrado (usuario_id), pero no es obligatorio.
-- - Puede representar un contacto externo sin acceso a la plataforma.
-- - Sirve para responsables DGA, emergencias, mantencion, operacion, etc.
-- Idempotente.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS contacto_operativo (
  id              BIGSERIAL    PRIMARY KEY,
  empresa_id      VARCHAR(10)  NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  sub_empresa_id  VARCHAR(10)  NOT NULL REFERENCES sub_empresa(id) ON DELETE CASCADE,
  sitio_id        VARCHAR(10)  REFERENCES sitio(id) ON DELETE CASCADE,
  usuario_id      VARCHAR(10)  REFERENCES usuario(id) ON DELETE SET NULL,
  nombre          VARCHAR(200) NOT NULL,
  apellido        VARCHAR(100) NOT NULL DEFAULT '',
  email           VARCHAR(150),
  telefono        VARCHAR(50),
  cargo           VARCHAR(160) NOT NULL,
  tipo_contacto   VARCHAR(60)  NOT NULL DEFAULT 'Operacion',
  notas           TEXT,
  created_by      VARCHAR(10)  REFERENCES usuario(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT contacto_operativo_contacto_minimo
    CHECK (email IS NOT NULL OR telefono IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_contacto_operativo_empresa
  ON contacto_operativo (empresa_id);

CREATE INDEX IF NOT EXISTS idx_contacto_operativo_sub_empresa
  ON contacto_operativo (sub_empresa_id);

CREATE INDEX IF NOT EXISTS idx_contacto_operativo_sitio
  ON contacto_operativo (sitio_id)
  WHERE sitio_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacto_operativo_usuario
  ON contacto_operativo (usuario_id)
  WHERE usuario_id IS NOT NULL;

COMMENT ON TABLE contacto_operativo IS
  'Agenda operacional. Un contacto puede estar vinculado a usuario o ser externo sin acceso.';

ALTER TABLE contacto_operativo
  ADD COLUMN IF NOT EXISTS apellido VARCHAR(100) NOT NULL DEFAULT '';

COMMIT;
