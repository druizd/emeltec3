const path = require('path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const db = require('../config/db');
const {
  summarize,
  overallStatus,
  publicView,
  detailView,
  ingestionSummary,
  workerSnapshot,
  processVitals,
} = require('../services/statusReport');
const { snapshot: heartbeatSnapshot } = require('../services/heartbeat');

const PROTO_PATH = path.join(__dirname, '../grpc/pipeline.proto');
const CSVCONSUMER_HOST = process.env.CSVCONSUMER_HOST || 'localhost';
const CSVCONSUMER_PORT = process.env.CSVCONSUMER_PORT || '50051';
const FTPCONSUMER_HOST = process.env.FTPCONSUMER_HOST || 'localhost';
const FTPCONSUMER_PORT = process.env.FTPCONSUMER_PORT || '50061';
const AUTH_API_URL = process.env.AUTH_API_URL || 'http://auth-api:3001';
const LINUX_DB_API_URL = process.env.LINUX_DB_API_URL || 'http://linux-db-api:3010';

// Un equipo se considera transmitiendo si recibió datos dentro de esta ventana.
const INGESTION_FRESH_MS = Number(process.env.INGESTION_FRESH_MS) || 15 * 60 * 1000;
// Un worker se considera colgado si no late dentro de esta ventana.
const WORKER_STALE_MS = Number(process.env.WORKER_STALE_MS) || 30 * 60 * 1000;
// Workers in-process que reportan latido (ver services/heartbeat.js).
const WORKER_NAMES = [
  'alertas',
  'dgaWorker',
  'dgaPreseed',
  'dgaSubmission',
  'dgaReconciler',
  'healthDigest',
  'contadores',
  'cacheWarmer',
];

// La frescura de ingesta se memoiza: el panel sondea cada 10 s pero el query
// por-sitio no necesita correr tan seguido (evita carga innecesaria a la BD).
const INGESTION_CACHE_MS = 60 * 1000;
let ingestionCache = { at: 0, value: null };

function loadPipelinePkg() {
  const def = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  return grpc.loadPackageDefinition(def).logpipeline;
}

function pingGrpc(host, port) {
  return new Promise((resolve) => {
    const start = Date.now();
    let pkg;
    try {
      pkg = loadPipelinePkg();
    } catch {
      return resolve({ status: 'offline', error: 'proto load failed' });
    }

    const client = new pkg.LogIngestion(`${host}:${port}`, grpc.credentials.createInsecure());
    const deadline = new Date(Date.now() + 3000);
    client.Ping({}, { deadline }, (err, response) => {
      client.close();
      if (err) return resolve({ status: 'offline', error: err.message });
      resolve({
        status: response.status === 'ok' ? 'online' : 'degraded',
        response_time_ms: Date.now() - start,
      });
    });
  });
}

async function pingDatabase() {
  const start = Date.now();
  try {
    await db.query('SELECT 1');
    return { status: 'online', response_time_ms: Date.now() - start };
  } catch (err) {
    return { status: 'offline', error: err.message };
  }
}

async function pingAuth() {
  const start = Date.now();
  try {
    const res = await fetch(`${AUTH_API_URL}/api/health`, {
      signal: AbortSignal.timeout(3000),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      return { status: 'degraded', http_status: res.status, response_time_ms: Date.now() - start };
    }
    const body = await res.json().catch(() => ({}));
    return {
      status: body.ok === false ? 'degraded' : 'online',
      response_time_ms: Date.now() - start,
    };
  } catch (err) {
    return { status: 'offline', error: err.message };
  }
}

/**
 * Redis es una caché OPCIONAL. Se sondea reutilizando el singleton compilado
 * (dist/config/redis). Si no se puede cargar el módulo (build ausente en dev)
 * o la caché está deshabilitada, no se alarma: el servicio no está "caído".
 */
async function pingRedis() {
  const start = Date.now();
  try {
    const { cache } = require(path.join(__dirname, '..', '..', 'dist', 'config', 'redis'));
    if (!cache || !cache.enabled) return { status: 'online' };
    const client = cache.raw();
    if (!client) return { status: 'online' };
    await client.ping();
    return { status: 'online', response_time_ms: Date.now() - start };
  } catch (err) {
    if (err && err.code === 'MODULE_NOT_FOUND') return { status: 'online' };
    return { status: 'degraded', error: err.message };
  }
}

function apiSelf() {
  let version;
  try {
    version = require(path.join(__dirname, '..', '..', 'package.json')).version;
  } catch {
    version = undefined;
  }
  return {
    status: 'online',
    response_time_ms: 0,
    uptime_s: Math.floor(process.uptime()),
    environment: process.env.NODE_ENV || 'development',
    node_version: process.version,
    version,
  };
}

/**
 * linux-db-api (cola de comandos PLC). Su `/health` es público (no requiere
 * INTERNAL_API_KEY) y devuelve { ok, status, uptime_s }.
 * Nota: la PROFUNDIDAD de la cola PLC (comandos `pending`) no la expone hoy;
 * requeriría un endpoint nuevo en linux-db-api (Rust).
 */
async function pingLinuxDbApi() {
  if (!LINUX_DB_API_URL) return { status: 'unknown' };
  const start = Date.now();
  try {
    const res = await fetch(`${LINUX_DB_API_URL}/health`, {
      signal: AbortSignal.timeout(3000),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      return { status: 'degraded', http_status: res.status, response_time_ms: Date.now() - start };
    }
    const body = await res.json().catch(() => ({}));
    return {
      status: body.ok === false ? 'degraded' : 'online',
      response_time_ms: Date.now() - start,
      uptime_s: typeof body.uptime_s === 'number' ? body.uptime_s : undefined,
    };
  } catch (err) {
    return { status: 'offline', error: err.message };
  }
}

/**
 * Frescura de ingesta: por cada sitio activo (excluyendo maletas), el último
 * `received_at` de su equipo. Reusa el patrón del worker healthDigest. El
 * resultado se memoiza ~60 s para no recargar la BD en cada sondeo del panel.
 */
async function getIngestion() {
  const now = Date.now();
  if (ingestionCache.value && now - ingestionCache.at < INGESTION_CACHE_MS) {
    return ingestionCache.value;
  }
  try {
    const { rows } = await db.query(
      `SELECT (SELECT MAX(received_at) FROM equipo WHERE id_serial = s.id_serial) AS last_received_at
         FROM sitio s
        WHERE s.activo = TRUE
          AND s.tipo_sitio <> 'maleta'
          AND s.id_serial IS NOT NULL`,
    );
    const value = ingestionSummary(rows, Date.now(), INGESTION_FRESH_MS);
    ingestionCache = { at: now, value };
    return value;
  } catch {
    return { status: 'unknown', sites_total: 0, transmitting: 0, stale: 0, last_age_s: null };
  }
}

/** Vitales del proceso main-api + estado del pool de conexiones a la BD. */
function processBlock() {
  return {
    ...processVitals(process.memoryUsage()),
    uptime_s: Math.floor(process.uptime()),
    db_pool: {
      total: db.totalCount ?? null,
      idle: db.idleCount ?? null,
      waiting: db.waitingCount ?? null,
    },
  };
}

/**
 * /api/status — PÚBLICO (lo consume metrics.emeltec.cl sin login). La respuesta
 * NO debe filtrar detalle interno (errores de BD, versiones, hostnames, entorno,
 * uptime ni códigos HTTP upstream) — EMT-C03 / EMT-M08. Solo el estado por
 * servicio. El detalle vive en /api/status/detail, autenticado.
 */
exports.getStatus = async (req, res) => {
  const [database, pipeline, auth] = await Promise.all([
    pingDatabase(),
    pingGrpc(CSVCONSUMER_HOST, CSVCONSUMER_PORT),
    pingAuth(),
  ]);

  const services = {
    api: publicView({ status: 'online' }),
    auth: publicView(auth),
    database: publicView(database),
    pipeline: publicView(pipeline),
  };

  const overall = overallStatus(services);
  res.status(overall === 'online' ? 200 : 207).json({
    ok: overall === 'online',
    timestamp: new Date().toISOString(),
    services,
  });
};

/**
 * /api/status/detail — AUTENTICADO (protect + authorizeRoles SuperAdmin/Admin).
 * Inventario sondeado en vivo con detalle (latencia, uptime, entorno, versión).
 * Solo incluye servicios que main-api puede alcanzar directamente; los servicios
 * estáticos y los del lado Windows no se sondean desde aquí.
 */
exports.getStatusDetail = async (req, res) => {
  const [database, csvconsumer, ftpconsumer, auth, redis, linuxDbApi, ingestion] =
    await Promise.all([
      pingDatabase(),
      pingGrpc(CSVCONSUMER_HOST, CSVCONSUMER_PORT),
      pingGrpc(FTPCONSUMER_HOST, FTPCONSUMER_PORT),
      pingAuth(),
      pingRedis(),
      pingLinuxDbApi(),
      getIngestion(),
    ]);

  const services = {
    api: detailView(apiSelf()),
    auth: detailView(auth),
    database: detailView(database),
    csvconsumer: detailView(csvconsumer),
    ftpconsumer: detailView(ftpconsumer),
    redis: detailView(redis),
    linuxDbApi: detailView(linuxDbApi),
  };

  const workers = workerSnapshot(heartbeatSnapshot(), WORKER_NAMES, Date.now(), WORKER_STALE_MS);
  const summary = summarize(services);
  const overall = overallStatus(services);

  res.status(overall === 'online' ? 200 : 207).json({
    ok: overall === 'online',
    timestamp: new Date().toISOString(),
    overall,
    summary,
    services,
    ingestion,
    workers,
    process: processBlock(),
  });
};
