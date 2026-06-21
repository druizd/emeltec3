const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const {
  requireSiteAccess,
  requireRole,
  findUnauthorizedSiteIds,
} = require('../middlewares/coldRoomAccess');
const pool = require('../config/db');
const { sendAlertEmail } = require('../services/emailService');

const ADMIN_ROLES = ['SuperAdmin', 'Admin', 'Gerente'];
const OPERATOR_ROLES = ['SuperAdmin', 'Admin', 'Gerente', 'Cliente'];

router.use(protect);

// Todas las rutas /:siteId/* requieren acceso al sitio (empresa/sub_empresa match).
// SuperAdmin bypass. Resto: empresa_id (Admin/Cliente) o sub_empresa_id (Gerente).
router.use('/:siteId', requireSiteAccess('siteId'));

// === HACCP config endpoints (thresholds, defrost, acks, audit) ===
// Storage: Postgres tables created in migration 006.
// Auth: protect middleware ensures req.user is set; we surface actor in audit.

/**
 * Defaults HACCP por sala — provistos por cliente Ventisqueros faenadora.
 * Sembrados automáticamente al primer GET de cada site_id si tabla vacía.
 * Slug derivado del area (lowercase + ASCII + dashes).
 */
const DEFAULT_THRESHOLDS = [
  { area: 'Matanza / Eviscerado', tMax: 10, tMin: -2, note: 'Evitar congelamiento' },
  { area: 'Calibrado', tMax: 10, tMin: -2, note: 'Evitar congelamiento' },
  { area: 'Empaque Primario', tMax: 10, tMin: 0, note: 'Evitar congelamiento' },
  { area: 'Antecámara Primaria', tMax: 4, tMin: -2, note: 'Zona de amortiguación' },
  { area: 'Cámara Primaria', tMax: -18, tMin: -25, note: 'Alerta de sobre consumo energía' },
  { area: 'Filete', tMax: 10, tMin: 0, note: 'Evitar congelación' },
  { area: 'Cámara de Tránsito', tMax: 4, tMin: -2, note: 'Zona de amortiguación' },
  { area: 'Porciones', tMax: 10, tMin: 0, note: 'Evitar congelamiento' },
  { area: 'Empaque Secundario', tMax: 10, tMin: 0, note: 'Evitar congelamiento' },
  { area: 'Antecámara Secundaria', tMax: 4, tMin: -2, note: 'Zona de amortiguación' },
  { area: 'Cámara Secundaria', tMax: -18, tMin: -25, note: 'Alerta de sobre consumo energía' },
];

