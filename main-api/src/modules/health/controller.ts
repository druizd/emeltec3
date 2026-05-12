/**
 * Healthchecks: liveness (proceso vivo) y readiness (DB + Redis OK).
 */
import type { Request, Response } from 'express';
import { query } from '../../config/dbHelpers';
import { cache } from '../../config/redis';
import { registry } from '../../config/metrics';
import { config } from '../../config/appConfig';

export function liveness(_req: Request, res: Response): void {
  res.json({ ok: true, status: 'alive', timestamp: new Date().toISOString() });
}

export async function readiness(_req: Request, res: Response): Promise<void> {
  const checks: Record<string, { ok: boolean; error?: string }> = {};

  try {
    await query(`SELECT 1`, [], { name: 'health__readiness_db' });
    checks.db = { ok: true };
  } catch (err) {
    checks.db = { ok: false, error: (err as Error).message };
  }

  if (cache.enabled) {
    try {
      await cache.set('health:probe', '1', 5);
      checks.redis = { ok: true };
    } catch (err) {
      checks.redis = { ok: false, error: (err as Error).message };
    }
  } else {
    checks.redis = { ok: true, error: 'disabled' };
  }

  const allOk = Object.values(checks).every((c) => c.ok);
  res.status(allOk ? 200 : 503).json({ ok: allOk, checks });
}

export async function prometheusMetrics(req: Request, res: Response): Promise<void> {
  // Protección con INTERNAL_API_KEY si está configurada.
  const internalKey = config.auth.internalApiKey;
  if (internalKey) {
    const header = req.header('x-internal-api-key');
    if (header !== internalKey) {
      res.status(401).json({ ok: false, error: 'INTERNAL_API_KEY requerida' });
      return;
    }
  }
  res.setHeader('Content-Type', registry.contentType);
  res.end(await registry.metrics());
}
