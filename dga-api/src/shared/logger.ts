// Logger único de toda la app, basado en Pino (JSON estructurado, rápido).
// En desarrollo usa `pino-pretty` para salida coloreada y legible.
// En producción emite JSON puro para que lo consuman herramientas de observabilidad.
import pino, { type LoggerOptions } from 'pino';
import { config } from './env';

// `base` añade `service` y `env` a cada log → facilita filtrar por servicio en agregadores.
const options: LoggerOptions = {
  level: config.logLevel,
  base: { service: 'dga-api', env: config.nodeEnv },
  redact: {
    paths: [
      '*.password',
      '*.clave',
      '*.clave_informante',
      '*.token',
      'req.headers.authorization',
      'autenticacion.password',
    ],
    censor: '[REDACTED]',
  },
};

// Modo dev: salida formateada para humanos.
if (config.isDev) {
  options.transport = {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
  };
}

export const logger = pino(options);
