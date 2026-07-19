/**
 * Lógica central de exportación ARCO (Ley 21.719 — B3.2).
 *
 * Permite al titular obtener sus datos personales + historial de acciones
 * registradas en audit_log. Recibe `dbQuery` y `auditRecord` inyectados
 * para testeo unitario sin DB real (mismo patrón que supresion.ts).
 */

import type { AuditRecordParams } from '../retention/supresion';

export interface ExportarDatosParams {
  userId: string;
  dbQuery: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  auditRecord?: (params: AuditRecordParams) => Promise<void>;
  req: unknown;
}

export interface ExportarDatosResult {
  perfil: unknown;
  audit: unknown[];
  exportado_at: string;
}

export class AppError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'AppError';
  }
}

// Función de audit record por defecto (usa el módulo real de producción)
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

export async function exportarDatos(params: ExportarDatosParams): Promise<ExportarDatosResult> {
  const { userId, dbQuery, auditRecord = defaultAuditRecord, req } = params;

  // 1. Obtener perfil completo del usuario
  const { rows: perfilRows } = await dbQuery(`${USER_PROFILE_SELECT} WHERE u.id = $1`, [userId]);

  if (perfilRows.length === 0) {
    throw new AppError(`Usuario ${userId} no encontrado`, 404);
  }

  const perfil = perfilRows[0];

  // 2. Obtener historial de acciones del usuario (máx. 500)
  const { rows: auditRows } = await dbQuery(
    `SELECT id, action, target_type, target_id, status_code, ts, metadata
       FROM audit_log
      WHERE actor_id = $1
      ORDER BY ts DESC
      LIMIT 500`,
    [userId],
  );

  // 3. Registrar la exportación en audit_log (sin payload sensible)
  await auditRecord({
    req,
    action: 'user.export_datos',
    actorId: userId,
    actorEmail: (perfil as { email: string }).email ?? null,
    actorTipo: (perfil as { tipo: string }).tipo ?? null,
    targetType: 'usuario',
    targetId: userId,
    statusCode: 200,
    metadata: { arco: true },
  });

  return {
    perfil,
    audit: auditRows,
    exportado_at: new Date().toISOString(),
  };
}
