const { Resend } = require('resend');
const fs = require('fs');
const path = require('path');
const { CHILE_TIME_ZONE } = require('../utils/timezone');

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_ADDRESS = process.env.RESEND_FROM || 'Emeltec - Panel Industrial <noreply@emeltec.cl>';
const ACCESS_URL = process.env.FRONTEND_URL || 'https://nuevacloud.emeltec.cl/login';

const LOGO_CID = 'emeltec-logo';
const LOGO_CANDIDATES = [
  process.env.EMAIL_LOGO_PATH,
  path.join(__dirname, '..', '..', 'assets', 'emeltec-logo.png'),
  path.join(
    __dirname,
    '..',
    '..',
    '..',
    'frontend-angular',
    'public',
    'images',
    'emeltec-logo.png',
  ),
].filter(Boolean);

let logoBuffer = null;
let logoResolvedPath = null;
for (const candidate of LOGO_CANDIDATES) {
  try {
    logoBuffer = fs.readFileSync(candidate);
    logoResolvedPath = candidate;
    break;
  } catch {
    // probar siguiente candidato
  }
}
if (logoBuffer) {
  console.log('[emailService] Logo cargado desde', logoResolvedPath);
} else {
  console.warn('[emailService] Logo no encontrado en candidatos:', LOGO_CANDIDATES);
}

function resolveAccessHost() {
  try {
    return new URL(ACCESS_URL).host;
  } catch {
    return 'nuevacloud.emeltec.cl';
  }
}

const ACCESS_HOST = resolveAccessHost();

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

const SEVERIDAD_COLOR = {
  critica: '#dc2626',
  alta: '#ea580c',
  media: '#d97706',
  baja: '#65a30d',
};

const SEVERIDAD_GRADIENT = {
  critica: 'linear-gradient(90deg,#dc2626 0%,#7f1d1d 100%)',
  alta: 'linear-gradient(90deg,#ea580c 0%,#9a3412 100%)',
  media: 'linear-gradient(90deg,#d97706 0%,#92400e 100%)',
  baja: 'linear-gradient(90deg,#65a30d 0%,#3f6212 100%)',
};

const TEAL_GRADIENT = 'linear-gradient(90deg,#0DAFBD 0%,#04606A 100%)';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function labelSeveridad(severidad) {
  const labels = { critica: 'CRITICA', alta: 'ALTA', media: 'MEDIA', baja: 'BAJA' };
  return labels[severidad] || String(severidad || 'ALERTA').toUpperCase();
}

function renderShell({ title, preheader, accentColor, accentGradient, contentHtml }) {
  const accentBg = accentColor || '#0DAFBD';
  const accentBgImage = accentGradient || TEAL_GRADIENT;
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#F0F2F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#1E293B;-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader || '')}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F0F2F5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#FFFFFF;border:1px solid #E2E8F0;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.06);">
          <tr>
            <td style="background-color:#FFFFFF;padding:34px 32px 26px;text-align:center;border-bottom:1px solid #E2E8F0;">
              <img src="cid:${LOGO_CID}" alt="Emeltec" width="260" height="74" style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;height:74px;width:260px;max-width:260px;">
            </td>
          </tr>
          <tr>
            <td style="padding:0;line-height:0;font-size:0;height:3px;background:${accentBg};background-image:${accentBgImage};">&nbsp;</td>
          </tr>
${contentHtml}
          <tr>
            <td style="background-color:#F8FAFC;border-top:1px solid #E2E8F0;padding:18px 40px;text-align:center;">
              <p style="margin:0;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#94A3B8;font-weight:700;">Emeltec Cloud - Emeltec HUB</p>
              <p style="margin:6px 0 0;font-size:11px;color:#94A3B8;line-height:1.5;">Monitoreo industrial e IIoT</p>
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0;font-size:11px;color:#94A3B8;text-align:center;">&copy; ${new Date().getFullYear()} Emeltec SpA &middot; Santiago, Chile</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function ctaButtonHtml(url, label, color = '#0DAFBD') {
  return `          <tr>
            <td style="padding:24px 40px 8px;text-align:center;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
                <tr>
                  <td style="background-color:${color};border-radius:6px;">
                    <a href="${url}" style="display:inline-block;padding:13px 28px;font-size:14px;font-weight:600;color:#FFFFFF;text-decoration:none;letter-spacing:0.01em;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">${escapeHtml(label)} &rarr;</a>
                  </td>
                </tr>
              </table>
              <p style="margin:14px 0 0;font-size:12px;color:#94A3B8;">o ingresa directamente en <a href="${url}" style="color:#0899A5;text-decoration:none;">${escapeHtml(ACCESS_HOST)}</a></p>
            </td>
          </tr>`;
}

function infoTableHtml(rows, accentColor = '#0DAFBD') {
  const body = rows
    .map(
      ([label, value]) => `
                <tr>
                  <td style="padding:11px 16px;border-bottom:1px solid #E2E8F0;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#94A3B8;font-weight:700;width:38%;vertical-align:top;">${escapeHtml(label)}</td>
                  <td style="padding:11px 16px;border-bottom:1px solid #E2E8F0;font-size:14px;color:#1E293B;font-weight:500;">${value}</td>
                </tr>`,
    )
    .join('');
  return `          <tr>
            <td style="padding:24px 40px 4px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFFFFF;border:1px solid #E2E8F0;border-radius:10px;border-left:3px solid ${accentColor};overflow:hidden;">
                ${body}
              </table>
            </td>
          </tr>`;
}

function securityNoteHtml(text) {
  return `          <tr>
            <td style="padding:28px 40px 4px;">
              <div style="border-top:1px solid #E2E8F0;padding-top:16px;">
                <p style="margin:0;font-size:12px;line-height:1.55;color:#64748B;">${text}</p>
              </div>
            </td>
          </tr>`;
}

async function enviar({ to, subject, html, text }) {
  if (!resend) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('RESEND_API_KEY no esta configurada');
    }

    console.log('[emailService] Sin RESEND_API_KEY - correo simulado:');
    console.log(`  Para:    ${to}`);
    console.log(`  Asunto:  ${subject}`);
    console.log(`  Cuerpo:  ${text || '(ver html)'}`);
    return { id: 'dev-mode' };
  }

  const attachments = [];
  if (logoBuffer && html && html.includes(`cid:${LOGO_CID}`)) {
    attachments.push({
      filename: 'emeltec-logo.png',
      content: logoBuffer,
      contentType: 'image/png',
      inlineContentId: LOGO_CID,
    });
  }

  const payload = {
    from: FROM_ADDRESS,
    to: [to],
    subject,
    html,
    text,
  };
  if (attachments.length) payload.attachments = attachments;

  const { data, error } = await resend.emails.send(payload);

  if (error) throw new Error(`Resend error: ${error.message}`);
  console.log(`[emailService] Correo enviado a ${to} - id: ${data.id}`);
  return data;
}

