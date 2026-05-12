/**
 * Buffer in-memory de métricas de uso de la API.
 * Los hot-paths agregan aquí; el flusher persiste cada N segundos.
 * Reemplaza la escritura por request a `api_metrics`/`api_variable_metrics`
 * que hacía `services/metricsService.js`.
 */

export interface EndpointKey {
  endpoint: string;
  domain: string | null;
  serialId: string | null;
}

export interface EndpointAccum {
  requestCount: number;
  bytesSent: number;
}

export interface VariableKey {
  nombreDato: string;
  serialId: string | null;
}

export interface VariableAccum {
  requestCount: number;
  bytesSent: number;
  durationMsTotal: number;
}

const endpointMap = new Map<string, EndpointAccum & EndpointKey>();
const variableMap = new Map<string, VariableAccum & VariableKey>();

function endpointKey(k: EndpointKey): string {
  return `${k.endpoint}${k.domain ?? ''}${k.serialId ?? ''}`;
}

function variableKey(k: VariableKey): string {
  return `${k.nombreDato}${k.serialId ?? ''}`;
}

export function trackEndpoint(key: EndpointKey, bytesSent: number): void {
  const k = endpointKey(key);
  const prev = endpointMap.get(k);
  if (prev) {
    prev.requestCount += 1;
    prev.bytesSent += Math.max(0, Math.round(bytesSent));
    return;
  }
  endpointMap.set(k, {
    ...key,
    requestCount: 1,
    bytesSent: Math.max(0, Math.round(bytesSent)),
  });
}

export function trackVariable(
  key: VariableKey,
  bytesSent: number,
  durationMs: number,
): void {
  if (!key.nombreDato) return;
  const k = variableKey(key);
  const prev = variableMap.get(k);
  if (prev) {
    prev.requestCount += 1;
    prev.bytesSent += Math.max(0, Math.round(bytesSent));
    prev.durationMsTotal += Math.max(0, Math.round(durationMs));
    return;
  }
  variableMap.set(k, {
    ...key,
    requestCount: 1,
    bytesSent: Math.max(0, Math.round(bytesSent)),
    durationMsTotal: Math.max(0, Math.round(durationMs)),
  });
}

export function drainEndpoints(): Array<EndpointAccum & EndpointKey> {
  const list = Array.from(endpointMap.values());
  endpointMap.clear();
  return list;
}

export function drainVariables(): Array<VariableAccum & VariableKey> {
  const list = Array.from(variableMap.values());
  variableMap.clear();
  return list;
}

export function bufferSizes(): { endpoints: number; variables: number } {
  return { endpoints: endpointMap.size, variables: variableMap.size };
}
