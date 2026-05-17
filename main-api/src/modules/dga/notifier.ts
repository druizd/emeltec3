/**
 * Notificador DGA: envía emails al admin cuando el reconciler detecta
 * anomalías que requieren intervención humana (slot enviado sin audit,
 * doble envío detectado, etc.).
 *
 * Usa `sendAdminPlainEmail` del legacy emailService.js (carga dinámica
 * para evitar bundling cruzado TS/CJS). Si no hay admin email configurado
 * (MONITOR_PRIMARY_EMAIL), loguea warn y no falla.
 */
import path from 'path';
import { logger } from '../../config/logger';
import { config } from '../../config/appConfig';

interface MailService {
  sendAdminPlainEmail: (input: {
    to: string;
    subject: string;
    text: string;
    html?: string;
  }) => Promise<unknown>;
}

let cachedMail: MailService | null = null;

function loadMailService(): MailService | null {
  if (cachedMail) return cachedMail;
  try {
    // emailService.js vive fuera de dist/, en src/services/. Lo cargamos relativo
    // a este archivo, atravesando dist/modules/dga → src/services.
    const p = path.join(__dirname, '..', '..', '..', '..', 'src', 'services', 'emailService.js');
    cachedMail = require(p);
    return cachedMail;
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      'DGA notifier: emailService.js no disponible (¿build?)',
    );
    return null;
  }
}

/**
 * Envía un email de alerta admin. Si no hay destinatario configurado
 * (MONITOR_PRIMARY_EMAIL vacío), loguea warn y sigue sin error.
 */
export async function sendDgaAdminAlert(input: {
  subject: string;
  body: string;
}): Promise<void> {
  const to = config.monitor.primaryEmail;
  if (!to) {
    logger.warn({ subject: input.subject }, 'DGA notifier: MONITOR_PRIMARY_EMAIL no configurado');
    return;
  }
  const mail = loadMailService();
  if (!mail) return;
  try {
    await mail.sendAdminPlainEmail({
      to,
      subject: input.subject,
      text: input.body,
    });
  } catch (err) {
    logger.error(
      { err: (err as Error).message, subject: input.subject },
      'DGA notifier: fallo al enviar email',
    );
  }
}
