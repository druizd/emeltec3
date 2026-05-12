import { Resend } from 'resend';
import { config } from '../config/env';
import { logger } from '../config/logger';

const FROM_ADDRESS = config.email.from ?? 'Emeltec - Panel Industrial <noreply@emeltec.cl>';
const ACCESS_URL = config.email.frontendUrl ?? 'https://nuevacloud.emeltec.cl/login';
const resend = config.email.apiKey ? new Resend(config.email.apiKey) : null;

const SEVERIDAD_COLOR: Record<string, string> = {
  critica: '#dc2626',
  alta: '#ea580c',
  media: '#d97706',
  baja: '#65a30d',
};

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function labelSeveridad(severidad: unknown): string {
  const labels: Record<string, string> = { critica: 'CRITICA', alta: 'ALTA', media: 'MEDIA', baja: 'BAJA' };
  return labels[String(severidad)] ?? String(severidad ?? 'ALERTA').toUpperCase();
}

interface SendArgs {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

async function enviar({ to, subject, html, text }: SendArgs): Promise<{ id: string }> {
  if (!resend) {
    if (config.isProd) throw new Error('RESEND_API_KEY no esta configurada');
    logger.info({ to, subject }, '[emailService] Sin RESEND_API_KEY — correo simulado');
    return { id: 'dev-mode' };
  }
  const { data, error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: [to],
    subject,
    html,
    text: text ?? '',
  });
  if (error) throw new Error(`Resend error: ${error.message}`);
  logger.info({ to, id: data?.id }, '[emailService] Correo enviado');
  return { id: data?.id ?? '' };
}

export interface SendWelcomeResult {
  ok: boolean;
  id?: string;
  error?: string;
  previewUrl?: string | null;
}

export async function sendWelcomeEmail(
  emailDestino: string,
  nombreCompleto: string,
  passwordGenerado: string,
  minutes = 30,
): Promise<SendWelcomeResult> {
  try {
    const data = await enviar({
      to: emailDestino,
      subject: 'Tu código de acceso - Emeltec',
      text: `Hola ${nombreCompleto}, tu código de acceso es: ${passwordGenerado}. Ingresa en ${ACCESS_URL}. Válido por ${minutes} minutos.`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px;border:1px solid #e2e8f0;border-radius:12px;">
          <h2 style="color:#0DAFBD;margin-bottom:4px;">Panel Industrial Emeltec</h2>
          <p>Hola <strong>${escapeHtml(nombreCompleto)}</strong>,</p>
          <p>Tu código de acceso es:</p>
          <div style="background:#f1f5f9;padding:20px;border-radius:8px;text-align:center;margin:20px 0;">
            <span style="font-size:2.5em;font-weight:bold;letter-spacing:8px;color:#1e293b;">${escapeHtml(passwordGenerado)}</span>
          </div>
          <p><strong>URL de acceso:</strong> <a href="${ACCESS_URL}">${ACCESS_URL}</a></p>
          <p style="color:#64748b;font-size:0.9em;">Este código es válido por <strong>${minutes} minutos</strong>. No lo compartas con nadie.</p>
        </div>
      `,
    });
    return { ok: true, id: data.id, previewUrl: null };
  } catch (error) {
    logger.error({ err: (error as Error).message }, '[emailService] Error enviando correo de acceso');
    return { ok: false, error: (error as Error).message };
  }
}

export interface NewUserData {
  nombre: string;
  email: string;
  tipo: string;
}

export async function sendNewUserNotificationToAdmin(
  emailAdmin: string,
  nombreAdmin: string,
  datosUsuario: NewUserData,
): Promise<void> {
  try {
    await enviar({
      to: emailAdmin,
      subject: `Nuevo usuario registrado: ${datosUsuario.nombre}`,
      text: `Hola ${nombreAdmin}, se creo el usuario ${datosUsuario.nombre} (${datosUsuario.email}).`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px;border:1px solid #ddd;border-radius:10px;">
          <h2 style="color:#2563eb;">Nuevo Usuario Registrado</h2>
          <p>Hola <strong>${escapeHtml(nombreAdmin)}</strong>,</p>
          <p>Se creo una nueva cuenta en la plataforma:</p>
          <div style="background:#f8fafc;padding:15px;border-radius:5px;margin:20px 0;">
            <p><strong>Nombre:</strong> ${escapeHtml(datosUsuario.nombre)}</p>
            <p><strong>Email:</strong> ${escapeHtml(datosUsuario.email)}</p>
            <p><strong>Tipo:</strong> ${escapeHtml(datosUsuario.tipo)}</p>
          </div>
        </div>
      `,
    });
  } catch (error) {
    logger.error({ err: (error as Error).message }, '[emailService] Error notificando admin');
  }
}

