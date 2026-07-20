#!/usr/bin/env node
// Adds a "Revisión de Código" sheet with manual code-review findings to an existing xlsx.
// Usage: node scripts/code-review-sheet.mjs <input.xlsx> <output.xlsx>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ExcelJS = require('exceljs');

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  console.error('Usage: node code-review-sheet.mjs <input.xlsx> <output.xlsx>');
  process.exit(1);
}

const SEVERITY_COLORS = {
  HIGH: 'FFFF4444',
  MEDIUM: 'FFFFA500',
  LOW: 'FFFFD700',
};
const SEVERITY_BG = {
  HIGH: 'FFFFF5F5',
  MEDIUM: 'FFFFF9F0',
  LOW: 'FFFFFFF0',
};

// ── Code-review findings (manual analysis, branch moises-super) ───────
const FINDINGS = [
  {
    id: 'CR-01',
    service: 'linux-db-api',
    severity: 'HIGH',
    category: 'auth_bypass',
    confidence: 9,
    title: 'API auth bypass when INTERNAL_API_KEY is empty',
    description:
      'require_api_key middleware skips auth entirely when state.api_key is empty. ' +
      'If INTERNAL_API_KEY env var is not set, all PLC routes (command create, list, ' +
      'pending fetch, result reporting) are accessible without any credential.',
    location: 'linux-db-api/src/main.rs:283',
    exploitScenario:
      'Deploy linux-db-api without INTERNAL_API_KEY (staging, misconfigured rollout). ' +
      'Any host that can reach port 3010 issues arbitrary write_tag / write_tags commands, ' +
      'triggering physical coil/register writes via Modbus TCP.',
    recommendation:
      'Fail hard at startup if INTERNAL_API_KEY is empty. ' +
      'Replace the warn-and-continue block (~line 821) with a startup panic/error.',
    owasp: 'A07:2021 — Identification and Authentication Failures',
  },
  {
    id: 'CR-02',
    service: 'linux-db-api',
    severity: 'MEDIUM',
    category: 'predictable_identifier',
    confidence: 8,
    title: 'PLC command IDs are guessable nanosecond timestamps',
    description:
      'generated_command_id() produces IDs of the form plc-<nanoseconds_since_epoch>. ' +
      'IDs are sequential and guessable within a narrow time window (~20 000 candidates ' +
      'in a ±10 ms range). An attacker can forge result callbacks for in-flight commands.',
    location: 'linux-db-api/src/main.rs:262',
    exploitScenario:
      'Attacker observes a PLC command was created at approximately time T. ' +
      'Iterates candidate IDs in ±10 ms nanos window and POSTs {status: "done"} for each. ' +
      'One matches, marking the command completed and clearing the lease — ' +
      'the real csvprocessor skips it, silently dropping a PLC write.',
    recommendation:
      'Use uuid::Uuid::new_v4().to_string() for command_id. ' +
      'Also fix CR-01 to remove the auth bypass precondition.',
    owasp: 'A01:2021 — Broken Access Control',
  },
  {
    id: 'CR-03',
    service: 'auth-api',
    severity: 'MEDIUM',
    category: 'user_enumeration',
    confidence: 8,
    title: 'startLogin leaks account existence via distinct HTTP responses',
    description:
      'POST /api/auth/start returns: 401 for unknown email, ' +
      '200 + flow:"setup" for unactivated account, ' +
      '200 + flow:"password" for activated account, ' +
      '200 + flow:"otp" for OTP account. ' +
      'An unauthenticated attacker can enumerate valid emails and their auth mode.',
    location: 'auth-api/src/controllers/authController.js:333',
    exploitScenario:
      'Attacker submits candidate email list to POST /api/auth/start. ' +
      '401 = not registered; 200 = valid. Enumerate full user base for ' +
      'credential stuffing or targeted phishing at scale.',
    recommendation:
      'Return a uniform 200 response for all valid-format emails regardless of ' +
      'account existence. For unknown emails, return same shape as a known account ' +
      '({ ok: true, flow: "password" }) and silently discard.',
    owasp: 'A07:2021 — Identification and Authentication Failures',
  },
  {
    id: 'CR-04',
    service: 'linux-db-api',
    severity: 'MEDIUM',
    category: 'excessive_cors',
    confidence: 7,
    title: 'CorsLayer::permissive() on PLC command API',
    description:
      'CorsLayer::permissive() sets Access-Control-Allow-Origin: * on an internal API ' +
      'that controls physical PLC hardware. A malicious web page on any origin can ' +
      'issue cross-origin requests from a browser on the internal OT/IT network.',
    location: 'linux-db-api/src/main.rs:806',
    exploitScenario:
      'Attacker hosts a malicious page. Operator on OT network visits it. ' +
      'Page JS fetches http://linux-db-api:3010/api/plc/commands with a crafted payload. ' +
      'If INTERNAL_API_KEY is empty (CR-01), no further credential is needed — ' +
      'arbitrary coil/register write is triggered.',
    recommendation:
      'For a container-internal API called only by backend services (not browsers), ' +
      'remove CORS headers entirely. If browsers ever need access, restrict to explicit ' +
      'origin allowlist.',
    owasp: 'A05:2021 — Security Misconfiguration',
  },
  {
    id: 'CR-05',
    service: 'linux-db-api',
    severity: 'LOW',
    category: 'data_exposure',
    confidence: 7,
    title: 'PostgreSQL connection hardcodes sslmode=disable',
    description:
      'connect_db builds the connection string with sslmode=disable and NoTls — ' +
      'hardcoded, not configurable via env var. All DB traffic (PLC command payloads, ' +
      'tag names, register addresses, device serials) travels in plaintext.',
    location: 'linux-db-api/src/main.rs:316',
    exploitScenario:
      'An attacker with passive access to the Docker bridge (e.g., compromised sidecar) ' +
      'captures plaintext PostgreSQL frames and reads PLC command history or injects ' +
      'rogue data into query result streams.',
    recommendation:
      'Make TLS mode configurable via DB_SSLMODE env var (default: require). ' +
      'Integrate tokio-postgres-rustls instead of NoTls.',
    owasp: 'A02:2021 — Cryptographic Failures',
  },
  {
    id: 'CR-06',
    service: 'auth-api',
    severity: 'LOW',
    category: 'auth_design_weakness',
    confidence: 7,
    title: 'MFA and setup tokens share the same JWT secret',
    description:
      'challenge_token (purpose:"mfa") and setup_token (purpose:"account_setup") are ' +
      'both signed with the same jwtSecret. Token-type separation relies entirely on ' +
      'purpose claim inspection. A future endpoint that verifies the JWT but omits the ' +
      'purpose check opens cross-purpose token reuse.',
    location: 'auth-api/src/controllers/authController.js:311',
    exploitScenario:
      'Developer adds a new token-gated feature and forgets to validate decoded.purpose. ' +
      'User in possession of a 10-minute MFA challenge token reuses it to access the new ' +
      'endpoint without completing the intended auth step.',
    recommendation:
      'Use a separate JWT secret per token purpose (JWT_SECRET_MFA, JWT_SECRET_SETUP). ' +
      'This eliminates the vulnerability class by construction rather than by discipline.',
    owasp: 'A07:2021 — Identification and Authentication Failures',
  },
];

