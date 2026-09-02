/**
 * Dos mapeos con el mismo rol de dashboard: el que no calcula (registro que el
 * equipo ya no manda) no puede ganarle al que sí, ni en el resumen en vivo ni
 * en el histórico que consumen DGA y contadores.
 *
 * Caso real: S127 (Agrosuper, pozo 2) quedó con el `REG2002` de la puesta en
 * marcha del 30-08-2026 junto al `REG3003`+`REG3004` definitivo, ambos con rol
 * `caudal`. El ORDER BY alias ponía primero al roto y DGA declaró caudal null.
 */
import { describe, it, expect } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildSiteDashboardData, mapHistoricalDashboardRow } =
  require('../siteTelemetryService') as {
    buildSiteDashboardData: (input: unknown) => {
      resumen: Record<string, { ok: boolean; valor: unknown; alias: string | null }>;
    };
    mapHistoricalDashboardRow: (input: unknown) => {
      caudal: { ok: boolean; valor: unknown; alias: string | null };
    };
  };

const site = { id: 'S127', descripcion: 'Pozo 2', id_serial: '151.21.36.25', tipo_sitio: 'pozo' };

// Crudo real del 02-09-2026 12:48Z. REG2002 ya no viene: el equipo lo mandó
// solo durante la hora de puesta en marcha.
const rawData = { AI24: 187, REG3001: 40035, REG3002: 18399, REG3003: 16609, REG3004: 16981 };

const roto = {
  id: 'RM976BEA22',
  alias: 'REG2002',
  d1: 'REG2002',
  d2: null,
  rol_dashboard: 'caudal',
  transformacion: 'lineal',
  parametros: { factor: 1, offset: 0 },
};

const sano = {
  id: 'RM87702B71',
  alias: 'REG3003',
  d1: 'REG3003',
  d2: 'REG3004',
  rol_dashboard: 'caudal',
  transformacion: 'ieee754_32',
  parametros: { factor: 1, offset: 0, formato: 'float32', word_swap: true },
};

function resumenCaudal(mappings: unknown[]) {
  return buildSiteDashboardData({
    site,
    pozoConfig: null,
    mappings,
    latest: { data: rawData, time: '2026-09-02T12:48:00Z', received_at: '2026-09-02T12:48:02Z' },
  }).resumen['caudal'];
}

function historicoCaudal(mappings: unknown[]) {
  return mapHistoricalDashboardRow({
    row: { data: rawData, time: '2026-09-02T12:48:00Z', received_at: '2026-09-02T12:48:02Z' },
    site,
    mappings,
    pozoConfig: null,
  }).caudal;
}

describe('siteTelemetryService · dos mapeos con el mismo rol', () => {
  it('el resumen en vivo toma el que calcula, venga en el orden que venga', () => {
    for (const mappings of [
      [roto, sano],
      [sano, roto],
    ]) {
      const caudal = resumenCaudal(mappings);
      expect(caudal?.ok).toBe(true);
      expect(caudal?.alias).toBe('REG3003');
      expect(caudal?.valor).toBeCloseTo(53.31, 2);
    }
  });

  it('el histórico (DGA, contadores) también toma el que calcula', () => {
    for (const mappings of [
      [roto, sano],
      [sano, roto],
    ]) {
      const caudal = historicoCaudal(mappings);
      expect(caudal.ok).toBe(true);
      expect(caudal.alias).toBe('REG3003');
      expect(caudal.valor).toBeCloseTo(53.31, 2);
    }
  });

  it('si ninguno calcula, el rol sigue reportando el error (no lo esconde)', () => {
    const otroRoto = { ...sano, id: 'x', alias: 'REG9', d1: 'REG9', d2: 'REG10' };
    expect(resumenCaudal([roto, otroRoto])?.ok).toBe(false);
    expect(historicoCaudal([roto, otroRoto]).ok).toBe(false);
  });

  it('si ambos calculan, se mantiene el criterio anterior: el primero del orden', () => {
    const segundoSano = {
      ...sano,
      id: 'y',
      alias: 'REG3005',
      parametros: { ...sano.parametros, factor: 2 },
    };
    expect(resumenCaudal([sano, segundoSano])?.alias).toBe('REG3005');
    expect(historicoCaudal([sano, segundoSano]).alias).toBe('REG3003');
  });
});
