/**
 * Tests de las plantillas de correo del ciclo de contraseña.
 *
 * Sin RESEND_API_KEY, `enviar()` entra en modo simulado y loguea destinatario,
 * asunto y cuerpo de texto. Se captura ese log en vez de mockear el módulo
 * `resend`: emailService lo carga con `require` (CommonJS) y `vi.mock` no
 * intercepta ahí — al intentarlo, se cargaba el SDK real y salían llamadas de
 * red con una llave inválida.
 *
 * Alcance: cubre asunto y cuerpo de texto. El HTML no pasa por el log, así que
 * no se verifica acá.
 *
 * Lo que se protege: antes TODO OTP salía por `sendWelcomeEmail` ("Tu código de
 * acceso"), así que un restablecimiento llegaba como correo de login y la nota
 * de seguridad apuntaba al evento equivocado.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import emailService from '../emailService';

// vi.hoisted corre ANTES de los imports, que es lo que hace falta: emailService
// lee RESEND_API_KEY al cargar el módulo.
vi.hoisted(() => {
  delete process.env.RESEND_API_KEY;
  process.env.NODE_ENV = 'test';
});

let logged: string[] = [];

function capturar() {
  logged = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(' '));
  });
}

/** El bloque simulado: "  Para: x", "  Asunto: y", "  Cuerpo: z". */
const campo = (nombre: string): string => {
  const linea = logged.find((l) => l.trimStart().startsWith(`${nombre}:`));
  return linea ? linea.slice(linea.indexOf(':') + 1).trim() : '';
};
const asunto = () => campo('Asunto');
const cuerpo = () => campo('Cuerpo');

/** Un OTP del alfabeto de auth-api: 6 chars sin caracteres ambiguos. */
const SIN_CODIGO = /\b[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}\b/;

beforeEach(() => {
  capturar();
});

describe('sendPasswordResetEmail', () => {
  it('el asunto habla de restablecer, no de acceso', async () => {
    const res = await emailService.sendPasswordResetEmail('u@e.cl', 'Denisse', 'A2B3C4', 30);

    expect(res.ok).toBe(true);
    expect(asunto()).toBe('Código para restablecer tu contraseña · Emeltec Cloud');
    // Regresión: no debe reusar el copy del correo de login.
    expect(asunto()).not.toMatch(/código de acceso/i);
  });

  it('incluye el código y su vigencia', async () => {
    await emailService.sendPasswordResetEmail('u@e.cl', 'Denisse', 'A2B3C4', 15);

    expect(cuerpo()).toContain('A2B3C4');
    expect(cuerpo()).toContain('15 minutos');
  });

  it('la nota de seguridad avisa que la contraseña actual sigue vigente', async () => {
    await emailService.sendPasswordResetEmail('u@e.cl', 'Denisse', 'A2B3C4');

    // Diferencia clave con el correo de acceso: si el usuario NO pidió el reset,
    // no debe usar el código y su contraseña no cambió.
    expect(cuerpo()).toMatch(/NO uses este código/);
    expect(cuerpo()).toMatch(/actual sigue vigente/);
  });
});

describe('sendPasswordChangedEmail', () => {
  it('avisa el cambio y que se cerraron las sesiones', async () => {
    const res = await emailService.sendPasswordChangedEmail('u@e.cl', 'Denisse', {
      origen: 'recuperacion',
      ip: '190.1.2.3',
      ts: '2026-08-17T12:00:00Z',
    });

    expect(res.ok).toBe(true);
    expect(asunto()).toBe('Tu contraseña fue cambiada · Emeltec Cloud');
    expect(cuerpo()).toMatch(/sesiones abiertas se cerraron/);
  });

  it('reporta origen e IP, que es lo que permite detectar un reset ajeno', async () => {
    await emailService.sendPasswordChangedEmail('u@e.cl', 'Denisse', {
      origen: 'recuperacion',
      ip: '190.1.2.3',
    });

    expect(cuerpo()).toContain('recuperación desde el login');
    expect(cuerpo()).toContain('190.1.2.3');
    expect(cuerpo()).toMatch(/Si no fuiste tú/);
  });

  it('distingue el cambio hecho desde el perfil y tolera IP ausente', async () => {
    await emailService.sendPasswordChangedEmail('u@e.cl', 'Denisse', { origen: 'perfil' });

    expect(cuerpo()).toContain('cambio desde tu perfil');
    expect(cuerpo()).toContain('no registrada');
  });

  it('nunca incluye un código', async () => {
    await emailService.sendPasswordChangedEmail('u@e.cl', 'Denisse', { origen: 'perfil' });

    expect(cuerpo()).not.toMatch(SIN_CODIGO);
  });
});

describe('sendAccountAccessEmail', () => {
  it('cuenta nueva: invita a definir contraseña, SIN código', async () => {
    const res = await emailService.sendAccountAccessEmail('u@e.cl', 'Denisse', {
      motivo: 'nueva_cuenta',
    });

    expect(res.ok).toBe(true);
    expect(asunto()).toBe('Activa tu cuenta · Emeltec Cloud');
    expect(cuerpo()).toMatch(/código de verificación/);
    // El bug corregido: mandaba un OTP que /setup/start sobreescribía.
    expect(cuerpo()).not.toMatch(SIN_CODIGO);
  });

  it('reset administrativo: avisa que la contraseña anterior murió', async () => {
    await emailService.sendAccountAccessEmail('u@e.cl', 'Denisse', { motivo: 'reset_admin' });

    expect(asunto()).toBe('Tu acceso fue restablecido · Emeltec Cloud');
    expect(cuerpo()).toMatch(/administrador restableció/);
    expect(cuerpo()).toMatch(/sesiones abiertas se cerraron/);
    expect(cuerpo()).not.toMatch(SIN_CODIGO);
  });

  it('sin motivo cae en el copy de cuenta nueva', async () => {
    await emailService.sendAccountAccessEmail('u@e.cl', 'Denisse', {});

    expect(asunto()).toBe('Activa tu cuenta · Emeltec Cloud');
  });

  it('lleva CTA al portal', async () => {
    await emailService.sendAccountAccessEmail('u@e.cl', 'Denisse', { motivo: 'reset_admin' });

    expect(cuerpo()).toMatch(/Ingresa con este correo en: http/);
  });
});
