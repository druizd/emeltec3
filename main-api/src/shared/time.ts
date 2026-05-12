/**
 * Helpers de tiempo con zona horaria Chile (America/Santiago).
 */
export { CHILE_TIME_ZONE, formatChileTimestamp, parseChileTimestamp } from '../utils/timezone';

export function elapsedMs(startedAt: bigint): number {
  const ns = process.hrtime.bigint() - startedAt;
  return Math.max(0, Math.round(Number(ns) / 1e6));
}

export function nowHrtime(): bigint {
  return process.hrtime.bigint();
}
