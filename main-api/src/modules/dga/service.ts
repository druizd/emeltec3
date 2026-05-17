/**
 * Servicio DGA: alta de informante + lectura de mediciones procesadas.
 * El insert de dato_dga lo hace el worker (modules/dga/worker.ts), no
 * exponemos endpoint manual: el flujo es completamente automático.
 */
import { ConflictError, NotFoundError } from '../../shared/errors';
import { encryptClave } from './crypto';
import {
  acceptReviewSlotWithValues,
  findDgaUserById,
  insertDgaUser,
  listDgaUsersBySite,
  listSlotsRequiresReview,
  markReviewSlotFailedManual,
  queryDatoDga,
  queryDatoDgaBySite,
  updateDgaUserConfig,
  type DatoDgaRow,
  type DgaUserRow,
  type ReviewSlotRow,
} from './repo';
import { getMappingsBySiteId, getPozoConfigBySiteId, getSiteById } from '../sites/repo';
import { mapHistoricalDashboardRow } from '../sites/service';
import { query as dbQuery } from '../../config/dbHelpers';
import type { HistoryEquipoRow } from '../sites/types';

export type BucketGranularidad = 'minuto' | 'hora' | 'dia' | 'semana' | 'mes';

const BUCKET_TO_INTERVAL: Record<BucketGranularidad, string> = {
  minuto: '1 minute',
  hora: '1 hour',
  dia: '1 day',
  semana: '1 week',
  mes: '1 month',
};
import type { CreateDgaUserPayload } from './schema';

export interface DgaUserPublic {
  id_dgauser: string;
  site_id: string;
  nombre_informante: string;
  rut_informante: string;
  periodicidad: string;
  fecha_inicio: string;
  hora_inicio: string;
  last_run_at: string | null;
  activo: boolean;
  transport: 'off' | 'shadow' | 'rest';
  caudal_max_lps: number | null;
  caudal_tolerance_pct: number;
  max_retry_attempts: number;
  created_at: string;
  updated_at: string;
}

function toPublic(row: DgaUserRow): DgaUserPublic {
  return {
    id_dgauser: row.id_dgauser,
    site_id: row.site_id,
    nombre_informante: row.nombre_informante,
    rut_informante: row.rut_informante,
    periodicidad: row.periodicidad,
    fecha_inicio: row.fecha_inicio,
    hora_inicio: row.hora_inicio,
    last_run_at: row.last_run_at,
    activo: row.activo,
    transport: row.transport,
    caudal_max_lps: row.caudal_max_lps == null ? null : Number(row.caudal_max_lps),
    caudal_tolerance_pct: Number(row.caudal_tolerance_pct),
    max_retry_attempts: row.max_retry_attempts,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Patch parcial de la config DGA. Aplica los cambios y devuelve la versión
 * pública actualizada. Lanza NotFoundError si el informante no existe.
 */
export async function patchDgaUserConfig(
  idDgaUser: number,
  input: {
    activo?: boolean | undefined;
    transport?: 'off' | 'shadow' | 'rest' | undefined;
    caudal_max_lps?: number | null | undefined;
    caudal_tolerance_pct?: number | undefined;
  },
): Promise<DgaUserPublic> {
  const row = await updateDgaUserConfig(idDgaUser, input);
  if (!row) throw new NotFoundError('Informante DGA no encontrado');
  return toPublic(row);
}

export async function createDgaUser(input: CreateDgaUserPayload): Promise<DgaUserPublic> {
  const claveCifrada = encryptClave(input.clave_informante);
  try {
    const row = await insertDgaUser({
      site_id: input.site_id,
      nombre_informante: input.nombre_informante,
      rut_informante: input.rut_informante,
      clave_cifrada: claveCifrada,
      periodicidad: input.periodicidad,
      fecha_inicio: input.fecha_inicio,
      hora_inicio: input.hora_inicio.length === 5 ? `${input.hora_inicio}:00` : input.hora_inicio,
    });
    return toPublic(row);
  } catch (err: unknown) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: string }).code === '23505'
    ) {
      throw new ConflictError('Ya existe un informante para ese sitio y RUT', {
        code: 'DGA_USER_DUPLICATE',
      });
    }
    throw err;
  }
}

/**
 * Lista los slots del review queue. Si site_id se pasa, filtra por sitio.
 */
export async function listReviewQueue(input: {
  site_id?: string | undefined;
  limit?: number | undefined;
}): Promise<ReviewSlotRow[]> {
  return listSlotsRequiresReview(input);
}

/**
 * Aplica decisión admin sobre un slot. Si action='accept', actualiza
 * valores y promueve a pendiente. Si action='discard', marca fallido.
 * En ambos casos agrega un warning sintético registrando la decisión.
 */
export async function applyReviewDecision(input: {
  id_dgauser: number;
  ts: string;
  action: 'accept' | 'discard';
  values?:
    | {
        caudal_instantaneo?: number | null | undefined;
        flujo_acumulado?: number | null | undefined;
        nivel_freatico?: number | null | undefined;
      }
    | undefined;
  admin_note: string;
}): Promise<{ ok: boolean }> {
  if (input.action === 'discard') {
    const ok = await markReviewSlotFailedManual({
      id_dgauser: input.id_dgauser,
      ts: input.ts,
      admin_note: input.admin_note,
    });
    if (!ok) throw new NotFoundError('Slot no está en requires_review o no existe');
    return { ok: true };
  }

  // accept: requiere los valores finales explícitos.
  if (!input.values) {
    throw new NotFoundError('values requerido para action=accept');
  }
  const ok = await acceptReviewSlotWithValues({
    id_dgauser: input.id_dgauser,
    ts: input.ts,
    caudal_instantaneo: input.values.caudal_instantaneo ?? null,
    flujo_acumulado:
      input.values.flujo_acumulado == null ? null : Math.trunc(input.values.flujo_acumulado),
    nivel_freatico: input.values.nivel_freatico ?? null,
    admin_note: input.admin_note,
  });
  if (!ok) throw new NotFoundError('Slot no está en requires_review o no existe');
  return { ok: true };
}

