const nodemailer = require('nodemailer');

let transporter = null;
const ACCESS_URL = process.env.FRONTEND_URL || 'https://nuevacloud.emeltec.cl/login';

async function initTransporter() {
  if (transporter) return transporter;

  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    const isPort465 = process.env.SMTP_PORT === '465';
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT || 587,
      secure: isPort465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    return transporter;
  }

  console.log('No se detectaron credenciales SMTP fijas. Generando cuenta de pruebas en Ethereal...');
  const testAccount = await nodemailer.createTestAccount();

  transporter = nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass,
    },
  });

  console.log('SMTP Ethereal de pruebas configurado con exito.');
  return transporter;
}

exports.sendWelcomeEmail = async (emailDestino, nombreCompleto, passwordGenerado) => {
  try {
    const tp = await initTransporter();

    const result = await tp.sendMail({
      from: '"Panel de Control Telemetria" <no-reply@monitoreo-industrial.com>',
      to: emailDestino,
      subject: 'Tu codigo de acceso Emeltec',
      text: `Hola ${nombreCompleto}, tu cuenta ha sido creada. Ingresa en ${ACCESS_URL} con el usuario ${emailDestino} y el codigo ${passwordGenerado}. El codigo es valido por 72 horas.`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
          <h2 style="color: #2563eb;">Bienvenido a tu Panel de Telemetria</h2>
          <p>Hola <strong>${nombreCompleto}</strong>,</p>
          <p>Tu cuenta corporativa ha sido creada exitosamente. Usa este codigo inicial para iniciar sesion:</p>
          <div style="background-color: #f8fafc; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>URL de Acceso:</strong> <a href="${ACCESS_URL}">${ACCESS_URL}</a></p>
            <p><strong>Usuario:</strong> ${emailDestino}</p>
            <p><strong>Codigo de Acceso:</strong> <span style="font-size: 1.5em; letter-spacing: 5px; color: #2563eb; font-weight: 900;">${passwordGenerado}</span></p>
          </div>
          <p style="color: #64748b; font-size: 0.9em;">Este codigo de 6 caracteres alfanumericos es valido por 72 horas.</p>
        </div>
      `,
    });

    console.log('-----------------------------------------');
    console.log('Correo enviado con exito a:', emailDestino);
    console.log('Ver correo simulado aqui: %s', nodemailer.getTestMessageUrl(result));
    console.log('-----------------------------------------');

    return { ok: true, previewUrl: nodemailer.getTestMessageUrl(result) };
  } catch (error) {
    console.error('Error al enviar el correo:', error);
    return { ok: false, error: error.message };
  }
};
