/**
 * Schemas Zod para módulo DGA — modelo redesign 2026-05-17.
 */
import { z } from 'zod';
import { formatRutForDga } from '../../utils/rut';

export const Periodicidad = z.enum(['hora', 'dia', 'semana', 'mes']);
export type Periodicidad = z.infer<typeof Periodicidad>;

export const DgaTransport = z.enum(['off', 'shadow', 'rest']);
export type DgaTransport = z.infer<typeof DgaTransport>;

const RutPayload = z
  .string()
  .transform((value) => formatRutForDga(value))
  .refine((value) => value.length > 0, 'rut requerido')
  .refine((value) => value.length <= 20, 'rut maximo 20 caracteres');

const NullableRutPayload = z
  .union([RutPayload, z.literal('').transform(() => null), z.null()])
  .optional();

// ============================================================================
// Informantes (pool global)
// ============================================================================

export const UpsertInformantePayload = z.object({
  rut: RutPayload,
  /** Opcional en update si solo se cambia referencia. Required en create. */
  clave_informante: z.string().min(1).max(200).optional(),
  referencia: z.string().trim().max(150).nullable().optional(),
});
export type UpsertInformantePayload = z.infer<typeof UpsertInformantePayload>;

// ============================================================================
// pozo_config DGA (config envío por pozo)
// ============================================================================

/**
 * Patch parcial de los campos DGA del pozo. Todos opcionales.
 * `dga_transport='rest'` requiere 2FA en el endpoint (header X-2FA-Code).
 */
export const PatchPozoDgaConfigPayload = z
  .object({
    dga_activo: z.boolean().optional(),
    dga_transport: DgaTransport.optional(),
    dga_caudal_max_lps: z.number().nonnegative().nullable().optional(),
    dga_caudal_tolerance_pct: z.number().min(0).max(500).optional(),
    dga_periodicidad: Periodicidad.nullable().optional(),
    dga_fecha_inicio: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha_inicio debe ser YYYY-MM-DD')
      .nullable()
      .optional(),
    dga_hora_inicio: z
      .string()
      .regex(/^\d{2}:\d{2}(:\d{2})?$/, 'hora_inicio debe ser HH:MM o HH:MM:SS')
      .nullable()
      .optional(),
    dga_informante_rut: NullableRutPayload,
    dga_max_retry_attempts: z.number().int().min(1).max(30).optional(),
    // Solicitado por CCU_Central: habilita el export de este sitio a GCS.
    dga_gcs_export: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Debe especificarse al menos un campo a actualizar',
  });
export type PatchPozoDgaConfigPayload = z.infer<typeof PatchPozoDgaConfigPayload>;

// ============================================================================
// Review queue
// ============================================================================

export const ListReviewQueueParams = z.object({
  site_id: z.string().trim().min(1).max(10).optional(),
  // Rango inclusivo sobre dato_dga.ts. Opcionales e independientes: se puede
  // pedir "desde el 1 de junio" sin tope superior.
  desde: z.string().datetime({ offset: true }).optional(),
  hasta: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});
export type ListReviewQueueParams = z.infer<typeof ListReviewQueueParams>;

export const ReconocerSensorPayload = z.object({
  site_id: z.string().trim().min(1).max(10),
  /** Descripción de la falla / recambio programado. Queda en la marca del
   *  sensor, en la incidencia de bitácora y en el admin_override de los
   *  slots aceptados en bloque. */
  nota: z.string().trim().min(5).max(500),
});
export type ReconocerSensorPayload = z.infer<typeof ReconocerSensorPayload>;

export const ReviewSlotActionPayload = z.object({
  site_id: z.string().trim().min(1).max(10),
  ts: z.string().datetime({ offset: true }),
  action: z.enum(['accept', 'discard']),
  values: z
    .object({
      caudal_instantaneo: z.number().nullable().optional(),
      flujo_acumulado: z.number().nullable().optional(),
      nivel_freatico: z.number().nullable().optional(),
    })
    .optional(),
  admin_note: z.string().trim().min(1).max(500),
});
export type ReviewSlotActionPayload = z.infer<typeof ReviewSlotActionPayload>;

/**
 * Acción en bloque sobre un rango de slots.
 *
 * `recalcular` los devuelve a `vacio` para que el fill los recompute con la
 * config actual del `reg_map` — la contraparte de corregir un mapeo, porque el
 * valor ya materializado en `dato_dga` no se recalcula solo.
 *
 * `dar_de_baja` los cierra como `fallido` con la nota del admin, para el dato
 * que existe pero no es declarable.
 *
 * `nota` es obligatoria en las dos: queda en la auditoría y, en la baja,
 * también dentro del slot. Un rango sin explicación es exactamente lo que hace
 * imposible reconstruir después por qué un mes no se declaró.
 */
export const BulkSlotActionPayload = z
  .object({
    action: z.enum(['recalcular', 'dar_de_baja']),
    desde: z.string().datetime({ offset: true }),
    hasta: z.string().datetime({ offset: true }),
    nota: z.string().trim().min(5).max(500),
  })
  .refine((v) => new Date(v.desde) < new Date(v.hasta), {
    message: 'desde debe ser anterior a hasta',
    path: ['hasta'],
  });
export type BulkSlotActionPayload = z.infer<typeof BulkSlotActionPayload>;

// ============================================================================
// Lectura mediciones
// ============================================================================

export const QueryDatoDgaParams = z.object({
  site_id: z.string().trim().min(1).max(10),
  desde: z.string().datetime({ offset: true }),
  hasta: z.string().datetime({ offset: true }),
});
export type QueryDatoDgaParams = z.infer<typeof QueryDatoDgaParams>;

/** Rango para el resumen por estado que precede a una acción en bloque. */
export const SlotsResumenParams = z
  .object({
    desde: z.string().datetime({ offset: true }),
    hasta: z.string().datetime({ offset: true }),
  })
  .refine((v) => new Date(v.desde) < new Date(v.hasta), {
    message: 'desde debe ser anterior a hasta',
    path: ['hasta'],
  });
export type SlotsResumenParams = z.infer<typeof SlotsResumenParams>;
