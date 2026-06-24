import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../twofactor', () => ({ requireDgaTwoFactor: vi.fn() }));

import { require2faIfSensitiveChange } from '../twofactor-guards';
import { requireDgaTwoFactor } from '../twofactor';

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
    vi.mocked(requireDgaTwoFactor).mockClear();
  });

  it('exige 2FA al cambiar dga_transport a rest', () => {
    const { nextCalled } = run({ dga_transport: 'rest' });
    expect(requireDgaTwoFactor).toHaveBeenCalledTimes(1);
    expect(nextCalled).toBe(false); // el guard delega en requireDgaTwoFactor, no llama next
  });

  it('exige 2FA al ACTIVAR dga_gcs_export', () => {
    const { nextCalled } = run({ dga_gcs_export: true });
    expect(requireDgaTwoFactor).toHaveBeenCalledTimes(1);
    expect(nextCalled).toBe(false);
  });

  it('NO exige 2FA al desactivar dga_gcs_export (false)', () => {
    const { nextCalled } = run({ dga_gcs_export: false });
    expect(requireDgaTwoFactor).not.toHaveBeenCalled();
    expect(nextCalled).toBe(true);
  });

  it('NO exige 2FA para cambios no sensibles (caudal_max)', () => {
    const { nextCalled } = run({ dga_caudal_max_lps: 5 });
    expect(requireDgaTwoFactor).not.toHaveBeenCalled();
    expect(nextCalled).toBe(true);
  });

  it('NO exige 2FA para transport distinto de rest (shadow/off)', () => {
    const { nextCalled } = run({ dga_transport: 'shadow' });
    expect(requireDgaTwoFactor).not.toHaveBeenCalled();
    expect(nextCalled).toBe(true);
  });

  it('body vacío / ausente: pasa derecho', () => {
    expect(run({}).nextCalled).toBe(true);
    expect(run(undefined).nextCalled).toBe(true);
    expect(requireDgaTwoFactor).not.toHaveBeenCalled();
  });

  it('combina ambos: 2FA si rest Y gcs export juntos', () => {
    const { nextCalled } = run({ dga_transport: 'rest', dga_gcs_export: true });
    expect(requireDgaTwoFactor).toHaveBeenCalledTimes(1);
    expect(nextCalled).toBe(false);
  });
});
