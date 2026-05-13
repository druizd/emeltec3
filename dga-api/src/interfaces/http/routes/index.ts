import { Router } from 'express';
import { healthRouter } from './health.routes';
import { reportsRouter } from './reports.routes';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/', reportsRouter);
