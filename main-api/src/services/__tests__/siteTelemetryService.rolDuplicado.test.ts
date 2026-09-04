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
const servicio = require('../siteTelemetryService') as {
  buildSiteDashboardData: (input: unknown) => {
    resumen: Record<string, { ok: boolean; valor: unknown; alias: string | null }>;
  };
  mapHistoricalDashboardRow: (input: unknown) => {
    caudal: { ok: boolean; valor: unknown; alias: string | null };
  };
};
const { buildSiteDashboardData, mapHistoricalDashboardRow } = servicio;

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

  it('un totalizador uint32 roto no le gana al ieee754 sano por su bono de puntaje', () => {
    // Caso real: S128 (Agrosuper Faenadora, pozo 1) el 04-09-2026 00:49. El
    // datalogger dejó de mandar REG372/REG373 y empezó REG4000-4003. El
    // "Totalizador" uint32 viejo puntuaba 110 (bono uint32) contra 90 del
    // REG4002 nuevo con rol, así que el fill DGA declaraba acumulado null.
    const rawS128 = {
      AI24: 322,
      AI132: 90,
      REG4000: 37540,
      REG4001: 15739,
      REG4002: 64388,
      REG4003: 17730,
    };
    const totalizadorRoto = {
      id: 'RM59830E7B',
      alias: 'Totalizador',
      d1: 'REG372',
      d2: 'REG373',
      rol_dashboard: 'totalizador',
      transformacion: 'uint32_registros',
      parametros: {},
    };
    const totalizadorSano = {
      id: 'RME0EA6423',
      alias: 'REG4002',
      d1: 'REG4002',
      d2: 'REG4003',
      rol_dashboard: 'totalizador',
      transformacion: 'ieee754_32',
      parametros: { factor: 1, offset: 0, formato: 'float32', word_swap: true },
    };
    const siteS128 = {
      id: 'S128',
      descripcion: 'Pozo 1',
      id_serial: '151.21.35.29',
      tipo_sitio: 'pozo',
    };

    for (const mappings of [
      [totalizadorRoto, totalizadorSano],
      [totalizadorSano, totalizadorRoto],
    ]) {
      const { totalizador } = mapHistoricalDashboardRow({
        row: { data: rawS128, time: '2026-09-04T05:13:00Z', received_at: '2026-09-04T05:02:52Z' },
        site: siteS128,
        mappings,
        pozoConfig: null,
      }) as unknown as { totalizador: { ok: boolean; valor: unknown; alias: string | null } };
      expect(totalizador.ok).toBe(true);
      expect(totalizador.alias).toBe('REG4002');
      expect(totalizador.valor).toBeCloseTo(3119.72, 2);
    }
  });

  it('si los dos totalizadores calculan, el uint32 conserva su preferencia', () => {
    const uint32Sano = {
      id: 'a',
      alias: 'Totalizador',
      d1: 'REG3001',
      d2: 'REG3002',
      rol_dashboard: 'totalizador',
      transformacion: 'uint32_registros',
      parametros: {},
    };
    const floatSano = {
      id: 'b',
      alias: 'REG3003',
      d1: 'REG3003',
      d2: 'REG3004',
      rol_dashboard: 'totalizador',
      transformacion: 'ieee754_32',
      parametros: { factor: 1, offset: 0, formato: 'float32', word_swap: true },
    };
    for (const mappings of [
      [uint32Sano, floatSano],
      [floatSano, uint32Sano],
    ]) {
      const { totalizador } = mapHistoricalDashboardRow({
        row: { data: rawData, time: '2026-09-02T12:48:00Z', received_at: '2026-09-02T12:48:02Z' },
        site,
        mappings,
        pozoConfig: null,
      }) as unknown as { totalizador: { ok: boolean; alias: string | null } };
      expect(totalizador.ok).toBe(true);
      expect(totalizador.alias).toBe('Totalizador');
    }
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
