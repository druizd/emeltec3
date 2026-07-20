import { describe, it, expect } from 'vitest';
import { CreateEquipoPayload, PatchEquipoPayload } from '../schema';

describe('CreateEquipoPayload.documento_ids', () => {
  it('por defecto es un array vacío cuando no se envía', () => {
    const parsed = CreateEquipoPayload.parse({ nombre: 'Caudalímetro' });
    expect(parsed.documento_ids).toEqual([]);
  });

  it('acepta ids de documento como strings numéricos', () => {
    const parsed = CreateEquipoPayload.parse({
      nombre: 'PLC',
      documento_ids: ['1', '42', '1007'],
    });
    expect(parsed.documento_ids).toEqual(['1', '42', '1007']);
  });

  it('rechaza ids no numéricos', () => {
    const r = CreateEquipoPayload.safeParse({
      nombre: 'UPS',
      documento_ids: ['abc'],
    });
    expect(r.success).toBe(false);
  });

  it('rechaza más de 50 documentos', () => {
    const r = CreateEquipoPayload.safeParse({
      nombre: 'UPS',
      documento_ids: Array.from({ length: 51 }, (_, i) => String(i + 1)),
    });
    expect(r.success).toBe(false);
  });
});

describe('PatchEquipoPayload.documento_ids', () => {
  it('es opcional (patch parcial sin documento_ids)', () => {
    const r = PatchEquipoPayload.safeParse({ nombre: 'Nuevo nombre' });
    expect(r.success).toBe(true);
  });

  it('permite reemplazar la lista de documentos', () => {
    const parsed = PatchEquipoPayload.parse({ documento_ids: ['5', '6'] });
    expect(parsed.documento_ids).toEqual(['5', '6']);
  });
});
