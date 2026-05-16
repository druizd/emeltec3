/**
 * Servicio del modulo contadores: calcula el delta mensual de una variable
 * contador iterando las filas del hypertable `equipo`, aplicando la
 * transformacion configurada en reg_map (reusa modules/sites/transforms.ts) y
 * sumando segmentos cuando detecta resets (overflow uint32, reemplazo sensor).
 *
 * Las llamadas a este modulo son intensivas: las hace el worker cada hora y el
 * script de backfill al arranque. El endpoint HTTP lee la tabla materializada
 * `site_contador_mensual`, pero refresca lazy el mes actual si la fila esta
 * stale (>1h) o ausente — para que el grafico muestre datos sin esperar al
 * proximo ciclo del worker.
 */
import { logger } from '../../config/logger';
import { query } from '../../config/dbHelpers';
import { applyMappingTransform } from '../sites/transforms';
import { getPozoConfigBySiteId } from '../sites/repo';
import type { PozoConfig, RegMap } from '../sites/types';
import {
  getMappingsBySiteId,
  getSiteById,
  listContadoresBySiteAndRol,
  listCounterVariablesForSite,
  type CounterVariable,
  upsertContadorMensual,
} from './repo';
import type {
  ContadorDiarioPoint,
  ContadorJornadaPoint,
  ContadorMensualPoint,
  MonthDeltaResult,
} from './types';

const LAZY_REFRESH_STALE_MS = 60 * 60 * 1000;

/**
 * Normaliza el campo `mes` a 'YYYY-MM-DD'. node-pg parsea columnas DATE como
 * Date object — `String(date).slice(0,10)` da el dia local de la TZ del proceso
 * ("Thu Apr 30" cuando deberia ser "2026-05-01"), por eso convertimos via UTC.
 */
function mesToIsoDay(mes: unknown): string {
  if (mes instanceof Date) return mes.toISOString().slice(0, 10);
  return String(mes).slice(0, 10);
}

export const CHILE_TZ = 'America/Santiago';

/**
 * Devuelve `[start, end)` del mes que contiene a `ref` en zona Chile, como
 * Date UTC. start = primer minuto del mes; end = primer minuto del mes
 * siguiente. Sirve para queries que comparan contra `time` (TIMESTAMPTZ).
 */
export function getMonthRangeChile(ref: Date): { start: Date; end: Date; mesIso: string } {
  // Reconstruimos la fecha en zona Chile, luego ajustamos al primer dia del mes.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: CHILE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(ref);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  // Construimos timestamps UTC interpretando la fecha como Chile (UTC-4 / UTC-3).
  // Simpler & robust: ISO con offset fijo -04:00 — el codigo del repo asume eso.
  const start = new Date(`${year}-${String(month).padStart(2, '0')}-01T00:00:00-04:00`);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const end = new Date(`${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00-04:00`);
  const mesIso = `${year}-${String(month).padStart(2, '0')}-01`;
  return { start, end, mesIso };
}

/**
 * Devuelve `[start, end)` del dia que contiene a `ref` en zona Chile, como
 * Date UTC. start = 00:00 del dia; end = 00:00 del dia siguiente. diaIso
 * = 'YYYY-MM-DD' en zona Chile.
 */
