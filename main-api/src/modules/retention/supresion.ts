/**
 * Lógica central de supresión ARCO+ (Ley 21.719).
 *
 * Anonimiza la PII del usuario y sus registros de audit_log.
 * Recibe `dbQuery` y `auditRecord` inyectados para testeo unitario sin DB real.
 */

export interface AuditRecordParams {
  req: unknown;
  action: string;
  actorId?: string | null;
  actorEmail?: string | null;
  actorTipo?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  payload?: unknown;
  statusCode?: number | null;
  metadata?: Record<string, unknown> | null;
}

export interface SuprimirParams {
  actorId: string;
  actorEmail: string;
  actorTipo: string;
  targetId: string;
  req: unknown;
  dbQuery: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  auditRecord?: (params: AuditRecordParams) => Promise<void>;
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

export async function suprimirUsuario(params: SuprimirParams): Promise<void> {
  const {
    actorId,
    actorEmail,
    actorTipo,
    targetId,
    req,
    dbQuery,
    auditRecord = defaultAuditRecord,
  } = params;

  // Verificar autorización: solo SuperAdmin o el propio titular
  const esSuperAdmin = actorTipo === 'SuperAdmin';
  const esTitular = actorId === targetId;

  if (!esSuperAdmin && !esTitular) {
    throw new AppError('No autorizado para ejecutar supresión de cuenta', 403);
  }

  // SuperAdmin no puede suprimirse a sí mismo (evita autosupresión del actuante)
  if (esSuperAdmin && esTitular) {
    throw new AppError(
      'Un SuperAdmin no puede suprimir su propia cuenta. Solicite a otro SuperAdmin que ejecute la acción.',
      403,
    );
  }

  // Obtener datos del target antes de anonimizar
  const { rows } = await dbQuery(
    'SELECT id, email, nombre, apellido, tipo FROM usuario WHERE id = $1',
    [targetId],
  );

  if (rows.length === 0) {
    throw new AppError(`Usuario ${targetId} no encontrado`, 404);
  }

  // Registrar en audit_log ANTES de anonimizar (con datos reales aún visibles)
  await auditRecord({
    req,
    action: 'user.suprimir',
    actorId,
    actorEmail,
    actorTipo,
    targetType: 'usuario',
    targetId,
    payload: { motivo: 'solicitud_arco_plus' },
    statusCode: 200,
    metadata: { supresion: true },
  });

  // Anonimizar datos personales del usuario
  await dbQuery(
    `UPDATE usuario
     SET email       = $1,
         nombre      = $2,
         apellido    = $3,
         rut_usuario = $4,
         telefono    = $5,
         activo      = $6
     WHERE id = $7`,
    [
      `anonimizado+${targetId}@eliminado.invalid`,
      '[ANONIMIZADO]',
      '[ANONIMIZADO]',
      '[ANONIMIZADO]',
      '[ANONIMIZADO]',
      false,
      targetId,
    ],
  );

  // Anonimizar actor_email e ip en audit_log histórico de ese usuario
  await dbQuery(
    `UPDATE audit_log
     SET actor_email = $1,
         ip          = $2
     WHERE actor_id = $3`,
    ['[ANONIMIZADO]', '[ANONIMIZADO]', targetId],
  );
}
