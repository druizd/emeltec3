/**
 * Consolidado de alertas: un correo por destinatario a las 08:00 y 18:00, en
 * vez de un correo por evento cada `cooldown_minutos`.
 *
 * Lo que se prueba acá es lo que el usuario nota: a qué hora sale, que no se
 * repite, que lo abierto vuelve una vez al día y que cada destinatario recibe
 * un solo correo con todo lo suyo.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../../config/appConfig', () => ({
  config: {
    alertas: { digest: { enabled: true, hours: [8, 18], inmediato: ['critica'], repeatHours: 20 } },
  },
}));
vi.mock('../../../config/dbHelpers', () => ({ query: vi.fn(), getClient: vi.fn() }));

// El envío se INYECTA: emailService es CommonJS y lo carga `require()`, que no
// pasa por el loader de vitest, así que `vi.mock` no lo intercepta.
const sendAlertDigestEmail = vi.fn().mockResolvedValue(undefined);

import { query } from '../../../config/dbHelpers';
import {
  armarBandejas,
  correoDeBandeja,
  enviarConsolidado,
  etiquetaSlot,
  instanteDeParedChile,
  MAX_FILAS_POR_SECCION,
  procesarDigestPendiente,
  slotsCumplidos,
  type EventoDigest,
} from '../digest';

function evento(over: Partial<EventoDigest> = {}): EventoDigest {
  return {
    id: '1',
    alerta_id: 'A1',
    alerta_nombre: 'Caudal alto',
    condicion: 'sobre_derecho_dga',
    creado_por: 'SA001',
    notificar_user_ids: null,
    notificar_superadmins: true,
    sitio_id: 'S127',
    sitio_desc: 'Pozo 2',
    tipo_sitio: 'pozo',
    empresa_nombre: 'Agrosuper',
    sub_empresa_nombre: 'San Vicente',
    obra_dga: 'OB-1301-937',
    variable_key: 'REG3003',
    valor_texto: '53.31',
    mensaje: '[ALTA] Pozo 2. Caudal 53.31 L/s sobre el derecho.',
    severidad: 'alta',
    triggered_at: '2026-09-14T10:00:00Z',
    repeticiones: 0,
    reconocida_at: null,
    resuelta: false,
    ...over,
  };
}

const usuario = (email: string, id = 'U1') => ({
  id,
  email,
  nombre: 'Denisse',
  apellido: 'Ruiz',
});

beforeEach(() => {
  sendAlertDigestEmail.mockClear();
});

describe('horario del consolidado', () => {
  it('las 08:00 de pared chilena son las 12:00 UTC en invierno', () => {
    // Julio: sin horario de verano, Chile está en UTC-4.
    expect(instanteDeParedChile(2026, 7, 15, 8).toISOString()).toBe('2026-07-15T12:00:00.000Z');
  });

  it('y las 11:00 UTC en verano: el correo sigue llegando a las 08:00 de reloj', () => {
    // Enero: horario de verano, UTC-3. Con el `Etc/GMT+4` fijo de la plataforma
    // este correo llegaría a las 09:00 de pared.
    expect(instanteDeParedChile(2026, 1, 15, 8).toISOString()).toBe('2026-01-15T11:00:00.000Z');
  });

  it('a las 08:05 el slot de las 08:00 está cumplido y el de las 18:00 no', () => {
    const now = new Date('2026-09-14T12:05:00Z'); // 08:05 en Chile
    const slots = slotsCumplidos(now, [8, 18]);
    expect(slots.map((s) => etiquetaSlot(s))).toEqual(['14/09/2026 08:00']);
  });

  it('a las 02:00 de la madrugada el slot de las 18:00 de ayer ya venció y no se rescata', () => {
    // Ocho horas después: fuera de la ventana de rescate, el consolidado
    // atrasado ya no le sirve a nadie.
    const now = new Date('2026-09-15T06:00:00Z'); // 02:00 en Chile
    expect(slotsCumplidos(now, [8, 18])).toEqual([]);
  });

  it('un reinicio a los 40 minutos todavía alcanza a mandar el slot', () => {
    const now = new Date('2026-09-14T12:40:00Z'); // 08:40 en Chile
    expect(slotsCumplidos(now, [8, 18]).map((s) => etiquetaSlot(s))).toEqual(['14/09/2026 08:00']);
  });
});

describe('reparto por destinatario', () => {
  it('un solo correo por persona, con todos sus eventos', async () => {
    const resolver = vi.fn().mockResolvedValue([usuario('druiz@emeltec.cl')]);
    const bandejas = await armarBandejas(
      [evento({ id: '1' }), evento({ id: '2', sitio_desc: 'Pozo 3' })],
      [evento({ id: '3' })],
      resolver,
    );

    expect(bandejas.size).toBe(1);
    const bandeja = bandejas.get('druiz@emeltec.cl')!;
    expect(bandeja.nuevas).toHaveLength(2);
    expect(bandeja.reaviso).toHaveLength(1);
  });

  it('los destinatarios se resuelven una vez por regla, no por evento', async () => {
    const resolver = vi.fn().mockResolvedValue([usuario('druiz@emeltec.cl')]);
    await armarBandejas(
      [evento({ id: '1' }), evento({ id: '2' }), evento({ id: '3' })],
      [],
      resolver,
    );
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it('reglas distintas con destinatarios distintos no se mezclan', async () => {
    const resolver = vi.fn(async (ev: EventoDigest) =>
      ev.alerta_id === 'A1' ? [usuario('druiz@emeltec.cl')] : [usuario('nlira@emeltec.cl', 'U2')],
    );
    const bandejas = await armarBandejas(
      [evento({ id: '1', alerta_id: 'A1' }), evento({ id: '2', alerta_id: 'A2' })],
      [],
      resolver,
    );
    expect([...bandejas.keys()].sort()).toEqual(['druiz@emeltec.cl', 'nlira@emeltec.cl']);
    expect(bandejas.get('druiz@emeltec.cl')!.nuevas).toHaveLength(1);
  });

  it('una regla sin destinatarios no rompe el consolidado del resto', async () => {
    const resolver = vi.fn(async (ev: EventoDigest) =>
      ev.alerta_id === 'A1' ? [usuario('druiz@emeltec.cl')] : [],
    );
    const bandejas = await armarBandejas(
      [evento({ id: '1', alerta_id: 'A1' }), evento({ id: '2', alerta_id: 'A2' })],
      [],
      resolver,
    );
    expect(bandejas.size).toBe(1);
  });
});

describe('armado del correo', () => {
  const bandejaDe = (nuevas: EventoDigest[]) => ({
    usuario: usuario('druiz@emeltec.cl'),
    nuevas,
    reaviso: [],
  });

  it('lo más grave va primero', () => {
    const correo = correoDeBandeja(
      bandejaDe([
        evento({ id: '1', severidad: 'baja' }),
        evento({ id: '2', severidad: 'critica' }),
        evento({ id: '3', severidad: 'media' }),
      ]),
      '14/09/2026 08:00',
    );
    expect(correo.nuevas.map((f) => f.severidad)).toEqual(['critica', 'media', 'baja']);
  });

  it('agrupa por tipo de alerta: un bloque por condición, no una lista plana', () => {
    const correo = correoDeBandeja(
      bandejaDe([
        evento({ id: '1', condicion: 'sin_datos', sitio_id: 'S127', severidad: 'alta' }),
        evento({ id: '2', condicion: 'sobre_derecho_dga', sitio_id: 'S128', severidad: 'alta' }),
        evento({ id: '3', condicion: 'sin_datos', sitio_id: 'S129', severidad: 'alta' }),
        evento({ id: '4', condicion: 'sin_datos', sitio_id: 'S130', severidad: 'alta' }),
      ]),
      '16/09/2026 08:00',
    );
    // Las tres desconexiones juntas y primero, por ser el grupo más grande.
    expect(correo.nuevas.map((f) => f.tipo)).toEqual([
      'Sin comunicación del equipo',
      'Sin comunicación del equipo',
      'Sin comunicación del equipo',
      'Caudal sobre el derecho DGA',
    ]);
  });

  it('entre grupos manda la severidad, no el tamaño', () => {
    const correo = correoDeBandeja(
      bandejaDe([
        evento({ id: '1', condicion: 'sin_datos', severidad: 'media' }),
        evento({ id: '2', condicion: 'sin_datos', severidad: 'media' }),
        evento({ id: '3', condicion: 'dga_slots_fallidos', severidad: 'critica' }),
      ]),
      '16/09/2026 08:00',
    );
    expect(correo.nuevas[0]!.tipo).toBe('Slots DGA fallidos');
  });

  it('una condición sin nombre conocido se agrupa por el nombre de la regla', () => {
    const correo = correoDeBandeja(
      bandejaDe([evento({ condicion: 'condicion_nueva', alerta_nombre: 'Presión de línea' })]),
      '16/09/2026 08:00',
    );
    expect(correo.nuevas[0]!.tipo).toBe('Presión de línea');
  });

  it('el backlog no genera un correo de cientos de filas: se corta y se cuenta', () => {
    const muchos = Array.from({ length: MAX_FILAS_POR_SECCION + 12 }, (_, i) =>
      evento({ id: String(i) }),
    );
    const correo = correoDeBandeja(bandejaDe(muchos), '14/09/2026 08:00');
    expect(correo.nuevas).toHaveLength(MAX_FILAS_POR_SECCION);
    expect(correo.omitidasNuevas).toBe(12);
  });

  it('una alerta que se normalizó sola antes del correo se informa como cerrada', () => {
    const correo = correoDeBandeja(bandejaDe([evento({ resuelta: true })]), '14/09/2026 08:00');
    expect(correo.nuevas[0]!.normalizada).toBe(true);
  });

  it('la fila lleva el sitio como lo reconoce el operador', () => {
    const correo = correoDeBandeja(bandejaDe([evento()]), '14/09/2026 08:00');
    expect(correo.nuevas[0]!.sitio).toBe('Agrosuper · San Vicente · Pozo 2 · OB-1301-937');
  });
});

/** Cliente de base falso: responde según el SQL que recibe. */
function makeClient(opts: {
  nuevas?: EventoDigest[];
  reaviso?: EventoDigest[];
  slotLibre?: boolean;
}) {
  const ejecutadas: { sql: string; params: unknown[] }[] = [];
  const client = {
    ejecutadas,
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      ejecutadas.push({ sql, params });
      if (sql.includes('INSERT INTO alertas_digest_envios')) {
        return { rows: opts.slotLibre === false ? [] : [{ slot_ts: 'x' }] };
      }
      if (sql.includes('FROM alertas_eventos ev')) {
        return {
          rows: sql.includes('notificado = FALSE') ? (opts.nuevas ?? []) : (opts.reaviso ?? []),
        };
      }
      return { rows: [] };
    }),
  };
  return client;
}

