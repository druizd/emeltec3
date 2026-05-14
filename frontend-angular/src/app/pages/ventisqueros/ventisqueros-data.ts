export const PLANO_W = 1066.6667;
export const PLANO_H = 800;

export type AlertMode = 'ok' | 'single' | 'multi';
export type MetricKey = 'T' | 'H' | 'A';
export type TapKey = 'TAP 1' | 'TAP 2' | 'TAP 3' | 'TAP 4';

export interface SensorBase {
  id: string;
  tap: TapKey;
  area: string;
  cx: number;
  cy: number;
  r: number;
  baseT: number;
  baseH: number;
}

export interface Sensor extends SensorBase {
  t: number;
  h: number;
  hist: number[];
  alerted: boolean;
}

// Cold-chain: objetivo -40°C. baseT por área refleja zona típica de operación.
// TAP 1 = concentrador maestro (sin sensores propios). TAP 2/3/4 = 4/4/5 sensores.
export const SENSORS_BASE: SensorBase[] = [
  // TAP 2 — línea matanza / proceso refrigerado primario
  { id: 'STH-01', tap: 'TAP 2', area: 'Matanza / Eviscerado', cx: 466.66, cy: 633.27, r: 95, baseT: -5, baseH: 74 },
  { id: 'STH-02', tap: 'TAP 2', area: 'Calibrado', cx: 363.38, cy: 597.36, r: 85, baseT: -8, baseH: 78 },
  { id: 'STH-03', tap: 'TAP 2', area: 'Calibrado', cx: 363.38, cy: 502.15, r: 78, baseT: -10, baseH: 79 },
  { id: 'STH-04', tap: 'TAP 2', area: 'Empaque Primario', cx: 447.96, cy: 451.87, r: 90, baseT: -28, baseH: 78 },

  // TAP 3 — frigorífico primario + filete + tránsito
  { id: 'STH-05', tap: 'TAP 3', area: 'Antecámara Primaria', cx: 477.2, cy: 456.34, r: 55, baseT: -22, baseH: 86 },
  { id: 'STH-06', tap: 'TAP 3', area: 'Frigorífico Primario', cx: 484.49, cy: 419.26, r: 70, baseT: -34, baseH: 88 },
  { id: 'STH-07', tap: 'TAP 3', area: 'Filete', cx: 369.55, cy: 312.89, r: 110, baseT: -15, baseH: 80 },
  { id: 'STH-08', tap: 'TAP 3', area: 'Producto en Tránsito', cx: 432.34, cy: 261.13, r: 80, baseT: -18, baseH: 77 },

  // TAP 4 — línea secundaria + congelado profundo
  { id: 'STH-09', tap: 'TAP 4', area: 'Empaque Secundario', cx: 418.74, cy: 142.51, r: 95, baseT: -26, baseH: 70 },
  { id: 'STH-10', tap: 'TAP 4', area: 'Sala de Porciones', cx: 476.26, cy: 198.83, r: 75, baseT: -20, baseH: 73 },
  { id: 'STH-11', tap: 'TAP 4', area: 'Empaque Secundario', cx: 523.79, cy: 166.83, r: 60, baseT: -25, baseH: 71 },
  { id: 'STH-12', tap: 'TAP 4', area: 'Antecámara Secundaria', cx: 580.23, cy: 167.87, r: 70, baseT: -30, baseH: 84 },
  { id: 'STH-13', tap: 'TAP 4', area: 'Cámara Secundaria', cx: 682.66, cy: 199.72, r: 130, baseT: -38, baseH: 93 },
];

export const TAPS: TapKey[] = ['TAP 1', 'TAP 2', 'TAP 3', 'TAP 4'];

// Paleta cold-storage: teal Emeltec + gradiente cool. Cada TAP = instalación.
export const TAP_COLORS: Record<TapKey, string> = {
  'TAP 1': '#0DAFBD', // teal brand
  'TAP 2': '#0EA5E9', // sky
  'TAP 3': '#6366F1', // indigo
  'TAP 4': '#8B5CF6', // violet
};

// Escala invertida: -40°C es la temperatura objetivo (verde/teal "safe"),
// más caliente = peor. Cold-storage / cámaras frigoríficas Ventisqueros.
const TEMP_STOPS: Array<[number, [number, number, number]]> = [
  [-40, [13, 175, 189]],   // #0DAFBD teal — objetivo
  [-30, [16, 185, 129]],   // #10B981 verde
  [-20, [132, 204, 22]],   // #84CC16 lima
  [-10, [234, 179, 8]],    // #EAB308 amarillo
  [0,   [245, 158, 11]],   // #F59E0B ámbar
  [10,  [249, 115, 22]],   // #F97316 naranja
  [20,  [239, 68, 68]],    // #EF4444 rojo
  [28,  [153, 27, 27]],    // #991B1B rojo profundo
];

const HUM_STOPS: Array<[number, [number, number, number]]> = [
  [40, [254, 243, 199]],
  [60, [167, 243, 208]],
  [75, [103, 232, 249]],
  [88, [14, 165, 233]],
  [100, [29, 78, 216]],
];

function interpolate(value: number, stops: Array<[number, [number, number, number]]>): string {
  if (value <= stops[0][0]) return rgbStr(stops[0][1]);
  if (value >= stops[stops.length - 1][0]) return rgbStr(stops[stops.length - 1][1]);
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i];
    const [b, cb] = stops[i + 1];
    if (value >= a && value <= b) {
      const k = (value - a) / (b - a);
      return rgbStr([
        Math.round(ca[0] + (cb[0] - ca[0]) * k),
        Math.round(ca[1] + (cb[1] - ca[1]) * k),
        Math.round(ca[2] + (cb[2] - ca[2]) * k),
      ]);
    }
  }
  return rgbStr(stops[stops.length - 1][1]);
}

export function tempColor(t: number): string {
  return interpolate(t, TEMP_STOPS);
}

export function humColor(h: number): string {
  return interpolate(h, HUM_STOPS);
}

function rgbStr([r, g, b]: [number, number, number]): string {
  return `rgb(${r}, ${g}, ${b})`;
}

export function fmtTemp(t: number): string {
  return `${t.toFixed(1)}°C`;
}

export function fmtHum(h: number): string {
  return `${h}%`;
}

function makeReading(s: SensorBase, alerted: boolean, hourSeed: number) {
  const drift = alerted
    ? (Math.random() * 6 + 5) * (Math.random() < 0.5 ? -1 : 1)
    : (Math.random() - 0.5) * 0.6;
  const hDrift = alerted
    ? (Math.random() * 10 + 5) * (Math.random() < 0.5 ? -1 : 1)
    : (Math.random() - 0.5) * 2.0;
  const t = +(s.baseT + drift).toFixed(1);
  const h = Math.max(35, Math.min(99, Math.round(s.baseH + hDrift)));
  const hist = Array.from({ length: 24 }, (_, i) => {
    const phase = Math.sin((i + hourSeed) / 4) * 0.6;
    return +(s.baseT + phase + (Math.random() - 0.5) * 0.3).toFixed(2);
  });
  hist[hist.length - 1] = t;
  return { t, h, hist, alerted };
}

export function buildLiveData(alertMode: AlertMode): Sensor[] {
  let alertIds = new Set<string>();
  if (alertMode === 'single') alertIds = new Set(['STH-06']);
  if (alertMode === 'multi') alertIds = new Set(['STH-06', 'STH-13', 'STH-09']);

  return SENSORS_BASE.map((s, i) => ({
    ...s,
    ...makeReading(s, alertIds.has(s.id), i * 3),
  }));
}
