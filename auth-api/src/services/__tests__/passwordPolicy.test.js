const test = require('node:test');
const assert = require('node:assert/strict');

const { scorePassword, validateNewPassword, MIN_LENGTH } = require('../passwordPolicy');

test('scorePassword: vacia o nula puntua 0', () => {
  assert.equal(scorePassword(''), 0);
  assert.equal(scorePassword(null), 0);
  assert.equal(scorePassword(undefined), 0);
});

test('scorePassword: solo longitud suma 1', () => {
  assert.equal(scorePassword('aaaaaaaa'), 1);
});

test('scorePassword: mayus+minus, digito y simbolo suman', () => {
  assert.equal(scorePassword('aaaaAAAA'), 2);
  assert.equal(scorePassword('aaaaAAA1'), 3);
  assert.equal(scorePassword('aaaAAA1!'), 4);
});

test('scorePassword: 12+ caracteres empuja un punto extra sin pasar de 4', () => {
  assert.equal(scorePassword('aaaaaaaaaaaa'), 2);
  assert.equal(scorePassword('aaaAAA1!aaaa'), 4);
});

test('validateNewPassword: rechaza por longitud antes que por fuerza', () => {
  const res = validateNewPassword('Ab1!');
  assert.equal(res.ok, false);
  assert.match(res.error, new RegExp(`${MIN_LENGTH} caracteres`));
});

test('validateNewPassword: rechaza una contrasena larga pero debil', () => {
  const res = validateNewPassword('aaaaaaaaaa');
  assert.equal(res.ok, false);
  assert.match(res.error, /debil/);
});

test('validateNewPassword: acepta al alcanzar el umbral de fuerza', () => {
  assert.deepEqual(validateNewPassword('Emeltec2026!'), { ok: true });
  assert.deepEqual(validateNewPassword('Emeltec1'), { ok: true });
});

test('validateNewPassword: "emeltec1" queda corta con umbral 3', () => {
  // Solo suma longitud + digito.
  assert.equal(validateNewPassword('emeltec1').ok, false);
});

test('validateNewPassword: 12345678 ya no pasa', () => {
  // Antes el backend solo exigia longitud >= 8, asi que este valor entraba.
  const res = validateNewPassword('12345678');
  assert.equal(res.ok, false);
  assert.match(res.error, /solo numeros/);
});

test('validateNewPassword: rechaza cualquier cadena de puros digitos', () => {
  assert.equal(validateNewPassword('9182736455').ok, false);
});
