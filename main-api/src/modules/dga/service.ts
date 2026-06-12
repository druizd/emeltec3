/**
 * Servicio DGA (modelo redesign 2026-05-17):
 *   - Informantes: pool global CRUD.
 *   - Pozo DGA config: patch parcial con 2FA cuando transport='rest'.
 *   - Review queue.
 *   - Lectura mediciones por sitio.
 *   - Descarga directa CSV desde equipo.
 */
import { ConflictError, NotFoundError } from '../../shared/errors';
import { cache } from '../../config/redis';
import { encryptClave } from './crypto';
import {
  acceptReviewSlotWithValues,
  deleteInformante,
  findInformanteByRut,
  getUltimoEnvioBySite,
  listInformantes,
  listSlotsRequiresReview,
  markReviewSlotFailedManual,
  patchPozoDgaConfig,
  queryDatoDgaBySite,
  upsertInformante,
  type DatoDgaRow,
  type DgaInformanteRow,
  type DgaTransport,
  type PozoDgaConfigRow,
  type ReviewSlotRow,
  type UltimoEnvioRow,
} from './repo';
import { getMappingsBySiteId, getPozoConfigBySiteId, getSiteById } from '../sites/repo';
import { mapHistoricalDashboardRow } from '../sites/service';
import { query as dbQuery } from '../../config/dbHelpers';
import { formatRutForDga } from '../../utils/rut';
import { consultarSnia } from './snia-client';
import type { HistoryEquipoRow } from '../sites/types';
import type { Periodicidad } from './schema';

export type BucketGranularidad = 'minuto' | 'hora' | 'dia' | 'semana' | 'mes';

const BUCKET_TO_INTERVAL: Record<BucketGranularidad, string> = {
  minuto: '1 minute',
  hora: '1 hour',
  dia: '1 day',
  semana: '1 week',
  mes: '1 month',
};

// ============================================================================
// Informantes
// ============================================================================

export interface InformantePublic {
  rut: string;
  referencia: string | null;
  created_at: string;
  updated_at: string;
}

