/**
 * Repositorio Análisis: salud + métricas del sitio. Lee `equipo`,
 * `reg_map`, `dato_dga` para producir KPIs agregados.
 */
import { query } from '../../config/dbHelpers';

// ============================================================================
// Salud
// ============================================================================

export interface SensorEstadoRow {
  reg_map_id: string;
  alias: string;
  rol_dashboard: string | null;
  unidad: string | null;
  raw_value: unknown;
  /** Segundos desde la última lectura del registro. */
  edad_seg: number | null;
}

export interface GapRow {
  desde: string;
  hasta: string;
  /** Minutos. */
  duracion_min: number;
}

export interface SaludData {
  /** ISO UTC de la última lectura del equipo (cualquier registro). */
  ultimo_heartbeat: string | null;
  edad_heartbeat_seg: number | null;
  sensores: SensorEstadoRow[];
  /** Gaps >= MIN_GAP_MIN en los últimos GAP_WINDOW_DAYS. */
  gaps: GapRow[];
}

const MIN_GAP_MIN = 60;
const GAP_WINDOW_DAYS = 30;

/**
 * Calcula salud del sitio en una sola pasada:
 *   - Último heartbeat = MAX(equipo.time) por id_serial.
 *   - Sensores = último valor de cada reg_map (d1 leído de equipo.data).
 *   - Gaps = ventanas sin telemetría >= 1h en últimos 30 días.
 */
export async function getSalud(siteId: string): Promise<SaludData> {
  // 1. id_serial del sitio
  const siteRes = await query<{ id_serial: string | null }>(
    `SELECT id_serial FROM sitio WHERE id = $1`,
    [siteId],
    { name: 'analisis__site_serial' },
  );
  const idSerial = siteRes.rows[0]?.id_serial ?? null;
  if (!idSerial) {
    return { ultimo_heartbeat: null, edad_heartbeat_seg: null, sensores: [], gaps: [] };
  }

  // 2. Último heartbeat
  const hbRes = await query<{ ultimo: string | null; edad_seg: number | null }>(
    `SELECT MAX(time) AS ultimo,
            EXTRACT(EPOCH FROM (NOW() - MAX(time)))::int AS edad_seg
       FROM equipo
      WHERE id_serial = $1`,
    [idSerial],
    { name: 'analisis__last_heartbeat' },
  );
  const ultimoHb = hbRes.rows[0]?.ultimo ?? null;
  const edadHb = hbRes.rows[0]?.edad_seg ?? null;

  // 3. Reg_maps + último valor de equipo.data
  const sensoresRes = await query<{
    id: string;
    alias: string;
    rol_dashboard: string | null;
    unidad: string | null;
    d1: string;
    valor: unknown;
    edad_seg: number | null;
  }>(
    `WITH last AS (
       SELECT time, data
         FROM equipo
        WHERE id_serial = $1
        ORDER BY time DESC
        LIMIT 1
     )
     SELECT rm.id, rm.alias, rm.rol_dashboard, rm.unidad, rm.d1,
            (SELECT (data ->> rm.d1) FROM last) AS valor,
            (SELECT EXTRACT(EPOCH FROM (NOW() - time))::int FROM last) AS edad_seg
       FROM reg_map rm
      WHERE rm.sitio_id = $2
      ORDER BY rm.alias ASC`,
    [idSerial, siteId],
    { name: 'analisis__sensores' },
  );

  const sensores: SensorEstadoRow[] = sensoresRes.rows.map((r) => ({
    reg_map_id: r.id,
    alias: r.alias,
    rol_dashboard: r.rol_dashboard,
    unidad: r.unidad,
    raw_value: r.valor,
    edad_seg: r.edad_seg,
  }));

  // 4. Gaps en últimos 30 días — buckets de 5min y agrupa intervalos sin data
  //    usando window functions sobre time_bucket TimescaleDB.
  const gapsRes = await query<{ desde: string; hasta: string; duracion_min: number }>(
    `WITH buckets AS (
       SELECT time_bucket('5 minutes', time) AS bucket
         FROM equipo
        WHERE id_serial = $1
          AND time >= NOW() - ($2 || ' days')::interval
        GROUP BY 1
     ),
     ordered AS (
       SELECT bucket,
              LAG(bucket) OVER (ORDER BY bucket) AS prev_bucket
         FROM buckets
     )
     SELECT prev_bucket  AS desde,
            bucket       AS hasta,
            EXTRACT(EPOCH FROM (bucket - prev_bucket))::int / 60 AS duracion_min
       FROM ordered
      WHERE prev_bucket IS NOT NULL
        AND (bucket - prev_bucket) >= ($3 || ' minutes')::interval
      ORDER BY desde DESC
      LIMIT 50`,
    [idSerial, String(GAP_WINDOW_DAYS), String(MIN_GAP_MIN)],
    { name: 'analisis__gaps' },
  );

  return {
    ultimo_heartbeat: ultimoHb,
    edad_heartbeat_seg: edadHb,
    sensores,
    gaps: gapsRes.rows,
  };
}

