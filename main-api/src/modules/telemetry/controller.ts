/**
 * Controladores HTTP v2 de telemetría. Thin: parsea con zod, llama service,
 * responde con envelope estándar.
 */
import type { Request, Response, NextFunction } from 'express';
import { ok } from '../../shared/httpEnvelope';
import { elapsedMs, nowHrtime } from '../../shared/time';
import { ValidationError } from '../../shared/errors';
import {
  historyQuerySchema,
  onlineQuerySchema,
  presetQuerySchema,
  mergeKeyAliases,
} from './schema';
import { authorizedSerial } from './serialAccess';
import {
  getAvailableKeysFor,
  getHistory,
  getLatest,
  getOnline,
  getPreset,
  trackUsage,
} from './service';

function fail(_req: Request, _res: Response, next: NextFunction, err: unknown): void {
  if (err instanceof Error && err.message.startsWith('Preset inválido')) {
    next(new ValidationError(err.message));
    return;
  }
  next(err);
}

export async function getHistoryHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = nowHrtime();
  const parsed = historyQuerySchema.safeParse(req.query);
  if (!parsed.success)
    return next(new ValidationError('Query inválida', { details: parsed.error.flatten() }));
  try {
    const selectedKeys = mergeKeyAliases(parsed.data);
    const serial = authorizedSerial(req);
    if (serial === null) {
      res.json(
        ok([], {
          serial_id: null,
          selected_keys: selectedKeys,
          count: 0,
          durationMs: elapsedMs(startedAt),
        }),
      );
      return;
    }
    const result = await getHistory({
      serialId: serial,
      selectedKeys,
      ...(parsed.data.from !== undefined ? { from: parsed.data.from } : {}),
      ...(parsed.data.to !== undefined ? { to: parsed.data.to } : {}),
      ...(parsed.data.limit !== undefined ? { limit: parsed.data.limit } : {}),
    });
    const durationMs = elapsedMs(startedAt);
    const payload = ok(result.rows, {
      serial_id: result.serialId,
      selected_keys: result.selectedKeys,
      count: result.rows.length,
      durationMs,
    });
    trackUsage({
      endpoint: 'GET /api/v2/telemetry/history',
      serialId: result.serialId,
      payload,
      durationMs,
      selectedKeys: result.selectedKeys,
    });
    res.json(payload);
  } catch (err) {
    fail(req, res, next, err);
  }
}

export async function getLatestHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = nowHrtime();
  const parsed = historyQuerySchema.safeParse(req.query);
  if (!parsed.success)
    return next(new ValidationError('Query inválida', { details: parsed.error.flatten() }));
  try {
    const selectedKeys = mergeKeyAliases(parsed.data);
    const serial = authorizedSerial(req);
    if (serial === null) {
      res.json(
        ok([], {
          serial_id: null,
          selected_keys: selectedKeys,
          count: 0,
          durationMs: elapsedMs(startedAt),
        }),
      );
      return;
    }
    const result = await getLatest(serial, selectedKeys);
    const durationMs = elapsedMs(startedAt);
    const payload = ok(result.rows, {
      serial_id: result.serialId,
      selected_keys: result.selectedKeys,
      count: result.rows.length,
      durationMs,
    });
    trackUsage({
      endpoint: 'GET /api/v2/telemetry/latest',
      serialId: result.serialId,
      payload,
      durationMs,
      selectedKeys: result.selectedKeys,
    });
    res.json(payload);
  } catch (err) {
    fail(req, res, next, err);
  }
}

export async function getOnlineHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = nowHrtime();
  const parsed = onlineQuerySchema.safeParse(req.query);
  if (!parsed.success)
    return next(new ValidationError('Query inválida', { details: parsed.error.flatten() }));
  try {
    const selectedKeys = mergeKeyAliases(parsed.data);
    const serial = authorizedSerial(req);
    if (serial === null) {
      res.json(
        ok([], {
          serial_id: null,
          selected_keys: selectedKeys,
          snapshot: {},
          fromCache: false,
          count: 0,
          durationMs: elapsedMs(startedAt),
        }),
      );
      return;
    }
    const result = await getOnline(serial, selectedKeys);
    const durationMs = elapsedMs(startedAt);
    const payload = ok(result.rows, {
      serial_id: result.serialId,
      selected_keys: result.selectedKeys,
      snapshot: result.snapshot,
      fromCache: result.fromCache,
      count: result.rows.length,
      durationMs,
    });
    trackUsage({
      endpoint: 'GET /api/v2/telemetry/online',
      serialId: result.serialId,
      payload,
      durationMs,
      selectedKeys: result.selectedKeys,
    });
    res.json(payload);
  } catch (err) {
    fail(req, res, next, err);
  }
}

export async function getPresetHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = nowHrtime();
  const parsed = presetQuerySchema.safeParse(req.query);
  if (!parsed.success)
    return next(new ValidationError('Query inválida', { details: parsed.error.flatten() }));
  try {
    const selectedKeys = mergeKeyAliases({ ...parsed.data, key: parsed.data.key });
    const serial = authorizedSerial(req);
    if (serial === null) {
      res.json(
        ok([], {
          serial_id: null,
          selected_keys: selectedKeys,
          preset: parsed.data.preset,
          from: null,
          to: null,
          base_date: null,
          count: 0,
          durationMs: elapsedMs(startedAt),
        }),
      );
      return;
    }
    const result = await getPreset({
      serialId: serial,
      selectedKeys,
      preset: parsed.data.preset,
      ...(parsed.data.base_date !== undefined ? { baseDate: parsed.data.base_date } : {}),
      ...(parsed.data.limit !== undefined ? { limit: parsed.data.limit } : {}),
    });
    const durationMs = elapsedMs(startedAt);
    const payload = ok(result.rows, {
      serial_id: result.serialId,
      selected_keys: result.selectedKeys,
      preset: result.preset,
      from: result.from,
      to: result.to,
      base_date: result.baseDate,
      count: result.rows.length,
      durationMs,
    });
    trackUsage({
      endpoint: 'GET /api/v2/telemetry/preset',
      serialId: result.serialId,
      payload,
      durationMs,
      selectedKeys: result.selectedKeys,
    });
    res.json(payload);
  } catch (err) {
    fail(req, res, next, err);
  }
}

export async function getKeysHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = nowHrtime();
  const parsed = onlineQuerySchema.safeParse(req.query);
  if (!parsed.success)
    return next(new ValidationError('Query inválida', { details: parsed.error.flatten() }));
  try {
    const serial = authorizedSerial(req);
    if (serial === null) {
      res.json(ok([], { serial_id: null, count: 0, durationMs: elapsedMs(startedAt) }));
      return;
    }
    const result = await getAvailableKeysFor(serial);
    const durationMs = elapsedMs(startedAt);
    const payload = ok(result.keys, {
      serial_id: result.serialId,
      count: result.keys.length,
      durationMs,
    });
    trackUsage({
      endpoint: 'GET /api/v2/telemetry/keys',
      serialId: result.serialId,
      payload,
      durationMs,
      selectedKeys: [],
    });
    res.json(payload);
  } catch (err) {
    fail(req, res, next, err);
  }
}
