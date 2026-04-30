require('dotenv').config();

module.exports = {
  nodeEnv:        process.env.NODE_ENV         || 'development',
  port:           Number(process.env.PORT      || 3001),
  jwtSecret:      process.env.JWT_SECRET       || 'super_secret_dev_key_12345',
  mainApiUrl:     process.env.MAIN_API_URL     || 'http://localhost:3000',
  internalApiKey: process.env.INTERNAL_API_KEY || '',
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
