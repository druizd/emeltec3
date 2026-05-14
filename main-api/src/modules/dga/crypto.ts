/**
 * Cifrado simétrico AES-256-GCM para credenciales DGA.
 * Formato almacenado: base64(iv || authTag || ciphertext).
 * iv 12 bytes, authTag 16 bytes.
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';
import { config } from '../../config/appConfig';
import { InternalError } from '../../shared/errors';

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const ALGO = 'aes-256-gcm';

function getKey(): Buffer {
  const raw = config.dga.encryptionKey;
  if (!raw) {
    throw new InternalError('DGA_ENCRYPTION_KEY no configurada', {
      code: 'DGA_KEY_MISSING',
    });
  }
  // Derivar 32 bytes desde la clave proporcionada (SHA-256). Permite usar
  // strings de longitud arbitraria como secret material sin imponer formato.
  return createHash('sha256').update(raw, 'utf8').digest();
}

export function encryptClave(plain: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptClave(stored: string): string {
  const key = getKey();
  const buf = Buffer.from(stored, 'base64');
  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new InternalError('Clave DGA corrupta o truncada', {
      code: 'DGA_KEY_CORRUPT',
    });
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const enc = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString('utf8');
}
