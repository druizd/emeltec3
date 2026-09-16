/**
 * Tests de la aritmética del laboratorio de RILes.
 *
 * Igual que `balance.test.ts`: `laboratorio.ts` no importa infraestructura, así
 * que lo que se prueba es exactamente lo que corre en producción.
 */
import { describe, it, expect } from 'vitest';
import {
  cargaKg,
  contarExcedencias,
  convertir,
  evaluarResultados,
  limiteVigente,
  normalizarUnidad,
  ordenarPorCatalogo,
  veredicto,
} from '../laboratorio';
import type { RilesLimite, RilesParametro, RilesResultado } from '../types';

function parametro(over: Partial<RilesParametro> = {}): RilesParametro {
  return {
    codigo: 'dbo5',
    nombre: 'DBO5',
    unidad: 'mg/L',
    aplica_carga: true,
    grupo: 'organico',
    orden: 60,
    activo: true,
    ...over,
  };
}

function catalogo(...params: RilesParametro[]): Map<string, RilesParametro> {
  return new Map(params.map((p) => [p.codigo, p]));
}

function limite(over: Partial<RilesLimite> = {}): RilesLimite {
  return {
    id: '1',
    sitio_id: 'S900',
    parametro: 'dbo5',
    norma: 'ds609',
    tipo: 'concentracion',
    limite_min: null,
    limite_max: 300,
    unidad: 'mg/L',
    vigencia_desde: '2020-01-01',
    vigencia_hasta: null,
    nota: null,
    ...over,
  };
}

function resultado(over: Partial<RilesResultado> = {}): RilesResultado {
  return {
    id: '1',
    muestra_id: '10',
    parametro: 'dbo5',
    valor: 120,
    unidad: 'mg/L',
    bajo_ld: false,
    nota: null,
    ...over,
  };
}

describe('normalizarUnidad', () => {
  it('unifica mayúsculas, espacios y las dos mu', () => {
    expect(normalizarUnidad('MG/L')).toBe('mg/l');
    expect(normalizarUnidad('  NMP/100 mL ')).toBe('nmp/100 ml');
    // U+03BC (mu griega) y U+00B5 (signo micro) se ven igual y no lo son.
    expect(normalizarUnidad('μg/L')).toBe(normalizarUnidad('µg/L'));
  });

  it('no revienta con null', () => {
    expect(normalizarUnidad(null)).toBe('');
  });
});

describe('convertir', () => {
  it('pasa µg/L a mg/L dividiendo por mil', () => {
    expect(convertir(1500, 'µg/L', 'mg/L')).toBeCloseTo(1.5, 10);
  });

  it('trata ppm como mg/L', () => {
    expect(convertir(35, 'ppm', 'mg/L')).toBe(35);
  });

  it('pasa g/L a mg/L multiplicando por mil', () => {
    expect(convertir(0.25, 'g/L', 'mg/L')).toBeCloseTo(250, 10);
  });

  it('devuelve el valor tal cual cuando la unidad es la misma', () => {
    expect(convertir(7.2, 'upH', 'upH')).toBe(7.2);
  });

  it('devuelve null entre familias distintas en vez de inventar', () => {
    expect(convertir(20, '°C', 'mg/L')).toBeNull();
    expect(convertir(7, 'upH', 'mg/L')).toBeNull();
  });

  it('devuelve null con una unidad desconocida', () => {
    expect(convertir(10, 'quintales/legua', 'mg/L')).toBeNull();
  });
});

describe('cargaKg', () => {
  it('mg/L por m³ da gramos, así que kg es dividido mil', () => {
    // 300 mg/L sobre 1.000 m³ = 300 kg.
    expect(cargaKg(300, 1000)).toBeCloseTo(300, 10);
  });

  it('sin volumen no hay carga', () => {
    expect(cargaKg(300, null)).toBeNull();
  });

  it('sin concentración tampoco', () => {
    expect(cargaKg(null, 1000)).toBeNull();
  });

  it('un volumen cero da carga cero, no null', () => {
    expect(cargaKg(300, 0)).toBe(0);
  });
});

