export function cleanRutInput(value: string | null | undefined): string {
  const raw = String(value ?? '').toUpperCase();
  const digits = raw.replace(/[^0-9]/g, '');
  const hasVerifierK = raw.includes('K');

  return hasVerifierK ? `${digits}K` : digits;
}

export function formatRutInput(value: string | null | undefined): string {
  const cleaned = cleanRutInput(value);
  if (cleaned.length <= 1) return cleaned;

  const body = cleaned.slice(0, -1);
  const verifier = cleaned.slice(-1);
  const groupedBody = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  return `${groupedBody}-${verifier}`;
}

export function formatRutDgaInput(value: string | null | undefined): string {
  const cleaned = cleanRutInput(value);
  if (cleaned.length <= 1) return cleaned;

  return `${cleaned.slice(0, -1)}-${cleaned.slice(-1)}`;
}
