/**
 * Logger pino con request-id automático desde AsyncLocalStorage.
 */
import pino from 'pino';
import { config } from './appConfig';
import { getRequestId } from '../shared/requestContext';

const isPretty = config.isDev || process.stdout.isTTY;

export const logger = pino({
  level: config.logLevel,
  base: { service: 'main-api', env: config.nodeEnv },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.token',
      '*.otp',
      '*.otp_hash',
    ],
    censor: '[REDACTED]',
  },
  mixin() {
    const requestId = getRequestId();
    return requestId ? { requestId } : {};
  },
  ...(isPretty
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss.l',
            ignore: 'pid,hostname,service,env',
          },
        },
      }
    : {}),
});

export type Logger = typeof logger;
