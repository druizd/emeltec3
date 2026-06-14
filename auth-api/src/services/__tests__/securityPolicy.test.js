/**
 * Tests de la política de seguridad (lockout + OTP). Runner nativo de Node.
 * Ejecutar: npm test  (node --test)
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  lockoutDurationMs,
  evaluateLock,
  remainingLockMinutes,
  clampOtpMinutes,
  LOCKOUT_THRESHOLD,
} = require('../securityPolicy');

test('lockoutDurationMs: sin bloqueo bajo el umbral', () => {
  assert.equal(lockoutDurationMs(0), 0);
  assert.equal(lockoutDurationMs(LOCKOUT_THRESHOLD - 1), 0);
});

test('lockoutDurationMs: backoff exponencial desde el umbral', () => {
  assert.equal(lockoutDurationMs(5), 15 * 60 * 1000); // 15 min
  assert.equal(lockoutDurationMs(6), 30 * 60 * 1000); // 30 min
  assert.equal(lockoutDurationMs(7), 60 * 60 * 1000); // 1 h
  assert.equal(lockoutDurationMs(8), 2 * 60 * 60 * 1000); // 2 h
});

test('lockoutDurationMs: tope máximo de 4 h', () => {
  assert.equal(lockoutDurationMs(100), 4 * 60 * 60 * 1000);
});

test('evaluateLock: sin locked_until → no bloqueado', () => {
  assert.deepEqual(evaluateLock(null), { locked: false, expired: false, remainingMs: 0 });
});

test('evaluateLock: lock activo NO se recorta (regresión EMT-H08)', () => {
  const now = 1_000_000_000;
  const r = evaluateLock(new Date(now + 60 * 60 * 1000), now); // 1 h al futuro
  assert.equal(r.locked, true);
  // El bug viejo recortaba esto a 60s; ahora debe ser la hora completa.
  assert.equal(r.remainingMs, 60 * 60 * 1000);
});

test('evaluateLock: lock expirado', () => {
  const now = 1_000_000_000;
  const r = evaluateLock(new Date(now - 1000), now);
  assert.equal(r.locked, false);
  assert.equal(r.expired, true);
});

test('remainingLockMinutes: redondea hacia arriba, mínimo 1', () => {
  assert.equal(remainingLockMinutes(0), 1);
  assert.equal(remainingLockMinutes(61 * 1000), 2);
  assert.equal(remainingLockMinutes(15 * 60 * 1000), 15);
});

test('clampOtpMinutes: default, mínimo y tope', () => {
  assert.equal(clampOtpMinutes(undefined), 10);
  assert.equal(clampOtpMinutes('abc'), 10);
  assert.equal(clampOtpMinutes(0), 10);
  assert.equal(clampOtpMinutes(-5), 10);
  assert.equal(clampOtpMinutes(5), 5);
  assert.equal(clampOtpMinutes(15), 15);
  assert.equal(clampOtpMinutes(1440), 15); // antes permitía 24h (EMT-H09)
  assert.equal(clampOtpMinutes(9999), 15);
});
