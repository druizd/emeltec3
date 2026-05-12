/**
 * Jerarquía de errores tipados. El middleware `error.ts` convierte
 * cualquier AppError en una respuesta JSON consistente.
 */

export interface AppErrorOptions {
  code?: string;
  details?: unknown;
  cause?: unknown;
}

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly expose: boolean;

  constructor(message: string, status: number, opts: AppErrorOptions = {}) {
    super(message, opts.cause ? { cause: opts.cause } : undefined);
    this.name = this.constructor.name;
    this.status = status;
    this.code = opts.code ?? this.constructor.name;
    this.details = opts.details;
    this.expose = status < 500;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Datos inválidos', opts: AppErrorOptions = {}) {
    super(message, 422, { code: 'VALIDATION_ERROR', ...opts });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'No autenticado', opts: AppErrorOptions = {}) {
    super(message, 401, { code: 'UNAUTHORIZED', ...opts });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Sin permisos', opts: AppErrorOptions = {}) {
    super(message, 403, { code: 'FORBIDDEN', ...opts });
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Recurso no encontrado', opts: AppErrorOptions = {}) {
    super(message, 404, { code: 'NOT_FOUND', ...opts });
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflicto de estado', opts: AppErrorOptions = {}) {
    super(message, 409, { code: 'CONFLICT', ...opts });
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Demasiadas solicitudes', opts: AppErrorOptions = {}) {
    super(message, 429, { code: 'TOO_MANY_REQUESTS', ...opts });
  }
}

export class InternalError extends AppError {
  constructor(message = 'Error interno del servidor', opts: AppErrorOptions = {}) {
    super(message, 500, { code: 'INTERNAL_ERROR', ...opts });
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
