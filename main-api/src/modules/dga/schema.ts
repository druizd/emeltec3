/**
 * Schemas Zod para módulo DGA.
 */
import { z } from 'zod';

export const Periodicidad = z.enum(['hora', 'dia', 'semana', 'mes']);
export type Periodicidad = z.infer<typeof Periodicidad>;

export const CreateDgaUserPayload = z.object({
  site_id: z.string().trim().min(1, 'site_id requerido').max(10),
  nombre_informante: z.string().trim().min(1, 'nombre_informante requerido').max(150),
  rut_informante: z.string().trim().min(1, 'rut_informante requerido').max(20),
  clave_informante: z.string().min(1, 'clave_informante requerida').max(200),
  periodicidad: Periodicidad,
  fecha_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha_inicio debe ser YYYY-MM-DD'),
  hora_inicio: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'hora_inicio debe ser HH:MM o HH:MM:SS'),
});
export type CreateDgaUserPayload = z.infer<typeof CreateDgaUserPayload>;

export const DgaTransport = z.enum(['off', 'shadow', 'rest']);
export type DgaTransport = z.infer<typeof DgaTransport>;

/**
 * Patch parcial de config DGA del informante. Todos opcionales — solo se
 * actualizan los presentes. `caudal_max_lps` admite null para limpiar el
 * valor cargado (vuelve al fallback hardcode 1000 L/s).
 */
export const UpdateDgaUserConfigPayload = z
  .object({
    activo: z.boolean().optional(),
    transport: DgaTransport.optional(),
    caudal_max_lps: z.number().nonnegative().nullable().optional(),
    caudal_tolerance_pct: z.number().min(0).max(500).optional(),
  })
  .refine(
    (v) =>
      v.activo !== undefined ||
      v.transport !== undefined ||
      v.caudal_max_lps !== undefined ||
      v.caudal_tolerance_pct !== undefined,
    { message: 'Debe especificarse al menos un campo a actualizar' },
  );
export type UpdateDgaUserConfigPayload = z.infer<typeof UpdateDgaUserConfigPayload>;

export const ListReviewQueueParams = z.object({
  site_id: z.string().trim().min(1).max(10).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});
export type ListReviewQueueParams = z.infer<typeof ListReviewQueueParams>;

/**
 * Acción admin sobre un slot requires_review. Si action='accept', los
 * valores en `values` reemplazan los actuales y el slot pasa a pendiente.
 * Si action='discard', el slot pasa a 'fallido' (terminal).
 */
export const ReviewSlotActionPayload = z.object({
  id_dgauser: z.coerce.number().int().positive(),
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

export const QueryDatoDgaParams = z
  .object({
    id_dgauser: z.coerce.number().int().positive().optional(),
    site_id: z.string().trim().min(1).max(10).optional(),
    desde: z.string().datetime({ offset: true }),
    hasta: z.string().datetime({ offset: true }),
  })
  .refine((v) => v.id_dgauser !== undefined || v.site_id !== undefined, {
    message: 'Debe especificarse id_dgauser o site_id',
    path: ['site_id'],
  });
export type QueryDatoDgaParams = z.infer<typeof QueryDatoDgaParams>;
