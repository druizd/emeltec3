import { pool } from './pool';

export interface SiteRow {
  id: string;
  descripcion: string;
  idSerial: string;
  empresaId: string;
  subEmpresaId: string;
  tipoSitio: string;
  activo: boolean;
}

export interface PozoConfigRow {
  sitioId: string;
  profundidadPozoM: number | null;
  profundidadSensorM: number | null;
  nivelEstaticoManualM: number | null;
  obraDga: string | null;
  slug: string | null;
}

export interface RegMapRow {
  id: string;
  alias: string;
  d1: string;
  d2: string | null;
  tipoDato: string;
  unidad: string | null;
  rolDashboard: string;
  transformacion: string;
  parametros: Record<string, unknown>;
  sitioId: string;
}

export async function getSiteById(sitioId: string): Promise<SiteRow | null> {
  const { rows } = await pool.query(
    `SELECT id, descripcion, id_serial, empresa_id, sub_empresa_id, tipo_sitio, activo
       FROM sitio
      WHERE id = $1`,
    [sitioId],
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    id: r.id,
    descripcion: r.descripcion,
    idSerial: r.id_serial,
    empresaId: r.empresa_id,
    subEmpresaId: r.sub_empresa_id,
    tipoSitio: r.tipo_sitio,
    activo: r.activo,
  };
}

export async function getPozoConfig(sitioId: string): Promise<PozoConfigRow | null> {
  const { rows } = await pool.query(
    `SELECT sitio_id, profundidad_pozo_m, profundidad_sensor_m, nivel_estatico_manual_m, obra_dga, slug
       FROM pozo_config
      WHERE sitio_id = $1`,
    [sitioId],
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    sitioId: r.sitio_id,
    profundidadPozoM: r.profundidad_pozo_m == null ? null : Number(r.profundidad_pozo_m),
    profundidadSensorM: r.profundidad_sensor_m == null ? null : Number(r.profundidad_sensor_m),
    nivelEstaticoManualM: r.nivel_estatico_manual_m == null ? null : Number(r.nivel_estatico_manual_m),
    obraDga: r.obra_dga,
    slug: r.slug,
  };
}

export async function getRegMapsBySite(sitioId: string): Promise<RegMapRow[]> {
  const { rows } = await pool.query(
    `SELECT id, alias, d1, d2, tipo_dato, unidad, rol_dashboard, transformacion, parametros, sitio_id
       FROM reg_map
      WHERE sitio_id = $1`,
    [sitioId],
  );
  return rows.map((r) => ({
    id: r.id,
    alias: r.alias,
    d1: r.d1,
    d2: r.d2,
    tipoDato: r.tipo_dato,
    unidad: r.unidad,
    rolDashboard: r.rol_dashboard,
    transformacion: r.transformacion,
    parametros: r.parametros ?? {},
    sitioId: r.sitio_id,
  }));
}
