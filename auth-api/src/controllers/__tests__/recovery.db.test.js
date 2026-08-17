/**
 * Integración del flujo de recuperación contra una base REAL.
 *
 * Los otros tests sustituyen `config/db` por un doble que devuelve filas
 * prefabricadas y guarda los SQL como texto. Eso verifica bien la lógica de
 * decisión, pero acepta cualquier SQL sin ejecutarlo: no detecta una columna
 * inexistente, placeholders `$n` desalineados, ni constraints reales. Este
 * archivo cubre justamente eso.
 *
 * Se activa con RUN_DB_TESTS=1 y las DB_* apuntando a una base con el esquema
 * aplicado (init-db + infra-db/migrations). En CI lo hace el job `db-tests`; en
 * local se salta solo, así que `npm test` sigue funcionando sin Docker.
 *
 * El OTP se obtiene interceptando `fetch`: el controlador lo manda a main-api en
 * el body, así que el test lo lee de ahí en vez de inventarlo. Eso hace el ciclo
 * genuinamente de punta a punta — el hash que valida es el que se escribió.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const RUN = process.env.RUN_DB_TESTS === '1';
const opciones = { skip: RUN ? false : 'requiere RUN_DB_TESTS=1 y una base con esquema' };

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-db';
process.env.INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'test-internal-key';

const EMAIL = 'recovery-it@example.invalid';
const USER_ID = 'ITU001';
const NEW_PASSWORD = 'Emeltec2026!';

let db;
let authController;
if (RUN) {
  db = require('../../config/db');
  authController = require('../authController');
}

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
const makeReq = (body) => ({ body, ip: '10.0.0.1', headers: { 'user-agent': 'db-test' } });

/** Captura el OTP que el controlador envía a main-api. */
function interceptarCorreo() {
  const capturado = { code: null, purpose: null };
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    capturado.code = body.code;
    capturado.purpose = body.purpose;
    return { ok: true, text: async () => JSON.stringify({ ok: true }) };
  };
  return capturado;
}

async function sembrarUsuario() {
  await db.query('DELETE FROM usuario WHERE email = $1', [EMAIL]);
  await db.query(
    `INSERT INTO usuario
       (id, nombre, apellido, email, tipo, password_hash, auth_mode, activated_at)
     VALUES ($1, 'Integracion', 'Test', $2, 'Admin', $3, 'password', NOW())`,
    [USER_ID, EMAIL, await bcrypt.hash('ViejaPassword1!', 4)],
  );
}

const leerUsuario = async () => {
  const { rows } = await db.query(
    `SELECT password_hash, otp_hash, otp_expires_at, sessions_valid_from,
            failed_logins, locked_until, auth_mode, activated_at
     FROM usuario WHERE email = $1`,
    [EMAIL],
  );
  return rows[0];
};

