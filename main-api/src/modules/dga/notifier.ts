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
import { createRequire } from 'module';
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
const nodeRequire = createRequire(__filename);

function loadMailService(): MailService | null {
  if (cachedMail) return cachedMail;
  // emailService.js vive en src/services/. Layout:
  //   /app/dist/modules/dga/notifier.js      ← este archivo en runtime
  //   /app/src/services/emailService.js      ← target
  // Subir 3 niveles desde __dirname llega a /app, luego src/services.
  // Intentamos varios paths para cubrir layouts en dev y en docker.
  const candidates = [
    path.join(__dirname, '..', '..', '..', 'src', 'services', 'emailService.js'),
    path.join(__dirname, '..', '..', '..', '..', 'src', 'services', 'emailService.js'),
  ];
  for (const p of candidates) {
    try {
      cachedMail = nodeRequire(p) as MailService;
      return cachedMail;
    } catch {
      // sigue con el próximo path
    }
  }
  logger.warn(
    { tried: candidates },
    'DGA notifier: emailService.js no encontrado en paths candidatos',
  );
  return null;
}

/**
 * Envía un email de alerta admin a MONITOR_PRIMARY_EMAIL (reconciler,
 * anomalías de pipeline). Si no hay destinatario configurado, loguea warn
 * y sigue sin error — el reconciler corre periódicamente y no debe fallar
 * por config incompleta.
 */
export async function sendDgaAdminAlert(input: { subject: string; body: string }): Promise<void> {
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

/**
 * Envía un email DGA a un destinatario explícito (2FA al solicitante).
 * A diferencia de `sendDgaAdminAlert`, lanza error si no se puede entregar —
 * un código 2FA sin destinatario no tiene sentido y el handler debe
 * propagar el fallo al cliente en vez de mentir con 200.
 */
export async function sendDgaUserEmail(input: {
  to: string;
  subject: string;
  body: string;
}): Promise<void> {
  if (!input.to) {
    throw new Error('Destinatario vacío');
  }
  const mail = loadMailService();
  if (!mail) {
    throw new Error('emailService no disponible');
  }
  await mail.sendAdminPlainEmail({
    to: input.to,
    subject: input.subject,
    text: input.body,
  });
}
