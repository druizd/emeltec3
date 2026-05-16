/**
 * Repositorio del modulo contadores. Acceso a site_contador_mensual + lookup
 * de variables tipo contador y sitios activos para el worker.
 */
import { query } from '../../config/dbHelpers';
import { COUNTER_ROLES, type ContadorMensualRow } from './types';
import type { RegMap, Site } from '../sites/types';

const ROW_COLUMNS =
  'sitio_id, variable_id, rol, mes, valor_inicio, valor_fin, delta, unidad, muestras, resets_detectados, ultimo_dato, actualizado_at';

export interface CounterVariable {
  sitio_id: string;
  id_serial: string | null;
  variable_id: string;
  alias: string;
  rol: string;
  unidad: string | null;
}

export async function listCounterVariables(): Promise<CounterVariable[]> {
  const result = await query<CounterVariable>(
    `
    SELECT s.id AS sitio_id, s.id_serial, r.id AS variable_id, r.alias, r.rol_dashboard AS rol, r.unidad
    FROM reg_map r
    JOIN sitio s ON s.id = r.sitio_id
    WHERE s.activo = TRUE
      AND r.rol_dashboard = ANY($1::text[])
      AND s.id_serial IS NOT NULL
    ORDER BY s.id, r.alias
    `,
    [COUNTER_ROLES as unknown as string[]],
    { name: 'contadores__list_counter_vars' },
  );
  return result.rows;
}

export async function listCounterVariablesForSite(siteId: string): Promise<CounterVariable[]> {
  const result = await query<CounterVariable>(
    `
    SELECT s.id AS sitio_id, s.id_serial, r.id AS variable_id, r.alias, r.rol_dashboard AS rol, r.unidad
    FROM reg_map r
    JOIN sitio s ON s.id = r.sitio_id
    WHERE r.sitio_id = $1
      AND r.rol_dashboard = ANY($2::text[])
    ORDER BY r.alias
    `,
    [siteId, COUNTER_ROLES as unknown as string[]],
    { name: 'contadores__list_counter_vars_site' },
  );
  return result.rows;
}

export async function upsertContadorMensual(row: {
  sitio_id: string;
  variable_id: string;
  rol: string;
  mes: string;
  valor_inicio: number | null;
  valor_fin: number | null;
  delta: number | null;
  unidad: string | null;
  muestras: number;
  resets_detectados: number;
  ultimo_dato: string | null;
}): Promise<void> {
  await query(
    `
    INSERT INTO site_contador_mensual
      (sitio_id, variable_id, rol, mes, valor_inicio, valor_fin, delta, unidad,
       muestras, resets_detectados, ultimo_dato, actualizado_at)
    VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9, $10, $11, NOW())
    ON CONFLICT (sitio_id, variable_id, mes) DO UPDATE SET
      rol = EXCLUDED.rol,
      valor_inicio = EXCLUDED.valor_inicio,
      valor_fin = EXCLUDED.valor_fin,
      delta = EXCLUDED.delta,
      unidad = EXCLUDED.unidad,
      muestras = EXCLUDED.muestras,
      resets_detectados = EXCLUDED.resets_detectados,
      ultimo_dato = EXCLUDED.ultimo_dato,
      actualizado_at = NOW()
    `,
    [
      row.sitio_id,
      row.variable_id,
      row.rol,
      row.mes,
      row.valor_inicio,
      row.valor_fin,
      row.delta,
      row.unidad,
      row.muestras,
      row.resets_detectados,
      row.ultimo_dato,
    ],
    { name: 'contadores__upsert' },
  );
}

export async function listContadoresBySiteAndRol(
  sitioId: string,
  rol: string,
  meses: number,
): Promise<ContadorMensualRow[]> {
  const result = await query<ContadorMensualRow>(
    `
    SELECT ${ROW_COLUMNS}
    FROM site_contador_mensual
    WHERE sitio_id = $1 AND rol = $2
      AND mes >= (date_trunc('month', NOW() AT TIME ZONE 'America/Santiago')::date - ($3::int - 1) * INTERVAL '1 month')
    ORDER BY mes ASC
    `,
    [sitioId, rol, meses],
    { name: 'contadores__list_by_site_rol' },
  );
  return result.rows;
}

export async function listContadoresByVariable(
  sitioId: string,
  variableId: string,
  meses: number,
): Promise<ContadorMensualRow[]> {
  const result = await query<ContadorMensualRow>(
    `
    SELECT ${ROW_COLUMNS}
    FROM site_contador_mensual
    WHERE sitio_id = $1 AND variable_id = $2
      AND mes >= (date_trunc('month', NOW() AT TIME ZONE 'America/Santiago')::date - ($3::int - 1) * INTERVAL '1 month')
    ORDER BY mes ASC
    `,
    [sitioId, variableId, meses],
    { name: 'contadores__list_by_variable' },
  );
  return result.rows;
}

// Helpers reexportados para que worker/script reusen.
export async function getSiteById(siteId: string): Promise<Site | null> {
  const result = await query<Site>(
    'SELECT id, descripcion, empresa_id, sub_empresa_id, id_serial, ubicacion, tipo_sitio, activo FROM sitio WHERE id = $1',
    [siteId],
    { name: 'contadores__site_by_id' },
  );
  return result.rows[0] ?? null;
}

export async function getMappingsBySiteId(siteId: string): Promise<RegMap[]> {
  const result = await query<RegMap>(
    `SELECT id, alias, d1, d2, tipo_dato, unidad, rol_dashboard, transformacion, parametros, sitio_id, created_at, updated_at
     FROM reg_map WHERE sitio_id = $1 ORDER BY alias ASC`,
    [siteId],
    { name: 'contadores__mappings_by_site' },
  );
  return result.rows;
}