test('ciclo completo de recuperacion contra la base real', opciones, async () => {
  await sembrarUsuario();
  const antes = await leerUsuario();
  assert.equal(antes.sessions_valid_from, null, 'arranca sin corte de sesiones');

  // --- start: escribe el OTP hasheado y manda el codigo por correo
  const correo = interceptarCorreo();
  const resStart = makeRes();
  await authController.startRecovery(
    makeReq({ email: EMAIL, new_password: NEW_PASSWORD }),
    resStart,
    (e) => assert.fail(e),
  );

  assert.equal(resStart.statusCode, 200);
  assert.ok(resStart.body.reset_token);
  assert.equal(correo.purpose, 'password_reset');
  assert.match(correo.code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);

  const conOtp = await leerUsuario();
  assert.ok(conOtp.otp_hash, 'el OTP quedo guardado');
  assert.ok(await bcrypt.compare(correo.code, conOtp.otp_hash), 'el hash corresponde al codigo');
  assert.ok(new Date(conOtp.otp_expires_at) > new Date(), 'el OTP no esta expirado');

  // --- complete: con el codigo real que salio por correo
  const resComplete = makeRes();
  await authController.completeRecovery(
    makeReq({
      email: EMAIL,
      new_password: NEW_PASSWORD,
      otp_code: correo.code,
      reset_token: resStart.body.reset_token,
    }),
    resComplete,
    (e) => assert.fail(e),
  );

  assert.equal(resComplete.statusCode, 200, JSON.stringify(resComplete.body));
  assert.equal(resComplete.body.ok, true);
  assert.ok(!resComplete.body.token, 'sin auto-login');

  const despues = await leerUsuario();
  assert.ok(
    await bcrypt.compare(NEW_PASSWORD, despues.password_hash),
    'la contrasena nueva quedo escrita',
  );
  assert.equal(despues.otp_hash, null, 'el OTP se consumio');
  assert.equal(despues.otp_expires_at, null);
  assert.ok(despues.sessions_valid_from, 'se corto las sesiones abiertas');
  assert.equal(despues.failed_logins, 0);
  assert.equal(despues.locked_until, null);
  // No se toca auth_mode: una cuenta con MFA conserva su segundo factor.
  assert.equal(despues.auth_mode, 'password');
});

test('OTP equivocado no cambia la contrasena y consume el codigo', opciones, async () => {
  await sembrarUsuario();
  const correo = interceptarCorreo();
  const resStart = makeRes();
  await authController.startRecovery(
    makeReq({ email: EMAIL, new_password: NEW_PASSWORD }),
    resStart,
    (e) => assert.fail(e),
  );

  const previo = await leerUsuario();

  const resComplete = makeRes();
  await authController.completeRecovery(
    makeReq({
      email: EMAIL,
      new_password: NEW_PASSWORD,
      otp_code: 'ZZZZZZ',
      reset_token: resStart.body.reset_token,
    }),
    resComplete,
    (e) => assert.fail(e),
  );

  assert.equal(resComplete.statusCode, 401);
  const despues = await leerUsuario();
  assert.equal(despues.password_hash, previo.password_hash, 'la contrasena NO cambio');
  assert.equal(despues.sessions_valid_from, null, 'no se cortaron sesiones');
  // EMT-H11: el OTP es de un solo uso, se invalida en cada intento fallido.
  assert.equal(despues.otp_hash, null);
  assert.equal(despues.failed_logins, 1, 'el intento cuenta contra el lockout');
  assert.ok(correo.code);
});

test('sin OTP pendiente el intento NO incrementa el lockout', opciones, async () => {
  await sembrarUsuario();

  const resetToken = jwt.sign({ email: EMAIL, purpose: 'password_reset' }, process.env.JWT_SECRET, {
    expiresIn: '10m',
    algorithm: 'HS256',
  });

  const res = makeRes();
  await authController.completeRecovery(
    makeReq({
      email: EMAIL,
      new_password: NEW_PASSWORD,
      otp_code: 'ZZZZZZ',
      reset_token: resetToken,
    }),
    res,
    (e) => assert.fail(e),
  );

  assert.equal(res.statusCode, 401);
  const u = await leerUsuario();
  assert.equal(u.failed_logins, 0, 'no se puede bloquear una cuenta sin OTP pendiente');
});

test('correo desconocido no escribe nada en la base', opciones, async () => {
  const correo = interceptarCorreo();
  const res = makeRes();
  await authController.startRecovery(
    makeReq({ email: 'no-existe-jamas@example.invalid', new_password: NEW_PASSWORD }),
    res,
    (e) => assert.fail(e),
  );

  assert.equal(res.statusCode, 200);
  assert.ok(res.body.reset_token, 'emite token igual (anti-enumeracion)');
  assert.equal(correo.code, null, 'no manda OTP');
});

test.after(async () => {
  if (!RUN) return;
  await db.query('DELETE FROM usuario WHERE email = $1', [EMAIL]);
  await db.end();
});
