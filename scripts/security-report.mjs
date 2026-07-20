#!/usr/bin/env node
// Parses raw audit output from security-audit.sh and generates security-audit-YYYY-MM-DD.xlsx
import { createRequire } from 'module';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, basename } from 'path';

const require = createRequire(import.meta.url);
const ExcelJS = require('exceljs');

const [, , auditDir, outputPath] = process.argv;
if (!auditDir || !outputPath) {
  console.error('Usage: node security-report.mjs <audit-dir> <output.xlsx>');
  process.exit(1);
}

// ── Severity helpers ─────────────────────────────────────────────────
const SEVERITY_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
const SEVERITY_COLORS = {
  CRITICAL: 'FF7B0000',
  HIGH: 'FFFF4444',
  MEDIUM: 'FFFFA500',
  LOW: 'FFFFD700',
  INFO: 'FF90C978',
};
const SEVERITY_BG = {
  CRITICAL: 'FFFFF0F0',
  HIGH: 'FFFFF5F5',
  MEDIUM: 'FFFFF9F0',
  LOW: 'FFFFFFF0',
  INFO: 'FFF0FFF0',
};

function normSeverity(s = '') {
  s = s.toUpperCase();
  if (s === 'MODERATE') return 'MEDIUM';
  if (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'].includes(s)) return s;
  return 'INFO';
}

function readJson(path) {
  try {
    const text = readFileSync(path, 'utf8').trim();
    if (!text || text === '{}' || text === '') return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readLines(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean);
}

// ── Parsers ──────────────────────────────────────────────────────────

function parseNpmAudit(filePath, serviceName) {
  const data = readJson(filePath);
  if (!data) return [];
  const findings = [];

  // npm audit v7+ format
  if (data.vulnerabilities) {
    for (const [pkgName, vuln] of Object.entries(data.vulnerabilities)) {
      const vias = (vuln.via || []).filter((v) => typeof v === 'object');
      const source = vias[0] || {};
      findings.push({
        service: serviceName,
        category: 'Dependency (npm)',
        severity: normSeverity(vuln.severity || source.severity || 'INFO'),
        title: source.title || `Vulnerability in ${pkgName}`,
        description: source.url
          ? `${source.title || ''} — Range: ${vuln.range || 'unknown'}`
          : `Affected range: ${vuln.range || 'unknown'}`,
        location: `${serviceName}/package.json`,
        package: pkgName,
        reference: source.url || '',
        fixAvailable:
          vuln.fixAvailable === true
            ? 'Yes'
            : vuln.fixAvailable && vuln.fixAvailable.name
              ? `Yes → ${vuln.fixAvailable.name}@${vuln.fixAvailable.version}`
              : 'No',
        recommendation: vuln.fixAvailable
          ? 'Run: npm audit fix'
          : 'Review manually — no automatic fix available',
      });
    }
  }

  // pnpm audit format (advisories map)
  if (data.advisories) {
    for (const adv of Object.values(data.advisories)) {
      findings.push({
        service: serviceName,
        category: 'Dependency (npm)',
        severity: normSeverity(adv.severity || 'INFO'),
        title: adv.title || `Advisory in ${adv.module_name}`,
        description: adv.overview || adv.recommendation || '',
        location: `${serviceName}/package.json`,
        package: adv.module_name || '',
        reference: adv.url || '',
        fixAvailable: adv.patched_versions && adv.patched_versions !== '<0.0.0' ? 'Yes' : 'No',
        recommendation: adv.recommendation || 'Update to patched version',
      });
    }
  }

  return findings;
}

function parseCargoAudit(filePath, serviceName) {
  const data = readJson(filePath);
  if (!data?.vulnerabilities?.list) return [];

  return data.vulnerabilities.list.map((item) => {
    const adv = item.advisory || {};
    const pkg = item.package || {};
    return {
      service: serviceName,
      category: 'Dependency (Rust)',
      severity: normSeverity(adv.severity || 'HIGH'),
      title: adv.title || `${adv.id} in ${pkg.name}`,
      description: adv.description || '',
      location: `${serviceName}/Cargo.toml`,
      package: `${pkg.name}@${pkg.version}`,
      reference: adv.url || (adv.id ? `https://rustsec.org/advisories/${adv.id}.html` : ''),
      fixAvailable: item.versions?.patched?.length > 0 ? `Yes → ${item.versions.patched[0]}` : 'No',
      recommendation: item.versions?.patched?.length
        ? `Update to ${item.versions.patched[0]}`
        : 'Review RustSec advisory',
    };
  });
}

function parseGovulncheck(filePath, moduleName) {
  const lines = readLines(filePath);
  const findings = [];
  const osvMap = {};

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.osv) {
        osvMap[obj.osv.id] = obj.osv;
      }
      if (obj.finding) {
        const osv = osvMap[obj.finding.osv] || {};
        const trace = obj.finding.trace || [];
        const pkgInfo = trace[0] || {};
        findings.push({
          service: moduleName,
          category: 'Dependency (Go)',
          severity: 'HIGH',
          title: osv.summary || obj.finding.osv,
          description: (osv.details || '').substring(0, 300),
          location: `${moduleName}/go.mod`,
          package: `${pkgInfo.module || ''}@${pkgInfo.version || 'unknown'}`,
          reference: osv.id
            ? `https://pkg.go.dev/vuln/${osv.id}`
            : osv.aliases?.[0]
              ? `https://nvd.nist.gov/vuln/detail/${osv.aliases[0]}`
              : '',
          fixAvailable: obj.finding.fixed_version ? `Yes → ${obj.finding.fixed_version}` : 'No',
          recommendation: obj.finding.fixed_version
            ? `go get module@${obj.finding.fixed_version}`
            : 'Review Go vulnerability database',
        });
      }
    } catch {
      /* skip malformed lines */
    }
  }

  return findings;
}

