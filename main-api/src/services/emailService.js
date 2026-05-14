const { Resend } = require('resend');

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_ADDRESS = process.env.RESEND_FROM || 'Emeltec - Panel Industrial <noreply@emeltec.cl>';
const ACCESS_URL = process.env.FRONTEND_URL || 'https://cloud.emeltec.cl/login';

function resolveLogoUrl() {
  if (process.env.EMAIL_LOGO_URL) return process.env.EMAIL_LOGO_URL;
  try {
    return new URL('/images/emeltec-logo.png', ACCESS_URL).toString();
  } catch {
    return 'https://cloud.emeltec.cl/images/emeltec-logo.png';
  }
}

function resolveAccessHost() {
  try {
    return new URL(ACCESS_URL).host;
  } catch {
    return 'cloud.emeltec.cl';
  }
}

const LOGO_URL = resolveLogoUrl();
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
              <img src="${LOGO_URL}" alt="Emeltec" width="260" height="74" style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;height:74px;width:260px;max-width:260px;">
            </td>
          </tr>
          <tr>
            <td style="padding:0;line-height:0;font-size:0;height:4px;background:${accentBg};background-image:${accentBgImage};">&nbsp;</td>
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
                </tr>`
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

  const { data, error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: [to],
    subject,
    html,
    text,
  });

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
  ['Correo', `<a href="mailto:${escapeHtml(email)}" style="color:#0899A5;text-decoration:none;">${escapeHtml(email)}</a>`],
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

exports.sendAlertEmail = async (emailDestino, nombreCompleto, mensaje, regla) => {
  try {
    const nombre = (nombreCompleto || '').trim() || 'usuario';
    const accentColor = SEVERIDAD_COLOR[regla.severidad] || '#64748b';
    const accentGradient = SEVERIDAD_GRADIENT[regla.severidad] || `linear-gradient(90deg,${accentColor} 0%,${accentColor} 100%)`;
    const alias = regla.reg_alias || regla.variable_key || 'N/A';
    const sitio = regla.sitio_desc || regla.sitio_id || 'N/A';
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
    ['Equipo', escapeHtml(serial)],
    ['Variable', escapeHtml(alias)],
    ['Valor detectado', `<span style="font-family:'SF Mono','JetBrains Mono',Consolas,'Liberation Mono',Menlo,monospace;color:${accentColor};font-weight:600;">${escapeHtml(String(valorDetectado))}</span>`],
    ['Regla', escapeHtml(condicion)],
  ],
  accentColor
)}
${ctaButtonHtml(ACCESS_URL, 'Ver en la plataforma', accentColor)}
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
        `Equipo: ${serial}`,
        `Variable: ${alias}`,
        `Valor detectado: ${valorDetectado}`,
        `Regla: ${condicion}`,
        `Alerta: ${nombreAlerta}`,
        '',
        `Ver en plataforma: ${ACCESS_URL}`,
      ].join('\n'),
      html,
    });
  } catch (error) {
    console.error('[emailService] Error enviando alerta a', emailDestino, ':', error.message);
  }
};

const TIER_META = {
  t12: { color: '#dc2626', gradient: SEVERIDAD_GRADIENT.critica, label: '12 horas o más', short: '12h+', tone: 'crítico' },
  t6: { color: '#ea580c', gradient: SEVERIDAD_GRADIENT.alta, label: 'Entre 6 y 12 horas', short: '6-12h', tone: 'alarma' },
  t3: { color: '#d97706', gradient: SEVERIDAD_GRADIENT.media, label: 'Entre 3 y 6 horas', short: '3-6h', tone: 'atención' },
};

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
      timeZone: 'America/Santiago',
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

function renderIssuesGroup(items, tier) {
  if (items.length === 0) return '';
  const meta = TIER_META[tier];
  const rows = items
    .map(
      (r) => `
                <tr>
                  <td style="padding:10px 14px;border-bottom:1px solid #E2E8F0;font-size:13px;color:#1E293B;font-weight:500;vertical-align:top;">
                    <div style="font-weight:600;">${escapeHtml(r.descripcion)}</div>
                    <div style="margin-top:2px;font-size:11px;color:#94A3B8;">${escapeHtml(r.empresa || '—')}</div>
                  </td>
                  <td style="padding:10px 14px;border-bottom:1px solid #E2E8F0;font-size:12px;color:#475569;vertical-align:top;white-space:nowrap;">${escapeHtml(formatChile(r.lastAt))}</td>
                  <td style="padding:10px 14px;border-bottom:1px solid #E2E8F0;font-size:13px;color:${meta.color};font-family:'SF Mono','JetBrains Mono',Consolas,'Liberation Mono',Menlo,monospace;font-weight:600;vertical-align:top;white-space:nowrap;text-align:right;">${escapeHtml(formatLagMs(r.lagMs))}</td>
                </tr>`,
    )
    .join('');
  return `              <p style="margin:18px 0 8px;">
                <span style="display:inline-block;padding:4px 12px;background-color:${meta.color};color:#FFFFFF;font-size:10px;letter-spacing:0.16em;text-transform:uppercase;font-weight:700;border-radius:9999px;">&bull; ${escapeHtml(meta.short)} &middot; ${escapeHtml(meta.tone)}</span>
                <span style="display:inline-block;margin-left:8px;font-size:11px;color:#94A3B8;letter-spacing:0.05em;">${items.length} ${items.length === 1 ? 'instalación' : 'instalaciones'} &middot; ${escapeHtml(meta.label)}</span>
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFFFFF;border:1px solid #E2E8F0;border-radius:10px;border-left:3px solid ${meta.color};overflow:hidden;">
                <tr>
                  <td style="padding:9px 14px;background-color:#F8FAFC;border-bottom:1px solid #E2E8F0;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#94A3B8;font-weight:700;">Instalación</td>
                  <td style="padding:9px 14px;background-color:#F8FAFC;border-bottom:1px solid #E2E8F0;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#94A3B8;font-weight:700;">Último dato</td>
                  <td style="padding:9px 14px;background-color:#F8FAFC;border-bottom:1px solid #E2E8F0;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#94A3B8;font-weight:700;text-align:right;">Sin reportar</td>
                </tr>
                ${rows}
              </table>`;
}

function renderSection(title, eyebrow, items) {
  const byTier = { t12: [], t6: [], t3: [] };
  for (const it of items) {
    if (byTier[it.tier]) byTier[it.tier].push(it);
  }
  const groups = ['t12', 't6', 't3'].map((t) => renderIssuesGroup(byTier[t], t)).join('');
  const empty =
    items.length === 0
      ? `              <p style="margin:14px 0 0;padding:14px;background-color:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px;color:#16a34a;font-size:13px;">&#10003; Sin incidencias en esta sección.</p>`
      : groups;
  return `          <tr>
            <td style="padding:24px 40px 0;">
              <p style="margin:0 0 6px;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#94A3B8;font-weight:700;">${escapeHtml(eyebrow)}</p>
              <h2 style="margin:0;font-size:18px;line-height:1.3;color:#1E293B;font-weight:600;">${escapeHtml(title)}</h2>
${empty}
            </td>
          </tr>`;
}

