/**
 * Tests del resumen semanal de alertas del cliente.
 *
 * Cubre las dos cosas que lo romperían en silencio:
 *
 *   1. **El slot.** Es semanal: si se pierde, el cliente se entera siete días
 *      después. Por eso no puede depender de que un ciclo caiga en el minuto
 *      exacto, y un slot no enviado tiene que rescatarse dentro de la ventana.
 *   2. **El alcance.** Cada suscriptor ve solo los sitios que podría abrir en
 *      la plataforma. Un error acá le manda a un cliente los pozos de otro.
 *
 * Y la separación en dos secciones, que es la razón de ser del correo: un
 * episodio abierto no significa que el pozo esté fallando hoy.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../config/appConfig', () => ({
  config: { db: { slowLogMs: 1000, statementTimeoutMs: 5000 } },
}));

vi.mock('../../../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../config/heartbeat', () => ({ beat: vi.fn() }));

vi.mock('../../../config/dbHelpers', () => ({
  query: vi.fn(),
  getClient: vi.fn(),
  transaction: vi.fn(),
}));

import {
  slotsCumplidos,
  filasParaSuscriptor,
  etiquetaSitio,
  diaIsoEnChile,
  instanteDeParedChile,
} from '../worker';
import type { AlertaAbiertaRaw } from '../repo';
import { CONFIG_POR_DEFECTO } from '../configRepo';

beforeEach(() => {
  vi.clearAllMocks();
});

/** Fila base: un episodio abierto y en falla de CCU / Quilicura. */
function fila(over: Partial<AlertaAbiertaRaw> = {}): AlertaAbiertaRaw {
  return {
    id: 1,
    sitio_id: 'S140',
    severidad: 'alta',
    mensaje: '[ALTA] Pozo 4. Caudal sobre el derecho.',
    valor_texto: '18,4 L/s',
    valor_detectado: '18.4',
    triggered_at: '2026-09-18T12:00:00.000Z',
    repeticiones: 3,
    normalizada_at: null,
    reconocida_at: null,
    alerta_nombre: 'Caudal alto',
    condicion: 'mayor_que',
    sitio_desc: 'Pozo 4',
    tipo_sitio: 'agua',
    empresa_id: 'E100',
    sub_empresa_id: 'SE1',
    empresa_nombre: 'CCU',
    sub_empresa_nombre: 'Quilicura',
    obra_dga: 'OB-1306-98',
    ...over,
  };
}

const LUNES_8_CHILE = instanteDeParedChile(2026, 9, 21, 8); // lunes 21-09-2026

describe('configuración por defecto', () => {
  it('es viernes 07:00: lo pidió el usuario, no es un número al azar', () => {
    expect(CONFIG_POR_DEFECTO.diaSemana).toBe(5);
    expect(CONFIG_POR_DEFECTO.hora).toBe(7);
  });

  it('el slot por defecto cae un viernes a las 07:00 de Chile', () => {
    // 25-09-2026 es viernes.
    const viernes = instanteDeParedChile(2026, 9, 25, 7);
    expect(diaIsoEnChile(viernes)).toBe(5);
    const slots = slotsCumplidos(new Date(viernes.getTime() + 90_000), CONFIG_POR_DEFECTO);
    expect(slots).toHaveLength(1);
    expect(slots[0]!.toISOString()).toBe(viernes.toISOString());
  });
});

describe('slotsCumplidos', () => {
  const cfg = { diaSemana: 1, hora: 8 }; // lunes 08:00

  it('no devuelve nada antes de la hora del slot', () => {
    const antes = new Date(LUNES_8_CHILE.getTime() - 60_000);
    expect(slotsCumplidos(antes, cfg)).toEqual([]);
  });

  it('rescata el slot aunque ningún ciclo caiga en el minuto exacto', () => {
    // El setInterval de 60 s deriva: el ciclo pasa de 07:59:5x a 08:01:0x.
    const tarde = new Date(LUNES_8_CHILE.getTime() + 70_000);
    const slots = slotsCumplidos(tarde, cfg);
    expect(slots).toHaveLength(1);
    expect(slots[0]!.toISOString()).toBe(LUNES_8_CHILE.toISOString());
  });

  it('sigue rescatando dentro de la ventana de 12 h', () => {
    const casiTarde = new Date(LUNES_8_CHILE.getTime() + 11.5 * 3_600_000);
    expect(slotsCumplidos(casiTarde, cfg)).toHaveLength(1);
  });

  it('abandona el slot pasada la ventana: el resumen viejo ya no sirve', () => {
    const muyTarde = new Date(LUNES_8_CHILE.getTime() + 13 * 3_600_000);
    expect(slotsCumplidos(muyTarde, cfg)).toEqual([]);
  });

  it('no dispara en un día que no es el configurado', () => {
    const martes = new Date(LUNES_8_CHILE.getTime() + 24 * 3_600_000);
    expect(slotsCumplidos(martes, { diaSemana: 1, hora: 8 })).toEqual([]);
  });

  it('respeta el día configurado cuando no es lunes', () => {
    const viernes = instanteDeParedChile(2026, 9, 25, 15);
    const slots = slotsCumplidos(new Date(viernes.getTime() + 120_000), {
      diaSemana: 5,
      hora: 15,
    });
    expect(slots).toHaveLength(1);
    expect(slots[0]!.toISOString()).toBe(viernes.toISOString());
  });
});

