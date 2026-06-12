-- ============================================================================
-- Drop columna dga_auto_accept_fallback_hours de pozo_config
-- ============================================================================
--
-- Contexto:
--   La columna se introdujo en 2026-05-17-dga-pozo-config-redesign.sql con la
--   intención de habilitar auto-aceptación de slots en estado `requires_review`
--   tras N horas sin decisión manual.
--
--   La auto-aceptación NUNCA se implementó. Ningún worker (preseed/fill/
--   submission/reconciler) referencia este valor. Es código muerto en schema +
--   schema zod + service + repo + DTO frontend.
--
--   Decisión 2026-06-11: retirar. Auto-aceptar slots `requires_review` viola
--   la política de "no reportar dato dudoso" — un slot en review tiene un
--   warning (caudal negativo, totalizador zero, sensor defectuoso, etc) que
--   requiere decisión humana, no auto-cierre por timeout.
--
--   Si en el futuro se decide implementar algún tipo de auto-aceptación
--   selectiva (ej: solo para sensores con `known_defective=true` + sugerencia
--   de último válido confiable), se añade como feature nueva con su propia
--   columna.
--
-- Reversibilidad:
--   La columna era nullable sin default. Datos guardados no eran usados por
--   nada. Re-añadir si se necesita: copiar bloque ADD COLUMN de la migration
--   2026-05-17.
-- ============================================================================

ALTER TABLE pozo_config
  DROP COLUMN IF EXISTS dga_auto_accept_fallback_hours;

-- Verificación
SELECT NOT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_name = 'pozo_config'
    AND column_name = 'dga_auto_accept_fallback_hours'
) AS column_dropped;
