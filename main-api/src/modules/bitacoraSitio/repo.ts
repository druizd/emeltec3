/**
 * Repositorio Bitácora del sitio: ficha (JSONB en pozo_config) + equipamiento.
 */
import { query } from '../../config/dbHelpers';

// ============================================================================
// Ficha del sitio (JSONB en pozo_config.ficha_critica)
// ============================================================================

export interface FichaContacto {
  nombre: string;
  rol: 'Responsable' | 'Operador' | string;
  telefono?: string | null | undefined;
  email?: string | null | undefined;
}

export interface FichaAcreditacion {
  persona: string;
  tipo: string;
  vigencia_hasta?: string | null | undefined;
}

export interface FichaRiesgo {
  descripcion: string;
  probabilidad?: number | null | undefined;
  impacto?: number | null | undefined;
  mitigacion?: string | null | undefined;
}

export interface FichaSitio {
  pin_critico?: string | null | undefined;
  contactos: FichaContacto[];
  acreditaciones: FichaAcreditacion[];
  riesgos: FichaRiesgo[];
}

const EMPTY_FICHA: FichaSitio = {
  pin_critico: null,
  contactos: [],
  acreditaciones: [],
  riesgos: [],
};

function normalizeFicha(raw: unknown): FichaSitio {
  if (!raw || typeof raw !== 'object') return EMPTY_FICHA;
  const obj = raw as Record<string, unknown>;
  return {
    pin_critico: typeof obj.pin_critico === 'string' ? obj.pin_critico : null,
    contactos: Array.isArray(obj.contactos) ? (obj.contactos as FichaContacto[]) : [],
    acreditaciones: Array.isArray(obj.acreditaciones)
      ? (obj.acreditaciones as FichaAcreditacion[])
      : [],
    riesgos: Array.isArray(obj.riesgos) ? (obj.riesgos as FichaRiesgo[]) : [],
  };
}

export async function getFicha(siteId: string): Promise<FichaSitio> {
  const r = await query<{ ficha_critica: unknown }>(
    `SELECT ficha_critica FROM pozo_config WHERE sitio_id = $1`,
    [siteId],
    { name: 'bitacora__get_ficha' },
  );
  if (r.rows.length === 0) return EMPTY_FICHA;
  return normalizeFicha(r.rows[0]?.ficha_critica);
}

/**
 * Upsert de la ficha. Si pozo_config no existe para el sitio, lo crea
 * vacío con la ficha (admin debe completar profundidades aparte).
 */
export async function patchFicha(siteId: string, ficha: FichaSitio): Promise<FichaSitio> {
  const r = await query<{ ficha_critica: unknown }>(
    `INSERT INTO pozo_config (sitio_id, ficha_critica)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (sitio_id) DO UPDATE SET
       ficha_critica = EXCLUDED.ficha_critica,
       updated_at    = NOW()
     RETURNING ficha_critica`,
    [siteId, JSON.stringify(ficha)],
    { name: 'bitacora__patch_ficha' },
  );
  return normalizeFicha(r.rows[0]?.ficha_critica);
}

// ============================================================================
// Equipamiento del sitio
// ============================================================================

export type EquipoEstado = 'operativo' | 'en_mantencion' | 'fuera_de_servicio';

export interface SitioEquipoRow {
  id: string;
  sitio_id: string;
  nombre: string;
  modelo: string | null;
  fabricante: string | null;
  serie: string | null;
  fecha_compra: string | null;
  garantia_hasta: string | null;
  estado: EquipoEstado;
  notas: string | null;
  created_at: string;
  updated_at: string;
}

const EQUIPO_COLS =
  'id, sitio_id, nombre, modelo, fabricante, serie, ' +
  "to_char(fecha_compra, 'YYYY-MM-DD') AS fecha_compra, " +
  "to_char(garantia_hasta, 'YYYY-MM-DD') AS garantia_hasta, " +
  'estado, notas, created_at, updated_at';

export async function listEquipos(siteId: string): Promise<SitioEquipoRow[]> {
  const r = await query<SitioEquipoRow>(
    `SELECT ${EQUIPO_COLS} FROM sitio_equipo WHERE sitio_id = $1
      ORDER BY estado ASC, nombre ASC`,
    [siteId],
    { name: 'bitacora__list_equipos' },
  );
  return r.rows;
}

export async function insertEquipo(input: {
  sitio_id: string;
  nombre: string;
  modelo?: string | null | undefined;
  fabricante?: string | null | undefined;
  serie?: string | null | undefined;
  fecha_compra?: string | null | undefined;
  garantia_hasta?: string | null | undefined;
  estado?: EquipoEstado | undefined;
  notas?: string | null | undefined;
}): Promise<SitioEquipoRow> {
  const r = await query<SitioEquipoRow>(
    `INSERT INTO sitio_equipo
       (sitio_id, nombre, modelo, fabricante, serie, fecha_compra, garantia_hasta, estado, notas)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING ${EQUIPO_COLS}`,
    [
      input.sitio_id,
      input.nombre,
      input.modelo ?? null,
      input.fabricante ?? null,
      input.serie ?? null,
      input.fecha_compra ?? null,
      input.garantia_hasta ?? null,
      input.estado ?? 'operativo',
      input.notas ?? null,
    ],
    { name: 'bitacora__insert_equipo' },
  );
  const row = r.rows[0];
  if (!row) throw new Error('INSERT sitio_equipo no devolvió fila');
  return row;
}

export async function patchEquipo(
  id: number,
  input: {
    nombre?: string | undefined;
    modelo?: string | null | undefined;
    fabricante?: string | null | undefined;
    serie?: string | null | undefined;
    fecha_compra?: string | null | undefined;
    garantia_hasta?: string | null | undefined;
    estado?: EquipoEstado | undefined;
    notas?: string | null | undefined;
  },
): Promise<SitioEquipoRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [id];
  let i = 2;
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    sets.push(`${k} = $${i++}`);
    values.push(v);
  }
  if (sets.length === 0) {
    const r = await query<SitioEquipoRow>(
      `SELECT ${EQUIPO_COLS} FROM sitio_equipo WHERE id = $1`,
      [id],
      { name: 'bitacora__get_equipo' },
    );
    return r.rows[0] ?? null;
  }
  sets.push(`updated_at = NOW()`);
  const r = await query<SitioEquipoRow>(
    `UPDATE sitio_equipo SET ${sets.join(', ')}
       WHERE id = $1
   RETURNING ${EQUIPO_COLS}`,
    values,
    { name: 'bitacora__patch_equipo' },
  );
  return r.rows[0] ?? null;
}

export async function deleteEquipo(id: number): Promise<boolean> {
  const r = await query(
    `DELETE FROM sitio_equipo WHERE id = $1`,
    [id],
    { name: 'bitacora__delete_equipo' },
  );
  return (r.rowCount ?? 0) > 0;
}
