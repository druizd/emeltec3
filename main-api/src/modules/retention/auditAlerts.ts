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
 *
 * Marca de agua: el cooldown solo limita la FRECUENCIA. Cuando la ventana de
 * detección es más larga que el cooldown, la misma fila de audit_log sigue
 * calificando ciclo tras ciclo y la alerta se repite hasta que la fila envejece.
 * `audit_alert_cooldown.watermark_ts` recuerda el `ts` más nuevo ya notificado
 * para esa clave, y la detección solo mira lo posterior.
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
  const { rows } = (await dbQ(
    `SELECT email FROM usuario WHERE tipo = 'SuperAdmin' AND activo = true`,
  )) as { rows: Array<{ email: string }> };
  return rows.map((r) => r.email);
}

async function estaEnCooldown(alertKey: string, dbQ: DbQuery): Promise<boolean> {
  const { cooldownMinutes } = config.auditAlerts;
  const { rows } = (await dbQ(
    `SELECT alert_key FROM audit_alert_cooldown
     WHERE alert_key = $1
       AND last_sent_at > NOW() - INTERVAL '${cooldownMinutes} minute'`,
    [alertKey],
  )) as { rows: unknown[] };
  return rows.length > 0;
}

/**
 * Registra el envío. `watermarkTs` es el `ts` más nuevo de audit_log que viajó en
 * la alerta; se omite en las alertas cuya ventana de detección ya es más corta
 * que el cooldown (sus filas expiran antes de poder repetirse).
 *
 * La marca nunca retrocede: GREATEST ignora los NULL en Postgres, así que un
 * envío sin marca conserva la que hubiera.
 */
async function registrarCooldown(
  alertKey: string,
  dbQ: DbQuery,
  watermarkTs?: unknown,
): Promise<void> {
  await dbQ(
    `INSERT INTO audit_alert_cooldown (alert_key, last_sent_at, watermark_ts)
     VALUES ($1, NOW(), $2)
     ON CONFLICT (alert_key) DO UPDATE
        SET last_sent_at = NOW(),
            watermark_ts = GREATEST(EXCLUDED.watermark_ts, audit_alert_cooldown.watermark_ts)`,
    [alertKey, watermarkTs ?? null],
  );
}

/**
 * Formatea un timestamp de la bitácora al formato de la plataforma:
 * DD/MM/YYYY HH:MM en hora de Chile. Sin esto la alerta mostraba el
 * `toString()` crudo de la Date — en UTC y en inglés
 * ("Tue Aug 18 2026 04:52:48 GMT+0000").
 */
