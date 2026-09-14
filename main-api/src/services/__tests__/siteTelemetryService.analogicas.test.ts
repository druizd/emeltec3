/**
 * Variables analógicas en el histórico.
 *
 * En un sitio de proceso ninguna variable es caudal/nivel/totalizador: son
 * 4-20 mA y float del equipo, todas con rol `generico`. El mecanismo de roles
 * históricos no las ve, igual que no ve las señales digitales, así que van
 * aparte en la clave `analogicas` de cada fila.
 *
 * Lo que se cubre acá:
 *  - que sean opt-in (un sitio de agua no paga el peso de columnas que ya
 *    tiene por rol);
 *  - que las dos rutas que arman filas históricas —la de a una
 *    (`mapHistoricalDashboardRow`, la del export CSV) y la optimizada
 *    (`createHistoricalRowMapper`, la del endpoint)— den exactamente lo mismo;
 *  - que dos alias que normalizan igual no colapsen en una sola columna.
 */
import { describe, it, expect } from 'vitest';

/* eslint-disable @typescript-eslint/no-require-imports */
const { mapHistoricalDashboardRow, createHistoricalRowMapper, analogMappings } =
  require('../siteTelemetryService') as {
    mapHistoricalDashboardRow: (input: unknown) => AnalogRow;
    createHistoricalRowMapper: (input: unknown) => (row: unknown) => AnalogRow;
    analogMappings: (
      mappings: unknown[],
    ) => Array<{ key: string; alias: string; unidad: string | null; rol: string }>;
  };
/* eslint-enable @typescript-eslint/no-require-imports */

type AnalogEntry = {
  ok: boolean;
  valor: number | string | null;
  alias: string;
  unidad: string | null;
  rol: string;
  error: string | null;
};
type AnalogRow = { analogicas?: Record<string, AnalogEntry> } & Record<string, unknown>;

const site = { id: 'S149', descripcion: 'Piloto', id_serial: 'SER1', tipo_sitio: 'proceso' };

function linealMap(
  id: string,
  alias: string,
  d1: string,
  extra: Record<string, unknown> = {},
  unidad: string | null = null,
) {
  return {
    id,
    alias,
    d1,
    d2: null,
    tipo_dato: 'INTEGER',
    unidad,
    rol_dashboard: 'generico',
    transformacion: 'lineal',
    parametros: { factor: 1, offset: 0, ...extra },
    sitio_id: 'S149',
  };
}

const MAPPINGS = [
  linealMap('RM1', 'Presión compresor', 'AI23', { factor: 10 }, 'bar'),
  linealMap('RM2', 'TT entrada Mitsubishi', 'AI26', { con_signo: true, signo_bits: 16 }, '°C'),
  {
    id: 'RM3',
    alias: 'Estado bomba',
    d1: 'AI17',
    d2: null,
    tipo_dato: 'BOOLEAN',
    unidad: null,
    rol_dashboard: 'generico',
    transformacion: 'bit',
    parametros: { bit: 0, palabra_bits: 16 },
    sitio_id: 'S149',
  },
];

const RAW = { AI23: 752, AI26: 65522, AI17: 1 };

function filaDirecta(rawData: Record<string, unknown>, mappings: unknown[] = MAPPINGS) {
  return mapHistoricalDashboardRow({
    row: { time: new Date('2026-09-11T16:33:00Z'), received_at: null, data: rawData },
    site,
    mappings,
    pozoConfig: null,
    includeAnalogicas: true,
  });
}

function filaOptimizada(rawData: Record<string, unknown>, mappings: unknown[] = MAPPINGS) {
  const mapRow = createHistoricalRowMapper({
    site,
    mappings,
    pozoConfig: null,
    sampleRawData: rawData,
    includeAnalogicas: true,
  });
  return mapRow({ time: new Date('2026-09-11T16:33:00Z'), received_at: null, data: rawData });
}

