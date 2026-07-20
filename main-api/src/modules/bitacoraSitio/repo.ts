/**
 * Repositorio Bitácora del sitio: ficha (JSONB en pozo_config) + equipamiento.
 */
import { query } from '../../config/dbHelpers';

// ============================================================================
// Ficha del sitio (JSONB en pozo_config.ficha_critica)
// ============================================================================

export interface FichaContacto {
  /** id estable = contacto_operativo.id. Ausente solo en payloads de alta. */
  id?: string;
  nombre: string;
  rol: 'Responsable' | 'Operador' | string;
  telefono?: string | null | undefined;
  email?: string | null | undefined;
  /** Solo en la respuesta enmascarada al cliente: true si hay tel/email
   * ocultos que se pueden revelar con 2FA. No se persiste. */
  datos_ocultos?: boolean;
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
  const base = r.rows.length === 0 ? EMPTY_FICHA : normalizeFicha(r.rows[0]?.ficha_critica);
  // Los contactos son la fuente única contacto_operativo (no el JSONB).
  return { ...base, contactos: await listContactos(siteId) };
}

/**
 * Upsert de la ficha (pin_critico, acreditaciones, riesgos). Los contactos NO
 * se persisten acá: viven en contacto_operativo. Se fuerza contactos=[] en el
 * JSONB para no dejar copias obsoletas de PII.
 */
export async function patchFicha(siteId: string, ficha: FichaSitio): Promise<FichaSitio> {
  const toStore = { ...ficha, contactos: [] };
  await query(
    `INSERT INTO pozo_config (sitio_id, ficha_critica)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (sitio_id) DO UPDATE SET
       ficha_critica = EXCLUDED.ficha_critica,
       updated_at    = NOW()`,
    [siteId, JSON.stringify(toStore)],
    { name: 'bitacora__patch_ficha' },
  );
  return getFicha(siteId);
}

// ---------------------------------------------------------------------------
// Contactos de la ficha = filas de contacto_operativo scopeadas al sitio.
// Fuente única de esa PII; id estable; vínculo opcional a usuario (usuario_id).
// ---------------------------------------------------------------------------

interface ContactoOperativoRow {
  id: string;
  nombre: string;
  apellido: string | null;
  email: string | null;
  telefono: string | null;
  cargo: string;
  tipo_contacto: string;
}

const CONTACTO_COLS = 'id, nombre, apellido, email, telefono, cargo, tipo_contacto';

function mapContacto(row: ContactoOperativoRow): FichaContacto {
  return {
    id: String(row.id),
    nombre: [row.nombre, row.apellido]
      .filter((s) => s && s.trim())
      .join(' ')
      .trim(),
    rol: row.tipo_contacto,
    telefono: row.telefono,
    email: row.email,
  };
}

export async function listContactos(siteId: string): Promise<FichaContacto[]> {
  const r = await query<ContactoOperativoRow>(
    `SELECT ${CONTACTO_COLS} FROM contacto_operativo
      WHERE sitio_id = $1 ORDER BY nombre ASC, id ASC`,
    [siteId],
    { name: 'bitacora__list_contactos' },
  );
  return r.rows.map(mapContacto);
}

/** Devuelve el sitio_id de un contacto (para autorización por :id). */
export async function findContactoSitioId(id: number): Promise<string | null> {
  const r = await query<{ sitio_id: string | null }>(
    `SELECT sitio_id FROM contacto_operativo WHERE id = $1`,
    [id],
    { name: 'bitacora__contacto_sitio_id' },
  );
  return r.rows[0]?.sitio_id ?? null;
}

/** tel/email reales de un contacto (para el endpoint de reveal con 2FA). */
export async function getContactoPII(
  id: number,
): Promise<{ nombre: string; telefono: string | null; email: string | null } | null> {
  const r = await query<ContactoOperativoRow>(
    `SELECT ${CONTACTO_COLS} FROM contacto_operativo WHERE id = $1`,
    [id],
    { name: 'bitacora__contacto_pii' },
  );
  const row = r.rows[0];
  if (!row) return null;
  return { nombre: mapContacto(row).nombre, telefono: row.telefono, email: row.email };
}