function parseSecrets(filePath) {
  return readLines(filePath).map((line, i) => {
    const colonIdx = line.indexOf(':');
    const fileAndLine = colonIdx > 0 ? line.substring(0, line.indexOf(':', colonIdx + 1)) : line;
    const content = line.substring(fileAndLine.length + 1);
    return {
      service: fileAndLine.split('/')[0] || 'unknown',
      category: 'Hardcoded Secret',
      severity: 'HIGH',
      title: 'Potential hardcoded credential',
      description: content.substring(0, 200),
      location: fileAndLine,
      package: '',
      reference: 'OWASP A02:2021 — Cryptographic Failures',
      fixAvailable: 'Manual',
      recommendation:
        'Move to environment variable or secret manager. Rotate if already committed.',
    };
  });
}

function parseTextFindings(filePath, defaultCategory) {
  return readLines(filePath).map((line) => {
    const [type, location, description] = line.split('|');
    const service = (location || '').split('/')[0] || 'infra';

    const severityMap = {
      ROOT_USER: 'HIGH',
      ENV_SECRET: 'CRITICAL',
      ARG_SECRET: 'HIGH',
      LATEST_TAG: 'LOW',
      ADD_USED: 'LOW',
      MISSING_HEADER: 'MEDIUM',
      JS_PATTERN: 'MEDIUM',
      SQL_INJECT: 'HIGH',
      SQL_INJECT_GO: 'HIGH',
    };
    const titleMap = {
      ROOT_USER: 'Container runs as root',
      ENV_SECRET: 'Secret potentially hardcoded in Docker ENV',
      ARG_SECRET: 'Secret passed via Docker ARG (visible in layers)',
      LATEST_TAG: 'Docker image uses :latest tag',
      ADD_USED: 'Dockerfile uses ADD instead of COPY',
      MISSING_HEADER: 'Missing HTTP security header',
      JS_PATTERN: 'Dangerous JavaScript pattern',
      SQL_INJECT: 'Possible SQL injection',
      SQL_INJECT_GO: 'Possible SQL injection (Go)',
      ENV_VALUE: 'Variable with real value in .env file',
    };
    const recMap = {
      ROOT_USER: 'Add USER instruction with non-root UID (e.g. USER 1001)',
      ENV_SECRET: 'Use Docker secrets or runtime env vars — never bake secrets into image',
      ARG_SECRET: 'Use Docker BuildKit secrets (--secret) instead of ARG',
      LATEST_TAG: 'Pin to a specific image digest or semver tag',
      ADD_USED: 'Replace ADD with COPY unless tar auto-extraction is needed',
      MISSING_HEADER: 'Add the header in the nginx server block',
      JS_PATTERN: 'Review usage — ensure input is sanitized',
      SQL_INJECT: 'Use parameterized queries or an ORM',
      SQL_INJECT_GO: 'Use db.QueryContext with $1 placeholders instead of fmt.Sprintf',
      ENV_VALUE:
        'Verify this variable is not committed to git. Store secrets in a vault or CI/CD secret store.',
    };

    return {
      service,
      category: defaultCategory,
      severity: severityMap[type] || 'MEDIUM',
      title: titleMap[type] || type,
      description: description || '',
      location: location || '',
      package: '',
      reference: '',
      fixAvailable: 'Manual',
      recommendation: recMap[type] || 'Review and remediate',
    };
  });
}