exports.sendWelcomeEmail = async (emailDestino, nombreCompleto, passwordGenerado, minutes = 30) => {
  try {
    const nombre = (nombreCompleto || '').trim() || 'usuario';
    const otp = String(passwordGenerado ?? '');
    const contentHtml = `          <tr>
            <td style="padding:36px 40px 4px;">
              <p style="margin:0 0 6px;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#94A3B8;font-weight:700;">Acceso a la plataforma</p>
              <h1 style="margin:0 0 14px;font-size:24px;line-height:1.25;color:#1E293B;font-weight:600;letter-spacing:-0.01em;">Hola ${escapeHtml(nombre)},</h1>
              <p style="margin:0;font-size:15px;line-height:1.55;color:#475569;">Usa el siguiente código para ingresar a Emeltec Cloud. Es de un solo uso y expira en <strong style="color:#1E293B;">${minutes} minutos</strong>.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 40px 4px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F8FAFC;border:1px solid rgba(13,175,189,0.35);border-radius:10px;">
                <tr>
                  <td style="padding:22px 24px;text-align:center;">
                    <p style="margin:0 0 10px;font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:#94A3B8;font-weight:700;">Código de acceso</p>
                    <p style="margin:0;font-family:'SF Mono','JetBrains Mono',Consolas,'Liberation Mono',Menlo,monospace;font-size:34px;font-weight:600;letter-spacing:10px;color:#0DAFBD;line-height:1;">${escapeHtml(otp)}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
${ctaButtonHtml(ACCESS_URL, 'Ingresar a la plataforma')}
${securityNoteHtml('Por seguridad, no compartas este código con nadie. Si no solicitaste este acceso, ignora este correo o contacta a soporte.')}`;

    const html = renderShell({
      title: 'Código de acceso · Emeltec',
      preheader: `Tu código de acceso a Emeltec Cloud expira en ${minutes} minutos.`,
      contentHtml,
    });

    const data = await enviar({
      to: emailDestino,
      subject: 'Tu código de acceso · Emeltec Cloud',
      text: [
        `Hola ${nombre},`,
        '',
        `Tu código de acceso a Emeltec Cloud es: ${otp}`,
        `Válido por ${minutes} minutos. Es de un solo uso.`,
        '',
        `Ingresa en: ${ACCESS_URL}`,
        '',
        'Si no solicitaste este acceso, ignora este correo.',
      ].join('\n'),
      html,
    });
    return { ok: true, id: data.id };
  } catch (error) {
    console.error('[emailService] Error enviando correo de acceso:', error.message);
    return { ok: false, error: error.message };
  }
};

/**
 * Invitación a activar la cuenta — SIN código.
 *
 * Antes, tanto la creación de usuario como el reset administrativo enviaban un
 * OTP por `sendWelcomeEmail`. Ese código era inservible: la activación pasa por
 * `auth-api POST /api/auth/setup/start`, que emite un OTP nuevo y sobreescribe
 * `otp_hash`. El usuario recibía "tu código de acceso es XXXXXX" y ese valor
 * nunca funcionaba. Ahora se lo invita a ir al login, donde recibirá el código
 * de verdad al definir su contraseña.
 *
 * @param {'nueva_cuenta'|'reset_admin'} motivo
 */
function buildAccountAccessEmail(nombreCompleto, { motivo } = {}) {
  {
    const nombre = (nombreCompleto || '').trim() || 'usuario';
    const esReset = motivo === 'reset_admin';

    const eyebrow = esReset ? 'Acceso restablecido' : 'Bienvenido a Emeltec Cloud';
    const titulo = esReset ? 'Tu acceso fue restablecido' : `Hola ${escapeHtml(nombre)},`;
    const cuerpo = esReset
      ? 'Un administrador restableció el acceso a tu cuenta, por lo que tu contraseña anterior ya no es válida y las sesiones abiertas se cerraron. Ingresa al portal con tu correo para crear una contraseña nueva; ahí te enviaremos un código de verificación.'
      : 'Tu cuenta en Emeltec Cloud ya está creada. Ingresa al portal con este correo para definir tu contraseña; en ese momento te enviaremos un código de verificación para confirmarla.';
    const nota = esReset
      ? 'Si no esperabas este restablecimiento, contacta a tu administrador antes de continuar.'
      : 'Si no reconoces esta invitación, ignora este correo o contacta a soporte.';

    const contentHtml = `          <tr>
            <td style="padding:36px 40px 4px;">
              <p style="margin:0 0 6px;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#94A3B8;font-weight:700;">${eyebrow}</p>
              <h1 style="margin:0 0 14px;font-size:24px;line-height:1.25;color:#1E293B;font-weight:600;letter-spacing:-0.01em;">${titulo}</h1>
              <p style="margin:0;font-size:15px;line-height:1.55;color:#475569;">${cuerpo}</p>
            </td>
          </tr>
${ctaButtonHtml(ACCESS_URL, esReset ? 'Crear contraseña nueva' : 'Definir mi contraseña')}
${securityNoteHtml(nota)}`;

    const asunto = esReset
      ? 'Tu acceso fue restablecido · Emeltec Cloud'
      : 'Activa tu cuenta · Emeltec Cloud';

    const html = renderShell({
      title: asunto,
      preheader: esReset
        ? 'Crea una contraseña nueva para volver a entrar.'
        : 'Define tu contraseña para entrar por primera vez.',
      contentHtml,
    });

    return {
      subject: asunto,
      html,
      text: [
        esReset ? 'Hola,' : `Hola ${nombre},`,
        '',
        esReset
          ? 'Un administrador restableció el acceso a tu cuenta. Tu contraseña anterior ya no es válida y las sesiones abiertas se cerraron.'
          : 'Tu cuenta en Emeltec Cloud ya está creada.',
        '',
        `Ingresa con este correo en: ${ACCESS_URL}`,
        'Al definir tu contraseña te enviaremos un código de verificación.',
        '',
        nota,
      ].join('\n'),
    };
  }
}

exports.sendAccountAccessEmail = async (emailDestino, nombreCompleto, opciones = {}) => {
  try {
    const data = await enviar({
      to: emailDestino,
      ...buildAccountAccessEmail(nombreCompleto, opciones),
    });
    return { ok: true, id: data.id };
  } catch (error) {
    console.error('[emailService] Error enviando invitacion de acceso:', error.message);
    return { ok: false, error: error.message };
  }
};

