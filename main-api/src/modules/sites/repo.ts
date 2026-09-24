/**
 * Repositorio del módulo sites: sitio, pozo_config, reg_map + last/history equipo.
 */
import { query } from '../../config/dbHelpers';
import { cache } from '../../config/redis';
import type { HistoryEquipoRow, LatestEquipoRow, PozoConfig, RegMap, Site } from './types';

const HISTORY_TTL_S = 60;
const HISTORY_RANGE_TTL_S = 300;

/**
 * Ventana temporal para la consulta acotada de `getDashboardHistory` contra
 * `equipo_1min`.
 *
 * Medido en produccion el 24-09-2026 con EXPLAIN (ANALYZE, BUFFERS): sin cota
 * sobre `bucket`, TimescaleDB no puede excluir chunks al planificar (el
 * hypertable/cagg tiene ~140 chunks, cada uno comprimido con su propio
 * ColumnarScan) y el planning time se dispara a ~8,8s aunque la consulta se
 * ejecute en ~130ms — el LIMIT descarta casi todos los chunks recien despues
 * de que el planificador ya los miro todos. Eso fue lo que tumbo la
 * plataforma: 80 consultas asi por barrido del cacheWarmer saturaban la CPU
 * planificando, no leyendo. 30 dias cubre a cualquier sitio que este
 * transmitiendo (2.200 muestras a ~1/min son apenas ~37 horas) y deja fuera
 * del plan a los chunks historicos. NO borrar este filtro pensando que sobra.
 */
const HISTORY_WINDOW_DAYS = 30;

const SITE_COLUMNS =
  'id, descripcion, empresa_id, sub_empresa_id, id_serial, ubicacion, coord_norte, coord_este, huso, tipo_sitio, activo, es_maleta_piloto';
const MAP_COLUMNS =
  'id, alias, d1, d2, tipo_dato, unidad, rol_dashboard, transformacion, parametros, sitio_id, vigente_desde, vigente_hasta, created_at, updated_at';
const POZO_CONFIG_COLUMNS =
  'sitio_id, profundidad_pozo_m, profundidad_sensor_m, nivel_estatico_manual_m, obra_dga, slug, created_at, updated_at';

export async function getSiteById(id: string): Promise<Site | null> {
  const result = await query<Site>(`SELECT ${SITE_COLUMNS} FROM sitio WHERE id = $1`, [id], {
    name: 'sites__by_id',
  });
  return result.rows[0] ?? null;
}

export async function getPozoConfigBySiteId(siteId: string): Promise<PozoConfig | null> {
  const result = await query<PozoConfig>(
    `SELECT ${POZO_CONFIG_COLUMNS} FROM pozo_config WHERE sitio_id = $1`,
    [siteId],
    { name: 'sites__pozo_config_by_site' },
  );
  return result.rows[0] ?? null;
}

export async function getMappingsBySiteId(siteId: string): Promise<RegMap[]> {
  const result = await query<RegMap>(
    `SELECT ${MAP_COLUMNS} FROM reg_map WHERE sitio_id = $1 ORDER BY alias ASC`,
    [siteId],
    { name: 'sites__mappings_by_site' },
  );
  return result.rows;
}

export async function listPozosActivos(): Promise<Site[]> {
  const result = await query<Site>(
    `SELECT ${SITE_COLUMNS} FROM sitio WHERE tipo_sitio = 'pozo' AND activo = TRUE ORDER BY id ASC`,
    [],
    { name: 'sites__list_pozos_activos' },
  );
  return result.rows;
}

const LATEST_EQUIPO_COLUMNS = 'time, received_at, id_serial, data';

/**
 * Ultima lectura cruda del equipo, en dos pasos acotados.
 *
 * Sin cota de `time`, TimescaleDB abre TODOS los chunks del hypertable (1 dia
 * c/u, comprimidos despues de 7 dias) antes de devolver la fila: ~2s en reposo
 * y por encima de los 10s de statement_timeout con la DB cargada. La ventana
 * de 7 dias cubre a cualquier equipo que este reportando y toca solo chunks
 * sin comprimir; si lleva mas tiempo mudo, el cagg `equipo_daily` nos da el
 * ultimo dia con datos y leemos ese unico chunk. Mismo criterio que
 * `attachLastSeenToSites` (incidente 2026-07-16) y que `loadLatestEquipoSample`
 * del controller legacy.
 */
