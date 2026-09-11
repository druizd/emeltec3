/**
 * Polyfills para el entorno de test. Se registra vía `setupFiles` del target
 * `test` en angular.json.
 *
 * Node 24 sólo expone `localStorage`/`sessionStorage` si el proceso arranca con
 * `--localstorage-file`, y el runner de Angular no lo pasa: sin esto, todo spec
 * que toque storage falla con "Cannot read properties of undefined (reading
 * 'clear')". El doble en memoria además aísla mejor entre tests que el storage
 * real del navegador.
 *
 * No inicializa el TestBed: de eso se encarga el propio builder.
 */

function createMemoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => (data.has(key) ? (data.get(key) as string) : null),
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    removeItem: (key: string) => void data.delete(key),
    setItem: (key: string, value: string) => void data.set(key, String(value)),
  } as Storage;
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  let usable = false;
  try {
    usable = !!(globalThis as Record<string, unknown>)[name];
  } catch {
    usable = false; // en Node 24 el acceso puede lanzar si no está habilitado
  }
  if (usable) continue;

  Object.defineProperty(globalThis, name, {
    value: createMemoryStorage(),
    configurable: true,
    writable: true,
  });
}