describe('limiteVigente', () => {
  const viejo = limite({
    id: '1',
    limite_max: 300,
    vigencia_desde: '2020-01-01',
    vigencia_hasta: '2026-06-30',
  });
  const nuevo = limite({ id: '2', limite_max: 250, vigencia_desde: '2026-07-01' });

  it('toma el que regía a la fecha de la muestra', () => {
    const l = limiteVigente([viejo, nuevo], {
      parametro: 'dbo5',
      norma: 'ds609',
      fecha: '2026-03-15',
      tipo: 'concentracion',
    });
    expect(l?.id).toBe('1');
  });

  it('cambia de límite después del corte', () => {
    const l = limiteVigente([viejo, nuevo], {
      parametro: 'dbo5',
      norma: 'ds609',
      fecha: '2026-08-15',
      tipo: 'concentracion',
    });
    expect(l?.id).toBe('2');
  });

  it('ignora los de otra norma', () => {
    const l = limiteVigente([limite({ norma: 'ds90' })], {
      parametro: 'dbo5',
      norma: 'ds609',
      fecha: '2026-03-15',
      tipo: 'concentracion',
    });
    expect(l).toBeNull();
  });

  it('ignora los de otro tipo: concentración y carga no se mezclan', () => {
    const l = limiteVigente([limite({ tipo: 'carga' })], {
      parametro: 'dbo5',
      norma: 'ds609',
      fecha: '2026-03-15',
      tipo: 'concentracion',
    });
    expect(l).toBeNull();
  });

  it('sin norma declarada no hay límite que aplicar', () => {
    const l = limiteVigente([limite()], {
      parametro: 'dbo5',
      norma: null,
      fecha: '2026-03-15',
      tipo: 'concentracion',
    });
    expect(l).toBeNull();
  });
});

describe('veredicto', () => {
  it('bajo el techo es ok', () => {
    expect(veredicto({ valor: 120, bajoLd: false, limiteMin: null, limiteMax: 300 })).toBe('ok');
  });

  it('sobre el techo excede', () => {
    expect(veredicto({ valor: 340, bajoLd: false, limiteMin: null, limiteMax: 300 })).toBe(
      'excede',
    );
  });

  it('justo en el techo todavía cumple', () => {
    expect(veredicto({ valor: 300, bajoLd: false, limiteMin: null, limiteMax: 300 })).toBe('ok');
  });

  it('bajo el piso avisa por abajo: el pH se pasa de los dos lados', () => {
    expect(veredicto({ valor: 5.1, bajoLd: false, limiteMin: 5.5, limiteMax: 9 })).toBe(
      'bajo_minimo',
    );
    expect(veredicto({ valor: 9.4, bajoLd: false, limiteMin: 5.5, limiteMax: 9 })).toBe('excede');
    expect(veredicto({ valor: 7.2, bajoLd: false, limiteMin: 5.5, limiteMax: 9 })).toBe('ok');
  });

  it('sin piso ni techo no hay nada que comparar', () => {
    expect(veredicto({ valor: 120, bajoLd: false, limiteMin: null, limiteMax: null })).toBe(
      'sin_limite',
    );
  });

  describe('bajo el límite de detección', () => {
    it('si el LD ya está bajo el techo, el valor real también: cumple', () => {
      expect(veredicto({ valor: 0.01, bajoLd: true, limiteMin: null, limiteMax: 0.5 })).toBe('ok');
    });

    it('si el LD está sobre el techo, el método no resuelve: no se compara', () => {
      // Nunca 'excede': el verdadero puede estar de los dos lados del límite.
      expect(veredicto({ valor: 1.2, bajoLd: true, limiteMin: null, limiteMax: 0.5 })).toBe(
        'sin_comparar',
      );
    });

    it('contra un piso sí es determinante: menor que el LD es menor que el piso', () => {
      expect(veredicto({ valor: 5.0, bajoLd: true, limiteMin: 5.5, limiteMax: 9 })).toBe(
        'bajo_minimo',
      );
    });
  });
});

