/**
 * Notificador DGA: envía emails al admin cuando el reconciler detecta
 * anomalías que requieren intervención humana (slot enviado sin audit,
 * doble envío detectado, etc.).
 *
 * Usa `sendAdminPlainEmail` del legacy emailService.js (carga dinámica
 * para evitar bundling cruzado TS/CJS). Si no hay admin email configurado
 * (MONITOR_PRIMARY_EMAIL), loguea warn y no falla.
 */
import { logger } from '../../config/logger';
import { config } from '../../config/appConfig';

interface MailService {
  sendAdminPlainEmail: (input: {
    to: string;
    subject: string;
    text: string;
    html?: string;
  }) => Promise<unknown>;
  renderAdminShell: (opts: {
    title: string;
    preheader?: string;
    accentColor?: string;
    accentGradient?: string;
    contentHtml: string;
  }) => string;
}

/** Envuelve el cuerpo (filas <tr>) en el shell branded de Emeltec. */
export function renderAdminShell(opts: {
  title: string;
  preheader?: string;
  contentHtml: string;
}): string | undefined {
  const mail = loadMailService();
  return mail?.renderAdminShell(opts);
}

let cachedMail: MailService | null = null;

/**
 * `require` relativo, igual que el resto del código que usa el emailService
 * legacy (alerts/worker, auth/service, healthDigest/worker).
 *
 * Antes esto apuntaba a `/app/src/services/emailService.js`, la copia que el
 * Dockerfile metía en la imagen, y NUNCA cargaba: esa copia hace
 * `require('../utils/timezone')` y `src/utils` no se copiaba, así que tiraba
 * MODULE_NOT_FOUND. Los dos candidatos apuntaban al mismo árbol roto, el
 * try/catch se tragaba el error y esto devolvía `null` con un warn. Resultado:
 * `sendDgaAdminAlert` no mandó un solo correo desde que la imagen es así, y
 * las anomalías del reconciler se perdían en silencio.
 *
 * El emailService que corre de verdad es el compilado: con `allowJs` en el
 * tsconfig, los CJS legacy se emiten en `dist/services/`, al lado de
 * `dist/utils/timezone.js`, que es justo lo que le faltaba a la otra copia.
 */
function loadMailService(): MailService | null {
  if (cachedMail) return cachedMail;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedMail = require('../../services/emailService.js') as MailService;
    return cachedMail;
  } catch (err) {
    logger.error(
      { err: (err as Error).message },
      'DGA notifier: no se pudo cargar emailService — las alertas del reconciler no saldrán',
    );
    return null;
  }
}

/**
 * Envía un email de alerta admin a MONITOR_PRIMARY_EMAIL (reconciler,
 * anomalías de pipeline). Si no hay destinatario configurado, loguea warn
 * y sigue sin error — el reconciler corre periódicamente y no debe fallar
 * por config incompleta.
 */
export async function sendDgaAdminAlert(input: {
  subject: string;
  body: string;
  html?: string;
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
      ...(input.html ? { html: input.html } : {}),
    });
  } catch (err) {
    logger.error(
      { err: (err as Error).message, subject: input.subject },
      'DGA notifier: fallo al enviar email',
    );
  }
}
