/**
 * Programación del resumen interno de monitoreo: a qué horas sale y desde
 * cuántas horas sin transmitir se informa un equipo.
 *
 * Vive en la tabla `health_digest_config` (fila única) porque el equipo Emeltec
 * la administra desde /administration → "Alertas por correo". Antes eran
 * constantes y variables de entorno, o sea un cambio requería editar el `.env`
 * de la VM y recrear el container.
 *
 * Fail-open: si la tabla no existe todavía (migración sin aplicar) o la query
 * falla, se usan los valores por defecto. El monitoreo no puede quedar mudo por
 * un problema de configuración.
 */
import { query } from '../../config/dbHelpers';
import { logger } from '../../config/logger';

export interface HealthDigestConfig {
  /** Horas de envío, en hora de pared de Chile. */
  horas: number[];
  /** Horas sin transmitir para que un equipo entre en el resumen. */
  umbralHoras: number;
  updatedAt: string | null;
}

export const CONFIG_POR_DEFECTO: HealthDigestConfig = {
  horas: [7, 16],
  umbralHoras: 6,
  updatedAt: null,
};

/** Horas válidas, ordenadas y sin repetidos. Una lista vacía apagaría el correo. */
export function normalizarHoras(input: unknown): number[] {
  const nums = Array.isArray(input) ? input.map((h) => Number(h)) : [];
  const limpias = [...new Set(nums.filter((n) => Number.isInteger(n) && n >= 0 && n <= 23))];
  return limpias.length > 0 ? limpias.sort((a, b) => a - b) : [...CONFIG_POR_DEFECTO.horas];
}

/** Umbral en horas. Bajo 0,5 h el resumen informaría cualquier hueco de señal. */
export function normalizarUmbral(input: unknown): number {
  const n = Number(input);
  if (!Number.isFinite(n) || n < 0.5) return CONFIG_POR_DEFECTO.umbralHoras;
  return Math.min(Math.round(n * 100) / 100, 720);
}

export async function getConfig(): Promise<HealthDigestConfig> {
  try {
    const r = await query<{ horas: number[]; umbral_horas: string; updated_at: string }>(
      `SELECT horas, umbral_horas, updated_at FROM health_digest_config WHERE id = TRUE`,
    );
    const row = r.rows[0];
    if (!row) return { ...CONFIG_POR_DEFECTO };
    return {
      horas: normalizarHoras(row.horas),
      umbralHoras: normalizarUmbral(row.umbral_horas),
      updatedAt: row.updated_at ?? null,
    };
  } catch (err) {
    logger.error(
      { err: (err as Error).message },
      'healthDigest: no se pudo leer la configuración → valores por defecto',
    );
    return { ...CONFIG_POR_DEFECTO };
  }
}

export async function saveConfig(
  horas: number[],
  umbralHoras: number,
  actorId: string | null,
): Promise<HealthDigestConfig> {
  const h = normalizarHoras(horas);
  const u = normalizarUmbral(umbralHoras);
  await query(
    `INSERT INTO health_digest_config (id, horas, umbral_horas, actualizado_por, updated_at)
     VALUES (TRUE, $1::int[], $2, $3, NOW())
     ON CONFLICT (id) DO UPDATE SET
       horas = EXCLUDED.horas,
       umbral_horas = EXCLUDED.umbral_horas,
       actualizado_por = EXCLUDED.actualizado_por,
       updated_at = NOW()`,
    [h, u, actorId],
  );
  return getConfig();
}
