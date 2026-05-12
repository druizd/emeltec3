// Convierte caudal de m3/h a L/s.
// 1 m3/h = 1000 L / 3600 s = 1 / 3.6 L/s.
function m3hALs(valor) {
  // 1. Convertimos explícitamente a número por si el CSV lo mandó como texto ("String")
  const numeroValidado = parseFloat(valor);

  // 2. Ahora sí evaluamos si es un número real y finito
  if (!Number.isFinite(numeroValidado)) {
    throw new Error(`El valor del caudal debe ser un número finito, se recibió: ${valor}`);
  }

  // 3. Hacemos el cálculo
  return numeroValidado / 3.6;
}

module.exports = { m3hALs };
