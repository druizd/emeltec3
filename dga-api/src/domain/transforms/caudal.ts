// Conversión de caudal: m³/h → L/s.
// Factor: 1 m³/h = 1000 L / 3600 s = 1/3.6 L/s.
// La DGA exige el caudal en L/s en sus reportes; los sensores suelen entregarlo en m³/h.
export function m3hToLps(valor: unknown): number {
  const n = typeof valor === 'number' ? valor : parseFloat(String(valor));
  if (!Number.isFinite(n)) {
    throw new Error(`El valor del caudal debe ser un número finito, se recibió: ${valor}`);
  }
  return n / 3.6;
}
