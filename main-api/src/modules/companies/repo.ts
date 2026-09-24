/**
 * Repositorio de companies (empresa + sub_empresa + sitios).
 */
import { query } from '../../config/dbHelpers';
import type { Company, HierarchySite, SubCompany } from './types';

const SITE_COLUMNS =
  'id, descripcion, empresa_id, sub_empresa_id, id_serial, ubicacion, coord_norte, coord_este, huso, tipo_sitio, activo, es_maleta_piloto';

/**
 * Ventana temporal para la primera pasada de `attachLastSeenToSites` contra
 * `equipo_1min`.
 *
 * Mismo hallazgo que `sites/repo.ts::getDashboardHistory` (medido en
 * producción el 24-09-2026): sin cota sobre `bucket`, TimescaleDB abre los
 * ~140 chunks del hypertable/cagg al planificar aunque la consulta se
 * resuelva en milisegundos. Esta es además la consulta que dejó la web sin
 * listado de instalaciones: moría por statement_timeout a los 10 s. 30 días
 * cubre a cualquier serial que esté transmitiendo; los que llevan más tiempo
 * mudos se resuelven en una segunda pasada sin cota (ver más abajo). NO
 * borrar este filtro pensando que sobra.
 */
const LAST_SEEN_WINDOW_DAYS = 30;

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

/**
 * Sitios visibles para un Vendedor: maletas piloto (cualquier empresa) +
 * instalaciones asignadas en usuario_sitio. Scope a nivel sitio (cross-empresa).
 */
export async function listSitesForVendedor(userId: string): Promise<HierarchySite[]> {
  const r = await query<HierarchySite>(
    `SELECT ${SITE_COLUMNS} FROM sitio
      WHERE es_maleta_piloto = TRUE
         OR id IN (SELECT sitio_id FROM usuario_sitio WHERE usuario_id = $1)
      ORDER BY descripcion ASC`,
    [userId],
    { name: 'companies__sites_vendedor' },
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
 * Anexa `last_seen_at` = última lectura por id_serial del sitio. Usado por
 * dashboard y tarjetas de "Instalaciones" para colorear el estado según
 * frescura (En vivo <1h / Con datos <24h / Sin datos ≥24h).
 *
 * Lee del cagg `equipo_1min` (NO de la hypertable `equipo` cruda):
 * MAX(time) GROUP BY sobre la hypertable agregaba chunk por chunk y
 * reventaba el statement timeout en prod (~12s, incidente 2026-07-16).
 * El cagg es órdenes de magnitud más chico, tiene índice garantizado por
 * migración (idx_equipo_1min_serial_bucket) y es la MISMA fuente de
 * frescura que usan dashboard-data y el fill DGA. LATERAL LIMIT 1 por
 * serial = un index scan de 1 fila por sitio. Lag del cagg ≤ ~3 min —
 * irrelevante contra el umbral de 60 min.
 */
export async function attachLastSeenToSites<T extends { id_serial?: string | null }>(
  sites: T[],
): Promise<Array<T & { last_seen_at: string | null }>> {
  if (sites.length === 0) return sites.map((s) => ({ ...s, last_seen_at: null }));
  const serials = sites
    .map((s) => s.id_serial)
    .filter((v): v is string => typeof v === 'string' && v.length > 0);
  if (serials.length === 0) return sites.map((s) => ({ ...s, last_seen_at: null }));

  const bounded = await query<{ id_serial: string; last_seen: string }>(
    `SELECT s.id_serial, e.bucket::text AS last_seen
       FROM unnest($1::text[]) AS s(id_serial)
       JOIN LATERAL (
         SELECT bucket
           FROM equipo_1min
          WHERE id_serial = s.id_serial
            AND bucket >= NOW() - INTERVAL '${LAST_SEEN_WINDOW_DAYS} days'
          ORDER BY bucket DESC
          LIMIT 1
       ) e ON true`,
    [serials],
    // `name` y no `label`: convierte la consulta en un prepared statement y
    // Postgres reutiliza el plan entre ejecuciones. Con `label` solo cambia la
    // etiqueta del log y cada llamada vuelve a planificar desde cero, que es
    // exactamente el costo que este cambio viene a evitar.
    { name: 'companies__last_seen_per_serial' },
  );
  const map = new Map(bounded.rows.map((row) => [row.id_serial, row.last_seen]));

  // Un sitio sin lecturas dentro de la ventana sale con `last_seen_at: null`, y
  // eso es deliberado: NO se hace una segunda pasada sin cota para rescatar su
  // última fecha.
  //
  // Hubo una, y costaba 6,5 segundos (medido el 24-09-2026: 6.600 ms para
  // devolver 3 filas). El costo no depende de cuántos seriales queden sin
  // resolver sino de cuántos chunks mire el planificador, así que bastaba UN
  // sitio mudo para pagar el plan completo de ~140 chunks — y mudos hay casi
  // siempre. Eran 6,5 de los 7 segundos que tardaba /api/v2/companies/tree.
  //
  // Y no compraba nada. El frontend usa `last_seen_at` solo para pintar la
  // tarjeta: "En vivo" si la lectura tiene menos de una hora, "Sin datos" en
  // cualquier otro caso, incluido el timestamp ausente (ver `site-card.ts`).
  // Para un sitio que lleva más de LAST_SEEN_WINDOW_DAYS días mudo, mandar su
  // fecha real de hace dos meses y no mandar nada pintan la misma tarjeta gris.
  //
  // Si alguna vez hace falta la fecha exacta de un sitio mudo, la salida NO es
  // reponer esta consulta: es reducir la cantidad de chunks de las hypertables
  // (`chunk_time_interval`) o mantener el último timestamp en `sitio` al
  // escribir. Consultar la serie temporal sin cota no escala.

  return sites.map((s) => ({
    ...s,
    last_seen_at: s.id_serial ? (map.get(s.id_serial) ?? null) : null,
  }));
}