const sqlsDe = (c: ReturnType<typeof makeClient>) => c.ejecutadas.map((e) => e.sql);

describe('envío del consolidado', () => {
  it('con la cola vacía no manda nada', async () => {
    const c = makeClient({ nuevas: [], reaviso: [] });
    const res = await enviarConsolidado(c, new Date('2026-09-14T12:00:00Z'), sendAlertDigestEmail);
    expect(sendAlertDigestEmail).not.toHaveBeenCalled();
    expect(res).toEqual({ nuevas: 0, reaviso: 0, destinatarios: 0 });
  });

  it('saca los eventos de la cola: no vuelven a salir en el siguiente consolidado', async () => {
    const c = makeClient({ nuevas: [evento({ id: '7' })] });
    await enviarConsolidado(c, new Date('2026-09-14T12:00:00Z'), sendAlertDigestEmail);

    const marca = c.ejecutadas.find((e) =>
      e.sql.includes('notificado = TRUE, notificado_at = NOW()'),
    );
    expect(marca).toBeDefined();
    expect(marca!.params[0]).toEqual([7]);
  });

  it('el re-aviso solo corre la marca de tiempo: el evento sigue abierto', async () => {
    const c = makeClient({ nuevas: [], reaviso: [evento({ id: '9' })] });
    await enviarConsolidado(c, new Date('2026-09-14T12:00:00Z'), sendAlertDigestEmail);

    expect(sqlsDe(c).some((s) => s.includes('SET notificado_at = NOW()'))).toBe(true);
    expect(sqlsDe(c).some((s) => s.includes('notificado = TRUE, notificado_at = NOW()'))).toBe(
      false,
    );
  });

  it('el re-aviso pide los abiertos sin correo hace más de las horas configuradas', async () => {
    const c = makeClient({ nuevas: [], reaviso: [] });
    await enviarConsolidado(c, new Date('2026-09-14T12:00:00Z'), sendAlertDigestEmail);
    const q = c.ejecutadas.find((e) => e.sql.includes('resuelta = FALSE'));
    expect(q!.params[0]).toBe('20');
  });
});