export interface AlertRegla {
  nombre: string;
  severidad: string;
  reg_alias?: string;
  variable_key: string;
  sitio_desc?: string;
  sitio_id: string;
  valor_detectado?: unknown;
  condicion_texto?: string;
  condicion: string;
  id_serial?: string;
}

export async function sendAlertEmail(
  emailDestino: string,
  nombreCompleto: string,
  mensaje: string,
  regla: AlertRegla,
): Promise<void> {
  try {
    const color = SEVERIDAD_COLOR[regla.severidad] ?? '#64748b';
    const alias = regla.reg_alias ?? regla.variable_key;
    const sitio = regla.sitio_desc ?? regla.sitio_id;
    const severidad = labelSeveridad(regla.severidad);
    const valorDetectado = regla.valor_detectado ?? 'sin dato disponible';
    const condicion = regla.condicion_texto ?? regla.condicion;
    const serial = regla.id_serial ?? 'N/A';

    await enviar({
      to: emailDestino,
      subject: `[${severidad}] ${sitio} - ${alias}`,
      text: [
        `Hola ${nombreCompleto},`,
        '',
        mensaje,
        '',
        `Severidad: ${severidad}`,
        `Sitio: ${sitio}`,
        `Equipo: ${serial}`,
        `Variable: ${alias}`,
        `Valor detectado: ${valorDetectado}`,
        `Regla: ${condicion}`,
      ].join('\n'),
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px;border:1px solid #ddd;border-radius:10px;">
          <div style="background:${color};color:#fff;padding:12px 20px;border-radius:8px 8px 0 0;">
            <h2 style="margin:0;font-size:1.1em;">Alerta Industrial - ${escapeHtml(severidad)}</h2>
          </div>
          <div style="padding:20px;background:#f8fafc;">
            <p>Hola <strong>${escapeHtml(nombreCompleto)}</strong>,</p>
            <p style="font-size:1.05em;color:#1e293b;line-height:1.5;">${escapeHtml(mensaje)}</p>
            <table style="width:100%;border-collapse:collapse;margin-top:16px;">
              <tr><td style="padding:8px;font-weight:bold;color:#475569;">Severidad</td><td style="padding:8px;">${escapeHtml(severidad)}</td></tr>
              <tr style="background:#e2e8f0;"><td style="padding:8px;font-weight:bold;color:#475569;">Sitio</td><td style="padding:8px;">${escapeHtml(sitio)}</td></tr>
              <tr><td style="padding:8px;font-weight:bold;color:#475569;">Equipo</td><td style="padding:8px;">${escapeHtml(serial)}</td></tr>
              <tr style="background:#e2e8f0;"><td style="padding:8px;font-weight:bold;color:#475569;">Variable</td><td style="padding:8px;">${escapeHtml(alias)}</td></tr>
              <tr><td style="padding:8px;font-weight:bold;color:#475569;">Valor detectado</td><td style="padding:8px;">${escapeHtml(String(valorDetectado))}</td></tr>
              <tr style="background:#e2e8f0;"><td style="padding:8px;font-weight:bold;color:#475569;">Regla</td><td style="padding:8px;">${escapeHtml(condicion)}</td></tr>
              <tr><td style="padding:8px;font-weight:bold;color:#475569;">Nombre alerta</td><td style="padding:8px;">${escapeHtml(regla.nombre)}</td></tr>
            </table>
          </div>
        </div>
      `,
    });
  } catch (error) {
    logger.error({ err: (error as Error).message, emailDestino }, '[emailService] Error enviando alerta');
  }
}
