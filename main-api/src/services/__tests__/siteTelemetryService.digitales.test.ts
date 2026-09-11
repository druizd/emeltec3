/**
 * Señales digitales en el histórico.
 *
 * Una palabra de entradas digitales es N variables sobre el mismo `d1` y todas
 * con rol `generico`, así que NO caben en el mecanismo de roles históricos
 * (`HISTORICAL_ROLES` + `findHistoricalVariable`, que asigna un mapping por rol
 * con búsqueda difusa). Se sirven aparte, en la clave `digitales` de cada fila.
 *
 * Lo que se cubre acá: que las dos rutas que arman filas históricas —la de a
 * una (`mapHistoricalDashboardRow`, que usa el export CSV) y la optimizada
 * (`createHistoricalRowMapper`, que usa el endpoint)— produzcan exactamente lo
 * mismo. Divergir ahí significaría que el CSV y el gráfico muestran cosas
 * distintas del mismo dato.
 */
import { describe, it, expect } from 'vitest';

/* eslint-disable @typescript-eslint/no-require-imports */
const { mapHistoricalDashboardRow, createHistoricalRowMapper, digitalMappings } =
  require('../siteTelemetryService') as {
    mapHistoricalDashboardRow: (input: unknown) => Record<string, DigitalRow>;
    createHistoricalRowMapper: (input: unknown) => (row: unknown) => Record<string, DigitalRow>;
    digitalMappings: (mappings: unknown[]) => Array<{ key: string; alias: string; bit: number }>;
  };
/* eslint-enable @typescript-eslint/no-require-imports */

type DigitalEntry = {
  ok: boolean;
  valor: number | null;
  alias: string;
  bit: number;
  error: string | null;
};
type DigitalRow = Record<string, DigitalEntry> & Record<string, unknown>;

const site = { id: 's1', descripcion: 'Sitio', id_serial: 'SER1', tipo_sitio: 'generico' };

function bitMap(id: string, alias: string, bit: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    alias,
    d1: 'REG20',
    d2: null,
    tipo_dato: 'BOOLEAN',
    unidad: null,
    rol_dashboard: 'generico',
    transformacion: 'bit',
    parametros: { bit, palabra_bits: 16, ...extra },
    sitio_id: 's1',
  };
}

/** 171 = 0b0000_0000_1010_1011 → bits 0, 1, 3, 5 y 7 activos. */
const MAPPINGS = [
  bitMap('RM1', 'Bomba activa', 0),
  bitMap('RM2', 'Bomba 2 activa', 1),
  bitMap('RM3', 'Falla termico', 2),
  bitMap('RM4', 'Nivel alto', 7),
];

function fila(rawData: Record<string, unknown>, mappings: unknown[] = MAPPINGS) {
  return mapHistoricalDashboardRow({
    row: { data: rawData, time: '2026-01-01T12:00:00Z', received_at: '2026-01-01T12:00:00Z' },
    site,
    mappings,
    pozoConfig: null,
  });
}

describe('digitalMappings', () => {
  it('resuelve solo los mapeos por bit', () => {
    const mezcla = [
      ...MAPPINGS,
      {
        id: 'RM9',
        alias: 'Caudal',
        d1: 'REG1',
        transformacion: 'lineal',
        rol_dashboard: 'caudal',
        parametros: {},
      },
    ];
    expect(digitalMappings(mezcla).map((entry) => entry.alias)).toEqual([
      'Bomba activa',
      'Bomba 2 activa',
      'Falla termico',
      'Nivel alto',
    ]);
  });

  it('ordena por dato original y despues por bit', () => {
    const desordenados = [
      bitMap('RM4', 'Nivel alto', 7),
      { ...bitMap('RMZ', 'De otra palabra', 0), d1: 'REG21' },
      bitMap('RM1', 'Bomba activa', 0),
    ];
    expect(digitalMappings(desordenados).map((entry) => entry.bit)).toEqual([0, 7, 0]);
    expect(digitalMappings(desordenados)[2]?.alias).toBe('De otra palabra');
  });

  it('un sitio sin bits no tiene señales digitales', () => {
    expect(digitalMappings([])).toEqual([]);
  });
});