// ============================================================================
// Métricas (agregados por variable en rango)
// ============================================================================

export interface MetricaVariable {
  reg_map_id: string;
  alias: string;
  rol_dashboard: string | null;
  unidad: string | null;
  count: number;
  min: number | null;
  max: number | null;
  avg: number | null;
  last: number | null;
}

export interface MetricasData {
  desde: string;
  hasta: string;
  total_lecturas: number;
  variables: MetricaVariable[];
}

export async function getMetricas(
  siteId: string,
  desde: string,
  hasta: string,
): Promise<MetricasData> {
  const siteRes = await query<{ id_serial: string | null }>(
    `SELECT id_serial FROM sitio WHERE id = $1`,
    [siteId],
    { name: 'analisis__metricas_serial' },
  );
  const idSerial = siteRes.rows[0]?.id_serial ?? null;
  if (!idSerial) return { desde, hasta, total_lecturas: 0, variables: [] };

  const totalRes = await query<{ total: number }>(
    `SELECT COUNT(*)::int AS total
       FROM equipo
      WHERE id_serial = $1 AND time >= $2 AND time < $3`,
    [idSerial, desde, hasta],
    { name: 'analisis__metricas_total' },
  );
  const total = totalRes.rows[0]?.total ?? 0;

  // Por cada reg_map: min/max/avg/last del campo data->d1 en el rango.
  const varsRes = await query<{
    id: string;
    alias: string;
    rol_dashboard: string | null;
    unidad: string | null;
    count: number;
    min: number | null;
    max: number | null;
    avg: number | null;
    last: number | null;
  }>(
    `SELECT rm.id, rm.alias, rm.rol_dashboard, rm.unidad,
            COUNT(*) FILTER (WHERE (e.data ->> rm.d1) ~ '^-?[0-9]+(\\.[0-9]+)?$')::int AS count,
            MIN(CASE WHEN (e.data ->> rm.d1) ~ '^-?[0-9]+(\\.[0-9]+)?$'
                     THEN (e.data ->> rm.d1)::numeric END)::float AS min,
            MAX(CASE WHEN (e.data ->> rm.d1) ~ '^-?[0-9]+(\\.[0-9]+)?$'
                     THEN (e.data ->> rm.d1)::numeric END)::float AS max,
            AVG(CASE WHEN (e.data ->> rm.d1) ~ '^-?[0-9]+(\\.[0-9]+)?$'
                     THEN (e.data ->> rm.d1)::numeric END)::float AS avg,
            (SELECT (data ->> rm.d1)::numeric
               FROM equipo
              WHERE id_serial = $1 AND time >= $2 AND time < $3
                AND (data ->> rm.d1) ~ '^-?[0-9]+(\\.[0-9]+)?$'
              ORDER BY time DESC LIMIT 1)::float AS last
       FROM reg_map rm
       LEFT JOIN equipo e ON e.id_serial = $1
                          AND e.time >= $2 AND e.time < $3
      WHERE rm.sitio_id = $4
      GROUP BY rm.id, rm.alias, rm.rol_dashboard, rm.unidad
      ORDER BY rm.alias ASC`,
    [idSerial, desde, hasta, siteId],
    { name: 'analisis__metricas_variables' },
  );

  return {
    desde,
    hasta,
    total_lecturas: total,
    variables: varsRes.rows.map((r) => ({
      reg_map_id: r.id,
      alias: r.alias,
      rol_dashboard: r.rol_dashboard,
      unidad: r.unidad,
      count: r.count,
      min: r.min,
      max: r.max,
      avg: r.avg,
      last: r.last,
    })),
  };
}

// ============================================================================
// Reportes (lista de envíos DGA recientes para descarga rápida)
// ============================================================================

export interface ReporteRecienteRow {
  ts: string;
  fecha: string;
  hora: string;
  estatus: string;
  comprobante: string | null;
  caudal_instantaneo: string | null;
  flujo_acumulado: string | null;
  nivel_freatico: string | null;
}

export async function getReportesRecientes(
  siteId: string,
  limit: number,
): Promise<ReporteRecienteRow[]> {
  const r = await query<ReporteRecienteRow>(
    `SELECT ts,
            to_char(fecha, 'YYYY-MM-DD') AS fecha,
            to_char(hora,  'HH24:MI:SS') AS hora,
            estatus, comprobante,
            caudal_instantaneo, flujo_acumulado, nivel_freatico
       FROM dato_dga
      WHERE site_id = $1
      ORDER BY ts DESC
      LIMIT $2`,
    [siteId, Math.min(limit, 200)],
    { name: 'analisis__reportes_recientes' },
  );
  return r.rows;
}
