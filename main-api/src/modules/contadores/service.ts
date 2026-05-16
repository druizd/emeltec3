/**
 * Servicio del modulo contadores: calcula el delta mensual de una variable
 * contador iterando las filas del hypertable `equipo`, aplicando la
 * transformacion configurada en reg_map (reusa modules/sites/transforms.ts) y
 * sumando segmentos cuando detecta resets (overflow uint32, reemplazo sensor).
 *
 * Las llamadas a este modulo son intensivas: las hace el worker cada hora y el
 * script de backfill al arranque. NO se debe invocar por request HTTP — el
 * endpoint lee la tabla materializada `site_contador_mensual`.
 */
import { query } from '../../config/dbHelpers';
import { applyMappingTransform } from '../sites/transforms';
import type { PozoConfig, RegMap } from '../sites/types';
import { listContadoresBySiteAndRol, type CounterVariable, upsertContadorMensual } from './repo';
import type { ContadorMensualPoint, MonthDeltaResult } from './types';

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
    const date = new Date(Date.UTC(baseYear, m, 1));
    // Re-aplicamos getMonthRangeChile para obtener el inicio correcto en Chile.
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
 * Devuelve la serie mensual lista para el chart: ultimos `meses` puntos, con
 * proyeccion calculada para el mes actual (campo `proyeccion`).
 */
export async function getMonthlySeries(opts: {
  sitioId: string;
  rol: string;
  meses: number;
}): Promise<ContadorMensualPoint[]> {
  const { sitioId, rol, meses } = opts;
  const rows = await listContadoresBySiteAndRol(sitioId, rol, meses);

  // Indexamos por mes para rellenar huecos con null.
  const byMonth = new Map<string, (typeof rows)[number]>();
  for (const r of rows) byMonth.set(String(r.mes).slice(0, 10), r);

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