describe('mapHistoricalDashboardRow · digitales', () => {
  it('cada señal sale con su alias, su bit y 1/0', () => {
    const row = fila({ REG20: 171 });

    expect(row['digitales']).toEqual({
      bomba_activa: { ok: true, valor: 1, alias: 'Bomba activa', bit: 0, error: null },
      bomba_2_activa: { ok: true, valor: 1, alias: 'Bomba 2 activa', bit: 1, error: null },
      falla_termico: { ok: true, valor: 0, alias: 'Falla termico', bit: 2, error: null },
      nivel_alto: { ok: true, valor: 1, alias: 'Nivel alto', bit: 7, error: null },
    });
  });

  it('el valor es numerico, nunca booleano', () => {
    const digitales = fila({ REG20: 171 })['digitales'] as unknown as Record<string, DigitalEntry>;
    expect(typeof digitales['bomba_activa']?.valor).toBe('number');
    expect(typeof digitales['falla_termico']?.valor).toBe('number');
  });

  it('respeta el invertido de cada señal por separado', () => {
    const digitales = fila({ REG20: 171 }, [
      bitMap('RM1', 'Bomba activa', 0),
      bitMap('RM3', 'Falla termico', 2, { invertido: true }),
    ])['digitales'] as unknown as Record<string, DigitalEntry>;

    expect(digitales['bomba_activa']?.valor).toBe(1);
    // El bit 2 esta en 0 y la señal es activa en 0 → se reporta activa.
    expect(digitales['falla_termico']?.valor).toBe(1);
  });

  it('una palabra que no cabe en el ancho marca error y no inventa estados', () => {
    const digitales = fila({ REG20: 70000 })['digitales'] as unknown as Record<
      string,
      DigitalEntry
    >;

    expect(digitales['bomba_activa']?.ok).toBe(false);
    expect(digitales['bomba_activa']?.valor).toBeNull();
    expect(digitales['bomba_activa']?.error).toMatch(/no es una palabra sin signo/);
    // El alias y el bit siguen ahi: la columna del CSV y la fila del grafico
    // mantienen su lugar aunque el dato de ese instante no sirva.
    expect(digitales['bomba_activa']?.alias).toBe('Bomba activa');
    expect(digitales['bomba_activa']?.bit).toBe(0);
  });

  it('un dato original ausente en esa muestra marca error', () => {
    const digitales = fila({ OTRO: 5 })['digitales'] as unknown as Record<string, DigitalEntry>;
    expect(digitales['bomba_activa']?.ok).toBe(false);
    expect(digitales['bomba_activa']?.valor).toBeNull();
  });

  it('un sitio sin señales digitales devuelve el objeto vacio, no ausente', () => {
    // El shape de la fila no puede depender de la configuracion del sitio: el
    // frontend hace row.digitales[clave] sin chequear.
    expect(fila({ REG20: 171 }, [])['digitales']).toEqual({});
  });

  it('no pisa los roles historicos de siempre', () => {
    const row = fila({ REG20: 171 });
    expect(row['caudal']).toBeDefined();
    expect(row['nivel']).toBeDefined();
    expect(row['totalizador']).toBeDefined();
    expect(row['nivel_freatico']).toBeDefined();
  });
});

describe('createHistoricalRowMapper · paridad con la ruta de a una', () => {
  it('el mapper optimizado produce los mismos digitales', () => {
    const rows = [
      { data: { REG20: 171 }, time: '2026-01-01T12:00:00Z', received_at: '2026-01-01T12:00:00Z' },
      { data: { REG20: 0 }, time: '2026-01-01T12:01:00Z', received_at: '2026-01-01T12:01:00Z' },
      { data: { REG20: 65535 }, time: '2026-01-01T12:02:00Z', received_at: '2026-01-01T12:02:00Z' },
      { data: { REG20: 70000 }, time: '2026-01-01T12:03:00Z', received_at: '2026-01-01T12:03:00Z' },
    ];

    const mapRow = createHistoricalRowMapper({
      site,
      mappings: MAPPINGS,
      pozoConfig: null,
      sampleRawData: rows[0]!.data,
    });

    for (const row of rows) {
      expect(mapRow(row)['digitales']).toEqual(
        fila(row.data as Record<string, unknown>)['digitales'],
      );
    }
  });

  it('una palabra en 0 deja todas las señales en 0', () => {
    const mapRow = createHistoricalRowMapper({
      site,
      mappings: MAPPINGS,
      pozoConfig: null,
      sampleRawData: { REG20: 0 },
    });
    const digitales = mapRow({
      data: { REG20: 0 },
      time: '2026-01-01T12:00:00Z',
    })['digitales'] as unknown as Record<string, DigitalEntry>;

    expect(Object.values(digitales).every((entry) => entry.valor === 0)).toBe(true);
  });

  it('sirve para reconstruir cuando se activo cada señal', () => {
    // El caso de uso real: "¿a que hora se disparo el termico anoche?".
    const serie = [
      { data: { REG20: 0 }, time: '2026-01-01T03:00:00Z' },
      { data: { REG20: 4 }, time: '2026-01-01T03:01:00Z' }, // bit 2 → falla
      { data: { REG20: 4 }, time: '2026-01-01T03:02:00Z' },
      { data: { REG20: 0 }, time: '2026-01-01T03:03:00Z' },
    ];
    const mapRow = createHistoricalRowMapper({
      site,
      mappings: MAPPINGS,
      pozoConfig: null,
      sampleRawData: serie[0]!.data,
    });

    const falla = serie.map((row) => {
      const out = mapRow(row) as unknown as {
        timestamp: string;
        digitales: Record<string, DigitalEntry>;
      };
      return { t: out.timestamp, valor: out.digitales['falla_termico']?.valor };
    });

    expect(falla.map((punto) => punto.valor)).toEqual([0, 1, 1, 0]);
    expect(falla[1]?.t).toBe('2026-01-01T03:01:00Z');
  });
});