function formatearFechaChile(ts: unknown): string {
  if (!ts) return '—';
  const d = ts instanceof Date ? ts : new Date(String(ts));
  if (Number.isNaN(d.getTime())) return String(ts);
  const partes = new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const parte = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '';
  return `${parte('day')}/${parte('month')}/${parte('year')} ${parte('hour')}:${parte('minute')}`;
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

  // Contrato con el productor: auth-api/src/controllers/authController.js
  // escribe 'login.failure' (credencial inválida o email desconocido) y
  // 'login.locked' (umbral de lockout alcanzado). Se agrupa por actor_email
  // porque en fallos con email desconocido actor_id es NULL.
  const { rows } = (await dbQ(
    `SELECT actor_email, MAX(actor_id::text) AS actor_id, COUNT(*) AS intentos
     FROM audit_log
     WHERE action IN ('login.failure', 'login.locked')
       AND ts > NOW() - INTERVAL '${loginWindowMinutes} minute'
       AND actor_email IS NOT NULL
     GROUP BY actor_email
     HAVING COUNT(*) >= ${loginThreshold}`,
  )) as { rows: Array<{ actor_id: string | null; actor_email: string; intentos: string }> };

  if (rows.length === 0) return;

  const admins = await getSuperAdminEmails(dbQ);

  for (const row of rows) {
    // Cooldown por email: es la clave de agrupación (actor_id puede ser NULL).
    const alertKey = `logins_fallidos:${row.actor_email}`;
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
 * Detecta cambios de rol de usuario en audit_log (últimas 24h).
 *
 * CONTRATO PRODUCTOR→CONSUMIDOR: quien escribe es `auditMutations` vía el
 * resolver de `services/auditResolver.js`, que emite las acciones en ESPAÑOL
 * (`usuario.update`). Esta función buscaba `user.update` / `user.patch`, que
 * no los escribe nadie: nunca detectó un solo cambio de rol. Mismo defecto
 * que tuvo `detectarLoginsFallidos` con `user.login.failed`.
 *
 * El filtro por campo `tipo` ahora sí es posible: desde que la bitácora guarda
 * `metadata.changes`, se puede distinguir un cambio de rol de cualquier otra
 * edición de usuario. Antes solo existía `payload_hash` y la función alertaba
 * por CUALQUIER update de usuario.
 *
 * @param dbQ - función de query inyectable (para tests)
 * @param sendAlerta - función de email inyectable (para tests). Si no se pasa, usa emailService real.
 */
export async function detectarCambiosRol(
  dbQ: DbQuery = query,
  sendAlerta?: SendAlertaFn,
): Promise<void> {
  const _sendAlerta = sendAlerta ?? getEmailService().sendAlertaSeguridad;

  // Alertar una sola vez por lote (agrupado por alerta del tipo).
  const alertKey = 'cambio_rol:lote';

  // La ventana de 24h es solo el PISO. El filtro que evita repetir es la marca
  // de agua: sin ella, un cambio de rol seguía calificando durante 24 horas y la
  // alerta se reenviaba cada vez que expiraba el cooldown de 60 min — 24 rondas
  // a todos los SuperAdmin por un único cambio (incidente del 18-08-2026).
  //
  // El join con `usuario` resuelve los IDs a personas al momento de alertar.
  // Sin él la alerta solo decía "ultimo_target: U22046E" y había que abrir la
  // DB para saber a quién le cambiaron el rol. Resolver acá NO relaja la
  // redacción de la bitácora: audit_log sigue guardando únicamente IDs.
  const { rows } = (await dbQ(
    `SELECT al.actor_id, al.actor_email, al.target_id, al.ts, al.ip,
            NULLIF(TRIM(CONCAT(a.nombre, ' ', COALESCE(a.apellido, ''))), '') AS actor_nombre,
            NULLIF(TRIM(CONCAT(t.nombre, ' ', COALESCE(t.apellido, ''))), '') AS target_nombre,
            t.email AS target_email,
            t.tipo  AS target_tipo_actual,
            al.metadata -> 'changes' -> 'tipo' AS cambio_tipo
     FROM audit_log al
     LEFT JOIN usuario a ON a.id = al.actor_id
     LEFT JOIN usuario t ON t.id = al.target_id
     WHERE al.action = 'usuario.update'
       AND al.ts > GREATEST(
             COALESCE(
               (SELECT c.watermark_ts FROM audit_alert_cooldown c WHERE c.alert_key = $1),
               NOW() - INTERVAL '24 hours'),
             NOW() - INTERVAL '24 hours')
       AND COALESCE(al.status_code, 200) < 400
       AND jsonb_exists(al.metadata -> 'changes', 'tipo')
     ORDER BY al.ts DESC
     LIMIT 100`,
    [alertKey],
  )) as {
    rows: Array<{
      actor_id: string;
      actor_email: string;
      actor_nombre: string | null;
      target_id: string;
      target_nombre: string | null;
      target_email: string | null;
      target_tipo_actual: string | null;
      ip: string | null;
      ts: string;
      cambio_tipo: { antes?: unknown; despues?: unknown } | null;
    }>;
  };

  if (rows.length === 0) return;

  const admins = await getSuperAdminEmails(dbQ);
  if (admins.length === 0) return;

  const enCooldown = await estaEnCooldown(alertKey, dbQ);
  if (enCooldown) return;

  const ultimo = rows[0];
  const detalles = {
    total_cambios: rows.length,
    // Si la cuenta fue eliminada después del cambio, el join no resuelve
    // nombre: el actor_email denormalizado de la bitácora es el respaldo.
    actor_nombre: ultimo?.actor_nombre ?? ultimo?.actor_email ?? '—',
    actor_email: ultimo?.actor_email ?? '—',
    actor_id: ultimo?.actor_id ?? '—',
    actor_ip: ultimo?.ip ?? '—',
    target_nombre: ultimo?.target_nombre ?? '—',
    target_email: ultimo?.target_email ?? '—',
    target_id: ultimo?.target_id ?? '—',
    // `tipo` está en la allowlist de auditoría de usuario, así que su valor
    // sí queda registrado: la alerta puede decir de qué rol a qué rol.
    rol_anterior: String(ultimo?.cambio_tipo?.antes ?? '—'),
    rol_nuevo: String(ultimo?.cambio_tipo?.despues ?? '—'),
    // El rol que tiene hoy: delata si alguien ya revirtió el cambio.
    rol_actual: ultimo?.target_tipo_actual ?? '—',
    fecha: formatearFechaChile(ultimo?.ts),
  };

  for (const adminEmail of admins) {
    await _sendAlerta(adminEmail, 'cambio_rol', detalles);
  }

  // `rows` viene ORDER BY ts DESC, así que rows[0].ts es el cambio más nuevo
  // incluido en este correo: la marca se posa exactamente ahí. Un cambio que
  // entre mientras se envía queda por delante de la marca y se alerta después.
  await registrarCooldown(alertKey, dbQ, ultimo?.ts);
  // El log lleva IDs, no identidades: los nombres y correos viajan al mail del
  // SuperAdmin, pero persistirlos en los logs de la app sería otra copia de
  // datos personales fuera de la bitácora (Ley 21.719).
  logger.warn(
    {
      total_cambios: detalles.total_cambios,
      actor_id: ultimo?.actor_id ?? null,
      target_id: ultimo?.target_id ?? null,
      rol_anterior: detalles.rol_anterior,
      rol_nuevo: detalles.rol_nuevo,
    },
    '[auditAlerts] Alerta cambio_rol enviada',
  );
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
