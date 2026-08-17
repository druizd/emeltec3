/**
 * Tests del flujo de recuperación de contraseña.
 *
 * `db` y `auditLog` se sustituyen vía require.cache antes de cargar el
 * controlador, para no abrir conexiones reales ni escribir en audit_log.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-para-recovery';
process.env.INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'test-internal-key';

const JWT_SECRET = process.env.JWT_SECRET;

// --- dobles de prueba -------------------------------------------------------

const dbCalls = [];
let selectRows = [];
const fakeDb = {
  query: async (sql, params) => {
    dbCalls.push({ sql, params });
    if (/^\s*SELECT/i.test(sql)) return { rows: selectRows };
    return { rows: [] };
  },
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

// --- helpers ----------------------------------------------------------------

function makeRes() {
  const res = {
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
  return res;
}

const makeReq = (body) => ({ body, ip: '10.0.0.1', headers: { 'user-agent': 'node-test' } });

function resetState() {
  dbCalls.length = 0;
  auditEvents.length = 0;
  selectRows = [];
  globalThis.fetch = async () => ({ ok: true, text: async () => JSON.stringify({ ok: true }) });
}

const resetTokenFor = (email) =>
  jwt.sign({ email, purpose: 'password_reset' }, JWT_SECRET, {
    expiresIn: '10m',
    algorithm: 'HS256',
  });

async function activeUser(overrides = {}) {
  return {
    id: 'u-1',
    nombre: 'Denisse',
    email: 'demo@emeltec.cl',
    tipo: 'Admin',
    empresa_id: 'e-1',
    sub_empresa_id: null,
    password_hash: 'hash-viejo',
    otp_hash: await bcrypt.hash('A2B3C4', 4),
    otp_expires_at: new Date(Date.now() + 10 * 60 * 1000),
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

const NEW_PASSWORD = 'Emeltec2026!';
const sqlOf = (call) => call.sql.replace(/\s+/g, ' ');
const updates = () => dbCalls.filter((c) => /^\s*UPDATE/i.test(c.sql)).map(sqlOf);

// --- startRecovery ----------------------------------------------------------

test('startRecovery: correo desconocido devuelve reset_token igual (anti-enumeracion)', async () => {
  resetState();
  selectRows = [];
  let otpEnviado = false;
  globalThis.fetch = async () => {
    otpEnviado = true;
    return { ok: true, text: async () => JSON.stringify({ ok: true }) };
  };

  const res = makeRes();
  await authController.startRecovery(
    makeReq({ email: 'nadie@emeltec.cl', new_password: NEW_PASSWORD }),
    res,
    (e) => assert.fail(e),
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.ok(res.body.reset_token, 'debe emitir reset_token aunque la cuenta no exista');
  assert.equal(otpEnviado, false, 'no debe mandar OTP a un correo inexistente');
  assert.equal(auditEvents.at(-1).action, 'password_reset.unknown_email');
});

test('startRecovery: cuenta solo-OTP no recibe codigo pero responde igual', async () => {
  resetState();
  selectRows = [await activeUser({ auth_mode: 'otp' })];
  let otpEnviado = false;
  globalThis.fetch = async () => {
    otpEnviado = true;
    return { ok: true, text: async () => JSON.stringify({ ok: true }) };
  };

  const res = makeRes();
  await authController.startRecovery(
    makeReq({ email: 'demo@emeltec.cl', new_password: NEW_PASSWORD }),
    res,
    (e) => assert.fail(e),
  );

  assert.equal(res.body.ok, true);
  assert.ok(res.body.reset_token);
  assert.equal(otpEnviado, false);
  assert.equal(auditEvents.at(-1).metadata.reason, 'password_login_disabled');
});

test('startRecovery: rechaza contrasena que no cumple la politica', async () => {
  resetState();
  const res = makeRes();
  await authController.startRecovery(
    makeReq({ email: 'demo@emeltec.cl', new_password: '12345678' }),
    res,
    (e) => assert.fail(e),
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.equal(dbCalls.length, 0, 'no debe tocar la DB si la politica falla');
});

test('startRecovery: cuenta elegible recibe OTP con purpose password_reset', async () => {
  resetState();
  selectRows = [await activeUser()];
  let cuerpoEnviado = null;
  globalThis.fetch = async (_url, init) => {
    cuerpoEnviado = JSON.parse(init.body);
    return { ok: true, text: async () => JSON.stringify({ ok: true }) };
  };

  const res = makeRes();
  await authController.startRecovery(
    makeReq({ email: 'demo@emeltec.cl', new_password: NEW_PASSWORD }),
    res,
    (e) => assert.fail(e),
  );

  assert.equal(res.body.ok, true);
  assert.equal(cuerpoEnviado.purpose, 'password_reset');
  assert.ok(res.body.expires_at);
});

test('startRecovery: un 502 del proveedor de correo no se filtra al cliente', async () => {
  resetState();
  selectRows = [await activeUser()];
  globalThis.fetch = async () => ({
    ok: false,
    text: async () => JSON.stringify({ ok: false, error: 'Resend caido' }),
  });

  const res = makeRes();
  await authController.startRecovery(
    makeReq({ email: 'demo@emeltec.cl', new_password: NEW_PASSWORD }),
    res,
    (e) => assert.fail(`no debe propagar al errorMiddleware: ${e && e.message}`),
  );

  // Mismo 200 genérico que un correo inexistente: el status no puede delatar
  // que la cuenta existe (EMT-H10).
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.ok(res.body.reset_token);
  assert.equal(res.body.expires_at, undefined);
});

test('startRecovery: el throttle por cuenta tampoco cambia la respuesta', async () => {
  resetState();
  // 5 solicitudes ya usadas dentro de la ventana → issueOtp lanza 429.
  selectRows = [await activeUser({ otp_requests_count: 5, otp_requests_window_start: new Date() })];

  const res = makeRes();
  await authController.startRecovery(
    makeReq({ email: 'demo@emeltec.cl', new_password: NEW_PASSWORD }),
    res,
    (e) => assert.fail(`no debe propagar al errorMiddleware: ${e && e.message}`),
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.expires_at, undefined);
});

// --- completeRecovery -------------------------------------------------------

test('completeRecovery: reset_token de otro correo se rechaza', async () => {
  resetState();
  const res = makeRes();
  await authController.completeRecovery(
    makeReq({
      email: 'demo@emeltec.cl',
      new_password: NEW_PASSWORD,
      otp_code: 'A2B3C4',
      reset_token: resetTokenFor('otro@emeltec.cl'),
    }),
    res,
    (e) => assert.fail(e),
  );

  assert.equal(res.statusCode, 401);
  assert.match(res.body.error, /expiro/);
});

test('completeRecovery: sin OTP pendiente NO cuenta contra el lockout', async () => {
  resetState();
  selectRows = [await activeUser({ otp_hash: null, otp_expires_at: null })];

  const res = makeRes();
  await authController.completeRecovery(
    makeReq({
      email: 'demo@emeltec.cl',
      new_password: NEW_PASSWORD,
      otp_code: 'ZZZZZZ',
      reset_token: resetTokenFor('demo@emeltec.cl'),
    }),
    res,
    (e) => assert.fail(e),
  );

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'Codigo invalido o expirado.');
  assert.equal(auditEvents.at(-1).metadata.reason, 'no_pending_otp');
  assert.ok(
    !updates().some((sql) => sql.includes('failed_logins =')),
    'no debe incrementar failed_logins sin OTP pendiente',
  );
});

test('completeRecovery: OTP equivocado con OTP pendiente si cuenta contra el lockout', async () => {
  resetState();
  selectRows = [await activeUser()];

  const res = makeRes();
  await authController.completeRecovery(
    makeReq({
      email: 'demo@emeltec.cl',
      new_password: NEW_PASSWORD,
      otp_code: 'ZZZZZZ',
      reset_token: resetTokenFor('demo@emeltec.cl'),
    }),
    res,
    (e) => assert.fail(e),
  );

  assert.equal(res.statusCode, 401);
  assert.ok(updates().some((sql) => sql.includes('failed_logins = $1')));
});

test('completeRecovery: OTP valido cambia la contrasena y corta las sesiones', async () => {
  resetState();
  selectRows = [await activeUser()];

  const res = makeRes();
  await authController.completeRecovery(
    makeReq({
      email: 'demo@emeltec.cl',
      new_password: NEW_PASSWORD,
      otp_code: 'A2B3C4',
      reset_token: resetTokenFor('demo@emeltec.cl'),
    }),
    res,
    (e) => assert.fail(e),
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.ok(!res.body.token, 'no debe auto-loguear: el MFA sigue exigiendose al entrar');

  const update = updates().find((sql) => sql.includes('password_hash = $1'));
  assert.ok(update, 'debe actualizar el hash');
  assert.ok(update.includes('sessions_valid_from = NOW()'), 'debe cortar las sesiones abiertas');
  assert.ok(!update.includes('auth_mode'), 'no debe tocar auth_mode');
  assert.equal(auditEvents.at(-1).action, 'password_reset.success');
});

test('completeRecovery: cuenta desactivada responde el 401 generico', async () => {
  resetState();
  selectRows = [await activeUser({ activo: false })];

  const res = makeRes();
  await authController.completeRecovery(
    makeReq({
      email: 'demo@emeltec.cl',
      new_password: NEW_PASSWORD,
      otp_code: 'A2B3C4',
      reset_token: resetTokenFor('demo@emeltec.cl'),
    }),
    res,
    (e) => assert.fail(e),
  );

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'Codigo invalido o expirado.');
});
