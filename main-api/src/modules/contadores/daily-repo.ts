/**
 * Repositorio para las tablas materializadas de contadores daily + jornada.
 * Creadas por migration 009_site_contador_daily_jornada.js.
 */
import { query } from '../../config/dbHelpers';
import type { ContadorDiarioPoint, ContadorJornadaPoint } from './types';

// ── Tipos de fila ─────────────────────────────────────────────────────────────

export interface ContadorDiarioRow {
  sitio_id: string;
  variable_id: string;
  rol: string;
  dia: string;
  valor_inicio: number | null;
  valor_fin: number | null;
  delta: number | null;
  unidad: string | null;
  muestras: number;
  resets_detectados: number;
  ultimo_dato: string | null;
  actualizado_at: string;
}

export interface ContadorJornadaRow {
  sitio_id: string;
  variable_id: string;
  rol: string;
  dia: string;
  inicio: string;
  fin: string;
  valor_inicio: number | null;
  valor_fin: number | null;
  delta: number | null;
  unidad: string | null;
  muestras: number;
  resets_detectados: number;
  ultimo_dato: string | null;
  actualizado_at: string;
}

// ── Helpers de conversión ─────────────────────────────────────────────────────

function diaToIso(dia: unknown): string {
  if (dia instanceof Date) return dia.toISOString().slice(0, 10);
  return String(dia).slice(0, 10);
}

// ── Upsert ────────────────────────────────────────────────────────────────────

export async function upsertContadorDiario(row: {
  sitio_id: string;
  variable_id: string;
  rol: string;
  dia: string;
  valor_inicio: number | null;
  valor_fin: number | null;
  delta: number | null;
  unidad: string | null;
  muestras: number;
  resets_detectados: number;
  ultimo_dato: string | null;
}): Promise<void> {
  await query(
    `
    INSERT INTO site_contador_diario
      (sitio_id, variable_id, rol, dia, valor_inicio, valor_fin, delta, unidad,
       muestras, resets_detectados, ultimo_dato, actualizado_at)
    VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9, $10, $11, NOW())
    ON CONFLICT (sitio_id, variable_id, dia) DO UPDATE SET
      rol               = EXCLUDED.rol,
      valor_inicio      = EXCLUDED.valor_inicio,
      valor_fin         = EXCLUDED.valor_fin,
      delta             = EXCLUDED.delta,
      unidad            = EXCLUDED.unidad,
      muestras          = EXCLUDED.muestras,
      resets_detectados = EXCLUDED.resets_detectados,
      ultimo_dato       = EXCLUDED.ultimo_dato,
      actualizado_at    = NOW()
    `,
    [
      row.sitio_id,
      row.variable_id,
      row.rol,
      row.dia,
      row.valor_inicio,
      row.valor_fin,
      row.delta,
      row.unidad,
      row.muestras,
      row.resets_detectados,
      row.ultimo_dato,
    ],
    { name: 'cont_daily__upsert_diario' },
  );
}

export async function upsertContadorJornada(row: {
  sitio_id: string;
  variable_id: string;
  rol: string;
  dia: string;
  inicio: string;
  fin: string;
  valor_inicio: number | null;
  valor_fin: number | null;
  delta: number | null;
  unidad: string | null;
  muestras: number;
  resets_detectados: number;
  ultimo_dato: string | null;
}): Promise<void> {
  await query(
    `
    INSERT INTO site_contador_jornada
      (sitio_id, variable_id, rol, dia, inicio, fin, valor_inicio, valor_fin, delta, unidad,
       muestras, resets_detectados, ultimo_dato, actualizado_at)
    VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
    ON CONFLICT (sitio_id, variable_id, dia, inicio, fin) DO UPDATE SET
      rol               = EXCLUDED.rol,
      valor_inicio      = EXCLUDED.valor_inicio,
      valor_fin         = EXCLUDED.valor_fin,
      delta             = EXCLUDED.delta,
      unidad            = EXCLUDED.unidad,
      muestras          = EXCLUDED.muestras,
      resets_detectados = EXCLUDED.resets_detectados,
      ultimo_dato       = EXCLUDED.ultimo_dato,
      actualizado_at    = NOW()
    `,
    [
      row.sitio_id,
      row.variable_id,
      row.rol,
      row.dia,
      row.inicio,
      row.fin,
      row.valor_inicio,
      row.valor_fin,
      row.delta,
      row.unidad,
      row.muestras,
      row.resets_detectados,
      row.ultimo_dato,
    ],
    { name: 'cont_daily__upsert_jornada' },
  );
}

