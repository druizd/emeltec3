/**
 * Validación tipada de variables de entorno (zod) — usada por los módulos TS
 * nuevos. Coexiste con el legacy `config/env.js` (CommonJS, sin zod).
 */
import 'dotenv/config';
import { z } from 'zod';

const NodeEnv = z.enum(['development', 'test', 'production']).default('development');

const Schema = z.object({
  NODE_ENV: NodeEnv,
  PORT: z.coerce.number().int().positive().default(3000),
  GRPC_PORT: z.coerce.number().int().positive().default(50051),
  CORS_ORIGIN: z
    .string()
    .default('*')
    .refine(
      (v) => process.env['NODE_ENV'] !== 'production' || v !== '*',
      'CORS_ORIGIN no puede ser "*" en producción',
    ),

  DB_HOST: z.string().min(1).default('localhost'),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_NAME: z.string().min(1).default('telemetry_platform'),
  DB_USER: z.string().min(1).default('postgres'),
  DB_PASSWORD: z.string().min(1),
  DB_POOL_MAX: z.coerce.number().int().positive().default(20),
  DB_IDLE_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(30_000),
  DB_CONN_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(5_000),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(10_000),
  DB_SLOW_LOG_MS: z.coerce.number().int().nonnegative().default(500),

  REDIS_URL: z.string().url().optional(),
  REDIS_KEY_PREFIX: z.string().default('emeltec:'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET debe tener al menos 16 caracteres'),
  INTERNAL_API_KEY: z.string().min(1).optional(),

  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().optional(),
  FRONTEND_URL: z.string().url().optional(),

  RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(60 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().nonnegative().default(5000),

  ENABLE_ALERTS_WORKER: z
    .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
    .default('true')
    .transform((v) => v === 'true' || v === '1'),

  ENABLE_HEALTH_DIGEST_WORKER: z
    .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),

  MONITOR_PRIMARY_EMAIL: z.string().email().optional(),

  DGA_ENCRYPTION_KEY: z
    .string()
    .min(32, 'DGA_ENCRYPTION_KEY debe tener al menos 32 caracteres (clave AES-256)')
    .optional(),

  // Endpoint REST oficial SNIA aguas subterráneas (Res. Exenta 2.170/2025).
  // Default = endpoint productivo. Override en .env solo para piloto/staging.
  DGA_API_URL: z.string().url().default('https://apimee.mop.gob.cl/api/v1/mediciones/subterraneas'),

  // Kill switch global del envío DGA. Default OFF — sin autorización de
  // gerencia para migrar legacy → nuevo pipeline. Activar solo cuando se
  // valide piloto + se apague legacy obra por obra.
  ENABLE_DGA_SUBMISSION_WORKER: z
    .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),

  // ── DGA → GCS exporter (solicitado por CCU_Central, genérico) ───────────────
  // Kill switch del worker que sube envíos DGA respondidos a Google Cloud
  // Storage en Parquet. Default OFF — requiere bucket + credenciales.
  ENABLE_DGA_GCS_WORKER: z
    .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),

  // Bucket GCS destino. Sin esto el worker loguea warning y omite el ciclo.
  DGA_GCS_BUCKET: z.string().min(1).optional(),

  // Ventana/intervalo del ciclo en minutos. También define cada cuánto corre.
  DGA_GCS_BATCH_MINUTES: z.coerce.number().int().positive().default(60),

  // Service account JSON de GCS. Si se omite, la librería usa
  // GOOGLE_APPLICATION_CREDENTIALS (ADC) del entorno.
  DGA_GCS_KEY_FILE: z.string().min(1).optional(),

  // Valor del campo NOMBRE_PROVEEDOR en el Parquet. Constante de negocio.
  DGA_GCS_PROVEEDOR: z.string().min(1).default('EMELTEC'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // ── Retención de datos (B5.2) ─────────────────────────────────────────────
  // Kill switch global del worker de retención. Default OFF.
  ENABLE_RETENTION_WORKER: z
    .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),

  // Meses de retención de audit_log general (no-DGA). Default 12.
  RETENTION_AUDIT_MONTHS: z.coerce.number().int().positive().default(12),

  // Meses de retención de acciones DGA en audit_log. Default 36.
  RETENTION_DGA_MONTHS: z.coerce.number().int().positive().default(36),

  // Meses de inactividad antes de anonimizar la cuenta. Default 24.
  RETENTION_INACTIVITY_MONTHS: z.coerce.number().int().positive().default(24),

  // Días de anticipación del aviso antes de anonimizar. Default 30.
  RETENTION_NOTICE_DAYS: z.coerce.number().int().positive().default(30),

  // Intervalo del ciclo del worker en ms. Default 24 horas.
  RETENTION_POLL_MS: z.coerce.number().int().positive().default(86_400_000),

  // ── Alertas automáticas de audit log (B4.2) ──────────────────────────────
  // Kill switch global del worker de alertas de audit. Default OFF.
  ENABLE_AUDIT_ALERTS_WORKER: z
    .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),

  // Ventana de tiempo (minutos) para detección de logins fallidos.
  AUDIT_ALERT_LOGIN_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),

  // Número mínimo de intentos fallidos para disparar alerta.
  AUDIT_ALERT_LOGIN_THRESHOLD: z.coerce.number().int().positive().default(5),

  // Cooldown en minutos entre alertas del mismo tipo. Default 60.
  AUDIT_ALERT_COOLDOWN_MINUTES: z.coerce.number().int().positive().default(60),

  // Intervalo del ciclo de alertas en ms. Default 5 minutos.
  AUDIT_ALERTS_POLL_MS: z.coerce.number().int().positive().default(300_000),
});