function toInformantePublic(row: DgaInformanteRow): InformantePublic {
  return {
    rut: row.rut,
    referencia: row.referencia,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function getInformantes(): Promise<InformantePublic[]> {
  const rows = await listInformantes();
  return rows.map(toInformantePublic);
}

/**
 * Crear o actualizar informante. Si solo se manda `clave_informante`,
 * actualiza la clave (rotación). Si solo `referencia`, actualiza referencia.
 * En `create` (rut nuevo), `clave_informante` es obligatorio.
 */
export async function upsertInformanteService(input: {
  rut: string;
  clave_informante?: string;
  referencia?: string | null;
}): Promise<InformantePublic> {
  const rut = formatRutForDga(input.rut);
  const existing = await findInformanteByRut(rut);

  let claveCifrada: string;
  if (input.clave_informante) {
    claveCifrada = encryptClave(input.clave_informante);
  } else if (existing) {
    // Rotación parcial: solo referencia, preservar clave actual.
    claveCifrada = existing.clave_informante;
  } else {
    throw new ConflictError('clave_informante requerido al crear nuevo RUT', {
      code: 'DGA_CLAVE_REQUIRED',
    });
  }

  const row = await upsertInformante({
    rut,
    clave_cifrada: claveCifrada,
    referencia: input.referencia === undefined ? (existing?.referencia ?? null) : input.referencia,
  });
  return toInformantePublic(row);
}

export async function deleteInformanteService(rut: string): Promise<void> {
  const ok = await deleteInformante(formatRutForDga(rut));
  if (!ok) throw new NotFoundError('Informante no encontrado');
}

// ============================================================================
// Pozo DGA config
// ============================================================================

export interface PozoDgaConfigPublic {
  sitio_id: string;
  obra_dga: string | null;
  dga_activo: boolean;
  dga_transport: DgaTransport;
  dga_caudal_max_lps: number | null;
  dga_caudal_tolerance_pct: number;
  dga_periodicidad: Periodicidad | null;
  dga_fecha_inicio: string | null;
  dga_hora_inicio: string | null;
  dga_informante_rut: string | null;
  dga_max_retry_attempts: number;
  dga_last_run_at: string | null;
}

function toPozoDgaPublic(row: PozoDgaConfigRow): PozoDgaConfigPublic {
  return {
    sitio_id: row.sitio_id,
    obra_dga: row.obra_dga,
    dga_activo: row.dga_activo,
    dga_transport: row.dga_transport,
    dga_caudal_max_lps: row.dga_caudal_max_lps == null ? null : Number(row.dga_caudal_max_lps),
    dga_caudal_tolerance_pct: Number(row.dga_caudal_tolerance_pct),
    dga_periodicidad: row.dga_periodicidad,
    dga_fecha_inicio: row.dga_fecha_inicio,
    dga_hora_inicio: row.dga_hora_inicio,
    dga_informante_rut: row.dga_informante_rut,
    dga_max_retry_attempts: row.dga_max_retry_attempts,
    dga_last_run_at: row.dga_last_run_at,
  };
}

export async function patchPozoDgaConfigService(
  siteId: string,
  input: {
    dga_activo?: boolean | undefined;
    dga_transport?: DgaTransport | undefined;
    dga_caudal_max_lps?: number | null | undefined;
    dga_caudal_tolerance_pct?: number | undefined;
    dga_periodicidad?: Periodicidad | null | undefined;
    dga_fecha_inicio?: string | null | undefined;
    dga_hora_inicio?: string | null | undefined;
    dga_informante_rut?: string | null | undefined;
    dga_max_retry_attempts?: number | undefined;
  },
): Promise<PozoDgaConfigPublic> {
  // hora_inicio normalizada a HH:MM:00. DGA slots deben caer en minuto exacto
  // para coincidir con buckets de equipo_1min. Segundos se descartan.
  if (input.dga_hora_inicio) {
    const [hh, mm] = input.dga_hora_inicio.split(':');
    input.dga_hora_inicio = `${hh}:${mm}:00`;
  }
  if (input.dga_informante_rut) {
    input.dga_informante_rut = formatRutForDga(input.dga_informante_rut);
  }
  const row = await patchPozoDgaConfig(siteId, input);
  if (!row) {
    throw new NotFoundError(
      'pozo_config no existe para este sitio. Crear el pozo con su config básica primero.',
    );
  }
  return toPozoDgaPublic(row);
}

// ============================================================================
// Review queue
// ============================================================================

export async function listReviewQueue(input: {
  site_id?: string | undefined;
  limit?: number | undefined;
}): Promise<ReviewSlotRow[]> {
  return listSlotsRequiresReview(input);
}

export async function applyReviewDecision(input: {
  site_id: string;
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
      site_id: input.site_id,
      ts: input.ts,
      admin_note: input.admin_note,
    });
    if (!ok) throw new NotFoundError('Slot no está en requires_review o no existe');
    return { ok: true };
  }

  if (!input.values) {
    throw new NotFoundError('values requerido para action=accept');
  }
  const ok = await acceptReviewSlotWithValues({
    site_id: input.site_id,
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

// ============================================================================
// Lectura mediciones por sitio (Detalle de Registros)
// ============================================================================

export async function getDatoDgaBySite(
  siteId: string,
  desde: string,
  hasta: string,
): Promise<DatoDgaRow[]> {
  const cacheKey = `dga:dato:${siteId}:${desde}:${hasta}`;
  if (cache.enabled) {
    const cached = await cache.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as DatoDgaRow[];
      } catch {
        /* ignore */
      }
    }
  }
  const rows = await queryDatoDgaBySite(siteId, desde, hasta);
  if (cache.enabled) {
    await cache.set(cacheKey, JSON.stringify(rows), 300);
  }
  return rows;
}

/**
 * Último envío exitoso a SNIA para el sitio. KPI independiente del filtro
 * de fecha del UI — siempre absolute latest.
 */
export async function getUltimoEnvio(siteId: string): Promise<UltimoEnvioRow | null> {
  return getUltimoEnvioBySite(siteId);
}

// ============================================================================
// Verificación post-envío contra SNIA (Res 2170 §1 GET endpoint)
// ============================================================================

export interface VerifyResult {
  status: 'verified' | 'not_found' | 'mismatch' | 'error';
  comprobante: string;
  /** Mensaje SNIA o detalle del problema. */
  message: string | null;
  /** Valores guardados en BD al momento del envío. */
  stored: {
    fechaMedicion: string;
    horaMedicion: string;
    caudal: string | null;
    totalizador: string | null;
    nivelFreaticoDelPozo: string | null;
  };
  /** Valores devueltos por SNIA en el GET. Null si SNIA no devolvió data. */
  remote: {
    fechaMedicion: string | null;
    horaMedicion: string | null;
    caudal: string | null;
    totalizador: string | null;
    nivelFreaticoDelPozo: string | null;
  } | null;
  /** Diferencias campo a campo si hay mismatch. */
  diffs: string[];
  duration_ms: number;
}

/**
 * Verifica que una medición enviada a SNIA realmente quedó registrada
 * (Res 2170 §1: "es importante el uso de esta herramienta que le permitirá
 * comprobar aquello").
 *
 * Flujo:
 *   1. Busca el audit OK más reciente para (siteId, ts) en dga_send_audit.
 *   2. Llama GET SNIA con codigoObra + comprobante.
 *   3. Compara valores devueltos vs request_payload original.
 *
 * Devuelve `verified` si todo coincide, `mismatch` si SNIA tiene valores
 * distintos, `not_found` si SNIA no encuentra el comprobante, `error` si
 * hubo fallo de red u otro.
 */
export async function verifySniaSubmission(
  siteId: string,
  ts: string,
): Promise<VerifyResult | null> {
  const audit = await dbQuery<{
    api_n_comprobante: string;
    request_payload: Record<string, unknown> | null;
    codigo_obra: string | null;
  }>(
    `SELECT a.api_n_comprobante, a.request_payload, pc.obra_dga AS codigo_obra
       FROM dga_send_audit a
       JOIN pozo_config pc ON pc.sitio_id = a.site_id
      WHERE a.site_id = $1
        AND a.ts = $2::timestamptz
        AND a.dga_status_code = '00'
        AND a.api_n_comprobante IS NOT NULL
      ORDER BY a.sent_at DESC
      LIMIT 1`,
    [siteId, ts],
    { name: 'dga__find_audit_for_verify' },
  );

  const row = audit.rows[0];
  if (!row || !row.codigo_obra) return null;

  const payload = row.request_payload as {
    medicionSubterranea?: Record<string, string | null>;
  } | null;
  const med = payload?.medicionSubterranea ?? {};

  const stored = {
    fechaMedicion: (med['fechaMedicion'] as string) ?? '',
    horaMedicion: (med['horaMedicion'] as string) ?? '',
    caudal: (med['caudal'] as string) ?? null,
    totalizador: (med['totalizador'] as string) ?? null,
    nivelFreaticoDelPozo: (med['nivelFreaticoDelPozo'] as string) ?? null,
  };

  const result = await consultarSnia(row.codigo_obra, row.api_n_comprobante);

  if (!result.ok) {
    if (result.dga_status_code && result.dga_status_code !== '00') {
      return {
        status: 'not_found',
        comprobante: row.api_n_comprobante,
        message: result.dga_message ?? `SNIA respondió status=${result.dga_status_code}`,
        stored,
        remote: null,
        diffs: [],
        duration_ms: result.duration_ms,
      };
    }
    return {
      status: 'error',
      comprobante: row.api_n_comprobante,
      message: result.dga_message ?? 'fallo consulta SNIA',
      stored,
      remote: null,
      diffs: [],
      duration_ms: result.duration_ms,
    };
  }

  // SNIA devuelve fechaMedicion como DD-MM-YYYY en GET (anomalía Res 2170).
  // Convertimos a YYYY-MM-DD para comparar con stored.
  const remoteFechaIso = result.data?.fechaMedicion
    ? remoteDateToIso(result.data.fechaMedicion)
    : null;

  const remote = {
    fechaMedicion: remoteFechaIso,
    horaMedicion: result.data?.horaMedicion ?? null,
    caudal: result.data?.caudal ?? null,
    totalizador: result.data?.totalizador ?? null,
    nivelFreaticoDelPozo: result.data?.nivelFreaticoDelPozo ?? null,
  };

  const diffs: string[] = [];
  if (stored.fechaMedicion && remote.fechaMedicion !== stored.fechaMedicion) {
    diffs.push(`fechaMedicion: stored=${stored.fechaMedicion} remote=${remote.fechaMedicion}`);
  }
  if (stored.horaMedicion && remote.horaMedicion !== stored.horaMedicion) {
    diffs.push(`horaMedicion: stored=${stored.horaMedicion} remote=${remote.horaMedicion}`);
  }
  if (stored.caudal !== null && remote.caudal !== stored.caudal) {
    diffs.push(`caudal: stored=${stored.caudal} remote=${remote.caudal}`);
  }
  if (stored.totalizador !== null && remote.totalizador !== stored.totalizador) {
    diffs.push(`totalizador: stored=${stored.totalizador} remote=${remote.totalizador}`);
  }
  // nivelFreaticoDelPozo puede venir vacío legítimamente (pozos muy
  // pequeños / minero — Res 2170 §4); solo flag si ambos no-vacío y difieren.
  if (
    stored.nivelFreaticoDelPozo &&
    remote.nivelFreaticoDelPozo &&
    remote.nivelFreaticoDelPozo !== stored.nivelFreaticoDelPozo
  ) {
    diffs.push(
      `nivelFreaticoDelPozo: stored=${stored.nivelFreaticoDelPozo} remote=${remote.nivelFreaticoDelPozo}`,
    );
  }

  return {
    status: diffs.length === 0 ? 'verified' : 'mismatch',
    comprobante: row.api_n_comprobante,
    message: result.dga_message,
    stored,
    remote,
    diffs,
    duration_ms: result.duration_ms,
  };
}

function remoteDateToIso(raw: string): string {
  // SNIA GET devuelve DD-MM-YYYY. Convertir a YYYY-MM-DD.
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(raw);
  if (!m) return raw;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

// ============================================================================
// Descarga directa CSV desde equipo (sin pasar por dato_dga)
// ============================================================================

function numericOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function utcToChileFecha(iso: string): string {
  const d = new Date(iso);
  d.setUTCHours(d.getUTCHours() - 4);
  return d.toISOString().slice(0, 10);
}

function utcToChileHora(iso: string): string {
  const d = new Date(iso);
  d.setUTCHours(d.getUTCHours() - 4);
  return d.toISOString().slice(11, 19);
}

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

  return rawRows
    .slice()
    .reverse()
    .map((raw) => {
      const mapped = mapHistoricalDashboardRow({ row: raw, site, mappings, pozoConfig });
      const ts =
        mapped.timestamp ??
        (typeof raw.time === 'string' ? raw.time : new Date(raw.time).toISOString());
      return {
        site_id: site.id,
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
}

function stringifyNumeric(value: number | null): string | null {
  if (value === null) return null;
  return value.toString();
}

// ============================================================================
// Live preview (Datos en vivo en modal DGA)
// ============================================================================

export interface DgaLivePreview {
  /** Hora UTC del último dato disponible. null si pozo nunca reportó. */
  ts: string | null;
  /** Edad del dato en segundos. */
  age_seconds: number | null;
  /** Strings exactos que se enviarían a SNIA. null si no hay dato. */
  fechaMedicion: string | null;
  horaMedicion: string | null;
  caudal: string | null;
  totalizador: string | null;
  nivelFreaticoDelPozo: string;
}

/**
 * Construye una preview formateada como SNIA recibiría si reportáramos
 * ahora con la última lectura del pozo. Sin enviar nada — solo mostrar.
 */
export async function getDgaLivePreview(siteId: string): Promise<DgaLivePreview> {
  const site = await getSiteById(siteId);
  if (!site) throw new NotFoundError('Sitio no encontrado');

  if (!site.id_serial) {
    return {
      ts: null,
      age_seconds: null,
      fechaMedicion: null,
      horaMedicion: null,
      caudal: null,
      totalizador: null,
      nivelFreaticoDelPozo: '',
    };
  }

  const [pozoConfig, mappings, latestRes] = await Promise.all([
    getPozoConfigBySiteId(siteId),
    getMappingsBySiteId(siteId),
    dbQuery<HistoryEquipoRow>(
      `SELECT time, received_at, id_serial, data
         FROM equipo
        WHERE id_serial = $1
        ORDER BY time DESC
        LIMIT 1`,
      [site.id_serial],
      { name: 'dga__latest_equipo' },
    ),
  ]);

  const latest = latestRes.rows[0];
  if (!latest) {
    return {
      ts: null,
      age_seconds: null,
      fechaMedicion: null,
      horaMedicion: null,
      caudal: null,
      totalizador: null,
      nivelFreaticoDelPozo: '',
    };
  }

  const mapped = mapHistoricalDashboardRow({
    row: latest,
    site,
    mappings,
    pozoConfig,
  });
  const tsIso = typeof latest.time === 'string' ? latest.time : new Date(latest.time).toISOString();
  const ageSec = Math.max(0, Math.round((Date.now() - new Date(tsIso).getTime()) / 1000));

  const caudal = numericOrNull(mapped.caudal.valor);
  const totRaw = numericOrNull(mapped.totalizador.valor);
  const totTrunc = totRaw == null ? null : Math.trunc(totRaw);
  const nivel = numericOrNull(mapped.nivel_freatico.valor);

  return {
    ts: tsIso,
    age_seconds: ageSec,
    fechaMedicion: utcToChileFecha(tsIso),
    horaMedicion: utcToChileHora(tsIso),
    caudal: caudal == null ? null : caudal.toFixed(2),
    totalizador: totTrunc == null ? null : String(totTrunc),
    nivelFreaticoDelPozo: nivel == null ? '' : nivel.toFixed(2),
  };
}

// ============================================================================
// CSV writer (legacy descarga)
// ============================================================================

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
  const num = Number(value);
  if (Number.isFinite(num)) {
    return String(parseFloat(num.toFixed(2))).replace('.', ',');
  }
  return String(value).replace('.', ',');
}
