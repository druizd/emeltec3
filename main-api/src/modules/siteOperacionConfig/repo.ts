/**
 * Repositorio del modulo siteOperacionConfig. Una fila por sitio.
 */
import { query } from '../../config/dbHelpers';
import type { SiteOperacionConfig, TurnoConfig } from './types';

const COLUMNS = 'sitio_id, num_turnos, turnos, jornada_inicio, jornada_fin, updated_at';

interface DbRow {
  sitio_id: string;
  num_turnos: number;
  turnos: TurnoConfig[] | string;
  jornada_inicio: string;
  jornada_fin: string;
  updated_at: string;
}

function mapRow(row: DbRow): SiteOperacionConfig {
  // node-pg deserializa JSONB como object; defensive parse si vino string.
  const turnos = typeof row.turnos === 'string' ? JSON.parse(row.turnos) : row.turnos;
  return {
    sitio_id: row.sitio_id,
    num_turnos: row.num_turnos === 2 ? 2 : 3,
    turnos: Array.isArray(turnos) ? turnos : [],
    jornada_inicio: row.jornada_inicio,
    jornada_fin: row.jornada_fin,
    updated_at: row.updated_at,
  };
}

export async function findSiteOperacionConfig(
  sitioId: string,
): Promise<SiteOperacionConfig | null> {
  const result = await query<DbRow>(
    `SELECT ${COLUMNS} FROM site_operacion_config WHERE sitio_id = $1`,
    [sitioId],
    { name: 'site_operacion_config__find' },
  );
  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

export async function upsertSiteOperacionConfig(opts: {
  sitio_id: string;
  num_turnos: 2 | 3;
  turnos: TurnoConfig[];
  jornada_inicio: string;
  jornada_fin: string;
}): Promise<SiteOperacionConfig> {
  const result = await query<DbRow>(
    `
    INSERT INTO site_operacion_config
      (sitio_id, num_turnos, turnos, jornada_inicio, jornada_fin, updated_at)
    VALUES ($1, $2, $3::jsonb, $4, $5, NOW())
    ON CONFLICT (sitio_id) DO UPDATE SET
      num_turnos = EXCLUDED.num_turnos,
      turnos = EXCLUDED.turnos,
      jornada_inicio = EXCLUDED.jornada_inicio,
      jornada_fin = EXCLUDED.jornada_fin,
      updated_at = NOW()
    RETURNING ${COLUMNS}
    `,
    [
      opts.sitio_id,
      opts.num_turnos,
      JSON.stringify(opts.turnos),
      opts.jornada_inicio,
      opts.jornada_fin,
    ],
    { name: 'site_operacion_config__upsert' },
  );
  return mapRow(result.rows[0]!);
}
