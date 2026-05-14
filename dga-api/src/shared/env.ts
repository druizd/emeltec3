// Carga y valida las variables de entorno (.env) usando Zod.
// Expone `env` (valores crudos validados) y `config` (objeto agrupado por dominio: db, auth, workers, etc.).
// Si falta una variable requerida o tiene un formato inválido, el proceso aborta al arranque.
import 'dotenv/config';
import { z } from 'zod';

// Entornos soportados por la app.
const NodeEnv = z.enum(['development', 'test', 'production']).default('development');

// Permite que las flags booleanas se escriban como "true"/"false" o "1"/"0".
const BoolFlag = z
  .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
  .transform((v) => v === 'true' || v === '1');

// Esquema completo: cada variable de entorno con su tipo, default y validaciones.
const Schema = z.object({
  NODE_ENV: NodeEnv,
  PORT: z.coerce.number().int().positive().default(3002),
  CORS_ORIGIN: z.string().default('*'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DB_HOST: z.string().min(1).default('localhost'),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_NAME: z.string().min(1).default('db_infra'),
  DB_USER: z.string().min(1).default('admin_infra'),
  DB_PASSWORD: z.string().min(1),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  DB_IDLE_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(30_000),
  DB_CONN_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(5_000),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(10_000),
  DB_SLOW_LOG_MS: z.coerce.number().int().nonnegative().default(500),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET debe tener al menos 16 caracteres'),
  INTERNAL_API_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional()),

  RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(200),

  ENABLE_INGESTION_WORKER: BoolFlag.default('true'),
  ENABLE_SUBMISSION_WORKER: BoolFlag.default('false'),
  INGESTION_CRON: z.string().default('* * * * *'),
  SUBMISSION_CRON: z.string().default('*/5 * * * *'),

  DGA_API_URL: z.string().url().default('https://apimee.mop.gob.cl/api/v1/mediciones/subterraneas'),
  DGA_RUT_EMPRESA: z.string().min(1).default(''),
});

export type Env = z.infer<typeof Schema>;

// Parsea process.env contra el esquema. Si falla, imprime cada error y termina el proceso.
function load(): Env {
  const parsed = Schema.safeParse(process.env);
  if (!parsed.success) {
    const formatted = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    console.error(`[env] Variables de entorno inválidas:\n${formatted}`);
    process.exit(1);
  }
  return parsed.data;
}

export const env = load();

// Vista agrupada por dominio (db, auth, rateLimit, workers). El resto del código consume `config`, no `env`.
export const config = {
  nodeEnv: env.NODE_ENV,
  isProd: env.NODE_ENV === 'production',
  isDev: env.NODE_ENV === 'development',
  isTest: env.NODE_ENV === 'test',
  port: env.PORT,
  corsOrigin: env.CORS_ORIGIN,
  logLevel: env.LOG_LEVEL,
  db: {
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    max: env.DB_POOL_MAX,
    idleTimeoutMillis: env.DB_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: env.DB_CONN_TIMEOUT_MS,
    statementTimeoutMs: env.DB_STATEMENT_TIMEOUT_MS,
    slowLogMs: env.DB_SLOW_LOG_MS,
  },
  auth: {
    jwtSecret: env.JWT_SECRET,
    internalApiKey: env.INTERNAL_API_KEY,
  },
  rateLimit: {
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
  },
  workers: {
    ingestionEnabled: env.ENABLE_INGESTION_WORKER,
    submissionEnabled: env.ENABLE_SUBMISSION_WORKER,
    ingestionCron: env.INGESTION_CRON,
    submissionCron: env.SUBMISSION_CRON,
  },
  dga: {
    apiUrl: env.DGA_API_URL,
    rutEmpresa: env.DGA_RUT_EMPRESA,
  },
} as const;

export type Config = typeof config;
