// Caso de uso "generar reporte DGA" para un sitio en un instante dado.
// Pipeline:
//  1. Resuelve la identidad del sitio (con id_serial del equipo).
//  2. Toma la última telemetría recibida en o antes de `timestamp`.
//  3. Lee los reg_map y la config del pozo.
//  4. Por cada rol (caudal/nivel/totalizador) aplica su transformación pura.
//  5. Persiste el reporte (incluso si todas las métricas son null → marca dato faltante).
//
// Compatibilidad:
//  - Pozos antiguos: si solo existe rol `nivel`, se mantiene el cálculo histórico
//    nivel_freatico = profundidad_sensor_o_pozo - lectura_nivel.
//  - Pozos nuevos: si existe rol `nivel_freatico`, se usa ese valor final y no se
//    vuelve a calcular.
//  - Totalizador antiguo de dos registros sigue usando `uint32_registros`.
//  - Totalizador nuevo directo se acepta cuando el mapping viene como `directo`.
import { buildEmptyReport } from '../../domain/reports/report.entity';
import type { DgaReport } from '../../domain/reports/report.types';
import {
  calcularNivelFreatico,
  calcularTotalizador,
  m3hToLps,
  parseIEEE754,
  registrosModbusAFloat32,
} from '../../domain/transforms';
import type { ByteOrder, NumericFormat } from '../../domain/transforms';
import * as equipoRepo from '../../infrastructure/db/equipo.repo';
import * as reportsRepo from '../../infrastructure/db/reports.repo';
import {
  getPozoConfig,
  getRegMapsBySite,
  getSiteById,
  type RegMapRow,
} from '../../infrastructure/db/sites.repo';
import { NotFoundError } from '../../shared/errors';
import { logger } from '../../shared/logger';

type PozoConfigForDga = Awaited<ReturnType<typeof getPozoConfig>>;

// Encuentra el primer reg_map cuyo rol coincida (caudal, nivel, totalizador, nivel_freatico).
function firstByRole(maps: RegMapRow[], role: string): RegMapRow | undefined {
  return maps.find((m) => m.rolDashboard === role);
}

// Normaliza aliases históricos de transformacion guardados en reg_map.
function normalizeTransform(value: unknown): string {
  const raw = String(value ?? 'directo')
    .trim()
    .toLowerCase();
  if (raw === 'escala_lineal') return 'lineal';
  if (raw === 'ieee754') return 'ieee754_32';
  if (raw === 'caudal') return 'caudal_m3h_lps';
  if (raw === 'uint32') return 'uint32_registros';
  return raw;
}

// Coerción segura a number; devuelve null si no es finito.
function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function requireNumber(v: unknown, label: string): number {
  const n = toNumber(v);
  if (n === null) throw new Error(`${label} debe ser numerico`);
  return n;
}

function boolParam(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'si', 'yes'].includes(String(value).trim().toLowerCase());
}

function rawValue(data: Record<string, unknown>, key: string | null | undefined): unknown {
  if (!key) return undefined;
  return data[key];
}

function applyLinear(raw: unknown, params: Record<string, unknown>): number {
  const base = requireNumber(raw, 'valor');
  const factor = toNumber(params.factor) ?? 1;
  const offset = toNumber(params.offset) ?? 0;
  return base * factor + offset;
}

// Aplica la transformación física configurada en reg_map.
// Esta función es el punto de compatibilidad: los equipos antiguos siguen usando
// transformaciones derivadas (nivel_freatico, caudal_m3h_lps, uint32_registros)
// y los equipos nuevos pueden usar `directo` cuando ya transmiten el valor final.
export function applyRegMapTransformForDga({
  data,
  map,
  pozoConfig,
}: {
  data: Record<string, unknown>;
  map: RegMapRow;
  pozoConfig: PozoConfigForDga;
}): number | null {
  const params = map.parametros ?? {};
  const transform = normalizeTransform(map.transformacion);
  const d1 = rawValue(data, map.d1);

  switch (transform) {
    case 'directo':
      return toNumber(d1);

    case 'lineal':
      return applyLinear(d1, params);

    case 'lineal_int16': {
      const raw = requireNumber(d1, map.d1);
      const signed = raw > 32767 ? raw - 65536 : raw;
      return applyLinear(signed, params);
    }

    case 'ieee754_32': {
      if (map.d2) {
        const high = requireNumber(d1, map.d1);
        const low = requireNumber(rawValue(data, map.d2), map.d2);
        const wordSwap = boolParam(params.word_swap ?? params.wordSwap, false);
        return registrosModbusAFloat32(high, low, wordSwap).valor;
      }

      if (d1 === undefined || d1 === null) return null;
      return parseIEEE754(d1, {
        formato: ((params.formato as string | undefined) ?? 'float32') as NumericFormat,
        byteOrder: ((params.byteOrder as string | undefined) ??
          (params.word_order as string | undefined) ??
          'BE') as ByteOrder,
      });
    }

    case 'uint32_registros': {
      if (!map.d2) return null;
      const d1Number = requireNumber(d1, map.d1);
      const d2Number = requireNumber(rawValue(data, map.d2), map.d2);
      const wordSwap = boolParam(params.word_swap ?? params.wordSwap, false);
      const offset = toNumber(params.offset) ?? 0;
      return calcularTotalizador({ d1: d1Number, d2: d2Number, wordSwap }) + offset;
    }

    case 'caudal_m3h_lps':
      return m3hToLps(applyLinear(d1, params));

    case 'nivel_freatico': {
      if (pozoConfig?.profundidadPozoM == null) return null;
      return calcularNivelFreatico({
        lecturaPozo: applyLinear(d1, params),
        profundidadSensor: pozoConfig.profundidadSensorM,
        profundidadTotal: pozoConfig.profundidadPozoM,
      });
    }

    default:
      throw new Error(`transformacion no soportada: ${map.transformacion}`);
  }
}

