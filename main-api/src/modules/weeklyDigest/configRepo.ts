/**
 * Programación del resumen semanal de alertas del cliente: qué día y a qué hora
 * sale, y si está encendido.
 *
 * Vive en la tabla `weekly_digest_config` (fila única) por la misma razón que
 * la del resumen interno: cambiar el horario no puede exigir editar el `.env`
 * de la VM y recrear el container.
 *
 * Fail-open a los valores por defecto si la tabla no existe todavía o la query
 * falla — pero OJO con la diferencia respecto del monitoreo interno: acá
 * fail-open significa "sale el correo igual", y los destinatarios son clientes.
 * Es seguro porque la suscripción no está en esta tabla sino en
 * `usuario.recibe_resumen_semanal`, apagada por defecto: sin nadie suscrito, un
 * fail-open no le manda nada a nadie.
 */
import { query } from '../../config/dbHelpers';
import { logger } from '../../config/logger';

export interface WeeklyDigestConfig {
  /** Día ISO de envío: 1 = lunes … 7 = domingo. */
  diaSemana: number;
  /** Hora de envío, en hora de pared de Chile. */
  hora: number;
  activo: boolean;
  updatedAt: string | null;
}

/** Viernes (día ISO 5) a las 07:00 de Chile. Decisión del usuario, 23-09-2026. */
export const CONFIG_POR_DEFECTO: WeeklyDigestConfig = {
  diaSemana: 5,
  hora: 7,
  activo: true,
  updatedAt: null,
};

/** Día ISO válido. Fuera de 1..7 se cae al viernes. */
export function normalizarDia(input: unknown): number {
  const n = Number(input);
  return Number.isInteger(n) && n >= 1 && n <= 7 ? n : CONFIG_POR_DEFECTO.diaSemana;
}

/** Hora válida. Fuera de 0..23 se cae a las 07:00. */
export function normalizarHora(input: unknown): number {
  const n = Number(input);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : CONFIG_POR_DEFECTO.hora;
}

export async function getConfig(): Promise<WeeklyDigestConfig> {
  try {
    const r = await query<{
      dia_semana: number;
      hora: number;
      activo: boolean;
      updated_at: string;
    }>(
      `SELECT dia_semana, hora, activo, updated_at FROM weekly_digest_config WHERE id = TRUE`,
      [],
      {
        name: 'weekly_digest__config',
      },
    );
    const row = r.rows[0];
    if (!row) return { ...CONFIG_POR_DEFECTO };
    return {
      diaSemana: normalizarDia(row.dia_semana),
      hora: normalizarHora(row.hora),
      activo: row.activo !== false,
      updatedAt: row.updated_at ?? null,
    };
  } catch (err) {
    logger.error(
      { err: (err as Error).message },
      'weeklyDigest: no se pudo leer la configuración → valores por defecto',
    );
    return { ...CONFIG_POR_DEFECTO };
  }
}
