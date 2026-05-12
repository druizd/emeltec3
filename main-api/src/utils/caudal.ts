/** 1 m3/h = 1000 L / 3600 s = 1/3.6 L/s */
export function m3hALs(valor: unknown): number {
  const n = parseFloat(String(valor));
  if (!Number.isFinite(n)) {
    throw new Error(`El valor del caudal debe ser un número finito, se recibió: ${valor}`);
  }
  return n / 3.6;
}
