const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');

router.use(protect);

const PLACEHOLDER_SENSORS = [
  // TAP 2
  { id: 'STH-01', tap: 'TAP 2', area: 'Matanza / Eviscerado', cx: 466.66, cy: 633.27, r: 95, t: -5.2, h: 74 },
  { id: 'STH-02', tap: 'TAP 2', area: 'Calibrado', cx: 363.38, cy: 597.36, r: 85, t: -8.1, h: 78 },
  { id: 'STH-03', tap: 'TAP 2', area: 'Calibrado', cx: 363.38, cy: 502.15, r: 78, t: -10.4, h: 79 },
  { id: 'STH-04', tap: 'TAP 2', area: 'Empaque Primario', cx: 447.96, cy: 451.87, r: 90, t: -28.3, h: 78 },
  // TAP 3
  { id: 'STH-05', tap: 'TAP 3', area: 'Antecámara Primaria', cx: 477.2, cy: 456.34, r: 55, t: -22.1, h: 86 },
  { id: 'STH-06', tap: 'TAP 3', area: 'Frigorífico Primario', cx: 484.49, cy: 419.26, r: 70, t: -34.5, h: 88 },
  { id: 'STH-07', tap: 'TAP 3', area: 'Filete', cx: 369.55, cy: 312.89, r: 110, t: -15.2, h: 80 },
  { id: 'STH-08', tap: 'TAP 3', area: 'Producto en Tránsito', cx: 432.34, cy: 261.13, r: 80, t: -18.6, h: 77 },
  // TAP 4
  { id: 'STH-09', tap: 'TAP 4', area: 'Empaque Secundario', cx: 418.74, cy: 142.51, r: 95, t: -26.4, h: 70 },
  { id: 'STH-10', tap: 'TAP 4', area: 'Sala de Porciones', cx: 476.26, cy: 198.83, r: 75, t: -20.7, h: 73 },
  { id: 'STH-11', tap: 'TAP 4', area: 'Empaque Secundario', cx: 523.79, cy: 166.83, r: 60, t: -25.3, h: 71 },
  { id: 'STH-12', tap: 'TAP 4', area: 'Antecámara Secundaria', cx: 580.23, cy: 167.87, r: 70, t: -30.1, h: 84 },
  { id: 'STH-13', tap: 'TAP 4', area: 'Cámara Secundaria', cx: 682.66, cy: 199.72, r: 130, t: -38.2, h: 93 },
];

function buildHist(baseT) {
  return Array.from({ length: 24 }, (_, i) => {
    const phase = Math.sin((i + 5) / 4) * 0.6;
    const jitter = (Math.random() - 0.5) * 0.3;
    return +(baseT + phase + jitter).toFixed(2);
  });
}

function jitter(value, range = 0.4) {
  return +(value + (Math.random() - 0.5) * range * 2).toFixed(1);
}

router.get('/:siteId/sensors', (req, res) => {
  const sensors = PLACEHOLDER_SENSORS.map((s) => {
    const t = jitter(s.t, 0.4);
    return {
      id: s.id,
      tap: s.tap,
      area: s.area,
      cx: s.cx,
      cy: s.cy,
      r: s.r,
      t,
      h: Math.max(35, Math.min(99, s.h + Math.round((Math.random() - 0.5) * 4))),
      alerted: false,
      hist: buildHist(s.t),
    };
  });
  res.json({ ok: true, data: sensors });
});

router.get('/:siteId/concentrator', (req, res) => {
  res.json({
    ok: true,
    data: {
      alerted: false,
      lastSeen: new Date().toISOString(),
    },
  });
});

router.get('/:siteId/backup', (req, res) => {
  // TAP 1 envía las mismas variables T/H que TAPs 2-4 por canal redundante,
  // más un booleano por sensor que refleja alerta física (contacto seco).
  const backup = PLACEHOLDER_SENSORS.map((s) => {
    // Backup difiere ligeramente del primary (canal independiente, drift natural).
    const t = jitter(s.t, 0.6);
    return {
      id: s.id,
      area: s.area,
      t,
      h: Math.max(35, Math.min(99, s.h + Math.round((Math.random() - 0.5) * 6))),
      alertaFisica: false,
      hist: buildHist(s.t),
    };
  });
  res.json({ ok: true, data: backup });
});

module.exports = router;
