/**
 * Login v2: un usuario con `activo = false` recibe exactamente la misma
 * respuesta que con credenciales inválidas, incluso con la contraseña correcta.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DB_PASSWORD ??= 'test-password';
  process.env.JWT_SECRET ??= 'clave-de-test-para-vitest-0123456789';
  process.env.DGA_ENCRYPTION_KEY ??= 'clave-aes-256-de-test-0123456789ABCDEF';
});

const repo = vi.hoisted(() => ({
  findEmpresaById: vi.fn(),
  findSubEmpresaById: vi.fn(),
  findUserByEmail: vi.fn(),
  findUserTipoActivoById: vi.fn(),
  findUserPublicByEmail: vi.fn(),
  storeOtp: vi.fn(),
  consumeOtpIfMatches: vi.fn(),
  verifyPassword: vi.fn(),
}));
vi.mock('../repo', () => repo);

import { login } from '../service';

const usuario = {
  id: 'U1',
  nombre: 'Ana',
  email: 'ana@emeltec.cl',
  tipo: 'Cliente',
  empresa_id: 'E1',
  sub_empresa_id: null,
  password_hash: 'hash',
  otp_hash: null,
  otp_expires_at: null,
};

const intentar = async (): Promise<{
  status?: number | undefined;
  message?: string | undefined;
  token?: string;
}> => {
  try {
    const r = await login('ana@emeltec.cl', 'clave-correcta');
    return { token: r.token };
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return { status: err.status, message: err.message };
  }
};

describe('login v2 con usuarios inactivos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repo.consumeOtpIfMatches.mockResolvedValue(false);
    repo.verifyPassword.mockResolvedValue(true);
  });

  it('un usuario activo inicia sesión', async () => {
    repo.findUserByEmail.mockResolvedValue({ ...usuario, activo: true });
    expect((await intentar()).token).toBeDefined();
  });

  it('activo NULL cuenta como activo', async () => {
    repo.findUserByEmail.mockResolvedValue({ ...usuario, activo: null });
    expect((await intentar()).token).toBeDefined();
  });

  it('un usuario inactivo recibe lo mismo que credenciales inválidas', async () => {
    repo.findUserByEmail.mockResolvedValue(null);
    const inexistente = await intentar();

    repo.verifyPassword.mockResolvedValue(false);
    repo.findUserByEmail.mockResolvedValue({ ...usuario, activo: true });
    const claveMala = await intentar();

    repo.verifyPassword.mockResolvedValue(true);
    repo.findUserByEmail.mockResolvedValue({ ...usuario, activo: false });
    const inactivo = await intentar();

    expect(inactivo.token).toBeUndefined();
    expect(inactivo.status).toBe(401);
    expect(inactivo).toEqual(claveMala);
    expect(inactivo).toEqual(inexistente);
  });

  it('un inactivo con OTP correcto tampoco entra', async () => {
    repo.consumeOtpIfMatches.mockResolvedValue(true);
    repo.findUserByEmail.mockResolvedValue({ ...usuario, otp_hash: 'otp', activo: false });
    const r = await intentar();
    expect(r.token).toBeUndefined();
    expect(r.status).toBe(401);
  });

  it('ejecuta las mismas verificaciones que con credenciales inválidas (mismo costo)', async () => {
    repo.findUserByEmail.mockResolvedValue({ ...usuario, activo: false });
    await intentar();
    expect(repo.consumeOtpIfMatches).toHaveBeenCalledTimes(1);
    expect(repo.verifyPassword).toHaveBeenCalledTimes(1);
  });
});
