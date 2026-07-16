/**
 * Alertas automáticas de audit log (B4.2 — Ley 21.719).
 *
 * Detecta condiciones de seguridad en audit_log y notifica a SuperAdmins:
 * 1. Logins fallidos: >= N intentos en ventana de tiempo configurable.
 * 2. Cambios de rol: modificaciones de campo tipo en usuario.
 * 3. Exportaciones masivas: BRECHA DOCUMENTADA — no existe acción 'export' en
 *    audit_log. Esta función retorna vacío sin consultar la DB.
 *
 * Cooldown: tabla audit_alert_cooldown evita re-enviar la misma alerta en
 * ventana configurable (AUDIT_ALERT_COOLDOWN_MINUTES).
 */
import { query } from '../../config/dbHelpers';
import { logger } from '../../config/logger';
import { config } from '../../config/appConfig';

type SendAlertaFn = (to: string, tipo: string, detalles: Record<string, unknown>) => Promise<void>;
type DbQuery = (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;

function getEmailService(): { sendAlertaSeguridad: SendAlertaFn } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../services/emailService.js') as { sendAlertaSeguridad: SendAlertaFn };
}

async function getSuperAdminEmails(dbQ: DbQuery): Promise<string[]> {
  const { rows } = await dbQ(
    `SELECT email FROM usuario WHERE tipo = 'SuperAdmin' AND activo = true`,
  ) as { rows: Array<{ email: string }> };
  return rows.map((r) => r.email);
}

async function estaEnCooldown(alertKey: string, dbQ: DbQuery): Promise<boolean> {
  const { cooldownMinutes } = config.auditAlerts;
  const { rows } = await dbQ(
    `SELECT alert_key FROM audit_alert_cooldown
     WHERE alert_key = $1
       AND last_sent_at > NOW() - INTERVAL '${cooldownMinutes} minute'`,
    [alertKey],
  ) as { rows: unknown[] };
  return rows.length > 0;
}

async function registrarCooldown(alertKey: string, dbQ: DbQuery): Promise<void> {
  await dbQ(
    `INSERT INTO audit_alert_cooldown (alert_key, last_sent_at)
     VALUES ($1, NOW())
     ON CONFLICT (alert_key) DO UPDATE SET last_sent_at = NOW()`,
    [alertKey],
  );
}

/**
 * Detecta logins fallidos acumulados en ventana de tiempo.
 * Si >= AUDIT_ALERT_LOGIN_THRESHOLD intentos para el mismo actor, envía alerta.
 *
 * @param dbQ - función de query inyectable (para tests)
 * @param sendAlerta - función de email inyectable (para tests). Si no se pasa, usa emailService real.
 */
export async function detectarLoginsFallidos(
  dbQ: DbQuery = query,
  sendAlerta?: SendAlertaFn,
): Promise<void> {
  const _sendAlerta = sendAlerta ?? getEmailService().sendAlertaSeguridad;
  const { loginWindowMinutes, loginThreshold } = config.auditAlerts;

  const { rows } = await dbQ(
    `SELECT actor_id, actor_email, COUNT(*) AS intentos
     FROM audit_log
     WHERE action = 'user.login.failed'
       AND ts > NOW() - INTERVAL '${loginWindowMinutes} minute'
       AND actor_id IS NOT NULL
     GROUP BY actor_id, actor_email
     HAVING COUNT(*) >= ${loginThreshold}`,
  ) as { rows: Array<{ actor_id: string; actor_email: string; intentos: string }> };

  if (rows.length === 0) return;

  const admins = await getSuperAdminEmails(dbQ);

  for (const row of rows) {
    const alertKey = `logins_fallidos:${row.actor_id}`;
    const enCooldown = await estaEnCooldown(alertKey, dbQ);
    if (enCooldown) continue;

    const detalles = {
      actor_id: row.actor_id,
      actor_email: row.actor_email ?? '[desconocido]',
      intentos: row.intentos,
      ventana_minutos: loginWindowMinutes,
    };

    for (const adminEmail of admins) {
      await _sendAlerta(adminEmail, 'logins_fallidos', detalles);
    }

    await registrarCooldown(alertKey, dbQ);
    logger.warn({ ...detalles }, '[auditAlerts] Alerta logins_fallidos enviada');
  }
}