// Código OTP para restablecer la contraseña. Separado de sendWelcomeEmail
// porque aquel habla de "acceso a la plataforma": quien pidió recuperar su
// contraseña recibía un correo que parecía de login, y la nota de seguridad
// ("si no solicitaste este acceso") apuntaba al evento equivocado.
function buildPasswordResetEmail(nombreCompleto, code, minutes = 30) {
  {
    const nombre = (nombreCompleto || '').trim() || 'usuario';
    const otp = String(code ?? '');
    const contentHtml = `          <tr>
            <td style="padding:36px 40px 4px;">
              <p style="margin:0 0 6px;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#94A3B8;font-weight:700;">Restablecer contraseña</p>
              <h1 style="margin:0 0 14px;font-size:24px;line-height:1.25;color:#1E293B;font-weight:600;letter-spacing:-0.01em;">Hola ${escapeHtml(nombre)},</h1>
              <p style="margin:0;font-size:15px;line-height:1.55;color:#475569;">Recibimos una solicitud para cambiar la contraseña de tu cuenta. Usa el siguiente código para confirmarla. Es de un solo uso y expira en <strong style="color:#1E293B;">${minutes} minutos</strong>.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 40px 4px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F8FAFC;border:1px solid rgba(13,175,189,0.35);border-radius:10px;">
                <tr>
                  <td style="padding:22px 24px;text-align:center;">
                    <p style="margin:0 0 10px;font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:#94A3B8;font-weight:700;">Código de restablecimiento</p>
                    <p style="margin:0;font-family:'SF Mono','JetBrains Mono',Consolas,'Liberation Mono',Menlo,monospace;font-size:34px;font-weight:600;letter-spacing:10px;color:#0DAFBD;line-height:1;">${escapeHtml(otp)}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
${securityNoteHtml('Si no pediste cambiar tu contraseña, NO uses este código: tu contraseña actual sigue vigente. Avisa a soporte lo antes posible.')}`;

    const html = renderShell({
      title: 'Restablecer contraseña · Emeltec',
      preheader: `Tu código para restablecer la contraseña expira en ${minutes} minutos.`,
      contentHtml,
    });

    return {
      subject: 'Código para restablecer tu contraseña · Emeltec Cloud',
      html,
      text: [
        `Hola ${nombre},`,
        '',
        'Recibimos una solicitud para cambiar la contraseña de tu cuenta.',
        `Tu código de restablecimiento es: ${otp}`,
        `Válido por ${minutes} minutos. Es de un solo uso.`,
        '',
        'Si no pediste cambiar tu contraseña, NO uses este código: tu contraseña',
        'actual sigue vigente. Avisa a soporte lo antes posible.',
      ].join('\n'),
    };
  }
}

exports.sendPasswordResetEmail = async (emailDestino, nombreCompleto, code, minutes = 30) => {
  try {
    const data = await enviar({
      to: emailDestino,
      ...buildPasswordResetEmail(nombreCompleto, code, minutes),
    });
    return { ok: true, id: data.id };
  } catch (error) {
    console.error('[emailService] Error enviando correo de restablecimiento:', error.message);
    return { ok: false, error: error.message };
  }
};

// Aviso posterior al cambio efectivo de contraseña. Es la defensa principal
// frente a un restablecimiento no autorizado: el titular se entera aunque el
// atacante controle el flujo.
function buildPasswordChangedEmail(nombreCompleto, { origen, ip, ts } = {}) {
  {
    const nombre = (nombreCompleto || '').trim() || 'usuario';
    const cuando = ts ? new Date(ts) : new Date();
    const fecha = cuando.toLocaleString('es-CL', { timeZone: CHILE_TIME_ZONE });
    const origenLabel =
      { recuperacion: 'recuperación desde el login', perfil: 'cambio desde tu perfil' }[origen] ||
      'cambio de contraseña';

    const contentHtml = `          <tr>
            <td style="padding:36px 40px 4px;">
              <p style="margin:0 0 6px;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#94A3B8;font-weight:700;">Seguridad de la cuenta</p>
              <h1 style="margin:0 0 14px;font-size:24px;line-height:1.25;color:#1E293B;font-weight:600;letter-spacing:-0.01em;">Tu contraseña fue cambiada</h1>
              <p style="margin:0;font-size:15px;line-height:1.55;color:#475569;">Hola ${escapeHtml(nombre)}, la contraseña de tu cuenta en Emeltec Cloud acaba de cambiar. Todas las sesiones abiertas se cerraron.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 40px 4px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;">
                <tr>
                  <td style="padding:18px 24px;font-size:13px;line-height:1.7;color:#475569;">
                    <strong style="color:#1E293B;">Origen:</strong> ${escapeHtml(origenLabel)}<br />
                    <strong style="color:#1E293B;">Fecha:</strong> ${escapeHtml(fecha)}<br />
                    <strong style="color:#1E293B;">IP:</strong> ${escapeHtml(ip || 'no registrada')}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
${securityNoteHtml('Si no fuiste tú, tu cuenta está comprometida: contacta a soporte de inmediato para bloquearla.')}`;

    const html = renderShell({
      title: 'Tu contraseña fue cambiada · Emeltec',
      preheader: 'La contraseña de tu cuenta en Emeltec Cloud acaba de cambiar.',
      contentHtml,
    });

    return {
      subject: 'Tu contraseña fue cambiada · Emeltec Cloud',
      html,
      text: [
        `Hola ${nombre},`,
        '',
        'La contraseña de tu cuenta en Emeltec Cloud acaba de cambiar.',
        'Todas las sesiones abiertas se cerraron.',
        '',
        `Origen: ${origenLabel}`,
        `Fecha: ${fecha}`,
        `IP: ${ip || 'no registrada'}`,
        '',
        'Si no fuiste tú, tu cuenta está comprometida: contacta a soporte de',
        'inmediato para bloquearla.',
      ].join('\n'),
    };
  }
}

exports.sendPasswordChangedEmail = async (emailDestino, nombreCompleto, opciones = {}) => {
  try {
    const data = await enviar({
      to: emailDestino,
      ...buildPasswordChangedEmail(nombreCompleto, opciones),
    });
    return { ok: true, id: data.id };
  } catch (error) {
    console.error('[emailService] Error enviando aviso de cambio de contraseña:', error.message);
    return { ok: false, error: error.message };
  }
};

// Código 2FA step-up para acciones sensibles (borrar alarma, crear/eliminar
// usuario). Mismo diseño branded que el resto de los correos.
exports.send2faCode = async ({ to, code, minutes = 5 }) => {
  try {
    const otp = String(code ?? '');
    const contentHtml = `          <tr>
            <td style="padding:36px 40px 4px;">
              <p style="margin:0 0 6px;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#94A3B8;font-weight:700;">Verificación de seguridad</p>
              <h1 style="margin:0 0 14px;font-size:24px;line-height:1.25;color:#1E293B;font-weight:600;letter-spacing:-0.01em;">Confirma la acción</h1>
              <p style="margin:0;font-size:15px;line-height:1.55;color:#475569;">Usa este código para confirmar una acción sensible en Emeltec Cloud. Es de un solo uso y expira en <strong style="color:#1E293B;">${minutes} minutos</strong>.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 40px 4px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F8FAFC;border:1px solid rgba(13,175,189,0.35);border-radius:10px;">
                <tr>
                  <td style="padding:22px 24px;text-align:center;">
                    <p style="margin:0 0 10px;font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:#94A3B8;font-weight:700;">Código de verificación</p>
                    <p style="margin:0;font-family:'SF Mono','JetBrains Mono',Consolas,'Liberation Mono',Menlo,monospace;font-size:34px;font-weight:600;letter-spacing:10px;color:#0DAFBD;line-height:1;">${escapeHtml(otp)}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
${securityNoteHtml('Si no solicitaste esta acción, ignora este correo y revisa el acceso a tu cuenta.')}`;

    const html = renderShell({
      title: 'Código de verificación · Emeltec',
      preheader: `Tu código de verificación expira en ${minutes} minutos.`,
      contentHtml,
    });

    const data = await enviar({
      to,
      subject: 'Código de verificación · Emeltec Cloud',
      text: [
        'Código de verificación para confirmar una acción en Emeltec Cloud:',
        '',
        `${otp}`,
        `Válido por ${minutes} minutos. Es de un solo uso.`,
        '',
        'Si no solicitaste esta acción, ignora este correo.',
      ].join('\n'),
      html,
    });
    return { ok: true, id: data.id };
  } catch (error) {
    console.error('[emailService] Error enviando código 2FA:', error.message);
    return { ok: false, error: error.message };
  }
};

