// Repositorio de configuración de sitios.
// Lee tablas `sitio`, `pozo_config` y `reg_map` para conocer:
//  - identidad del sitio (id, serial del equipo, empresa)
//  - geometría del pozo (profundidad, sensor, obra DGA)
//  - mapeo de registros Modbus (qué campo del JSON `data` corresponde a qué variable)
import { pool } from './pool';

// Fila base de un sitio.
export interface SiteRow {
  id: string;
  descripcion: string;
  idSerial: string;
  empresaId: string;
  subEmpresaId: string | null;
  tipoSitio: string;
  activo: boolean;
}

// Geometría e identificación DGA del pozo asociado al sitio.
export interface PozoConfigRow {
  sitioId: string;
  profundidadPozoM: number | null;
  profundidadSensorM: number | null;
  nivelEstaticoManualM: number | null;
  obraDga: string | null;
  slug: string | null;
}

// Mapeo de registro Modbus → rol de dashboard / variable reportable.
// `d1`/`d2` son los nombres de campo dentro del JSON `data` del equipo.
// `transformacion` indica qué función aplicar; `parametros` lleva opciones (word_swap, etc).
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

// Trae los datos básicos de un sitio por id. Devuelve null si no existe.
export async function getSiteById(sitioId: string): Promise<SiteRow | null> {
  const { rows } = await pool.query(
    `SELECT id, descripcion, id_serial, empresa_id, tipo_sitio, activo
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
    subEmpresaId: null,
    tipoSitio: r.tipo_sitio,
    activo: r.activo,
  };
}

// Trae la geometría del pozo (necesaria para calcular nivel freático y para identificar la obra ante DGA).
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
    nivelEstaticoManualM:
      r.nivel_estatico_manual_m == null ? null : Number(r.nivel_estatico_manual_m),
    obraDga: r.obra_dga,
    slug: r.slug,
  };
}

// Lista todos los registros mapeados para un sitio. El usecase de ingestión
// los recorre y, según el `rolDashboard` (caudal/nivel/totalizador), aplica la transformación correspondiente.
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
