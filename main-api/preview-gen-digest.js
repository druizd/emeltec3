/* eslint-disable */
// Genera previews HTML estáticos de los correos de health digest.
// Uso: node preview-gen-digest.js

const path = require('path');
const fs = require('fs');

const logoAbs = path.resolve(
  __dirname,
  '..',
  'frontend-angular',
  'public',
  'images',
  'emeltec-logo.png',
);
const LOGO_FILE_URL = `file:///${logoAbs.replace(/\\/g, '/')}`;
process.env.FRONTEND_URL = 'https://cloud.emeltec.cl/login';

const { _renderHealthDigestHtml, _renderHealthEventHtml } = require('./src/services/emailService');

// Reemplaza el `cid:emeltec-logo` (que Resend resuelve via attachment inline)
// por una URL file:// para que los previews carguen el PNG real en el navegador.
function rewriteCid(html) {
  return html.replace(/cid:emeltec-logo/g, LOGO_FILE_URL);
}

const sampleData = [
  {
    kind: 'data',
    id: 's1',
    siteId: 's1',
    descripcion: 'Pozo Las Vertientes',
    empresa: 'Aguas de La Araucanía',
    lagMs: 14 * 3600 * 1000,
    tier: 't12',
    lastAt: new Date(Date.now() - 14 * 3600 * 1000).toISOString(),
  },
  {
    kind: 'data',
    id: 's2',
    siteId: 's2',
    descripcion: 'Estanque Norte',
    empresa: 'Sanitaria del Sur',
    lagMs: 8 * 3600 * 1000,
    tier: 't6',
    lastAt: new Date(Date.now() - 8 * 3600 * 1000).toISOString(),
  },
  {
    kind: 'data',
    id: 's3',
    siteId: 's3',
    descripcion: 'Captación Río Bueno',
    empresa: 'Hidroeléctrica Pucón',
    lagMs: 4 * 3600 * 1000,
    tier: 't3',
    lastAt: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
  },
];

const sampleDga = [
  {
    kind: 'dga',
    id: '101',
    siteId: 's1',
    descripcion: 'Pozo Las Vertientes',
    empresa: 'Aguas de La Araucanía',
    lagMs: 16 * 3600 * 1000,
    tier: 't12',
    lastAt: new Date(Date.now() - 28 * 3600 * 1000).toISOString(),
    expectedAt: new Date(Date.now() - 16 * 3600 * 1000).toISOString(),
    periodicidad: 'dia',
  },
  {
    kind: 'dga',
    id: '102',
    siteId: 's4',
    descripcion: 'Pozo Industrial Coronel',
    empresa: 'Forestal Arauco',
    lagMs: 7 * 3600 * 1000,
    tier: 't6',
    lastAt: new Date(Date.now() - 13 * 3600 * 1000).toISOString(),
    expectedAt: new Date(Date.now() - 7 * 3600 * 1000).toISOString(),
    periodicidad: 'hora',
  },
];

const now = new Date().toISOString();

// 1. Digest con incidencias
fs.writeFileSync(
  path.join(__dirname, 'preview-email-digest-issues.html'),
  rewriteCid(
    _renderHealthDigestHtml({ generatedAt: now, dataIssues: sampleData, dgaIssues: sampleDga }),
  ),
);

// 2. Digest todo en orden
fs.writeFileSync(
  path.join(__dirname, 'preview-email-digest-ok.html'),
  rewriteCid(_renderHealthDigestHtml({ generatedAt: now, dataIssues: [], dgaIssues: [] })),
);

// 3. Event single
fs.writeFileSync(
  path.join(__dirname, 'preview-email-digest-event.html'),
  rewriteCid(_renderHealthEventHtml({ eventDetail: sampleData[1] })),
);

console.log('Previews generados:');
console.log('  preview-email-digest-issues.html');
console.log('  preview-email-digest-ok.html');
console.log('  preview-email-digest-event.html');
