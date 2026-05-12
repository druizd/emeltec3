/**
 * Helpers de proyección y reshape para filas crudas de la tabla `equipo`.
 * Sin transformaciones físicas (esas viven en sites/transforms.ts).
 */
import type { OnlineRow, RawRow } from './repo';

export interface HistoryRowOut {
  id_serial: string;
  fecha: string;
  hora: string;
  data: Record<string, unknown>;
  timestamp_completo: string;
  selected_keys: string[];
  keys_present: string[];
}

export interface OnlineRowOut {
  id_serial: string;
  nombre_dato: string;
  valor_dato: unknown;
  fecha: string;
  hora: string;
  timestamp_completo: string;
}

export function projectDataByKeys(
  data: Record<string, unknown> | null | undefined,
  selectedKeys: string[],
): Record<string, unknown> {
  if (!selectedKeys.length) return data ?? {};
  const out: Record<string, unknown> = {};
  const src = data ?? {};
  for (const k of selectedKeys) {
    if (Object.prototype.hasOwnProperty.call(src, k)) {
      out[k] = src[k];
    }
  }
  return out;
}

export function mapHistoryRow(row: RawRow, selectedKeys: string[]): HistoryRowOut {
  const projected = projectDataByKeys(row.data, selectedKeys);
  return {
    id_serial: row.id_serial,
    fecha: row.fecha,
    hora: row.hora,
    data: projected,
    timestamp_completo: `${row.fecha} ${row.hora}`,
    selected_keys: selectedKeys,
    keys_present: Object.keys(projected),
  };
}

export function mapOnlineRow(row: OnlineRow): OnlineRowOut {
  return {
    id_serial: row.id_serial,
    nombre_dato: row.nombre_dato,
    valor_dato: row.valor_dato,
    fecha: row.fecha,
    hora: row.hora,
    timestamp_completo: `${row.fecha} ${row.hora}`,
  };
}

export function snapshotFromOnline(rows: OnlineRowOut[]): Record<string, unknown> {
  return Object.fromEntries(rows.map((r) => [r.nombre_dato, r.valor_dato]));
}

export function payloadBytes(obj: unknown): number {
  return Buffer.byteLength(JSON.stringify(obj), 'utf8');
}
