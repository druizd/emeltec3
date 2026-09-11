/**
 * MATRIZ DE AUTORIZACIÓN — cada ruta de /api/v2 contra cada perfil.
 *
 * En vez de crear usuarios de prueba y recorrer la app a mano siete veces,
 * esto enumera el router REAL y, por cada ruta, corre su cadena de middlewares
 * con cada rol para ver quién pasa y quién no. Sin base de datos, sin servidor
 * y sin credenciales.
 *
 * Lo que cubre y lo que no
 * ------------------------
 * Cubre la autorización DECLARADA (protect + authorizeRoles + guards de
 * parámetro): la puerta de entrada. No cubre el recorte por empresa/sitio que
 * los handlers hacen adentro con `canReadSite` y `scopeFor` — esa es otra capa
 * y se prueba en controllers/__tests__/rolScope.test.ts.
 *
 * Por qué la matriz es explícita
 * ------------------------------
 * ESPERADO declara ruta por ruta quién debe entrar, y una ruta que no esté ahí
 * hace fallar el test a propósito: obliga a que cada endpoint nuevo declare su
 * intención en vez de heredar en silencio el default. `TODOS` no significa
 * "sin control", significa "cualquiera autenticado, y el alcance se recorta
 * adentro". `PUBLICO` significa alcanzable sin token.
 *
 * Cómo se corre a mano el reporte completo:
 *     MATRIZ_REPORTE=1 npx vitest run src/http/v2/__tests__/matriz-roles.test.ts
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

// appConfig valida el entorno con zod al importarse.
process.env.DB_PASSWORD ??= 'test-password';
process.env.JWT_SECRET ??= 'clave-de-test-para-vitest-0123456789';
process.env.DGA_ENCRYPTION_KEY ??= 'clave-aes-256-de-test-0123456789ABCDEF';

/** Usuario que `protect` inyecta; cada caso lo reescribe. null = sin token. */
let usuarioActual: { id: string; email: string; tipo: string } | null = null;

vi.mock('jsonwebtoken', () => {
  const verify = () => {
    if (!usuarioActual) throw new Error('sin token');
    return usuarioActual;
  };
  return { default: { verify, sign: () => 'token-falso' }, verify, sign: () => 'token-falso' };
});

vi.mock('../../../services/sessionRevocation', () => ({ isSessionRevoked: async () => false }));

vi.mock('../../../config/dbHelpers', () => ({
  query: async () => ({ rows: [], rowCount: 0 }),
  transaction: async () => undefined,
}));

vi.mock('../../../config/db', () => {
  const query = async () => ({ rows: [], rowCount: 0 });
  return { default: { query }, query };
});

const ROLES = [
  'SuperAdmin',
  'Admin',
  'Gerente',
  'Cliente',
  'Empresa',
  'SubEmpresa',
  'Vendedor',
] as const;
type Rol = (typeof ROLES)[number];

/** Cualquiera autenticado; el alcance se recorta dentro del handler. */
const TODOS: readonly Rol[] = ROLES;
/** Alcanzable sin token. */
const PUBLICO: readonly Rol[] = [];
/** Todos menos Vendedor: el módulo DGA no existe en modo demo. */
const SIN_DGA: readonly Rol[] = ROLES.filter((r) => r !== 'Vendedor');

