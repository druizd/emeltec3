/**
 * Worker de retención de datos (B5.2 — Ley 21.719).
 *
 * Ciclo diario que:
 * 1. Anonimiza entradas antiguas de audit_log (12 meses general, 36 meses DGA).
 * 2. Envía avisos de inactividad a usuarios que llevan 23 meses sin login.
 * 3. Anonimiza cuentas con 24+ meses de inactividad que ya recibieron aviso
 *    hace 30+ días.
 *
 * Kill switch: ENABLE_RETENTION_WORKER (default false).
 */
import { query } from '../../config/dbHelpers';
import { logger } from '../../config/logger';
import { config } from '../../config/appConfig';
import { suprimirUsuario } from './supresion';
import { runAuditAlertsCycle } from './auditAlerts';

type SendAvisoFn = (email: string, nombre: string, diasRestantes: number) => Promise<void>;
type DbQuery = (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
type SuprimirFn = (params: import('./supresion').SuprimirParams) => Promise<void>;

const SYSTEM_ACTOR = {
  actorId: 'SYSTEM',
  actorEmail: 'sistema@emeltec.cl',
  actorTipo: 'Sistema',
};

let intervalHandle: NodeJS.Timeout | null = null;
let alertsIntervalHandle: NodeJS.Timeout | null = null;

function getEmailService(): { sendAvisoInactividad: SendAvisoFn } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../services/emailService.js') as { sendAvisoInactividad: SendAvisoFn };
}

/**
 * Anonimiza entradas antiguas de audit_log:
 * - Entradas no-DGA con más de RETENTION_AUDIT_MONTHS meses.
 * - Entradas DGA con más de RETENTION_DGA_MONTHS meses.
 *
 * @param dbQ - función de query inyectable (para tests)
 */
export async function anonimizarAuditLogAntiguo(dbQ: DbQuery = query): Promise<void> {
  const { auditMonths, dgaMonths } = config.retention;

  // Anonimizar entradas generales (no-DGA)
  await dbQ(
    `UPDATE audit_log
     SET actor_email = '[ANONIMIZADO]',
         ip          = '[ANONIMIZADO]'
     WHERE ts < NOW() - INTERVAL '${auditMonths} month'
       AND action NOT LIKE 'dga.%'
       AND (actor_email != '[ANONIMIZADO]' OR ip != '[ANONIMIZADO]')`,
  );

  // Anonimizar entradas DGA con retención extendida
  await dbQ(
    `UPDATE audit_log
     SET actor_email = '[ANONIMIZADO]',
         ip          = '[ANONIMIZADO]'
     WHERE ts < NOW() - INTERVAL '${dgaMonths} month'
       AND action LIKE 'dga.%'
       AND (actor_email != '[ANONIMIZADO]' OR ip != '[ANONIMIZADO]')`,
  );

  logger.info({ auditMonths, dgaMonths }, '[retention] audit_log anonimizado');
}

/**
 * Envía aviso de inactividad próxima a usuarios que llevan 23 meses sin login
 * y aún no han recibido el aviso.
 *
 * @param dbQ - función de query inyectable (para tests)
 * @param sendAviso - función de email inyectable (para tests)
 */
export async function enviarAvisosInactividad(
  dbQ: DbQuery = query,
  sendAviso: SendAvisoFn = getEmailService().sendAvisoInactividad,
): Promise<void> {
  const { inactivityMonths, noticeDays } = config.retention;
  const warningMonths = inactivityMonths - 1; // 23 meses

  const { rows } = await dbQ(
    `SELECT id, email, nombre
     FROM usuario
     WHERE activo = true
       AND last_login_at IS NOT NULL
       AND last_login_at < NOW() - INTERVAL '${warningMonths} month'
       AND aviso_inactividad_enviado_at IS NULL`,
  ) as { rows: Array<{ id: string; email: string; nombre: string }> };

  if (rows.length === 0) return;

  logger.info({ count: rows.length }, '[retention] Enviando avisos de inactividad');

  for (const user of rows) {
    try {
      await sendAviso(user.email, user.nombre, noticeDays);

      // Marcar aviso enviado
      await dbQ(
        `UPDATE usuario
         SET aviso_inactividad_enviado_at = NOW()
         WHERE id = $1`,
        [user.id],
      );
    } catch (err) {
      logger.error(
        { userId: user.id, err: err instanceof Error ? err.message : String(err) },
        '[retention] Error enviando aviso de inactividad',
      );
    }
  }
}

