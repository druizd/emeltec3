import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import sessionRevocation from '../sessionRevocation';

const { isSessionRevoked, forget, _resetCache, _setPool } = sessionRevocation as {
  isSessionRevoked: (d: unknown) => Promise<boolean>;
  forget: (id: string) => void;
  _resetCache: () => void;
  _setPool: (p: unknown) => void;
};

const queryMock = vi.fn();

const iatFor = (date: Date) => Math.floor(date.getTime() / 1000);

describe('sessionRevocation', () => {
  beforeEach(() => {
    queryMock.mockReset();
    _resetCache();
    _setPool({ query: queryMock });
  });

  afterAll(() => {
    _setPool(null);
  });

  it('deja pasar cuando el usuario no tiene corte', async () => {
    queryMock.mockResolvedValue({ rows: [{ sessions_valid_from: null }] });
    expect(await isSessionRevoked({ id: 'u-1', iat: iatFor(new Date()) })).toBe(false);
  });

  it('revoca un token emitido antes del corte', async () => {
    const cut = new Date('2026-08-17T12:00:00Z');
    queryMock.mockResolvedValue({ rows: [{ sessions_valid_from: cut }] });

    const viejo = iatFor(new Date(cut.getTime() - 60_000));
    expect(await isSessionRevoked({ id: 'u-1', iat: viejo })).toBe(true);
  });

  it('deja pasar un token emitido despues del corte', async () => {
    const cut = new Date('2026-08-17T12:00:00Z');
    queryMock.mockResolvedValue({ rows: [{ sessions_valid_from: cut }] });

    const nuevo = iatFor(new Date(cut.getTime() + 60_000));
    expect(await isSessionRevoked({ id: 'u-1', iat: nuevo })).toBe(false);
  });

  it('no revoca por redondeo un token emitido en el mismo segundo del corte', async () => {
    // `iat` sólo tiene resolución de segundo: comparar en milisegundos echaría
    // al usuario que acaba de cambiar su contraseña.
    const cut = new Date('2026-08-17T12:00:00.400Z');
    queryMock.mockResolvedValue({ rows: [{ sessions_valid_from: cut }] });

    expect(await isSessionRevoked({ id: 'u-1', iat: iatFor(cut) })).toBe(false);
  });

  it('cachea el corte y no vuelve a consultar la DB', async () => {
    queryMock.mockResolvedValue({ rows: [{ sessions_valid_from: null }] });
    const token = { id: 'u-1', iat: iatFor(new Date()) };

    await isSessionRevoked(token);
    await isSessionRevoked(token);
    await isSessionRevoked(token);

    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('forget invalida el cache del usuario', async () => {
    queryMock.mockResolvedValue({ rows: [{ sessions_valid_from: null }] });
    const token = { id: 'u-1', iat: iatFor(new Date()) };

    await isSessionRevoked(token);
    forget('u-1');
    await isSessionRevoked(token);

    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it('falla abierto si la DB revienta', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    queryMock.mockRejectedValue(new Error('conexion caida'));

    expect(await isSessionRevoked({ id: 'u-1', iat: iatFor(new Date()) })).toBe(false);
  });

  it('ignora tokens sin id o sin iat', async () => {
    expect(await isSessionRevoked({ iat: iatFor(new Date()) })).toBe(false);
    expect(await isSessionRevoked({ id: 'u-1' })).toBe(false);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