describe('idempotencia', () => {
  beforeEach(() => {
    // Acá no se inyecta el resolver: se ejercita el camino real, que resuelve
    // destinatarios contra la tabla `usuario` vía dbHelpers.
    vi.mocked(query).mockResolvedValue({ rows: [usuario('druiz@emeltec.cl')] } as never);
  });

  it('si otro ciclo ya tomó el slot, este no manda nada', async () => {
    const c = makeClient({ nuevas: [evento()], slotLibre: false });
    await procesarDigestPendiente(c, new Date('2026-09-14T12:05:00Z'), sendAlertDigestEmail);
    expect(sendAlertDigestEmail).not.toHaveBeenCalled();
  });

  it('con el slot libre manda una vez', async () => {
    const c = makeClient({ nuevas: [evento()] });
    await procesarDigestPendiente(c, new Date('2026-09-14T12:05:00Z'), sendAlertDigestEmail);
    expect(sendAlertDigestEmail).toHaveBeenCalledTimes(1);
  });

  it('fuera de hora no manda nada', async () => {
    const c = makeClient({ nuevas: [evento()] });
    await procesarDigestPendiente(c, new Date('2026-09-14T17:00:00Z'), sendAlertDigestEmail); // 13:00 en Chile
    expect(sendAlertDigestEmail).not.toHaveBeenCalled();
  });
});
