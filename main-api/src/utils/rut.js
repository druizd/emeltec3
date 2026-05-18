function cleanRutInput(value) {
  const raw = String(value ?? '').toUpperCase();
  const digits = raw.replace(/[^0-9]/g, '');
  const hasVerifierK = raw.includes('K');

  return hasVerifierK ? `${digits}K` : digits;
}

function formatRutForStorage(value) {
  const cleaned = cleanRutInput(value);
  if (cleaned.length <= 1) return cleaned;

  const body = cleaned.slice(0, -1);
  const verifier = cleaned.slice(-1);
  const groupedBody = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  return `${groupedBody}-${verifier}`;
}

module.exports = {
  cleanRutInput,
  formatRutForStorage,
};
