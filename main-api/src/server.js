/**
 * Entry point del proceso Node.
 * Levanta el servidor HTTP y el servidor gRPC en el mismo proceso.
 */
require("dotenv").config();
const config = require("./config/env");
const app = require("./app");
const { startGrpcServer } = require("./grpc/server");
const alertaService = require("./services/alertaService");

let grpcServerRef = null;

// Inicia el servidor HTTP tradicional de Express.
const httpServer = app.listen(config.port, () => {
  console.log(`[main-api] HTTP corriendo en http://localhost:${config.port}`);
  console.log(`[main-api] Entorno: ${config.nodeEnv}`);
  alertaService.start();
});

// Inicia el servidor gRPC en paralelo para clientes internos o servicio a servicio.
startGrpcServer(`0.0.0.0:${config.grpcPort}`)
  .then(({ server, port }) => {
    grpcServerRef = server;
    console.log(`[main-api] gRPC corriendo en 0.0.0.0:${port}`);
  })
  .catch((error) => {
    console.error("[main-api] No se pudo iniciar gRPC:", error.message);
  });

// Apaga ambos servidores de forma ordenada cuando el proceso recibe una senal del sistema.
function shutdown(signal) {
  console.log(`[main-api] Cerrando servicios por ${signal}`);

  alertaService.stop();

  httpServer.close(() => {
    console.log("[main-api] HTTP detenido");
  });

  if (!grpcServerRef) {
    return;
  }

  grpcServerRef.tryShutdown((error) => {
    if (error) {
      console.error("[main-api] Error al cerrar gRPC:", error.message);
      grpcServerRef.forceShutdown();
      return;
    }

    console.log("[main-api] gRPC detenido");
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
