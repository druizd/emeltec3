/**
 * Vigencia temporal de los mapeos.
 *
 * El caso que motivó todo esto: S148 venía totalizando en 0,01 m3 y en julio
 * 2026 se rectificó el medidor a m3. Con un solo `factor` por variable, cualquier
 * corrección arreglaba un tramo y rompía el otro — el histórico quedó inflado
 * 100x. La salida es que convivan dos filas de `reg_map` para la misma variable
 * física, cada una con su ventana.
 */
import { describe, it, expect } from 'vitest';
import { filterMappingsVigentesAt, isMappingVigenteAt } from '../transforms';

const CORTE = '2026-07-12T14:30:00.000Z';

function mapeo(over: Record<string, unknown> = {}) {
  return {
    id: 'RM1',
    alias: 'Totalizador',
    d1: 'REG4',
    d2: 'REG5',
    tipo_dato: 'INTEGER',
    unidad: 'm3',
    rol_dashboard: 'totalizador',
    transformacion: 'uint32_registros',
    parametros: { factor: 1 },
    sitio_id: 'S148',
    vigente_desde: null,
    vigente_hasta: null,
    ...over,
  };
}

describe('isMappingVigenteAt', () => {
  it('sin ventana el mapeo vale siempre: es como quedaron todos los que existían antes de la migración', () => {
    const m = mapeo();
    expect(isMappingVigenteAt(m, '2020-01-01T00:00:00Z')).toBe(true);
    expect(isMappingVigenteAt(m, '2030-01-01T00:00:00Z')).toBe(true);
    expect(isMappingVigenteAt(m, undefined)).toBe(true);
  });

  it('respeta el borde SEMIABIERTO: la muestra del instante del corte cae en la ventana nueva, no en las dos', () => {
    const viejo = mapeo({ vigente_hasta: CORTE });
    const nuevo = mapeo({ id: 'RM2', vigente_desde: CORTE });

    // Justo antes del corte: solo el viejo.
    expect(isMappingVigenteAt(viejo, '2026-07-12T14:29:59.999Z')).toBe(true);
    expect(isMappingVigenteAt(nuevo, '2026-07-12T14:29:59.999Z')).toBe(false);

    // El instante exacto: solo el nuevo. Si valieran los dos, los contadores
    // sumarían esa muestra dos veces.
    expect(isMappingVigenteAt(viejo, CORTE)).toBe(false);
    expect(isMappingVigenteAt(nuevo, CORTE)).toBe(true);
  });

  it('acepta Date, ISO y epoch, porque node-pg devuelve los buckets como Date', () => {
    const m = mapeo({ vigente_desde: CORTE });
    const despues = new Date('2026-08-01T00:00:00Z');
    expect(isMappingVigenteAt(m, despues)).toBe(true);
    expect(isMappingVigenteAt(m, despues.toISOString())).toBe(true);
    expect(isMappingVigenteAt(m, despues.getTime())).toBe(true);
  });

  it('un ts ilegible cae en AHORA en vez de descartar el mapeo', () => {
    const abierto = mapeo({ vigente_desde: '2020-01-01T00:00:00Z' });
    expect(isMappingVigenteAt(abierto, 'no-es-fecha')).toBe(true);

    const cerrado = mapeo({ vigente_hasta: '2020-01-01T00:00:00Z' });
    expect(isMappingVigenteAt(cerrado, 'no-es-fecha')).toBe(false);
  });

  it('un mapeo que no es objeto nunca está vigente', () => {
    expect(isMappingVigenteAt(null, CORTE)).toBe(false);
    expect(isMappingVigenteAt(undefined, CORTE)).toBe(false);
  });
});

describe('filterMappingsVigentesAt', () => {
  const viejo = mapeo({ id: 'VIEJO', vigente_hasta: CORTE, parametros: { factor: 0.01 } });
  const nuevo = mapeo({ id: 'NUEVO', vigente_desde: CORTE, parametros: { factor: 1 } });
  const sinVentana = mapeo({ id: 'CAUDAL', d1: 'AI24', rol_dashboard: 'caudal' });

  it('deja exactamente un totalizador a cada lado del corte', () => {
    const antes = filterMappingsVigentesAt([viejo, nuevo, sinVentana], '2026-03-01T00:00:00Z');
    expect(antes.map((m) => m.id)).toEqual(['VIEJO', 'CAUDAL']);

    const despues = filterMappingsVigentesAt([viejo, nuevo, sinVentana], '2026-08-01T00:00:00Z');
    expect(despues.map((m) => m.id)).toEqual(['NUEVO', 'CAUDAL']);
  });

  it('el mapeo retirado deja de competir por el rol', () => {
    // Es el bug de S127/S130: un mapeo muerto con rol `totalizador` y el bono
    // uint32 de 110 puntos le ganaba al medidor vivo en el resolver. Con la
    // ventana cerrada ni siquiera entra a la lista.
    const hoy = filterMappingsVigentesAt([viejo, nuevo], Date.now());
    expect(hoy).toHaveLength(1);
    expect(hoy[0]!.id).toBe('NUEVO');
  });

  it('una lista que no es array devuelve vacío en vez de reventar', () => {
    expect(filterMappingsVigentesAt(null as never, CORTE)).toEqual([]);
  });
});
