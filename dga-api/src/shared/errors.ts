// Jerarquía de errores de la app. Cada subclase mapea a un código HTTP y un código de error estable
// que el middleware `errorHandler` traduce en la respuesta JSON estándar (envelope `{ ok:false, error }`).

// Error base. Cualquier error con `status` y `code` que viaje hacia el cliente extiende de aquí.
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'APP_ERROR',
    public readonly status: number = 500,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// 400 — Body/params/query no pasan validación (Zod, reglas de negocio simples).
export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
  }
}

// 404 — Recurso solicitado no existe (ej. sitio, reporte).
export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} no encontrado`, 'NOT_FOUND', 404);
    this.name = 'NotFoundError';
  }
}

// 401 — Falta token, token inválido/expirado, o API key interna inválida. Lo lanza `authProtect`/`requireInternalKey`.
export class UnauthorizedError extends AppError {
  constructor(message: string = 'No autorizado') {
    super(message, 'UNAUTHORIZED', 401);
    this.name = 'UnauthorizedError';
  }
}

// 403 — Autenticado pero sin permiso sobre el recurso (rol/empresa no autorizada).
export class ForbiddenError extends AppError {
  constructor(message: string = 'Acceso denegado') {
    super(message, 'FORBIDDEN', 403);
    this.name = 'ForbiddenError';
  }
}

// 409 — Conflicto de estado (ej. reporte duplicado, periodicidad ya marcada).
export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 'CONFLICT', 409);
    this.name = 'ConflictError';
  }
}

// 502 — Falló un servicio externo del que dependemos (MIA-DGA, etc).
export class ExternalServiceError extends AppError {
  constructor(service: string, message: string, details?: unknown) {
    super(`[${service}] ${message}`, 'EXTERNAL_SERVICE_ERROR', 502, details);
    this.name = 'ExternalServiceError';
  }
}
