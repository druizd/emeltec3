/**
 * Controladores del catalogo.
 * Manejan dominios disponibles y dispositivos registrados en la base.
 */
const pool = require('../config/db');
const { listDomains, getDomain } = require('../utils/domains');

let devicesTableChecked = false;
let devicesTableExists = false;

// Algunas instalaciones arrancan sin esta tabla; se detecta una vez y se cachea el resultado.
async function hasDevicesTable() {
  if (devicesTableChecked) return devicesTableExists;

  try {
    const { rows } = await pool.query(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'devices'
       ) AS exists`,
    );
    devicesTableExists = Boolean(rows[0]?.exists);
  } catch (err) {
    devicesTableExists = false;
  }

  devicesTableChecked = true;
  return devicesTableExists;
}

async function getDomains(req, res, next) {
  try {
    const rows = await listDomains();
    return res.json({ ok: true, count: rows.length, data: rows });
  } catch (err) {
    next(err);
  }
}

async function getDevices(req, res, next) {
  try {
    const { domain_slug, serial_id, name } = req.query;

    // Si la base no tiene catalogo de dispositivos, devolvemos vacio en vez de romper la demo.
    if (!(await hasDevicesTable())) {
      return res.json({
        ok: true,
        count: 0,
        data: [],
        message: 'La tabla public.devices no existe en esta base de datos.',
      });
    }

    const params = [];
    let where = 'WHERE 1=1';

    if (domain_slug) {
      where += ` AND dm.slug = $${params.length + 1}`;
      params.push(domain_slug);
    }

    if (serial_id) {
      where += ` AND d.serial_id = $${params.length + 1}`;
      params.push(serial_id);
    }

    if (name) {
      where += ` AND d.name ILIKE $${params.length + 1}`;
      params.push(`%${name}%`);
    }

    const { rows } = await pool.query(
      `SELECT
         d.id,
         d.serial_id,
         d.name,
         d.location,
         d.metadata,
         d.is_active,
         d.created_at,
         d.updated_at,
         dm.slug AS domain_slug,
         dm.name AS domain_name
       FROM public.devices d
       LEFT JOIN public.domains dm ON dm.id = d.domain_id
       ${where}
       ORDER BY d.serial_id ASC`,
      params,
    );

    return res.json({
      ok: true,
      filters: {
        domain_slug: domain_slug || null,
        serial_id: serial_id || null,
        name: name || null,
      },
      count: rows.length,
      data: rows,
    });
  } catch (err) {
    next(err);
  }
}

async function createDevice(req, res, next) {
  try {
    if (!(await hasDevicesTable())) {
      return res.status(400).json({
        ok: false,
        message: 'La tabla public.devices no existe en esta base de datos.',
      });
    }

    const { serial_id, domain_slug, name, location, metadata, is_active } = req.body;

    if (!serial_id || !domain_slug) {
      return res.status(400).json({
        ok: false,
        message: 'Parámetros obligatorios: serial_id, domain_slug',
      });
    }

    const domain = await getDomain(domain_slug);
    if (!domain) {
      return res.status(400).json({
        ok: false,
        message: `Dominio "${domain_slug}" no existe.`,
      });
    }

    // Upsert: si el serial ya existe se actualiza el registro con los nuevos datos.
    const { rows } = await pool.query(
      `INSERT INTO public.devices (
         serial_id,
         domain_id,
         name,
         location,
         metadata,
         is_active,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5::jsonb, COALESCE($6, TRUE), NOW())
       ON CONFLICT (serial_id)
       DO UPDATE SET
         domain_id = EXCLUDED.domain_id,
         name = EXCLUDED.name,
         location = EXCLUDED.location,
         metadata = EXCLUDED.metadata,
         is_active = EXCLUDED.is_active,
         updated_at = NOW()
       RETURNING id, serial_id, domain_id, name, location, metadata, is_active, created_at, updated_at`,
      [
        serial_id,
        domain.id,
        name || null,
        location || null,
        JSON.stringify(metadata || {}),
        typeof is_active === 'boolean' ? is_active : null,
      ],
    );

    return res.status(201).json({ ok: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
}

module.exports = { getDomains, getDevices, createDevice };
