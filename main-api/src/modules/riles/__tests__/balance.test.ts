/**
 * Tests de la aritmética del balance de RILes.
 *
 * `balance.ts` no importa infraestructura, así que no hace falta mockear nada:
 * lo que se prueba es exactamente lo que corre en producción.
 */
import { describe, it, expect } from 'vitest';
import {
  aM3,
  construirPuntos,
  estadoPeriodo,
  limitesPeriodo,
  periodosDelRango,
  solapeVigencia,
  type SeriePorPeriodo,
} from '../balance';
import { DEFAULT_CONFIG, type RilesConfig, type RilesFuente } from '../types';

function config(over: Partial<RilesConfig> = {}): RilesConfig {
  return { sitio_id: 'S900', ...DEFAULT_CONFIG, ...over };
}

function fuente(over: Partial<RilesFuente> = {}): RilesFuente {
  return {
    id: '1',
    riles_sitio_id: 'S900',
    fuente_sitio_id: 'S142',
    rol: 'totalizador',
    factor: 1,
    direccion: 'entrada',
    vigencia_desde: '2020-01-01',
    vigencia_hasta: null,
    nota: null,
    fuente_descripcion: 'Pozo 1',
    ...over,
  };
}

function serie(entries: Record<string, number | null>, unidad = 'm3'): SeriePorPeriodo {
  return new Map(
    Object.entries(entries).map(([k, v]) => [k, { delta_m3: v, unidad_origen: unidad }]),
  );
}

describe('aM3', () => {
  it('deja los m3 como están', () => {
    expect(aM3(1200, 'm3')).toBe(1200);
    expect(aM3(1200, 'm³')).toBe(1200);
  });

  it('convierte litros a m3 — el caso S130', () => {
    expect(aM3(1_500_000, 'L')).toBe(1500);
    expect(aM3(1_500_000, 'litros')).toBe(1500);
  });

  it('asume m3 cuando la unidad viene vacía o es desconocida', () => {
    expect(aM3(10, null)).toBe(10);
    expect(aM3(10, '')).toBe(10);
    expect(aM3(10, 'barriles')).toBe(10);
  });

  it('propaga el null en vez de inventar un cero', () => {
    expect(aM3(null, 'm3')).toBeNull();
    expect(aM3(Number.NaN, 'm3')).toBeNull();
  });
});

describe('solapeVigencia', () => {
  const enero = { inicio: '2026-01-01', fin: '2026-01-31' };

  it('cubre el período entero', () => {
    expect(
      solapeVigencia(
        { vigencia_desde: '2025-01-01', vigencia_hasta: null },
        enero.inicio,
        enero.fin,
      ),
    ).toBe('total');
  });

  it('marca parcial cuando la ventana parte a mitad de mes', () => {
    expect(
      solapeVigencia(
        { vigencia_desde: '2026-01-15', vigencia_hasta: null },
        enero.inicio,
        enero.fin,
      ),
    ).toBe('parcial');
  });

  it('marca parcial cuando la ventana se cierra a mitad de mes', () => {
    expect(
      solapeVigencia(
        { vigencia_desde: '2025-01-01', vigencia_hasta: '2026-01-20' },
        enero.inicio,
        enero.fin,
      ),
    ).toBe('parcial');
  });

  it('queda fuera si la ventana cerró antes del período', () => {
    expect(
      solapeVigencia(
        { vigencia_desde: '2025-01-01', vigencia_hasta: '2025-12-31' },
        enero.inicio,
        enero.fin,
      ),
    ).toBe('fuera');
  });
});

describe('periodosDelRango / limitesPeriodo', () => {
  it('enumera meses inclusive', () => {
    expect(periodosDelRango('2026-01-10', '2026-03-05', 'mes')).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
    ]);
  });

  it('enumera días inclusive', () => {
    expect(periodosDelRango('2026-01-30', '2026-02-02', 'dia')).toEqual([
      '2026-01-30',
      '2026-01-31',
      '2026-02-01',
      '2026-02-02',
    ]);
  });

  it('cierra febrero bisiesto en el 29', () => {
    expect(limitesPeriodo('2028-02-01', 'mes')).toEqual({
      inicio: '2028-02-01',
      fin: '2028-02-29',
    });
  });
});

