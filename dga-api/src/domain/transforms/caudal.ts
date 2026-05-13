export function m3hToLps(valor: unknown): number {
  const n = typeof valor === 'number' ? valor : parseFloat(String(valor));
  if (!Number.isFinite(n)) {
    throw new Error(`El valor del caudal debe ser un número finito, se recibió: ${valor}`);
  }
  return n / 3.6;
}
