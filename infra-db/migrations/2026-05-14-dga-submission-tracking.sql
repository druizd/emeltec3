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

-- idx_dato_dga_submission: se construía acá, pero quedó superado por el
-- rediseño de la cola de envío (2026-05-16 lo dropea; 2026-05-17 lo
-- reemplaza por idx_dato_dga_pending_retry / idx_dato_dga_review_queue
-- sobre site_id). Se deja de crear acá para que una base ya migrada no
-- reconstruya el índice completo en cada deploy solo para que la migración
-- 2026-05-16 lo vuelva a dropear un instante después: en dato_dga
-- (hypertable caliente, consultada constantemente por los workers DGA) ese
-- CREATE toma lock exclusivo y puede deadlockear contra ellos. El
-- DROP INDEX IF EXISTS de 2026-05-16 se mantiene para limpiar bases
-- antiguas que todavía lo tengan; en el estado final del esquema este
-- índice no existe.