const ESPERADO: Record<string, readonly Rol[]> = {
  // --- Infraestructura: sin auth por diseño (uptime / Prometheus) ---
  'GET /health/live': PUBLICO,
  'GET /health/ready': PUBLICO,
  'GET /metrics': PUBLICO,

  // --- Login: son la puerta, no pueden exigir sesión ---
  'POST /auth/login': PUBLICO,
  'POST /auth/request-code': PUBLICO,

  // --- Telemetría: el alcance por serial lo aplica requireTelemetrySerialAccess ---
  'GET /telemetry': TODOS,
  'GET /telemetry/latest': TODOS,
  'GET /telemetry/online': TODOS,
  'GET /telemetry/preset': TODOS,
  'GET /telemetry/keys': TODOS,

  // --- Sitios y empresas: el recorte por empresa/sitio ocurre en el handler ---
  'GET /sites/:siteId/dashboard-data': TODOS,
  'GET /sites/:siteId/dashboard-history': TODOS,
  'GET /companies/tree': TODOS,
  'GET /sites/:siteId/analisis/salud': TODOS,
  'GET /sites/:siteId/analisis/metricas': TODOS,

  // --- Bitácora: mutaciones abiertas a cualquier autenticado, acotadas por
  //     assertSiteAccessById adentro. Las de :id sin :siteId resuelven el sitio
  //     desde el recurso antes de chequear (controller.ts:302 y :334). ---
  'GET /sites/:siteId/bitacora/ficha': TODOS,
  'PATCH /sites/:siteId/bitacora/ficha': TODOS,
  'POST /sites/:siteId/bitacora/contacto': TODOS,
  'POST /sites/:siteId/bitacora/contacto/:id/reveal': TODOS,
  'PATCH /sites/:siteId/bitacora/contacto/:id': TODOS,
  'DELETE /sites/:siteId/bitacora/contacto/:id': TODOS,
  'GET /sites/:siteId/bitacora/equipos': TODOS,
  'POST /sites/:siteId/bitacora/equipos': TODOS,
  'PATCH /sites/bitacora/equipos/:id': TODOS,
  'DELETE /sites/bitacora/equipos/:id': TODOS,

  // --- Revelado de PII: cualquiera autenticado, pero exige 2FA ---
  'POST /companies/contacts/:id/reveal': TODOS,
  'POST /users/:id/reveal': TODOS,

  // --- DGA. Vendedor queda fuera de TODO el módulo (blockDemoAccess).
  //     El bloqueo estaba solo en las escrituras y en los .csv: un Vendedor
  //     leía los mismos datos en JSON y el bloqueo de la descarga no servía
  //     de nada. Si agregás un endpoint DGA nuevo, va con blockDemoAccess. ---
  'GET /dga/dato': SIN_DGA,
  'GET /dga/dato/export.csv': SIN_DGA,
  'GET /dga/export-directo.csv': SIN_DGA,
  'GET /dga/sites/:siteId/pozo-config': SIN_DGA,
  'PATCH /dga/sites/:siteId/pozo-config': SIN_DGA,
  'GET /dga/sites/:siteId/live-preview': SIN_DGA,
  'GET /dga/sites/:siteId/ultimo-envio': SIN_DGA,
  'GET /dga/sites/:siteId/verify': SIN_DGA,

  // --- DGA administrativo: staff Emeltec ---
  'GET /dga/review-queue': ['SuperAdmin', 'Admin'],
  'POST /dga/review-queue/action': ['SuperAdmin', 'Admin'],
  'POST /dga/sites/:siteId/reconocer-sensor-defectuoso': ['SuperAdmin', 'Admin'],
  // Acciones en bloque sobre un rango de slots. El resumen es lectura, pero se
  // restringe igual que la acción: existe solo para precederla, y el estado
  // interno de la cola de envío no es dato de tenant.
  'GET /dga/sites/:siteId/slots/resumen': ['SuperAdmin', 'Admin'],
  'POST /dga/sites/:siteId/slots/bulk': ['SuperAdmin', 'Admin'],

  // --- Informantes DGA y resumen de salud: solo SuperAdmin ---
  'GET /dga/informantes': ['SuperAdmin'],
  'POST /dga/informantes': ['SuperAdmin'],
  'PATCH /dga/informantes/:rut': ['SuperAdmin'],
  'DELETE /dga/informantes/:rut': ['SuperAdmin'],
  'GET /health-digest/destinatarios': ['SuperAdmin'],
  'PUT /health-digest/destinatarios': ['SuperAdmin'],
  'POST /health-digest/prueba': ['SuperAdmin'],
};

interface Capa {
  handle: (req: unknown, res: unknown, next: (err?: unknown) => void) => unknown;
  name: string;
}
interface RutaExpress {
  path: string;
  methods: Record<string, boolean>;
  stack: Capa[];
}

