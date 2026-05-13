export interface NivelFreaticoParams {
  lecturaPozo: number;
  profundidadSensor?: number | null;
  profundidadTotal: number;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

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
