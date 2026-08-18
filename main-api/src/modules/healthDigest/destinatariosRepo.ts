/**
 * Destinatarios del monitoreo interno (healthDigest).
 *
 * Tabla `health_digest_destinatario`: una fila por buzón que recibe el resumen
 * diario y/o las escalaciones. El email es la clave y va SIEMPRE en minúsculas
 * (normalizado acá, no en la BD).
 *
 * Ver migración `infra-db/migrations/2026-08-18-health-digest-destinatarios.sql`.
 */
import { query, transaction } from '../../config/dbHelpers';

export type EventoTier = 't3' | 't6' | 't12';

export interface DigestDestinatario {
  email: string;
  nombre: string | null;
  recibe_resumen: boolean;
  recibe_eventos: boolean;
  umbral_evento: EventoTier;
  activo: boolean;
  updated_at: string | null;
}

export interface DigestDestinatarioInput {
  email: string;
  nombre?: string | null;
  recibe_resumen: boolean;
  recibe_eventos: boolean;
  umbral_evento: EventoTier;
  activo: boolean;
}

const COLUMNS = 'email, nombre, recibe_resumen, recibe_eventos, umbral_evento, activo, updated_at';

function normalizeTier(value: unknown): EventoTier {
  return value === 't6' || value === 't12' ? value : 't3';
}

function mapRow(row: Record<string, unknown>): DigestDestinatario {
  return {
    email: String(row.email),
    nombre: (row.nombre as string | null) ?? null,
    recibe_resumen: row.recibe_resumen === true,
    recibe_eventos: row.recibe_eventos === true,
    umbral_evento: normalizeTier(row.umbral_evento),
    activo: row.activo === true,
    updated_at: row.updated_at ? new Date(row.updated_at as string).toISOString() : null,
  };
}

/** Normaliza el email tal como se persiste: trim + minúsculas. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Lista completa (activos e inactivos) para la pantalla de administración. */
export async function listDestinatarios(): Promise<DigestDestinatario[]> {
  const result = await query<Record<string, unknown>>(
    `SELECT ${COLUMNS} FROM health_digest_destinatario ORDER BY activo DESC, email ASC`,
    [],
    { name: 'health_digest_dest__list' },
  );
  return result.rows.map(mapRow);
}

/** Solo los activos: lo que consume el worker en cada ciclo. */
export async function listDestinatariosActivos(): Promise<DigestDestinatario[]> {
  const result = await query<Record<string, unknown>>(
    `SELECT ${COLUMNS} FROM health_digest_destinatario WHERE activo = TRUE ORDER BY email ASC`,
    [],
    { name: 'health_digest_dest__list_activos' },
  );
  return result.rows.map(mapRow);
}

/**
 * Reemplaza la lista completa en una transacción: upsert de lo recibido y
 * borrado de lo que ya no viene. Un PUT del set entero evita estados
 * intermedios raros (por ejemplo quedarse sin ningún destinatario mientras la
 * UI hace N llamadas sueltas).
 *
 * Devuelve la lista final ya persistida.
 */
export async function replaceDestinatarios(
  rows: DigestDestinatarioInput[],
  actorId: string | null,
): Promise<DigestDestinatario[]> {
  return transaction(async (client) => {
    const emails = rows.map((r) => normalizeEmail(r.email));
    if (emails.length === 0) {
      await client.query('DELETE FROM health_digest_destinatario');
    } else {
      await client.query('DELETE FROM health_digest_destinatario WHERE email <> ALL($1::text[])', [
        emails,
      ]);
    }

    for (const [i, row] of rows.entries()) {
      await client.query(
        `INSERT INTO health_digest_destinatario
           (email, nombre, recibe_resumen, recibe_eventos, umbral_evento, activo,
            actualizado_por, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         ON CONFLICT (email) DO UPDATE SET
           nombre = EXCLUDED.nombre,
           recibe_resumen = EXCLUDED.recibe_resumen,
           recibe_eventos = EXCLUDED.recibe_eventos,
           umbral_evento = EXCLUDED.umbral_evento,
           activo = EXCLUDED.activo,
           actualizado_por = EXCLUDED.actualizado_por,
           updated_at = NOW()`,
        [
          emails[i],
          row.nombre?.trim() || null,
          row.recibe_resumen,
          row.recibe_eventos,
          row.umbral_evento,
          row.activo,
          actorId,
        ],
      );
    }

    const result = await client.query<Record<string, unknown>>(
      `SELECT ${COLUMNS} FROM health_digest_destinatario ORDER BY activo DESC, email ASC`,
    );
    return result.rows.map(mapRow);
  });
}
