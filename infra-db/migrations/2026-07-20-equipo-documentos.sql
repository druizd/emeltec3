-- ============================================================================
-- 2026-07-20 — Bitácora: vínculo equipamiento ↔ documentos
-- ============================================================================
-- Cada equipo del sitio puede referenciar documentos ya subidos (datasheet,
-- manual, certificado, etc). Modelado como array de ids en sitio_equipo por
-- decisión de producto (vista equipo → sus docs, escritura simple).
--
-- TRADEOFF conocido: un BIGINT[] no tiene integridad referencial. Si se borra
-- un documento, su id queda huérfano en documento_ids. No hay ON DELETE
-- CASCADE como en el resto del esquema. Aceptado explícitamente.
--
-- Idempotente.
-- ============================================================================

BEGIN;

ALTER TABLE sitio_equipo
  ADD COLUMN IF NOT EXISTS documento_ids BIGINT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN sitio_equipo.documento_ids IS
  'Ids de documentos (tabla documentos) vinculados al equipo. Array sin FK: '
  'puede contener ids huérfanos si se borra el documento. Decisión de producto.';

-- ---------------------------------------------------------------------------
-- Verificación
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='sitio_equipo' AND column_name='documento_ids') THEN
    RAISE EXCEPTION 'sitio_equipo.documento_ids no se creó';
  END IF;
  RAISE NOTICE 'Equipo↔documentos: OK';
END $$;

COMMIT;
