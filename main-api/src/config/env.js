/**
 * Carga variables de entorno y las deja agrupadas en una sola estructura.
 * Esto evita leer process.env disperso en todo el codigo.
 */
require('dotenv').config();

const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  grpcPort: Number(process.env.GRPC_PORT || 50051),
  corsOrigin: process.env.CORS_ORIGIN || '*',

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || 'telemetry_platform',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    max: Number(process.env.DB_POOL_MAX || 20),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  },
};

module.exports = config;
