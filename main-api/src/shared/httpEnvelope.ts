/**
 * Envelopes HTTP estándar para respuestas v2.
 * v1 legacy mantiene { ok, count, data, ...filters } y se construye
 * desde estos tipos en `http/v1/adapters/*`.
 */

export interface OkEnvelope<T> {
  ok: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ErrorEnvelope {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export interface PaginationMeta {
  page?: number;
  pageSize?: number;
  total?: number;
  cursor?: string | null;
  hasMore?: boolean;
}

export interface PaginatedEnvelope<T> {
  ok: true;
  data: T[];
  meta: { pagination: PaginationMeta } & Record<string, unknown>;
}

export function ok<T>(data: T, meta?: Record<string, unknown>): OkEnvelope<T> {
  return meta !== undefined ? { ok: true, data, meta } : { ok: true, data };
}

export function paginated<T>(
  data: T[],
  pagination: PaginationMeta,
  extra?: Record<string, unknown>,
): PaginatedEnvelope<T> {
  return { ok: true, data, meta: { pagination, ...(extra ?? {}) } };
}

export function err(
  code: string,
  message: string,
  opts: { details?: unknown; requestId?: string } = {},
): ErrorEnvelope {
  const error: ErrorEnvelope['error'] = { code, message };
  if (opts.details !== undefined) error.details = opts.details;
  if (opts.requestId !== undefined) error.requestId = opts.requestId;
  return { ok: false, error };
}
