// Shim CJS para las rutas v1 (CommonJS). La implementación vive en
// shared/email-otp.ts — core unificado de step-up 2FA (antes duplicado
// aquí y en modules/dga/twofactor.ts).
//
// Mismo patrón que app.js/server.js: los .js consumen TS vía dist/ compilado.
const path = require('path');

module.exports = require(path.join(__dirname, '..', '..', 'dist', 'shared', 'email-otp'));
