/**
 * Worker DGA → Google Cloud Storage (solicitado por CCU_Central, genérico).
 *
 * Cada `batchMinutes`:
 *   1. Trae envíos DGA con RESPUESTA de SNIA (dga_status_code IS NOT NULL),
 *      de sitios con pozo_config.dga_gcs_export=TRUE, aún no exportados.
 *      → enviados ('00') Y rechazados (otro código). Nunca los sin respuesta.
 *   2. Agrupa por sitio; por sitio genera UN Parquet (3 filas por medición).
 *   3. Sube a GCS; SOLO si la subida fue OK, registra cada audit en
 *      dga_gcs_export_log (idempotencia + auditoría para CCU).
 *
 * La subida ocurre antes del log: si el proceso muere entre subir y registrar,
 * el próximo ciclo re-sube (idempotente por path determinístico + ON CONFLICT
 * en el log). Nunca se marca exportado algo que no subió.
 */
import { logger } from '../../config/logger';
import { beat } from '../../config/heartbeat';
import { config } from '../../config/appConfig';
import {
  buildParquetRows,
  buildParquetBuffer,
  sanitizeName,
  type ExportableSend,
} from './gcs-parquet-builder';
import { listExportableSends, insertGcsExportLog, type GcsExportLogInput } from './gcs-repo';
import { uploadBufferToGcs, type GcsUploadResult } from './gcs-client';

const MAX_PER_CYCLE = Number(process.env.DGA_GCS_MAX_PER_CYCLE ?? 500);

let intervalHandle: NodeJS.Timeout | null = null;

export interface CycleDeps {
  now: () => Date;
  bucket: string;
  proveedor: string;
  maxPerCycle: number;
  listExportableSends: (limit: number) => Promise<ExportableSend[]>;
  uploadParquet: (path: string, buf: Buffer) => Promise<GcsUploadResult>;
  insertGcsExportLog: (input: GcsExportLogInput) => Promise<void>;
}

export interface CycleStats {
  sites: number;
  sends: number;
  uploaded: number;
  logged: number;
  failedSites: number;
  skipped: boolean;
}

/** `YYYYMMDDHHmmss` en UTC (determinístico). */
function timestampCompact(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  );
}

/**
 * Path destino según spec CCU_Central:
 *   `{nombre_planta}/fecha_carga=YYYY-MM-DD/{nombre_sensor}_{yyyymmddhhmmss}.parquet`
 * La carpeta concuerda con la columna PLANTA y el archivo con NOMBRE_SENSOR.
 * Determinístico por (planta, sensor, instante) → re-ejecución sobreescribe.
 */
export function buildGcsPath(planta: string, nombreSensor: string, now: Date): string {
  const fechaCarga = now.toISOString().slice(0, 10); // YYYY-MM-DD (UTC), sin comillas
  // sanitizeName (no slug): carpeta/archivo deben ser byte-idénticos a las
  // columnas PLANTA / NOMBRE_SENSOR del Parquet (requisito de CCU).
  return `${sanitizeName(planta)}/fecha_carga=${fechaCarga}/${sanitizeName(nombreSensor)}_${timestampCompact(now)}.parquet`;
}

function groupBySite(sends: ExportableSend[]): Map<string, ExportableSend[]> {
  const map = new Map<string, ExportableSend[]>();
  for (const s of sends) {
    const arr = map.get(s.site_id) ?? [];
    arr.push(s);
    map.set(s.site_id, arr);
  }
  return map;
}

function resolveDeps(over?: Partial<CycleDeps>): CycleDeps {
  return {
    now: over?.now ?? ((): Date => new Date()),
    bucket: over?.bucket ?? config.dga.gcs.bucket ?? '',
    proveedor: over?.proveedor ?? config.dga.gcs.proveedor,
    maxPerCycle: over?.maxPerCycle ?? MAX_PER_CYCLE,
    listExportableSends: over?.listExportableSends ?? listExportableSends,
    uploadParquet:
      over?.uploadParquet ??
      ((path, buf): Promise<GcsUploadResult> =>
        uploadBufferToGcs(config.dga.gcs.bucket ?? '', path, buf)),
    insertGcsExportLog: over?.insertGcsExportLog ?? insertGcsExportLog,
  };
}

export async function runGcsExportCycle(over?: Partial<CycleDeps>): Promise<CycleStats> {
  beat('dgaGcsExport');
  const deps = resolveDeps(over);

  const stats: CycleStats = {
    sites: 0,
    sends: 0,
    uploaded: 0,
    logged: 0,
    failedSites: 0,
    skipped: false,
  };

  if (!deps.bucket) {
    logger.warn('DGA GCS: sin DGA_GCS_BUCKET configurado — ciclo omitido');
    stats.skipped = true;
    return stats;
  }

  let sends: ExportableSend[];
  try {
    sends = await deps.listExportableSends(deps.maxPerCycle);
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'DGA GCS: lectura de envíos falló');
    return stats;
  }

  if (sends.length === 0) return stats;

  const now = deps.now();
  const fechaHoraCarga = now.toISOString();
  const bySite = groupBySite(sends);
  stats.sites = bySite.size;
  stats.sends = sends.length;

  for (const [siteId, siteSends] of bySite.entries()) {
    const { planta, nombre_sensor } = siteSends[0]!;
    const path = buildGcsPath(planta, nombre_sensor, now);

    try {
      const rows = siteSends.flatMap((s) =>
        buildParquetRows(s, { proveedor: deps.proveedor, fechaHoraCarga }),
      );
      const buf = await buildParquetBuffer(rows);
      const meta = await deps.uploadParquet(path, buf);
      stats.uploaded++;

      // Log SOLO tras subida OK. Una fila por audit (dedup por audit_id).
      // Guarda el acuse de GCS (generation + md5) como prueba de entrega.
      for (const s of siteSends) {
        await deps.insertGcsExportLog({
          audit_id: s.audit_id,
          site_id: s.site_id,
          ts: s.ts,
          dga_status_code: s.dga_status_code,
          comprobante: s.comprobante,
          gcs_bucket: deps.bucket,
          gcs_path: path,
          row_count: 3, // CAUDAL + TOTALIZADOR + NIVEL_FREATICO
          gcs_generation: meta.generation,
          gcs_md5: meta.md5,
        });
        stats.logged++;
      }
    } catch (err) {
      stats.failedSites++;
      logger.error(
        { site_id: siteId, path, err: (err as Error).message },
        'DGA GCS: fallo al exportar sitio — se reintenta próximo ciclo',
      );
    }
  }

  logger.info(
    {
      sites: stats.sites,
      sends: stats.sends,
      uploaded: stats.uploaded,
      logged: stats.logged,
      failed_sites: stats.failedSites,
    },
    'DGA GCS: ciclo completo',
  );
  return stats;
}

export function startDgaGcsExporterWorker(): void {
  if (intervalHandle) return;
  if (!config.dga.gcs.enabled) {
    logger.info('DGA GCS exporter deshabilitado (ENABLE_DGA_GCS_WORKER=false)');
    return;
  }
  const intervalMs = config.dga.gcs.batchMinutes * 60 * 1000;
  logger.info({ intervalMs, bucket: config.dga.gcs.bucket }, 'DGA GCS exporter iniciado');
  void runGcsExportCycle();
  intervalHandle = setInterval(() => {
    void runGcsExportCycle();
  }, intervalMs);
  intervalHandle.unref?.();
}

export function stopDgaGcsExporterWorker(): void {
  if (!intervalHandle) return;
  clearInterval(intervalHandle);
  intervalHandle = null;
  logger.info('DGA GCS exporter detenido');
}
