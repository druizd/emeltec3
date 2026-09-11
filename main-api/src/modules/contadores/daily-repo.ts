/**
 * Repositorio para las tablas materializadas de contadores daily + jornada.
 * Creadas por migration 009_site_contador_daily_jornada.js.
 */
import { query } from '../../config/dbHelpers';

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

/**
 * Normaliza el campo `dia` a 'YYYY-MM-DD'. node-pg parsea columnas DATE como
 * Date object, y `String(date).slice(0,10)` daría el día local del proceso.
 */
export function diaToIso(dia: unknown): string {
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
 *
 * Devuelve las filas TAL CUAL, sin indexar por día: un día puede tener varias
 * (una por equipo) cuando cae en un recambio de caudalímetro, y colapsarlas
 * acá con `map.set(dia, fila)` hacía ganar arbitrariamente a la última que
 * devolvía Postgres. Agrupar y sumar es del service.
 */
export async function listContadorDiarioBySiteRolDias(
  sitioId: string,
  rol: string,
  dias: string[],
): Promise<ContadorDiarioRow[]> {
  if (dias.length === 0) return [];
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
  return result.rows;
}

/**
 * Lee filas materializadas de site_contador_jornada para un sitio/rol
 * con una ventana inicio/fin específica en el rango de días.
 *
 * Igual que `listContadorDiarioBySiteRolDias`: devuelve las filas sin indexar,
 * porque puede haber más de una por día (una por equipo).
 */
export async function listContadorJornadaBySiteRolDias(
  sitioId: string,
  rol: string,
  inicio: string,
  fin: string,
  dias: string[],
): Promise<ContadorJornadaRow[]> {
  if (dias.length === 0) return [];
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
  return result.rows;
}
