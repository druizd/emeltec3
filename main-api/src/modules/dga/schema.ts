/**
 * Schemas Zod para módulo DGA — modelo redesign 2026-05-17.
 */
import { z } from 'zod';

export const Periodicidad = z.enum(['hora', 'dia', 'semana', 'mes']);
export type Periodicidad = z.infer<typeof Periodicidad>;

export const DgaTransport = z.enum(['off', 'shadow', 'rest']);
export type DgaTransport = z.infer<typeof DgaTransport>;

// ============================================================================
// Informantes (pool global)
// ============================================================================

export const UpsertInformantePayload = z.object({
  rut: z.string().trim().min(1, 'rut requerido').max(20),
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
 * `dga_transport='rest'` requiere 2FA en el endpoint (header X-DGA-2FA-Code).
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
    dga_informante_rut: z.string().trim().max(20).nullable().optional(),
    dga_max_retry_attempts: z.number().int().min(1).max(30).optional(),
    dga_auto_accept_fallback_hours: z.number().int().min(0).max(720).nullable().optional(),
  })
  .refine(
    (v) =>
      Object.values(v).some((x) => x !== undefined),
    { message: 'Debe especificarse al menos un campo a actualizar' },
  );
export type PatchPozoDgaConfigPayload = z.infer<typeof PatchPozoDgaConfigPayload>;

// ============================================================================
// Review queue
// ============================================================================

export const ListReviewQueueParams = z.object({
  site_id: z.string().trim().min(1).max(10).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});
export type ListReviewQueueParams = z.infer<typeof ListReviewQueueParams>;

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

// ============================================================================
// Lectura mediciones
// ============================================================================

export const QueryDatoDgaParams = z.object({
  site_id: z.string().trim().min(1).max(10),
  desde: z.string().datetime({ offset: true }),
  hasta: z.string().datetime({ offset: true }),
});
export type QueryDatoDgaParams = z.infer<typeof QueryDatoDgaParams>;
