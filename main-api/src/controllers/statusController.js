const path = require('path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const db = require('../config/db');

const PROTO_PATH = path.join(__dirname, '../grpc/pipeline.proto');
const CSVCONSUMER_HOST = process.env.CSVCONSUMER_HOST || 'localhost';
const CSVCONSUMER_PORT = process.env.CSVCONSUMER_PORT || '50051';

function pingPipeline() {
  return new Promise((resolve) => {
    const start = Date.now();
    let pkg;
    try {
      const def = protoLoader.loadSync(PROTO_PATH, { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true });
      pkg = grpc.loadPackageDefinition(def).logpipeline;
    } catch {
      return resolve({ status: 'offline', error: 'proto load failed' });
    }

    const client = new pkg.LogIngestion(
      `${CSVCONSUMER_HOST}:${CSVCONSUMER_PORT}`,
      grpc.credentials.createInsecure()
    );

    const deadline = new Date(Date.now() + 3000);
    client.Ping({}, { deadline }, (err, response) => {
      client.close();
      if (err) return resolve({ status: 'offline', error: err.message });
      resolve({ status: response.status === 'ok' ? 'online' : 'degraded', response_time_ms: Date.now() - start });
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

exports.getStatus = async (req, res) => {
  const [database, pipeline] = await Promise.all([pingDatabase(), pingPipeline()]);

  const jwtConfigured = !!(process.env.JWT_SECRET && process.env.JWT_SECRET !== 'super_secret_dev_key_12345');

  const services = {
    api: {
      status: 'online',
      uptime_s: Math.floor(process.uptime()),
      environment: process.env.NODE_ENV || 'development',
    },
    auth: {
      status: jwtConfigured ? 'online' : 'degraded',
      jwt_configured: jwtConfigured,
    },
    database,
    pipeline,
  };

  const allOk = Object.values(services).every((s) => s.status === 'online');

  res.status(allOk ? 200 : 207).json({
    ok: allOk,
    timestamp: new Date().toISOString(),
    services,
  });
};
