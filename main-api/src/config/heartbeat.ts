/**
 * Accesor de latidos para los workers de la capa v2 (TS).
 *
 * Escribe en el MISMO registro global que `services/heartbeat.js` (clave
 * `__emeltecHeartbeat`), de modo que v1 y v2 comparten una sola fuente de
 * verdad sin acoplarse por imports cross-capa. El endpoint /api/status/detail
 * lee el registro vía `services/heartbeat.js::snapshot()`.
 */
const KEY = '__emeltecHeartbeat';

interface HeartbeatRegistry {
  beats: Record<string, number>;
}

function registry(): HeartbeatRegistry {
  const g = globalThis as typeof globalThis & { [KEY]?: HeartbeatRegistry };
  if (!g[KEY]) g[KEY] = { beats: {} };
  return g[KEY] as HeartbeatRegistry;
}

/** Registra un latido del worker `name` (timestamp actual). */
export function beat(name: string): void {
  registry().beats[name] = Date.now();
}
