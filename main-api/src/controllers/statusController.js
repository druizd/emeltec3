const path = require('path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const db = require('../config/db');

const PROTO_PATH = path.join(__dirname, '../grpc/pipeline.proto');
const CSVCONSUMER_HOST = process.env.CSVCONSUMER_HOST || 'localhost';
const CSVCONSUMER_PORT = process.env.CSVCONSUMER_PORT || '50051';
const AUTH_API_URL = process.env.AUTH_API_URL || 'http://auth-api:3001';
const DGA_API_INTERNAL_URL = process.env.DGA_API_INTERNAL_URL || 'http://dga-api:3002';

function pingPipeline() {
  return new Promise((resolve) => {
    const start = Date.now();
    let pkg;
    try {
      const def = protoLoader.loadSync(PROTO_PATH, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
      });
      pkg = grpc.loadPackageDefinition(def).logpipeline;
    } catch {
      return resolve({ status: 'offline', error: 'proto load failed' });
    }

    const client = new pkg.LogIngestion(
      `${CSVCONSUMER_HOST}:${CSVCONSUMER_PORT}`,
      grpc.credentials.createInsecure(),
    );

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

async function pingDga() {
  const start = Date.now();
  try {
    const res = await fetch(`${DGA_API_INTERNAL_URL}/api/dga/health/ready`, {
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

function sanitizePing({ status, response_time_ms }) {
  return response_time_ms !== undefined ? { status, response_time_ms } : { status };
}

exports.getStatus = async (req, res) => {
  const [database, pipeline, auth, dga] = await Promise.all([
    pingDatabase(),
    pingPipeline(),
    pingAuth(),
    pingDga(),
  ]);

  const services = {
    api: { status: 'online', uptime_s: Math.floor(process.uptime()) },
    auth: sanitizePing(auth),
    database: sanitizePing(database),
    pipeline: sanitizePing(pipeline),
    dga: sanitizePing(dga),
  };

  const allOk = Object.values(services).every((s) => s.status === 'online');

  res.status(allOk ? 200 : 207).json({
    ok: allOk,
    timestamp: new Date().toISOString(),
    services,
  });
};
