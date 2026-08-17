/**
 * Tests del endpoint interno de correo que consume auth-api.
 *
 * `purpose` decide la plantilla. Si se elige mal, el usuario recibe el correo
 * equivocado — que es exactamente el bug corregido: todo OTP salía por
 * `sendWelcomeEmail` ("Tu código de acceso"), incluidos los de recuperación.
 *
 * Dos capas de verificación:
 *  - Con emailService REAL en modo simulado (sin RESEND_API_KEY): identifica la
 *    plantilla elegida por el ASUNTO que loguea, así que valida la selección de
 *    punta a punta y no que se llamó a un doble.
 *  - Con emailService sustituido: cubre la rama 502, imposible de alcanzar con
 *    el servicio real porque en modo simulado el envío siempre tiene éxito. Ese
 *    502 es load-bearing: es lo que hace que `issueOtp` de auth-api borre el OTP
 *    que ya guardó.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import internalController from '../internalController';

vi.hoisted(() => {
  delete process.env.RESEND_API_KEY;
  process.env.NODE_ENV = 'test';
});

let logged: string[] = [];

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

const campo = (nombre: string): string => {
  const linea = logged.find((l) => l.trimStart().startsWith(`${nombre}:`));
  return linea ? linea.slice(linea.indexOf(':') + 1).trim() : '';
};
const asunto = () => campo('Asunto');
const cuerpo = () => campo('Cuerpo');

beforeEach(() => {
  logged = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(' '));
  });
});

describe('sendOtpEmail — enrutamiento por purpose', () => {
  const base = { email: 'u@e.cl', nombre: 'Denisse', code: 'A2B3C4', minutes: 30 };

  it('purpose password_reset usa la plantilla de restablecimiento', async () => {
    const res = makeRes();
    await internalController.sendOtpEmail(
      makeReq({ ...base, purpose: 'password_reset' }),
      res,
      fail,
    );

    expect(res.statusCode).toBe(200);
    expect(asunto()).toBe('Código para restablecer tu contraseña · Emeltec Cloud');
    expect(cuerpo()).toContain('A2B3C4');
  });

  it('purpose acceso usa la plantilla de login', async () => {
    const res = makeRes();
    await internalController.sendOtpEmail(makeReq({ ...base, purpose: 'acceso' }), res, fail);

    expect(asunto()).toBe('Tu código de acceso · Emeltec Cloud');
  });

  it('sin purpose mantiene el comportamiento previo (acceso)', async () => {
    const res = makeRes();
    await internalController.sendOtpEmail(makeReq(base), res, fail);

    expect(asunto()).toBe('Tu código de acceso · Emeltec Cloud');
  });

  it('purpose desconocido devuelve 400 y NO manda correo', async () => {
    const res = makeRes();
    await internalController.sendOtpEmail(makeReq({ ...base, purpose: 'inventado' }), res, fail);

    expect(res.statusCode).toBe(400);
    expect(asunto()).toBe('');
  });

  it('faltan campos obligatorios → 400 sin enviar', async () => {
    const res = makeRes();
    await internalController.sendOtpEmail(makeReq({ email: 'u@e.cl' }), res, fail);

    expect(res.statusCode).toBe(400);
    expect(asunto()).toBe('');
  });

  it('minutes ausente cae en 30', async () => {
    const res = makeRes();
    await internalController.sendOtpEmail(
      makeReq({ email: 'u@e.cl', nombre: 'D', code: 'A2B3C4', purpose: 'password_reset' }),
      res,
      fail,
    );

    expect(cuerpo()).toContain('30 minutos');
  });
});

describe('sendPasswordChangedEmail — aviso best-effort', () => {
  it('reporta origen e IP en el correo', async () => {
    const res = makeRes();
    await internalController.sendPasswordChangedEmail(
      makeReq({
        email: 'u@e.cl',
        nombre: 'Denisse',
        origen: 'recuperacion',
        ip: '190.1.2.3',
        ts: '2026-08-17T12:00:00Z',
      }),
      res,
      fail,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, delivered: true });
    expect(asunto()).toBe('Tu contraseña fue cambiada · Emeltec Cloud');
    expect(cuerpo()).toContain('recuperación desde el login');
    expect(cuerpo()).toContain('190.1.2.3');
  });

  it('sin email → 400', async () => {
    const res = makeRes();
    await internalController.sendPasswordChangedEmail(makeReq({ nombre: 'D' }), res, fail);

    expect(res.statusCode).toBe(400);
    expect(asunto()).toBe('');
  });
});
