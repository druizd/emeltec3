require('dotenv').config();
const { requireEnv } = require('./requireEnv');

module.exports = {
  nodeEnv:        process.env.NODE_ENV         || 'development',
  port:           Number(process.env.PORT      || 3001),
  jwtSecret:      requireEnv('JWT_SECRET'),
  mainApiUrl:     process.env.MAIN_API_URL     || 'http://localhost:3000',
  internalApiKey: requireEnv('INTERNAL_API_KEY'),
  db: {
    host:                    process.env.DB_HOST     || 'localhost',
    port:                    Number(process.env.DB_PORT || 5432),
    database:                process.env.DB_NAME     || 'telemetry_platform',
    user:                    process.env.DB_USER     || 'postgres',
    password:                process.env.DB_PASSWORD || '',
    max:                     10,
    idleTimeoutMillis:       30000,
    connectionTimeoutMillis: 5000,
  },
};
