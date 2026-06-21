import { describe, it, expect, vi } from 'vitest';

// Evita cargar el emailService real (y sus dependencias) — no se usa en estos tests.
vi.mock('../../services/emailService', () => ({
  send2faCode: vi.fn(async () => ({ ok: true })),
}));

import { verifyCode, require2fa, _seedCode } from '../stepUp2fa';

const user = { id: 'U1', email: 'u@e.cl' };

function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('verifyCode', () => {
  it('código válido → true, y es single-use (segundo intento false)', () => {
    _seedCode(user, '123456');
    expect(verifyCode(user, '123456')).toBe(true);
    expect(verifyCode(user, '123456')).toBe(false);
  });

  it('código incorrecto → false (no consume)', () => {
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

  it('código inválido → 403 TWOFA_INVALID', () => {
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
    // consumido: segundo uso falla
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
