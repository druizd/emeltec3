/**
 * Tests de la regla de reenvío de la invitación de acceso
 * (`POST /api/users/:id/reenviar-acceso`).
 *
 * Lo que se protege: que el reenvío quede acotado a cuentas que TODAVÍA están
 * en el flujo de activación. Si se aflojara para cuentas ya activas, el correo
 * llevaría a un flujo que auth-api rechaza (exige `activated_at IS NULL`) y el
 * usuario quedaría dando vueltas; ese caso es un restablecimiento, que sí es
 * destructivo y va por otro endpoint con 2FA.
 */
import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { rechazoReenvioAcceso } = require('../accountAccessResend.js') as {
  rechazoReenvioAcceso: (target: unknown) => { status: number; code: string; error: string } | null;
};

/** Cuenta creada, sin contraseña y sin activar: el caso que sí se reenvía. */
const pendiente = (over: Record<string, unknown> = {}) => ({
  activo: true,
  activated_at: null,
  has_password: false,
  ...over,
});

describe('rechazoReenvioAcceso — se puede reenviar', () => {
  it('cuenta activa, sin contraseña y sin activar', () => {
    expect(rechazoReenvioAcceso(pendiente())).toBeNull();
  });

  it('tolera has_password ausente (columna no seleccionada)', () => {
    expect(rechazoReenvioAcceso({ activo: true, activated_at: null })).toBeNull();
  });

  it('activo ausente se trata como activo (COALESCE del listado)', () => {
    expect(rechazoReenvioAcceso({ activated_at: null, has_password: false })).toBeNull();
  });
});

describe('rechazoReenvioAcceso — no corresponde', () => {
  it('la cuenta ya definió su contraseña', () => {
    const r = rechazoReenvioAcceso(pendiente({ has_password: true }));
    expect(r).toMatchObject({ status: 409, code: 'CUENTA_YA_ACTIVA' });
  });

  it('la cuenta ya se activó (aunque no tenga hash: auth_mode otp)', () => {
    const r = rechazoReenvioAcceso(pendiente({ activated_at: '2026-08-01T12:00:00Z' }));
    expect(r).toMatchObject({ status: 409, code: 'CUENTA_YA_ACTIVA' });
  });

  it('la cuenta está desactivada — primero se reactiva', () => {
    const r = rechazoReenvioAcceso(pendiente({ activo: false }));
    expect(r).toMatchObject({ status: 409, code: 'CUENTA_DESACTIVADA' });
  });

  it('la desactivación gana sobre el estado de la contraseña', () => {
    const r = rechazoReenvioAcceso(pendiente({ activo: false, has_password: true }));
    expect(r?.code).toBe('CUENTA_DESACTIVADA');
  });

  it('usuario inexistente → 404', () => {
    expect(rechazoReenvioAcceso(null)).toMatchObject({ status: 404 });
  });

  it('el mensaje de cuenta activa apunta a Restablecer acceso', () => {
    // La UI muestra este texto tal cual: tiene que decir qué hacer en su lugar.
    const r = rechazoReenvioAcceso(pendiente({ has_password: true }));
    expect(r?.error).toMatch(/Restablecer acceso/);
  });
});
