// Formato estándar de respuesta JSON para toda la API.
// Toda respuesta exitosa o de error sigue el patrón `{ ok, ... }` para que el cliente solo revise una bandera.

// Respuesta OK. `meta` es opcional (paginación, info extra).
export interface OkEnvelope<T> {
  ok: true;
  data: T;
  meta?: Record<string, unknown>;
}

// Respuesta de error. `requestId` permite correlacionar con logs del servidor.
export interface ErrEnvelope {
  ok: false;
  error: {
    code: string;
    message: string;
    requestId?: string;
    details?: unknown;
  };
}

// Metadatos de paginación que viajan dentro de `meta` cuando la respuesta es una página de resultados.
export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// Helper: envuelve `data` en formato OK.
export function ok<T>(data: T, meta?: Record<string, unknown>): OkEnvelope<T> {
  return meta ? { ok: true, data, meta } : { ok: true, data };
}

// Helper: respuesta paginada. Calcula `totalPages` a partir de `total` y `pageSize`.
export function paginated<T>(items: T[], page: number, pageSize: number, total: number): OkEnvelope<T[]> {
  const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;
  return {
    ok: true,
    data: items,
    meta: { page, pageSize, total, totalPages },
  };
}

// Helper: construye envelope de error. Usado por `errorHandler` y `notFoundHandler`.
export function err(code: string, message: string, requestId?: string, details?: unknown): ErrEnvelope {
  const errorPayload: ErrEnvelope['error'] = { code, message };
  if (requestId) errorPayload.requestId = requestId;
  if (details !== undefined) errorPayload.details = details;
  return { ok: false, error: errorPayload };
}
