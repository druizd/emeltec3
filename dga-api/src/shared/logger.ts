import pino, { type LoggerOptions } from 'pino';
import { config } from './env';

const options: LoggerOptions = {
  level: config.logLevel,
  base: { service: 'dga-api', env: config.nodeEnv },
};

if (config.isDev) {
  options.transport = {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
  };
}

export const logger = pino(options);
