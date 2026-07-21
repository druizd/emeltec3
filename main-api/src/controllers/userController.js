const db = require('../config/db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { formatRutForStorage } = require('../utils/rut');
const emailService = require('../services/emailService');
const { query: dbHelperQuery } = require('../config/dbHelpers');

const WELCOME_OTP_MINUTES = 60 * 24; // 24h para activar la cuenta

const USER_PROFILE_SELECT = `
  SELECT u.id,
         u.nombre,
         COALESCE(u.apellido, '') AS apellido,
         u.rut_usuario,
         u.email,
         u.telefono,
         u.cargo,
         u.tipo,
         u.empresa_id,
         u.sub_empresa_id,
         COALESCE(u.activo, true) AS activo,
         u.last_login_at,
         u.activated_at,
         u.auth_mode,
         u.password_set_at,
         (u.password_hash IS NOT NULL) AS has_password,
         u.politica_aceptada_at,
         e.nombre AS empresa_nombre,
         se.nombre AS sub_empresa_nombre
  FROM usuario u
  LEFT JOIN empresa e ON e.id = u.empresa_id
  LEFT JOIN sub_empresa se ON se.id = u.sub_empresa_id
`;

async function getUserProfileById(userId) {
  const { rows } = await db.query(`${USER_PROFILE_SELECT} WHERE u.id = $1`, [userId]);
  return rows[0] || null;
}

exports.getEmpresas = async (req, res, next) => {
  try {
    const { tipo, empresa_id } = req.user;
    let empresaRows;

    if (tipo === 'SuperAdmin') {
      const { rows } = await db.query(
        'SELECT id, nombre, rut, sitios, tipo_empresa FROM empresa ORDER BY nombre ASC',
      );
      empresaRows = rows;
    } else if (
      (tipo === 'Admin' || tipo === 'Gerente' || tipo === 'Cliente' || tipo === 'Vendedor') &&
      empresa_id
    ) {
      const { rows } = await db.query(
        'SELECT id, nombre, rut, sitios, tipo_empresa FROM empresa WHERE id = $1',
        [empresa_id],
      );
      empresaRows = rows;
    } else {
      return res.json({ ok: true, data: [] });
    }

    const data = await Promise.all(
      empresaRows.map(async (emp) => {
        const { rows: subs } = await db.query(
          'SELECT id, nombre FROM sub_empresa WHERE empresa_id = $1 ORDER BY nombre ASC',
          [emp.id],
        );
        return { ...emp, sub_empresas: subs };
      }),
    );

    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};

/**
 * Técnicos asignables a incidencias = equipo Emeltec (tipo SuperAdmin,
 * activos). Expone solo lo necesario para el dropdown (id, nombre, cargo) —
 * sin email/teléfono, porque lo consumen admins de empresas cliente.
 */
exports.getTecnicos = async (req, res, next) => {
  try {
    if (req.user.tipo === 'Cliente') {
      return res.status(403).json({ ok: false, error: 'No tiene permisos para ver técnicos' });
    }
    const { rows } = await db.query(
      `SELECT id, nombre, COALESCE(apellido, '') AS apellido, cargo
         FROM usuario
        WHERE tipo = 'SuperAdmin' AND COALESCE(activo, true) = true
        ORDER BY nombre ASC`,
    );
    res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

/**
 * Equipo Emeltec para la sección de /administration (solo SuperAdmin):
 * miembros (SuperAdmin + Vendedor) con perfil completo + la empresa interna
 * Emeltec (resuelta por nombre) a la que se asocian las altas nuevas.
 */
// Minimización PII (Ley 21.719): el teléfono NO sale en los listados de
// usuarios para ningún rol. Se revela puntualmente con 2FA vía
// POST /api/v2/users/:id/reveal. telefono_oculto marca que hay dato revelable.
// El perfil propio (/me) NO se enmascara.
function maskUserPhones(rows) {
  return rows.map((u) => ({ ...u, telefono: null, telefono_oculto: Boolean(u.telefono) }));
}

exports.getEquipoEmeltec = async (req, res, next) => {
  try {
    if (req.user.tipo !== 'SuperAdmin') {
      return res.status(403).json({ ok: false, error: 'Solo SuperAdmin' });
    }
    const [{ rows: miembros }, { rows: empresas }] = await Promise.all([
      db.query(
        `SELECT u.id, u.nombre, COALESCE(u.apellido, '') AS apellido, u.email,
                u.telefono, u.cargo, u.tipo, u.empresa_id,
                COALESCE(u.activo, true) AS activo, u.last_login_at, u.activated_at
           FROM usuario u
          WHERE u.tipo IN ('SuperAdmin', 'Vendedor')
          ORDER BY u.tipo, u.nombre ASC`,
      ),
      db.query(`SELECT id, nombre FROM empresa WHERE nombre ILIKE 'emeltec%' ORDER BY id LIMIT 1`),
    ]);
    res.json({
      ok: true,
      data: {
        empresa_emeltec: empresas[0] ?? null,
        miembros: maskUserPhones(miembros),
      },
    });
  } catch (err) {
    next(err);
  }
};

// ============================================================================
// Instalaciones asignadas a un usuario (rol Vendedor). Solo SuperAdmin gestiona.
// El vendedor las ve (read-only) sumadas a las maletas piloto.
// ============================================================================
exports.listUserSites = async (req, res, next) => {
  try {
    if (req.user.tipo !== 'SuperAdmin') {
      return res.status(403).json({ ok: false, error: 'Solo SuperAdmin' });
    }
    const { id } = req.params;
    const { rows } = await db.query(
      `SELECT s.id, s.descripcion, s.empresa_id, s.tipo_sitio, s.es_maleta_piloto,
              e.nombre AS empresa_nombre
         FROM usuario_sitio us
         JOIN sitio s        ON s.id = us.sitio_id
         LEFT JOIN empresa e ON e.id = s.empresa_id
        WHERE us.usuario_id = $1
        ORDER BY s.descripcion ASC`,
      [id],
    );
    res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

exports.addUserSite = async (req, res, next) => {
  try {
    if (req.user.tipo !== 'SuperAdmin') {
      return res.status(403).json({ ok: false, error: 'Solo SuperAdmin' });
    }
    const { id } = req.params;
    const sitioId = String(req.body?.sitio_id || '').trim();
    if (!sitioId) return res.status(400).json({ ok: false, error: 'sitio_id requerido' });
    const u = await db.query('SELECT 1 FROM usuario WHERE id = $1', [id]);
    if (u.rows.length === 0)
      return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
    const s = await db.query('SELECT 1 FROM sitio WHERE id = $1', [sitioId]);
    if (s.rows.length === 0)
      return res.status(404).json({ ok: false, error: 'Sitio no encontrado' });
    await db.query(
      `INSERT INTO usuario_sitio (usuario_id, sitio_id, created_by)
       VALUES ($1, $2, $3) ON CONFLICT (usuario_id, sitio_id) DO NOTHING`,
      [id, sitioId, req.user.id ?? null],
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
};

exports.removeUserSite = async (req, res, next) => {
  try {
    if (req.user.tipo !== 'SuperAdmin') {
      return res.status(403).json({ ok: false, error: 'Solo SuperAdmin' });
    }
    const { id, sitioId } = req.params;
    await db.query('DELETE FROM usuario_sitio WHERE usuario_id = $1 AND sitio_id = $2', [
      id,
      sitioId,
    ]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

exports.getAllUsers = async (req, res, next) => {
  try {
    const { tipo, empresa_id, sub_empresa_id: userSubEmpresaId } = req.user;
    const { sub_empresa_id, empresa_id: queryEmpresaId } = req.query;

    if (tipo === 'Cliente') {
      return res.status(403).json({ ok: false, error: 'No tiene permisos para ver usuarios' });
    }

    let query = `
      SELECT u.id,
             u.nombre,
             COALESCE(u.apellido, '') AS apellido,
             u.rut_usuario,
             u.email,
             u.telefono,
             u.cargo,
             u.tipo,
             u.empresa_id,
             u.sub_empresa_id,
             COALESCE(u.activo, true) AS activo,
             u.last_login_at,
             u.activated_at,
             u.auth_mode,
             u.password_set_at,
             (u.password_hash IS NOT NULL) AS has_password,
             e.nombre AS empresa_nombre,
             se.nombre AS sub_empresa_nombre
      FROM usuario u
      LEFT JOIN empresa e ON e.id = u.empresa_id
      LEFT JOIN sub_empresa se ON se.id = u.sub_empresa_id
    `;
    const conditions = [];
    const params = [];

    if (tipo === 'SuperAdmin') {
      if (sub_empresa_id) {
        params.push(sub_empresa_id);
        conditions.push(`u.sub_empresa_id = $${params.length}`);
      } else if (queryEmpresaId) {
        params.push(queryEmpresaId);
        conditions.push(`u.empresa_id = $${params.length}`);
      }
    } else if (tipo === 'Admin' || tipo === 'Vendedor') {
      params.push(empresa_id);
      conditions.push(`u.empresa_id = $${params.length}`);
      if (sub_empresa_id) {
        params.push(sub_empresa_id);
        conditions.push(`u.sub_empresa_id = $${params.length}`);
      }
    } else if (tipo === 'Gerente') {
      if (!userSubEmpresaId) {
        return res.json({ ok: true, data: [] });
      }
      params.push(userSubEmpresaId);
      conditions.push(`u.sub_empresa_id = $${params.length}`);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY u.nombre ASC';

    const { rows } = await db.query(query, params);
    res.json({ ok: true, data: maskUserPhones(rows) });
  } catch (err) {
    next(err);
  }
};

exports.getCurrentUser = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'Usuario no autenticado' });
    }

    const profile = await getUserProfileById(userId);
    if (!profile) {
      return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
    }

    res.json({ ok: true, data: profile });
  } catch (err) {
    next(err);
  }
};

exports.updateCurrentUser = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'Usuario no autenticado' });
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'email')) {
      return res.status(400).json({ ok: false, error: 'El correo no se puede editar.' });
    }

    const allowed = ['nombre', 'apellido', 'rut_usuario', 'telefono', 'cargo'];
    const updates = [];
    const values = [];

    for (const field of allowed) {
      if (!Object.prototype.hasOwnProperty.call(req.body, field)) continue;

      let value = req.body[field];
      if (typeof value === 'string') value = value.trim();
      if (field === 'nombre' && !value) {
        return res.status(400).json({ ok: false, error: 'El nombre es requerido.' });
      }
      if (field === 'rut_usuario') value = value ? formatRutForStorage(value) : null;
      if (field !== 'nombre' && value === '') value = null;

      values.push(value);
      updates.push(`${field} = $${values.length}`);
    }

    if (updates.length === 0) {
      return res.status(400).json({ ok: false, error: 'No hay datos para actualizar.' });
    }

    values.push(userId);
    await db.query(
      `UPDATE usuario SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${values.length}`,
      values,
    );

    const profile = await getUserProfileById(userId);
    res.json({ ok: true, data: profile });
  } catch (err) {
    next(err);
  }
};

exports.updateCurrentPassword = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const { current_password, new_password } = req.body;

    if (!userId) {
      return res.status(401).json({ ok: false, error: 'Usuario no autenticado' });
    }
    if (!new_password || String(new_password).length < 8) {
      return res
        .status(400)
        .json({ ok: false, error: 'La contraseña debe tener al menos 8 caracteres.' });
    }

    const { rows } = await db.query('SELECT password_hash, auth_mode FROM usuario WHERE id = $1', [
      userId,
    ]);
    const currentHash = rows[0]?.password_hash || null;
    const currentPasswordRequired =
      currentHash && ['password', 'password_otp'].includes(rows[0]?.auth_mode);

    if (currentPasswordRequired) {
      const matches = await bcrypt.compare(String(current_password || ''), currentHash);
      if (!matches) {
        return res.status(401).json({ ok: false, error: 'La contraseña actual no coincide.' });
      }
    }

    const nextHash = await bcrypt.hash(String(new_password), 12);
    await db.query(
      `UPDATE usuario
       SET password_hash = $1,
           password_set_at = NOW(),
           auth_mode = CASE
             WHEN auth_mode IN ('password', 'password_otp') THEN auth_mode
             ELSE 'password'
           END,
           activated_at = COALESCE(activated_at, NOW()),
           updated_at = NOW()
       WHERE id = $2`,
      [nextHash, userId],
    );

    const profile = await getUserProfileById(userId);
    res.json({ ok: true, data: profile });
  } catch (err) {
    next(err);
  }
};