export async function insertContactoSitio(input: {
  siteId: string;
  nombre: string;
  rol: string;
  telefono: string | null;
  email: string | null;
}): Promise<FichaContacto> {
  const r = await query<ContactoOperativoRow>(
    `INSERT INTO contacto_operativo
       (empresa_id, sub_empresa_id, sitio_id, nombre, apellido, email, telefono, cargo, tipo_contacto)
     SELECT s.empresa_id, s.sub_empresa_id, s.id, $2, '', $5, $4, $3,
            CASE WHEN $3 = 'Responsable' THEN 'Responsable' ELSE 'Operacion' END
       FROM sitio s WHERE s.id = $1
     RETURNING ${CONTACTO_COLS}`,
    [input.siteId, input.nombre, input.rol, input.telefono, input.email],
    { name: 'bitacora__insert_contacto' },
  );
  const row = r.rows[0];
  if (!row) throw new Error('No se pudo crear el contacto (¿sitio inexistente?)');
  return mapContacto(row);
}

/**
 * Actualiza un contacto por id. tel/email null/undefined PRESERVAN el valor
 * guardado (no se borra por venir enmascarado desde el cliente).
 */
export async function updateContactoSitio(
  id: number,
  partial: { nombre?: string; rol?: string; telefono?: string | null; email?: string | null },
): Promise<FichaContacto | null> {
  const r = await query<ContactoOperativoRow>(
    `UPDATE contacto_operativo SET
       nombre        = COALESCE($2, nombre),
       cargo         = COALESCE($3, cargo),
       tipo_contacto = CASE WHEN $3 IS NULL THEN tipo_contacto
                            WHEN $3 = 'Responsable' THEN 'Responsable' ELSE 'Operacion' END,
       telefono      = COALESCE($4, telefono),
       email         = COALESCE($5, email),
       updated_at    = NOW()
     WHERE id = $1
     RETURNING ${CONTACTO_COLS}`,
    [
      id,
      partial.nombre ?? null,
      partial.rol ?? null,
      partial.telefono ?? null,
      partial.email ?? null,
    ],
    { name: 'bitacora__update_contacto' },
  );
  const row = r.rows[0];
  return row ? mapContacto(row) : null;
}

export async function deleteContactoSitio(id: number): Promise<boolean> {
  const r = await query(`DELETE FROM contacto_operativo WHERE id = $1`, [id], {
    name: 'bitacora__delete_contacto',
  });
  return (r.rowCount ?? 0) > 0;
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
  /** Ids de documentos vinculados. bigint[] → pg lo devuelve como string[]. */
  documento_ids: string[];
  created_at: string;
  updated_at: string;
}

const EQUIPO_COLS =
  'id, sitio_id, nombre, modelo, fabricante, serie, ' +
  "to_char(fecha_compra, 'YYYY-MM-DD') AS fecha_compra, " +
  "to_char(garantia_hasta, 'YYYY-MM-DD') AS garantia_hasta, " +
  'estado, notas, documento_ids, created_at, updated_at';

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
  documento_ids?: string[] | undefined;
}): Promise<SitioEquipoRow> {
  const r = await query<SitioEquipoRow>(
    `INSERT INTO sitio_equipo
       (sitio_id, nombre, modelo, fabricante, serie, fecha_compra, garantia_hasta, estado, notas, documento_ids)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
      input.documento_ids ?? [],
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
    documento_ids?: string[] | undefined;
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
    { label: 'bitacora__patch_equipo' },
  );
  return r.rows[0] ?? null;
}

/**
 * De un conjunto de ids de documento, devuelve solo los que existen y
 * pertenecen al sitio. Evita persistir en documento_ids referencias a
 * documentos de otro sitio/empresa (el array no tiene FK que lo impida).
 */
export async function filterDocumentoIdsDelSitio(siteId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const r = await query<{ id: string }>(
    `SELECT id FROM documentos WHERE sitio_id = $1 AND id = ANY($2::bigint[])`,
    [siteId, ids],
    { name: 'bitacora__filter_doc_ids' },
  );
  const validos = new Set(r.rows.map((row) => String(row.id)));
  // Preserva orden de entrada y elimina duplicados.
  return [...new Set(ids)].filter((id) => validos.has(id));
}

/** Devuelve el sitio_id de un equipo (para autorización por :id). */
export async function findEquipoSitioId(id: number): Promise<string | null> {
  const r = await query<{ sitio_id: string }>(
    `SELECT sitio_id FROM sitio_equipo WHERE id = $1`,
    [id],
    { name: 'bitacora__equipo_sitio_id' },
  );
  return r.rows[0]?.sitio_id ?? null;
}

export async function deleteEquipo(id: number): Promise<boolean> {
  const r = await query(`DELETE FROM sitio_equipo WHERE id = $1`, [id], {
    name: 'bitacora__delete_equipo',
  });
  return (r.rowCount ?? 0) > 0;
}
