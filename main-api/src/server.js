/**
 * Entry point del proceso Node.
 * Levanta el servidor HTTP y el servidor gRPC en el mismo proceso.
 */
require('dotenv').config();
const config = require('./config/env');
const app = require('./app');
const { startGrpcServer } = require('./grpc/server');
const alertaService = require('./services/alertaService');

let grpcServerRef = null;

// Inicia el servidor HTTP tradicional de Express.
const httpServer = app.listen(config.port, () => {
  console.log(`[main-api] HTTP corriendo en http://localhost:${config.port}`);
  console.log(`[main-api] Entorno: ${config.nodeEnv}`);
  alertaService.start();

  // Metrics flusher TS (buffer in-memory → DB cada 5 s).
  try {
    const flusherPath = require('path').join(
      __dirname,
      '..',
      'dist',
      'modules',
      'metrics',
      'flusher',
    );
    const { startMetricsFlusher } = require(flusherPath);
    startMetricsFlusher();
  } catch (err) {
    if (err && err.code !== 'MODULE_NOT_FOUND') {
      console.warn('[main-api] No se pudo iniciar metrics flusher:', err.message);
    }
  }

  // DGA worker TS (snapshot periódico de mediciones procesadas → dato_dga).
  try {
    const dgaWorkerPath = require('path').join(__dirname, '..', 'dist', 'modules', 'dga', 'worker');
    const { startDgaWorker } = require(dgaWorkerPath);
    startDgaWorker();
  } catch (err) {
    if (err && err.code !== 'MODULE_NOT_FOUND') {
      console.warn('[main-api] No se pudo iniciar DGA worker:', err.message);
    }
  }

  // Health digest worker TS (monitor de transmisión + DGA, event + resumen 07/16).
  try {
    const healthWorkerPath = require('path').join(
      __dirname,
      '..',
      'dist',
      'modules',
      'healthDigest',
      'worker',
    );
    const { startHealthDigestWorker } = require(healthWorkerPath);
    startHealthDigestWorker();
  } catch (err) {
    if (err && err.code !== 'MODULE_NOT_FOUND') {
      console.warn('[main-api] No se pudo iniciar health digest worker:', err.message);
    }
  }

  // Contadores worker TS (agrega mensualmente totalizador/energia/volumen).
  try {
    const contadoresWorkerPath = require('path').join(
      __dirname,
      '..',
      'dist',
      'modules',
      'contadores',
      'worker',
    );
    const { startContadoresWorker } = require(contadoresWorkerPath);
    startContadoresWorker();
  } catch (err) {
    if (err && err.code !== 'MODULE_NOT_FOUND') {
      console.warn('[main-api] No se pudo iniciar contadores worker:', err.message);
    }
  }
});

// Inicia el servidor gRPC en paralelo para clientes internos o servicio a servicio.
startGrpcServer(`0.0.0.0:${config.grpcPort}`)
  .then(({ server, port }) => {
    grpcServerRef = server;
    console.log(`[main-api] gRPC corriendo en 0.0.0.0:${port}`);
  })
  .catch((error) => {
    console.error('[main-api] No se pudo iniciar gRPC:', error.message);
  });

// Apaga ambos servidores de forma ordenada cuando el proceso recibe una senal del sistema.
function shutdown(signal) {
  console.log(`[main-api] Cerrando servicios por ${signal}`);

  alertaService.stop();

  try {
    const dgaWorkerPath = require('path').join(__dirname, '..', 'dist', 'modules', 'dga', 'worker');
    const { stopDgaWorker } = require(dgaWorkerPath);
    stopDgaWorker();
  } catch (_err) {
    // worker no estaba activo
  }

  try {
    const healthWorkerPath = require('path').join(
      __dirname,
      '..',
      'dist',
      'modules',
      'healthDigest',
      'worker',
    );
    const { stopHealthDigestWorker } = require(healthWorkerPath);
    stopHealthDigestWorker();
  } catch (_err) {
    // worker no estaba activo
  }

  try {
    const contadoresWorkerPath = require('path').join(
      __dirname,
      '..',
      'dist',
      'modules',
      'contadores',
      'worker',
    );
    const { stopContadoresWorker } = require(contadoresWorkerPath);
    stopContadoresWorker();
  } catch (_err) {
    // worker no estaba activo
  }

  httpServer.close(() => {
    console.log('[main-api] HTTP detenido');
  });

  if (!grpcServerRef) {
    return;
  }

  grpcServerRef.tryShutdown((error) => {
    if (error) {
      console.error('[main-api] Error al cerrar gRPC:', error.message);
      grpcServerRef.forceShutdown();
      return;
    }

    console.log('[main-api] gRPC detenido');
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