function buildDigestHtml({ generatedAt, dataIssues, dgaIssues }) {
  const total = dataIssues.length + dgaIssues.length;
  const hasCritical = [...dataIssues, ...dgaIssues].some((r) => r.tier === 't12');
  const accentColor = total === 0 ? '#22C55E' : hasCritical ? '#dc2626' : '#ea580c';
  const accentGradient =
    total === 0
      ? 'linear-gradient(90deg,#22C55E 0%,#15803D 100%)'
      : hasCritical
        ? SEVERIDAD_GRADIENT.critica
        : SEVERIDAD_GRADIENT.alta;
  const generatedHuman = formatChile(generatedAt || new Date().toISOString());
  const heroEyebrow = total === 0 ? 'Resumen de salud' : `${total} ${total === 1 ? 'incidencia detectada' : 'incidencias detectadas'}`;
  const heroTitle = total === 0 ? 'Todo en orden' : 'Resumen de salud de la plataforma';
  const heroSubtitle =
    total === 0
      ? 'Todas las instalaciones reportan dentro de los umbrales esperados.'
      : 'Las siguientes instalaciones requieren tu atención.';

  const okBanner =
    total === 0
      ? `          <tr>
            <td style="padding:24px 40px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;">
                <tr>
                  <td style="padding:18px 20px;text-align:center;">
                    <p style="margin:0;font-size:14px;color:#16a34a;font-weight:600;">&#10003; No hay instalaciones con transmisión retrasada ni reportes DGA pendientes.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`
      : '';

  const contentHtml = `          <tr>
            <td style="padding:36px 40px 4px;">
              <p style="margin:0 0 6px;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#94A3B8;font-weight:700;">${escapeHtml(heroEyebrow)}</p>
              <h1 style="margin:0 0 14px;font-size:24px;line-height:1.25;color:#1E293B;font-weight:600;letter-spacing:-0.01em;">${escapeHtml(heroTitle)}</h1>
              <p style="margin:0;font-size:15px;line-height:1.55;color:#475569;">${escapeHtml(heroSubtitle)}</p>
              <p style="margin:8px 0 0;font-size:12px;color:#94A3B8;">Generado el ${escapeHtml(generatedHuman)}</p>
            </td>
          </tr>
${okBanner}
${renderSection('Transmisión de datos', 'Equipos y telemetría', dataIssues)}
${renderSection('Reportes DGA', 'Cumplimiento regulatorio', dgaIssues)}
${ctaButtonHtml(ACCESS_URL, 'Ir a la plataforma', accentColor)}
${securityNoteHtml('Reporte automático del sistema de monitoreo Emeltec. Los siguientes resúmenes se envían a las 07:00 y 16:00 hora Santiago.')}`;

  return renderShell({
    title: 'Resumen de salud · Emeltec',
    preheader:
      total === 0
        ? 'Todo en orden — sin instalaciones con retraso de transmisión ni DGA.'
        : `${total} instalación(es) con incidencias · revisa el detalle.`,
    accentColor,
    accentGradient,
    contentHtml,
  });
}

