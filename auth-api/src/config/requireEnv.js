/**
 * Lee una variable de entorno requerida. Si falta o está vacía, aborta el proceso.
 * Uso: const JWT_SECRET = requireEnv('JWT_SECRET');
 */
function requireEnv(name) {
  const v = process.env[name];
  if (v === undefined || v === null || v === '') {
    console.error(`FATAL: variable de entorno requerida no está definida: ${name}`);
    process.exit(1);
  }
  return v;
}

module.exports = { requireEnv };
