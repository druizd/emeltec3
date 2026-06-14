/**
 * Registro de latidos de los workers in-process.
 *
 * Respaldado en globalThis para que tanto la capa v1 (CommonJS) como los
 * workers de la capa v2 (TS compilado en dist/) escriban en el MISMO registro
 * sin acoplarse por imports cross-capa. Cada worker llama `beat(nombre)` al
 * inicio de cada ciclo; el endpoint /api/status/detail lee `snapshot()`.
 */
const KEY = '__emeltecHeartbeat';

function registry() {
  if (!globalThis[KEY]) globalThis[KEY] = { beats: {} };
  return globalThis[KEY];
}

function beat(name) {
  registry().beats[name] = Date.now();
}

function snapshot() {
  return { ...registry().beats };
}

module.exports = { beat, snapshot, KEY };
