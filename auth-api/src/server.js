const app           = require('./app');
const { port, nodeEnv } = require('./config/env');

app.listen(port, () => {
  console.log(`[auth-api] HTTP corriendo en http://localhost:${port}`);
  console.log(`[auth-api] Entorno: ${nodeEnv}`);
});