export async function generateReport(sitioId: string, timestamp: Date): Promise<DgaReport> {
  const site = await getSiteById(sitioId);
  if (!site) throw new NotFoundError(`sitio ${sitioId}`);

  // Snap a la hora exacta (XX:00:00 UTC) para que DGA siempre reciba tiempos limpios.
  const snapped = new Date(timestamp);
  snapped.setUTCMinutes(0, 0, 0);

  const report = buildEmptyReport(sitioId, snapped);

  // Toma la telemetría más cercana (anterior o igual a `timestamp`).
  const latest = await equipoRepo.getLatestBefore(site.idSerial, timestamp);
  if (!latest) {
    // Sin telemetría → persistir reporte con nulls para dejar constancia del dato faltante.
    logger.warn({ sitioId, idSerial: site.idSerial }, '[ingestion] sin telemetría reciente');
    await reportsRepo.insertReport(report);
    return report;
  }

  const maps = await getRegMapsBySite(sitioId);
  const pozoConfig = await getPozoConfig(sitioId);

  // Caudal:
  //  - Antiguo: `caudal_m3h_lps` mantiene conversión m³/h → L/s.
  //  - Nuevo: `directo` acepta equipos que ya transmiten L/s.
  const caudalMap = firstByRole(maps, 'caudal');
  if (caudalMap) {
    try {
      report.caudal = applyRegMapTransformForDga({
        data: latest.data,
        map: caudalMap,
        pozoConfig,
      });
    } catch (err) {
      logger.warn({ err, sitioId }, '[ingestion] falló cálculo caudal');
    }
  }

  // Nivel freático:
  //  - Si viene rol `nivel_freatico`, ya es valor final medido desde superficie.
  //  - Si no viene, se deriva desde rol `nivel` + geometría del pozo como antes.
  const nivelFreaticoMap = firstByRole(maps, 'nivel_freatico');
  if (nivelFreaticoMap) {
    try {
      report.nivelFreatico = applyRegMapTransformForDga({
        data: latest.data,
        map: nivelFreaticoMap,
        pozoConfig,
      });
    } catch (err) {
      logger.warn({ err, sitioId }, '[ingestion] falló lectura nivel freático directo');
    }
  } else {
    const nivelMap = firstByRole(maps, 'nivel');
    if (nivelMap && pozoConfig?.profundidadPozoM != null) {
      try {
        const lectura = applyRegMapTransformForDga({
          data: latest.data,
          map: nivelMap,
          pozoConfig,
        });
        if (lectura != null) {
          report.nivelFreatico =
            normalizeTransform(nivelMap.transformacion) === 'nivel_freatico'
              ? lectura
              : calcularNivelFreatico({
                  lecturaPozo: lectura,
                  profundidadSensor: pozoConfig.profundidadSensorM,
                  profundidadTotal: pozoConfig.profundidadPozoM,
                });
        }
      } catch (err) {
        logger.warn({ err, sitioId }, '[ingestion] falló cálculo nivel freático');
      }
    }
  }

  // Totalizador:
  //  - Antiguo: si existe d2, combina dos registros Modbus como antes.
  //  - Nuevo: `directo` acepta totalizador ya final en m³.
  const totalizadorMap = firstByRole(maps, 'totalizador');
  if (totalizadorMap) {
    try {
      if (totalizadorMap.d2 && normalizeTransform(totalizadorMap.transformacion) === 'directo') {
        const d1 = toNumber(latest.data[totalizadorMap.d1]);
        const d2 = toNumber(latest.data[totalizadorMap.d2]);
        if (d1 != null && d2 != null) {
          const params = totalizadorMap.parametros as { word_swap?: boolean; wordSwap?: boolean };
          report.totalizado = calcularTotalizador({
            d1,
            d2,
            wordSwap: Boolean(params.word_swap ?? params.wordSwap),
          });
        }
      } else {
        report.totalizado = applyRegMapTransformForDga({
          data: latest.data,
          map: totalizadorMap,
          pozoConfig,
        });
      }
    } catch (err) {
      logger.warn({ err, sitioId }, '[ingestion] falló cálculo totalizador');
    }
  }

  await reportsRepo.insertReport(report);
  return report;
}
