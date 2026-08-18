import type { ActivatedRoute } from '@angular/router';

/**
 * Lee la pestaña pedida por query string (`?tab=alertas`) y la valida contra
 * las pestañas del detalle.
 *
 * Lo usa la campana de alertas del header para llevar al operador directo a la
 * pestaña que corresponde, en vez de dejarlo en la vista por defecto del sitio
 * buscándola. Cada detalle declara sus propias pestañas, así que la lista
 * válida se pasa como argumento.
 *
 * Devuelve `null` si no viene el parámetro o si no corresponde a una pestaña
 * conocida — nunca lanza, un deep-link inválido simplemente se ignora.
 */
export function tabDesdeQuery<T extends string>(
  route: ActivatedRoute,
  validas: readonly T[],
): T | null {
  const pedida = route.snapshot.queryParamMap.get('tab');
  if (!pedida) return null;
  return (validas as readonly string[]).includes(pedida) ? (pedida as T) : null;
}
