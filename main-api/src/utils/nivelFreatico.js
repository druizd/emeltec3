function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Calcula el nivel freatico desde superficie usando la lectura del sensor.
 *
 * @param {object} params
 * @param {number} params.lecturaPozo - Lectura del sensor [m], columna de agua sobre el sensor.
 * @param {number} params.profundidadSensor - Profundidad del sensor desde superficie [m].
 * @param {number} params.profundidadTotal - Profundidad total del pozo [m].
 * @returns {number} nivel_freatico_m
 */
function calcularNivelFreatico({ lecturaPozo, profundidadSensor, profundidadTotal }) {
  if (!Number.isFinite(lecturaPozo)) {
    throw new Error('lectura_pozo debe ser un numero finito');
  }

  if (!Number.isFinite(profundidadTotal) || profundidadTotal <= 0) {
    throw new Error('profundidad_total debe ser un numero positivo');
  }

  const baseDelSensor =
    Number.isFinite(profundidadSensor) && profundidadSensor > 0
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

module.exports = { calcularNivelFreatico };