export async function getLatestEquipoForSerial(serialId: string): Promise<LatestEquipoRow | null> {
  const recent = await query<LatestEquipoRow>(
    `SELECT ${LATEST_EQUIPO_COLUMNS}
       FROM equipo
      WHERE id_serial = $1
        AND time >= NOW() - INTERVAL '7 days'
      ORDER BY time DESC
      LIMIT 1`,
    [serialId],
    { name: 'sites__latest_equipo_recent' },
  );
  if (recent.rows[0]) return recent.rows[0];

  const lastBucket = await query<{ bucket: string | Date }>(
    `SELECT bucket
       FROM equipo_daily
      WHERE id_serial = $1
      ORDER BY bucket DESC
      LIMIT 1`,
    [serialId],
    { name: 'sites__latest_equipo_bucket' },
  );
  const bucket = lastBucket.rows[0]?.bucket;
  if (!bucket) return null;

  const fallback = await query<LatestEquipoRow>(
    `SELECT ${LATEST_EQUIPO_COLUMNS}
       FROM equipo
      WHERE id_serial = $1
        AND time >= $2
        AND time <  $2 + INTERVAL '1 day'
      ORDER BY time DESC
      LIMIT 1`,
    [serialId, bucket],
    { name: 'sites__latest_equipo_fallback' },
  );
  return fallback.rows[0] ?? null;
}

export async function getDashboardHistory(
  serialId: string,
  limit: number,
  { forceRefresh = false } = {},
): Promise<HistoryEquipoRow[]> {
  const cacheKey = `sites:history:${serialId}:${limit}`;
  if (cache.enabled && !forceRefresh) {
    const cached = await cache.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as HistoryEquipoRow[];
      } catch {
        /* ignore */
      }
    }
  }

  const bounded = await query<HistoryEquipoRow>(
    `
    SELECT bucket AS time, received_at, id_serial, data
    FROM equipo_1min
    WHERE id_serial = $1
      AND bucket >= NOW() - INTERVAL '${HISTORY_WINDOW_DAYS} days'
    ORDER BY bucket DESC
    LIMIT $2
    `,
    [serialId, limit],
    { label: 'sites__dashboard_history' },
  );

  // Sitio mudo hace semanas (ej. S151, sin datos desde el 14-09): la ventana
  // acotada no trae nada y el dashboard no puede quedar vacio. El plan lento
  // se paga UNA vez -y solo para este sitio muerto-, nunca en el camino
  // rapido del sitio que si esta transmitiendo. El TTL de la cache evita
  // repetir el fallback en cada barrido del cacheWarmer.
  const result =
    bounded.rows.length > 0
      ? bounded
      : await query<HistoryEquipoRow>(
          `
    SELECT bucket AS time, received_at, id_serial, data
    FROM equipo_1min
    WHERE id_serial = $1
    ORDER BY bucket DESC
    LIMIT $2
    `,
          [serialId, limit],
          { label: 'sites__dashboard_history_unbounded' },
        );

  if (cache.enabled) {
    await cache.set(cacheKey, JSON.stringify(result.rows), HISTORY_TTL_S);
  }
  return result.rows;
}

export async function getDashboardHistoryRange(
  serialId: string,
  fromUtc: string,
  toUtc: string,
): Promise<HistoryEquipoRow[]> {
  const cacheKey = `sites:history:range:${serialId}:${fromUtc}:${toUtc}`;
  if (cache.enabled) {
    const cached = await cache.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as HistoryEquipoRow[];
      } catch {
        /* ignore */
      }
    }
  }

  const result = await query<HistoryEquipoRow>(
    `
    SELECT bucket AS time, received_at, id_serial, data
    FROM equipo_1min
    WHERE id_serial = $1
      AND bucket >= $2::timestamptz
      AND bucket <  $3::timestamptz
    ORDER BY bucket DESC
    `,
    [serialId, fromUtc, toUtc],
    { label: 'sites__dashboard_history_range' },
  );

  if (cache.enabled) {
    await cache.set(cacheKey, JSON.stringify(result.rows), HISTORY_RANGE_TTL_S);
  }
  return result.rows;
}

export async function getDashboardBucketExact(
  serialId: string,
  bucketUtc: string,
): Promise<HistoryEquipoRow | null> {
  const result = await query<HistoryEquipoRow>(
    `
    SELECT bucket AS time, received_at, id_serial, data
    FROM equipo_1min
    WHERE id_serial = $1
      AND bucket = $2::timestamptz
    LIMIT 1
    `,
    [serialId, bucketUtc],
    { label: 'sites__dashboard_bucket_exact' },
  );
  return result.rows[0] ?? null;
}