// ── Lectura (cold path) ───────────────────────────────────────────────────────

/**
 * Lee filas materializadas de site_contador_diario para un sitio/rol
 * en el rango de días indicado (array de 'YYYY-MM-DD').
 * Devuelve map dia_iso -> ContadorDiarioRow.
 */
export async function listContadorDiarioBySiteRolDias(
  sitioId: string,
  rol: string,
  dias: string[],
): Promise<Map<string, ContadorDiarioRow>> {
  if (dias.length === 0) return new Map();
  const result = await query<ContadorDiarioRow>(
    `
    SELECT sitio_id, variable_id, rol, dia, valor_inicio, valor_fin, delta, unidad,
           muestras, resets_detectados, ultimo_dato, actualizado_at
    FROM site_contador_diario
    WHERE sitio_id = $1
      AND rol = $2
      AND dia = ANY($3::date[])
    `,
    [sitioId, rol, dias],
    { name: 'cont_daily__list_diario' },
  );
  const out = new Map<string, ContadorDiarioRow>();
  for (const row of result.rows) {
    out.set(diaToIso(row.dia), row);
  }
  return out;
}

/**
 * Lee filas materializadas de site_contador_jornada para un sitio/rol
 * con una ventana inicio/fin específica en el rango de días.
 * Devuelve map dia_iso -> ContadorJornadaRow.
 */
export async function listContadorJornadaBySiteRolDias(
  sitioId: string,
  rol: string,
  inicio: string,
  fin: string,
  dias: string[],
): Promise<Map<string, ContadorJornadaRow>> {
  if (dias.length === 0) return new Map();
  const result = await query<ContadorJornadaRow>(
    `
    SELECT sitio_id, variable_id, rol, dia, inicio, fin, valor_inicio, valor_fin, delta, unidad,
           muestras, resets_detectados, ultimo_dato, actualizado_at
    FROM site_contador_jornada
    WHERE sitio_id = $1
      AND rol = $2
      AND inicio = $3
      AND fin = $4
      AND dia = ANY($5::date[])
    `,
    [sitioId, rol, inicio, fin, dias],
    { name: 'cont_daily__list_jornada' },
  );
  const out = new Map<string, ContadorJornadaRow>();
  for (const row of result.rows) {
    out.set(diaToIso(row.dia), row);
  }
  return out;
}

// ── Conversión a tipos de API ─────────────────────────────────────────────────

export function diarioRowToPoint(
  row: ContadorDiarioRow,
  unidadFallback: string | null,
): ContadorDiarioPoint {
  return {
    dia: diaToIso(row.dia),
    delta: row.delta != null ? Number(row.delta) : null,
    unidad: row.unidad ?? unidadFallback,
    muestras: row.muestras,
    ultimo_dato: row.ultimo_dato,
    resets_detectados: row.resets_detectados,
  };
}

export function jornadaRowToPoint(
  row: ContadorJornadaRow,
  unidadFallback: string | null,
): ContadorJornadaPoint {
  return {
    dia: diaToIso(row.dia),
    inicio: row.inicio,
    fin: row.fin,
    delta: row.delta != null ? Number(row.delta) : null,
    unidad: row.unidad ?? unidadFallback,
    muestras: row.muestras,
    ultimo_dato: row.ultimo_dato,
    resets_detectados: row.resets_detectados,
  };
}
