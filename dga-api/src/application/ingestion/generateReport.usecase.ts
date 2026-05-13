import { buildEmptyReport } from '../../domain/reports/report.entity';
import type { DgaReport } from '../../domain/reports/report.types';
import { calcularNivelFreatico, calcularTotalizador, m3hToLps } from '../../domain/transforms';
import * as equipoRepo from '../../infrastructure/db/equipo.repo';
import * as reportsRepo from '../../infrastructure/db/reports.repo';
import { getPozoConfig, getRegMapsBySite, getSiteById, type RegMapRow } from '../../infrastructure/db/sites.repo';
import { NotFoundError } from '../../shared/errors';
import { logger } from '../../shared/logger';

function firstByRole(maps: RegMapRow[], role: string): RegMapRow | undefined {
  return maps.find((m) => m.rolDashboard === role);
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function generateReport(sitioId: string, timestamp: Date): Promise<DgaReport> {
  const site = await getSiteById(sitioId);
  if (!site) throw new NotFoundError(`sitio ${sitioId}`);

  const report = buildEmptyReport(sitioId, timestamp);

  const latest = await equipoRepo.getLatestBefore(site.idSerial, timestamp);
  if (!latest) {
    logger.warn({ sitioId, idSerial: site.idSerial }, '[ingestion] sin telemetría reciente');
    await reportsRepo.insertReport(report);
    return report;
  }

  const maps = await getRegMapsBySite(sitioId);
  const pozoConfig = await getPozoConfig(sitioId);

  const caudalMap = firstByRole(maps, 'caudal');
  if (caudalMap) {
    const raw = toNumber(latest.data[caudalMap.d1]);
    if (raw != null) {
      try {
        report.caudal = m3hToLps(raw);
      } catch (err) {
        logger.warn({ err, sitioId }, '[ingestion] falló cálculo caudal');
      }
    }
  }

  const nivelMap = firstByRole(maps, 'nivel') ?? firstByRole(maps, 'nivel_freatico');
  if (nivelMap && pozoConfig?.profundidadPozoM != null) {
    const lectura = toNumber(latest.data[nivelMap.d1]);
    if (lectura != null) {
      try {
        report.nivelFreatico = calcularNivelFreatico({
          lecturaPozo: lectura,
          profundidadSensor: pozoConfig.profundidadSensorM,
          profundidadTotal: pozoConfig.profundidadPozoM,
        });
      } catch (err) {
        logger.warn({ err, sitioId }, '[ingestion] falló cálculo nivel freático');
      }
    }
  }

  const totalizadorMap = firstByRole(maps, 'totalizador');
  if (totalizadorMap?.d2) {
    const d1 = toNumber(latest.data[totalizadorMap.d1]);
    const d2 = toNumber(latest.data[totalizadorMap.d2]);
    if (d1 != null && d2 != null) {
      try {
        const params = totalizadorMap.parametros as { word_swap?: boolean; wordSwap?: boolean };
        report.totalizado = calcularTotalizador({
          d1,
          d2,
          wordSwap: Boolean(params.word_swap ?? params.wordSwap),
        });
      } catch (err) {
        logger.warn({ err, sitioId }, '[ingestion] falló cálculo totalizador');
      }
    }
  }

  await reportsRepo.insertReport(report);
  return report;
}
