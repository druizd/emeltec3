require('dotenv').config();
const { port, nodeEnv } = require('./config/env');
const app = require('./app');

app.listen(port, () => {
  console.log(`[auth-api] HTTP corriendo en http://localhost:${port}`);
  console.log(`[auth-api] Entorno: ${nodeEnv}`);
});
