/**
 * Lógica central de aceptación de política de privacidad (Ley 21.719 — B7.2).
 *
 * Marca al usuario como aceptante. Idempotente: si ya tiene fecha no la
 * sobreescribe. Recibe `dbQuery` inyectado para testeo unitario sin DB real.
 */

import type { AuditRecordParams } from '../retention/supresion';

export interface AceptarPoliticaParams {
  userId: string;
  dbQuery: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  auditRecord?: (params: AuditRecordParams) => Promise<void>;
  req: unknown;
}

export interface AceptarPoliticaResult {
  perfil: unknown;
}

export class AppError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'AppError';
  }
}

function defaultAuditRecord(params: AuditRecordParams): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { record } = require('../../services/auditLog.js') as {
    record: (p: AuditRecordParams) => Promise<void>;
  };
  return record(params);
}

const USER_PROFILE_SELECT = `
  SELECT u.id,
         u.nombre,
         COALESCE(u.apellido, '') AS apellido,
         u.rut_usuario,
         u.email,
         u.telefono,
         u.cargo,
         u.tipo,
         u.empresa_id,
         u.sub_empresa_id,
         COALESCE(u.activo, true) AS activo,
         u.last_login_at,
         u.activated_at,
         u.auth_mode,
         u.password_set_at,
         (u.password_hash IS NOT NULL) AS has_password,
         u.politica_aceptada_at,
         e.nombre AS empresa_nombre,
         se.nombre AS sub_empresa_nombre
  FROM usuario u
  LEFT JOIN empresa e ON e.id = u.empresa_id
  LEFT JOIN sub_empresa se ON se.id = u.sub_empresa_id
`;

export async function aceptarPolitica(
  params: AceptarPoliticaParams,
): Promise<AceptarPoliticaResult> {
  const { userId, dbQuery, auditRecord = defaultAuditRecord, req } = params;

  // Solo marca si no está ya marcado (idempotente — no sobreescribe si ya tiene fecha)
  await dbQuery(
    `UPDATE usuario
        SET politica_aceptada_at = NOW(),
            updated_at = NOW()
      WHERE id = $1
        AND politica_aceptada_at IS NULL`,
    [userId],
  );

  // Obtener perfil actualizado
  const { rows } = await dbQuery(`${USER_PROFILE_SELECT} WHERE u.id = $1`, [userId]);

  if (rows.length === 0) {
    throw new AppError(`Usuario ${userId} no encontrado`, 404);
  }

  await auditRecord({
    req,
    action: 'user.aceptar_politica',
    actorId: userId,
    actorEmail: (rows[0] as { email: string }).email ?? null,
    actorTipo: (rows[0] as { tipo: string }).tipo ?? null,
    targetType: 'usuario',
    targetId: userId,
    statusCode: 200,
    metadata: { arco: true },
  });

  return { perfil: rows[0] };
}