describe('evaluarResultados', () => {
  it('calcula la carga cruzando la concentración con el volumen del día', () => {
    const [r] = evaluarResultados({
      resultados: [resultado({ valor: 250 })],
      catalogo: catalogo(parametro()),
      limites: [limite()],
      norma: 'ds609',
      fecha: '2026-03-15',
      volumenM3: 400,
    });
    // 250 mg/L × 400 m³ ÷ 1000 = 100 kg.
    expect(r!.carga_kg).toBeCloseTo(100, 10);
    expect(r!.estado).toBe('ok');
    expect(r!.carga_es_cota).toBe(false);
  });

  it('normaliza el resultado a la unidad del catálogo antes de comparar', () => {
    // 900.000 µg/L son 900 mg/L: excede el techo de 300, aunque "900" suelto
    // pareciera estar por debajo de nada.
    const [r] = evaluarResultados({
      resultados: [resultado({ valor: 900_000, unidad: 'µg/L' })],
      catalogo: catalogo(parametro()),
      limites: [limite()],
      norma: 'ds609',
      fecha: '2026-03-15',
      volumenM3: 100,
    });
    expect(r!.valor_norm).toBeCloseTo(900, 10);
    expect(r!.estado).toBe('excede');
    expect(r!.carga_kg).toBeCloseTo(90, 10);
  });

  it('convierte también el límite cuando viene en otra unidad', () => {
    const [r] = evaluarResultados({
      resultados: [resultado({ parametro: 'mercurio', valor: 0.004 })],
      catalogo: catalogo(parametro({ codigo: 'mercurio', nombre: 'Mercurio', orden: 300 })),
      limites: [limite({ parametro: 'mercurio', limite_max: 5, unidad: 'µg/L' })],
      norma: 'ds609',
      fecha: '2026-03-15',
      volumenM3: null,
    });
    // 5 µg/L son 0,005 mg/L, y 0,004 está por debajo.
    expect(r!.limite_max).toBeCloseTo(0.005, 10);
    expect(r!.estado).toBe('ok');
  });

  it('no compara cuando las unidades no son convertibles', () => {
    const [r] = evaluarResultados({
      resultados: [resultado({ valor: 120, unidad: 'quintales/legua' })],
      catalogo: catalogo(parametro()),
      limites: [limite()],
      norma: 'ds609',
      fecha: '2026-03-15',
      volumenM3: 400,
    });
    expect(r!.estado).toBe('sin_comparar');
    expect(r!.valor_norm).toBeNull();
    expect(r!.carga_kg).toBeNull();
  });

  it('el pH no tiene carga: multiplicarlo por m³ no da kg de nada', () => {
    const [r] = evaluarResultados({
      resultados: [resultado({ parametro: 'ph', valor: 7.2, unidad: 'upH' })],
      catalogo: catalogo(
        parametro({ codigo: 'ph', nombre: 'pH', unidad: 'upH', aplica_carga: false, orden: 10 }),
      ),
      limites: [limite({ parametro: 'ph', limite_min: 5.5, limite_max: 9, unidad: 'upH' })],
      norma: 'ds609',
      fecha: '2026-03-15',
      volumenM3: 400,
    });
    expect(r!.carga_kg).toBeNull();
    expect(r!.estado).toBe('ok');
  });

  it('la carga de un "< LD" es una cota superior y viaja marcada', () => {
    const [r] = evaluarResultados({
      resultados: [resultado({ valor: 2, bajo_ld: true })],
      catalogo: catalogo(parametro()),
      limites: [limite()],
      norma: 'ds609',
      fecha: '2026-03-15',
      volumenM3: 1000,
    });
    expect(r!.carga_kg).toBeCloseTo(2, 10);
    expect(r!.carga_es_cota).toBe(true);
  });

  it('sin límite declarado el resultado se muestra, pero sin veredicto', () => {
    const [r] = evaluarResultados({
      resultados: [resultado()],
      catalogo: catalogo(parametro()),
      limites: [],
      norma: 'ds609',
      fecha: '2026-03-15',
      volumenM3: 400,
    });
    expect(r!.estado).toBe('sin_limite');
    expect(r!.limite_max).toBeNull();
    // La carga no depende del límite: se calcula igual.
    expect(r!.carga_kg).toBeCloseTo(48, 10);
  });

  it('sin volumen del día la carga queda en null, no en cero', () => {
    const [r] = evaluarResultados({
      resultados: [resultado()],
      catalogo: catalogo(parametro()),
      limites: [limite()],
      norma: 'ds609',
      fecha: '2026-03-15',
      volumenM3: null,
    });
    expect(r!.carga_kg).toBeNull();
  });

  it('uso_limite_pct dice cuánto del techo ocupa el valor', () => {
    const [r] = evaluarResultados({
      resultados: [resultado({ valor: 150 })],
      catalogo: catalogo(parametro()),
      limites: [limite({ limite_max: 300 })],
      norma: 'ds609',
      fecha: '2026-03-15',
      volumenM3: null,
    });
    expect(r!.uso_limite_pct).toBeCloseTo(50, 10);
  });

  it('un parámetro fuera del catálogo no rompe la muestra', () => {
    const [r] = evaluarResultados({
      resultados: [resultado({ parametro: 'inventado' })],
      catalogo: catalogo(parametro()),
      limites: [],
      norma: 'ds609',
      fecha: '2026-03-15',
      volumenM3: 400,
    });
    expect(r!.parametro_nombre).toBeNull();
    expect(r!.carga_kg).toBeNull();
    expect(r!.estado).toBe('sin_limite');
  });

  it('devuelve los resultados en el orden del catálogo', () => {
    const evaluados = evaluarResultados({
      resultados: [
        resultado({ id: '1', parametro: 'dbo5' }),
        resultado({ id: '2', parametro: 'ph', unidad: 'upH', valor: 7 }),
      ],
      catalogo: catalogo(
        parametro(),
        parametro({ codigo: 'ph', unidad: 'upH', aplica_carga: false, orden: 10 }),
      ),
      limites: [],
      norma: 'ds609',
      fecha: '2026-03-15',
      volumenM3: null,
    });
    expect(evaluados.map((r) => r.parametro)).toEqual(['ph', 'dbo5']);
  });
});

