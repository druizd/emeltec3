// Cálculo del nivel freático (profundidad del agua dentro de un pozo).
// Entrada: lectura del sensor (distancia desde la base hasta la columna de agua) + geometría del pozo.
// Salida: metros de columna de agua desde la base del sensor.
// Si no se conoce la profundidad del sensor, se asume que está al fondo del pozo (profundidad total).

export interface NivelFreaticoParams {
  lecturaPozo: number;          // Lectura cruda del sensor en metros.
  profundidadSensor?: number | null; // Profundidad a la que está instalado el sensor (opcional).
  profundidadTotal: number;     // Profundidad total del pozo en metros.
}

// Redondeo a `decimals` cifras. Usado para limitar a 3 decimales el valor final.
function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// Calcula nivel freático = base del sensor − lectura del pozo.
// Valida: lectura finita, profundidad total positiva, lectura ≤ base del sensor,
// y nivel resultante no excede la profundidad del pozo.
export function calcularNivelFreatico({
  lecturaPozo,
  profundidadSensor,
  profundidadTotal,
}: NivelFreaticoParams): number {
  if (!Number.isFinite(lecturaPozo)) {
    throw new Error('lectura_pozo debe ser un número finito');
  }
  if (!Number.isFinite(profundidadTotal) || profundidadTotal <= 0) {
    throw new Error('profundidad_total debe ser un número positivo');
  }

  // Si no hay profundidad de sensor configurada, asume que está al fondo del pozo.
  const baseDelSensor =
    profundidadSensor != null && Number.isFinite(profundidadSensor) && profundidadSensor > 0
      ? profundidadSensor
      : profundidadTotal;

  if (lecturaPozo > baseDelSensor) {
    throw new Error(
      `lectura_sensor (${lecturaPozo} m) no puede ser mayor que base_del_sensor (${baseDelSensor} m)`,
    );
  }

  const nivelFreaticoM = round(baseDelSensor - lecturaPozo, 3);

  if (nivelFreaticoM > profundidadTotal) {
    throw new Error(
      `nivel_freatico calculado (${nivelFreaticoM} m) supera la profundidad_total del pozo (${profundidadTotal} m)`,
    );
  }

  return nivelFreaticoM;
}
