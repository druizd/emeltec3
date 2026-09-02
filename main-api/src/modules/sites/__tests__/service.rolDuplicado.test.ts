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
