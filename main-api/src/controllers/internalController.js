const emailService = require('../services/emailService');

// auth-api no envía correos: delega acá. `purpose` decide la plantilla, porque
// un OTP de login y uno de restablecimiento de contraseña no dicen lo mismo ni
// llevan la misma nota de seguridad.
const OTP_TEMPLATES = {
  acceso: emailService.sendWelcomeEmail,
  password_reset: emailService.sendPasswordResetEmail,
};

exports.sendOtpEmail = async (req, res, next) => {
  try {
    const { email, nombre, code, minutes, purpose } = req.body;

    if (!email || !nombre || !code) {
      return res.status(400).json({ ok: false, error: 'Faltan campos: email, nombre, code' });
    }

    const templateKey = purpose || 'acceso';
    const enviarPlantilla = OTP_TEMPLATES[templateKey];
    if (!enviarPlantilla) {
      return res.status(400).json({ ok: false, error: `purpose no soportado: ${templateKey}` });
    }

    const info = await enviarPlantilla(email, nombre, code, minutes || 30);

    if (!info?.ok) {
      return res.status(502).json({
        ok: false,
        error: 'No se pudo enviar el codigo por correo.',
        message: info?.error || 'El proveedor de correo rechazo el envio.',
      });
    }

    res.json({ ok: true, id: info.id || null });
  } catch (err) {
    next(err);
  }
};

/**
 * Aviso de "tu contraseña cambió". Best-effort: si el correo falla NO se
 * devuelve error al llamador, porque la contraseña ya se cambió y reintentar
 * el flujo completo sería peor. El fallo queda en el log de main-api.
 */
exports.sendPasswordChangedEmail = async (req, res, next) => {
  try {
    const { email, nombre, origen, ip, ts } = req.body;

    if (!email) {
      return res.status(400).json({ ok: false, error: 'Falta campo: email' });
    }

    const info = await emailService.sendPasswordChangedEmail(email, nombre, { origen, ip, ts });
    if (!info?.ok) {
      console.error('[internal] Aviso de cambio de contrasena no enviado:', info?.error);
    }

    res.json({ ok: true, id: info?.id || null, delivered: !!info?.ok });
  } catch (err) {
    next(err);
  }
};
