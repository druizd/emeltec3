/**
 * Schemas zod para los endpoints de telemetría (v2).
 * Reemplazan los parsers manuales (parseLimit/parseSelectedKeys/etc) del
 * dataController legacy.
 */
import { z } from 'zod';

const PRESET_VALUES = ['24h', '7d', '30d', '365d', '1y', '1a', '1year'] as const;

/** Acepta arreglo o string CSV; devuelve string[] limpio sin duplicados. */
const keysField = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => {
    if (v === undefined) return [] as string[];
    const arr = Array.isArray(v) ? v : v.split(',');
    return [...new Set(arr.map((s) => String(s).trim()).filter((s) => s.length > 0))];
  });

const limitField = z.coerce.number().int().positive().max(5000).optional();

const serialField = z
  .union([z.string(), z.number()])
  .optional()
  .transform((v) => (v === undefined || v === null ? undefined : String(v).trim() || undefined));

const dateLiteral = z
  .string()
  .min(8)
  .max(40)
  .regex(
    /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?)?Z?$/,
    'Formato fecha inválido (esperado YYYY-MM-DD[ HH:MM[:SS]])',
  );

export const historyQuerySchema = z.object({
  serial_id: serialField,
  id_serial: serialField,
  keys: keysField,
  key: keysField,
  nombre_dato: keysField,
  nombre_datos: keysField,
  variable: keysField,
  variables: keysField,
  from: dateLiteral.optional(),
  to: dateLiteral.optional(),
  limit: limitField,
});

export const onlineQuerySchema = z.object({
  serial_id: serialField,
  id_serial: serialField,
  keys: keysField,
  key: keysField,
  nombre_dato: keysField,
  nombre_datos: keysField,
  variable: keysField,
  variables: keysField,
});

export const presetQuerySchema = z.object({
  serial_id: serialField,
  id_serial: serialField,
  keys: keysField,
  key: keysField,
  preset: z.string().refine((v) => PRESET_VALUES.includes(v.toLowerCase() as never), {
    message: 'Preset inválido. Usa 24h, 7d, 30d o 365d',
  }),
  base_date: dateLiteral.optional(),
  limit: limitField,
});

export type HistoryQuery = z.infer<typeof historyQuerySchema>;
export type OnlineQuery = z.infer<typeof onlineQuerySchema>;
export type PresetQuery = z.infer<typeof presetQuerySchema>;

/** Une todos los aliases de keys en un array final único. */
export function mergeKeyAliases(q: {
  keys?: string[];
  key?: string[];
  nombre_dato?: string[];
  nombre_datos?: string[];
  variable?: string[];
  variables?: string[];
}): string[] {
  const all = [
    ...(q.keys ?? []),
    ...(q.key ?? []),
    ...(q.nombre_dato ?? []),
    ...(q.nombre_datos ?? []),
    ...(q.variable ?? []),
    ...(q.variables ?? []),
  ];
  return [...new Set(all)];
}

/** Resuelve serial_id desde sus aliases. Acepta cualquier objeto que los exponga. */
export function resolveSerial(q: {
  serial_id?: string | undefined;
  id_serial?: string | undefined;
}): string | undefined {
  return q.serial_id ?? q.id_serial;
}

export const PRESETS: Record<
  string,
  { amount: number; unit: 'hours' | 'days'; canonical: string }
> = {
  '24h': { amount: 24, unit: 'hours', canonical: '24h' },
  '7d': { amount: 7, unit: 'days', canonical: '7d' },
  '30d': { amount: 30, unit: 'days', canonical: '30d' },
  '365d': { amount: 365, unit: 'days', canonical: '365d' },
  '1y': { amount: 365, unit: 'days', canonical: '365d' },
  '1a': { amount: 365, unit: 'days', canonical: '365d' },
  '1year': { amount: 365, unit: 'days', canonical: '365d' },
};
