/**
 * Rama de fallo del endpoint interno de correo.
 *
 * Va en un archivo aparte porque necesita sustituir emailService, y el otro test
 * (`internalController.test.ts`) usa el servicio REAL en modo simulado para
 * verificar qué plantilla se elige. Mezclar ambas cosas en un archivo obliga a
 * un mock condicional que oscurece las dos.
 *
 * Por qué importa el 502: es lo que hace que `issueOtp` de auth-api borre el OTP
 * que ya escribió en la base. Si esto degradara a 200, el usuario quedaría con
 * un código guardado que nunca recibió.
 *
 * Se sustituye vía `require.cache`, NO con `vi.mock`. internalController es
 * CommonJS y llama `require('../services/emailService')`: ese require pasa por
 * el loader de Node, que vitest no parchea, así que `vi.mock` no intercepta —
 * verificado, se cargaba el servicio real y respondía 200 con id 'dev-mode'.
 * Mismo motivo por el que falló con `config/db` y con `resend`.
 *
 * `createRequire` recibe una ruta absoluta derivada de cwd en vez de
 * `import.meta.url`: en runtime vitest es ESM y tendría import.meta, pero el
 * tsconfig compila a CommonJS y `tsc` lo rechaza (TS1470). Los tests pasaban en
 * verde mientras el typecheck fallaba.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const enviados: { fn: string; args: unknown[] }[] = [];
const resultado = { ok: false as boolean, error: 'Resend caido' as string | undefined };

const registrar =
  (fn: string) =>
  async (...args: unknown[]) => {
    enviados.push({ fn, args });
    return resultado;
  };

// cwd es la raíz del paquete al correr `npm test` / `pnpm -r test`. Si no lo
// fuera, `resolve` lanza en vez de fallar en silencio.
const require_ = createRequire(path.join(process.cwd(), 'vitest-require-root.js'));

const emailServicePath = require_.resolve('./src/services/emailService');
require_.cache[emailServicePath] = {
  id: emailServicePath,
  filename: emailServicePath,
  loaded: true,
  exports: {
    sendWelcomeEmail: registrar('sendWelcomeEmail'),
    sendPasswordResetEmail: registrar('sendPasswordResetEmail'),
    sendPasswordChangedEmail: registrar('sendPasswordChangedEmail'),
  },
} as NodeJS.Module;

const internalController = require_('./src/controllers/internalController');

function makeRes() {
  return {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}
const makeReq = (body: unknown) => ({ body });
const fail = (e?: unknown) => expect.unreachable(`no debe llamar a next: ${String(e)}`);

beforeEach(() => {
  enviados.length = 0;
  resultado.ok = false;
  resultado.error = 'Resend caido';
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('sendOtpEmail — fallo del proveedor', () => {
  const base = { email: 'u@e.cl', nombre: 'Denisse', code: 'A2B3C4', minutes: 30 };

  it('devuelve 502 cuando emailService reporta ok:false', async () => {
    const res = makeRes();
    await internalController.sendOtpEmail(
      makeReq({ ...base, purpose: 'password_reset' }),
      res,
      fail,
    );

    expect(res.statusCode).toBe(502);
    expect(res.body).toMatchObject({ ok: false });
    // auth-api lee este mensaje para su propio audit_log.
    expect(res.body).toMatchObject({ message: 'Resend caido' });
  });

  it('el 502 tambien aplica a la plantilla de acceso', async () => {
    const res = makeRes();
    await internalController.sendOtpEmail(makeReq({ ...base, purpose: 'acceso' }), res, fail);

    expect(res.statusCode).toBe(502);
    expect(enviados.map((e) => e.fn)).toEqual(['sendWelcomeEmail']);
  });

  it('sin mensaje del proveedor cae en un texto generico', async () => {
    resultado.error = undefined;
    const res = makeRes();
    await internalController.sendOtpEmail(
      makeReq({ ...base, purpose: 'password_reset' }),
      res,
      fail,
    );

    expect(res.statusCode).toBe(502);
    expect(res.body).toMatchObject({ message: 'El proveedor de correo rechazo el envio.' });
  });

  it('con ok:true responde 200', async () => {
    resultado.ok = true;
    const res = makeRes();
    await internalController.sendOtpEmail(
      makeReq({ ...base, purpose: 'password_reset' }),
      res,
      fail,
    );

    expect(res.statusCode).toBe(200);
  });
});

describe('sendPasswordChangedEmail — fallo del proveedor', () => {
  it('responde 200 con delivered=false: la contrasena YA cambio', async () => {
    // No puede tumbar la respuesta ni hacer que auth-api reintente el flujo:
    // el cambio de contrasena es irreversible desde acá.
    const res = makeRes();
    await internalController.sendPasswordChangedEmail(
      makeReq({ email: 'u@e.cl', nombre: 'Denisse', origen: 'perfil' }),
      res,
      fail,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, delivered: false });
  });

  it('el fallo queda logueado para operaciones', async () => {
    const res = makeRes();
    await internalController.sendPasswordChangedEmail(
      makeReq({ email: 'u@e.cl', nombre: 'Denisse', origen: 'recuperacion' }),
      res,
      fail,
    );

    expect(console.error).toHaveBeenCalledWith(
      '[internal] Aviso de cambio de contrasena no enviado:',
      'Resend caido',
    );
  });
});
