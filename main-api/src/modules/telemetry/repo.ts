/**
 * Capa de acceso a datos para telemetría (tabla `equipo`).
 * Queries con nombre (prepared statements) para reusar plan en pg.
 */
import { query } from '../../config/dbHelpers';
import { CHILE_TIME_ZONE } from '../../shared/time';

function chileDateSql(col: string): string {
  return `TO_CHAR(${col} AT TIME ZONE '${CHILE_TIME_ZONE}', 'YYYY-MM-DD')`;
}

function chileTimeSql(col: string): string {
  return `TO_CHAR(${col} AT TIME ZONE '${CHILE_TIME_ZONE}', 'HH24:MI:SS')`;
}

export interface RawRow {
  id_serial: string;
  fecha: string;
  hora: string;
  data: Record<string, unknown>;
}

export interface OnlineRow {
  id_serial: string;
  nombre_dato: string;
  valor_dato: unknown;
  fecha: string;
  hora: string;
}

export interface HistoryParams {
  serialId: string;
  selectedKeys: string[];
  from?: string;
  to?: string;
  limit?: number;
}

export async function findLatestSerialId(): Promise<string | null> {
  const result = await query<{ id_serial: string }>(
    `SELECT id_serial FROM equipo ORDER BY time DESC LIMIT 1`,
    [],
    { name: 'telemetry__latest_serial' },
  );
  return result.rows[0]?.id_serial ?? null;
}

export async function findLatestReferenceTimestamp(serialId: string): Promise<string | null> {
  const result = await query<{ fecha: string; hora: string }>(
    `
    SELECT
      ${chileDateSql('time')} AS fecha,
      ${chileTimeSql('time')} AS hora
    FROM equipo
    WHERE id_serial = $1
    ORDER BY time DESC
    LIMIT 1
    `,
    [serialId],
    { name: 'telemetry__latest_ref_ts' },
  );
  const row = result.rows[0];
  return row ? `${row.fecha} ${row.hora}` : null;
}

export async function findAvailableKeys(serialId: string): Promise<string[]> {
  const result = await query<{ nombre_dato: string }>(
    `
    SELECT DISTINCT jsonb_object_keys(data) AS nombre_dato
    FROM equipo
    WHERE id_serial = $1
    ORDER BY nombre_dato ASC
    `,
    [serialId],
    { name: 'telemetry__available_keys' },
  );
  return result.rows.map((r) => r.nombre_dato);
}

export async function findHistory(params: HistoryParams): Promise<RawRow[]> {
  const values: unknown[] = [params.serialId];
  let where = 'WHERE id_serial = $1';

  if (params.from && params.to) {
    values.push(params.from, params.to);
    where += ` AND time BETWEEN ($2::timestamp AT TIME ZONE '${CHILE_TIME_ZONE}') AND ($3::timestamp AT TIME ZONE '${CHILE_TIME_ZONE}')`;
  }

  if (params.selectedKeys.length === 1) {
    values.push(params.selectedKeys[0]);
    where += ` AND data ? $${values.length}`;
  } else if (params.selectedKeys.length > 1) {
    values.push(params.selectedKeys);
    where += ` AND data ?| $${values.length}::text[]`;
  }

  const hasLimit = Number.isFinite(params.limit);
  const limitClause = hasLimit ? `LIMIT $${values.length + 1}` : '';
  if (hasLimit) values.push(params.limit);

  const sql = `
    SELECT
      id_serial,
      ${chileDateSql('time')} AS fecha,
      ${chileTimeSql('time')} AS hora,
      data
    FROM equipo
    ${where}
    ORDER BY time DESC
    ${limitClause}
  `;

  const result = await query<RawRow>(sql, values, { label: 'telemetry__history' });
  return result.rows;
}

export async function findOnlineValues(
  serialId: string,
  selectedKeys: string[],
): Promise<OnlineRow[]> {
  const values: unknown[] = [serialId];
  let keyWhere = '';

  if (selectedKeys.length === 1) {
    values.push(selectedKeys[0]);
    keyWhere = ` AND kv.key = $${values.length}`;
  } else if (selectedKeys.length > 1) {
    values.push(selectedKeys);
    keyWhere = ` AND kv.key = ANY($${values.length}::text[])`;
  }

  const sql = `
    SELECT
      latest.id_serial,
      latest.nombre_dato,
      latest.valor_dato,
      ${chileDateSql('latest.time')} AS fecha,
      ${chileTimeSql('latest.time')} AS hora
    FROM (
      SELECT DISTINCT ON (kv.key)
        lr.id_serial,
        kv.key   AS nombre_dato,
        kv.value AS valor_dato,
        lr.time
      FROM equipo lr
      CROSS JOIN LATERAL jsonb_each(lr.data) AS kv(key, value)
      WHERE lr.id_serial = $1
      ${keyWhere}
      ORDER BY kv.key, lr.time DESC
    ) latest
    ORDER BY latest.nombre_dato ASC
  `;

  const result = await query<OnlineRow>(sql, values, { label: 'telemetry__online' });
  return result.rows;
}
