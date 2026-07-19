/**
 * Tests del core email-OTP unificado (reemplaza stepUp2fa.js + dga/twofactor.ts).
 *
 * Contrato heredado de stepUp2fa: 6 dígitos, TTL 5min, single-use,
 * timingSafeEqual, 403 (nunca 401) con TWOFA_REQUIRED/TWOFA_INVALID.
 * Nuevo: máximo 5 intentos fallidos → código invalidado (anti fuerza bruta,
 * debilidad compartida de las dos implementaciones anteriores).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/emailService', () => ({
  send2faCode: vi.fn(async () => ({ ok: true })),
}));

import { send2faCode } from '../../services/emailService';
import { requestCode, verifyCode, require2fa, _seedCode, MAX_ATTEMPTS } from '../email-otp';

const user = { id: 'U1', email: 'u@e.cl' };

function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('requestCode', () => {
  it('usuario sin email → throw 400, no guarda código', async () => {
    await expect(requestCode({ id: 'X' } as any)).rejects.toMatchObject({ status: 400 });
    expect(send2faCode).not.toHaveBeenCalled();
  });

  it('email falla → throw 502 y el código NO queda activo', async () => {
    vi.mocked(send2faCode).mockResolvedValueOnce({ ok: false } as never);
    const u = { id: 'U-FAIL', email: 'fail@e.cl' };
    await expect(requestCode(u)).rejects.toMatchObject({ status: 502 });
    // Nada pendiente: cualquier código da false
    expect(verifyCode(u, '000000')).toBe(false);
  });

  it('envío OK → guarda código de 6 dígitos y lo manda al email del usuario', async () => {
    const u = { id: 'U-OK', email: 'ok@e.cl' };
    await requestCode(u);
    expect(send2faCode).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'ok@e.cl', code: expect.stringMatching(/^\d{6}$/) }),
    );
    const sent = vi.mocked(send2faCode).mock.calls[0]![0] as { code: string };
    expect(verifyCode(u, sent.code)).toBe(true);
  });
});

describe('verifyCode', () => {
  it('código válido → true, y es single-use (segundo intento false)', () => {
    _seedCode(user, '123456');
    expect(verifyCode(user, '123456')).toBe(true);
    expect(verifyCode(user, '123456')).toBe(false);
  });

  it('código incorrecto → false (no consume, reintento válido pasa)', () => {
    _seedCode(user, '111111');
    expect(verifyCode(user, '000000')).toBe(false);
    expect(verifyCode(user, '111111')).toBe(true);
  });

  it('código expirado → false', () => {
    _seedCode(user, '222222', -1000);
    expect(verifyCode(user, '222222')).toBe(false);
  });

  it('sin código pendiente → false', () => {
    expect(verifyCode({ id: 'NOPE', email: 'x@y.cl' }, '999999')).toBe(false);
  });

  it(`${MAX_ATTEMPTS} intentos fallidos → código invalidado (el correcto ya no sirve)`, () => {
    _seedCode(user, '333333');
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      expect(verifyCode(user, '999999')).toBe(false);
    }
    // Anti fuerza bruta: el código correcto quedó invalidado
    expect(verifyCode(user, '333333')).toBe(false);
  });

  it(`${MAX_ATTEMPTS - 1} fallos + correcto → true (cap no dispara antes)`, () => {
    _seedCode(user, '444444');
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
      expect(verifyCode(user, '000000')).toBe(false);
    }
    expect(verifyCode(user, '444444')).toBe(true);
  });

  it('longitud distinta también cuenta como intento fallido', () => {
    _seedCode(user, '555555');
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      expect(verifyCode(user, '1')).toBe(false);
    }
    expect(verifyCode(user, '555555')).toBe(false);
  });
});

describe('require2fa middleware', () => {
  it('sin header → 403 TWOFA_REQUIRED', () => {
    const req: any = { user, headers: {} };
    const res = mockRes();
    const next = vi.fn();
    require2fa(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, code: 'TWOFA_REQUIRED' }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('código inválido → 403 TWOFA_INVALID (nunca 401: el frontend deslogea ante 401)', () => {
    const req: any = { user, headers: { 'x-2fa-code': '000000' } };
    const res = mockRes();
    const next = vi.fn();
    require2fa(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'TWOFA_INVALID' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('código válido → next() y consume', () => {
    _seedCode(user, '424242');
    const req: any = { user, headers: { 'x-2fa-code': '424242' } };
    const res = mockRes();
    const next = vi.fn();
    require2fa(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
    const next2 = vi.fn();
    const res2 = mockRes();
    require2fa({ user, headers: { 'x-2fa-code': '424242' } } as any, res2, next2);
    expect(next2).not.toHaveBeenCalled();
  });

  it('sin user → 401', () => {
    const req: any = { headers: {} };
    const res = mockRes();
    const next = vi.fn();
    require2fa(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