export function getDayRangeChile(ref: Date): { start: Date; end: Date; diaIso: string } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: CHILE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(ref);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const day = Number(parts.find((p) => p.type === 'day')?.value);
  const diaIso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const start = new Date(`${diaIso}T00:00:00-04:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end, diaIso };
}

/**
 * Devuelve `chileDayKey('YYYY-MM-DD')` para un timestamp arbitrario.
 */
export function chileDayKey(ref: Date): string {
  return getDayRangeChile(ref).diaIso;
}

/**
 * Lista los inicios de dia (Chile) de los ultimos `n` dias inclusive hoy,
 * del mas antiguo al mas reciente.
 */
export function lastNDays(n: number, ref: Date = new Date()): Date[] {
  const result: Date[] = [];
  const today = getDayRangeChile(ref).start;
  for (let i = n - 1; i >= 0; i--) {
    result.push(new Date(today.getTime() - i * 24 * 60 * 60 * 1000));
  }
  return result;
}

/**
 * Lista los inicios de mes (Chile) de los ultimos `n` meses inclusive el actual,
 * de mas antiguo a mas reciente.
 */
export function lastNMonths(n: number, ref: Date = new Date()): Date[] {
  const result: Date[] = [];
  const current = getMonthRangeChile(ref).start;
  const baseYear = current.getUTCFullYear();
  const baseMonth = current.getUTCMonth(); // 0-indexed
  for (let i = n - 1; i >= 0; i--) {
    const m = baseMonth - i;
    // Mediodia UTC para que la fecha caiga en el dia 1 del mes en Chile (UTC-4/-3).
    const date = new Date(Date.UTC(baseYear, m, 1, 12));
    result.push(getMonthRangeChile(date).start);
  }
  return result;
}

/**
 * Itera filas de `equipo` del mes en orden cronologico ascendente, aplica la
 * transformacion configurada y suma los segmentos positivos (manejando resets).
 *
 * Streaming via cursor para no cargar 43k+ filas/mes en memoria.
 */
export async function computeMonthDeltaForVariable(opts: {
  idSerial: string;
  mapping: RegMap;
  pozoConfig: PozoConfig | null;
  start: Date;
  end: Date;
}): Promise<MonthDeltaResult> {
  const { idSerial, mapping, pozoConfig, start, end } = opts;

  // Usamos time_bucket de 1 minuto: bajo riesgo de perder eventos cortos y
  // reduce ~60x el volumen vs leer toda la cruda.
  const result = await query<{ time: string; data: Record<string, unknown> }>(
    `
    SELECT time_bucket('1 minute', time) AS time, last(data, time) AS data
    FROM equipo
    WHERE id_serial = $1
      AND time >= $2::timestamptz
      AND time <  $3::timestamptz
    GROUP BY 1
    ORDER BY 1 ASC
    `,
    [idSerial, start.toISOString(), end.toISOString()],
    { label: 'contadores__month_rows' },
  );

  let valorInicio: number | null = null;
  let prev: number | null = null;
  let segmentBase: number | null = null;
  let suma = 0;
  let resets = 0;
  let muestras = 0;
  let valorFin: number | null = null;
  let ultimoDato: string | null = null;

  for (const row of result.rows) {
    let v: number | null = null;
    try {
      const raw = applyMappingTransform({ rawData: row.data, mapping, pozoConfig });
      v = typeof raw === 'number' && Number.isFinite(raw) ? raw : Number(raw);
      if (!Number.isFinite(v)) v = null;
    } catch {
      v = null;
    }
    if (v === null) continue;
    muestras++;
    ultimoDato = row.time;

    if (valorInicio === null) valorInicio = v;
    if (segmentBase === null) segmentBase = v;

    if (prev !== null && v < prev) {
      // reset: cierra el segmento anterior y abre uno nuevo.
      suma += prev - segmentBase;
      segmentBase = v;
      resets++;
    }
    prev = v;
    valorFin = v;
  }

  if (segmentBase !== null && valorFin !== null) {
    suma += valorFin - segmentBase;
  }

  const delta = muestras === 0 ? null : Math.max(0, suma);

  return {
    valor_inicio: valorInicio,
    valor_fin: valorFin,
    delta,
    muestras,
    resets_detectados: resets,
    ultimo_dato: ultimoDato,
  };
}

/**
 * Computa deltas diarios para una variable contador en el rango [start, end).
 * Single query + bucket por dia Chile + algoritmo segmento/reset por dia.
 *
 * Returns map dia_iso -> { delta, muestras, ultimo_dato, resets }
 */
export async function computeDailyDeltasForVariable(opts: {
  idSerial: string;
  mapping: RegMap;
  pozoConfig: PozoConfig | null;
  start: Date;
  end: Date;
}): Promise<Map<string, MonthDeltaResult>> {
  const { idSerial, mapping, pozoConfig, start, end } = opts;

  const result = await query<{ time: string; data: Record<string, unknown> }>(
    `
    SELECT time_bucket('1 minute', time) AS time, last(data, time) AS data
    FROM equipo
    WHERE id_serial = $1
      AND time >= $2::timestamptz
      AND time <  $3::timestamptz
    GROUP BY 1
    ORDER BY 1 ASC
    `,
    [idSerial, start.toISOString(), end.toISOString()],
    { label: 'contadores__day_rows' },
  );

  // Bucket por dia Chile. Cada dia corre su propio algoritmo de segmentos.
  interface DayAccum {
    valorInicio: number | null;
    prev: number | null;
    segmentBase: number | null;
    suma: number;
    resets: number;
    muestras: number;
    valorFin: number | null;
    ultimoDato: string | null;
  }
  const byDay = new Map<string, DayAccum>();

  for (const row of result.rows) {
    let v: number | null = null;
    try {
      const raw = applyMappingTransform({ rawData: row.data, mapping, pozoConfig });
      v = typeof raw === 'number' && Number.isFinite(raw) ? raw : Number(raw);
      if (!Number.isFinite(v)) v = null;
    } catch {
      v = null;
    }
    if (v === null) continue;

    const dayKey = chileDayKey(new Date(row.time));
    let acc = byDay.get(dayKey);
    if (!acc) {
      acc = {
        valorInicio: null,
        prev: null,
        segmentBase: null,
        suma: 0,
        resets: 0,
        muestras: 0,
        valorFin: null,
        ultimoDato: null,
      };
      byDay.set(dayKey, acc);
    }

    acc.muestras++;
    acc.ultimoDato = row.time;
    if (acc.valorInicio === null) acc.valorInicio = v;
    if (acc.segmentBase === null) acc.segmentBase = v;
    if (acc.prev !== null && v < acc.prev) {
      acc.suma += acc.prev - acc.segmentBase;
      acc.segmentBase = v;
      acc.resets++;
    }
    acc.prev = v;
    acc.valorFin = v;
  }

  const out = new Map<string, MonthDeltaResult>();
  for (const [day, acc] of byDay.entries()) {
    if (acc.segmentBase !== null && acc.valorFin !== null) {
      acc.suma += acc.valorFin - acc.segmentBase;
    }
    out.set(day, {
      valor_inicio: acc.valorInicio,
      valor_fin: acc.valorFin,
      delta: acc.muestras === 0 ? null : Math.max(0, acc.suma),
      muestras: acc.muestras,
      resets_detectados: acc.resets,
      ultimo_dato: acc.ultimoDato,
    });
  }

  return out;
}

/**
 * Devuelve la serie diaria lista para el chart: ultimos `dias` puntos.
 *
 * Computa on-demand desde el hypertable `equipo` (no hay tabla materializada
 * diaria). Costo: ~1s por 30 dias con un sitio que sampla a 1/min.
 *
 * Solo procesa la primera variable contador del sitio con `rol` match.
 */
export async function getDailySeries(opts: {
  sitioId: string;
  rol: string;
  dias: number;
}): Promise<ContadorDiarioPoint[]> {
  const { sitioId, rol, dias } = opts;

  const counters = await listCounterVariablesForSite(sitioId);
  const counter = counters.find((c) => c.rol === rol && c.id_serial);
  if (!counter || !counter.id_serial) return emptyDailySeries(dias);

  const mappings = await getMappingsBySiteId(sitioId);
  const mapping = mappings.find((m) => m.id === counter.variable_id);
  if (!mapping) return emptyDailySeries(dias);

  const site = await getSiteById(sitioId);
  const pozoConfig = site?.tipo_sitio === 'pozo' ? await getPozoConfigBySiteId(sitioId) : null;

  const days = lastNDays(dias);
  if (days.length === 0) return [];
  const firstDay = days[0]!;
  const lastDay = days[days.length - 1]!;
  const start = getDayRangeChile(firstDay).start;
  const end = getDayRangeChile(lastDay).end;

  const deltasByDay = await computeDailyDeltasForVariable({
    idSerial: counter.id_serial,
    mapping,
    pozoConfig,
    start,
    end,
  });

  return days.map((dayStart) => {
    const diaIso = getDayRangeChile(dayStart).diaIso;
    const r = deltasByDay.get(diaIso);
    return {
      dia: diaIso,
      delta: r?.delta ?? null,
      unidad: counter.unidad,
      muestras: r?.muestras ?? 0,
      ultimo_dato: r?.ultimo_dato ?? null,
      resets_detectados: r?.resets_detectados ?? 0,
    };
  });
}

function emptyDailySeries(dias: number): ContadorDiarioPoint[] {
  return lastNDays(dias).map((dayStart) => ({
    dia: getDayRangeChile(dayStart).diaIso,
    delta: null,
    unidad: null,
    muestras: 0,
    ultimo_dato: null,
    resets_detectados: 0,
  }));
}

function parseHHMMToMinutes(hhmm: string): number {
  const parts = hhmm.split(':').map(Number);
  const h = parts[0] ?? NaN;
  const m = parts[1] ?? NaN;
  if (Number.isNaN(h) || Number.isNaN(m)) throw new Error(`hora invalida: ${hhmm}`);
  return h * 60 + m;
}

/**
 * Computa deltas por jornada (ventana inicio→fin configurable, posiblemente
 * cruzando medianoche) para una variable contador, sobre los `dias` ultimos
 * dias Chile.
 *
 * Single query cubriendo todo el rango global, despues bucket por jornada
 * usando shift-by-startMin (un row pertenece a jornada i si su tiempo desplazado
 * por -startMin cae en el dia chile de days[i]).
 */
export async function computeJornadasForVariable(opts: {
  idSerial: string;
  mapping: RegMap;
  pozoConfig: PozoConfig | null;
  days: Date[];
  inicio: string; // 'HH:MM'
  fin: string; // 'HH:MM'
}): Promise<Map<string, MonthDeltaResult>> {
  const { idSerial, mapping, pozoConfig, days, inicio, fin } = opts;
  const startMin = parseHHMMToMinutes(inicio);
  const finMin = parseHHMMToMinutes(fin);

  // Largo de jornada: same-day, cross-midnight, o exact-24h cuando inicio==fin.
  const DAY_MS = 24 * 60 * 60_000;
  const startMs = startMin * 60_000;
  const finMs = finMin * 60_000;
  const jornadaLenMs =
    finMin > startMin ? finMs - startMs : finMin < startMin ? DAY_MS - startMs + finMs : DAY_MS;
  const crossesMidnight = finMin <= startMin;

  if (days.length === 0) return new Map();
  const firstDay = days[0]!;
  const lastDay = days[days.length - 1]!;
  const queryStart = new Date(firstDay.getTime() + startMs);
  const queryEnd = crossesMidnight
    ? new Date(lastDay.getTime() + DAY_MS + finMs)
    : new Date(lastDay.getTime() + finMs);

  const result = await query<{ time: string; data: Record<string, unknown> }>(
    `
    SELECT time_bucket('1 minute', time) AS time, last(data, time) AS data
    FROM equipo
    WHERE id_serial = $1
      AND time >= $2::timestamptz
      AND time <  $3::timestamptz
    GROUP BY 1
    ORDER BY 1 ASC
    `,
    [idSerial, queryStart.toISOString(), queryEnd.toISOString()],
    { label: 'contadores__jornada_rows' },
  );

  const dayIndex = new Map<string, number>();
  days.forEach((d, i) => dayIndex.set(getDayRangeChile(d).diaIso, i));

  interface DayAccum {
    valorInicio: number | null;
    prev: number | null;
    segmentBase: number | null;
    suma: number;
    resets: number;
    muestras: number;
    valorFin: number | null;
    ultimoDato: string | null;
  }
  const accs: (DayAccum | null)[] = days.map(() => null);

  for (const row of result.rows) {
    let v: number | null = null;
    try {
      const raw = applyMappingTransform({ rawData: row.data, mapping, pozoConfig });
      v = typeof raw === 'number' && Number.isFinite(raw) ? raw : Number(raw);
      if (!Number.isFinite(v)) v = null;
    } catch {
      v = null;
    }
    if (v === null) continue;

    const rowMs = new Date(row.time).getTime();
    // Shift por -startMin para que cada jornada comience al inicio de su dia
    // Chile virtual. Despues verificamos que el elapsed sea < jornadaLenMs.
    const shiftedDayKey = chileDayKey(new Date(rowMs - startMs));
    const idx = dayIndex.get(shiftedDayKey);
    if (idx === undefined) continue;
    const jStart = days[idx]!.getTime() + startMs;
    const elapsed = rowMs - jStart;
    if (elapsed < 0 || elapsed >= jornadaLenMs) continue;

    let acc = accs[idx];
    if (!acc) {
      acc = {
        valorInicio: null,
        prev: null,
        segmentBase: null,
        suma: 0,
        resets: 0,
        muestras: 0,
        valorFin: null,
        ultimoDato: null,
      };
      accs[idx] = acc;
    }
    acc.muestras++;
    acc.ultimoDato = row.time;
    if (acc.valorInicio === null) acc.valorInicio = v;
    if (acc.segmentBase === null) acc.segmentBase = v;
    if (acc.prev !== null && v < acc.prev) {
      acc.suma += acc.prev - acc.segmentBase;
      acc.segmentBase = v;
      acc.resets++;
    }
    acc.prev = v;
    acc.valorFin = v;
  }

  const out = new Map<string, MonthDeltaResult>();
  for (let i = 0; i < days.length; i++) {
    const acc = accs[i];
    if (!acc) continue;
    if (acc.segmentBase !== null && acc.valorFin !== null) {
      acc.suma += acc.valorFin - acc.segmentBase;
    }
    out.set(getDayRangeChile(days[i]!).diaIso, {
      valor_inicio: acc.valorInicio,
      valor_fin: acc.valorFin,
      delta: acc.muestras === 0 ? null : Math.max(0, acc.suma),
      muestras: acc.muestras,
      resets_detectados: acc.resets,
      ultimo_dato: acc.ultimoDato,
    });
  }
  return out;
}

/**
 * Devuelve la serie por jornada lista para el chart: ultimos `dias` puntos,
 * cada uno con el delta de la jornada [inicio, fin) (cruzando medianoche si
 * fin <= inicio).
 */
export async function getJornadaSeries(opts: {
  sitioId: string;
  rol: string;
  dias: number;
  inicio: string;
  fin: string;
}): Promise<ContadorJornadaPoint[]> {
  const { sitioId, rol, dias, inicio, fin } = opts;

  const counters = await listCounterVariablesForSite(sitioId);
  const counter = counters.find((c) => c.rol === rol && c.id_serial);
  if (!counter || !counter.id_serial) return emptyJornadaSeries(dias, inicio, fin);

  const mappings = await getMappingsBySiteId(sitioId);
  const mapping = mappings.find((m) => m.id === counter.variable_id);
  if (!mapping) return emptyJornadaSeries(dias, inicio, fin);

  const site = await getSiteById(sitioId);
  const pozoConfig = site?.tipo_sitio === 'pozo' ? await getPozoConfigBySiteId(sitioId) : null;

  const days = lastNDays(dias);
  const deltasByDay = await computeJornadasForVariable({
    idSerial: counter.id_serial,
    mapping,
    pozoConfig,
    days,
    inicio,
    fin,
  });

  return days.map((dayStart) => {
    const diaIso = getDayRangeChile(dayStart).diaIso;
    const r = deltasByDay.get(diaIso);
    return {
      dia: diaIso,
      inicio,
      fin,
      delta: r?.delta ?? null,
      unidad: counter.unidad,
      muestras: r?.muestras ?? 0,
      ultimo_dato: r?.ultimo_dato ?? null,
      resets_detectados: r?.resets_detectados ?? 0,
    };
  });
}

function emptyJornadaSeries(dias: number, inicio: string, fin: string): ContadorJornadaPoint[] {
  return lastNDays(dias).map((dayStart) => ({
    dia: getDayRangeChile(dayStart).diaIso,
    inicio,
    fin,
    delta: null,
    unidad: null,
    muestras: 0,
    ultimo_dato: null,
    resets_detectados: 0,
  }));
}

/**
 * Recomputa los meses indicados para una variable y persiste cada fila.
 * Devuelve la cantidad de meses upserteados.
 */
export async function recomputeMonthsForVariable(opts: {
  counter: CounterVariable;
  mapping: RegMap;
  pozoConfig: PozoConfig | null;
  meses: Date[];
}): Promise<number> {
  const { counter, mapping, pozoConfig, meses } = opts;
  if (!counter.id_serial) return 0;

  let count = 0;
  for (const monthStart of meses) {
    const { start, end, mesIso } = getMonthRangeChile(monthStart);
    const r = await computeMonthDeltaForVariable({
      idSerial: counter.id_serial,
      mapping,
      pozoConfig,
      start,
      end,
    });
    await upsertContadorMensual({
      sitio_id: counter.sitio_id,
      variable_id: counter.variable_id,
      rol: counter.rol,
      mes: mesIso,
      valor_inicio: r.valor_inicio,
      valor_fin: r.valor_fin,
      delta: r.delta,
      unidad: counter.unidad,
      muestras: r.muestras,
      resets_detectados: r.resets_detectados,
      ultimo_dato: r.ultimo_dato,
    });
    count++;
  }
  return count;
}

/**
 * Calcula proyeccion del mes actual: `delta_parcial * dias_mes / dias_transcurridos`.
 * Devuelve null si no hay datos suficientes o el mes no es el actual.
 */
function projectCurrentMonth(point: {
  mes: string;
  delta: number | null;
  ultimo_dato: string | null;
}): number | null {
  if (point.delta === null || point.delta <= 0) return null;
  const now = new Date();
  const { start, end, mesIso } = getMonthRangeChile(now);
  if (point.mes !== mesIso) return null;

  // Dias transcurridos: usa ultimo_dato si existe (mas preciso para sitios con gaps).
  const refMs = point.ultimo_dato ? new Date(point.ultimo_dato).getTime() : Date.now();
  const elapsedMs = Math.max(1, refMs - start.getTime());
  const totalMs = end.getTime() - start.getTime();
  if (totalMs <= 0) return null;
  const proyectado = (point.delta * totalMs) / elapsedMs;
  return Number.isFinite(proyectado) ? Math.round(proyectado * 1000) / 1000 : null;
}

/**
 * Recomputa el mes actual para todas las variables contador del sitio que
 * matcheen `rol`. Reusa la misma logica que el worker, limitada a 1 mes para
 * costo acotado (~150ms por variable).
 *
 * No lanza: cualquier fallo se logea y se devuelve 0. Caller debe poder
 * tolerar que el refresh haya fallado y caer a la fila vieja (si existe).
 */
async function refreshCurrentMonthForSite(sitioId: string, rol: string): Promise<number> {
  const counters = await listCounterVariablesForSite(sitioId);
  const targets = counters.filter((c) => c.rol === rol && c.id_serial);
  if (targets.length === 0) return 0;

  const mappings = await getMappingsBySiteId(sitioId);
  const site = await getSiteById(sitioId);
  const pozoConfig = site?.tipo_sitio === 'pozo' ? await getPozoConfigBySiteId(sitioId) : null;
  const meses = lastNMonths(1);

  let upserts = 0;
  for (const counter of targets) {
    try {
      const mapping = mappings.find((m) => m.id === counter.variable_id);
      if (!mapping) continue;
      upserts += await recomputeMonthsForVariable({ counter, mapping, pozoConfig, meses });
    } catch (err) {
      logger.warn(
        { sitio_id: sitioId, variable_id: counter.variable_id, err: (err as Error).message },
        'contadores lazy refresh: fallo en variable',
      );
    }
  }
  return upserts;
}

/**
 * Devuelve la serie mensual lista para el chart: ultimos `meses` puntos, con
 * proyeccion calculada para el mes actual (campo `proyeccion`).
 *
 * Si la fila del mes actual falta o esta stale (>1h), recomputa lazy antes de
 * devolver — asi el grafico refleja datos recientes sin esperar al worker.
 */
export async function getMonthlySeries(opts: {
  sitioId: string;
  rol: string;
  meses: number;
}): Promise<ContadorMensualPoint[]> {
  const { sitioId, rol, meses } = opts;
  let rows = await listContadoresBySiteAndRol(sitioId, rol, meses);

  const indexByMonth = (input: typeof rows) => {
    const map = new Map<string, (typeof rows)[number]>();
    for (const r of input) map.set(mesToIsoDay(r.mes), r);
    return map;
  };
  let byMonth = indexByMonth(rows);

  const { mesIso: mesActual } = getMonthRangeChile(new Date());
  const existing = byMonth.get(mesActual);
  const stale =
    !existing ||
    !existing.actualizado_at ||
    Date.now() - new Date(existing.actualizado_at).getTime() > LAZY_REFRESH_STALE_MS;

  if (stale) {
    try {
      const upserts = await refreshCurrentMonthForSite(sitioId, rol);
      if (upserts > 0) {
        rows = await listContadoresBySiteAndRol(sitioId, rol, meses);
        byMonth = indexByMonth(rows);
      }
    } catch (err) {
      logger.warn(
        { sitio_id: sitioId, rol, err: (err as Error).message },
        'contadores lazy refresh: fallo global, sirvo datos viejos',
      );
    }
  }

  const ordered = lastNMonths(meses);
  return ordered.map((monthStart) => {
    const mes = getMonthRangeChile(monthStart).mesIso;
    const row = byMonth.get(mes);
    const point: ContadorMensualPoint = {
      mes,
      delta: row?.delta != null ? Number(row.delta) : null,
      unidad: row?.unidad ?? null,
      muestras: row?.muestras ?? 0,
      ultimo_dato: row?.ultimo_dato ?? null,
      resets_detectados: row?.resets_detectados ?? 0,
    };
    const proy = projectCurrentMonth(point);
    if (proy !== null) point.proyeccion = proy;
    return point;
  });
}