export async function getDgaUsersBySite(siteId: string): Promise<DgaUserPublic[]> {
  const rows = await listDgaUsersBySite(siteId);
  return rows.map(toPublic);
}

export async function getDatoDga(
  idDgaUser: number,
  desde: string,
  hasta: string,
): Promise<DatoDgaRow[]> {
  const user = await findDgaUserById(idDgaUser);
  if (!user) throw new NotFoundError('Informante DGA no encontrado');
  return queryDatoDga(idDgaUser, desde, hasta);
}

export async function getDatoDgaBySite(
  siteId: string,
  desde: string,
  hasta: string,
): Promise<DatoDgaRow[]> {
  return queryDatoDgaBySite(siteId, desde, hasta);
}

function numericOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function utcToChileFecha(iso: string): string {
  // UTC → UTC-4 chileno (offset fijo, sin DST)
  const d = new Date(iso);
  d.setUTCHours(d.getUTCHours() - 4);
  return d.toISOString().slice(0, 10);
}

function utcToChileHora(iso: string): string {
  const d = new Date(iso);
  d.setUTCHours(d.getUTCHours() - 4);
  return d.toISOString().slice(11, 19);
}

/**
 * Genera filas DGA leyendo directo de `equipo` y aplicando las transformaciones
 * existentes del dashboard (caudal, totalizador, nivel_freatico). No depende de
 * `dato_dga` ni de informantes registrados. Ideal para descarga manual del dueño.
 */
async function fetchEquipoBucketed(
  serialId: string,
  fromIso: string,
  toIso: string,
  bucket: BucketGranularidad,
): Promise<HistoryEquipoRow[]> {
  const interval = BUCKET_TO_INTERVAL[bucket];
  const r = await dbQuery<HistoryEquipoRow>(
    `SELECT time, received_at, id_serial, data
       FROM (
         SELECT DISTINCT ON (time_bucket($4::interval, time))
           time, received_at, id_serial, data
         FROM equipo
         WHERE id_serial = $1
           AND time >= $2::timestamptz
           AND time <  $3::timestamptz
         ORDER BY time_bucket($4::interval, time) DESC, time ASC
       ) latest_by_bucket
      ORDER BY time DESC`,
    [serialId, fromIso, toIso, interval],
    { name: 'dga__equipo_bucketed' },
  );
  return r.rows;
}

export async function getDatoDgaDirectoFromEquipo(
  siteId: string,
  desdeIso: string,
  hastaIso: string,
  bucket: BucketGranularidad = 'hora',
): Promise<DatoDgaRow[]> {
  const site = await getSiteById(siteId);
  if (!site) throw new NotFoundError('Sitio no encontrado');
  if (!site.id_serial) return [];

  const [pozoConfig, mappings, rawRows] = await Promise.all([
    getPozoConfigBySiteId(siteId),
    getMappingsBySiteId(siteId),
    fetchEquipoBucketed(site.id_serial, desdeIso, hastaIso, bucket),
  ]);

  const obra = pozoConfig?.obra_dga?.trim() || site.descripcion;

  // Repo devuelve DESC; DGA exige cronológico ASC.
  const processed = rawRows
    .slice()
    .reverse()
    .map((raw) => {
      const mapped = mapHistoricalDashboardRow({ row: raw, site, mappings, pozoConfig });
      const ts =
        mapped.timestamp ??
        (typeof raw.time === 'string' ? raw.time : new Date(raw.time).toISOString());
      return {
        id_dgauser: '',
        obra,
        ts,
        fecha: utcToChileFecha(ts),
        hora: utcToChileHora(ts),
        caudal_instantaneo: stringifyNumeric(numericOrNull(mapped.caudal.valor)),
        flujo_acumulado: stringifyNumeric(numericOrNull(mapped.totalizador.valor)),
        nivel_freatico: stringifyNumeric(numericOrNull(mapped.nivel_freatico.valor)),
        // Filas sintetizadas desde equipo (sin pipeline DGA): no tienen estado real.
        estatus: 'vacio',
        comprobante: null,
      } satisfies DatoDgaRow;
    });
  return processed;
}

function stringifyNumeric(value: number | null): string | null {
  if (value === null) return null;
  return value.toString();
}

export function toCsv(rows: DatoDgaRow[]): string {
  const header = 'OBRA;FECHA;HORA;CAUDAL_INSTANTANEO;FLUJO_ACUMULADO;NIVEL_FREATICO';
  const lines = rows.map((r) => {
    const fields = [
      escapeCsv(r.obra),
      r.fecha,
      r.hora,
      formatNumber(r.caudal_instantaneo),
      formatNumber(r.flujo_acumulado),
      formatNumber(r.nivel_freatico),
    ];
    return fields.join(';');
  });
  return [header, ...lines].join('\r\n');
}

function escapeCsv(value: string): string {
  if (value.includes(';') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatNumber(value: string | null): string {
  if (value === null || value === undefined) return '';
  return String(value).replace('.', ',');
}
