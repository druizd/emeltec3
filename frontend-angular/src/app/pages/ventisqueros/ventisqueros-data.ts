export const PLANO_W = 1066.6667;
export const PLANO_H = 800;

export type MetricKey = 'T' | 'H' | 'A';
export type TapKey = 'TAP 1' | 'TAP 2' | 'TAP 3' | 'TAP 4';

export interface SensorBase {
  id: string;
  tap: TapKey;
  area: string;
  cx: number;
  cy: number;
  r: number;
}

export interface Sensor extends SensorBase {
  t: number;
  h: number;
  hist: number[];
  alerted: boolean;
}

export interface ConcentratorState {
  alerted: boolean;
  lastSeen: string | null;
}

export const TAPS: TapKey[] = ['TAP 1', 'TAP 2', 'TAP 3', 'TAP 4'];

// Concentrador maestro (TAP 1) + 3 TAPs de sensores THM.
export const TAP_COLORS: Record<TapKey, string> = {
  'TAP 1': '#0DAFBD',
  'TAP 2': '#0EA5E9',
  'TAP 3': '#6366F1',
  'TAP 4': '#8B5CF6',
};

// Escala invertida: -40°C es objetivo (teal "safe"), más caliente = peor.
const TEMP_STOPS: Array<[number, [number, number, number]]> = [
  [-40, [13, 175, 189]],
  [-30, [16, 185, 129]],
  [-20, [132, 204, 22]],
  [-10, [234, 179, 8]],
  [0, [245, 158, 11]],
  [10, [249, 115, 22]],
  [20, [239, 68, 68]],
  [28, [153, 27, 27]],
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