function reqFalso(method: string, path: string): Record<string, unknown> {
  return {
    method,
    path,
    originalUrl: `/api/v2${path}`,
    url: `/api/v2${path}`,
    baseUrl: '/api/v2',
    headers: { authorization: 'Bearer token-falso' },
    params: {},
    query: {},
    body: {},
    get: () => undefined,
    header: () => undefined,
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
  };
}

interface CtxRes {
  res: Record<string, unknown>;
  status: () => number | null;
  codigo: () => string | null;
  alTerminar: (cb: () => void) => void;
}

function resFalso(): CtxRes {
  let status: number | null = null;
  let codigo: string | null = null;
  let cb: (() => void) | null = null;
  const fin = () => {
    if (status === null) status = 200;
    cb?.();
  };
  const res: Record<string, unknown> = {
    headersSent: false,
    statusCode: 200,
    status(c: number) {
      status = c;
      return res;
    },
    json: (body?: { code?: string }) => {
      codigo = body?.code ?? null;
      fin();
      return res;
    },
    send: () => (fin(), res),
    end: () => (fin(), res),
    setHeader: () => res,
    getHeader: () => undefined,
    on: () => res,
    once: () => res,
    emit: () => false,
    locals: {},
  };
  return {
    res,
    status: () => status,
    codigo: () => codigo,
    alTerminar: (fn) => {
      cb = fn;
    },
  };
}

/**
 * Resultado de una capa. `error` es el caso importante: los middlewares en TS
 * no responden, hacen `next(new ForbiddenError(...))` y delegan en el
 * errorMiddleware. Tratar ese next() como "siguió de largo" fue justamente el
 * bug que tenía la primera versión de este arnés — daba por abiertas rutas que
 * en realidad cortan con 401.
 */
type Salida = { tipo: 'next' } | { tipo: 'corte'; status: number | null; codigo?: string | null };

function correrCapa(capa: Capa, req: Record<string, unknown>, ctx: CtxRes): Promise<Salida> {
  return new Promise((resolve) => {
    let listo = false;
    const cerrar = (s: Salida) => {
      if (!listo) {
        listo = true;
        resolve(s);
      }
    };
    ctx.alTerminar(() => cerrar({ tipo: 'corte', status: ctx.status(), codigo: ctx.codigo() }));
    const next = (err?: unknown) => {
      if (err) {
        const status = (err as { status?: number }).status ?? 500;
        cerrar({ tipo: 'corte', status });
      } else {
        cerrar({ tipo: 'next' });
      }
    };
    try {
      Promise.resolve(capa.handle(req, ctx.res, next))
        .then(() =>
          setImmediate(() => cerrar({ tipo: 'corte', status: ctx.status(), codigo: ctx.codigo() })),
        )
        .catch((e) => cerrar({ tipo: 'corte', status: (e as { status?: number }).status ?? 500 }));
    } catch (e) {
      cerrar({ tipo: 'corte', status: (e as { status?: number }).status ?? 500 });
    }
  });
}

interface Corte {
  status: number | null;
  codigo: string | null;
}

/** Recorre la cadena sin el handler final y devuelve dónde cortó. */
async function recorrerPuerta(ruta: RutaExpress, method: string): Promise<Corte> {
  const req = reqFalso(method, ruta.path);
  for (const capa of ruta.stack.slice(0, -1)) {
    const ctx = resFalso();
    const s = await correrCapa(capa, req, ctx);
    if (s.tipo === 'corte') return { status: s.status, codigo: s.codigo ?? null };
  }
  return { status: null, codigo: null }; // llegó al handler
}

/**
 * 401/403 deniegan la puerta, con UNA excepción: require2fa también responde
 * 403, pero con code TWOFA_REQUIRED. Ahí el rol SÍ pasó y lo frena el segundo
 * factor. Confundirlos hacía que rutas correctamente restringidas figuraran
 * como "no entra nadie".
 */
