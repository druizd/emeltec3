// Endpoints de salud para orquestadores (k8s, docker swarm, balanceador).
//  - GET /live  → liveness: el proceso responde (no chequea dependencias).
//  - GET /ready → readiness: además chequea que la DB responda; si no, 503.
import { Router } from 'express';
import { pingDb } from '../../../infrastructure/db/pool';
import { ok } from '../../../shared/envelope';

export const healthRouter = Router();

healthRouter.get('/live', (_req, res) => {
  res.json(ok({ status: 'live' }));
});

healthRouter.get('/ready', async (_req, res) => {
  const dbOk = await pingDb();
  if (!dbOk) {
    res.status(503).json({ ok: false, error: { code: 'DB_UNAVAILABLE', message: 'DB no responde' } });
    return;
  }
  res.json(ok({ status: 'ready', checks: { db: 'ok' } }));
});
