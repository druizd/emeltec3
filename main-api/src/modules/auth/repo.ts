/**
 * Repositorio de auth: usuario + OTP (columna legacy + Redis).
 */
import bcrypt from 'bcrypt';
import { query, transaction } from '../../config/db';
import { cache } from '../../config/redis';
import { config } from '../../config/env';

const OTP_REDIS_PREFIX = 'otp:';
const SALT_ROUNDS = 10;

export interface UserRow {
  id: string;
  nombre: string;
  apellido?: string | null;
  email: string;
  tipo: string;
  empresa_id: string | null;
  sub_empresa_id: string | null;
  password_hash: string | null;
  otp_hash: string | null;
  otp_expires_at: string | Date | null;
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const r = await query<UserRow>(
    `SELECT id, nombre, email, tipo, empresa_id, sub_empresa_id,
            password_hash, otp_hash, otp_expires_at
     FROM usuario WHERE email = $1`,
    [email],
    { name: 'auth__user_by_email' },
  );
  return r.rows[0] ?? null;
}

export async function findUserPublicByEmail(email: string): Promise<
  | {
      id: string;
      nombre: string;
      email: string;
    }
  | null
> {
  const r = await query<{ id: string; nombre: string; email: string }>(
    `SELECT id, nombre, email FROM usuario WHERE email = $1`,
    [email],
    { name: 'auth__user_public_by_email' },
  );
  return r.rows[0] ?? null;
}

export async function storeOtp(email: string, plainCode: string, ttlMinutes: number): Promise<Date> {
  const otpHash = await bcrypt.hash(plainCode, SALT_ROUNDS);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);

  // Dual-write: Redis (rápido + auto-expiración) + columna (compat con legacy).
  if (cache.enabled) {
    await cache.set(`${OTP_REDIS_PREFIX}${email}`, otpHash, ttlMinutes * 60);
  }
  await query(
    `UPDATE usuario SET otp_hash = $1, otp_expires_at = $2 WHERE email = $3`,
    [otpHash, expiresAt, email],
    { name: 'auth__store_otp' },
  );
  return expiresAt;
}

/** Devuelve true si el código coincide y borra el OTP usado. */
export async function consumeOtpIfMatches(email: string, plainCode: string): Promise<boolean> {
  let candidateHash: string | null = null;

  if (cache.enabled) {
    candidateHash = await cache.get(`${OTP_REDIS_PREFIX}${email}`);
  }

  if (!candidateHash) {
    const row = await query<{ otp_hash: string | null; otp_expires_at: Date | null }>(
      `SELECT otp_hash, otp_expires_at FROM usuario WHERE email = $1`,
      [email],
      { name: 'auth__read_otp' },
    );
    const r = row.rows[0];
    if (!r?.otp_hash) return false;
    if (r.otp_expires_at && new Date() > new Date(r.otp_expires_at)) return false;
    candidateHash = r.otp_hash;
  }

  const matches = await bcrypt.compare(plainCode, candidateHash);
  if (!matches) return false;

  // Limpia ambos lados.
  await transaction(async (client) => {
    await client.query(
      `UPDATE usuario SET otp_hash = NULL, otp_expires_at = NULL WHERE email = $1`,
      [email],
    );
  });
  if (cache.enabled) {
    await cache.del(`${OTP_REDIS_PREFIX}${email}`);
  }
  return true;
}

export async function verifyPassword(plain: string, hash: string | null): Promise<boolean> {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}

export const _internals = {
  jwtSecret: () => config.auth.jwtSecret,
  otpRedisPrefix: OTP_REDIS_PREFIX,
};
