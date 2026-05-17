/**
 * Repositorio del módulo sites: sitio, pozo_config, reg_map + last/history equipo.
 */
import { query } from '../../config/dbHelpers';
import type { HistoryEquipoRow, LatestEquipoRow, PozoConfig, RegMap, Site } from './types';

const SITE_COLUMNS =
  'id, descripcion, empresa_id, sub_empresa_id, id_serial, ubicacion, tipo_sitio, activo';
const MAP_COLUMNS =
  'id, alias, d1, d2, tipo_dato, unidad, rol_dashboard, transformacion, parametros, sitio_id, created_at, updated_at';
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

export async function getLatestEquipoForSerial(serialId: string): Promise<LatestEquipoRow | null> {
  const result = await query<LatestEquipoRow>(
    `
    SELECT
      time,
      received_at,
      id_serial,
      data
    FROM equipo
    WHERE id_serial = $1
    ORDER BY time DESC
    LIMIT 1
    `,
    [serialId],
    { name: 'sites__latest_equipo' },
  );
  return result.rows[0] ?? null;
}

export async function getDashboardHistory(
  serialId: string,
  limit: number,
): Promise<HistoryEquipoRow[]> {
  // Uso de time_bucket de TimescaleDB para agrupar por minuto: más rápido que
  // DISTINCT ON sobre date_trunc porque aprovecha la organización por chunks.
  const result = await query<HistoryEquipoRow>(
    `
    SELECT time, received_at, id_serial, data
    FROM (
      SELECT DISTINCT ON (time_bucket('1 minute', time))
        time,
        received_at,
        id_serial,
        data
      FROM equipo
      WHERE id_serial = $1
      ORDER BY time_bucket('1 minute', time) DESC, time DESC
    ) latest_by_minute
    ORDER BY time DESC
    LIMIT $2
    `,
    [serialId, limit],
    { label: 'sites__dashboard_history' },
  );
  return result.rows;
}

export async function getDashboardHistoryRange(
  serialId: string,
  fromUtc: string,
  toUtc: string,
): Promise<HistoryEquipoRow[]> {
  const result = await query<HistoryEquipoRow>(
    `
    SELECT time, received_at, id_serial, data
    FROM (
      SELECT DISTINCT ON (time_bucket('1 minute', time))
        time,
        received_at,
        id_serial,
        data
      FROM equipo
      WHERE id_serial = $1
        AND time >= $2::timestamptz
        AND time <  $3::timestamptz
      ORDER BY time_bucket('1 minute', time) DESC, time DESC
    ) latest_by_minute
    ORDER BY time DESC
    `,
    [serialId, fromUtc, toUtc],
    { label: 'sites__dashboard_history_range' },
  );
  return result.rows;
}