const DOS_FACTORES = new Set(['TWOFA_REQUIRED', 'TWOFA_INVALID']);
const denegado = (c: Corte) =>
  (c.status === 401 || c.status === 403) && !(c.codigo && DOS_FACTORES.has(c.codigo));

async function rolesQuePasan(ruta: RutaExpress, method: string): Promise<Rol[]> {
  const pasan: Rol[] = [];
  for (const rol of ROLES) {
    usuarioActual = { id: 'U0001', email: `${rol}@test.local`, tipo: rol };
    if (!denegado(await recorrerPuerta(ruta, method))) pasan.push(rol);
  }
  return pasan;
}

let rutas: Array<{ clave: string; ruta: RutaExpress; method: string }> = [];

beforeAll(async () => {
  const mod = await import('../routes.js');
  const router = mod.default as unknown as { stack: Array<{ route?: RutaExpress }> };
  rutas = router.stack
    .filter((l) => l.route)
    .flatMap((l) => {
      const ruta = l.route as RutaExpress;
      return Object.keys(ruta.methods)
        .filter((m) => ruta.methods[m])
        .map((m) => ({ clave: `${m.toUpperCase()} ${ruta.path}`, ruta, method: m.toUpperCase() }));
    });

  if (process.env.MATRIZ_REPORTE) {
    const lineas: string[] = [];
    for (const { clave, ruta, method } of rutas) {
      usuarioActual = null;
      const anon = !denegado(await recorrerPuerta(ruta, method));
      const pasan = await rolesQuePasan(ruta, method);
      lineas.push(
        `${anon ? 'PUBLICO  ' : pasan.length === ROLES.length ? 'TODOS    ' : 'RESTRING.'} ` +
          `${clave.padEnd(52)} ${pasan.join(',')}`,
      );
    }
    console.log(`\n--- MATRIZ (${rutas.length} rutas) ---\n${lineas.join('\n')}\n`);
  }
});

describe('matriz de autorización /api/v2', () => {
  it('el router expone rutas para analizar', () => {
    expect(rutas.length).toBeGreaterThan(30);
  });

  it('toda ruta está clasificada en ESPERADO', () => {
    const sinClasificar = rutas.map((r) => r.clave).filter((c) => !(c in ESPERADO));
    expect(
      sinClasificar,
      'Rutas sin entrada en ESPERADO. Agregá cada una con los roles que debe admitir ' +
        '(TODOS si basta con estar autenticado, PUBLICO si no requiere token).',
    ).toEqual([]);
  });

  it('cada ruta admite exactamente los roles declarados', async () => {
    const desvios: string[] = [];
    for (const { clave, ruta, method } of rutas) {
      const esperados = ESPERADO[clave];
      if (!esperados || esperados === PUBLICO) continue;
      const reales = await rolesQuePasan(ruta, method);
      const faltan = esperados.filter((r) => !reales.includes(r));
      const sobran = reales.filter((r) => !esperados.includes(r));
      if (faltan.length || sobran.length) {
        desvios.push(
          `${clave}\n    esperado: ${esperados.join(', ')}\n    real:     ${reales.join(', ') || '(ninguno)'}` +
            (sobran.length ? `\n    DE MÁS:   ${sobran.join(', ')}` : '') +
            (faltan.length ? `\n    FALTAN:   ${faltan.join(', ')}` : ''),
        );
      }
    }
    expect(desvios.join('\n')).toBe('');
  });

  it('solo las rutas marcadas PUBLICO son alcanzables sin token', async () => {
    const inesperadas: string[] = [];
    for (const { clave, ruta, method } of rutas) {
      usuarioActual = null;
      const abierta = !denegado(await recorrerPuerta(ruta, method));
      const deberia = ESPERADO[clave] === PUBLICO;
      if (abierta !== deberia) {
        inesperadas.push(
          `${clave}: ${abierta ? 'ABIERTA sin token' : 'exige token'}, se esperaba ${deberia ? 'PUBLICO' : 'con token'}`,
        );
      }
    }
    expect(inesperadas.join('\n')).toBe('');
  });
});