// ── Build workbook ────────────────────────────────────────────────────
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(inputPath);

// Remove existing sheet if re-running
const existing = wb.getWorksheet('Revisión de Código');
if (existing) wb.removeWorksheet(existing.id);

const ws = wb.addWorksheet('Revisión de Código', { tabColor: { argb: 'FFFF4444' } });
ws.views = [{ state: 'frozen', ySplit: 1 }];

ws.columns = [
  { header: 'ID', key: 'id', width: 8 },
  { header: 'Servicio', key: 'service', width: 18 },
  { header: 'Severidad', key: 'severity', width: 12 },
  { header: 'Confianza', key: 'confidence', width: 11 },
  { header: 'Categoría', key: 'category', width: 24 },
  { header: 'Título', key: 'title', width: 42 },
  { header: 'Descripción', key: 'description', width: 55 },
  { header: 'Ubicación', key: 'location', width: 44 },
  { header: 'Escenario', key: 'exploitScenario', width: 55 },
  { header: 'Recomendación', key: 'recommendation', width: 55 },
  { header: 'OWASP', key: 'owasp', width: 38 },
];

// Header styling
const headerRow = ws.getRow(1);
headerRow.eachCell((cell) => {
  cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7B0000' } };
  cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  cell.border = { bottom: { style: 'thin', color: { argb: 'FFDDDDDD' } } };
});
headerRow.height = 28;

// Auto-filter
ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 11 } };

for (const f of FINDINGS) {
  const row = ws.addRow(f);
  const sev = f.severity;
  const color = SEVERITY_COLORS[sev] || 'FF888888';
  const bg = SEVERITY_BG[sev] || 'FFFFFFFF';

  const sevCell = row.getCell('severity');
  sevCell.font = { bold: true, color: { argb: color } };
  sevCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
  sevCell.alignment = { horizontal: 'center', vertical: 'middle' };

  const confCell = row.getCell('confidence');
  confCell.alignment = { horizontal: 'center', vertical: 'middle' };
  const confColor = f.confidence >= 9 ? 'FFFF4444' : f.confidence >= 8 ? 'FFFFA500' : 'FF888888';
  confCell.font = { bold: true, color: { argb: confColor } };
  [
    'id',
    'service',
    'category',
    'title',
    'description',
    'location',
    'exploitScenario',
    'recommendation',
    'owasp',
  ].forEach((key) => {
    const cell = row.getCell(key);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
    cell.alignment = { vertical: 'top', wrapText: true };
  });

  row.getCell('id').alignment = { horizontal: 'center', vertical: 'top' };
  row.height = 70;
}

// ── Resumen tab: add code-review row (positional, keys lost on read) ─
const resumen = wb.getWorksheet('Resumen');
if (resumen) {
  const highCount = FINDINGS.filter((f) => f.severity === 'HIGH').length;
  const mediumCount = FINDINGS.filter((f) => f.severity === 'MEDIUM').length;
  const lowCount = FINDINGS.filter((f) => f.severity === 'LOW').length;

  // Columns: Servicio, Crítico, Alto, Medio, Bajo, Info, Total (1-based)
  const crRow = resumen.addRow([
    'Revisión de Código (manual)',
    0,
    highCount,
    mediumCount,
    lowCount,
    0,
    FINDINGS.length,
  ]);
  crRow.getCell(3).font = { bold: true, color: { argb: 'FFFF4444' } };
  crRow.getCell(4).font = { bold: true, color: { argb: 'FFFFA500' } };
  crRow.height = 20;
}

await wb.xlsx.writeFile(outputPath);
console.log(`\nCode review sheet added — ${FINDINGS.length} findings`);
console.log(`  HIGH   : ${FINDINGS.filter((f) => f.severity === 'HIGH').length}`);
console.log(`  MEDIUM : ${FINDINGS.filter((f) => f.severity === 'MEDIUM').length}`);
console.log(`  LOW    : ${FINDINGS.filter((f) => f.severity === 'LOW').length}`);
console.log(`  Output : ${outputPath}`);