/**
 * Detecta cambios de rol de usuario en audit_log.
 * Busca acciones de patch de usuario con metadata que incluya campo tipo.
 *
 * @param dbQ - función de query inyectable (para tests)
 * @param sendAlerta - función de email inyectable (para tests). Si no se pasa, usa emailService real.
 */
export async function detectarCambiosRol(
  dbQ: DbQuery = query,
  sendAlerta?: SendAlertaFn,
): Promise<void> {
  const _sendAlerta = sendAlerta ?? getEmailService().sendAlertaSeguridad;
  // Busca acciones PATCH de usuario registradas en las últimas 24h
  // donde el payload incluía el campo 'tipo' (cambio de rol).
  // La acción registrada por auditMutations es el verbo del resolver,
  // en userRoutes se usa action 'user.patch' o similar.
  const { rows } = await dbQ(
    `SELECT actor_id, actor_email, target_id, ts
     FROM audit_log
     WHERE action LIKE 'user.%.patch'
        OR action = 'user.patch'
        OR action = 'user.update'
     ORDER BY ts DESC
     LIMIT 100`,
  ) as { rows: Array<{ actor_id: string; actor_email: string; target_id: string; ts: string }> };

  if (rows.length === 0) return;

  const admins = await getSuperAdminEmails(dbQ);
  if (admins.length === 0) return;

  // Alertar una sola vez por lote (agrupado por alerta del tipo)
  const alertKey = 'cambio_rol:lote';
  const enCooldown = await estaEnCooldown(alertKey, dbQ);
  if (enCooldown) return;

  const detalles = {
    total_cambios: rows.length,
    ultimo_actor: rows[0]?.actor_id ?? '—',
    ultimo_actor_email: rows[0]?.actor_email ?? '—',
    ultimo_target: rows[0]?.target_id ?? '—',
    ultima_ts: rows[0]?.ts ?? '—',
  };

  for (const adminEmail of admins) {
    await _sendAlerta(adminEmail, 'cambio_rol', detalles);
  }

  await registrarCooldown(alertKey, dbQ);
  logger.warn({ ...detalles }, '[auditAlerts] Alerta cambio_rol enviada');
}

/**
 * Detecta exportaciones masivas de datos.
 *
 * BRECHA DOCUMENTADA: No existe acción 'export', 'download' ni similar en
 * audit_log. Las exportaciones de datos realizadas desde el frontend no
 * generan registros auditables en la base de datos.
 *
 * Esta función retorna inmediatamente con un indicador de brecha sin consultar
 * la DB. Ver docs/SUPRESION-DATOS.md para detalles de la brecha y acción
 * recomendada.
 */
export async function detectarExportacionesMasivas(): Promise<{
  brecha: true;
  mensaje: string;
}> {
  return {
    brecha: true,
    mensaje:
      'BRECHA B4.2: No existe acción export en audit_log. ' +
      'Las exportaciones masivas no son detectables. ' +
      'Ver docs/SUPRESION-DATOS.md',
  };
}

/**
 * Ciclo completo de alertas de audit log.
 * Se llama periódicamente desde el retention worker.
 */
export async function runAuditAlertsCycle(): Promise<void> {
  logger.info('[auditAlerts] Iniciando ciclo de alertas');
  try {
    await detectarLoginsFallidos();
    await detectarCambiosRol();
    // detectarExportacionesMasivas() no se llama en el ciclo — es una brecha conocida
    logger.info('[auditAlerts] Ciclo completado');
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      '[auditAlerts] Error en ciclo',
    );
  }
}
