import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../../../shared/email-otp', () => ({ require2fa: vi.fn() }));

import { require2faIfSensitiveChange } from '../twofactor-guards';
import { require2fa } from '../../../shared/email-otp';

function run(body: Record<string, unknown> | undefined): { nextCalled: boolean } {
  const req = { body } as Request;
  const res = {} as Response;
  let nextCalled = false;
  const next: NextFunction = () => {
    nextCalled = true;
  };
  require2faIfSensitiveChange(req, res, next);
  return { nextCalled };
}

describe('require2faIfSensitiveChange', () => {
  beforeEach(() => {
    vi.mocked(require2fa).mockClear();
  });

  it('exige 2FA al cambiar dga_transport a rest', () => {
    const { nextCalled } = run({ dga_transport: 'rest' });
    expect(require2fa).toHaveBeenCalledTimes(1);
    expect(nextCalled).toBe(false); // el guard delega en require2fa, no llama next
  });

  it('exige 2FA al ACTIVAR dga_gcs_export', () => {
    const { nextCalled } = run({ dga_gcs_export: true });
    expect(require2fa).toHaveBeenCalledTimes(1);
    expect(nextCalled).toBe(false);
  });

  it('NO exige 2FA al desactivar dga_gcs_export (false)', () => {
    const { nextCalled } = run({ dga_gcs_export: false });
    expect(require2fa).not.toHaveBeenCalled();
    expect(nextCalled).toBe(true);
  });

  it('NO exige 2FA para cambios no sensibles (caudal_max)', () => {
    const { nextCalled } = run({ dga_caudal_max_lps: 5 });
    expect(require2fa).not.toHaveBeenCalled();
    expect(nextCalled).toBe(true);
  });

  it('NO exige 2FA para transport distinto de rest (shadow/off)', () => {
    const { nextCalled } = run({ dga_transport: 'shadow' });
    expect(require2fa).not.toHaveBeenCalled();
    expect(nextCalled).toBe(true);
  });

  it('body vacío / ausente: pasa derecho', () => {
    expect(run({}).nextCalled).toBe(true);
    expect(run(undefined).nextCalled).toBe(true);
    expect(require2fa).not.toHaveBeenCalled();
  });

  it('combina ambos: 2FA si rest Y gcs export juntos', () => {
    const { nextCalled } = run({ dga_transport: 'rest', dga_gcs_export: true });
    expect(require2fa).toHaveBeenCalledTimes(1);
    expect(nextCalled).toBe(false);
  });
});
