export interface OkEnvelope<T> {
  ok: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ErrEnvelope {
  ok: false;
  error: {
    code: string;
    message: string;
    requestId?: string;
    details?: unknown;
  };
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function ok<T>(data: T, meta?: Record<string, unknown>): OkEnvelope<T> {
  return meta ? { ok: true, data, meta } : { ok: true, data };
}

export function paginated<T>(items: T[], page: number, pageSize: number, total: number): OkEnvelope<T[]> {
  const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;
  return {
    ok: true,
    data: items,
    meta: { page, pageSize, total, totalPages },
  };
}

export function err(code: string, message: string, requestId?: string, details?: unknown): ErrEnvelope {
  const errorPayload: ErrEnvelope['error'] = { code, message };
  if (requestId) errorPayload.requestId = requestId;
  if (details !== undefined) errorPayload.details = details;
  return { ok: false, error: errorPayload };
}
