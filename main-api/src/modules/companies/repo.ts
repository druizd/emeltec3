/**
 * Repositorio de companies (empresa + sub_empresa + sitios).
 */
import { query } from '../../config/dbHelpers';
import type { Company, HierarchySite, SubCompany } from './types';

const SITE_COLUMNS =
  'id, descripcion, empresa_id, sub_empresa_id, id_serial, ubicacion, tipo_sitio, activo';

export async function listCompanies(empresaIds: string[] | null): Promise<Company[]> {
  if (empresaIds === null) {
    const r = await query<Company>(
      'SELECT id, nombre, rut, tipo_empresa FROM empresa ORDER BY nombre ASC',
      [],
      { name: 'companies__list_all' },
    );
    return r.rows;
  }
  if (empresaIds.length === 0) return [];
  const r = await query<Company>(
    'SELECT id, nombre, rut, tipo_empresa FROM empresa WHERE id = ANY($1::text[]) ORDER BY nombre ASC',
    [empresaIds],
    { name: 'companies__list_scoped' },
  );
  return r.rows;
}

export async function listSubCompanies(
  empresaIds: string[] | null,
  subEmpresaIds: string[] | null,
): Promise<SubCompany[]> {
  if (empresaIds !== null && empresaIds.length === 0) return [];
  if (subEmpresaIds !== null && subEmpresaIds.length === 0) return [];

  const params: unknown[] = [];
  let where = '';

  if (empresaIds !== null) {
    params.push(empresaIds);
    where += `${where ? ' AND ' : 'WHERE '}empresa_id = ANY($${params.length}::text[])`;
  }
  if (subEmpresaIds !== null) {
    params.push(subEmpresaIds);
    where += `${where ? ' AND ' : 'WHERE '}id = ANY($${params.length}::text[])`;
  }

  const r = await query<SubCompany>(
    `SELECT id, nombre, rut, empresa_id FROM sub_empresa ${where} ORDER BY nombre ASC`,
    params,
    { label: 'companies__list_subcompanies' },
  );
  return r.rows;
}

export async function listSites(
  empresaIds: string[] | null,
  subEmpresaIds: string[] | null,
): Promise<HierarchySite[]> {
  if (empresaIds !== null && empresaIds.length === 0) return [];
  if (subEmpresaIds !== null && subEmpresaIds.length === 0) return [];

  const params: unknown[] = [];
  let where = '';
  if (empresaIds !== null) {
    params.push(empresaIds);
    where += `${where ? ' AND ' : 'WHERE '}empresa_id = ANY($${params.length}::text[])`;
  }
  if (subEmpresaIds !== null) {
    params.push(subEmpresaIds);
    where += `${where ? ' AND ' : 'WHERE '}sub_empresa_id = ANY($${params.length}::text[])`;
  }

  const r = await query<HierarchySite>(
    `SELECT ${SITE_COLUMNS} FROM sitio ${where} ORDER BY descripcion ASC`,
    params,
    { label: 'companies__list_sites' },
  );
  return r.rows;
}

export async function attachPozoConfigsToSites<T extends { id: string }>(
  sites: T[],
): Promise<Array<T & { pozo_config: unknown }>> {
  if (sites.length === 0) return sites.map((s) => ({ ...s, pozo_config: null }));
  const ids = sites.map((s) => s.id);
  const r = await query<{
    sitio_id: string;
    profundidad_pozo_m: number | null;
    profundidad_sensor_m: number | null;
    nivel_estatico_manual_m: number | null;
    obra_dga: string | null;
    slug: string | null;
  }>(
    `SELECT sitio_id, profundidad_pozo_m, profundidad_sensor_m, nivel_estatico_manual_m, obra_dga, slug
     FROM pozo_config WHERE sitio_id = ANY($1::text[])`,
    [ids],
    { name: 'companies__pozo_configs_for_sites' },
  );
  const map = new Map(r.rows.map((row) => [row.sitio_id, row]));
  return sites.map((s) => ({ ...s, pozo_config: map.get(s.id) ?? null }));
}

/**
 * Anexa `last_seen_at` = MAX(equipo.time) por id_serial del sitio. Usado
 * por las tarjetas de la página "Instalaciones" para colorear el estado
 * según frescura del dato (En vivo <1h / Con datos <24h / Sin datos ≥24h).
 *
 * Aprovecha idx_equipo_serial_time (existe en init-db). Una sola query
 * agrupada — eficiente incluso con N sitios.
 */
export async function attachLastSeenToSites<T extends { id_serial?: string | null }>(
  sites: T[],
): Promise<Array<T & { last_seen_at: string | null }>> {
  if (sites.length === 0) return sites.map((s) => ({ ...s, last_seen_at: null }));
  const serials = sites
    .map((s) => s.id_serial)
    .filter((v): v is string => typeof v === 'string' && v.length > 0);
  if (serials.length === 0) return sites.map((s) => ({ ...s, last_seen_at: null }));

  const r = await query<{ id_serial: string; last_seen: string }>(
    `SELECT id_serial, MAX(time)::text AS last_seen
       FROM equipo
      WHERE id_serial = ANY($1::text[])
      GROUP BY id_serial`,
    [serials],
    { name: 'companies__last_seen_per_serial' },
  );
  const map = new Map(r.rows.map((row) => [row.id_serial, row.last_seen]));
  return sites.map((s) => ({
    ...s,
    last_seen_at: s.id_serial ? (map.get(s.id_serial) ?? null) : null,
  }));
}
