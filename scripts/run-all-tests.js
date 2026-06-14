#!/usr/bin/env node
/**
 * Corre TODAS las suites de test del monorepo y da un resumen consolidado.
 *
 *   node scripts/run-all-tests.js
 *
 * Cada paquete usa su propio runner (main-api → vitest, auth-api → node:test).
 * El script los ejecuta, muestra los archivos de test y totaliza pass/fail.
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const SUITES = [
  { name: 'main-api', runner: 'vitest', cmd: 'npx', args: ['vitest', 'run'] },
  { name: 'auth-api', runner: 'node:test', cmd: 'node', args: ['--test'] },
];

function parseCounts(output) {
  const clean = output.replace(/\[[0-9;]*m/g, ''); // quita códigos ANSI
  let passed = null;
  let failed = 0;
  // vitest: "Tests  91 passed (91)"  (número ANTES de "passed")
  const v = clean.match(/Tests\s+(?:(\d+)\s+failed[^\n]*?)?(\d+)\s+passed/i);
  if (v) {
    passed = Number(v[2]);
    failed = v[1] ? Number(v[1]) : 0;
  } else {
    // node:test: "# pass 8" / "ℹ pass 8"  (número DESPUÉS de "pass")
    const p = clean.match(/(?:#|ℹ)\s*pass\s+(\d+)/i);
    const f = clean.match(/(?:#|ℹ)\s*fail\s+(\d+)/i);
    if (p) passed = Number(p[1]);
    if (f) failed = Number(f[1]);
  }
  return { passed, failed };
}

function listTestFiles(output) {
  return [...output.matchAll(/([^\s]+\.test\.[tj]s)/g)].map((m) => m[1]);
}

console.log('═'.repeat(64));
console.log('  Suite de tests — Emeltec Cloud');
console.log('═'.repeat(64));

let totalPass = 0;
let totalFail = 0;
let anyError = false;

for (const s of SUITES) {
  const cwd = path.join(ROOT, s.name);
  const res = spawnSync(s.cmd, s.args, { cwd, encoding: 'utf8', shell: true });
  const out = (res.stdout || '') + (res.stderr || '');
  const { passed, failed } = parseCounts(out);
  const files = [...new Set(listTestFiles(out))];

  console.log(`\n▸ ${s.name}  (${s.runner})`);
  if (files.length) files.forEach((f) => console.log(`    • ${f}`));
  console.log(
    `    → ${passed ?? '?'} pasados, ${failed} fallidos` +
      (res.status !== 0 ? '  [EXIT ' + res.status + ']' : ''),
  );

  totalPass += passed || 0;
  totalFail += failed || 0;
  if (res.status !== 0 || failed > 0) anyError = true;
}

console.log('\n' + '─'.repeat(64));
console.log(`  TOTAL: ${totalPass} pasados · ${totalFail} fallidos`);
console.log('─'.repeat(64));
console.log('\n  Cobertura actual: lógica de control de acceso (dataAccess), política');
console.log('  de auth (lockout/OTP) y módulos DGA. NO cubre rutas/controladores');
console.log('  end-to-end (requeriría tests de integración con BD).');

process.exit(anyError ? 1 : 0);