// ── Collect all findings ──────────────────────────────────────────────
const allFindings = [];

const files = existsSync(auditDir) ? readdirSync(auditDir) : [];

for (const file of files) {
  const path = join(auditDir, file);

  if (file.startsWith('npm-') && file.endsWith('.json')) {
    const svc = basename(file, '.json').replace(/^npm-/, '');
    allFindings.push(...parseNpmAudit(path, svc));
  } else if (file.startsWith('cargo-') && file.endsWith('.json')) {
    const svc = basename(file, '.json').replace(/^cargo-/, '');
    allFindings.push(...parseCargoAudit(path, svc));
  } else if (file.startsWith('go-') && file.endsWith('.ndjson')) {
    const mod = basename(file, '.ndjson').replace(/^go-/, '');
    allFindings.push(...parseGovulncheck(path, mod));
  }
}

allFindings.push(...parseSecrets(join(auditDir, 'secrets.txt')));
allFindings.push(...parseTextFindings(join(auditDir, 'env-scan.txt'), '.env Files'));
allFindings.push(...parseTextFindings(join(auditDir, 'docker.txt'), 'Docker Security'));
allFindings.push(...parseTextFindings(join(auditDir, 'nginx.txt'), 'nginx / Headers'));
allFindings.push(...parseTextFindings(join(auditDir, 'code-patterns.txt'), 'Code Pattern'));

// Sort by severity
allFindings.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 5) - (SEVERITY_ORDER[b.severity] ?? 5));

// ── Build Excel ───────────────────────────────────────────────────────
const wb = new ExcelJS.Workbook();
wb.creator = 'Emeltec Security Audit';
wb.created = new Date();

// ── Helpers ──────────────────────────────────────────────────────────

function styleHeader(row, bgArgb = 'FF1F497D') {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FFDDDDDD' } },
    };
  });
  row.height = 28;
}

