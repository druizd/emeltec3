/**
 * Controllers HTTP de los destinatarios del monitoreo interno (healthDigest).
 *
 * Solo SuperAdmin (ver `http/v2/routes.ts`). Tres operaciones:
 *   GET  /health-digest/destinatarios  → lista + metadata del worker.
 *   PUT  /health-digest/destinatarios  → reemplaza la lista completa.
 *   POST /health-digest/prueba         → manda un resumen real a un destino.
 */
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { config } from '../../config/appConfig';
import { ok } from '../../shared/httpEnvelope';
import { ValidationError } from '../../shared/errors';
import { require2fa } from '../../shared/email-otp';
import type { AuthUser } from '../../shared/permissions';
import {
  listDestinatarios,
  normalizeEmail,
  replaceDestinatarios,
  type DigestDestinatarioInput,
} from './destinatariosRepo';
import { DIGEST_TZ, MONITOR_PRIMARY, WORKER_ENABLED, buildSnapshot, sendDigestTo } from './worker';
import { getConfig, normalizarHoras, normalizarUmbral, saveConfig } from './configRepo';

/** Tope defensivo: la lista es de equipo interno, no una lista de difusión. */
const MAX_DESTINATARIOS = 25;

const DestinatarioSchema = z.object({
  email: z.string().trim().min(5).max(150).email('email inválido'),
  nombre: z.string().trim().max(120).nullish(),
  recibe_resumen: z.boolean(),
  recibe_seguridad: z.boolean(),
  activo: z.boolean(),
  // Sin uso desde el 16-09-2026 (se retiraron las escalaciones inmediatas). Se
  // siguen aceptando para no romper a un cliente viejo que todavía los mande.
  recibe_eventos: z.boolean().optional(),
  umbral_evento: z.enum(['t3', 't6', 't12']).optional(),
});

/** Programación del resumen: horas de envío y umbral de horas sin transmitir. */
const ConfigBody = z.object({
  horas: z.array(z.number().int().min(0).max(23)).min(1).max(6),
  umbral_horas: z.number().positive().max(720),
});

const ReplaceBody = z.object({
  destinatarios: z.array(DestinatarioSchema).max(MAX_DESTINATARIOS),
});

const PruebaBody = z.object({
  email: z.string().trim().min(5).max(150).email('email inválido'),
});

function actorId(req: Request): string | null {
  const user = (req as Request & { user?: AuthUser }).user;
  return user?.id != null ? String(user.id) : null;
}

/**
 * 2FA solo si el PUT agrega una dirección que no estaba en la lista.
 *
 * El resumen expone nombres de instalaciones y empresas: sumar un buzón nuevo
 * es una salida de datos hacia afuera y exige código. Pausar, quitar o cambiar
 * umbrales de direcciones ya autorizadas no lo exige — si no, cada toggle de
 * esta pantalla pediría 2FA.
 */
export async function require2faIfNuevoDestinatario(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const body = req.body as { destinatarios?: { email?: unknown }[] } | undefined;
  const entrantes = Array.isArray(body?.destinatarios) ? body.destinatarios : [];
  const emails = entrantes
    .map((d) => normalizeEmail(String(d?.email ?? '')))
    .filter((e) => e.length > 0);
  if (emails.length === 0) {
    next();
    return;
  }
  try {
    const existentes = new Set((await listDestinatarios()).map((d) => d.email));
    if (!emails.some((e) => !existentes.has(e))) {
      next();
      return;
    }
  } catch {
    // Sin poder comparar contra la lista actual, se exige 2FA (fail-closed).
  }
  require2fa(req, res, next);
}

export async function listDigestDestinatariosHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const [destinatarios, cfg] = await Promise.all([listDestinatarios(), getConfig()]);
    res.json(
      ok(destinatarios, {
        // La UI muestra estos datos como contexto: horarios del resumen, buzón
        // de respaldo si la lista queda vacía, y si el worker está encendido.
        horarios_resumen: cfg.horas,
        umbral_horas: cfg.umbralHoras,
        zona_horaria: DIGEST_TZ,
        fallback_email: MONITOR_PRIMARY,
        worker_activo: WORKER_ENABLED,
        // Las alertas de seguridad las manda `auditAlerts`, que corre bajo el
        // worker de retención — otro switch. La pantalla necesita los dos
        // estados por separado: con healthDigest apagado y auditoría encendida,
        // un solo aviso "el worker está apagado" miente sobre la mitad de la tabla.
        worker_seguridad_activo: config.workers.auditAlerts,
        max_destinatarios: MAX_DESTINATARIOS,
      }),
    );
  } catch (err) {
    next(err);
  }
}

export async function replaceDigestDestinatariosHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = ReplaceBody.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Body inválido', { details: parsed.error.issues });
    }

    // Duplicados: la BD los colapsaría por PK (el último gana) y la UI mostraría
    // menos filas de las que envió. Mejor rechazar y decir cuál está repetido.
    const vistos = new Set<string>();
    const rows: DigestDestinatarioInput[] = [];
    for (const d of parsed.data.destinatarios) {
      const email = normalizeEmail(d.email);
      if (vistos.has(email)) {
        throw new ValidationError(`Destinatario duplicado: ${email}`);
      }
      vistos.add(email);
      rows.push({
        email,
        nombre: d.nombre ?? null,
        recibe_resumen: d.recibe_resumen,
        recibe_eventos: d.recibe_eventos ?? false,
        recibe_seguridad: d.recibe_seguridad,
        umbral_evento: d.umbral_evento ?? 't12',
        activo: d.activo,
      });
    }

    const saved = await replaceDestinatarios(rows, actorId(req));
    const sinResumen = saved.filter((d) => d.activo && d.recibe_resumen).length === 0;
    res.json(
      ok(saved, {
        // Aviso, no error: dejar la lista vacía es válido y hace que el worker
        // caiga al buzón de respaldo. La UI lo muestra como advertencia.
        fallback_en_uso: sinResumen,
        fallback_email: MONITOR_PRIMARY,
      }),
    );
  } catch (err) {
    next(err);
  }
}

/**
 * Guarda la programación del resumen. No pide 2FA: cambiar la hora a la que
 * llega un correo que ya reciben no saca datos hacia afuera, que es el criterio
 * que usa el PUT de destinatarios.
 */
export async function saveDigestConfigHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = ConfigBody.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Body inválido', { details: parsed.error.issues });
    }
    const cfg = await saveConfig(
      normalizarHoras(parsed.data.horas),
      normalizarUmbral(parsed.data.umbral_horas),
      actorId(req),
    );
    res.json(ok({ horarios_resumen: cfg.horas, umbral_horas: cfg.umbralHoras }));
  } catch (err) {
    next(err);
  }
}

/**
 * Envía el resumen con el snapshot REAL de este momento al correo indicado.
 * Sirve para verificar que un destinatario nuevo recibe (y que el correo no
 * cae en spam) sin esperar a las 07:00.
 */
export async function sendDigestPruebaHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = PruebaBody.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Body inválido', { details: parsed.error.issues });
    }
    const email = normalizeEmail(parsed.data.email);
    const cfg = await getConfig();
    const snap = await buildSnapshot(cfg.umbralHoras);
    await sendDigestTo(email, snap.data, snap.dga, cfg.umbralHoras);
    res.json(
      ok({
        email,
        incidencias_data: snap.data.length,
        incidencias_dga: snap.dga.length,
      }),
    );
  } catch (err) {
    next(err);
  }
}
