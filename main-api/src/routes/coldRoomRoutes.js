const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const pool = require('../config/db');

router.use(protect);

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
      await pool.query(
        `DELETE FROM cold_room_threshold WHERE site_id=$1 AND sala_slug=$2`,
        [siteId, r.fromSlug],
      );
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
        [siteId, r.toArea, JSON.stringify({ slug: r.fromSlug }), JSON.stringify({ slug: r.toSlug })],
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
  return { name, role: u.tipo || null };
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

router.put('/:siteId/thresholds/:slug', async (req, res) => {
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

router.delete('/:siteId/thresholds/:slug', async (req, res) => {
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

router.post('/:siteId/thresholds/reset', async (req, res) => {
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

router.post('/:siteId/defrost', async (req, res) => {
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

router.put('/:siteId/defrost/:id', async (req, res) => {
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

router.delete('/:siteId/defrost/:id', async (req, res) => {
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

router.put('/:siteId/acks/:devId', async (req, res) => {
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

router.delete('/:siteId/acks/:devId', async (req, res) => {
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

router.post('/:siteId/audit', async (req, res) => {
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

function buildHist(baseT, range) {
  const preset = RANGE_PRESETS[range] || RANGE_PRESETS['24h'];
  const { points, intervalMs } = preset;
  const now = Date.now();
  const data = [];
  for (let i = 0; i < points; i++) {
    const phase = Math.sin((i + 5) / Math.max(points / 12, 1)) * 0.8;
    const jitter = (Math.random() - 0.5) * 0.4;
    const drift = Math.cos(i / Math.max(points / 4, 1)) * 0.3;
    data.push({
      t: new Date(now - (points - 1 - i) * intervalMs).toISOString(),
      v: +(baseT + phase + drift + jitter).toFixed(2),
    });
  }
  return data;
}

function buildHistHum(baseH, range) {
  const preset = RANGE_PRESETS[range] || RANGE_PRESETS['24h'];
  const { points, intervalMs } = preset;
  const now = Date.now();
  const data = [];
  for (let i = 0; i < points; i++) {
    const phase = Math.sin((i + 3) / Math.max(points / 10, 1)) * 2;
    const jitter = (Math.random() - 0.5) * 1.2;
    const v = Math.max(30, Math.min(99, baseH + phase + jitter));
    data.push({
      t: new Date(now - (points - 1 - i) * intervalMs).toISOString(),
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

router.get('/:siteId/sensors', (req, res) => {
  const tap = normalizeTap(req.query.tap);
  const range = normalizeRange(req.query.range);
  if (tap === 'TAP 1') return res.json({ ok: true, data: [] });
  const filtered = tap ? PLACEHOLDER_SENSORS.filter((s) => s.tap === tap) : PLACEHOLDER_SENSORS;
  res.json({
    ok: true,
    data: filtered.map((s) => sensorSnapshot(s, range)),
    meta: { range, count: filtered.length, serverTime: new Date().toISOString() },
  });
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

router.get('/:siteId/concentrator', (req, res) => {
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

router.get('/:siteId/backup', (req, res) => {
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

router.get('/:siteId/alarms', (req, res) => {
  const tap = normalizeTap(req.query.tap);
  const items = PLACEHOLDER_SENSORS.filter((s) => !tap || s.tap === tap)
    .filter(() => Math.random() < 0.18)
    .map((s) => ({
      id: `${s.id}-${Date.now()}`,
      sensorId: s.id,
      tap: s.tap,
      area: s.area,
      severity: Math.random() < 0.3 ? 'critical' : 'warning',
      message: `Temperatura fuera de banda (${s.tMin}°C / ${s.tMax}°C)`,
      since: new Date(Date.now() - Math.round(Math.random() * 1000 * 60 * 30)).toISOString(),
      acknowledged: false,
    }));
  res.json({ ok: true, data: items });
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

module.exports = router;