describe('diaIsoEnChile', () => {
  it('usa la hora de pared chilena, no la UTC', () => {
    // 2026-09-22T02:30Z es todavía lunes 21 a las 22:30 en Chile.
    expect(diaIsoEnChile(new Date('2026-09-22T02:30:00.000Z'))).toBe(1);
  });

  it('devuelve 7 para el domingo, no 0', () => {
    expect(diaIsoEnChile(new Date('2026-09-20T15:00:00.000Z'))).toBe(7);
  });
});

describe('etiquetaSitio', () => {
  it('arma empresa · sub · sitio · obra', () => {
    expect(etiquetaSitio(fila())).toBe('CCU · Quilicura · Pozo 4 · OB-1306-98');
  });

  it('no repite la sub-empresa cuando se llama igual que la empresa', () => {
    expect(etiquetaSitio(fila({ sub_empresa_nombre: 'CCU', obra_dga: null }))).toBe('CCU · Pozo 4');
  });

  it('cae al id del sitio cuando no hay descripción', () => {
    expect(
      etiquetaSitio(
        fila({ sitio_desc: null, empresa_nombre: null, sub_empresa_nombre: null, obra_dga: null }),
      ),
    ).toBe('S140');
  });
});

describe('filasParaSuscriptor', () => {
  const ahora = new Date('2026-09-21T12:00:00.000Z');

  it('separa lo que está fallando de lo que espera acuse', () => {
    const abiertas = [fila({ id: 1 }), fila({ id: 2, normalizada_at: '2026-09-20T10:00:00.000Z' })];
    const { enFalla, pendientesAcuse } = filasParaSuscriptor(
      { tipo: 'SuperAdmin' },
      abiertas,
      ahora,
    );
    expect(enFalla.map((r) => r.eventoId)).toEqual([1]);
    expect(pendientesAcuse.map((r) => r.eventoId)).toEqual([2]);
  });

  it('no le muestra a una sub-empresa los sitios de otra', () => {
    const abiertas = [
      fila({ id: 1, sub_empresa_id: 'SE1' }),
      fila({ id: 2, sub_empresa_id: 'SE2' }),
    ];
    const { enFalla } = filasParaSuscriptor(
      { tipo: 'Cliente', empresa_id: 'E100', sub_empresa_id: 'SE2' },
      abiertas,
      ahora,
    );
    expect(enFalla.map((r) => r.eventoId)).toEqual([2]);
  });

  it('no cruza empresas', () => {
    const abiertas = [fila({ id: 1, empresa_id: 'E100' }), fila({ id: 2, empresa_id: 'E200' })];
    const { enFalla } = filasParaSuscriptor(
      { tipo: 'Admin', empresa_id: 'E200', sub_empresa_id: null },
      abiertas,
      ahora,
    );
    expect(enFalla.map((r) => r.eventoId)).toEqual([2]);
  });

  it('un usuario sin sub-empresa ve toda su empresa', () => {
    const abiertas = [
      fila({ id: 1, sub_empresa_id: 'SE1' }),
      fila({ id: 2, sub_empresa_id: 'SE2' }),
    ];
    const { enFalla } = filasParaSuscriptor(
      { tipo: 'Gerente', empresa_id: 'E100', sub_empresa_id: null },
      abiertas,
      ahora,
    );
    expect(enFalla).toHaveLength(2);
  });

  it('un tipo desconocido no ve nada', () => {
    const { enFalla, pendientesAcuse } = filasParaSuscriptor(
      { tipo: 'Inventado', empresa_id: 'E100', sub_empresa_id: null },
      [fila()],
      ahora,
    );
    expect(enFalla).toEqual([]);
    expect(pendientesAcuse).toEqual([]);
  });

  it('ordena por severidad y, a igual severidad, la más antigua arriba', () => {
    const abiertas = [
      fila({ id: 1, severidad: 'media', triggered_at: '2026-09-20T12:00:00.000Z' }),
      fila({ id: 2, severidad: 'critica', triggered_at: '2026-09-20T12:00:00.000Z' }),
      fila({ id: 3, severidad: 'media', triggered_at: '2026-09-01T12:00:00.000Z' }),
    ];
    const { enFalla } = filasParaSuscriptor({ tipo: 'SuperAdmin' }, abiertas, ahora);
    expect(enFalla.map((r) => r.eventoId)).toEqual([2, 3, 1]);
  });

  it('cuenta los días abiertos y arma el link al sitio', () => {
    const { enFalla } = filasParaSuscriptor({ tipo: 'SuperAdmin' }, [fila()], ahora);
    expect(enFalla[0]!.dias).toBe(3);
    expect(enFalla[0]!.url).toContain('S140');
    expect(enFalla[0]!.url).toContain('tab=alertas');
  });

  it('usa el alcance ACTUAL del sitio, no la copia que guardó el evento', () => {
    // El repo trae empresa_id/sub_empresa_id desde `sitio`; si el sitio se
    // movió de división, la copia vieja del evento no puede mandar.
    const movido = fila({ id: 9, sub_empresa_id: 'SE2' });
    const { enFalla } = filasParaSuscriptor(
      { tipo: 'Cliente', empresa_id: 'E100', sub_empresa_id: 'SE1' },
      [movido],
      ahora,
    );
    expect(enFalla).toEqual([]);
  });
});
