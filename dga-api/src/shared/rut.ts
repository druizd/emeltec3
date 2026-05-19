export function formatRutForDga(value: unknown): string {
  const raw = String(value ?? '').toUpperCase();
  const digits = raw.replace(/[^0-9]/g, '');
  const verifier = raw.includes('K') ? 'K' : digits.slice(-1);
  const body = raw.includes('K') ? digits : digits.slice(0, -1);

  return body ? `${body}-${verifier}` : verifier;
}

export function assertRutForDga(value: string, label: string): void {
  if (!value || value.includes('.') || !/^\d+-[0-9K]$/.test(value)) {
    throw new Error(`${label} debe enviarse a DGA sin puntos y con guion`);
  }
}
