const emailService = require('../services/emailService');

exports.sendOtpEmail = async (req, res, next) => {
  try {
    const { email, nombre, code, minutes } = req.body;

    if (!email || !nombre || !code) {
      return res.status(400).json({ ok: false, error: 'Faltan campos: email, nombre, code' });
    }

    const info = await emailService.sendWelcomeEmail(email, nombre, code, minutes || 30);

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
