// Router raíz de la API DGA. Se monta en `/api/dga` desde `server.ts`.
// Agrupa los sub-routers por área funcional.
import { Router } from 'express';
import { healthRouter } from './health.routes';
import { reportsRouter } from './reports.routes';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/', reportsRouter);
