/**
 * Contexto por request basado en AsyncLocalStorage.
 * Permite acceder a requestId, userId, etc desde cualquier capa sin pasarlo
 * explícitamente por parámetro.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
  userId?: string | number;
  userTipo?: string;
  empresaId?: string | number;
  subEmpresaId?: string | number;
  startedAt: bigint;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}