function buildEventHtml({ eventDetail }) {
  const r = eventDetail;
  const meta = TIER_META[r.tier] || TIER_META.t3;
  const kindLabel = r.kind === 'data' ? 'Sin transmisión de datos' : 'Reporte DGA atrasado';
  const eyebrow = r.kind === 'data' ? 'Transmisión de datos' : 'Cumplimiento DGA';
  const rows = [
    ['Instalación', escapeHtml(r.descripcion)],
    ['Empresa', escapeHtml(r.empresa || '—')],
    ['Tiempo sin reportar', `<span style="font-family:'SF Mono','JetBrains Mono',Consolas,'Liberation Mono',Menlo,monospace;color:${meta.color};font-weight:600;">${escapeHtml(formatLagMs(r.lagMs))}</span>`],
    ['Último dato', escapeHtml(formatChile(r.lastAt))],
  ];
  if (r.kind === 'dga') {
    rows.push(['Periodicidad', escapeHtml(r.periodicidad || '—')]);
    rows.push(['Próximo esperado', escapeHtml(formatChile(r.expectedAt))]);
  }

  const contentHtml = `          <tr>
            <td style="padding:36px 40px 4px;">
              <p style="margin:0 0 10px;">
                <span style="display:inline-block;padding:4px 12px;background-color:${meta.color};color:#FFFFFF;font-size:10px;letter-spacing:0.16em;text-transform:uppercase;font-weight:700;border-radius:9999px;">&bull; ${escapeHtml(meta.short)} &middot; ${escapeHtml(meta.tone)}</span>
                <span style="display:inline-block;margin-left:8px;font-size:11px;color:#94A3B8;letter-spacing:0.05em;">${escapeHtml(eyebrow)}</span>
              </p>
              <h1 style="margin:0 0 14px;font-size:24px;line-height:1.25;color:#1E293B;font-weight:600;letter-spacing:-0.01em;">${escapeHtml(kindLabel)}</h1>
              <p style="margin:0;font-size:15px;line-height:1.55;color:#475569;">La instalación <strong style="color:#1E293B;">${escapeHtml(r.descripcion)}</strong> cruzó el umbral de ${escapeHtml(meta.label.toLowerCase())} sin reportar.</p>
            </td>
          </tr>
${infoTableHtml(rows, meta.color)}
${ctaButtonHtml(ACCESS_URL, 'Ver en la plataforma', meta.color)}
${securityNoteHtml('Notificación automática del sistema de monitoreo Emeltec. Se enviará al subir de umbral (3h → 6h → 12h+).')}`;

  return renderShell({
    title: `${kindLabel} · Emeltec`,
    preheader: `${r.descripcion} · ${formatLagMs(r.lagMs)} sin reportar.`,
    accentColor: meta.color,
    accentGradient: meta.gradient,
    contentHtml,
  });
}

