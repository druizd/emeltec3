/**
 * Reglas de alerta por defecto de un sitio.
 *
 * Un sitio nuevo nacía sin ninguna regla, y las tres que todo pozo necesita
 * (equipo mudo, DGA sin comprobante, caudal sobre el derecho) había que
 * crearlas a mano una por una. Esto crea el set estándar, sin pisar nada:
 * una condición que el sitio ya tiene configurada (activa o pausada) se
 * respeta tal cual, así que llamar de nuevo es inofensivo.
 *
 * Se invoca al crear el sitio, al activar DGA en su pozo_config, y desde el
 * botón "Crear alertas por defecto" del panel de alertas.
 *
 * CommonJS para que lo usen tanto los controllers JS como el módulo TS de DGA.
 */

const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];

/**
 * Definición del set estándar. `aplica` decide según el sitio; `variable_key`
 * puede ser función porque `sin_datos` guarda la primera clave del reg_map
 * (el backend exige una, aunque la evaluación mire el payload completo).
 */
const REGLAS_POR_DEFECTO = [
  {
    condicion: 'sin_datos',
    nombre: 'Sin comunicación del equipo',
    descripcion: 'El equipo lleva más de 60 minutos sin transmitir.',
    severidad: 'critica',
    cooldown_minutos: 60,
    aplica: (ctx) => Boolean(ctx.sitio.id_serial),
    variable_key: (ctx) => ctx.primeraVariable || 'equipo',
  },
  {
    condicion: 'dga_atrasado',
    nombre: 'DGA sin comprobante',
    descripcion: 'SNIA no ha devuelto comprobante en 24 h; escala a 48 h y 72 h.',
    severidad: 'media',
    cooldown_minutos: 60,
    aplica: (ctx) => ctx.dgaActivo,
    variable_key: () => 'dga',
  },
  {
    condicion: 'sobre_derecho_dga',
    nombre: 'Caudal sobre el derecho DGA',
    descripcion: 'El caudal instantáneo supera el derecho de aprovechamiento más la tolerancia.',
    severidad: 'alta',
    cooldown_minutos: 60,
    aplica: (ctx) => ctx.dgaActivo,
    variable_key: () => 'caudal',
  },
];

/**
 * @param {{ query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> }} db
 * @param {{ sitioId: string; userId?: string | null }} input
 * @returns {Promise<{ creadas: string[]; existentes: string[]; omitidas: string[] }>}
 *   condiciones creadas, ya existentes, y las que no aplican al sitio.
 */
async function crearAlertasPorDefecto(db, { sitioId, userId = null }) {
  const { rows: sitios } = await db.query(
    `SELECT s.id, s.empresa_id, s.sub_empresa_id, s.id_serial, s.tipo_sitio,
            COALESCE(pc.dga_activo, FALSE) AS dga_activo
       FROM sitio s
       LEFT JOIN pozo_config pc ON pc.sitio_id = s.id
      WHERE s.id = $1`,
    [sitioId],
  );
  const sitio = sitios[0];
  if (!sitio) {
    throw Object.assign(new Error(`Sitio ${sitioId} no existe`), { status: 404 });
  }

  const [{ rows: existentes }, { rows: variables }] = await Promise.all([
    db.query('SELECT condicion FROM alertas WHERE sitio_id = $1', [sitioId]),
    db.query('SELECT d1 FROM reg_map WHERE sitio_id = $1 ORDER BY alias LIMIT 1', [sitioId]),
  ]);
  const yaTiene = new Set(existentes.map((r) => r.condicion));

  const ctx = {
    sitio,
    dgaActivo: sitio.dga_activo === true,
    primeraVariable: variables[0]?.d1 ?? null,
  };

  const out = { creadas: [], existentes: [], omitidas: [] };
  for (const regla of REGLAS_POR_DEFECTO) {
    if (!regla.aplica(ctx)) {
      out.omitidas.push(regla.condicion);
      continue;
    }
    if (yaTiene.has(regla.condicion)) {
      out.existentes.push(regla.condicion);
      continue;
    }
    await db.query(
      `INSERT INTO alertas
         (nombre, descripcion, sitio_id, empresa_id, sub_empresa_id, variable_key,
          condicion, umbral_bajo, umbral_alto, severidad, cooldown_minutos, dias_activos,
          creado_por, visible_to_all, viewer_user_ids, notificar_user_ids, notificar_superadmins)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,NULL,$8,$9,$10,$11,TRUE,'{}','{}',TRUE)`,
      [
        regla.nombre,
        regla.descripcion,
        sitio.id,
        sitio.empresa_id,
        sitio.sub_empresa_id ?? null,
        regla.variable_key(ctx),
        regla.condicion,
        regla.severidad,
        regla.cooldown_minutos,
        DIAS,
        userId,
      ],
    );
    out.creadas.push(regla.condicion);
  }
  return out;
}

module.exports = { crearAlertasPorDefecto, REGLAS_POR_DEFECTO };
