/**
 * Controllers HTTP v2 — modelo redesign 2026-05-17.
 *
 * Endpoints:
 *   - GET    /dga/informantes
 *   - POST   /dga/informantes
 *   - PATCH  /dga/informantes/:rut   (2FA si cambia clave)
 *   - DELETE /dga/informantes/:rut   (2FA)
 *   - GET    /dga/sites/:siteId/pozo-config
 *   - PATCH  /dga/sites/:siteId/pozo-config  (2FA si dga_transport='rest')
 *   - GET    /dga/sites/:siteId/live-preview
 *   - GET    /dga/dato                       (query mediciones por sitio)
 *   - GET    /dga/review-queue
 *   - POST   /dga/review-queue/action        (2FA)
 *   - GET    /dga/dato/export.csv
 *   - GET    /dga/export-directo.csv
 *   - POST   /dga/2fa/request
 */
import type { Request, Response, NextFunction } from 'express';
import { ok } from '../../shared/httpEnvelope';
import { UnauthorizedError, ValidationError } from '../../shared/errors';
import { elapsedMs, nowHrtime } from '../../shared/time';
import { z } from 'zod';
import {
  ListReviewQueueParams,
  PatchPozoDgaConfigPayload,
  QueryDatoDgaParams,
  ReviewSlotActionPayload,
  UpsertInformantePayload,
} from './schema';
import {
  applyReviewDecision,
  deleteInformanteService,
  getDatoDgaBySite,
  getDatoDgaDirectoFromEquipo,
  getDgaLivePreview,
  getInformantes,
  listReviewQueue,
  patchPozoDgaConfigService,
  toCsv,
  upsertInformanteService,
} from './service';
import { requestDgaCode } from './twofactor';
import type { AuthUser } from '../../shared/permissions';
import { getPozoDgaConfig } from './repo';

const ExportDirectoParams = z.object({
  site_id: z.string().trim().min(1).max(10),
  desde: z.string().datetime({ offset: true }),
  hasta: z.string().datetime({ offset: true }),
  bucket: z.enum(['minuto', 'hora', 'dia', 'semana', 'mes']).default('hora'),
});

// ============================================================================
// 2FA
// ============================================================================

export async function request2faCodeHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = nowHrtime();
  try {
    const user = (req as Request & { user?: AuthUser }).user;
    if (!user) throw new UnauthorizedError('No autenticado');
    await requestDgaCode(user);
    res.json(ok({ sent: true }, { durationMs: elapsedMs(startedAt) }));
  } catch (err) {
    next(err);
  }
}

// ============================================================================
// Informantes (pool global)
// ============================================================================

export async function listInformantesHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = nowHrtime();
  try {
    const rows = await getInformantes();
    res.json(ok(rows, { count: rows.length, durationMs: elapsedMs(startedAt) }));
  } catch (err) {
    next(err);
  }
}

export async function upsertInformanteHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = nowHrtime();
  try {
    const body = { ...req.body };
    if (req.params.rut) body.rut = req.params.rut;
    const parsed = UpsertInformantePayload.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('Payload inválido', { details: parsed.error.issues });
    }
    const result = await upsertInformanteService({
      rut: parsed.data.rut,
      ...(parsed.data.clave_informante !== undefined && {
        clave_informante: parsed.data.clave_informante,
      }),
      ...(parsed.data.referencia !== undefined && { referencia: parsed.data.referencia }),
    });
    res.status(req.method === 'POST' ? 201 : 200).json(
      ok(result, { durationMs: elapsedMs(startedAt) }),
    );
  } catch (err) {
    next(err);
  }
}

export async function deleteInformanteHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = nowHrtime();
  try {
    const rut = String(req.params.rut ?? '').trim();
    if (!rut) throw new ValidationError('rut requerido');
    await deleteInformanteService(rut);
    res.json(ok({ deleted: true }, { durationMs: elapsedMs(startedAt) }));
  } catch (err) {
    next(err);
  }
}

// ============================================================================
// Pozo DGA config (per pozo)
// ============================================================================

export async function getPozoDgaConfigHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = nowHrtime();
  try {
    const siteId = String(req.params.siteId ?? '').trim();
    if (!siteId) throw new ValidationError('siteId requerido');
    const row = await getPozoDgaConfig(siteId);
    res.json(ok(row, { durationMs: elapsedMs(startedAt) }));
  } catch (err) {
    next(err);
  }
}

export async function patchPozoDgaConfigHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = nowHrtime();
  try {
    const siteId = String(req.params.siteId ?? '').trim();
    if (!siteId) throw new ValidationError('siteId requerido');
    const parsed = PatchPozoDgaConfigPayload.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Payload inválido', { details: parsed.error.issues });
    }
    const result = await patchPozoDgaConfigService(siteId, parsed.data);
    res.json(ok(result, { durationMs: elapsedMs(startedAt) }));
  } catch (err) {
    next(err);
  }
}

export async function getDgaLivePreviewHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = nowHrtime();
  try {
    const siteId = String(req.params.siteId ?? '').trim();
    if (!siteId) throw new ValidationError('siteId requerido');
    const preview = await getDgaLivePreview(siteId);
    res.json(ok(preview, { durationMs: elapsedMs(startedAt) }));
  } catch (err) {
    next(err);
  }
}

// ============================================================================
// Review queue
// ============================================================================

export async function listReviewQueueHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = nowHrtime();
  try {
    const parsed = ListReviewQueueParams.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError('Parámetros inválidos', { details: parsed.error.issues });
    }
    const rows = await listReviewQueue(parsed.data);
    res.json(ok(rows, { count: rows.length, durationMs: elapsedMs(startedAt) }));
  } catch (err) {
    next(err);
  }
}

export async function reviewSlotActionHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = nowHrtime();
  try {
    const parsed = ReviewSlotActionPayload.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Payload inválido', { details: parsed.error.issues });
    }
    const result = await applyReviewDecision(parsed.data);
    res.json(ok(result, { durationMs: elapsedMs(startedAt) }));
  } catch (err) {
    next(err);
  }
}

// ============================================================================
// Mediciones por sitio
// ============================================================================

export async function queryDatoDgaHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = nowHrtime();
  try {
    const parsed = QueryDatoDgaParams.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError('Parámetros inválidos', { details: parsed.error.issues });
    }
    const rows = await getDatoDgaBySite(parsed.data.site_id, parsed.data.desde, parsed.data.hasta);
    res.json(ok(rows, { count: rows.length, durationMs: elapsedMs(startedAt) }));
  } catch (err) {
    next(err);
  }
}

export async function exportDgaDirectoCsvHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = ExportDirectoParams.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError('Parámetros inválidos', { details: parsed.error.issues });
    }
    const rows = await getDatoDgaDirectoFromEquipo(
      parsed.data.site_id,
      parsed.data.desde,
      parsed.data.hasta,
      parsed.data.bucket,
    );
    const csv = toCsv(rows);
    const filename = `dga_${parsed.data.site_id}_${parsed.data.desde.slice(0, 10)}_${parsed.data.hasta.slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('﻿' + csv);
  } catch (err) {
    next(err);
  }
}

export async function exportDatoDgaCsvHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = QueryDatoDgaParams.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError('Parámetros inválidos', { details: parsed.error.issues });
    }
    const rows = await getDatoDgaBySite(parsed.data.site_id, parsed.data.desde, parsed.data.hasta);
    const csv = toCsv(rows);
    const filename = `dga_${parsed.data.site_id}_${parsed.data.desde.slice(0, 10)}_${parsed.data.hasta.slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('﻿' + csv);
  } catch (err) {
    next(err);
  }
}
