-- =====================================================
-- DGA Submission Tracking: columnas de estado de envío en dato_dga
-- - estatus: pendiente / enviado / rechazado
-- - comprobante: numeroComprobante retornado por MIA-DGA
-- - ultimo_intento_at: timestamp del último intento de envío
-- - intentos: contador de intentos (para retry logic)
-- =====================================================

ALTER TABLE dato_dga
  ADD COLUMN IF NOT EXISTS estatus           VARCHAR(10)  NOT NULL DEFAULT 'pendiente'
                                             CHECK (estatus IN ('pendiente','enviado','rechazado')),
  ADD COLUMN IF NOT EXISTS comprobante       TEXT,
  ADD COLUMN IF NOT EXISTS ultimo_intento_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS intentos          SMALLINT     NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_dato_dga_submission
  ON dato_dga (estatus, ultimo_intento_at)
  WHERE estatus != 'enviado';