describe('analogMappings', () => {
  it('deja fuera los bits: esos son digitales', () => {
    const claves = analogMappings(MAPPINGS).map((entry) => entry.key);
    expect(claves).toEqual(['presion_compresor', 'tt_entrada_mitsubishi']);
  });

  it('conserva unidad y rol de cada variable', () => {
    const [presion] = analogMappings(MAPPINGS);
    expect(presion).toMatchObject({ alias: 'Presión compresor', unidad: 'bar', rol: 'generico' });
  });

  it('NO usa el rol de clave: un rol repetido dejaria columnas ambiguas', () => {
    // Una sala de servicios tiene cuatro temperaturas de circuitos de frio, las
    // cuatro con rol `frio_temperatura`. Si el rol fuera la clave, las cuatro
    // colapsarian y la desduplicacion las separaria por orden alfabetico: al
    // agregar una quinta variable, `frio_temperatura_2` pasaria a ser otro
    // sensor, y esa clave es la que guardan el historico, el CSV y las reglas
    // de alerta.
    const frio = [
      { ...linealMap('RM1', 'TT entrada chiller', 'AI1'), rol_dashboard: 'frio_temperatura' },
      { ...linealMap('RM2', 'TT salida chiller', 'AI2'), rol_dashboard: 'frio_temperatura' },
      { ...linealMap('RM3', 'TT entrada Mitsubishi', 'AI3'), rol_dashboard: 'frio_temperatura' },
    ];
    const claves = analogMappings(frio).map((entry) => entry.key);
    expect(claves).toEqual(['tt_entrada_chiller', 'tt_entrada_mitsubishi', 'tt_salida_chiller']);
    expect(claves.some((clave) => clave.startsWith('frio_temperatura'))).toBe(false);

    // Y la clave de cada variable no se mueve cuando aparece una nueva.
    const conUnaMas = analogMappings([
      ...frio,
      { ...linealMap('RM4', 'TT salida Mitsubishi', 'AI4'), rol_dashboard: 'frio_temperatura' },
    ]);
    for (const anterior of analogMappings(frio)) {
      const ahora = conUnaMas.find((entry) => entry.mapping.id === anterior.mapping.id);
      expect(ahora?.key).toBe(anterior.key);
    }
  });

  it('el rol viaja en la fila aunque no sea la clave', () => {
    const conRol = [
      { ...linealMap('RM1', 'Presión manifold', 'AI24'), rol_dashboard: 'vapor_presion' },
    ];
    const analogicas = filaDirecta({ AI24: 660 }, conRol).analogicas || {};
    expect(analogicas['presion_manifold']).toMatchObject({ rol: 'vapor_presion', ok: true });
  });

  it('no colapsa dos alias que normalizan a la misma clave', () => {
    const chocan = [
      linealMap('RM1', 'Presión 1', 'AI1'),
      linealMap('RM2', 'presion  1', 'AI2'),
      linealMap('RM3', 'PRESION-1', 'AI3'),
    ];
    const claves = analogMappings(chocan).map((entry) => entry.key);
    expect(new Set(claves).size).toBe(3);
    expect(claves).toContain('presion_1');
  });
});

describe('analogicas en la fila historica', () => {
  it('aplica el reg_map: factor y complemento a dos incluidos', () => {
    const analogicas = filaDirecta(RAW).analogicas || {};
    expect(analogicas['presion_compresor']).toMatchObject({ ok: true, valor: 7520 });
    expect(analogicas['tt_entrada_mitsubishi']).toMatchObject({ ok: true, valor: -14 });
  });

  it('son opt-in: sin el flag la fila no las trae', () => {
    const fila = mapHistoricalDashboardRow({
      row: { time: new Date('2026-09-11T16:33:00Z'), received_at: null, data: RAW },
      site,
      mappings: MAPPINGS,
      pozoConfig: null,
    });
    expect(fila.analogicas).toBeUndefined();
    expect(fila['digitales']).toBeDefined();
  });

  it('la ruta directa y la optimizada dan lo mismo', () => {
    expect(filaOptimizada(RAW).analogicas).toEqual(filaDirecta(RAW).analogicas);
  });

  it('una clave ausente en el crudo queda ok:false con error, no en 0', () => {
    const analogicas = filaDirecta({ AI23: 752 }).analogicas || {};
    expect(analogicas['tt_entrada_mitsubishi']).toMatchObject({ ok: false, valor: null });
    expect(analogicas['tt_entrada_mitsubishi']?.error).toBeTruthy();
  });

  it('el export arma las mismas claves que la fila, aunque filtre la lista de mapeos', () => {
    // El export calcula los encabezados con analogMappings(allMappings) pero le
    // pasa a la fila una lista filtrada (roles pedidos + digitales + analogicas).
    // Si las dos listas no dieran las mismas claves, cada columna del CSV
    // quedaria corrida respecto de su encabezado.
    const encabezados = analogMappings(MAPPINGS).map((entry) => entry.key);
    const filtrados = [...MAPPINGS.filter((m) => m.transformacion !== 'bit'), MAPPINGS[2]];
    const analogicas = filaDirecta(RAW, filtrados).analogicas || {};
    expect(Object.keys(analogicas)).toEqual(encabezados);
  });

  it('no pisa los roles de agua ni las digitales', () => {
    const fila = filaDirecta(RAW);
    expect(fila['caudal']).toBeDefined();
    expect(fila['nivel_freatico']).toBeDefined();
    expect(Object.keys((fila['digitales'] as Record<string, unknown>) || {})).toEqual([
      'estado_bomba',
    ]);
  });
});