exports.sendNewUserNotificationToAdmin = async (emailAdmin, nombreAdmin, datosUsuario) => {
  try {
    const admin = (nombreAdmin || '').trim() || 'administrador';
    const nombre = datosUsuario.nombre || 'Sin nombre';
    const email = datosUsuario.email || '';
    const tipo = datosUsuario.tipo || 'Sin tipo';

    const contentHtml = `          <tr>
            <td style="padding:36px 40px 4px;">
              <p style="margin:0 0 6px;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#94A3B8;font-weight:700;">Gestión de usuarios</p>
              <h1 style="margin:0 0 14px;font-size:24px;line-height:1.25;color:#1E293B;font-weight:600;letter-spacing:-0.01em;">Nuevo usuario registrado</h1>
              <p style="margin:0;font-size:15px;line-height:1.55;color:#475569;">Hola <strong style="color:#1E293B;">${escapeHtml(admin)}</strong>, se creó una nueva cuenta en Emeltec Cloud con los siguientes datos:</p>
            </td>
          </tr>
${infoTableHtml([
  ['Nombre', escapeHtml(nombre)],
  [
    'Correo',
    `<a href="mailto:${escapeHtml(email)}" style="color:#0899A5;text-decoration:none;">${escapeHtml(email)}</a>`,
  ],
  ['Tipo de cuenta', escapeHtml(tipo)],
])}
${ctaButtonHtml(ACCESS_URL, 'Ver panel de usuarios')}
${securityNoteHtml('Si esta cuenta no fue autorizada, revoca el acceso desde el panel administrativo lo antes posible.')}`;

    const html = renderShell({
      title: 'Nuevo usuario · Emeltec',
      preheader: `Se registró ${nombre} (${email}) en Emeltec Cloud.`,
      contentHtml,
    });

    await enviar({
      to: emailAdmin,
      subject: `Nuevo usuario registrado · ${nombre}`,
      text: [
        `Hola ${admin},`,
        '',
        'Se creó una nueva cuenta en Emeltec Cloud:',
        `  Nombre: ${nombre}`,
        `  Correo: ${email}`,
        `  Tipo:   ${tipo}`,
        '',
        `Panel: ${ACCESS_URL}`,
      ].join('\n'),
      html,
    });
  } catch (error) {
    console.error('[emailService] Error notificando admin:', error.message);
  }
};

/**
 * Envío crudo de email — usado por workers TS que necesitan notificar al admin
 * sin la ceremonia del template de alertas (DGA reconciler, requires_review,
 * etc.). El `text` se renderiza en el shell estándar con un divider.
 *
 * Devuelve la promesa del Resend (o {id:'dev-mode'} en dev sin API key).
 */
exports.sendAdminPlainEmail = async ({ to, subject, text, html }) => {
  if (!to) {
    console.warn('[emailService] sendAdminPlainEmail: "to" vacío, email omitido');
    return null;
  }
  return enviar({ to, subject, text, html });
};

/**
 * Envuelve `contentHtml` (filas <tr> del cuerpo) en el shell branded de Emeltec
 * (logo, barra de acento, footer). Para armar correos de admin lindos desde los
 * workers sin duplicar el marco.
 */
exports.renderAdminShell = ({ title, preheader, accentColor, accentGradient, contentHtml }) =>
  renderShell({ title, preheader, accentColor, accentGradient, contentHtml });

exports.sendAlertEmail = async (emailDestino, nombreCompleto, mensaje, regla) => {
  try {
    const nombre = (nombreCompleto || '').trim() || 'usuario';
    const accentColor = SEVERIDAD_COLOR[regla.severidad] || '#64748b';
    const accentGradient =
      SEVERIDAD_GRADIENT[regla.severidad] ||
      `linear-gradient(90deg,${accentColor} 0%,${accentColor} 100%)`;
    const alias = regla.reg_alias || regla.variable_key || 'N/A';
    // "CCU · Quilicura · Pozo 10 · OB-1306-98" cuando el worker la trae; el
    // serial queda en su propia fila porque al operador no le dice nada.
    const sitio = regla.sitio_etiqueta || regla.sitio_desc || regla.sitio_id || 'N/A';
    const sitioUrl = regla.sitio_url || ACCESS_URL;
    const severidad = labelSeveridad(regla.severidad);
    const valorDetectado = regla.valor_detectado ?? 'sin dato disponible';
    const condicion = regla.condicion_texto || regla.condicion || 'N/A';
    const serial = regla.id_serial || 'N/A';
    const nombreAlerta = regla.nombre || 'Alerta sin nombre';

    const contentHtml = `          <tr>
            <td style="padding:36px 40px 4px;">
              <p style="margin:0 0 10px;">
                <span style="display:inline-block;padding:4px 12px;background-color:${accentColor};color:#FFFFFF;font-size:10px;letter-spacing:0.16em;text-transform:uppercase;font-weight:700;border-radius:9999px;">&bull; ${escapeHtml(severidad)}</span>
              </p>
              <h1 style="margin:0 0 14px;font-size:24px;line-height:1.25;color:#1E293B;font-weight:600;letter-spacing:-0.01em;">Alerta industrial detectada</h1>
              <p style="margin:0;font-size:15px;line-height:1.55;color:#475569;">Hola <strong style="color:#1E293B;">${escapeHtml(nombre)}</strong>, ${escapeHtml(mensaje)}</p>
            </td>
          </tr>
${infoTableHtml(
  [
    ['Alerta', escapeHtml(nombreAlerta)],
    ['Sitio', escapeHtml(sitio)],
    ['Serial del equipo', escapeHtml(serial)],
    ['Variable', escapeHtml(alias)],
    [
      'Valor detectado',
      `<span style="font-family:'SF Mono','JetBrains Mono',Consolas,'Liberation Mono',Menlo,monospace;color:${accentColor};font-weight:600;">${escapeHtml(String(valorDetectado))}</span>`,
    ],
    ['Regla', escapeHtml(condicion)],
  ],
  accentColor,
)}
${ctaButtonHtml(sitioUrl, 'Ver el sitio en la plataforma', accentColor)}
${securityNoteHtml('Esta es una notificación automática del sistema de monitoreo Emeltec. Revisa la plataforma para tomar acción si corresponde.')}`;

    const html = renderShell({
      title: `Alerta ${severidad} · Emeltec`,
      preheader: `${severidad} · ${sitio} · ${alias}: ${valorDetectado}`,
      accentColor,
      accentGradient,
      contentHtml,
    });

    await enviar({
      to: emailDestino,
      subject: `[${severidad}] ${sitio} - ${alias}`,
      text: [
        `Hola ${nombre},`,
        '',
        mensaje,
        '',
        `Severidad: ${severidad}`,
        `Sitio: ${sitio}`,
        `Serial del equipo: ${serial}`,
        `Variable: ${alias}`,
        `Valor detectado: ${valorDetectado}`,
        `Regla: ${condicion}`,
        `Alerta: ${nombreAlerta}`,
        '',
        `Ver el sitio en la plataforma: ${sitioUrl}`,
      ].join('\n'),
      html,
    });
  } catch (error) {
    console.error('[emailService] Error enviando alerta a', emailDestino, ':', error.message);
  }
};