export type Env = z.infer<typeof Schema>;

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

export const config = {
  nodeEnv: env.NODE_ENV,
  isProd: env.NODE_ENV === 'production',
  isDev: env.NODE_ENV === 'development',
  isTest: env.NODE_ENV === 'test',
  port: env.PORT,
  grpcPort: env.GRPC_PORT,
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
  redis: {
    url: env.REDIS_URL,
    keyPrefix: env.REDIS_KEY_PREFIX,
    enabled: Boolean(env.REDIS_URL),
  },
  auth: {
    jwtSecret: env.JWT_SECRET,
    internalApiKey: env.INTERNAL_API_KEY,
  },
  email: {
    apiKey: env.RESEND_API_KEY,
    from: env.RESEND_FROM,
    frontendUrl: env.FRONTEND_URL,
  },
  rateLimit: {
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
  },
  workers: {
    alerts: env.ENABLE_ALERTS_WORKER,
    healthDigest: env.ENABLE_HEALTH_DIGEST_WORKER,
    retention: env.ENABLE_RETENTION_WORKER,
    auditAlerts: env.ENABLE_AUDIT_ALERTS_WORKER,
  },
  retention: {
    auditMonths: env.RETENTION_AUDIT_MONTHS,
    dgaMonths: env.RETENTION_DGA_MONTHS,
    inactivityMonths: env.RETENTION_INACTIVITY_MONTHS,
    noticeDays: env.RETENTION_NOTICE_DAYS,
    pollMs: env.RETENTION_POLL_MS,
  },
  auditAlerts: {
    loginWindowMinutes: env.AUDIT_ALERT_LOGIN_WINDOW_MINUTES,
    loginThreshold: env.AUDIT_ALERT_LOGIN_THRESHOLD,
    cooldownMinutes: env.AUDIT_ALERT_COOLDOWN_MINUTES,
    pollMs: env.AUDIT_ALERTS_POLL_MS,
  },
  monitor: {
    primaryEmail: env.MONITOR_PRIMARY_EMAIL,
  },
  dga: {
    encryptionKey: env.DGA_ENCRYPTION_KEY,
    apiUrl: env.DGA_API_URL,
    // RUT del Centro de Control Emeltec ante DGA, registrado en SNIA.
    // Es info pública (SII). Hardcoded para eliminar paso operativo de
    // setear env var en cada ambiente. Si en el futuro Emeltec cambia de
    // RUT o hay segundo Centro de Control, mover a env var.
    rutEmpresa: '76455593-7',
    submissionEnabled: env.ENABLE_DGA_SUBMISSION_WORKER,
    gcs: {
      enabled: env.ENABLE_DGA_GCS_WORKER,
      bucket: env.DGA_GCS_BUCKET,
      batchMinutes: env.DGA_GCS_BATCH_MINUTES,
      keyFile: env.DGA_GCS_KEY_FILE,
      proveedor: env.DGA_GCS_PROVEEDOR,
    },
  },
} as const;

export type Config = typeof config;
