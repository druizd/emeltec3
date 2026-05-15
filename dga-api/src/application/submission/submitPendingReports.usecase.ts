import { findPending, updateSubmissionResult } from '../../infrastructure/db/reports.repo';
import { submitReportToDga } from './submitReportToDga.usecase';
import { config } from '../../shared/env';
import { logger } from '../../shared/logger';
import type { DgaSubmissionPayload } from '../../domain/submission/dgaEnvelope';

// Spec DGA enero 2025 §6: máximo 50 transmisiones por tick para no saturar MIA-DGA
// con retransmisiones acumuladas, y al menos 5 min entre envíos de datos acumulados.
const BATCH_LIMIT = 50;

export async function submitPendingReports(): Promise<void> {
  const pending = await findPending(BATCH_LIMIT);

  if (pending.length === 0) {
    logger.debug('[submission] sin reportes pendientes');
    return;
  }

  logger.info({ count: pending.length }, '[submission] procesando reportes pendientes');

  let enviados = 0;
  let rechazados = 0;
  let errores = 0;

  for (const item of pending) {
    const payload: DgaSubmissionPayload = {
      informante: {
        rut: item.rutInformante,
        clave: item.claveInformante,
        rutEmpresa: config.dga.rutEmpresa,
      },
      obraDga: item.obra,
      report: item.report,
    };

    try {
      const result = await submitReportToDga(payload);

      await updateSubmissionResult({
        idDgauser: item.idDgauser,
        ts: item.report.timestamp,
        estatus: result.estatus,
        ...(result.comprobante !== undefined && { comprobante: result.comprobante }),
      });

      if (result.estatus === 'enviado') {
        enviados++;
        logger.info(
          {
            sitioId: item.report.sitioId,
            ts: item.report.timestamp,
            comprobante: result.comprobante,
          },
          '[submission] reporte enviado OK',
        );
      } else {
        rechazados++;
        logger.warn(
          { sitioId: item.report.sitioId, ts: item.report.timestamp, intentos: item.intentos + 1 },
          '[submission] reporte rechazado por MIA-DGA — se reintentará mañana',
        );
      }
    } catch (err) {
      errores++;
      logger.error(
        { err, sitioId: item.report.sitioId, ts: item.report.timestamp },
        '[submission] error al enviar reporte',
      );

      // Registra el intento fallido para que el retry de 23h funcione correctamente
      await updateSubmissionResult({
        idDgauser: item.idDgauser,
        ts: item.report.timestamp,
        estatus: 'rechazado',
      }).catch(() => undefined);
    }
  }

  logger.info({ enviados, rechazados, errores }, '[submission] tick completado');
}
