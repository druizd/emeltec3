import { describe, expect, it } from 'vitest';
import type { ActivatedRoute } from '@angular/router';
import { tabDesdeQuery } from './detail-tab-query';

type DetailTab = 'dga' | 'operacion' | 'alertas' | 'bitacora' | 'analisis';
const TABS: DetailTab[] = ['dga', 'operacion', 'alertas', 'bitacora', 'analisis'];

/** ActivatedRoute mínimo: solo se consulta `snapshot.queryParamMap`. */
function rutaCon(tab: string | null): ActivatedRoute {
  return {
    snapshot: { queryParamMap: { get: (k: string) => (k === 'tab' ? tab : null) } },
  } as unknown as ActivatedRoute;
}

describe('tabDesdeQuery', () => {
  it('devuelve la pestaña cuando es válida', () => {
    expect(tabDesdeQuery(rutaCon('alertas'), TABS)).toBe('alertas');
  });

  it('devuelve null si no viene el parámetro', () => {
    expect(tabDesdeQuery(rutaCon(null), TABS)).toBeNull();
  });

  it('ignora una pestaña que no existe en ese detalle', () => {
    // Un sitio eléctrico no tiene 'alertas': el deep-link se descarta en vez
    // de dejar el componente en un estado inválido.
    expect(tabDesdeQuery(rutaCon('alertas'), ['dashboard', 'reportes'])).toBeNull();
  });

  it('no acepta valores arbitrarios del query string', () => {
    expect(tabDesdeQuery(rutaCon('__proto__'), TABS)).toBeNull();
    expect(tabDesdeQuery(rutaCon(''), TABS)).toBeNull();
  });
});
