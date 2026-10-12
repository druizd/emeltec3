/**
 * Servicio de auth: login (OTP o password) + requestCode.
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../../config/appConfig';
import { UnauthorizedError, ValidationError, ForbiddenError } from '../../shared/errors';
import { VIEW_AS_ROLES, VIEW_AS_TTL_SECONDS, VIEW_AS_USER_ID } from '../../services/actAs';
import {
  consumeOtpIfMatches,
  findEmpresaById,
  findSubEmpresaById,
  findUserByEmail,
  findUserTipoActivoById,
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

export type ViewAsRole = 'Admin' | 'Gerente' | 'Cliente' | 'Vendedor';

export interface ViewAsInput {
  role: ViewAsRole;
  empresa_id?: string | null | undefined;
  sub_empresa_id?: string | null | undefined;
}

export interface ViewAsResult {
  token: string;
  expires_in: number;
  expires_at: string;
  view_as: {
    tipo: ViewAsRole;
    empresa_id: string | null;
    sub_empresa_id: string | null;
  };
}

/**
 * Emite un token "ver como" de SOLO LECTURA para un SuperAdmin real.
 *
 * Alcance (mismas reglas que `shared/permissions.ts` y `services/dataAccess.js`):
 *  - Admin: toda la empresa; `sub_empresa_id` se ignora (queda null).
 *  - Gerente/Cliente: `sub_empresa_id` opcional; sin ella ven toda la empresa.
 *  - Vendedor: su alcance no depende de la empresa sino de maletas piloto y de
 *    `usuario_sitio` del propio usuario. El token no lleva el id del SuperAdmin
 *    (ver `VIEW_AS_USER_ID`), así que ve solo las maletas piloto; `empresa_id`
 *    es opcional.
 */
export async function issueViewAsToken(
  actor: { id?: string | number; email?: string; tipo?: string },
  isActAs: boolean,
  input: ViewAsInput,
): Promise<ViewAsResult> {
  // Un token "ver como" nunca emite otro (sin encadenar), aunque su `tipo`
  // fuese SuperAdmin.
  if (isActAs || actor.tipo !== 'SuperAdmin' || !actor.id) {
    throw new ForbiddenError('Solo un SuperAdmin puede usar "ver como".');
  }

  // El `tipo` del JWT puede estar viejo: un SuperAdmin degradado o desactivado
  // seguiría emitiendo mientras viva su sesión. Se contrasta con la base y, si la
  // consulta falla, el error se propaga y no se emite nada (falla cerrado).
  const real = await findUserTipoActivoById(String(actor.id));
  if (!real || real.tipo !== 'SuperAdmin' || real.activo === false) {
    throw new ForbiddenError('Solo un SuperAdmin puede usar "ver como".');
  }

  const { role } = input;
  if (!VIEW_AS_ROLES.includes(role)) {
    throw new ValidationError('Rol inválido para "ver como"');
  }

  const empresaId = input.empresa_id ? input.empresa_id : null;
  const subEmpresaId = role === 'Admin' || !input.sub_empresa_id ? null : input.sub_empresa_id;

  if (!empresaId && role !== 'Vendedor') {
    throw new ValidationError('empresa_id es requerido para este rol');
  }
  if (!empresaId && input.sub_empresa_id) {
    throw new ValidationError('sub_empresa_id requiere empresa_id');
  }
  if (empresaId && !(await findEmpresaById(empresaId))) {
    throw new ValidationError('La empresa no existe');
  }
  if (subEmpresaId) {
    const sub = await findSubEmpresaById(subEmpresaId);
    if (!sub || sub.empresa_id !== empresaId) {
      throw new ValidationError('La sub-empresa no existe o no pertenece a la empresa');
    }
  }

  const payload = {
    id: VIEW_AS_USER_ID,
    email: actor.email,
    tipo: role,
    empresa_id: empresaId,
    sub_empresa_id: subEmpresaId,
    act_as: true,
    real_sub: String(actor.id),
  };
  const token = jwt.sign(payload, config.auth.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: VIEW_AS_TTL_SECONDS,
  });

  return {
    token,
    expires_in: VIEW_AS_TTL_SECONDS,
    expires_at: new Date(Date.now() + VIEW_AS_TTL_SECONDS * 1000).toISOString(),
    view_as: { tipo: role, empresa_id: empresaId, sub_empresa_id: subEmpresaId },
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
