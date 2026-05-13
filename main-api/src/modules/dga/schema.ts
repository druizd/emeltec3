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
  fecha_inicio: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha_inicio debe ser YYYY-MM-DD'),
  hora_inicio: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/, 'hora_inicio debe ser HH:MM o HH:MM:SS'),
});
export type CreateDgaUserPayload = z.infer<typeof CreateDgaUserPayload>;

export const QueryDatoDgaParams = z.object({
  id_dgauser: z.coerce.number().int().positive(),
  desde: z.string().datetime({ offset: true }),
  hasta: z.string().datetime({ offset: true }),
});
export type QueryDatoDgaParams = z.infer<typeof QueryDatoDgaParams>;
