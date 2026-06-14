const path = require('path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const db = require('../config/db');
const { summarize, overallStatus, publicView, detailView } = require('../services/statusReport');

const PROTO_PATH = path.join(__dirname, '../grpc/pipeline.proto');
const CSVCONSUMER_HOST = process.env.CSVCONSUMER_HOST || 'localhost';
const CSVCONSUMER_PORT = process.env.CSVCONSUMER_PORT || '50051';
const FTPCONSUMER_HOST = process.env.FTPCONSUMER_HOST || CSVCONSUMER_HOST;
const FTPCONSUMER_PORT = process.env.FTPCONSUMER_PORT || '50061';
const AUTH_API_URL = process.env.AUTH_API_URL || 'http://auth-api:3001';

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
  const [database, csvconsumer, ftpconsumer, auth, redis] = await Promise.all([
    pingDatabase(),
    pingGrpc(CSVCONSUMER_HOST, CSVCONSUMER_PORT),
    pingGrpc(FTPCONSUMER_HOST, FTPCONSUMER_PORT),
    pingAuth(),
    pingRedis(),
  ]);

  const services = {
    api: detailView(apiSelf()),
    auth: detailView(auth),
    database: detailView(database),
    csvconsumer: detailView(csvconsumer),
    ftpconsumer: detailView(ftpconsumer),
    redis: detailView(redis),
  };

  const summary = summarize(services);
  const overall = overallStatus(services);

  res.status(overall === 'online' ? 200 : 207).json({
    ok: overall === 'online',
    timestamp: new Date().toISOString(),
    overall,
    summary,
    services,
  });
};
