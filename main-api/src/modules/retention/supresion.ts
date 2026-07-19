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

  // Verificar autorización: solo SuperAdmin o el propio titular.
  // Coerción a String: el id del JWT y el param de ruta pueden diferir en tipo.
  const esSuperAdmin = actorTipo === 'SuperAdmin';
  const esTitular = String(actorId) === String(targetId);

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

  const emailOriginal = (rows[0] as { email?: string | null })?.email ?? null;

  // Anonimizar datos personales del usuario. Campos NOT NULL visibles en UI
  // reciben el tombstone constante; los opcionales van a NULL (evita mostrar
  // '[ANONIMIZADO]' donde la UI ya maneja el vacío con 'No registrado').
  // password_hash/otp_hash/otp_expires_at también a NULL: son datos derivados
  // del titular y una cuenta suprimida jamás vuelve a autenticar — no existe
  // base legal para retenerlos (auditoría 17-07-2026).
  await dbQuery(
    `UPDATE usuario
     SET email           = $1,
         nombre          = $2,
         apellido        = $3,
         rut_usuario     = NULL,
         telefono        = NULL,
         cargo           = NULL,
         password_hash   = NULL,
         otp_hash        = NULL,
         otp_expires_at  = NULL,
         activo          = $4
     WHERE id = $5`,
    [
      `anonimizado+${targetId}@eliminado.invalid`,
      '[ANONIMIZADO]',
      '[ANONIMIZADO]',
      false,
      targetId,
    ],
  );

  // Suprimir contactos operacionales que usan el email del titular (T2 de
  // GOBERNANZA-DATOS): sin esto, la persona suprimida seguiría recibiendo
  // correos de alertas vía Resend con su nombre — el derecho de supresión
  // se ejercería a medias (auditoría 17-07-2026).
  if (emailOriginal) {
    await dbQuery(`DELETE FROM contacto_operativo WHERE LOWER(email) = LOWER($1)`, [emailOriginal]);
  }

  // Anonimizar actor_email e ip en audit_log histórico de ese usuario
  await dbQuery(
    `UPDATE audit_log
     SET actor_email = $1,
         ip          = $2
     WHERE actor_id = $3`,
    ['[ANONIMIZADO]', '[ANONIMIZADO]', targetId],
  );
}