function severityCell(cell, severity) {
  const color = SEVERITY_COLORS[severity] || 'FF888888';
  const bg = SEVERITY_BG[severity] || 'FFFFFFFF';
  cell.font = { bold: true, color: { argb: color } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
}

function addAutoFilter(sheet) {
  const lastCol = sheet.columnCount;
  const firstRow = 1;
  sheet.autoFilter = {
    from: { row: firstRow, column: 1 },
    to: { row: firstRow, column: lastCol },
  };
}

// ── Sheet 1: Resumen ─────────────────────────────────────────────────
{
  const ws = wb.addWorksheet('Resumen');
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  ws.columns = [
    { header: 'Servicio', key: 'service', width: 28 },
    { header: 'Crítico', key: 'critical', width: 12 },
    { header: 'Alto', key: 'high', width: 12 },
    { header: 'Medio', key: 'medium', width: 12 },
    { header: 'Bajo', key: 'low', width: 12 },
    { header: 'Info', key: 'info', width: 12 },
    { header: 'Total', key: 'total', width: 12 },
  ];

  styleHeader(ws.getRow(1), 'FF1F497D');

  const byService = {};
  for (const f of allFindings) {
    if (!byService[f.service])
      byService[f.service] = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
    byService[f.service][f.severity] = (byService[f.service][f.severity] || 0) + 1;
  }

  for (const [svc, counts] of Object.entries(byService)) {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const row = ws.addRow({
      service: svc,
      critical: counts.CRITICAL || 0,
      high: counts.HIGH || 0,
      medium: counts.MEDIUM || 0,
      low: counts.LOW || 0,
      info: counts.INFO || 0,
      total,
    });
    row.getCell('critical').font = { bold: true, color: { argb: SEVERITY_COLORS.CRITICAL } };
    row.getCell('high').font = { bold: true, color: { argb: SEVERITY_COLORS.HIGH } };
    row.getCell('total').font = { bold: true };
    row.height = 20;
  }

  // Totals row
  if (Object.keys(byService).length > 0) {
    const totRow = ws.addRow({
      service: 'TOTAL',
      critical: allFindings.filter((f) => f.severity === 'CRITICAL').length,
      high: allFindings.filter((f) => f.severity === 'HIGH').length,
      medium: allFindings.filter((f) => f.severity === 'MEDIUM').length,
      low: allFindings.filter((f) => f.severity === 'LOW').length,
      info: allFindings.filter((f) => f.severity === 'INFO').length,
      total: allFindings.length,
    });
    totRow.font = { bold: true };
    totRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0F0' } };
    totRow.height = 22;
  }
}

// ── Sheet 2: Hallazgos ───────────────────────────────────────────────
{
  const ws = wb.addWorksheet('Hallazgos');
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  ws.columns = [
    { header: '#', key: 'id', width: 6 },
    { header: 'Servicio', key: 'service', width: 22 },
    { header: 'Categoría', key: 'category', width: 22 },
    { header: 'Severidad', key: 'severity', width: 13 },
    { header: 'Título', key: 'title', width: 38 },
    { header: 'Descripción', key: 'description', width: 50 },
    { header: 'Ubicación', key: 'location', width: 38 },
    { header: 'Paquete', key: 'package', width: 25 },
    { header: 'Referencia', key: 'reference', width: 35 },
    { header: 'Fix Disponible', key: 'fixAvailable', width: 22 },
    { header: 'Recomendación', key: 'recommendation', width: 50 },
  ];

  styleHeader(ws.getRow(1));
  addAutoFilter(ws);

  allFindings.forEach((f, idx) => {
    const row = ws.addRow({
      id: idx + 1,
      service: f.service,
      category: f.category,
      severity: f.severity,
      title: f.title,
      description: f.description,
      location: f.location,
      package: f.package,
      reference: f.reference,
      fixAvailable: f.fixAvailable,
      recommendation: f.recommendation,
    });

    severityCell(row.getCell('severity'), f.severity);

    const bg = SEVERITY_BG[f.severity] || 'FFFFFFFF';
    [
      'service',
      'category',
      'title',
      'description',
      'location',
      'package',
      'reference',
      'fixAvailable',
      'recommendation',
    ].forEach((key) => {
      const cell = row.getCell(key);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      cell.alignment = { vertical: 'top', wrapText: true };
    });

    row.getCell('id').alignment = { horizontal: 'center', vertical: 'top' };
    row.height = 40;
  });
}

// ── Sheet 3: Dependencias ────────────────────────────────────────────
{
  const deps = allFindings.filter((f) =>
    ['Dependency (npm)', 'Dependency (Rust)', 'Dependency (Go)'].includes(f.category),
  );

  const ws = wb.addWorksheet('Dependencias');
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.columns = [
    { header: 'Servicio', key: 'service', width: 22 },
    { header: 'Ecosistema', key: 'category', width: 18 },
    { header: 'Severidad', key: 'severity', width: 13 },
    { header: 'Paquete', key: 'package', width: 30 },
    { header: 'Título', key: 'title', width: 40 },
    { header: 'Referencia', key: 'reference', width: 40 },
    { header: 'Fix Disponible', key: 'fixAvailable', width: 30 },
  ];
  styleHeader(ws.getRow(1), 'FF2E4057');
  addAutoFilter(ws);

  deps.forEach((f) => {
    const row = ws.addRow(f);
    severityCell(row.getCell('severity'), f.severity);
    row.height = 22;
  });
}

// ── Sheet 4: Secretos ────────────────────────────────────────────────
{
  const secrets = allFindings.filter((f) => f.category === 'Hardcoded Secret');

  const ws = wb.addWorksheet('Secretos');
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.columns = [
    { header: 'Ubicación', key: 'location', width: 50 },
    { header: 'Contenido', key: 'description', width: 60 },
    { header: 'Severidad', key: 'severity', width: 13 },
    { header: 'Recomendación', key: 'recommendation', width: 50 },
  ];
  styleHeader(ws.getRow(1), 'FF7B0000');
  addAutoFilter(ws);

  secrets.forEach((f) => {
    const row = ws.addRow({
      location: f.location,
      description: f.description,
      severity: f.severity,
      recommendation: f.recommendation,
    });
    severityCell(row.getCell('severity'), f.severity);
    row.getCell('description').alignment = { wrapText: true, vertical: 'top' };
    row.height = 35;
  });
}

// ── Sheet 5: Docker & Infra ──────────────────────────────────────────
{
  const infra = allFindings.filter((f) =>
    ['Docker Security', 'nginx / Headers'].includes(f.category),
  );

  const ws = wb.addWorksheet('Docker e Infra');
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.columns = [
    { header: 'Categoría', key: 'category', width: 20 },
    { header: 'Severidad', key: 'severity', width: 13 },
    { header: 'Título', key: 'title', width: 35 },
    { header: 'Ubicación', key: 'location', width: 40 },
    { header: 'Detalle', key: 'description', width: 50 },
    { header: 'Recomendación', key: 'recommendation', width: 50 },
  ];
  styleHeader(ws.getRow(1), 'FF0D47A1');
  addAutoFilter(ws);

  infra.forEach((f) => {
    const row = ws.addRow(f);
    severityCell(row.getCell('severity'), f.severity);
    row.getCell('description').alignment = { wrapText: true, vertical: 'top' };
    row.getCell('recommendation').alignment = { wrapText: true, vertical: 'top' };
    row.height = 35;
  });
}

// ── Sheet 6: Código ──────────────────────────────────────────────────
{
  const code = allFindings.filter((f) => f.category === 'Code Pattern');

  const ws = wb.addWorksheet('Código');
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.columns = [
    { header: 'Severidad', key: 'severity', width: 13 },
    { header: 'Título', key: 'title', width: 30 },
    { header: 'Ubicación', key: 'location', width: 60 },
    { header: 'Detalle', key: 'description', width: 60 },
    { header: 'Recomendación', key: 'recommendation', width: 50 },
  ];
  styleHeader(ws.getRow(1), 'FF4A148C');
  addAutoFilter(ws);

  code.forEach((f) => {
    const row = ws.addRow(f);
    severityCell(row.getCell('severity'), f.severity);
    row.getCell('location').alignment = { wrapText: true, vertical: 'top' };
    row.height = 30;
  });
}

// ── Save ─────────────────────────────────────────────────────────────
await wb.xlsx.writeFile(outputPath);

const counts = {
  critical: allFindings.filter((f) => f.severity === 'CRITICAL').length,
  high: allFindings.filter((f) => f.severity === 'HIGH').length,
  medium: allFindings.filter((f) => f.severity === 'MEDIUM').length,
  low: allFindings.filter((f) => f.severity === 'LOW').length,
};

console.log(`\nSecurity Report — ${new Date().toISOString().split('T')[0]}`);
console.log(`  Total findings : ${allFindings.length}`);
console.log(`  Critical       : ${counts.critical}`);
console.log(`  High           : ${counts.high}`);
console.log(`  Medium         : ${counts.medium}`);
console.log(`  Low            : ${counts.low}`);
console.log(`  Output         : ${outputPath}`);
