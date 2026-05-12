/**
 * Servicio de auth: login (OTP o password) + requestCode.
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../../config/appConfig';
import { UnauthorizedError, ValidationError, ForbiddenError } from '../../shared/errors';
import {
  consumeOtpIfMatches,
  findUserByEmail,
  findUserPublicByEmail,
  storeOtp,
  verifyPassword,
} from './repo';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const emailMod = require('../../services/emailService.js') as {
  sendWelcomeEmail: (
    email: string,
    nombre: string,
    otp: string,
    minutes?: number,
  ) => Promise<{ previewUrl?: string | null }>;
};
const { sendWelcomeEmail } = emailMod;

const DEFAULT_OTP_MINS = 30;
const MAX_OTP_MINS = 1440;

export interface LoginResult {
  token: string;
  user: {
    nombre: string;
    email: string;
    tipo: string;
    empresa_id: string | null;
    sub_empresa_id: string | null;
  };
}

export async function login(emailInput: string, password: string): Promise<LoginResult> {
  if (!emailInput || !password) {
    throw new ValidationError('Email y password son requeridos');
  }
  const user = await findUserByEmail(emailInput);
  if (!user) throw new UnauthorizedError('Credenciales inválidas');

  let authenticated = false;

  // 1) Intentar OTP (Redis o columna).
  if (user.otp_hash) {
    if (await consumeOtpIfMatches(emailInput, password)) authenticated = true;
  } else {
    // Cache puede tener OTP aunque la columna esté limpia (sembrado solo en Redis).
    if (await consumeOtpIfMatches(emailInput, password)) authenticated = true;
  }

  // 2) Si no, password fija.
  if (!authenticated && user.password_hash) {
    if (await verifyPassword(password, user.password_hash)) authenticated = true;
  }

  if (!authenticated) throw new UnauthorizedError('Credenciales inválidas');

  const payload = {
    id: user.id,
    email: user.email,
    tipo: user.tipo,
    empresa_id: user.empresa_id,
    sub_empresa_id: user.sub_empresa_id,
  };
  const token = jwt.sign(payload, config.auth.jwtSecret, { expiresIn: '12h' });

  return {
    token,
    user: {
      nombre: user.nombre,
      email: user.email,
      tipo: user.tipo,
      empresa_id: user.empresa_id,
      sub_empresa_id: user.sub_empresa_id,
    },
  };
}

export interface RequestCodeResult {
  message: string;
  expires_at: string;
  previewUrl: string | null;
}

export async function requestCode(
  emailInput: string,
  expiresMinutesInput?: number,
): Promise<RequestCodeResult> {
  if (!emailInput) throw new ValidationError('El correo es requerido');

  let minutes = Number(expiresMinutesInput) || DEFAULT_OTP_MINS;
  if (minutes < 1) minutes = DEFAULT_OTP_MINS;
  if (minutes > MAX_OTP_MINS) minutes = MAX_OTP_MINS;

  const user = await findUserPublicByEmail(emailInput);
  if (!user) {
    throw new ForbiddenError(
      'Este correo no ha sido autorizado en el sistema. Contacte a su administrador.',
    );
  }

  const otpCode = crypto.randomBytes(3).toString('hex').toUpperCase();
  const expiresAt = await storeOtp(emailInput, otpCode, minutes);
  const emailInfo = await sendWelcomeEmail(emailInput, user.nombre, otpCode);

  return {
    message: `Código enviado exitosamente. Válido por ${minutes} minutos.`,
    expires_at: expiresAt.toISOString(),
    previewUrl: emailInfo.previewUrl ?? null,
  };
}