exports.updateCurrentSecurity = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'Usuario no autenticado' });
    }

    const { rows } = await db.query('SELECT password_hash, auth_mode FROM usuario WHERE id = $1', [
      userId,
    ]);
    const current = rows[0];
    if (!current) return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });

    const authMode = req.body.auth_mode || current.auth_mode;
    if (!['password', 'otp', 'password_otp'].includes(authMode)) {
      return res.status(400).json({ ok: false, error: 'Metodo de inicio no valido.' });
    }
    if (['password', 'password_otp'].includes(authMode) && !current.password_hash) {
      return res.status(400).json({
        ok: false,
        error: 'Crea una contraseña antes de activar el ingreso con contraseña.',
      });
    }
    await db.query(
      `UPDATE usuario
       SET auth_mode = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [authMode, userId],
    );

    const profile = await getUserProfileById(userId);
    res.json({ ok: true, data: profile });
  } catch (err) {
    next(err);
  }
};

exports.createUser = async (req, res, next) => {
  try {
    const {
      nombre,
      apellido,
      rut_usuario,
      email,
      telefono,
      cargo,
      tipo,
      empresa_id,
      sub_empresa_id,
    } = req.body;
    const currentUser = req.user;

    if (!nombre || !apellido || !email || !tipo) {
      return res
        .status(400)
        .json({ ok: false, error: 'nombre, apellido, email y tipo son requeridos.' });
    }

    // Roles del equipo interno Emeltec: solo un SuperAdmin puede crearlos.
    if ((tipo === 'SuperAdmin' || tipo === 'Vendedor') && currentUser.tipo !== 'SuperAdmin') {
      return res
        .status(403)
        .json({ ok: false, error: 'Solo un SuperAdmin puede crear usuarios del equipo Emeltec.' });
    }

    if (currentUser.tipo === 'Admin') {
      if (empresa_id && empresa_id !== currentUser.empresa_id) {
        return res
          .status(403)
          .json({ ok: false, error: 'No puede crear usuarios en otra empresa.' });
      }
    } else if (currentUser.tipo === 'Gerente') {
      if (
        (empresa_id && empresa_id !== currentUser.empresa_id) ||
        (sub_empresa_id && sub_empresa_id !== currentUser.sub_empresa_id)
      ) {
        return res
          .status(403)
          .json({ ok: false, error: 'No puede crear usuarios fuera de su division.' });
      }
      if (tipo === 'Admin') {
        return res.status(403).json({ ok: false, error: 'No tiene permisos para crear este rol.' });
      }
    }

    const newId = 'U' + crypto.randomBytes(3).toString('hex').toUpperCase();
    const finalEmpresaId =
      currentUser.tipo === 'Gerente'
        ? currentUser.empresa_id
        : empresa_id || currentUser.empresa_id || null;
    const finalSubEmpresaId =
      currentUser.tipo === 'Gerente' ? currentUser.sub_empresa_id : sub_empresa_id || null;
    const rutUsuario = rut_usuario === undefined ? null : formatRutForStorage(rut_usuario);

    const { rows } = await db.query(
      `INSERT INTO usuario (
         id, nombre, apellido, rut_usuario, email, telefono, cargo, tipo,
         empresa_id, sub_empresa_id, auth_mode
       )
       VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'password'
       )
       RETURNING id`,
      [
        newId,
        nombre,
        apellido,
        rutUsuario || null,
        email,
        telefono || null,
        cargo || null,
        tipo,
        finalEmpresaId,
        finalSubEmpresaId,
      ],
    );

    const created = await getUserProfileById(rows[0].id);

    // OTP de bienvenida: el nuevo usuario lo usa para su primer ingreso.
    // Se guarda hasheado y expira en WELCOME_OTP_MINUTES.
    const otpCode = crypto.randomBytes(3).toString('hex').toUpperCase();
    const otpHash = await bcrypt.hash(otpCode, 10);
    const otpExpiresAt = new Date(Date.now() + WELCOME_OTP_MINUTES * 60 * 1000);
    try {
      await db.query('UPDATE usuario SET otp_hash = $1, otp_expires_at = $2 WHERE id = $3', [
        otpHash,
        otpExpiresAt,
        rows[0].id,
      ]);
    } catch (otpErr) {
      console.error('[createUser] Error guardando OTP bienvenida:', otpErr.message);
    }

    // Disparar correos en paralelo, sin bloquear la respuesta ni romper la creación
    // si el proveedor falla. Se loguea cualquier error.
    Promise.allSettled([
      emailService.sendWelcomeEmail(
        email,
        `${nombre} ${apellido}`.trim(),
        otpCode,
        WELCOME_OTP_MINUTES,
      ),
      currentUser.email
        ? emailService.sendNewUserNotificationToAdmin(
            currentUser.email,
            `${currentUser.nombre || ''} ${currentUser.apellido || ''}`.trim(),
            { nombre: `${nombre} ${apellido}`.trim(), email, tipo },
          )
        : Promise.resolve(null),
    ]).then((results) => {
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          console.error(`[createUser] correo ${i} fallo:`, r.reason?.message || r.reason);
        }
      });
    });

    res.status(201).json({
      ok: true,
      message: `Usuario ${nombre} ${apellido} creado. Se envio un correo con el codigo de acceso.`,
      data: created,
    });
  } catch (err) {
    if (err.code === '23505') {
      return res
        .status(409)
        .json({ ok: false, error: `El correo ${req.body.email} ya esta registrado.` });
    }
    next(err);
  }
};

// Jerarquía de gestión (editar/eliminar/reset). Devuelve mensaje de error o null
// si está permitido. SuperAdmin sin restricción.
function managePermissionError(currentUser, target) {
  if (currentUser.tipo === 'Admin') {
    if (target.empresa_id !== currentUser.empresa_id)
      return 'No puede gestionar usuarios de otra empresa';
    if (target.tipo === 'SuperAdmin' || target.tipo === 'Vendedor')
      return 'No puede gestionar usuarios del equipo Emeltec';
  } else if (currentUser.tipo === 'Gerente') {
    if (target.sub_empresa_id !== currentUser.sub_empresa_id)
      return 'No puede gestionar usuarios de otra división';
    if (target.tipo === 'SuperAdmin' || target.tipo === 'Admin' || target.tipo === 'Vendedor')
      return 'No tiene permiso sobre este usuario';
  }
  return null;
}

// Soft-delete: desactiva (no borra). Reversible vía updateUser activo=true.
exports.deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const currentUser = req.user;
    if (id === currentUser.id) {
      return res.status(400).json({ ok: false, error: 'No puede desactivar su propia cuenta' });
    }
    const check = await db.query(
      'SELECT empresa_id, sub_empresa_id, tipo FROM usuario WHERE id = $1',
      [id],
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
    }
    const permErr = managePermissionError(currentUser, check.rows[0]);
    if (permErr) return res.status(403).json({ ok: false, error: permErr });

    await db.query('UPDATE usuario SET activo = false, updated_at = NOW() WHERE id = $1', [id]);
    res.json({ ok: true, message: 'Usuario desactivado' });
  } catch (err) {
    next(err);
  }
};

// Editar usuario (admin). Campos: nombre, apellido, telefono, cargo, rut_usuario,
// tipo, empresa_id, sub_empresa_id, activo. NO email. Respeta jerarquía de roles.
exports.updateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const currentUser = req.user;
    const check = await db.query(
      'SELECT empresa_id, sub_empresa_id, tipo FROM usuario WHERE id = $1',
      [id],
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
    }
    const permErr = managePermissionError(currentUser, check.rows[0]);
    if (permErr) return res.status(403).json({ ok: false, error: permErr });

    const b = req.body || {};

    // Guard de elevación de rol según quién edita. SuperAdmin y Vendedor son
    // roles del equipo interno Emeltec: solo un SuperAdmin los asigna.
    if (b.tipo !== undefined) {
      if (currentUser.tipo !== 'SuperAdmin' && (b.tipo === 'SuperAdmin' || b.tipo === 'Vendedor')) {
        return res.status(403).json({ ok: false, error: 'No puede asignar ese rol.' });
      }
      if (currentUser.tipo === 'Gerente' && b.tipo === 'Admin') {
        return res.status(403).json({ ok: false, error: 'No puede asignar ese rol.' });
      }
    }
    // Admin/Gerente no pueden mover usuarios fuera de su alcance.
    if (b.empresa_id !== undefined && currentUser.tipo !== 'SuperAdmin') {
      if (b.empresa_id !== currentUser.empresa_id) {
        return res.status(403).json({ ok: false, error: 'No puede cambiar la empresa.' });
      }
    }
    if (
      b.sub_empresa_id !== undefined &&
      currentUser.tipo === 'Gerente' &&
      b.sub_empresa_id !== currentUser.sub_empresa_id
    ) {
      return res.status(403).json({ ok: false, error: 'No puede cambiar la división.' });
    }
    if (b.activo === false && id === currentUser.id) {
      return res.status(400).json({ ok: false, error: 'No puede desactivar su propia cuenta' });
    }

    const allowed = {
      nombre: b.nombre,
      apellido: b.apellido,
      // Telefono viene enmascarado al listar: si llega vacío es porque no se
      // editó → se preserva (undefined = no tocar). Un valor real sí actualiza.
      telefono: b.telefono === '' ? undefined : b.telefono,
      cargo: b.cargo,
      rut_usuario: b.rut_usuario === undefined ? undefined : formatRutForStorage(b.rut_usuario),
      tipo: b.tipo,
      empresa_id: b.empresa_id,
      sub_empresa_id: b.sub_empresa_id,
      activo: b.activo,
    };
    const sets = [];
    const params = [];
    for (const [col, val] of Object.entries(allowed)) {
      if (val !== undefined) {
        params.push(val);
        sets.push(`${col} = $${params.length}`);
      }
    }
    if (sets.length === 0) {
      return res.status(400).json({ ok: false, error: 'No hay campos para actualizar' });
    }
    params.push(id);
    await db.query(
      `UPDATE usuario SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`,
      params,
    );
    const updated = await getUserProfileById(id);
    res.json({ ok: true, data: maskUserPhones([updated])[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ ok: false, error: 'Dato duplicado' });
    }
    next(err);
  }
};

// Reset de contraseña por admin: regenera el OTP de acceso y lo reenvía por email.
/**
 * Reset de contraseña por administrador (re-onboarding, NO genera clave nueva).
 *
 * Reutiliza el flujo de bienvenida: genera un OTP de un solo uso, ANULA la
 * contraseña actual (`password_hash = NULL`) y reenvía el código por email.
 *
 * Efectos:
 *  - La contraseña vigente del usuario deja de servir inmediatamente.
 *  - El usuario debe ingresar con el OTP (flujo /start setup) y fijar una nueva.
 *  - El OTP vence a los `WELCOME_OTP_MINUTES`. Si no lo usa a tiempo, queda sin
 *    acceso hasta un nuevo reset.
 *
 * No es un "envío de la clave actual" ni un código que siga sirviendo tras
 * usarse: es destructivo sobre la password + OTP de un solo uso con vencimiento.
 * Exige 2FA (require2fa en la ruta) y respeta la jerarquía (managePermissionError).
 */
exports.resetUserPassword = async (req, res, next) => {
  try {
    const { id } = req.params;
    const currentUser = req.user;
    const check = await db.query(
      'SELECT nombre, apellido, email, empresa_id, sub_empresa_id, tipo FROM usuario WHERE id = $1',
      [id],
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
    }
    const target = check.rows[0];
    const permErr = managePermissionError(currentUser, target);
    if (permErr) return res.status(403).json({ ok: false, error: permErr });

    const otpCode = crypto.randomBytes(3).toString('hex').toUpperCase();
    const otpHash = await bcrypt.hash(otpCode, 10);
    const otpExpiresAt = new Date(Date.now() + WELCOME_OTP_MINUTES * 60 * 1000);
    await db.query(
      'UPDATE usuario SET otp_hash = $1, otp_expires_at = $2, password_hash = NULL, updated_at = NOW() WHERE id = $3',
      [otpHash, otpExpiresAt, id],
    );
    emailService
      .sendWelcomeEmail(
        target.email,
        `${target.nombre} ${target.apellido || ''}`.trim(),
        otpCode,
        WELCOME_OTP_MINUTES,
      )
      .catch((e) => console.error('[resetUserPassword] email fallo:', e.message));
    res.json({ ok: true, message: 'Se reenvió un código de acceso al usuario.' });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/users/me/export
 * Exportación ARCO (Ley 21.719 — B3.2): devuelve el perfil completo y el
 * historial de acciones del titular en audit_log (máx. 500 entradas).
 */
exports.exportDatosUsuario = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'Usuario no autenticado' });
    }

    let exportarFn;
    try {
      const path = require('path');
      const workerPath = path.join(__dirname, '..', '..', 'dist', 'modules', 'arco', 'exportacion');
      exportarFn = require(workerPath).exportarDatos;
    } catch (_e) {
      exportarFn = require('../modules/arco/exportacion').exportarDatos;
    }

    const result = await exportarFn({
      userId,
      req,
      dbQuery: (sql, params) => dbHelperQuery(sql, params),
    });

    res.json({ ok: true, data: result });
  } catch (err) {
    if (err && err.statusCode) {
      return res.status(err.statusCode).json({ ok: false, error: err.message });
    }
    next(err);
  }
};

/**
 * POST /api/users/me/aceptar-politica
 * Registro de aceptación de política de privacidad (Ley 21.719 — B7.2).
 * Idempotente: si ya tiene fecha no la sobreescribe.
 */
exports.aceptarPolitica = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'Usuario no autenticado' });
    }

    let aceptarFn;
    try {
      const path = require('path');
      const workerPath = path.join(__dirname, '..', '..', 'dist', 'modules', 'arco', 'politica');
      aceptarFn = require(workerPath).aceptarPolitica;
    } catch (_e) {
      aceptarFn = require('../modules/arco/politica').aceptarPolitica;
    }

    const result = await aceptarFn({
      userId,
      req,
      dbQuery: (sql, params) => dbHelperQuery(sql, params),
    });

    res.json({ ok: true, data: result.perfil });
  } catch (err) {
    if (err && err.statusCode) {
      return res.status(err.statusCode).json({ ok: false, error: err.message });
    }
    next(err);
  }
};

/**
 * POST /api/users/:id/suprimir
 * Supresión ARCO+ (Ley 21.719): anonimiza PII del usuario y sus audit_log.
 * Autorizado: el propio titular O un SuperAdmin (sobre cualquier cuenta).
 */
exports.suprimirUsuario = async (req, res, next) => {
  try {
    const { id } = req.params;
    const actor = req.user;

    // Importación dinámica del módulo TS compilado
    let suprimirFn;
    try {
      const path = require('path');
      const workerPath = path.join(
        __dirname,
        '..',
        '..',
        'dist',
        'modules',
        'retention',
        'supresion',
      );
      suprimirFn = require(workerPath).suprimirUsuario;
    } catch (_e) {
      // En desarrollo: importar directamente desde fuente TS via ts-node/vitest
      suprimirFn = require('../modules/retention/supresion').suprimirUsuario;
    }

    await suprimirFn({
      actorId: actor.id,
      actorEmail: actor.email,
      actorTipo: actor.tipo,
      targetId: id,
      req,
      dbQuery: (sql, params) => dbHelperQuery(sql, params),
    });

    res.json({
      ok: true,
      message: 'Cuenta suprimida. Los datos personales han sido anonimizados.',
    });
  } catch (err) {
    if (err && err.statusCode) {
      return res.status(err.statusCode).json({ ok: false, error: err.message });
    }
    next(err);
  }
};
