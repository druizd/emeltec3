/**
 * Servicio de telemetría: orquesta repo, caché y buffer de métricas.
 * Único consumidor para HTTP v1, HTTP v2 y gRPC.
 */
import { cache } from '../../config/redis';
import { config } from '../../config/appConfig';
import { logger } from '../../config/logger';
import {
  findAvailableKeys,
  findHistory,
  findLatestReferenceTimestamp,
  findLatestSerialId,
  findOnlineValues,
} from './repo';
import {
  mapHistoryRow,
  mapOnlineRow,
  payloadBytes,
  projectDataByKeys,
  snapshotFromOnline,
  type HistoryRowOut,
  type OnlineRowOut,
} from './transforms';
import { trackEndpoint, trackVariable } from '../metrics/buffer';
import { PRESETS } from './schema';
import { CHILE_TIME_ZONE, formatChileTimestamp, parseChileTimestamp } from '../../shared/time';

const ONLINE_CACHE_TTL_S = 5;

export interface HistoryRequest {
  serialId?: string;
  selectedKeys: string[];
  from?: string;
  to?: string;
  limit?: number;
}

export interface HistoryResult {
  serialId: string | null;
  rows: HistoryRowOut[];
  selectedKeys: string[];
}

export interface OnlineResult {
  serialId: string | null;
  rows: OnlineRowOut[];
  snapshot: Record<string, unknown>;
  selectedKeys: string[];
  fromCache: boolean;
}

async function resolveSerial(candidate?: string): Promise<string | null> {
  if (candidate) return candidate;
  try {
    return await findLatestSerialId();
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'findLatestSerialId falló');
    return null;
  }
}

export async function getHistory(req: HistoryRequest): Promise<HistoryResult> {
  const serialId = await resolveSerial(req.serialId);
  if (!serialId) return { serialId: null, rows: [], selectedKeys: req.selectedKeys };
  const rawRows = await findHistory({
    serialId,
    selectedKeys: req.selectedKeys,
    ...(req.from !== undefined ? { from: req.from } : {}),
    ...(req.to !== undefined ? { to: req.to } : {}),
    ...(req.limit !== undefined ? { limit: req.limit } : {}),
  });
  const rows = rawRows.map((r) => mapHistoryRow(r, req.selectedKeys));
  return { serialId, rows, selectedKeys: req.selectedKeys };
}

export async function getLatest(
  serialIdInput: string | undefined,
  selectedKeys: string[],
): Promise<HistoryResult> {
  return getHistory({
    ...(serialIdInput !== undefined ? { serialId: serialIdInput } : {}),
    selectedKeys,
    limit: 1,
  });
}

export interface PresetRequest {
  serialId?: string;
  selectedKeys: string[];
  preset: string;
  baseDate?: string;
  limit?: number;
}

export interface PresetResult extends HistoryResult {
  preset: string;
  from: string | null;
  to: string | null;
  baseDate: string | null;
}

export async function getPreset(req: PresetRequest): Promise<PresetResult> {
  const presetConfig = PRESETS[req.preset.toLowerCase()];
  if (!presetConfig) {
    throw new Error(`Preset inválido: ${req.preset}`);
  }
  const serialId = await resolveSerial(req.serialId);
  if (!serialId) {
    return {
      serialId: null,
      rows: [],
      selectedKeys: req.selectedKeys,
      preset: presetConfig.canonical,
      from: null,
      to: null,
      baseDate: null,
    };
  }

  const baseDateLiteral = req.baseDate ?? (await findLatestReferenceTimestamp(serialId));
  if (!baseDateLiteral) {
    return {
      serialId,
      rows: [],
      selectedKeys: req.selectedKeys,
      preset: presetConfig.canonical,
      from: null,
      to: null,
      baseDate: null,
    };
  }

  const endDate = parseChileTimestamp(baseDateLiteral);
  if (!endDate) throw new Error('base_date no tiene un formato válido');

  const startDate = new Date(endDate);
  if (presetConfig.unit === 'hours') {
    startDate.setUTCHours(startDate.getUTCHours() - presetConfig.amount);
  } else {
    startDate.setUTCDate(startDate.getUTCDate() - presetConfig.amount);
  }

  const from = formatChileTimestamp(startDate);
  const to = formatChileTimestamp(endDate);

  const rawRows = await findHistory({
    serialId,
    selectedKeys: req.selectedKeys,
    ...(from !== null ? { from } : {}),
    ...(to !== null ? { to } : {}),
    ...(req.limit !== undefined ? { limit: req.limit } : {}),
  });

  return {
    serialId,
    rows: rawRows.map((r) => mapHistoryRow(r, req.selectedKeys)),
    selectedKeys: req.selectedKeys,
    preset: presetConfig.canonical,
    from,
    to,
    baseDate: formatChileTimestamp(endDate),
  };
}

export async function getAvailableKeysFor(serialIdInput?: string): Promise<{
  serialId: string | null;
  keys: string[];
}> {
  const serialId = await resolveSerial(serialIdInput);
  if (!serialId) return { serialId: null, keys: [] };
  const keys = await findAvailableKeys(serialId);
  return { serialId, keys };
}

export async function getOnline(
  serialIdInput: string | undefined,
  selectedKeys: string[],
): Promise<OnlineResult> {
  const serialId = await resolveSerial(serialIdInput);
  if (!serialId) {
    return {
      serialId: null,
      rows: [],
      snapshot: {},
      selectedKeys,
      fromCache: false,
    };
  }

  const cacheKey = `telemetry:online:${serialId}:${selectedKeys.slice().sort().join(',')}`;

  if (cache.enabled) {
    const cached = await cache.get(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as Omit<OnlineResult, 'fromCache'>;
        return { ...parsed, fromCache: true };
      } catch {
        // ignore corrupted entry
      }
    }
  }

  const rawRows = await findOnlineValues(serialId, selectedKeys);
  const rows = rawRows.map(mapOnlineRow);
  const snapshot = snapshotFromOnline(rows);
  const result: Omit<OnlineResult, 'fromCache'> = {
    serialId,
    rows,
    snapshot,
    selectedKeys,
  };

  if (cache.enabled) {
    await cache.set(cacheKey, JSON.stringify(result), ONLINE_CACHE_TTL_S);
  }

  return { ...result, fromCache: false };
}

/* ── Telemetría de uso (buffer in-memory) ────────────────────────────── */

export interface TrackUsageOpts {
  endpoint: string;
  serialId: string | null;
  payload: unknown;
  durationMs: number;
  selectedKeys: string[];
}

export function trackUsage(opts: TrackUsageOpts): number {
  const bytes = payloadBytes(opts.payload);
  trackEndpoint({ endpoint: opts.endpoint, domain: 'data', serialId: opts.serialId }, bytes);

  if (opts.selectedKeys.length > 0 && opts.serialId) {
    const share = Math.max(0, Math.round(opts.durationMs / opts.selectedKeys.length));
    for (const k of opts.selectedKeys) {
      trackVariable(
        { nombreDato: k, serialId: opts.serialId },
        Math.round(bytes / opts.selectedKeys.length),
        share,
      );
    }
  }
  return bytes;
}

// Re-exports útiles para los adapters v1.
export { projectDataByKeys, CHILE_TIME_ZONE };
export const onlineCacheTtlSeconds = config.redis.enabled ? ONLINE_CACHE_TTL_S : 0;
