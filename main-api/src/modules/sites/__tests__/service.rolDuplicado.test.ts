/**
 * Gemelo TS de siteTelemetryService.rolDuplicado.test.ts: el módulo sites
 * repite la lógica de resumen e histórico y tiene que resolver igual.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../repo', () => ({
  getDashboardHistory: vi.fn(),
  getLatestEquipoForSerial: vi.fn(),
  getMappingsBySiteId: vi.fn(),
  getPozoConfigBySiteId: vi.fn(),
  getSiteById: vi.fn(),
}));

import { buildSiteDashboardData, mapHistoricalDashboardRow } from '../service';
import type { RegMap, Site } from '../types';

const site = {
  id: 'S127',
  descripcion: 'Pozo 2',
  id_serial: '151.21.36.25',
  tipo_sitio: 'pozo',
} as Site;

const rawData = { AI24: 187, REG3001: 40035, REG3002: 18399, REG3003: 16609, REG3004: 16981 };
const row = { data: rawData, time: '2026-09-02T12:48:00Z', received_at: '2026-09-02T12:48:02Z' };

function mapping(overrides: Partial<RegMap>): RegMap {
  return {
    id: 'm',
    alias: 'm',
    d1: 'REG1',
    d2: null,
    tipo_dato: 'FLOAT',
    unidad: 'L/s',
    rol_dashboard: 'caudal',
    transformacion: 'ieee754_32',
    parametros: null,
    sitio_id: 'S127',
    ...overrides,
  } as RegMap;
}

const roto = mapping({
  id: 'RM976BEA22',
  alias: 'REG2002',
  d1: 'REG2002',
  transformacion: 'lineal',
  parametros: { factor: 1, offset: 0 },
});

const sano = mapping({
  id: 'RM87702B71',
  alias: 'REG3003',
  d1: 'REG3003',
  d2: 'REG3004',
  parametros: { factor: 1, offset: 0, formato: 'float32', word_swap: true },
});

describe('modules/sites/service · dos mapeos con el mismo rol', () => {
  it('resumen e histórico toman el que calcula, en cualquier orden', () => {
    for (const mappings of [
      [roto, sano],
      [sano, roto],
    ]) {
      const live = buildSiteDashboardData({
        site,
        pozoConfig: null,
        mappings,
        latest: row as never,
      });
      expect(live.resumen['caudal']?.ok).toBe(true);
      expect(live.resumen['caudal']?.alias).toBe('REG3003');
      expect(live.resumen['caudal']?.valor).toBeCloseTo(53.31, 2);

      const hist = mapHistoricalDashboardRow({
        row: row as never,
        site,
        mappings,
        pozoConfig: null,
      });
      expect(hist.caudal.ok).toBe(true);
      expect(hist.caudal.alias).toBe('REG3003');
      expect(hist.caudal.valor).toBeCloseTo(53.31, 2);
    }
  });

  it('un totalizador uint32 roto no le gana al ieee754 sano por su bono de puntaje', () => {
    // Caso real: S128 (Agrosuper Faenadora, pozo 1), 04-09-2026 01:00. Este es
    // el módulo que usa el fill DGA: con el bono uint32 (110 vs 90) el
    // "Totalizador" sobre REG372, que ya no llega, ganaba y el slot quedaba
    // requires_review con flujo_acumulado null.
    const siteS128 = {
      id: 'S128',
      descripcion: 'Pozo 1',
      id_serial: '151.21.35.29',
      tipo_sitio: 'pozo',
    } as Site;
    const rowS128 = {
      data: {
        AI24: 298,
        AI132: 90,
        REG4000: 37540,
        REG4001: 15512,
        REG4002: 33037,
        REG4003: 17730,
      },
      time: '2026-09-04T05:00:00Z',
      received_at: '2026-09-04T04:49:30Z',
    };
    const totalizadorRoto = mapping({
      id: 'RM59830E7B',
      alias: 'Totalizador',
      d1: 'REG372',
      d2: 'REG373',
      unidad: 'm3',
      rol_dashboard: 'totalizador',
      transformacion: 'uint32_registros',
      parametros: {},
      sitio_id: 'S128',
    });
    const totalizadorSano = mapping({
      id: 'RME0EA6423',
      alias: 'REG4002',
      d1: 'REG4002',
      d2: 'REG4003',
      unidad: 'm3',
      rol_dashboard: 'totalizador',
      parametros: { factor: 1, offset: 0, formato: 'float32', word_swap: true },
      sitio_id: 'S128',
    });

    for (const mappings of [
      [totalizadorRoto, totalizadorSano],
      [totalizadorSano, totalizadorRoto],
    ]) {
      const hist = mapHistoricalDashboardRow({
        row: rowS128 as never,
        site: siteS128,
        mappings,
        pozoConfig: null,
      });
      expect(hist.totalizador.ok).toBe(true);
      expect(hist.totalizador.alias).toBe('REG4002');
      expect(hist.totalizador.valor).toBeCloseTo(3112.07, 2);
    }
  });

  it('si los dos totalizadores calculan, el uint32 conserva su preferencia', () => {
    const uint32Sano = mapping({
      id: 'a',
      alias: 'Totalizador',
      d1: 'REG3001',
      d2: 'REG3002',
      unidad: 'm3',
      rol_dashboard: 'totalizador',
      transformacion: 'uint32_registros',
      parametros: {},
    });
    const floatSano = mapping({
      id: 'b',
      alias: 'REG3003',
      d1: 'REG3003',
      d2: 'REG3004',
      unidad: 'm3',
      rol_dashboard: 'totalizador',
      parametros: { factor: 1, offset: 0, formato: 'float32', word_swap: true },
    });
    for (const mappings of [
      [uint32Sano, floatSano],
      [floatSano, uint32Sano],
    ]) {
      const hist = mapHistoricalDashboardRow({
        row: row as never,
        site,
        mappings,
        pozoConfig: null,
      });
      expect(hist.totalizador.ok).toBe(true);
      expect(hist.totalizador.alias).toBe('Totalizador');
    }
  });

  it('si ninguno calcula, el rol sigue reportando el error', () => {
    const otroRoto = mapping({ id: 'x', alias: 'REG9', d1: 'REG9', d2: 'REG10' });
    const live = buildSiteDashboardData({
      site,
      pozoConfig: null,
      mappings: [roto, otroRoto],
      latest: row as never,
    });
    expect(live.resumen['caudal']?.ok).toBe(false);
  });
});
