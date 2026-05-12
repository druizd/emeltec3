/**
 * Helpers de tiempo con zona horaria Chile (America/Santiago).
 * Re-export tipado del módulo JS legacy `utils/timezone.js`.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tz = require('../utils/timezone.js') as {
  CHILE_TIME_ZONE: string;
  formatChileTimestamp: (value: unknown) => string | null;
  parseChileTimestamp: (raw: unknown) => Date | null;
};

export const CHILE_TIME_ZONE: string = tz.CHILE_TIME_ZONE;
export const formatChileTimestamp = tz.formatChileTimestamp;
export const parseChileTimestamp = tz.parseChileTimestamp;

export function elapsedMs(startedAt: bigint): number {
  const ns = process.hrtime.bigint() - startedAt;
  return Math.max(0, Math.round(Number(ns) / 1e6));
}

export function nowHrtime(): bigint {
  return process.hrtime.bigint();
}