/**
 * Anonimiza cuentas con 24+ meses de inactividad que ya recibieron aviso
 * hace al menos 30 días (RETENTION_NOTICE_DAYS).
 *
 * @param dbQ - función de query inyectable (para tests)
 * @param suprimirFn - función de supresión inyectable (para tests)
 */
export async function anonimizarCuentasInactivas(
  dbQ: DbQuery = query,
  suprimirFn: SuprimirFn = suprimirUsuario,
): Promise<void> {
  const { inactivityMonths, noticeDays } = config.retention;

  const { rows } = await dbQ(
    `SELECT id, email, nombre, apellido, tipo
     FROM usuario
     WHERE activo = true
       AND last_login_at IS NOT NULL
       AND last_login_at < NOW() - INTERVAL '${inactivityMonths} month'
       AND aviso_inactividad_enviado_at IS NOT NULL
       AND aviso_inactividad_enviado_at < NOW() - INTERVAL '${noticeDays} day'`,
  ) as { rows: Array<{ id: string; email: string; nombre: string; apellido: string; tipo: string }> };

  if (rows.length === 0) return;

  logger.info({ count: rows.length }, '[retention] Anonimizando cuentas inactivas');

  for (const user of rows) {
    try {
      await suprimirFn({
        ...SYSTEM_ACTOR,
        targetId: user.id,
        req: null,
        dbQuery: dbQ,
      });
      logger.info({ userId: user.id }, '[retention] Cuenta anonimizada por inactividad');
    } catch (err) {
      logger.error(
        { userId: user.id, err: err instanceof Error ? err.message : String(err) },
        '[retention] Error anonimizando cuenta',
      );
    }
  }
}

async function runCycle(): Promise<void> {
  logger.info('[retention] Iniciando ciclo de retención');
  try {
    await anonimizarAuditLogAntiguo();
    await enviarAvisosInactividad();
    await anonimizarCuentasInactivas();
    logger.info('[retention] Ciclo completado');
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      '[retention] Error en ciclo',
    );
  }
}

export function startRetentionWorker(): void {
  if (!config.workers.retention) {
    logger.info('[retention] Worker deshabilitado (ENABLE_RETENTION_WORKER=false)');
  } else {
    if (!intervalHandle) {
      logger.info({ pollMs: config.retention.pollMs }, '[retention] Iniciando worker');
      void runCycle(); // Ejecutar inmediatamente al arrancar
      intervalHandle = setInterval(() => void runCycle(), config.retention.pollMs);
    }
  }

  // Alertas de audit log (intervalo independiente, más frecuente que retención)
  if (!config.workers.auditAlerts) {
    logger.info('[retention] Worker de alertas audit deshabilitado (ENABLE_AUDIT_ALERTS_WORKER=false)');
    return;
  }
  if (!alertsIntervalHandle) {
    logger.info({ pollMs: config.auditAlerts.pollMs }, '[retention] Iniciando worker de alertas audit');
    void runAuditAlertsCycle();
    alertsIntervalHandle = setInterval(() => void runAuditAlertsCycle(), config.auditAlerts.pollMs);
  }
}

export function stopRetentionWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    logger.info('[retention] Worker detenido');
  }
  if (alertsIntervalHandle) {
    clearInterval(alertsIntervalHandle);
    alertsIntervalHandle = null;
    logger.info('[retention] Worker de alertas audit detenido');
  }
}
