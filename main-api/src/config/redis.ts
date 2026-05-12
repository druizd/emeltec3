/**
 * Cliente Redis singleton.
 * Si REDIS_URL no está definido, expone una API noop para que la caché
 * sea opcional en desarrollo local.
 */
import Redis, { type Redis as RedisClient } from 'ioredis';
import { config } from './env';
import { logger } from './logger';
import { cacheOps } from './metrics';

export interface CacheClient {
  enabled: boolean;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string | string[]): Promise<void>;
  raw(): RedisClient | null;
}

class NoopCache implements CacheClient {
  enabled = false;
  async get(): Promise<null> {
    return null;
  }
  async set(): Promise<void> {
    return;
  }
  async del(): Promise<void> {
    return;
  }
  raw(): null {
    return null;
  }
}

class RedisCache implements CacheClient {
  enabled = true;
  constructor(private readonly client: RedisClient) {}
  async get(key: string): Promise<string | null> {
    try {
      const value = await this.client.get(key);
      cacheOps.inc({ op: 'get', result: value === null ? 'miss' : 'hit' });
      return value;
    } catch (err) {
      cacheOps.inc({ op: 'get', result: 'error' });
      logger.warn({ err: (err as Error).message, key }, 'Redis GET falló — degradando');
      return null;
    }
  }
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    try {
      if (ttlSeconds && ttlSeconds > 0) {
        await this.client.set(key, value, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, value);
      }
      cacheOps.inc({ op: 'set', result: 'ok' });
    } catch (err) {
      cacheOps.inc({ op: 'set', result: 'error' });
      logger.warn({ err: (err as Error).message, key }, 'Redis SET falló — degradando');
    }
  }
  async del(key: string | string[]): Promise<void> {
    try {
      const keys = Array.isArray(key) ? key : [key];
      if (keys.length === 0) return;
      await this.client.del(...keys);
      cacheOps.inc({ op: 'del', result: 'ok' });
    } catch (err) {
      cacheOps.inc({ op: 'del', result: 'error' });
      logger.warn({ err: (err as Error).message }, 'Redis DEL falló — degradando');
    }
  }
  raw(): RedisClient {
    return this.client;
  }
}

function build(): CacheClient {
  if (!config.redis.enabled || !config.redis.url) {
    logger.info('Redis deshabilitado (REDIS_URL no definida). Caché en modo noop.');
    return new NoopCache();
  }

  const client = new Redis(config.redis.url, {
    keyPrefix: config.redis.keyPrefix,
    maxRetriesPerRequest: 2,
    lazyConnect: false,
    retryStrategy(times) {
      const delay = Math.min(1000 * 2 ** times, 30_000);
      return delay;
    },
  });

  client.on('error', (err) => logger.error({ err: err.message }, 'Redis error'));
  client.on('connect', () => logger.info({ url: maskUrl(config.redis.url!) }, 'Redis conectado'));
  client.on('reconnecting', () => logger.warn('Redis reconectando…'));

  return new RedisCache(client);
}

function maskUrl(url: string): string {
  return url.replace(/(:)([^:@/]+)(@)/, '$1***$3');
}

export const cache: CacheClient = build();