describe('estadoPeriodo', () => {
  const banda = { coef_descarga_esperado_pct: 80, coef_tolerancia_pct: 15 };

  it('sin coeficiente esperado no hay banda que comparar', () => {
    expect(estadoPeriodo(70, { coef_descarga_esperado_pct: null, coef_tolerancia_pct: 15 })).toBe(
      'sin_banda',
    );
  });

  it('distingue dentro, sobre y bajo la banda', () => {
    expect(estadoPeriodo(80, banda)).toBe('ok');
    expect(estadoPeriodo(95, banda)).toBe('ok'); // el borde entra
    expect(estadoPeriodo(96, banda)).toBe('sobre');
    expect(estadoPeriodo(60, banda)).toBe('bajo');
  });

  it('con banda pero sin coeficiente calculado es sin_dato', () => {
    expect(estadoPeriodo(null, banda)).toBe('sin_dato');
  });
});

describe('construirPuntos', () => {
  const periodos = ['2026-01-01', '2026-02-01'];

  it('suma las entradas por su factor y calcula el coeficiente contra la salida medida', () => {
    const puntos = construirPuntos({
      periodos: ['2026-01-01'],
      granularidad: 'mes',
      config: config({ modo_caudal: 'propio', coef_descarga_esperado_pct: 80 }),
      aportes: [
        {
          fuente: fuente({ id: '1', fuente_sitio_id: 'S142' }),
          serie: serie({ '2026-01-01': 1000 }),
        },
        {
          fuente: fuente({ id: '2', fuente_sitio_id: 'S143', factor: 0.5 }),
          serie: serie({ '2026-01-01': 400 }),
        },
      ],
      propio: serie({ '2026-01-01': 900 }),
    });

    const p = puntos[0]!;
    expect(p.volumen_entrada_m3).toBe(1200); // 1000 + 400*0.5
    expect(p.volumen_salida_m3).toBe(900);
    expect(p.coeficiente_pct).toBe(75);
    expect(p.consumo_neto_m3).toBe(300);
    expect(p.estimado).toBe(false);
    expect(p.completo).toBe(true);
    expect(p.estado).toBe('ok');
  });

  it('un período sin lecturas queda en null, no en cero', () => {
    const puntos = construirPuntos({
      periodos,
      granularidad: 'mes',
      config: config({ modo_caudal: 'propio' }),
      aportes: [{ fuente: fuente(), serie: serie({ '2026-01-01': 1000 }) }],
      propio: serie({ '2026-01-01': 800 }),
    });

    const febrero = puntos[1]!;
    expect(febrero.volumen_entrada_m3).toBeNull();
    expect(febrero.volumen_salida_m3).toBeNull();
    expect(febrero.coeficiente_pct).toBeNull();
    expect(febrero.completo).toBe(false);
    expect(febrero.aportes[0]!.sin_dato).toBe(true);
  });

  it('una fuente fuera de vigencia no aparece en el período', () => {
    const puntos = construirPuntos({
      periodos,
      granularidad: 'mes',
      config: config(),
      aportes: [
        {
          fuente: fuente({ vigencia_hasta: '2026-01-31' }),
          serie: serie({ '2026-01-01': 1000, '2026-02-01': 1000 }),
        },
      ],
      propio: serie({ '2026-01-01': 800, '2026-02-01': 800 }),
    });

    expect(puntos[0]!.aportes).toHaveLength(1);
    expect(puntos[1]!.aportes).toHaveLength(0);
    expect(puntos[1]!.volumen_entrada_m3).toBeNull();
  });

  it('una vigencia que parte a mitad de mes marca el período como incompleto', () => {
    const puntos = construirPuntos({
      periodos: ['2026-01-01'],
      granularidad: 'mes',
      config: config(),
      aportes: [
        { fuente: fuente({ vigencia_desde: '2026-01-15' }), serie: serie({ '2026-01-01': 1000 }) },
      ],
      propio: serie({ '2026-01-01': 800 }),
    });

    expect(puntos[0]!.aportes[0]!.vigencia_parcial).toBe(true);
    expect(puntos[0]!.completo).toBe(false);
  });

  it('modo derivado estima la salida desde la entrada y lo declara', () => {
    const puntos = construirPuntos({
      periodos: ['2026-01-01'],
      granularidad: 'mes',
      config: config({ modo_caudal: 'derivado', coef_descarga_esperado_pct: 80 }),
      aportes: [{ fuente: fuente(), serie: serie({ '2026-01-01': 1000 }) }],
      propio: new Map(),
    });

    const p = puntos[0]!;
    expect(p.volumen_salida_m3).toBe(800);
    expect(p.estimado).toBe(true);
    // El coeficiente es el configurado: la tautología de estimar la salida
    // desde la entrada. Por eso el punto viaja con estimado en true.
    expect(p.coeficiente_pct).toBe(80);
    // Sin medidor propio que esperar, las fuentes completas bastan.
    expect(p.completo).toBe(true);
  });

  it('modo derivado sin coeficiente no inventa una salida', () => {
    const puntos = construirPuntos({
      periodos: ['2026-01-01'],
      granularidad: 'mes',
      config: config({ modo_caudal: 'derivado', coef_descarga_esperado_pct: null }),
      aportes: [{ fuente: fuente(), serie: serie({ '2026-01-01': 1000 }) }],
      propio: new Map(),
    });

    expect(puntos[0]!.volumen_salida_m3).toBeNull();
    expect(puntos[0]!.estimado).toBe(false);
  });

  it('modo mixto usa el medidor cuando hay dato y cae al estimado cuando no', () => {
    const puntos = construirPuntos({
      periodos,
      granularidad: 'mes',
      config: config({ modo_caudal: 'mixto', coef_descarga_esperado_pct: 80 }),
      aportes: [{ fuente: fuente(), serie: serie({ '2026-01-01': 1000, '2026-02-01': 1000 }) }],
      propio: serie({ '2026-01-01': 910 }),
    });

    expect(puntos[0]!.volumen_salida_m3).toBe(910);
    expect(puntos[0]!.estimado).toBe(false);
    expect(puntos[0]!.completo).toBe(true);

    expect(puntos[1]!.volumen_salida_m3).toBe(800);
    expect(puntos[1]!.estimado).toBe(true);
    // Se esperaba medidor propio y no llegó: el período no está completo
    // aunque el número exista.
    expect(puntos[1]!.completo).toBe(false);
  });

  it('una fuente de dirección salida se suma a la descarga', () => {
    const puntos = construirPuntos({
      periodos: ['2026-01-01'],
      granularidad: 'mes',
      config: config({ modo_caudal: 'propio' }),
      aportes: [
        { fuente: fuente({ id: '1' }), serie: serie({ '2026-01-01': 1000 }) },
        {
          fuente: fuente({ id: '2', fuente_sitio_id: 'S901', direccion: 'salida' }),
          serie: serie({ '2026-01-01': 150 }),
        },
      ],
      propio: serie({ '2026-01-01': 700 }),
    });

    expect(puntos[0]!.volumen_salida_m3).toBe(850);
  });

  it('el factor de prorrateo no se aplica dos veces', () => {
    const puntos = construirPuntos({
      periodos: ['2026-01-01'],
      granularidad: 'mes',
      config: config(),
      aportes: [{ fuente: fuente({ factor: 0.25 }), serie: serie({ '2026-01-01': 800 }) }],
      propio: serie({ '2026-01-01': 100 }),
    });

    expect(puntos[0]!.aportes[0]!.delta_m3).toBe(800);
    expect(puntos[0]!.aportes[0]!.aporte_m3).toBe(200);
    expect(puntos[0]!.volumen_entrada_m3).toBe(200);
  });

  it('no divide por cero cuando la entrada del período es 0', () => {
    const puntos = construirPuntos({
      periodos: ['2026-01-01'],
      granularidad: 'mes',
      config: config(),
      aportes: [{ fuente: fuente(), serie: serie({ '2026-01-01': 0 }) }],
      propio: serie({ '2026-01-01': 5 }),
    });

    expect(puntos[0]!.volumen_entrada_m3).toBe(0);
    expect(puntos[0]!.coeficiente_pct).toBeNull();
    expect(puntos[0]!.consumo_neto_m3).toBe(-5);
  });
});
