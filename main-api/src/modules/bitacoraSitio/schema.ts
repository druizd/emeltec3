/**
 * Schemas Zod para Bitácora del sitio: ficha + equipamiento.
 */
import { z } from 'zod';

const FichaContacto = z.object({
  nombre: z.string().trim().min(1).max(150),
  rol: z.string().trim().max(50),
  telefono: z.string().trim().max(50).nullable().optional(),
  email: z.string().trim().max(150).nullable().optional(),
});

const FichaAcreditacion = z.object({
  persona: z.string().trim().min(1).max(150),
  tipo: z.string().trim().min(1).max(80),
  vigencia_hasta: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

const FichaRiesgo = z.object({
  descripcion: z.string().trim().min(1).max(500),
  probabilidad: z.number().int().min(1).max(5).nullable().optional(),
  impacto: z.number().int().min(1).max(5).nullable().optional(),
  mitigacion: z.string().trim().max(500).nullable().optional(),
});

export const FichaPayload = z.object({
  pin_critico: z.string().trim().max(500).nullable().optional(),
  contactos: z.array(FichaContacto).default([]),
  acreditaciones: z.array(FichaAcreditacion).default([]),
  riesgos: z.array(FichaRiesgo).default([]),
});
export type FichaPayload = z.infer<typeof FichaPayload>;

export const EquipoEstado = z.enum(['operativo', 'en_mantencion', 'fuera_de_servicio']);
export type EquipoEstado = z.infer<typeof EquipoEstado>;

export const CreateEquipoPayload = z.object({
  nombre: z.string().trim().min(1).max(200),
  modelo: z.string().trim().max(150).nullable().optional(),
  fabricante: z.string().trim().max(150).nullable().optional(),
  serie: z.string().trim().max(100).nullable().optional(),
  fecha_compra: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  garantia_hasta: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  estado: EquipoEstado.default('operativo'),
  notas: z.string().trim().max(2000).nullable().optional(),
});
export type CreateEquipoPayload = z.infer<typeof CreateEquipoPayload>;

export const PatchEquipoPayload = CreateEquipoPayload.partial();
export type PatchEquipoPayload = z.infer<typeof PatchEquipoPayload>;
