/**
 * Cómo se le explica al cliente una medición que un operador dio de baja.
 *
 * En la base los dos casos son `estatus = 'fallido'`, pero significan cosas
 * opuestas: una medición que agotó sus reintentos contra SNIA es una falla del
 * envío, y una que se cerró con motivo es una decisión documentada. El prefijo
 * `baja_` en `fail_reason` es lo único que las distingue.
 *
 * Mostrarlas iguales describe algo que no ocurrió: un recambio de instrumento
 * queda rotulado como "Fallido — reintentos agotados" y el cliente pregunta,
 * con razón, qué se rompió. Pasó con las 211 mediciones de S130 en septiembre
 * de 2026.
 */

/**
 * Motivos tipificados, en el idioma del cliente. La clave es el `fail_reason`
 * que escribe el panel de mantenimiento: `baja_` + el motivo que eligió el
 * operador.
 */
export const MOTIVO_BAJA_LABEL: Readonly<Record<string, string>> = {
  baja_recambio_instrumento:
    'Período sin medición por recambio de instrumento. El equipo fue reemplazado y no hay dato que declarar.',
  baja_sin_dato_crudo:
    'Sin telemetría del equipo en este período, por lo que no hay medición que declarar.',
  baja_dato_no_confiable:
    'La medición existe pero no es confiable, así que se cerró en vez de declararla.',
  baja_otro: 'Período cerrado por decisión del operador, con el motivo registrado en la medición.',
};

/** Texto que ve el cliente, con respaldo si el motivo es nuevo en el backend. */
export function motivoBajaLabel(failReason: string | null | undefined): string {
  return (
    MOTIVO_BAJA_LABEL[failReason ?? ''] ??
    'Período cerrado por el operador, con el motivo registrado.'
  );
}

/** `true` si el slot lo cerró un operador y no el agotamiento de reintentos. */
export function esBajaManual(estatus: string, failReason: string | null | undefined): boolean {
  return estatus === 'fallido' && (failReason ?? '').startsWith('baja_');
}