function slugifyArea(area) {
  return String(area || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Inserta defaults faltantes (no toca existentes gracias a ON CONFLICT DO NOTHING).
 * Garantiza que cualquier sala default sin row obtenga uno, incluso si la tabla
 * ya tiene otras rows. Audit log emitido por cada nueva inserción.
 */
async function seedDefaultThresholdsIfEmpty(siteId) {
  const insertSql = `
    INSERT INTO cold_room_threshold
      (site_id, sala_slug, area, t_max, t_min, note, updated_at, updated_by)
    VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
    ON CONFLICT (site_id, sala_slug) DO NOTHING
    RETURNING sala_slug`;
  let insertedCount = 0;
  for (const d of DEFAULT_THRESHOLDS) {
    const res = await pool.query(insertSql, [
      siteId,
      slugifyArea(d.area),
      d.area,
      d.tMax,
      d.tMin ?? null,
      d.note ?? null,
      'system:seed',
    ]);
    if (res.rowCount > 0) {
      insertedCount++;
      await pool.query(
        `INSERT INTO cold_room_audit_log
           (site_id, actor, actor_role, category, action, target, prev, next, note)
         VALUES ($1, 'system', 'system', 'threshold', 'create', $2, NULL, $3, 'Seed default cliente')`,
        [siteId, d.area, JSON.stringify({ tMax: d.tMax, tMin: d.tMin, note: d.note })],
      );
    }
  }
  return insertedCount > 0;
}

/**
 * Backfill: rellena t_min/note NULL en rows existentes que matcheen un default
 * conocido (por sala_slug). NO sobrescribe valores no-null (respeta custom).
 * Idempotente: corre en cada GET y solo afecta columnas NULL.
 */
/**
 * Renombra rows legacy con áreas/slugs viejos. Idempotente.
 */
const LEGACY_RENAMES = [
  { fromSlug: 'frigorifico-primario', toSlug: 'camara-primaria', toArea: 'Cámara Primaria' },
  { fromSlug: 'producto-en-transito', toSlug: 'camara-de-transito', toArea: 'Cámara de Tránsito' },
  { fromSlug: 'sala-de-porciones', toSlug: 'porciones', toArea: 'Porciones' },
];

async function renameLegacyThresholds(siteId) {
  for (const r of LEGACY_RENAMES) {
    // Si ya existe el slug nuevo, borra el viejo (evita conflicto).
    const newExists = await pool.query(
      `SELECT 1 FROM cold_room_threshold WHERE site_id=$1 AND sala_slug=$2`,
      [siteId, r.toSlug],
    );
    if (newExists.rowCount > 0) {
      await pool.query(`DELETE FROM cold_room_threshold WHERE site_id=$1 AND sala_slug=$2`, [
        siteId,
        r.fromSlug,
      ]);
      continue;
    }
    const res = await pool.query(
      `UPDATE cold_room_threshold
       SET sala_slug=$1, area=$2, updated_at=NOW()
       WHERE site_id=$3 AND sala_slug=$4
       RETURNING area`,
      [r.toSlug, r.toArea, siteId, r.fromSlug],
    );
    if (res.rowCount > 0) {
      await pool.query(
        `INSERT INTO cold_room_audit_log
           (site_id, actor, actor_role, category, action, target, prev, next, note)
         VALUES ($1, 'system', 'system', 'threshold', 'update', $2, $3, $4, 'Rename legacy')`,
        [
          siteId,
          r.toArea,
          JSON.stringify({ slug: r.fromSlug }),
          JSON.stringify({ slug: r.toSlug }),
        ],
      );
    }
  }
}

async function backfillDefaults(siteId) {
  for (const d of DEFAULT_THRESHOLDS) {
    const slug = slugifyArea(d.area);
    const res = await pool.query(
      `UPDATE cold_room_threshold
       SET t_min = COALESCE(t_min, $1),
           note  = COALESCE(note,  $2)
       WHERE site_id=$3 AND sala_slug=$4
         AND (t_min IS NULL OR note IS NULL)
       RETURNING t_min, note`,
      [d.tMin ?? null, d.note ?? null, siteId, slug],
    );
    if (res.rowCount > 0) {
      await pool.query(
        `INSERT INTO cold_room_audit_log
           (site_id, actor, actor_role, category, action, target, prev, next, note)
         VALUES ($1, 'system', 'system', 'threshold', 'update', $2, NULL, $3,
                 'Backfill defaults cliente (tMin/note)')`,
        [siteId, d.area, JSON.stringify({ tMin: d.tMin, note: d.note })],
      );
    }
  }
}

function actorFromReq(req) {
  const u = req.user;
  if (!u) return { name: 'operador', role: null };
  const name = `${u.nombre || ''} ${u.apellido || ''}`.trim() || u.email || u.id || 'operador';
  // Preferir cargo (rol funcional, ej. "Jefe Calidad") sobre tipo (rol sistema).
  return { name, role: u.cargo || u.tipo || null };
}

async function logAudit(siteId, actor, category, action, target, prev, next, note) {
  try {
    await pool.query(
      `INSERT INTO cold_room_audit_log
        (site_id, actor, actor_role, category, action, target, prev, next, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        siteId,
        actor.name,
        actor.role,
        category,
        action,
        target,
        prev !== undefined ? JSON.stringify(prev) : null,
        next !== undefined ? JSON.stringify(next) : null,
        note || null,
      ],
    );
  } catch (err) {
    console.error('[coldRoom audit] insert failed:', err.message);
  }
}

// --- Thresholds ---
router.get('/:siteId/thresholds', async (req, res) => {
  try {
    await renameLegacyThresholds(req.params.siteId);
    await seedDefaultThresholdsIfEmpty(req.params.siteId);
    await backfillDefaults(req.params.siteId);
    const { rows } = await pool.query(
      `SELECT sala_slug, area, t_max, t_min, warn_delta_c, sustained_min, severe_min,
              hysteresis_c, note, updated_at, updated_by
       FROM cold_room_threshold
       WHERE site_id = $1
       ORDER BY area`,
      [req.params.siteId],
    );
    res.json({
      ok: true,
      data: rows.map((r) => ({
        slug: r.sala_slug,
        area: r.area,
        tMax: Number(r.t_max),
        tMin: r.t_min !== null ? Number(r.t_min) : null,
        warnDeltaC: r.warn_delta_c !== null ? Number(r.warn_delta_c) : null,
        sustainedMin: r.sustained_min,
        severeMin: r.severe_min,
        hysteresisC: r.hysteresis_c !== null ? Number(r.hysteresis_c) : null,
        note: r.note,
        updatedAt: r.updated_at,
        updatedBy: r.updated_by,
      })),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.put('/:siteId/thresholds/:slug', requireRole(...ADMIN_ROLES), async (req, res) => {
  const { siteId, slug } = req.params;
  const {
    area,
    tMax,
    tMin = null,
    warnDeltaC = null,
    sustainedMin = null,
    severeMin = null,
    hysteresisC = null,
    note = null,
  } = req.body || {};
  if (!area || typeof tMax !== 'number') {
    return res.status(400).json({ ok: false, error: 'area y tMax requeridos' });
  }
  try {
    const actor = actorFromReq(req);
    const prevRes = await pool.query(
      `SELECT t_max, t_min, note FROM cold_room_threshold WHERE site_id=$1 AND sala_slug=$2`,
      [siteId, slug],
    );
    const prev = prevRes.rows[0] || null;
    await pool.query(
      `INSERT INTO cold_room_threshold
        (site_id, sala_slug, area, t_max, t_min, warn_delta_c, sustained_min, severe_min,
         hysteresis_c, note, updated_at, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, NOW(), $11)
       ON CONFLICT (site_id, sala_slug) DO UPDATE SET
         area=$3, t_max=$4, t_min=$5, warn_delta_c=$6, sustained_min=$7, severe_min=$8,
         hysteresis_c=$9, note=$10, updated_at=NOW(), updated_by=$11`,
      [
        siteId,
        slug,
        area,
        tMax,
        tMin,
        warnDeltaC,
        sustainedMin,
        severeMin,
        hysteresisC,
        note,
        actor.name,
      ],
    );
    logAudit(
      siteId,
      actor,
      'threshold',
      prev ? 'update' : 'create',
      area,
      prev
        ? {
            tMax: Number(prev.t_max),
            tMin: prev.t_min !== null ? Number(prev.t_min) : null,
            note: prev.note,
          }
        : null,
      { tMax, tMin, note },
    );
    res.json({ ok: true, data: { slug, area, tMax, tMin, note } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.delete('/:siteId/thresholds/:slug', requireRole(...ADMIN_ROLES), async (req, res) => {
  const { siteId, slug } = req.params;
  try {
    const actor = actorFromReq(req);
    const prevRes = await pool.query(
      `SELECT area, t_max, t_min FROM cold_room_threshold WHERE site_id=$1 AND sala_slug=$2`,
      [siteId, slug],
    );
    const prev = prevRes.rows[0];
    await pool.query(`DELETE FROM cold_room_threshold WHERE site_id=$1 AND sala_slug=$2`, [
      siteId,
      slug,
    ]);
    if (prev) {
      logAudit(
        siteId,
        actor,
        'threshold',
        'delete',
        prev.area,
        { tMax: Number(prev.t_max), tMin: prev.t_min !== null ? Number(prev.t_min) : null },
        null,
      );
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/:siteId/thresholds/reset', requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const actor = actorFromReq(req);
    await pool.query(`DELETE FROM cold_room_threshold WHERE site_id=$1`, [req.params.siteId]);
    await seedDefaultThresholdsIfEmpty(req.params.siteId);
    logAudit(
      req.params.siteId,
      actor,
      'threshold',
      'reset',
      'all',
      null,
      DEFAULT_THRESHOLDS,
      'Restablecido a defaults cliente',
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- Defrost windows ---
router.get('/:siteId/defrost', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, sala_slug, start_hhmm, duration_min, days_of_week, enabled, note,
              created_at, updated_at
       FROM cold_room_defrost_window
       WHERE site_id = $1
       ORDER BY sala_slug, start_hhmm`,
      [req.params.siteId],
    );
    res.json({
      ok: true,
      data: rows.map((r) => ({
        id: r.id,
        slug: r.sala_slug,
        startHHmm: r.start_hhmm,
        durationMin: r.duration_min,
        daysOfWeek: r.days_of_week || [],
        enabled: r.enabled,
        note: r.note,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/:siteId/defrost', requireRole(...ADMIN_ROLES), async (req, res) => {
  const { siteId } = req.params;
  const {
    id,
    slug,
    startHHmm,
    durationMin,
    daysOfWeek = [],
    enabled = true,
    note = null,
  } = req.body || {};
  if (!id || !slug || !startHHmm || typeof durationMin !== 'number') {
    return res
      .status(400)
      .json({ ok: false, error: 'id, slug, startHHmm, durationMin requeridos' });
  }
  try {
    const actor = actorFromReq(req);
    await pool.query(
      `INSERT INTO cold_room_defrost_window
        (id, site_id, sala_slug, start_hhmm, duration_min, days_of_week, enabled, note,
         created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, NOW(), NOW())`,
      [id, siteId, slug, startHHmm, durationMin, daysOfWeek, enabled, note],
    );
    logAudit(siteId, actor, 'defrost', 'create', `${slug}/${id}`, null, {
      startHHmm,
      durationMin,
      daysOfWeek,
      enabled,
    });
    res.json({ ok: true, data: { id } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.put('/:siteId/defrost/:id', requireRole(...ADMIN_ROLES), async (req, res) => {
  const { siteId, id } = req.params;
  const patch = req.body || {};
  try {
    const actor = actorFromReq(req);
    const prevRes = await pool.query(
      `SELECT sala_slug, start_hhmm, duration_min, days_of_week, enabled, note
       FROM cold_room_defrost_window WHERE id=$1 AND site_id=$2`,
      [id, siteId],
    );
    if (prevRes.rowCount === 0) return res.status(404).json({ ok: false, error: 'no encontrado' });
    const prev = prevRes.rows[0];
    const next = {
      startHHmm: patch.startHHmm ?? prev.start_hhmm,
      durationMin: patch.durationMin ?? prev.duration_min,
      daysOfWeek: patch.daysOfWeek ?? prev.days_of_week,
      enabled: patch.enabled ?? prev.enabled,
      note: patch.note ?? prev.note,
    };
    await pool.query(
      `UPDATE cold_room_defrost_window
       SET start_hhmm=$1, duration_min=$2, days_of_week=$3, enabled=$4, note=$5, updated_at=NOW()
       WHERE id=$6 AND site_id=$7`,
      [next.startHHmm, next.durationMin, next.daysOfWeek, next.enabled, next.note, id, siteId],
    );
    logAudit(
      siteId,
      actor,
      'defrost',
      'update',
      `${prev.sala_slug}/${id}`,
      {
        startHHmm: prev.start_hhmm,
        durationMin: prev.duration_min,
        daysOfWeek: prev.days_of_week,
        enabled: prev.enabled,
      },
      next,
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.delete('/:siteId/defrost/:id', requireRole(...ADMIN_ROLES), async (req, res) => {
  const { siteId, id } = req.params;
  try {
    const actor = actorFromReq(req);
    const prevRes = await pool.query(
      `SELECT sala_slug, start_hhmm, duration_min, days_of_week, enabled
       FROM cold_room_defrost_window WHERE id=$1 AND site_id=$2`,
      [id, siteId],
    );
    const prev = prevRes.rows[0];
    await pool.query(`DELETE FROM cold_room_defrost_window WHERE id=$1 AND site_id=$2`, [
      id,
      siteId,
    ]);
    if (prev) {
      logAudit(
        siteId,
        actor,
        'defrost',
        'delete',
        `${prev.sala_slug}/${id}`,
        {
          startHHmm: prev.start_hhmm,
          durationMin: prev.duration_min,
          daysOfWeek: prev.days_of_week,
          enabled: prev.enabled,
        },
        null,
      );
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- Deviation acks ---
router.get('/:siteId/acks', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT deviation_id, acknowledged, acked_at, acked_by, note, resolved, resolved_at,
              cause, cause_source, cause_by, cause_at, cause_note
       FROM cold_room_deviation_ack
       WHERE site_id = $1`,
      [req.params.siteId],
    );
    const map = {};
    for (const r of rows) {
      map[r.deviation_id] = {
        acknowledged: r.acknowledged,
        ackedAt: r.acked_at,
        ackedBy: r.acked_by,
        note: r.note,
        resolved: r.resolved,
        resolvedAt: r.resolved_at,
        cause: r.cause,
        causeSource: r.cause_source,
        causeBy: r.cause_by,
        causeAt: r.cause_at,
        causeNote: r.cause_note,
      };
    }
    res.json({ ok: true, data: map });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.put('/:siteId/acks/:devId', requireRole(...OPERATOR_ROLES), async (req, res) => {
  const { siteId, devId } = req.params;
  const a = req.body || {};
  try {
    const actor = actorFromReq(req);
    const prevRes = await pool.query(
      `SELECT * FROM cold_room_deviation_ack WHERE site_id=$1 AND deviation_id=$2`,
      [siteId, devId],
    );
    const prev = prevRes.rows[0] || null;
    await pool.query(
      `INSERT INTO cold_room_deviation_ack
        (site_id, deviation_id, acknowledged, acked_at, acked_by, note, resolved, resolved_at,
         cause, cause_source, cause_by, cause_at, cause_note, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, NOW())
       ON CONFLICT (site_id, deviation_id) DO UPDATE SET
         acknowledged=$3, acked_at=$4, acked_by=$5, note=$6, resolved=$7, resolved_at=$8,
         cause=$9, cause_source=$10, cause_by=$11, cause_at=$12, cause_note=$13, updated_at=NOW()`,
      [
        siteId,
        devId,
        !!a.acknowledged,
        a.ackedAt || null,
        a.ackedBy || null,
        a.note || null,
        !!a.resolved,
        a.resolvedAt || null,
        a.cause || null,
        a.causeSource || null,
        a.causeBy || null,
        a.causeAt || null,
        a.causeNote || null,
      ],
    );
    // Determine which action to log based on diff.
    let action = 'update';
    if (!prev) action = 'ack';
    else if (!prev.resolved && a.resolved) action = 'resolve';
    else if ((prev.cause || null) !== (a.cause || null)) action = 'classify-cause';
    logAudit(siteId, actor, 'deviation', action, devId, prev, a, a.note || a.causeNote);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.delete('/:siteId/acks/:devId', requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const actor = actorFromReq(req);
    await pool.query(`DELETE FROM cold_room_deviation_ack WHERE site_id=$1 AND deviation_id=$2`, [
      req.params.siteId,
      req.params.devId,
    ]);
    logAudit(req.params.siteId, actor, 'deviation', 'clear-cause', req.params.devId, null, null);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- Audit log ---
router.get('/:siteId/audit', async (req, res) => {
  const { siteId } = req.params;
  const { from, to, category, action, q, limit = 500, page = 1 } = req.query;
  const where = ['site_id = $1'];
  const params = [siteId];
  if (from) {
    params.push(from);
    where.push(`ts >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    where.push(`ts <= $${params.length}`);
  }
  if (category) {
    params.push(category);
    where.push(`category = $${params.length}`);
  }
  if (action) {
    params.push(action);
    where.push(`action = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    where.push(
      `(actor ILIKE $${params.length} OR target ILIKE $${params.length} OR note ILIKE $${params.length})`,
    );
  }
  const lim = Math.min(2000, Math.max(1, Number(limit) || 500));
  const off = Math.max(0, (Number(page) - 1) * lim);
  try {
    const { rows } = await pool.query(
      `SELECT id, ts, actor, actor_role, category, action, target, prev, next, note
       FROM cold_room_audit_log
       WHERE ${where.join(' AND ')}
       ORDER BY ts DESC
       LIMIT ${lim} OFFSET ${off}`,
      params,
    );
    res.json({
      ok: true,
      data: rows.map((r) => ({
        id: String(r.id),
        ts: r.ts,
        actor: r.actor,
        actorRole: r.actor_role,
        category: r.category,
        action: r.action,
        target: r.target,
        prev: r.prev,
        next: r.next,
        note: r.note,
      })),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/:siteId/audit', requireRole(...OPERATOR_ROLES), async (req, res) => {
  // Client-initiated explicit audit entry (rare; most logging happens via mutations).
  const { siteId } = req.params;
  const { category, action, target, prev, next, note } = req.body || {};
  if (!category || !action || !target) {
    return res.status(400).json({ ok: false, error: 'category, action, target requeridos' });
  }
  try {
    const actor = actorFromReq(req);
    await logAudit(siteId, actor, category, action, target, prev, next, note);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Mock sensors. T values calibrados a realidad por área (proceso pescado):
// salas de procesamiento ~3-6°C, antecámaras ~1°C, freezers ~-22°C.
const PLACEHOLDER_SENSORS = [
  // TAP 2
  {
    id: 'STH-01',
    tap: 'TAP 2',
    area: 'Matanza / Eviscerado',
    cx: 466.66,
    cy: 633.27,
    r: 95,
    t: 4.2,
    h: 74,
    setpoint: 4,
    tMin: -2,
    tMax: 10,
  },
  {
    id: 'STH-02',
    tap: 'TAP 2',
    area: 'Calibrado',
    cx: 363.38,
    cy: 597.36,
    r: 85,
    t: 3.1,
    h: 78,
    setpoint: 3,
    tMin: -2,
    tMax: 10,
  },
  {
    id: 'STH-03',
    tap: 'TAP 2',
    area: 'Calibrado',
    cx: 363.38,
    cy: 502.15,
    r: 78,
    t: 2.6,
    h: 79,
    setpoint: 3,
    tMin: -2,
    tMax: 10,
  },
  {
    id: 'STH-04',
    tap: 'TAP 2',
    area: 'Empaque Primario',
    cx: 447.96,
    cy: 451.87,
    r: 90,
    t: 5.3,
    h: 78,
    setpoint: 5,
    tMin: 0,
    tMax: 10,
  },
  // TAP 3
  {
    id: 'STH-05',
    tap: 'TAP 3',
    area: 'Antecámara Primaria',
    cx: 477.2,
    cy: 456.34,
    r: 55,
    t: 1.4,
    h: 86,
    setpoint: 1,
    tMin: -2,
    tMax: 4,
  },
  {
    id: 'STH-06',
    tap: 'TAP 3',
    area: 'Cámara Primaria',
    cx: 484.49,
    cy: 419.26,
    r: 70,
    t: -22.1,
    h: 88,
    setpoint: -22,
    tMin: -25,
    tMax: -18,
  },
  {
    id: 'STH-07',
    tap: 'TAP 3',
    area: 'Filete',
    cx: 369.55,
    cy: 312.89,
    r: 110,
    t: 3.8,
    h: 80,
    setpoint: 4,
    tMin: 0,
    tMax: 10,
  },
  {
    id: 'STH-08',
    tap: 'TAP 3',
    area: 'Cámara de Tránsito',
    cx: 432.34,
    cy: 261.13,
    r: 80,
    t: 1.6,
    h: 77,
    setpoint: 1,
    tMin: -2,
    tMax: 4,
  },
  // TAP 4
  {
    id: 'STH-09',
    tap: 'TAP 4',
    area: 'Empaque Secundario',
    cx: 418.74,
    cy: 142.51,
    r: 95,
    t: 4.6,
    h: 70,
    setpoint: 5,
    tMin: 0,
    tMax: 10,
  },
  {
    id: 'STH-10',
    tap: 'TAP 4',
    area: 'Porciones',
    cx: 476.26,
    cy: 198.83,
    r: 75,
    t: 3.7,
    h: 73,
    setpoint: 4,
    tMin: 0,
    tMax: 10,
  },
  {
    id: 'STH-11',
    tap: 'TAP 4',
    area: 'Empaque Secundario',
    cx: 523.79,
    cy: 166.83,
    r: 60,
    t: 5.3,
    h: 71,
    setpoint: 5,
    tMin: 0,
    tMax: 10,
  },
  {
    id: 'STH-12',
    tap: 'TAP 4',
    area: 'Antecámara Secundaria',
    cx: 580.23,
    cy: 167.87,
    r: 70,
    t: 1.1,
    h: 84,
    setpoint: 1,
    tMin: -2,
    tMax: 4,
  },
  {
    id: 'STH-13',
    tap: 'TAP 4',
    area: 'Cámara Secundaria',
    cx: 682.66,
    cy: 199.72,
    r: 130,
    t: -22.8,
    h: 93,
    setpoint: -22,
    tMin: -25,
    tMax: -18,
  },
];

// Range presets: points + interval in ms between points.
// HACCP-grade granularity: 1-min sampling at sub-day ranges to detect short excursions.
const RANGE_PRESETS = {
  '1h': { points: 60, intervalMs: 60 * 1000 },
  '6h': { points: 360, intervalMs: 60 * 1000 },
  '24h': { points: 1440, intervalMs: 60 * 1000 },
  '7d': { points: 168, intervalMs: 60 * 60 * 1000 },
};

function normalizeRange(raw) {
  if (!raw) return '24h';
  const key = String(raw).toLowerCase().trim();
  return RANGE_PRESETS[key] ? key : '24h';
}

/**
 * Sintetiza histórico realista de refrigeración:
 *   - Ciclo compresor (~30min on/off, ±0.8°C sine slow)
 *   - Defrost programado 02:00 / 10:00 / 18:00 (spike +2.5°C por 20min)
 *   - Drift lento day-night (±0.3°C)
 *   - Ruido sensor mínimo (±0.05°C)
 */
function buildHist(baseT, range) {
  const preset = RANGE_PRESETS[range] || RANGE_PRESETS['24h'];
  const { points, intervalMs } = preset;
  const now = Date.now();
  const data = [];
  const defrostHours = [2, 10, 18];
  const defrostDurationMin = 18;
  let drift = 0;
  for (let i = 0; i < points; i++) {
    const ts = now - (points - 1 - i) * intervalMs;
    const d = new Date(ts);
    const hourOfDay = d.getHours();
    const minuteOfHour = d.getMinutes();

    // Compresor cycle ~30 min, amplitud 0.8°C.
    const compressorPhase = Math.sin((d.getMinutes() + d.getHours() * 60) / 4.77) * 0.8;

    // Defrost spike si estamos en ventana defrost.
    let defrostSpike = 0;
    if (defrostHours.includes(hourOfDay) && minuteOfHour < defrostDurationMin) {
      const t = minuteOfHour / defrostDurationMin;
      // Curva campana: sube y baja en 20 min, peak ~2.5°C
      defrostSpike = Math.sin(t * Math.PI) * 2.5;
    }

    // Drift lento (random walk acotado).
    drift += (Math.random() - 0.5) * 0.01;
    drift = Math.max(-0.4, Math.min(0.4, drift));

    // Ruido sensor (mínimo, refleja resolución sonda).
    const noise = (Math.random() - 0.5) * 0.1;

    const v = baseT + compressorPhase + defrostSpike + drift + noise;
    data.push({
      t: new Date(ts).toISOString(),
      v: +v.toFixed(2),
    });
  }
  return data;
}

/**
 * HR: cambia más lento que T. Drops durante defrost (puerta + evaporador caliente).
 */
function buildHistHum(baseH, range) {
  const preset = RANGE_PRESETS[range] || RANGE_PRESETS['24h'];
  const { points, intervalMs } = preset;
  const now = Date.now();
  const data = [];
  const defrostHours = [2, 10, 18];
  let drift = 0;
  for (let i = 0; i < points; i++) {
    const ts = now - (points - 1 - i) * intervalMs;
    const d = new Date(ts);
    const hourOfDay = d.getHours();
    const minuteOfHour = d.getMinutes();

    // Ondulación lenta ~2h período, ±1.5%
    const phase = Math.sin((d.getMinutes() + d.getHours() * 60) / 19) * 1.5;

    // Defrost: HR cae 3-5% por 20min (aire seco evaporador caliente).
    let defrostDrop = 0;
    if (defrostHours.includes(hourOfDay) && minuteOfHour < 20) {
      const t = minuteOfHour / 20;
      defrostDrop = -Math.sin(t * Math.PI) * 4;
    }

    // Drift muy lento (random walk acotado).
    drift += (Math.random() - 0.5) * 0.02;
    drift = Math.max(-1, Math.min(1, drift));

    const noise = (Math.random() - 0.5) * 0.2;
    const v = Math.max(30, Math.min(99, baseH + phase + defrostDrop + drift + noise));
    data.push({
      t: new Date(ts).toISOString(),
      v: +v.toFixed(2),
    });
  }
  return data;
}

function jitter(value, range = 0.4) {
  return +(value + (Math.random() - 0.5) * range * 2).toFixed(1);
}

function normalizeTap(raw) {
  if (!raw) return null;
  const upper = String(raw).toUpperCase().replace(/-/g, ' ').trim();
  if (['TAP 1', 'TAP 2', 'TAP 3', 'TAP 4'].includes(upper)) return upper;
  return null;
}

function sensorSnapshot(s, range) {
  const t = jitter(s.t, 0.4);
  const h = Math.max(35, Math.min(99, s.h + Math.round((Math.random() - 0.5) * 4)));
  const histT = buildHist(s.t, range);
  const alerted = t < s.tMin || t > s.tMax;
  return {
    id: s.id,
    tap: s.tap,
    area: s.area,
    cx: s.cx,
    cy: s.cy,
    r: s.r,
    t,
    h,
    alerted,
    setpoint: s.setpoint,
    tMin: s.tMin,
    tMax: s.tMax,
    lastSeen: new Date().toISOString(),
    hist: histT.map((p) => p.v),
    histPoints: histT,
  };
}

/**
 * Mapeo range → cagg view + intervalo. Aprovecha continuous aggregates Timescale
 * (equipo_1min/5min/hourly/daily). El cagg ya está materializado y indexado por
 * (id_serial, bucket DESC) → lookups sub-segundo incluso con millones de filas.
 */
const RANGE_CAGG_MAP = {
  '1h': { view: 'equipo_1min', bucketInterval: '1 minute', points: 60 },
  '6h': { view: 'equipo_1min', bucketInterval: '1 minute', points: 360 },
  '24h': { view: 'equipo_1min', bucketInterval: '1 minute', points: 1440 },
  '7d': { view: 'equipo_hourly', bucketInterval: '1 hour', points: 168 },
};

/**
 * Lee reg_map de los sites + cagg correspondiente y pivota a histPoints por sensor.
 * Aplica factor*raw + offset. Marca sensores `defective` desde parametros.
 *
 * @param {string[]} siteIds - Lista de site ids a cargar.
 * @param {string} range - '1h'|'6h'|'24h'|'7d'
 * @param {string|null} tapFilter - Filtra por TAP label si se pasa (ej. 'TAP 2').
 * @returns {Promise<Array>} Array de sensores con histPoints + snapshot.
 */
async function loadRealColdRoomSensors(siteIds, range, tapFilter, dateWindow = null) {
  if (!siteIds || siteIds.length === 0) return null;
  // Modo fecha específica: ignora `range`, fija ventana 24h del día (1-min cagg).
  const cfg = dateWindow ? RANGE_CAGG_MAP['24h'] : RANGE_CAGG_MAP[range] || RANGE_CAGG_MAP['24h'];

  // 1. Sitios → id_serial + descripcion (= TAP label).
  const sitesRes = await pool.query(
    `SELECT id, descripcion, id_serial FROM sitio WHERE id = ANY($1)`,
    [siteIds],
  );
  if (sitesRes.rowCount === 0) return null;
  const siteById = new Map(sitesRes.rows.map((r) => [r.id, r]));
  const idSerials = sitesRes.rows.map((r) => r.id_serial).filter(Boolean);
  if (idSerials.length === 0) return null;

  // 2. reg_map filtrado a aliases STH-XX.
  const mapRes = await pool.query(
    `SELECT sitio_id, alias, d1, parametros
     FROM reg_map
     WHERE sitio_id = ANY($1) AND alias LIKE 'STH-%' AND d1 IS NOT NULL`,
    [siteIds],
  );
  if (mapRes.rowCount === 0) return null;

  // 3. Agrupar aliases por sensorId (STH-01, STH-02, etc.) + parametros.
  // Cada sensor tiene 2 aliases (.T y .H) que comparten parametros.
  const sensors = new Map(); // sensorId+'@'+siteId → { id, tap, area, cx, cy, r, regT, regH, factor, defective, ... }
  for (const m of mapRes.rows) {
    const match = m.alias.match(/^(STH-\d+)\.(T|H)$/);
    if (!match) continue;
    const sensorId = match[1];
    const channel = match[2]; // 'T' or 'H'
    const params = m.parametros || {};
    const key = `${sensorId}@${m.sitio_id}`;
    let s = sensors.get(key);
    if (!s) {
      const site = siteById.get(m.sitio_id);
      s = {
        id: sensorId,
        tap: site ? site.descripcion : '',
        siteId: m.sitio_id,
        idSerial: site ? site.id_serial : null,
        area: (params.area || '').replace(/\s+/g, ' ').trim(),
        cx: Number(params.cx) || 0,
        cy: Number(params.cy) || 0,
        r: Number(params.r) || 60,
        factor: typeof params.factor === 'number' ? params.factor : Number(params.factor) || 0.01,
        offset: typeof params.offset === 'number' ? params.offset : Number(params.offset) || 0,
        defective: !!params.defective,
        defectiveReason: params.defective_reason || null,
        regT: null,
        regH: null,
      };
      sensors.set(key, s);
    }
    if (channel === 'T') s.regT = m.d1;
    if (channel === 'H') s.regH = m.d1;
  }

  // Filter por TAP si se pasó.
  let sensorList = [...sensors.values()];
  if (tapFilter) sensorList = sensorList.filter((s) => s.tap === tapFilter);
  if (sensorList.length === 0) return [];

  // 4. Query cagg. Dos modos:
  //   - dateWindow: ventana [start, end) del día Chile → acota ambos extremos.
  //   - live: últimos N points relativos a ahora (bucket >= cutoff).
  let histRes;
  if (dateWindow) {
    histRes = await pool.query(
      `SELECT id_serial, bucket, data
       FROM ${cfg.view}
       WHERE id_serial = ANY($1) AND bucket >= $2 AND bucket < $3
       ORDER BY id_serial, bucket ASC
       LIMIT $4`,
      [idSerials, dateWindow.start, dateWindow.end, cfg.points * idSerials.length + 100],
    );
  } else {
    const cutoffMs = Date.now() - cfg.points * (cfg.view === 'equipo_1min' ? 60_000 : 3_600_000);
    const cutoff = new Date(cutoffMs);
    histRes = await pool.query(
      `SELECT id_serial, bucket, data
       FROM ${cfg.view}
       WHERE id_serial = ANY($1) AND bucket >= $2
       ORDER BY id_serial, bucket ASC
       LIMIT $3`,
      [idSerials, cutoff, cfg.points * idSerials.length + 100],
    );
  }

  // 5. Agrupar buckets por id_serial.
  const bySerial = new Map();
  for (const row of histRes.rows) {
    const list = bySerial.get(row.id_serial) || [];
    list.push({ t: row.bucket, data: row.data || {} });
    bySerial.set(row.id_serial, list);
  }

  // 6. Construir respuesta por sensor.
  // Modbus holding registers son 16-bit; valores negativos vienen como uint16
  // (e.g. -2200 = 63336). Sin convertir a signed int16 las temps de freezer
  // se inflan a +630°C. Conversión: si > 32767 → restar 65536.
  const toSigned16 = (n) => (typeof n === 'number' && n > 32767 ? n - 65536 : n);

  const out = [];
  for (const s of sensorList) {
    const buckets = bySerial.get(s.idSerial) || [];
    const histPoints = s.regT
      ? buckets
          .map((b) => {
            const raw = toSigned16(b.data[s.regT]);
            if (typeof raw !== 'number') return null;
            return { t: new Date(b.t).toISOString(), v: +(raw * s.factor + s.offset).toFixed(2) };
          })
          .filter((p) => p !== null)
      : [];
    const histHumPoints = s.regH
      ? buckets
          .map((b) => {
            // HR es siempre 0-100% → naturalmente unsigned, no requiere conversión.
            const raw = b.data[s.regH];
            if (typeof raw !== 'number') return null;
            return { t: new Date(b.t).toISOString(), v: +(raw * s.factor + s.offset).toFixed(2) };
          })
          .filter((p) => p !== null)
      : [];

    const lastT = histPoints.length ? histPoints[histPoints.length - 1].v : 0;
    const lastH = histHumPoints.length ? histHumPoints[histHumPoints.length - 1].v : 0;
    const lastBucket = buckets.length ? buckets[buckets.length - 1].t : null;

    // Threshold lookup per sala_slug.
    const slug = (s.area || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    // Resolved later via threshold table — for now use defaults from DEFAULT_THRESHOLDS.
    const defaultThr = DEFAULT_THRESHOLDS.find((d) => slugifyArea(d.area) === slug);
    const tMax = defaultThr?.tMax ?? null;
    const tMin = defaultThr?.tMin ?? null;
    const alerted =
      !s.defective && ((tMax !== null && lastT > tMax) || (tMin !== null && lastT < tMin));

    out.push({
      id: s.id,
      tap: s.tap,
      area: s.area,
      cx: s.cx,
      cy: s.cy,
      r: s.r,
      t: lastT,
      h: lastH,
      alerted,
      setpoint: defaultThr ? (defaultThr.tMax + (defaultThr.tMin ?? defaultThr.tMax)) / 2 : 0,
      tMin: tMin !== null ? tMin : -50,
      tMax: tMax !== null ? tMax : 50,
      lastSeen: lastBucket ? new Date(lastBucket).toISOString() : new Date(0).toISOString(),
      hist: histPoints.map((p) => p.v),
      histPoints,
      histHumPoints,
      defective: s.defective || undefined,
      defectiveReason: s.defectiveReason || undefined,
    });
  }
  return out;
}

router.get('/:siteId/sensors', async (req, res) => {
  const tap = normalizeTap(req.query.tap);
  const range = normalizeRange(req.query.range);

  // Modo fecha específica: ?date=YYYY-MM-DD → ventana 24h de ese día calendario
  // CHILENO. Offset fijo -04:00 (mismo criterio que utils/timezone.js y
  // contadores/service.ts) para evitar DST y mantener coherencia con la BD.
  let dateWindow = null;
  const dateRaw = req.query.date ? String(req.query.date).trim() : '';
  if (dateRaw) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
      return res.status(400).json({ ok: false, error: 'date inválida (formato YYYY-MM-DD)' });
    }
    const start = new Date(`${dateRaw}T00:00:00-04:00`);
    if (isNaN(start.getTime())) {
      return res.status(400).json({ ok: false, error: 'date inválida' });
    }
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    dateWindow = { start, end, date: dateRaw };
  }
  // Support combo siteIds query for aggregation across multiple cold-room sites.
  // Frontend pasa ?siteIds=S110,S111,S113 cuando Ventisqueros tiene 4 TAPs.
  const siteIdsRaw = String(req.query.siteIds || req.params.siteId || '');
  const siteIds = siteIdsRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // EMT-C02: validar CADA siteId de la query contra el alcance del usuario.
  // requireSiteAccess('siteId') solo validó el :siteId de la ruta.
  const deniedSensors = await findUnauthorizedSiteIds(req.user, siteIds);
  if (deniedSensors.length > 0) {
    return res.status(403).json({ ok: false, error: 'Sin permisos sobre uno o más sitios' });
  }

  // Intentar datos reales primero (reg_map + equipo_1min cagg).
  try {
    const real = await loadRealColdRoomSensors(siteIds, range, tap, dateWindow);
    if (real !== null && real.length > 0) {
      return res.json({
        ok: true,
        data: real,
        meta: {
          range: dateWindow ? '24h' : range,
          count: real.length,
          serverTime: new Date().toISOString(),
          source: 'cagg',
          ...(dateWindow && {
            date: dateWindow.date,
            from: dateWindow.start.toISOString(),
            to: dateWindow.end.toISOString(),
          }),
        },
      });
    }
  } catch (err) {
    console.error('[cold-room sensors real] fallback to mock:', err.message);
  }

  // No fallback a mock en prod: confunde debugging y oculta config faltante
  // de reg_map. Devolver array vacío + meta.source='no-data' para que UI
  // muestre skeleton/empty state. Para dev/demo usar ?mock=1 explícito.
  if (req.query.mock === '1') {
    if (tap === 'TAP 1') return res.json({ ok: true, data: [] });
    const filtered = tap ? PLACEHOLDER_SENSORS.filter((s) => s.tap === tap) : PLACEHOLDER_SENSORS;
    return res.json({
      ok: true,
      data: filtered.map((s) => sensorSnapshot(s, range)),
      meta: {
        range,
        count: filtered.length,
        serverTime: new Date().toISOString(),
        source: 'mock',
      },
    });
  }
  res.json({
    ok: true,
    data: [],
    meta: {
      range: dateWindow ? '24h' : range,
      count: 0,
      serverTime: new Date().toISOString(),
      source: 'no-data',
      hint: 'reg_map sin sensores STH-* o siteIds no incluye los TAPs cold-room',
      ...(dateWindow && {
        date: dateWindow.date,
        from: dateWindow.start.toISOString(),
        to: dateWindow.end.toISOString(),
      }),
    },
  });
});

/**
 * PUT /:siteId/sensors/:sensorId/defective
 * Marca/desmarca sensor como fuera de servicio. Actualiza parametros.defective
 * en reg_map de ambos aliases (.T y .H) del sensor para mantener consistencia.
 * Body: { defective: boolean, reason?: string }
 */
router.put(
  '/:siteId/sensors/:sensorId/defective',
  requireRole(...ADMIN_ROLES),
  async (req, res) => {
    const { siteId, sensorId } = req.params;
    const { defective, reason } = req.body || {};
    if (typeof defective !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'defective (boolean) requerido' });
    }
    try {
      const actor = actorFromReq(req);

      // Sensor puede vivir en TAP sub-site (bundle), no en el primary. Buscamos
      // dentro de todos los sitios de la misma empresa que el primary siteId.
      const empRes = await pool.query(`SELECT empresa_id FROM sitio WHERE id = $1`, [siteId]);
      if (empRes.rowCount === 0) {
        return res.status(404).json({ ok: false, error: 'Sitio no encontrado' });
      }
      const empresaId = empRes.rows[0].empresa_id;

      // Aliases del sensor (ej. STH-02.T, STH-02.H) en cualquier sitio de la empresa.
      const aliasFilter = `${sensorId}.%`;
      const prevRes = await pool.query(
        `SELECT rm.alias, rm.sitio_id, rm.parametros
           FROM reg_map rm
           JOIN sitio s ON s.id = rm.sitio_id
          WHERE s.empresa_id = $1 AND rm.alias LIKE $2`,
        [empresaId, aliasFilter],
      );
      if (prevRes.rowCount === 0) {
        return res.status(404).json({ ok: false, error: 'Sensor no encontrado en reg_map' });
      }

      // Aplicar patch a parametros JSONB de cada alias (puede ser multi-sitio).
      for (const row of prevRes.rows) {
        const params = row.parametros || {};
        if (defective) {
          params.defective = true;
          params.defective_since = new Date().toISOString().slice(0, 10);
          params.defective_reason = reason || 'Marcado manualmente por operador';
          params.defective_by = actor.name;
        } else {
          delete params.defective;
          delete params.defective_since;
          delete params.defective_reason;
          delete params.defective_by;
        }
        await pool.query(
          `UPDATE reg_map SET parametros = $1, updated_at = NOW()
         WHERE sitio_id = $2 AND alias = $3`,
          [JSON.stringify(params), row.sitio_id, row.alias],
        );
      }

      // Audit log.
      logAudit(
        siteId,
        actor,
        'threshold', // categoría existente; usa target distintivo
        defective ? 'update' : 'update',
        `sensor:${sensorId}`,
        { defective: !defective },
        { defective, reason: reason || null },
        defective ? `Marcado en falla: ${reason || 'sin razón'}` : 'Reactivado',
      );

      res.json({ ok: true, data: { sensorId, defective, reason: reason || null } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  },
);

/**
 * GET /:siteId/history-export
 * Query: from=ISO, to=ISO, siteIds=S109,S110, sensorIds=STH-01,STH-02
 * Devuelve points por sensor con T y H desde cagg óptimo según duración.
 */
router.get('/:siteId/history-export', async (req, res) => {
  try {
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;
    if (!from || !to || isNaN(from.getTime()) || isNaN(to.getTime())) {
      return res.status(400).json({ ok: false, error: 'from/to inválidos (ISO date esperado)' });
    }
    if (to <= from) {
      return res.status(400).json({ ok: false, error: 'to debe ser mayor que from' });
    }
    const durMs = to.getTime() - from.getTime();
    const maxDays = 365;
    if (durMs > maxDays * 86_400_000) {
      return res.status(400).json({ ok: false, error: 'Rango máximo: 365 días' });
    }

    const BASE_MS = {
      equipo_1min: 60_000,
      equipo_5min: 300_000,
      equipo_hourly: 3_600_000,
      equipo_daily: 86_400_000,
    };
    const INTERVAL_MS = {
      '1min': 60_000,
      '5min': 300_000,
      '15min': 900_000,
      '1h': 3_600_000,
      '1d': 86_400_000,
    };
    const intervalRaw = String(req.query.interval || 'auto')
      .toLowerCase()
      .trim();
    const requestedMs = INTERVAL_MS[intervalRaw] || null; // null = auto

    // Cagg BASE: cuando el usuario fija intervalo, la base se elige POR el
    // intervalo (cagg ≤ intervalo) para respetar la granularidad pedida — NO por
    // la duración del rango. En 'auto' sí se elige por duración.
    let view;
    if (requestedMs) {
      // Lee de un cagg igual o más fino que el intervalo, así el promedio/min/max
      // se calcula sobre varias muestras dentro de cada intervalo.
      if (requestedMs <= 900_000)
        view = 'equipo_1min'; // 1/5/15 min ← 1min
      else if (requestedMs <= 3_600_000)
        view = 'equipo_5min'; // 1h ← 5min
      else view = 'equipo_hourly'; // 1d ← hourly
    } else {
      view = 'equipo_1min';
      if (durMs > 7 * 86_400_000) view = 'equipo_daily';
      else if (durMs > 2 * 86_400_000) view = 'equipo_hourly';
      else if (durMs > 6 * 3_600_000) view = 'equipo_5min';
    }
    const baseMs = BASE_MS[view];
    const effectiveMs = requestedMs ? requestedMs : baseMs; // requestedMs siempre ≥ baseMs

    // Guard: acota filas base leídas (evita escanear millones en rangos enormes
    // con intervalo fino). Si se pasa, pedir intervalo mayor o rango menor.
    const MAX_BASE_BUCKETS = 50_000;
    if (Math.ceil(durMs / baseMs) > MAX_BASE_BUCKETS) {
      return res.status(400).json({
        ok: false,
        error: `Rango demasiado grande para intervalo "${intervalRaw}". Reduce el rango o elige un intervalo mayor.`,
      });
    }

    const INTERVAL_LABEL = {
      60_000: '1min',
      300_000: '5min',
      900_000: '15min',
      3_600_000: '1h',
      86_400_000: '1d',
    };
    const intervalLabel = INTERVAL_LABEL[effectiveMs] || `${effectiveMs}ms`;

    const siteIdsRaw = String(req.query.siteIds || req.params.siteId || '');
    const siteIds = siteIdsRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (siteIds.length === 0) {
      return res.status(400).json({ ok: false, error: 'siteIds requerido' });
    }

    // EMT-C02: validar CADA siteId de la query contra el alcance del usuario.
    const deniedExport = await findUnauthorizedSiteIds(req.user, siteIds);
    if (deniedExport.length > 0) {
      return res.status(403).json({ ok: false, error: 'Sin permisos sobre uno o más sitios' });
    }

    const sensorIdsRaw = String(req.query.sensorIds || '');
    const sensorIds = sensorIdsRaw
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    // Sites → id_serial.
    const sitesRes = await pool.query(
      `SELECT id, descripcion, id_serial FROM sitio WHERE id = ANY($1)`,
      [siteIds],
    );
    const siteById = new Map(sitesRes.rows.map((r) => [r.id, r]));
    const idSerials = sitesRes.rows.map((r) => r.id_serial).filter(Boolean);
    if (idSerials.length === 0) {
      return res.json({ ok: true, data: { points: [] }, meta: { view, rows: 0 } });
    }

    // reg_map STH-*.
    const mapRes = await pool.query(
      `SELECT sitio_id, alias, d1, parametros
       FROM reg_map
       WHERE sitio_id = ANY($1) AND alias LIKE 'STH-%' AND d1 IS NOT NULL`,
      [siteIds],
    );

    // Group sensorId → { siteId, idSerial, area, tap, regT, regH, factor, offset }.
    const sensors = new Map();
    for (const m of mapRes.rows) {
      const match = m.alias.match(/^(STH-\d+)\.(T|H)$/);
      if (!match) continue;
      const sId = match[1];
      if (sensorIds.length > 0 && !sensorIds.includes(sId)) continue;
      const ch = match[2];
      const params = m.parametros || {};
      const key = `${sId}@${m.sitio_id}`;
      let s = sensors.get(key);
      if (!s) {
        const site = siteById.get(m.sitio_id);
        s = {
          id: sId,
          siteId: m.sitio_id,
          idSerial: site ? site.id_serial : null,
          area: (params.area || '').replace(/\s+/g, ' ').trim(),
          tap: site ? site.descripcion : '',
          factor: typeof params.factor === 'number' ? params.factor : Number(params.factor) || 0.01,
          offset: typeof params.offset === 'number' ? params.offset : Number(params.offset) || 0,
          regT: null,
          regH: null,
        };
        sensors.set(key, s);
      }
      if (ch === 'T') s.regT = m.d1;
      if (ch === 'H') s.regH = m.d1;
    }
    const sensorList = [...sensors.values()];
    if (sensorList.length === 0) {
      return res.json({ ok: true, data: { points: [] }, meta: { view, rows: 0 } });
    }

    // Cagg query.
    const histRes = await pool.query(
      `SELECT id_serial, bucket, data
       FROM ${view}
       WHERE id_serial = ANY($1) AND bucket >= $2 AND bucket <= $3
       ORDER BY bucket ASC`,
      [idSerials, from, to],
    );

    const toSigned16 = (n) => (typeof n === 'number' && n > 32767 ? n - 65536 : n);

    // Agrupa los buckets base en el intervalo efectivo y calcula promedio/min/max
    // por sensor. Alineación a día Chile (offset fijo -04:00) para que los buckets
    // de 1d/1h caigan en horario local, coherente con el resto del sistema.
    const CHILE_OFFSET_MS = 4 * 3_600_000;
    const bucketStart = (tsMs) =>
      Math.floor((tsMs - CHILE_OFFSET_MS) / effectiveMs) * effectiveMs + CHILE_OFFSET_MS;

    const acc = new Map(); // `${sensorId}@${siteId}__${bucketMs}` → agregados
    for (const row of histRes.rows) {
      for (const s of sensorList) {
        if (s.idSerial !== row.id_serial) continue;
        const rawT = s.regT ? toSigned16(row.data[s.regT]) : null;
        const rawH = s.regH ? row.data[s.regH] : null;
        const tVal = typeof rawT === 'number' ? +(rawT * s.factor + s.offset).toFixed(2) : null;
        const hVal = typeof rawH === 'number' ? +(rawH * s.factor + s.offset).toFixed(2) : null;
        if (tVal === null && hVal === null) continue;
        const bMs = bucketStart(new Date(row.bucket).getTime());
        const key = `${s.id}@${s.siteId}__${bMs}`;
        let a = acc.get(key);
        if (!a) {
          a = {
            ts: bMs,
            sensorId: s.id,
            area: s.area,
            tap: s.tap,
            tSum: 0,
            tCount: 0,
            tMin: Infinity,
            tMax: -Infinity,
            hSum: 0,
            hCount: 0,
            hMin: Infinity,
            hMax: -Infinity,
          };
          acc.set(key, a);
        }
        if (tVal !== null) {
          a.tSum += tVal;
          a.tCount += 1;
          if (tVal < a.tMin) a.tMin = tVal;
          if (tVal > a.tMax) a.tMax = tVal;
        }
        if (hVal !== null) {
          a.hSum += hVal;
          a.hCount += 1;
          if (hVal < a.hMin) a.hMin = hVal;
          if (hVal > a.hMax) a.hMax = hVal;
        }
      }
    }

    const round2 = (n) => +n.toFixed(2);
    const points = [...acc.values()]
      .sort((x, y) => x.ts - y.ts || x.sensorId.localeCompare(y.sensorId))
      .map((a) => ({
        ts: new Date(a.ts).toISOString(),
        sensorId: a.sensorId,
        area: a.area,
        tap: a.tap,
        t: a.tCount > 0 ? round2(a.tSum / a.tCount) : null,
        tMin: a.tCount > 0 ? a.tMin : null,
        tMax: a.tCount > 0 ? a.tMax : null,
        h: a.hCount > 0 ? round2(a.hSum / a.hCount) : null,
        hMin: a.hCount > 0 ? a.hMin : null,
        hMax: a.hCount > 0 ? a.hMax : null,
      }));

    res.json({
      ok: true,
      data: { points },
      meta: {
        view,
        interval: intervalLabel,
        rows: points.length,
        from: from.toISOString(),
        to: to.toISOString(),
        sensorCount: sensorList.length,
      },
    });
  } catch (err) {
    console.error('[history-export] error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/:siteId/sensors/:sensorId/history', (req, res) => {
  const range = normalizeRange(req.query.range);
  const sensor = PLACEHOLDER_SENSORS.find((s) => s.id === req.params.sensorId);
  if (!sensor) return res.status(404).json({ ok: false, error: 'Sensor no encontrado' });
  const tempSeries = buildHist(sensor.t, range);
  const humSeries = buildHistHum(sensor.h, range);
  res.json({
    ok: true,
    data: {
      id: sensor.id,
      area: sensor.area,
      tap: sensor.tap,
      setpoint: sensor.setpoint,
      tMin: sensor.tMin,
      tMax: sensor.tMax,
      range,
      temperature: tempSeries,
      humidity: humSeries,
    },
    meta: { range, points: tempSeries.length, serverTime: new Date().toISOString() },
  });
});

router.get('/:siteId/concentrator', requireRole('SuperAdmin', 'Admin'), (req, res) => {
  const tap = normalizeTap(req.query.tap);
  if (tap && tap !== 'TAP 1') {
    return res.json({ ok: true, data: { alerted: false, lastSeen: null } });
  }
  const channels = PLACEHOLDER_SENSORS.map((s) => ({
    id: s.id,
    tap: s.tap,
    area: s.area,
    online: true,
    rssi: -Math.round(50 + Math.random() * 30),
    lastSeen: new Date(Date.now() - Math.round(Math.random() * 30_000)).toISOString(),
  }));
  const onlineCount = channels.filter((c) => c.online).length;
  res.json({
    ok: true,
    data: {
      alerted: false,
      lastSeen: new Date().toISOString(),
      uptime: 99.6 + Math.random() * 0.3,
      online: onlineCount,
      total: channels.length,
      channels,
      firmwareVersion: '2.4.1',
      bridgeAddress: '10.20.0.4',
    },
  });
});

router.get('/:siteId/backup', requireRole('SuperAdmin', 'Admin'), (req, res) => {
  const tap = normalizeTap(req.query.tap);
  const range = normalizeRange(req.query.range);
  if (tap && tap !== 'TAP 1') return res.json({ ok: true, data: [] });
  const backup = PLACEHOLDER_SENSORS.map((s) => {
    const t = jitter(s.t, 0.6);
    const h = Math.max(35, Math.min(99, s.h + Math.round((Math.random() - 0.5) * 6)));
    const alertaFisica = t < s.tMin - 2 || t > s.tMax + 2;
    return {
      id: s.id,
      area: s.area,
      tap: s.tap,
      t,
      h,
      alertaFisica,
      setpoint: s.setpoint,
      tMin: s.tMin,
      tMax: s.tMax,
      lastSeen: new Date(Date.now() - Math.round(Math.random() * 10_000)).toISOString(),
      hist: buildHist(s.t, range).map((p) => p.v),
    };
  });
  res.json({ ok: true, data: backup });
});

router.get('/:siteId/export', (req, res) => {
  const tap = normalizeTap(req.query.tap);
  const range = normalizeRange(req.query.range);
  const format = (req.query.format || 'csv').toString().toLowerCase();
  const filtered = tap ? PLACEHOLDER_SENSORS.filter((s) => s.tap === tap) : PLACEHOLDER_SENSORS;
  if (format !== 'csv') {
    return res.status(400).json({ ok: false, error: 'Formato no soportado' });
  }
  const rows = [];
  rows.push(
    ['sensor_id', 'tap', 'area', 'timestamp_iso', 'temperatura_c', 'humedad_pct'].join(','),
  );
  filtered.forEach((s) => {
    const tempSeries = buildHist(s.t, range);
    const humSeries = buildHistHum(s.h, range);
    tempSeries.forEach((p, i) => {
      const hVal = humSeries[i] ? humSeries[i].v : '';
      rows.push([s.id, s.tap, JSON.stringify(s.area), p.t, p.v, hVal].join(','));
    });
  });
  const filename = `cold-room-${req.params.siteId}-${tap || 'all'}-${range}.csv`.replace(
    /\s+/g,
    '-',
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(rows.join('\n'));
});

// =============================================================================
// === ALARM RULES (configurables): CRUD + recipients + eval loop
// =============================================================================

function ruleRowToObj(r) {
  return {
    id: r.id,
    siteId: r.site_id,
    name: r.name,
    enabled: r.enabled,
    metric: r.metric,
    op: r.op,
    threshold: Number(r.threshold),
    targetKind: r.target_kind,
    targetValue: r.target_value,
    sustainedMin: r.sustained_min,
    severity: r.severity,
    notifyEmail: r.notify_email,
    notifyUi: r.notify_ui,
    recipientUserIds: Array.isArray(r.recipient_user_ids) ? r.recipient_user_ids : [],
    visibleToAll: r.visible_to_all !== false,
    viewerUserIds: Array.isArray(r.viewer_user_ids) ? r.viewer_user_ids : [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// --- Reglas CRUD ---
router.get('/:siteId/alarm-rules', async (req, res) => {
  try {
    // Admin/Gerente/SuperAdmin ven todas; otros roles solo las visibles para
    // todos o donde estén en viewer_user_ids.
    const u = req.user || {};
    const isAdminTier = ADMIN_ROLES.includes(u.tipo);
    const { rows } = isAdminTier
      ? await pool.query(
          `SELECT * FROM cold_room_alarm_rule WHERE site_id = $1 ORDER BY created_at DESC`,
          [req.params.siteId],
        )
      : await pool.query(
          `SELECT * FROM cold_room_alarm_rule
            WHERE site_id = $1 AND (visible_to_all OR $2 = ANY(viewer_user_ids))
            ORDER BY created_at DESC`,
          [req.params.siteId, u.id || ''],
        );
    res.json({ ok: true, data: rows.map(ruleRowToObj) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/:siteId/alarm-rules', requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const b = req.body || {};
    const id = b.id || `alarm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const recUserIds = Array.isArray(b.recipientUserIds)
      ? b.recipientUserIds.filter((s) => typeof s === 'string' && s.length > 0)
      : [];
    const viewerIds = Array.isArray(b.viewerUserIds)
      ? b.viewerUserIds.filter((s) => typeof s === 'string' && s.length > 0)
      : [];
    const visibleToAll = b.visibleToAll !== false;
    await pool.query(
      `INSERT INTO cold_room_alarm_rule
        (id, site_id, name, enabled, metric, op, threshold, target_kind, target_value,
         sustained_min, severity, notify_email, notify_ui, recipient_user_ids,
         visible_to_all, viewer_user_ids, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, NOW())`,
      [
        id,
        req.params.siteId,
        b.name,
        b.enabled !== false,
        b.metric,
        b.op,
        b.threshold,
        b.targetKind,
        b.targetValue || null,
        b.sustainedMin || 0,
        b.severity || 'warn',
        recUserIds.length > 0,
        b.notifyUi !== false,
        recUserIds,
        visibleToAll,
        visibleToAll ? [] : viewerIds,
      ],
    );
    res.json({ ok: true, data: { id } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.put('/:siteId/alarm-rules/:ruleId', requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const b = req.body || {};
    const recUserIds = Array.isArray(b.recipientUserIds)
      ? b.recipientUserIds.filter((s) => typeof s === 'string' && s.length > 0)
      : [];
    const viewerIds = Array.isArray(b.viewerUserIds)
      ? b.viewerUserIds.filter((s) => typeof s === 'string' && s.length > 0)
      : [];
    const visibleToAll = b.visibleToAll !== false;
    await pool.query(
      `UPDATE cold_room_alarm_rule SET
        name=$1, enabled=$2, metric=$3, op=$4, threshold=$5, target_kind=$6, target_value=$7,
        sustained_min=$8, severity=$9, notify_email=$10, notify_ui=$11, recipient_user_ids=$12,
        visible_to_all=$13, viewer_user_ids=$14, updated_at=NOW()
       WHERE id=$15 AND site_id=$16`,
      [
        b.name,
        b.enabled !== false,
        b.metric,
        b.op,
        b.threshold,
        b.targetKind,
        b.targetValue || null,
        b.sustainedMin || 0,
        b.severity || 'warn',
        recUserIds.length > 0,
        b.notifyUi !== false,
        recUserIds,
        visibleToAll,
        visibleToAll ? [] : viewerIds,
        req.params.ruleId,
        req.params.siteId,
      ],
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.delete('/:siteId/alarm-rules/:ruleId', requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    await pool.query(`DELETE FROM cold_room_alarm_rule WHERE id=$1 AND site_id=$2`, [
      req.params.ruleId,
      req.params.siteId,
    ]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- Usuarios elegibles del sitio: sub_empresa + admins de la empresa + SuperAdmin ---
router.get('/:siteId/alarm-eligible-users', async (req, res) => {
  try {
    const siteRes = await pool.query(`SELECT sub_empresa_id, empresa_id FROM sitio WHERE id = $1`, [
      req.params.siteId,
    ]);
    if (siteRes.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'Sitio no encontrado' });
    }
    const { sub_empresa_id, empresa_id } = siteRes.rows[0];

    // Incluir usuarios de la empresa del sitio (cualquier sub_empresa, cualquier
    // tipo). SuperAdmins excluidos: son staff Emeltec, no destinatarios
    // operacionales del cliente.
    const { rows } = await pool.query(
      `SELECT id, nombre, COALESCE(apellido,'') AS apellido, email,
              cargo, tipo, sub_empresa_id, empresa_id
       FROM usuario
       WHERE email IS NOT NULL AND email != ''
         AND empresa_id = $1
         AND tipo != 'SuperAdmin'
       ORDER BY
         CASE tipo
           WHEN 'Admin' THEN 3
           WHEN 'Gerente' THEN 2
           ELSE 1
         END DESC,
         nombre`,
      [empresa_id],
    );
    res.json({ ok: true, data: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- Test email (admin diagnostic) ---
router.post('/:siteId/alarm-test-email', async (req, res) => {
  try {
    const u = req.user || {};
    if (u.tipo !== 'SuperAdmin' && u.tipo !== 'Admin') {
      return res.status(403).json({ ok: false, error: 'Solo Admin/SuperAdmin' });
    }
    const toEmail = req.body?.to || u.email;
    if (!toEmail) return res.status(400).json({ ok: false, error: 'Email destino requerido' });

    const siteRes = await pool.query(`SELECT descripcion, id_serial FROM sitio WHERE id = $1`, [
      req.params.siteId,
    ]);
    const site = siteRes.rows[0] || { descripcion: req.params.siteId, id_serial: '—' };

    const fakeRule = {
      severidad: 'crit',
      reg_alias: 'STH-01 · Matanza / Eviscerado',
      sitio_desc: site.descripcion,
      sitio_id: req.params.siteId,
      valor_detectado: '12.4°C',
      condicion_texto: 'temperatura > 10°C',
      id_serial: site.id_serial,
      nombre: 'TEST · Temperatura alta Matanza',
    };
    const userName = `${u.nombre || ''} ${u.apellido || ''}`.trim() || 'operador';

    await sendAlertEmail(
      toEmail,
      userName,
      'este es un correo de prueba del sistema de alarmas cold-room. Verifica que el formato se vea correcto.',
      fakeRule,
    );
    res.json({ ok: true, sentTo: toEmail });
  } catch (err) {
    console.error('[alarm-test-email] error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- Events log (read-only) ---
router.get('/:siteId/alarm-events', async (req, res) => {
  try {
    // JOIN a la regla para mostrar nombre/métrica/severidad en el historial.
    const { rows } = await pool.query(
      `SELECT e.*, r.name AS rule_name, r.metric AS rule_metric, r.op AS rule_op,
              r.threshold AS rule_threshold, r.severity AS rule_severity
         FROM cold_room_alarm_event e
         LEFT JOIN cold_room_alarm_rule r ON r.id = e.rule_id
        WHERE e.site_id = $1
        ORDER BY e.triggered_at DESC
        LIMIT 200`,
      [req.params.siteId],
    );
    res.json({ ok: true, data: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// =============================================================================
// === ALARM EVAL LOOP (cron-like, in-process)
// =============================================================================

const SEVERITY_RANK = { info: 0, warn: 1, crit: 2 };

async function evalRulesForSite(siteId) {
  // Carga reglas habilitadas.
  const rulesRes = await pool.query(
    `SELECT * FROM cold_room_alarm_rule WHERE site_id=$1 AND enabled=TRUE`,
    [siteId],
  );
  if (rulesRes.rowCount === 0) return;
  const rules = rulesRes.rows.map(ruleRowToObj);

  // Carga sensores del sitio (bundle expandido como en /sensors).
  // Para simplicidad evaluamos sólo siteId param. Si quieres bundle multi-site,
  // necesitamos un mapeo cliente→sitios o pasar siteIds en el cron config.
  const sensors = await loadRealColdRoomSensors([siteId], '24h', null);
  if (!sensors || sensors.length === 0) return;

  const nowMs = Date.now();
  for (const rule of rules) {
    const matches = filterSensorsByTarget(sensors, rule);
    for (const m of matches) {
      const { value, label } = extractValueForRule(m, rule, nowMs);
      if (value === null) continue;
      const triggered = evalRuleOp(rule, value);

      // Look up open event for this rule+target.
      const eventKey = `${rule.id}::${label}`;
      const openRes = await pool.query(
        `SELECT * FROM cold_room_alarm_event
         WHERE rule_id=$1 AND target_label=$2 AND resolved_at IS NULL
         ORDER BY triggered_at DESC LIMIT 1`,
        [rule.id, label],
      );
      const open = openRes.rows[0] || null;

      if (triggered && !open) {
        // Nuevo disparo: insertar evento y enviar email si aplica.
        const insRes = await pool.query(
          `INSERT INTO cold_room_alarm_event
            (site_id, rule_id, current_value, target_label, email_sent)
           VALUES ($1,$2,$3,$4,FALSE) RETURNING id`,
          [siteId, rule.id, value, label],
        );
        const eventId = insRes.rows[0].id;
        if (rule.notifyEmail) {
          // Antigüedad del sensor (para indicar si la lectura es stale).
          let staleMin = null;
          if (m.lastSeen) {
            const ts = new Date(m.lastSeen).getTime();
            if (Number.isFinite(ts) && ts > 0) {
              staleMin = Math.floor((nowMs - ts) / 60_000);
            }
          }
          await sendAlarmEmailForRule(siteId, rule, value, label, eventId, staleMin).catch((err) =>
            console.error('[alarm email] error:', err.message),
          );
        }
      } else if (!triggered && open) {
        // Condición se resolvió: cerrar evento.
        await pool.query(`UPDATE cold_room_alarm_event SET resolved_at=NOW() WHERE id=$1`, [
          open.id,
        ]);
      }
    }
  }
}

function filterSensorsByTarget(sensors, rule) {
  if (rule.targetKind === 'all') return sensors;
  if (rule.targetKind === 'sala') {
    return sensors.filter((s) => slugifyArea(s.area) === rule.targetValue);
  }
  if (rule.targetKind === 'sensor') {
    return sensors.filter((s) => s.id === rule.targetValue);
  }
  return [];
}

function extractValueForRule(sensor, rule, nowMs) {
  switch (rule.metric) {
    case 'temperatura':
      return { value: sensor.t, label: `${sensor.id} · ${sensor.area}` };
    case 'humedad':
      return { value: sensor.h, label: `${sensor.id} · ${sensor.area}` };
    case 'transmision': {
      if (!sensor.lastSeen) return { value: null, label: '' };
      const ts = new Date(sensor.lastSeen).getTime();
      if (!Number.isFinite(ts) || ts <= 0) return { value: null, label: '' };
      const ageMin = Math.floor((nowMs - ts) / 60000);
      return { value: ageMin, label: `${sensor.id} · ${sensor.area}` };
    }
  }
  return { value: null, label: '' };
}

function evalRuleOp(rule, v) {
  switch (rule.op) {
    case '>':
      return v > rule.threshold;
    case '>=':
      return v >= rule.threshold;
    case '<':
      return v < rule.threshold;
    case '<=':
      return v <= rule.threshold;
  }
  return false;
}

function fmtStaleAgo(min) {
  if (min === null || min === undefined) return null;
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `hace ${h}h` : `hace ${h}h ${m}min`;
}

async function sendAlarmEmailForRule(siteId, rule, value, targetLabel, eventId, staleMin = null) {
  if (!rule.recipientUserIds || rule.recipientUserIds.length === 0) return;
  // Destinatarios = usuarios de la plataforma elegidos para esta regla.
  const recRes = await pool.query(
    `SELECT id, email, COALESCE(nombre,'') || ' ' || COALESCE(apellido,'') AS name
     FROM usuario
     WHERE id = ANY($1::varchar[]) AND email IS NOT NULL AND email != ''`,
    [rule.recipientUserIds],
  );
  const recipients = recRes.rows;
  if (recipients.length === 0) return;

  // Sitio descripción.
  const siteRes = await pool.query(`SELECT descripcion, id_serial FROM sitio WHERE id=$1`, [
    siteId,
  ]);
  const site = siteRes.rows[0] || { descripcion: siteId, id_serial: siteId };

  const unit = rule.metric === 'temperatura' ? '°C' : rule.metric === 'humedad' ? '%' : 'min';
  const condicionTexto = `${rule.metric} ${rule.op} ${rule.threshold}${unit}`;
  // Si la última lectura es vieja, marcar valor como stale en el email.
  const STALE_EMAIL_MIN = 5;
  const isStale = staleMin !== null && staleMin > STALE_EMAIL_MIN;
  const staleLabel = isStale ? ` (última lectura ${fmtStaleAgo(staleMin)})` : '';
  const reglaPayload = {
    severidad: rule.severity,
    reg_alias: targetLabel,
    sitio_desc: site.descripcion,
    sitio_id: siteId,
    valor_detectado: `${Number(value).toFixed(2)}${unit}${staleLabel}`,
    condicion_texto: condicionTexto,
    id_serial: site.id_serial,
    nombre: rule.name,
  };
  const mensaje = isStale
    ? `se activó la regla "${rule.name}" en ${targetLabel}. ATENCIÓN: el sensor no transmite ${fmtStaleAgo(staleMin)}; el valor mostrado es la última lectura conocida.`
    : `se activó la regla "${rule.name}" en ${targetLabel}.`;

  const sent = [];
  for (const r of recipients) {
    try {
      await sendAlertEmail(r.email, r.name || '', mensaje, reglaPayload);
      sent.push(r.email);
    } catch (err) {
      console.error('[alarm email] failed for recipient id', r.id, err.message);
    }
  }
  if (sent.length > 0) {
    await pool.query(
      `UPDATE cold_room_alarm_event
       SET email_sent=TRUE, email_sent_at=NOW(), email_recipients=$1
       WHERE id=$2`,
      [sent.join(','), eventId],
    );
  }
}

// Cron in-process: cada 60s evalúa todos los sitios con reglas activas.
// Único nodo (no multi-instance); para HA migrar a worker dedicado o PG NOTIFY.
let alarmCronStarted = false;
function startAlarmCron() {
  if (alarmCronStarted) return;
  alarmCronStarted = true;
  const tick = async () => {
    try {
      const { rows } = await pool.query(
        `SELECT DISTINCT site_id FROM cold_room_alarm_rule WHERE enabled=TRUE`,
      );
      for (const r of rows) {
        await evalRulesForSite(r.site_id).catch((err) =>
          console.error('[alarm cron] eval', r.site_id, err.message),
        );
      }
    } catch (err) {
      console.error('[alarm cron] tick:', err.message);
    }
  };
  // Primer tick en 30s, luego cada 60s.
  setTimeout(tick, 30_000);
  setInterval(tick, 60_000);
  console.log('[alarm cron] started (60s interval)');
}
startAlarmCron();

module.exports = router;
