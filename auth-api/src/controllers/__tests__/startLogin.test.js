/**
 * Tests de `startLogin` — enrutamiento del método de ingreso.
 *
 * Cubre en particular el estado que deja el reset administrativo de main-api
 * (`POST /api/users/:id/reset-password`): password_hash = NULL con la cuenta
 * todavía marcada como activada.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-para-startlogin';
process.env.INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'test-internal-key';

let selectRows = [];
const fakeDb = {
  query: async (sql) => (/^\s*SELECT/i.test(sql) ? { rows: selectRows } : { rows: [] }),
};
const auditEvents = [];
const fakeAudit = { record: async (evt) => void auditEvents.push(evt) };

function stub(relativePath, exports) {
  const resolved = require.resolve(path.join(__dirname, relativePath));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('../../config/db', fakeDb);
stub('../../services/auditLog', fakeAudit);

const authController = require('../authController');

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}
const makeReq = (body) => ({ body, ip: '10.0.0.1', headers: { 'user-agent': 'node-test' } });

function baseUser(overrides = {}) {
  return {
    id: 'u-1',
    nombre: 'Denisse',
    email: 'demo@emeltec.cl',
    tipo: 'Admin',
    empresa_id: 'e-1',
    sub_empresa_id: null,
    password_hash: 'hash',
    otp_hash: null,
    otp_expires_at: null,
    failed_logins: 0,
    locked_until: null,
    auth_mode: 'password',
    activo: true,
    activated_at: new Date(),
    otp_requests_count: 0,
    otp_requests_window_start: null,
    ...overrides,
  };
}

async function start(email = 'demo@emeltec.cl') {
  const res = makeRes();
  await authController.startLogin(makeReq({ email }), res, (e) => assert.fail(e));
  return res;
}

test('startLogin: cuenta con contrasena → flow password', async () => {
  selectRows = [baseUser()];
  const res = await start();
  assert.equal(res.body.flow, 'password');
});

test('startLogin: cuenta sin activar → flow setup', async () => {
  selectRows = [baseUser({ activated_at: null })];
  const res = await start();
  assert.equal(res.body.flow, 'setup');
});

test('startLogin: correo desconocido finge flow password (anti-enumeracion)', async () => {
  selectRows = [];
  const res = await start('nadie@emeltec.cl');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.flow, 'password');
});

test('startLogin: tras el reset administrativo la cuenta se reencauza por setup', async () => {
  // Estado que deja main-api `resetUserPassword`: sin password_hash y sin
  // activated_at. Antes NO limpiaba activated_at y la cuenta quedaba fuera: ni
  // flow password (sin hash), ni otp (auth_mode no es 'otp'), ni setup
  // (activated_at presente) → 403 y el OTP del correo era inservible.
  selectRows = [baseUser({ password_hash: null, activated_at: null })];
  const res = await start();

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.flow, 'setup');
});

test('startLogin: password_otp reseteado tambien se reencauza por setup', async () => {
  selectRows = [baseUser({ password_hash: null, activated_at: null, auth_mode: 'password_otp' })];
  const res = await start();

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.flow, 'setup');
});

test('startLogin: cuenta activada SIN password_hash sigue siendo un callejon sin salida', async () => {
  // Regresión documentada: este estado ya no lo produce ningún flujo del
  // producto, pero si aparece (edición manual en DB, migración a medias) la
  // cuenta queda sin método de ingreso. El 403 es la señal para investigar.
  selectRows = [baseUser({ password_hash: null })];
  const res = await start();

  assert.equal(res.statusCode, 403);
  assert.match(res.body.error, /no tiene metodos de ingreso/);
});