// Internal — usados por scripts de preview/render. No estable.
exports._renderHealthDigestHtml = (input) => buildDigestHtml(input);
exports._renderHealthEventHtml = (input) => buildEventHtml(input);

exports.sendHealthDigest = async ({ to, mode, generatedAt, dataIssues, dgaIssues, eventDetail }) => {
  try {
    let subject;
    let html;
    let text;

    if (mode === 'event') {
      if (!eventDetail) throw new Error('eventDetail requerido en mode=event');
      const meta = TIER_META[eventDetail.tier] || TIER_META.t3;
      const kindLabel = eventDetail.kind === 'data' ? 'Sin transmisión' : 'DGA atrasado';
      subject = `[${meta.short}] ${kindLabel} · ${eventDetail.descripcion}`;
      html = buildEventHtml({ eventDetail });
      text = [
        `${kindLabel} — ${eventDetail.descripcion}`,
        `Empresa: ${eventDetail.empresa || '—'}`,
        `Tiempo sin reportar: ${formatLagMs(eventDetail.lagMs)}`,
        `Último dato: ${formatChile(eventDetail.lastAt)}`,
        eventDetail.kind === 'dga'
          ? `Periodicidad: ${eventDetail.periodicidad || '—'} · Próximo esperado: ${formatChile(eventDetail.expectedAt)}`
          : '',
        '',
        `Plataforma: ${ACCESS_URL}`,
      ]
        .filter(Boolean)
        .join('\n');
    } else {
      const data = dataIssues || [];
      const dga = dgaIssues || [];
      const total = data.length + dga.length;
      subject =
        total === 0
          ? `Resumen Emeltec — Todo en orden`
          : `Resumen Emeltec — ${total} ${total === 1 ? 'incidencia' : 'incidencias'}`;
      html = buildDigestHtml({ generatedAt, dataIssues: data, dgaIssues: dga });
      const textLines = [
        `Resumen Emeltec — ${formatChile(generatedAt || new Date().toISOString())}`,
        '',
      ];
      if (total === 0) {
        textLines.push('Todo en orden. Sin incidencias.');
      } else {
        textLines.push(`Transmisión de datos: ${data.length} instalación(es)`);
        for (const r of data) {
          textLines.push(`  - [${TIER_META[r.tier]?.short}] ${r.descripcion} (${r.empresa || '—'}) — ${formatLagMs(r.lagMs)}`);
        }
        textLines.push('');
        textLines.push(`Reportes DGA: ${dga.length} informante(s)`);
        for (const r of dga) {
          textLines.push(`  - [${TIER_META[r.tier]?.short}] ${r.descripcion} (${r.empresa || '—'}) — ${formatLagMs(r.lagMs)}`);
        }
      }
      textLines.push('');
      textLines.push(`Plataforma: ${ACCESS_URL}`);
      text = textLines.join('\n');
    }

    await enviar({ to, subject, html, text });
  } catch (error) {
    console.error('[emailService] Error enviando health digest:', error.message);
  }
};
