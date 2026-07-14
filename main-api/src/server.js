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

  // DGA pre-seed worker TS (crea slots 'vacio' del mes actual en dato_dga).
  try {
    const dgaPreseedPath = require('path').join(
      __dirname,
      '..',
      'dist',
      'modules',
      'dga',
      'preseed',
    );
    const { startDgaPreseedWorker } = require(dgaPreseedPath);
    startDgaPreseedWorker();
  } catch (err) {
    if (err && err.code !== 'MODULE_NOT_FOUND') {
      console.warn('[main-api] No se pudo iniciar DGA preseed worker:', err.message);
    }
  }

  // DGA submission worker TS (envía slots 'pendiente' a SNIA REST).
  // Default OFF — requiere ENABLE_DGA_SUBMISSION_WORKER=true + DGA_RUT_EMPRESA.
  try {
    const dgaSubmissionPath = require('path').join(
      __dirname,
      '..',
      'dist',
      'modules',
      'dga',
      'submission',
    );
    const { startDgaSubmissionWorker } = require(dgaSubmissionPath);
    startDgaSubmissionWorker();
  } catch (err) {
    if (err && err.code !== 'MODULE_NOT_FOUND') {
      console.warn('[main-api] No se pudo iniciar DGA submission worker:', err.message);
    }
  }

  // DGA GCS exporter TS (batch CSV → Google Cloud Storage cada N minutos).
  // Requiere DGA_GCS_EMPRESA_ID + GOOGLE_APPLICATION_CREDENTIALS (service account).
  try {
    const dgaGcsPath = require('path').join(
      __dirname,
      '..',
      'dist',
      'modules',
      'dga',
      'gcs-exporter',
    );
    const { startDgaGcsExporter } = require(dgaGcsPath);
    startDgaGcsExporter();
  } catch (err) {
    if (err && err.code !== 'MODULE_NOT_FOUND') {
      console.warn('[main-api] No se pudo iniciar DGA GCS exporter:', err.message);
    }
  }

  // DGA reconciler TS (red de seguridad: drift audit vs estado, slots atascados).
  try {
    const dgaReconcilerPath = require('path').join(
      __dirname,
      '..',
      'dist',
      'modules',
      'dga',
      'reconciler',
    );
    const { startDgaReconcilerWorker } = require(dgaReconcilerPath);
    startDgaReconcilerWorker();
  } catch (err) {
    if (err && err.code !== 'MODULE_NOT_FOUND') {
      console.warn('[main-api] No se pudo iniciar DGA reconciler:', err.message);
    }
  }

  // DGA GCS exporter TS (sube envíos DGA respondidos a Google Cloud Storage en
  // Parquet). Default OFF — requiere ENABLE_DGA_GCS_WORKER=true + DGA_GCS_BUCKET.
  // Solicitado por CCU_Central; selección por-sitio vía pozo_config.dga_gcs_export.
  try {
    const dgaGcsExporterPath = require('path').join(
      __dirname,
      '..',
      'dist',
      'modules',
      'dga',
      'gcs-exporter',
    );
    const { startDgaGcsExporterWorker } = require(dgaGcsExporterPath);
    startDgaGcsExporterWorker();
  } catch (err) {
    if (err && err.code !== 'MODULE_NOT_FOUND') {
      console.warn('[main-api] No se pudo iniciar DGA GCS exporter:', err.message);
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

  // Mathei simulation worker TS (real pasteurizador -> virtual electrico/riles).
  // Default OFF + dry-run ON. Requiere ENABLE_MATHEI_SIMULATION_WORKER=true.
  try {
    const matheiSimWorkerPath = require('path').join(
      __dirname,
      '..',
      'dist',
      'modules',
      'simulation',
      'matheiWorker',
    );
    const { startMatheiSimulationWorker } = require(matheiSimWorkerPath);
    startMatheiSimulationWorker();
  } catch (err) {
    if (err && err.code !== 'MODULE_NOT_FOUND') {
      console.warn('[main-api] No se pudo iniciar mathei simulation worker:', err.message);
    }
  }

  // Cache warmer TS (precalienta dashboard-history en Redis cada 50s).
  try {
    const cacheWarmerPath = require('path').join(
      __dirname,
      '..',
      'dist',
      'modules',
      'sites',
      'cacheWarmer',
    );
    const { startCacheWarmerWorker } = require(cacheWarmerPath);
    startCacheWarmerWorker();
  } catch (err) {
    if (err && err.code !== 'MODULE_NOT_FOUND') {
      console.warn('[main-api] No se pudo iniciar cache warmer worker:', err.message);
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
    const dgaPreseedPath = require('path').join(
      __dirname,
      '..',
      'dist',
      'modules',
      'dga',
      'preseed',
    );
    const { stopDgaPreseedWorker } = require(dgaPreseedPath);
    stopDgaPreseedWorker();
  } catch (_err) {
    // worker no estaba activo
  }

  try {
    const dgaSubmissionPath = require('path').join(
      __dirname,
      '..',
      'dist',
      'modules',
      'dga',
      'submission',
    );
    const { stopDgaSubmissionWorker } = require(dgaSubmissionPath);
    stopDgaSubmissionWorker();
  } catch (_err) {
    // worker no estaba activo
  }

  try {
    const dgaReconcilerPath = require('path').join(
      __dirname,
      '..',
      'dist',
      'modules',
      'dga',
      'reconciler',
    );
    const { stopDgaReconcilerWorker } = require(dgaReconcilerPath);
    stopDgaReconcilerWorker();
  } catch (_err) {
    // worker no estaba activo
  }

  try {
    const dgaGcsExporterPath = require('path').join(
      __dirname,
      '..',
      'dist',
      'modules',
      'dga',
      'gcs-exporter',
    );
    const { stopDgaGcsExporterWorker } = require(dgaGcsExporterPath);
    stopDgaGcsExporterWorker();
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

  try {
    const matheiSimWorkerPath = require('path').join(
      __dirname,
      '..',
      'dist',
      'modules',
      'simulation',
      'matheiWorker',
    );
    const { stopMatheiSimulationWorker } = require(matheiSimWorkerPath);
    stopMatheiSimulationWorker();
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