describe('ordenarPorCatalogo', () => {
  it('manda al final, alfabético, lo que no está en el catálogo', () => {
    const orden = ordenarPorCatalogo(
      [{ parametro: 'zzz' }, { parametro: 'dbo5' }, { parametro: 'aaa' }],
      catalogo(parametro()),
    );
    expect(orden.map((r) => r.parametro)).toEqual(['dbo5', 'aaa', 'zzz']);
  });
});

describe('contarExcedencias', () => {
  it('cuenta los que se pasan por arriba y por abajo, no los que no se comparan', () => {
    const evaluados = evaluarResultados({
      resultados: [
        resultado({ id: '1', parametro: 'dbo5', valor: 400 }),
        resultado({ id: '2', parametro: 'ph', unidad: 'upH', valor: 4.9 }),
        resultado({ id: '3', parametro: 'sst', valor: 50 }),
        resultado({ id: '4', parametro: 'cobre', valor: 9, unidad: 'quintales/legua' }),
      ],
      catalogo: catalogo(
        parametro(),
        parametro({ codigo: 'ph', unidad: 'upH', aplica_carga: false, orden: 10 }),
        parametro({ codigo: 'sst', orden: 40 }),
        parametro({ codigo: 'cobre', orden: 250 }),
      ),
      limites: [
        limite({ parametro: 'dbo5', limite_max: 300 }),
        limite({ parametro: 'ph', limite_min: 5.5, limite_max: 9, unidad: 'upH' }),
        limite({ parametro: 'sst', limite_max: 300 }),
        limite({ parametro: 'cobre', limite_max: 1 }),
      ],
      norma: 'ds609',
      fecha: '2026-03-15',
      volumenM3: null,
    });
    expect(contarExcedencias(evaluados)).toBe(2);
  });
});
