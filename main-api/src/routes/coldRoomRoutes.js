const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');

router.use(protect);

const PLACEHOLDER_SENSORS = [
  // TAP 2
  {
    id: 'STH-01',
    tap: 'TAP 2',
    area: 'Matanza / Eviscerado',
    cx: 466.66,
    cy: 633.27,
    r: 95,
    t: -5.2,
    h: 74,
    setpoint: -6,
    tMin: -10,
    tMax: 0,
  },
  {
    id: 'STH-02',
    tap: 'TAP 2',
    area: 'Calibrado',
    cx: 363.38,
    cy: 597.36,
    r: 85,
    t: -8.1,
    h: 78,
    setpoint: -8,
    tMin: -12,
    tMax: -2,
  },
  {
    id: 'STH-03',
    tap: 'TAP 2',
    area: 'Calibrado',
    cx: 363.38,
    cy: 502.15,
    r: 78,
    t: -10.4,
    h: 79,
    setpoint: -10,
    tMin: -14,
    tMax: -4,
  },
  {
    id: 'STH-04',
    tap: 'TAP 2',
    area: 'Empaque Primario',
    cx: 447.96,
    cy: 451.87,
    r: 90,
    t: -28.3,
    h: 78,
    setpoint: -28,
    tMin: -32,
    tMax: -22,
  },
  // TAP 3
  {
    id: 'STH-05',
    tap: 'TAP 3',
    area: 'Antecámara Primaria',
    cx: 477.2,
    cy: 456.34,
    r: 55,
    t: -22.1,
    h: 86,
    setpoint: -22,
    tMin: -26,
    tMax: -16,
  },
  {
    id: 'STH-06',
    tap: 'TAP 3',
    area: 'Cámara Primaria',
    cx: 484.49,
    cy: 419.26,
    r: 70,
    t: -34.5,
    h: 88,
    setpoint: -34,
    tMin: -38,
    tMax: -18,
  },
  {
    id: 'STH-07',
    tap: 'TAP 3',
    area: 'Filete',
    cx: 369.55,
    cy: 312.89,
    r: 110,
    t: -15.2,
    h: 80,
    setpoint: -15,
    tMin: -19,
    tMax: -9,
  },
  {
    id: 'STH-08',
    tap: 'TAP 3',
    area: 'Cámara de Tránsito',
    cx: 432.34,
    cy: 261.13,
    r: 80,
    t: -18.6,
    h: 77,
    setpoint: 0,
    tMin: -22,
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
    t: -26.4,
    h: 70,
    setpoint: -26,
    tMin: -30,
    tMax: -20,
  },
  {
    id: 'STH-10',
    tap: 'TAP 4',
    area: 'Porciones',
    cx: 476.26,
    cy: 198.83,
    r: 75,
    t: -20.7,
    h: 73,
    setpoint: -20,
    tMin: -24,
    tMax: 10,
  },
  {
    id: 'STH-11',
    tap: 'TAP 4',
    area: 'Empaque Secundario',
    cx: 523.79,
    cy: 166.83,
    r: 60,
    t: -25.3,
    h: 71,
    setpoint: -25,
    tMin: -29,
    tMax: -19,
  },
  {
    id: 'STH-12',
    tap: 'TAP 4',
    area: 'Antecámara Secundaria',
    cx: 580.23,
    cy: 167.87,
    r: 70,
    t: -30.1,
    h: 84,
    setpoint: -30,
    tMin: -34,
    tMax: -24,
  },
  {
    id: 'STH-13',
    tap: 'TAP 4',
    area: 'Cámara Secundaria',
    cx: 682.66,
    cy: 199.72,
    r: 130,
    t: -38.2,
    h: 93,
    setpoint: -38,
    tMin: -42,
    tMax: -32,
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
  rows.push(['sensor_id', 'tap', 'area', 'timestamp_iso', 'temperatura_c', 'humedad_pct'].join(','));
  filtered.forEach((s) => {
    const tempSeries = buildHist(s.t, range);
    const humSeries = buildHistHum(s.h, range);
    tempSeries.forEach((p, i) => {
      const hVal = humSeries[i] ? humSeries[i].v : '';
      rows.push(
        [s.id, s.tap, JSON.stringify(s.area), p.t, p.v, hVal].join(','),
      );
    });
  });
  const filename = `cold-room-${req.params.siteId}-${tap || 'all'}-${range}.csv`.replace(/\s+/g, '-');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(rows.join('\n'));
});

module.exports = router;
