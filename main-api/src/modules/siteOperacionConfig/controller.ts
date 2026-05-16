/**
 * Controllers HTTP de siteOperacionConfig: GET para leer la config de un sitio
 * (devuelve defaults si no existe fila) y PUT para hacer upsert.
 */
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ok } from '../../shared/httpEnvelope';
import { ValidationError } from '../../shared/errors';
import { findSiteOperacionConfig, upsertSiteOperacionConfig } from './repo';
import { DEFAULT_CONFIG, type SiteOperacionConfig } from './types';

const HHMM = z.string().regex(/^\d{2}:\d{2}$/, 'formato HH:MM esperado');
const TurnoSchema = z.object({
  nombre: z.string().min(1).max(40),
  inicio: HHMM,
  fin: HHMM,
});

const UpdateBody = z.object({
  num_turnos: z.union([z.literal(2), z.literal(3)]),
  turnos: z.array(TurnoSchema).min(2).max(3),
  jornada_inicio: HHMM,
  jornada_fin: HHMM,
});

function defaultConfig(sitioId: string): SiteOperacionConfig {
  return {
    sitio_id: sitioId,
    num_turnos: DEFAULT_CONFIG.num_turnos,
    turnos: DEFAULT_CONFIG.turnos,
    jornada_inicio: DEFAULT_CONFIG.jornada_inicio,
    jornada_fin: DEFAULT_CONFIG.jornada_fin,
    updated_at: new Date().toISOString(),
  };
}

export async function getSiteOperacionConfigHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const siteId = String(req.params.siteId ?? '').trim();
    if (!siteId) throw new ValidationError('siteId requerido');
    const existing = await findSiteOperacionConfig(siteId);
    res.json(ok(existing ?? defaultConfig(siteId)));
  } catch (err) {
    next(err);
  }
}

export async function updateSiteOperacionConfigHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const siteId = String(req.params.siteId ?? '').trim();
    if (!siteId) throw new ValidationError('siteId requerido');
    const parsed = UpdateBody.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Body invalido', { details: parsed.error.issues });
    }
    const saved = await upsertSiteOperacionConfig({
      sitio_id: siteId,
      ...parsed.data,
    });
    res.json(ok(saved));
  } catch (err) {
    next(err);
  }
}