// ───────────────────────── Resumen interno de monitoreo ─────────────────────
//
// Un correo, dos veces al día, para el equipo Emeltec. Dos secciones con el
// mismo formato de tabla: equipos sin transmitir y reportes DGA atrasados.
// Reemplaza a los correos de escalación por instalación, que con una caída
// transversal llenaban la bandeja.

/** "3d 4h", "7h 20m", "45m". El dato que se lee primero en cada fila. */
function formatLagMs(lagMs) {
  if (lagMs === null || lagMs === undefined || lagMs > Number.MAX_SAFE_INTEGER / 2) {
    return 'sin transmisiones registradas';
  }
  const totalMin = Math.floor(lagMs / 60000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatChile(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es-CL', {
      timeZone: CHILE_TIME_ZONE,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return '—';
  }
}

/** El color lo pone el tiempo sin reportar, no un tramo configurable. */
function colorPorLag(lagMs) {
  if (lagMs > Number.MAX_SAFE_INTEGER / 2 || lagMs >= 24 * 3600000) return '#dc2626';
  if (lagMs >= 12 * 3600000) return '#ea580c';
  return '#d97706';
}

/**
 * Una sección del resumen. Las dos tienen la misma forma —instalación, empresa,
 * tiempo sin reportar y link— para que se lean igual sin volver a aprenderlas.
 */
function seccionResumenHtml(titulo, eyebrow, items, columnaTiempo) {
  if (items.length === 0) {
    return `          <tr>
            <td style="padding:24px 40px 0;">
              <p style="margin:0 0 6px;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#94A3B8;font-weight:700;">${escapeHtml(eyebrow)}</p>
              <h2 style="margin:0;font-size:18px;line-height:1.3;color:#1E293B;font-weight:600;">${escapeHtml(titulo)}</h2>
              <p style="margin:14px 0 0;padding:14px;background-color:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px;color:#16a34a;font-size:13px;">&#10003; Sin incidencias en esta sección.</p>
            </td>
          </tr>`;
  }
  const rows = items
    .map((r) => {
      const color = colorPorLag(r.lagMs);
      return `
                <tr>
                  <td style="padding:10px 14px;border-bottom:1px solid #E2E8F0;font-size:13px;color:#1E293B;font-weight:600;vertical-align:top;">${escapeHtml(r.descripcion)}</td>
                  <td style="padding:10px 14px;border-bottom:1px solid #E2E8F0;font-size:12px;color:#64748B;vertical-align:top;">${escapeHtml(r.empresa || '—')}</td>
                  <td style="padding:10px 14px;border-bottom:1px solid #E2E8F0;font-size:13px;color:${color};font-family:'SF Mono','JetBrains Mono',Consolas,Menlo,monospace;font-weight:700;vertical-align:top;white-space:nowrap;">${escapeHtml(formatLagMs(r.lagMs))}</td>
                  <td style="padding:10px 14px;border-bottom:1px solid #E2E8F0;font-size:12px;color:#64748B;vertical-align:top;white-space:nowrap;">${escapeHtml(formatChile(r.lastAt))}</td>
                  <td style="padding:10px 14px;border-bottom:1px solid #E2E8F0;text-align:right;vertical-align:top;"><a href="${r.url || ACCESS_URL}" style="display:inline-block;padding:5px 12px;background-color:#0DAFBD;color:#FFFFFF;font-size:11px;font-weight:700;border-radius:9999px;text-decoration:none;">Ver</a></td>
                </tr>`;
    })
    .join('');
  const th = (t, align) =>
    `<td style="padding:9px 14px;background-color:#F8FAFC;border-bottom:1px solid #E2E8F0;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#94A3B8;font-weight:700;${align ? `text-align:${align};` : ''}">${t}</td>`;
  return `          <tr>
            <td style="padding:24px 40px 0;">
              <p style="margin:0 0 6px;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#94A3B8;font-weight:700;">${escapeHtml(eyebrow)}</p>
              <h2 style="margin:0 0 10px;font-size:18px;line-height:1.3;color:#1E293B;font-weight:600;">${escapeHtml(titulo)}
                <span style="font-weight:400;color:#94A3B8;font-size:14px;">&middot; ${items.length}</span>
              </h2>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFFFFF;border:1px solid #E2E8F0;border-radius:10px;overflow:hidden;">
                <tr>
                  ${th('Instalación')}${th('Empresa')}${th(escapeHtml(columnaTiempo))}${th('Último dato')}${th('', 'right')}
                </tr>
                ${rows}
              </table>
            </td>
          </tr>`;
}

function buildResumenHtml({ generatedAt, umbralHoras, dataIssues, dgaIssues }) {
  const total = dataIssues.length + dgaIssues.length;
  const accentColor = total === 0 ? '#22C55E' : '#dc2626';
  const accentGradient =
    total === 0 ? 'linear-gradient(90deg,#22C55E 0%,#15803D 100%)' : SEVERIDAD_GRADIENT.critica;
  const umbralTexto = String(Math.round(Number(umbralHoras) * 10) / 10).replace('.', ',');

  const contentHtml = `          <tr>
            <td style="padding:36px 40px 4px;">
              <p style="margin:0 0 6px;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#94A3B8;font-weight:700;">${
                total === 0
                  ? 'Resumen de monitoreo'
                  : `${total} ${total === 1 ? 'instalación requiere atención' : 'instalaciones requieren atención'}`
              }</p>
              <h1 style="margin:0 0 14px;font-size:24px;line-height:1.25;color:#1E293B;font-weight:600;letter-spacing:-0.01em;">${total === 0 ? 'Todo en orden' : 'Resumen de monitoreo'}</h1>
              <p style="margin:0;font-size:15px;line-height:1.55;color:#475569;">${
                total === 0
                  ? `Ningún equipo lleva más de ${escapeHtml(umbralTexto)} h sin transmitir y no hay reportes DGA atrasados.`
                  : `Se informa todo equipo con más de <strong style="color:#1E293B;">${escapeHtml(umbralTexto)} horas</strong> sin transmitir, y los reportes DGA con retraso.`
              }</p>
              <p style="margin:8px 0 0;font-size:12px;color:#94A3B8;">Generado el ${escapeHtml(formatChile(generatedAt || new Date().toISOString()))}</p>
            </td>
          </tr>
${seccionResumenHtml('Equipos sin datos', 'Transmisión', dataIssues, 'Sin transmitir')}
${seccionResumenHtml('Reportes DGA atrasados', 'Cumplimiento regulatorio', dgaIssues, 'Atraso')}
${ctaButtonHtml(ACCESS_URL, 'Ir a la plataforma', accentColor)}
${securityNoteHtml('Reporte automático del monitoreo Emeltec. Los horarios de envío y el umbral de horas se administran en Administración → Alertas por correo.')}`;

  return renderShell({
    title: 'Resumen de monitoreo · Emeltec',
    preheader:
      total === 0
        ? 'Todo en orden — sin equipos sin datos ni DGA atrasado.'
        : `${dataIssues.length} sin transmitir · ${dgaIssues.length} DGA atrasado.`,
    accentColor,
    accentGradient,
    contentHtml,
  });
}

// Internal — usado por scripts de preview/render. No estable.
exports._renderHealthDigestHtml = (input) => buildResumenHtml(input);

// Renders del ciclo de contraseña, expuestos para poder asertar el HTML: en modo
// simulado `enviar` solo loguea asunto y texto, así que el HTML —lo que el
// cliente de correo realmente muestra— quedaba sin verificar. Devuelven
// { subject, html, text }; los senders no hacen más que agregarles `to`.
exports._renderPasswordResetEmail = (nombre, code, minutes) =>
  buildPasswordResetEmail(nombre, code, minutes);
exports._renderPasswordChangedEmail = (nombre, opciones) =>
  buildPasswordChangedEmail(nombre, opciones);
exports._renderAccountAccessEmail = (nombre, opciones) => buildAccountAccessEmail(nombre, opciones);

/**
 * Resumen interno de monitoreo. Dos secciones, un correo por destinatario.
 * Manda igual cuando no hay nada: saber que el monitoreo está vivo vale tanto
 * como la lista de problemas.
 */
exports.sendHealthDigest = async ({
  to,
  generatedAt,
  umbralHoras = 6,
  dataIssues = [],
  dgaIssues = [],
}) => {
  try {
    if (!to) {
      console.warn('[emailService] sendHealthDigest: "to" vacío, email omitido');
      return;
    }
    const total = dataIssues.length + dgaIssues.length;
    const subject =
      total === 0
        ? 'Resumen Emeltec — Todo en orden'
        : `Resumen Emeltec — ${dataIssues.length} sin datos · ${dgaIssues.length} DGA atrasado`;

    const lineas = [
      `Resumen de monitoreo — ${formatChile(generatedAt || new Date().toISOString())}`,
      '',
    ];
    if (total === 0) {
      lineas.push(`Todo en orden. Ningún equipo con más de ${umbralHoras} h sin transmitir.`);
    } else {
      lineas.push(`EQUIPOS SIN DATOS (más de ${umbralHoras} h) — ${dataIssues.length}`);
      for (const r of dataIssues) {
        lineas.push(
          `  - ${r.descripcion} (${r.empresa || '—'}) — ${formatLagMs(r.lagMs)} sin transmitir`,
        );
        lineas.push(`    ${r.url || ACCESS_URL}`);
      }
      lineas.push('');
      lineas.push(`REPORTES DGA ATRASADOS — ${dgaIssues.length}`);
      for (const r of dgaIssues) {
        lineas.push(
          `  - ${r.descripcion} (${r.empresa || '—'}) — ${formatLagMs(r.lagMs)} de atraso`,
        );
        lineas.push(`    ${r.url || ACCESS_URL}`);
      }
    }
    lineas.push('');
    lineas.push(`Plataforma: ${ACCESS_URL}`);

    await enviar({
      to,
      subject,
      text: lineas.join('\n'),
      html: buildResumenHtml({ generatedAt, umbralHoras, dataIssues, dgaIssues }),
    });
  } catch (error) {
    console.error('[emailService] Error enviando el resumen de monitoreo:', error.message);
  }
};

// ───────────────────────── Resumen semanal del cliente ──────────────────────
//
// Un correo por semana a cada usuario suscrito, con las alertas que siguen
// abiertas en SUS sitios. Dos secciones que no se pueden mezclar:
//
//   1. En falla ahora — la condición sigue activa.
//   2. Normalizadas, pendientes de acuse — ya se arreglaron solas, pero nadie
//      las dio por recibidas, así que la regla sigue sin rearmarse.
//
// Si fueran una sola lista, el cliente leería como "activas" cosas que ya
// pasaron y en dos semanas dejaría de abrir el correo.

/** "hoy", "hace 1 día", "hace 12 días". */
function formatDiasAbierta(dias) {
  const n = Number(dias);
  if (!Number.isFinite(n) || n <= 0) return 'hoy';
  return n === 1 ? 'hace 1 día' : `hace ${n} días`;
}

/** Pastilla de severidad, del mismo color que la alerta individual. */
function pildoraSeveridadHtml(severidad) {
  const color = SEVERIDAD_COLOR[severidad] || '#64748b';
  return `<span style="display:inline-block;padding:3px 10px;background-color:${color};color:#FFFFFF;font-size:9px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;border-radius:9999px;white-space:nowrap;">${escapeHtml(labelSeveridad(severidad))}</span>`;
}

/**
 * Una sección del resumen semanal. Misma forma que las del resumen interno
 * —tabla con link por fila— pero las columnas son otras: acá la unidad no es
 * una instalación muda sino una alerta abierta.
 */
function seccionSemanalHtml(titulo, eyebrow, items, textoVacio) {
  if (items.length === 0) {
    return `          <tr>
            <td style="padding:24px 40px 0;">
              <p style="margin:0 0 6px;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#94A3B8;font-weight:700;">${escapeHtml(eyebrow)}</p>
              <h2 style="margin:0;font-size:18px;line-height:1.3;color:#1E293B;font-weight:600;">${escapeHtml(titulo)}</h2>
              <p style="margin:14px 0 0;padding:14px;background-color:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px;color:#16a34a;font-size:13px;">&#10003; ${escapeHtml(textoVacio)}</p>
            </td>
          </tr>`;
  }
  const rows = items
    .map((r) => {
      const valor = r.valor
        ? `<span style="color:#64748B;"> &middot; ${escapeHtml(String(r.valor))}</span>`
        : '';
      return `
                <tr>
                  <td style="padding:10px 14px;border-bottom:1px solid #E2E8F0;font-size:13px;color:#1E293B;font-weight:600;vertical-align:top;">${escapeHtml(r.sitio)}</td>
                  <td style="padding:10px 14px;border-bottom:1px solid #E2E8F0;font-size:12px;color:#1E293B;vertical-align:top;">${escapeHtml(r.alerta)}${valor}</td>
                  <td style="padding:10px 14px;border-bottom:1px solid #E2E8F0;vertical-align:top;">${pildoraSeveridadHtml(r.severidad)}</td>
                  <td style="padding:10px 14px;border-bottom:1px solid #E2E8F0;font-size:12px;color:#64748B;vertical-align:top;white-space:nowrap;">${escapeHtml(formatDiasAbierta(r.dias))}</td>
                  <td style="padding:10px 14px;border-bottom:1px solid #E2E8F0;text-align:right;vertical-align:top;"><a href="${r.url || ACCESS_URL}" style="display:inline-block;padding:5px 12px;background-color:#0DAFBD;color:#FFFFFF;font-size:11px;font-weight:700;border-radius:9999px;text-decoration:none;">Ver</a></td>
                </tr>`;
    })
    .join('');
  const th = (t, align) =>
    `<td style="padding:9px 14px;background-color:#F8FAFC;border-bottom:1px solid #E2E8F0;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#94A3B8;font-weight:700;${align ? `text-align:${align};` : ''}">${t}</td>`;
  return `          <tr>
            <td style="padding:24px 40px 0;">
              <p style="margin:0 0 6px;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#94A3B8;font-weight:700;">${escapeHtml(eyebrow)}</p>
              <h2 style="margin:0 0 10px;font-size:18px;line-height:1.3;color:#1E293B;font-weight:600;">${escapeHtml(titulo)}
                <span style="font-weight:400;color:#94A3B8;font-size:14px;">&middot; ${items.length}</span>
              </h2>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFFFFF;border:1px solid #E2E8F0;border-radius:10px;overflow:hidden;">
                <tr>
                  ${th('Sitio')}${th('Alerta')}${th('Severidad')}${th('Abierta')}${th('', 'right')}
                </tr>
                ${rows}
              </table>
            </td>
          </tr>`;
}

/** El acento lo pone lo peor que esté pasando ahora, no el total de filas. */
function acentoSemanal(enFalla, pendientesAcuse) {
  const orden = ['critica', 'alta', 'media', 'baja'];
  const peor = orden.find((s) => enFalla.some((r) => r.severidad === s));
  if (peor) return SEVERIDAD_COLOR[peor];
  if (pendientesAcuse.length > 0) return '#d97706';
  return '#22C55E';
}

function buildSemanalHtml({ nombre, generatedAt, enFalla, pendientesAcuse }) {
  const accentColor = acentoSemanal(enFalla, pendientesAcuse);
  const accentGradient = `linear-gradient(90deg,${accentColor} 0%,${accentColor} 100%)`;
  const total = enFalla.length + pendientesAcuse.length;
  const saludo = (nombre || '').trim() || 'usuario';

  const intro =
    total === 0
      ? 'No hay alertas abiertas en tus instalaciones. Este correo llega igual cada semana, así sabes que el monitoreo está vivo.'
      : enFalla.length === 0
        ? 'No hay nada fallando ahora. Quedan alertas esperando que las des por recibidas para que la regla vuelva a armarse.'
        : `Hay <strong style="color:#1E293B;">${enFalla.length} ${enFalla.length === 1 ? 'alerta' : 'alertas'}</strong> con la condición todavía activa en tus instalaciones.`;

  const contentHtml = `          <tr>
            <td style="padding:36px 40px 4px;">
              <p style="margin:0 0 6px;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#94A3B8;font-weight:700;">Resumen semanal</p>
              <h1 style="margin:0 0 14px;font-size:24px;line-height:1.25;color:#1E293B;font-weight:600;letter-spacing:-0.01em;">${total === 0 ? 'Sin alertas activas' : 'Alertas abiertas en tus instalaciones'}</h1>
              <p style="margin:0;font-size:15px;line-height:1.55;color:#475569;">Hola <strong style="color:#1E293B;">${escapeHtml(saludo)}</strong>, ${intro}</p>
              <p style="margin:8px 0 0;font-size:12px;color:#94A3B8;">Generado el ${escapeHtml(formatChile(generatedAt || new Date().toISOString()))}</p>
            </td>
          </tr>
${seccionSemanalHtml('En falla ahora', 'Requieren atención', enFalla, 'Ninguna alerta con la condición activa.')}
${seccionSemanalHtml('Normalizadas, pendientes de acuse', 'Esperando tu confirmación', pendientesAcuse, 'Ninguna alerta esperando acuse de recibo.')}
${ctaButtonHtml(ACCESS_URL, 'Ir a la plataforma', accentColor)}
${securityNoteHtml('Resumen automático semanal. Una alerta deja de aparecer acá cuando la das por recibida en la plataforma y su condición se normaliza. Para dejar de recibir este correo, pídelo a tu contacto Emeltec.')}`;

  return renderShell({
    title: 'Resumen semanal · Emeltec',
    preheader:
      total === 0
        ? 'Sin alertas activas en tus instalaciones esta semana.'
        : `${enFalla.length} en falla · ${pendientesAcuse.length} por confirmar.`,
    accentColor,
    accentGradient,
    contentHtml,
  });
}

// Internal — usado por scripts de preview/render y por los tests. No estable.
exports._renderWeeklyDigestHtml = (input) => buildSemanalHtml(input);

/**
 * Resumen semanal de alertas abiertas, para el cliente.
 *
 * Se manda igual cuando no hay nada: un correo que solo llega con malas
 * noticias se lee como ruido y termina filtrado.
 */
exports.sendWeeklyDigest = async ({
  to,
  nombre,
  generatedAt,
  enFalla = [],
  pendientesAcuse = [],
}) => {
  try {
    if (!to) {
      console.warn('[emailService] sendWeeklyDigest: "to" vacío, email omitido');
      return;
    }
    const total = enFalla.length + pendientesAcuse.length;
    const subject =
      total === 0
        ? 'Resumen semanal Emeltec — Sin alertas activas'
        : `Resumen semanal Emeltec — ${enFalla.length} en falla · ${pendientesAcuse.length} por confirmar`;

    const lineas = [
      `Resumen semanal de alertas — ${formatChile(generatedAt || new Date().toISOString())}`,
      '',
    ];
    const seccionTexto = (titulo, items, vacio) => {
      lineas.push(`${titulo} — ${items.length}`);
      if (items.length === 0) {
        lineas.push(`  ${vacio}`);
      } else {
        for (const r of items) {
          lineas.push(
            `  - ${r.sitio} — ${r.alerta} [${labelSeveridad(r.severidad)}]${r.valor ? ` · ${r.valor}` : ''} — abierta ${formatDiasAbierta(r.dias)}`,
          );
          lineas.push(`    ${r.url || ACCESS_URL}`);
        }
      }
      lineas.push('');
    };
    seccionTexto('EN FALLA AHORA', enFalla, 'Ninguna alerta con la condición activa.');
    seccionTexto(
      'NORMALIZADAS, PENDIENTES DE ACUSE',
      pendientesAcuse,
      'Ninguna alerta esperando acuse de recibo.',
    );
    lineas.push(`Plataforma: ${ACCESS_URL}`);

    await enviar({
      to,
      subject,
      text: lineas.join('\n'),
      html: buildSemanalHtml({ nombre, generatedAt, enFalla, pendientesAcuse }),
    });
  } catch (error) {
    console.error('[emailService] Error enviando el resumen semanal:', error.message);
  }
};

/**
 * Aviso de inactividad próxima a anonimización (B5.2 — Retención ARCO+).
 * Se envía ~30 días antes de que la cuenta sea anonimizada por inactividad.
 *
 * @param {string} emailDestino
 * @param {string} nombre
 * @param {number} diasRestantes
 */
exports.sendAvisoInactividad = async (emailDestino, nombre, diasRestantes) => {
  try {
    const nombreSafe = escapeHtml((nombre || '').trim() || 'usuario');
    const dias = Math.max(1, Math.round(diasRestantes));

    const contentHtml = `          <tr>
            <td style="padding:36px 40px 4px;">
              <p style="margin:0 0 6px;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#d97706;font-weight:700;">Aviso de privacidad — Ley 21.719</p>
              <h1 style="margin:0 0 14px;font-size:22px;line-height:1.25;color:#1E293B;font-weight:600;">Hola ${nombreSafe},</h1>
              <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#475569;">Tu cuenta en <strong style="color:#1E293B;">Emeltec Cloud</strong> no ha sido utilizada en más de 23 meses.</p>
              <p style="margin:0;font-size:15px;line-height:1.55;color:#475569;">De acuerdo a nuestra política de retención de datos (Ley 21.719 de Protección de Datos Personales), en <strong style="color:#1E293B;">${dias} días</strong> procederemos a <strong style="color:#dc2626;">anonimizar los datos personales</strong> asociados a tu cuenta.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 40px 4px;">
              <div style="background-color:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;padding:18px 20px;">
                <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#92400E;">¿Qué significa esto?</p>
                <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.6;color:#78350F;">
                  <li>Tu nombre, email, RUT y teléfono serán reemplazados por valores neutros.</li>
                  <li>Tu cuenta quedará inactiva y no podrás ingresar a la plataforma.</li>
                  <li>Historial de auditoría y métricas industriales <strong>no</strong> serán eliminados.</li>
                </ul>
              </div>
            </td>
          </tr>
${ctaButtonHtml(ACCESS_URL, 'Ingresar y mantener mi cuenta activa', '#0DAFBD')}
${securityNoteHtml('Si ya no usas esta plataforma, no es necesario que hagas nada. Si tienes preguntas, responde este correo o contacta a soporte@emeltec.cl.')}`;

    const html = renderShell({
      title: 'Aviso de inactividad · Emeltec Cloud',
      preheader: `Tu cuenta será anonimizada en ${dias} días por inactividad.`,
      accentColor: '#d97706',
      accentGradient: 'linear-gradient(90deg,#d97706 0%,#92400e 100%)',
      contentHtml,
    });

    await enviar({
      to: emailDestino,
      subject: `Aviso: tu cuenta en Emeltec Cloud será anonimizada en ${dias} días`,
      text: [
        `Hola ${(nombre || '').trim() || 'usuario'},`,
        '',
        `Tu cuenta en Emeltec Cloud no ha sido utilizada en más de 23 meses.`,
        `En ${dias} días, tus datos personales serán anonimizados (Ley 21.719).`,
        '',
        `Si deseas mantener tu cuenta activa, ingresa a: ${ACCESS_URL}`,
        '',
        'Si tienes preguntas, contacta a soporte@emeltec.cl.',
      ].join('\n'),
      html,
    });
  } catch (error) {
    console.error('[emailService] Error enviando aviso de inactividad:', error.message);
  }
};

/**
 * Alerta de seguridad para SuperAdmins (B4.2 — Alertas automáticas audit log).
 *
 * @param {string} to - email del SuperAdmin destinatario
 * @param {string} tipo - 'logins_fallidos' | 'cambio_rol'
 * @param {object} detalles - información adicional de la alerta
 */
/**
 * Etiquetas legibles para las filas de detalle de una alerta. Sin esto el mail
 * mostraba la clave cruda en mayúsculas ("ULTIMO_TARGET"), que no le dice nada
 * a quien lo recibe. Las claves sin entrada acá caen al fallback: guiones bajos
 * convertidos en espacios.
 */
const ALERTA_DETALLE_LABELS = {
  total_cambios: 'Cambios detectados',
  actor_nombre: 'Responsable del cambio',
  actor_email: 'Correo del responsable',
  actor_id: 'ID del responsable',
  actor_ip: 'IP de origen',
  target_nombre: 'Usuario afectado',
  target_email: 'Correo del afectado',
  target_id: 'ID del afectado',
  rol_anterior: 'Rol anterior',
  rol_nuevo: 'Rol nuevo',
  rol_actual: 'Rol actual en el sistema',
  fecha: 'Fecha y hora',
  intentos: 'Intentos',
  ventana_minutos: 'Ventana (minutos)',
};

const etiquetaDetalle = (clave) => ALERTA_DETALLE_LABELS[clave] || String(clave).replace(/_/g, ' ');

exports.sendAlertaSeguridad = async (to, tipo, detalles) => {
  try {
    const tipoLabel =
      tipo === 'logins_fallidos' ? 'Intentos de acceso fallidos' : 'Cambio de rol detectado';
    const tipoColor = tipo === 'logins_fallidos' ? '#dc2626' : '#d97706';
    const tipoGradient =
      tipo === 'logins_fallidos'
        ? 'linear-gradient(90deg,#dc2626 0%,#7f1d1d 100%)'
        : 'linear-gradient(90deg,#d97706 0%,#92400e 100%)';

    const detallesRows = Object.entries(detalles || {})
      .map(
        ([k, v]) =>
          `<tr><td style="padding:8px 14px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#94A3B8;font-weight:700;width:40%;">${escapeHtml(etiquetaDetalle(k))}</td><td style="padding:8px 14px;font-size:13px;color:#1E293B;">${escapeHtml(String(v ?? '—'))}</td></tr>`,
      )
      .join('');

    const contentHtml = `          <tr>
            <td style="padding:36px 40px 4px;">
              <p style="margin:0 0 6px;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:${tipoColor};font-weight:700;">Alerta de seguridad</p>
              <h1 style="margin:0 0 14px;font-size:22px;line-height:1.25;color:#1E293B;font-weight:600;">${escapeHtml(tipoLabel)}</h1>
              <p style="margin:0;font-size:14px;line-height:1.55;color:#475569;">Se detectó una condición de seguridad que requiere tu revisión en Emeltec Cloud.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 40px 4px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFFFFF;border:1px solid #E2E8F0;border-radius:10px;border-left:3px solid ${tipoColor};overflow:hidden;">
                ${detallesRows}
              </table>
            </td>
          </tr>
${ctaButtonHtml(ACCESS_URL, 'Revisar en la plataforma', tipoColor)}
${securityNoteHtml('Esta alerta fue generada automáticamente por el sistema de monitoreo de Emeltec Cloud. Si no reconoces esta actividad, revisa los registros de auditoría de inmediato.')}`;

    const html = renderShell({
      title: `Alerta: ${tipoLabel} · Emeltec Cloud`,
      preheader: `Alerta de seguridad: ${tipoLabel}`,
      accentColor: tipoColor,
      accentGradient: tipoGradient,
      contentHtml,
    });

    await enviar({
      to,
      subject: `[ALERTA] ${tipoLabel} — Emeltec Cloud`,
      text: [
        `ALERTA DE SEGURIDAD: ${tipoLabel}`,
        '',
        ...Object.entries(detalles || {}).map(([k, v]) => `${etiquetaDetalle(k)}: ${v}`),
        '',
        `Revisa en: ${ACCESS_URL}`,
      ].join('\n'),
      html,
    });
  } catch (error) {
    console.error('[emailService] Error enviando alerta de seguridad:', error.message);
  }
};
