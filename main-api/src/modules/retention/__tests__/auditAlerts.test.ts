import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../config/appConfig', () => ({
  config: {
    auditAlerts: {
      loginWindowMinutes: 15,
      loginThreshold: 5,
      cooldownMinutes: 60,
    },
  },
}));

vi.mock('../../../config/dbHelpers', () => ({
  query: vi.fn(),
}));

vi.mock('../../../config/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../services/emailService.js', () => ({
  sendAlertaSeguridad: vi.fn().mockResolvedValue(undefined),
}));

import {
  detectarLoginsFallidos,
  detectarCambiosRol,
  detectarExportacionesMasivas,
} from '../auditAlerts';

import { query } from '../../../config/dbHelpers';
import { sendAlertaSeguridad } from '../../../services/emailService.js';

const mockQuery = vi.mocked(query);
const mockSendAlerta = vi.mocked(sendAlertaSeguridad);

describe('auditAlerts — detectarLoginsFallidos()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. Busca en audit_log las acciones REALES del productor (auth-api: login.failure / login.locked) en ventana de 15 min agrupado por actor', async () => {
    const dbQ = vi.fn().mockResolvedValue({ rows: [] });

    await detectarLoginsFallidos(dbQ);

    // Contrato productor→consumidor: auth-api/src/controllers/authController.js
    // escribe 'login.failure' y 'login.locked'. El detector DEBE consultar esos
    // strings exactos — 'user.login.failed' no lo escribe nadie (bug de la
    // auditoría fiscalizadora 17-07-2026: las alertas nunca disparaban).
    const selectCall = dbQ.mock.calls.find(
      (call: unknown[]) =>
        String(call[0]).includes('audit_log') && String(call[0]).includes('login.failure'),
    );
    expect(selectCall).toBeDefined();
    const [sql] = selectCall! as [string];
    expect(sql).toContain('login.locked');
    expect(sql).not.toContain('user.login.failed');
    expect(sql).toContain('15');
    expect(sql).toContain('GROUP BY');
  });

  it('2. Si hay >= 5 intentos, llama sendAlertaSeguridad con tipo logins_fallidos', async () => {
    const actoresConAlertas = [{ actor_id: 'U001', actor_email: 'malo@empresa.cl', intentos: '7' }];
    const dbQ = vi
      .fn()
      .mockResolvedValueOnce({ rows: actoresConAlertas, rowCount: 1 }) // SELECT logins fallidos
      .mockResolvedValueOnce({ rows: [{ email: 'sa@emeltec.cl' }], rowCount: 1 }) // SELECT destinatarios de seguridad
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // SELECT cooldown
      .mockResolvedValue({ rows: [], rowCount: 0 }); // UPSERT cooldown

    const sendAlerta = vi.fn().mockResolvedValue(undefined);

    await detectarLoginsFallidos(dbQ, sendAlerta);

    expect(sendAlerta).toHaveBeenCalled();
    expect(sendAlerta).toHaveBeenCalledWith(
      expect.any(String),
      'logins_fallidos',
      expect.objectContaining({ actor_id: 'U001' }),
    );
  });

  it('3. Respeta cooldown: no repite alerta si ya se envió en los últimos 60 min', async () => {
    const actoresConAlertas = [{ actor_id: 'U001', actor_email: 'malo@empresa.cl', intentos: '8' }];
    const cooldownActivo = [{ alert_key: 'logins_fallidos:U001', last_sent_at: new Date() }];
    const dbQ = vi
      .fn()
      .mockResolvedValueOnce({ rows: actoresConAlertas, rowCount: 1 }) // SELECT logins fallidos
      .mockResolvedValueOnce({ rows: [{ email: 'sa@emeltec.cl' }], rowCount: 1 }) // SELECT destinatarios de seguridad
      .mockResolvedValueOnce({ rows: cooldownActivo, rowCount: 1 }); // SELECT cooldown → activo

    const sendAlerta = vi.fn().mockResolvedValue(undefined);

    await detectarLoginsFallidos(dbQ, sendAlerta);

    // No debe enviar alerta si hay cooldown activo
    expect(sendAlerta).not.toHaveBeenCalled();
  });
});

describe('auditAlerts — detectarCambiosRol()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('4. Consulta la acción REAL del productor (usuario.update, en español) y no la inexistente user.*', async () => {
    const dbQ = vi.fn().mockResolvedValue({ rows: [] });

    await detectarCambiosRol(dbQ);

    // Contrato productor→consumidor: services/auditResolver.js emite las
    // acciones en español ('usuario.update'). 'user.patch' / 'user.update' no
    // los escribe nadie — mismo bug que tuvo detectarLoginsFallidos con
    // 'user.login.failed': el detector nunca encontró un cambio de rol.
    const selectCall = dbQ.mock.calls.find((call: unknown[]) =>
      String(call[0]).includes('audit_log'),
    );
    expect(selectCall).toBeDefined();
    const [sql] = selectCall! as [string];
    expect(sql).toContain("'usuario.update'");
    expect(sql).not.toContain("'user.update'");
    expect(sql).not.toContain("'user.patch'");
  });

  it('4b. Acota la ventana a 24h y exige que el cambio haya tocado el campo tipo', async () => {
    const dbQ = vi.fn().mockResolvedValue({ rows: [] });

    await detectarCambiosRol(dbQ);

    const [sql] = dbQ.mock.calls.find((call: unknown[]) =>
      String(call[0]).includes('audit_log'),
    )! as [string];
    // El comentario prometía "últimas 24h" pero el SQL no filtraba por ts.
    expect(sql).toContain('24 hours');
    // Sin este filtro, cualquier edición de usuario se reportaba como cambio de rol.
    expect(sql).toContain('tipo');
    // Un intento rechazado no es un cambio de rol.
    expect(sql).toContain('status_code');
  });

  it('5. Si detecta cambio de rol, llama sendAlertaSeguridad con tipo cambio_rol', async () => {
    const cambiosDetectados = [
      {
        actor_id: 'ADM01',
        actor_email: 'admin@empresa.cl',
        target_id: 'USR01',
        ts: new Date().toISOString(),
        cambio_tipo: { antes: 'Operador', despues: 'Admin' },
      },
    ];
    const dbQ = vi
      .fn()
      .mockResolvedValueOnce({ rows: cambiosDetectados, rowCount: 1 }) // SELECT cambios
      .mockResolvedValueOnce({ rows: [{ email: 'superadmin@emeltec.cl' }], rowCount: 1 }) // SELECT destinatarios de seguridad
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // SELECT cooldown
      .mockResolvedValue({ rows: [], rowCount: 0 }); // UPSERT cooldown

    const sendAlerta = vi.fn().mockResolvedValue(undefined);

    await detectarCambiosRol(dbQ, sendAlerta);

    expect(sendAlerta).toHaveBeenCalled();
    expect(sendAlerta).toHaveBeenCalledWith(expect.any(String), 'cambio_rol', expect.any(Object));
  });

  it('5b. La alerta informa de qué rol a qué rol fue el cambio', async () => {
    const dbQ = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            actor_id: 'ADM01',
            actor_email: 'admin@empresa.cl',
            target_id: 'USR01',
            ts: new Date().toISOString(),
            cambio_tipo: { antes: 'Operador', despues: 'SuperAdmin' },
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ email: 'superadmin@emeltec.cl' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValue({ rows: [], rowCount: 0 });

    const sendAlerta = vi.fn().mockResolvedValue(undefined);

    await detectarCambiosRol(dbQ, sendAlerta);

    expect(sendAlerta).toHaveBeenCalledWith(
      expect.any(String),
      'cambio_rol',
      expect.objectContaining({ rol_anterior: 'Operador', rol_nuevo: 'SuperAdmin' }),
    );
  });

  it('5c. Tolera registros sin el detalle del cambio (bitácora previa al diff)', async () => {
    const dbQ = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            actor_id: 'ADM01',
            actor_email: 'admin@empresa.cl',
            target_id: 'USR01',
            ts: new Date().toISOString(),
            cambio_tipo: null,
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ email: 'superadmin@emeltec.cl' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValue({ rows: [], rowCount: 0 });

    const sendAlerta = vi.fn().mockResolvedValue(undefined);

    await detectarCambiosRol(dbQ, sendAlerta);

    expect(sendAlerta).toHaveBeenCalledWith(
      expect.any(String),
      'cambio_rol',
      expect.objectContaining({ rol_anterior: '—', rol_nuevo: '—' }),
    );
  });

  it('5d. Resuelve los IDs contra usuario para nombrar al actor y al afectado', async () => {
    const dbQ = vi.fn().mockResolvedValue({ rows: [] });

    await detectarCambiosRol(dbQ);

    const [sql] = dbQ.mock.calls.find((call: unknown[]) =>
      String(call[0]).includes('audit_log'),
    )! as [string];
    // Sin el join la alerta solo podía nombrar IDs (U22046E) y obligaba a
    // consultar la base de datos para saber a quién le cambiaron el rol.
    expect(sql).toContain('LEFT JOIN usuario');
    expect(sql).toContain('target_email');
    // LEFT y no INNER: si la cuenta fue eliminada, el cambio igual debe alertar.
    expect(sql).not.toContain('INNER JOIN usuario');
  });

  it('5e. La alerta nombra a las personas, no solo sus identificadores', async () => {
    const dbQ = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            actor_id: 'SA001',
            actor_email: 'druiz@emeltec.cl',
            actor_nombre: 'Daniel Ruiz',
            target_id: 'U22046E',
            target_nombre: 'Marcela Soto',
            target_email: 'msoto@cliente.cl',
            target_tipo_actual: 'Admin',
            ip: '190.44.12.7',
            ts: '2026-08-18T04:52:48.000Z',
            cambio_tipo: { antes: 'Gerente', despues: 'Admin' },
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ email: 'superadmin@emeltec.cl' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValue({ rows: [], rowCount: 0 });

    const sendAlerta = vi.fn().mockResolvedValue(undefined);

    await detectarCambiosRol(dbQ, sendAlerta);

    expect(sendAlerta).toHaveBeenCalledWith(
      expect.any(String),
      'cambio_rol',
      expect.objectContaining({
        actor_nombre: 'Daniel Ruiz',
        actor_email: 'druiz@emeltec.cl',
        actor_id: 'SA001',
        actor_ip: '190.44.12.7',
        target_nombre: 'Marcela Soto',
        target_email: 'msoto@cliente.cl',
        target_id: 'U22046E',
        rol_actual: 'Admin',
      }),
    );
  });

  it('5f. La fecha va en formato DD/MM/YYYY HH:MM y en hora de Chile', async () => {
    const dbQ = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            actor_id: 'SA001',
            actor_email: 'druiz@emeltec.cl',
            actor_nombre: 'Daniel Ruiz',
            target_id: 'U22046E',
            target_nombre: 'Marcela Soto',
            target_email: 'msoto@cliente.cl',
            target_tipo_actual: 'Admin',
            ip: null,
            // 04:52 UTC en agosto = 00:52 en Chile (UTC-4, horario de invierno).
            ts: '2026-08-18T04:52:48.000Z',
            cambio_tipo: { antes: 'Gerente', despues: 'Admin' },
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ email: 'superadmin@emeltec.cl' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValue({ rows: [], rowCount: 0 });

    const sendAlerta = vi.fn().mockResolvedValue(undefined);

    await detectarCambiosRol(dbQ, sendAlerta);

    // Antes se mandaba el timestamp crudo, que el mail renderizaba como
    // "Tue Aug 18 2026 04:52:48 GMT+0000": en inglés y en UTC.
    expect(sendAlerta).toHaveBeenCalledWith(
      expect.any(String),
      'cambio_rol',
      expect.objectContaining({ fecha: '18/08/2026 00:52' }),
    );
  });

  it('5g. Sin nombre resuelto (cuenta eliminada) cae al email de la bitácora', async () => {
    const dbQ = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            actor_id: 'SA001',
            actor_email: 'druiz@emeltec.cl',
            actor_nombre: null,
            target_id: 'U22046E',
            target_nombre: null,
            target_email: null,
            target_tipo_actual: null,
            ip: null,
            ts: '2026-08-18T04:52:48.000Z',
            cambio_tipo: { antes: 'Gerente', despues: 'Admin' },
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ email: 'superadmin@emeltec.cl' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValue({ rows: [], rowCount: 0 });

    const sendAlerta = vi.fn().mockResolvedValue(undefined);

    await detectarCambiosRol(dbQ, sendAlerta);

    // actor_email está denormalizado en audit_log justamente para sobrevivir
    // al DELETE del usuario; el afectado sí queda en '—'.
    expect(sendAlerta).toHaveBeenCalledWith(
      expect.any(String),
      'cambio_rol',
      expect.objectContaining({
        actor_nombre: 'druiz@emeltec.cl',
        target_nombre: '—',
        target_email: '—',
      }),
    );
  });
});

/**
 * Marca de agua (incidente 18-08-2026).
 *
 * El cooldown de 60 min solo limita la frecuencia. Con una ventana de detección
 * de 24 horas, el MISMO cambio de rol seguía calificando ciclo tras ciclo: un
 * único cambio a las 04:52 UTC mandó 14 correos por hora — uno por SuperAdmin
 * activo — durante toda la mañana. La marca de agua recuerda hasta qué `ts` se
 * alertó, y la detección solo mira lo posterior.
 */
describe('auditAlerts — marca de agua de cambio_rol', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const CAMBIO = {
    actor_id: 'SA001',
    actor_email: 'druiz@emeltec.cl',
    actor_nombre: 'Daniel Ruiz',
    target_id: 'U22046E',
    target_nombre: 'Marcela Soto',
    target_email: 'msoto@cliente.cl',
    target_tipo_actual: 'Admin',
    ip: null,
    ts: '2026-08-18T04:52:48.000Z',
    cambio_tipo: { antes: 'Gerente', despues: 'Admin' },
  };

  /** Secuencia del flujo completo: SELECT cambios → superadmins → cooldown → UPSERT. */
  function dbQConAlerta() {
    return vi
      .fn()
      .mockResolvedValueOnce({ rows: [CAMBIO], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ email: 'superadmin@emeltec.cl' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValue({ rows: [], rowCount: 0 });
  }

  const upsertDe = (dbQ: ReturnType<typeof vi.fn>) =>
    dbQ.mock.calls.find((call: unknown[]) =>
      String(call[0]).includes('INSERT INTO audit_alert_cooldown'),
    ) as [string, unknown[]] | undefined;

  it('7. La detección arranca en la marca de agua de la clave, con la ventana de 24h como piso', async () => {
    const dbQ = vi.fn().mockResolvedValue({ rows: [] });

    await detectarCambiosRol(dbQ);

    const call = dbQ.mock.calls.find((c: unknown[]) => String(c[0]).includes('audit_log'))! as [
      string,
      unknown[],
    ];
    const [sql, params] = call;
    // El filtro por marca viaja en la misma consulta (no agrega round-trip).
    expect(sql).toContain('watermark_ts');
    expect(sql).toContain('GREATEST');
    // El piso se mantiene: una marca vieja no revive historia antigua.
    expect(sql).toContain('24 hours');
    expect(params).toEqual(['cambio_rol:lote']);
  });

  it('8. Al alertar, la marca queda en el ts del cambio más nuevo notificado — no en NOW()', async () => {
    const dbQ = dbQConAlerta();

    await detectarCambiosRol(dbQ, vi.fn().mockResolvedValue(undefined));

    const upsert = upsertDe(dbQ);
    expect(upsert).toBeDefined();
    // rows viene ORDER BY ts DESC: rows[0].ts es el cambio más nuevo del correo.
    // Guardar NOW() en su lugar se comería los cambios que entren durante el envío.
    expect(upsert![1]).toEqual(['cambio_rol:lote', '2026-08-18T04:52:48.000Z']);
  });

  it('9. La marca nunca retrocede: el UPSERT la avanza con GREATEST', async () => {
    const dbQ = dbQConAlerta();

    await detectarCambiosRol(dbQ, vi.fn().mockResolvedValue(undefined));

    const [sql] = upsertDe(dbQ)!;
    expect(sql).toContain('GREATEST(EXCLUDED.watermark_ts, audit_alert_cooldown.watermark_ts)');
  });

  it('11. logins_fallidos registra sin marca: su ventana de 15 min ya es más corta que el cooldown', async () => {
    const dbQ = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ actor_id: 'U001', actor_email: 'malo@empresa.cl', intentos: '7' }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ email: 'sa@emeltec.cl' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValue({ rows: [], rowCount: 0 });

    await detectarLoginsFallidos(dbQ, vi.fn().mockResolvedValue(undefined));

    // null y no un ts: GREATEST ignora los NULL en Postgres, así que este envío
    // no pisa ninguna marca existente.
    expect(upsertDe(dbQ)![1]).toEqual(['logins_fallidos:malo@empresa.cl', null]);
  });
});

/**
 * Destinatarios configurables (18/08/2026 → 20/08/2026).
 *
 * Antes iba a `WHERE tipo = 'SuperAdmin'`, hardcodeado: con 14 SuperAdmin
 * activos, cada alerta salía 14 veces y no había forma de elegir a quién sin
 * cambiarle el rol a alguien. Ahora la lista se administra en
 * /administration → "Alertas por correo" (health_digest_destinatario).
 *
 * Sin buzón de respaldo, por decisión explícita: lista vacía = no se envía. Lo
 * importante es que además NO se registre el cooldown, para que la alerta siga
 * pendiente y le llegue al primero que se suscriba.
 */
describe('auditAlerts — destinatarios de las alertas de seguridad', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const CAMBIO = {
    actor_id: 'SA001',
    actor_email: 'druiz@emeltec.cl',
    actor_nombre: 'Daniel Ruiz',
    target_id: 'U22046E',
    target_nombre: 'Marcela Soto',
    target_email: 'msoto@cliente.cl',
    target_tipo_actual: 'Admin',
    ip: null,
    ts: '2026-08-20T04:52:48.000Z',
    cambio_tipo: { antes: 'Gerente', despues: 'Admin' },
  };

  const RAFAGA = { actor_id: 'U001', actor_email: 'malo@empresa.cl', intentos: '7' };

  const registroCooldown = (dbQ: ReturnType<typeof vi.fn>) =>
    dbQ.mock.calls.some((c: unknown[]) =>
      String(c[0]).includes('INSERT INTO audit_alert_cooldown'),
    );

  it('12. Lee la lista de health_digest_destinatario y no los SuperAdmin', async () => {
    const dbQ = vi
      .fn()
      .mockResolvedValueOnce({ rows: [CAMBIO], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ email: 'seguridad@emeltec.cl' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValue({ rows: [], rowCount: 0 });

    await detectarCambiosRol(dbQ, vi.fn().mockResolvedValue(undefined));

    const consulta = dbQ.mock.calls.find((c: unknown[]) =>
      String(c[0]).includes('health_digest_destinatario'),
    );
    expect(consulta).toBeDefined();
    const [sql] = consulta! as [string];
    expect(sql).toContain('recibe_seguridad = TRUE');
    expect(sql).toContain('activo = TRUE');
    // La fuente vieja no debe quedar en ninguna consulta.
    const sigueMirandoUsuario = dbQ.mock.calls.some((c: unknown[]) =>
      String(c[0]).includes("tipo = 'SuperAdmin'"),
    );
    expect(sigueMirandoUsuario).toBe(false);
  });

  it('13. Manda un correo por suscrito', async () => {
    const dbQ = vi
      .fn()
      .mockResolvedValueOnce({ rows: [CAMBIO], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ email: 'uno@emeltec.cl' }, { email: 'dos@emeltec.cl' }],
        rowCount: 2,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValue({ rows: [], rowCount: 0 });
    const sendAlerta = vi.fn().mockResolvedValue(undefined);

    await detectarCambiosRol(dbQ, sendAlerta);

    expect(sendAlerta).toHaveBeenCalledTimes(2);
    expect(sendAlerta.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      'uno@emeltec.cl',
      'dos@emeltec.cl',
    ]);
  });

  it('14. cambio_rol sin suscritos: no envía y NO registra cooldown ni marca de agua', async () => {
    const dbQ = vi
      .fn()
      .mockResolvedValueOnce({ rows: [CAMBIO], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // nadie suscrito
      .mockResolvedValue({ rows: [], rowCount: 0 });
    const sendAlerta = vi.fn().mockResolvedValue(undefined);

    await detectarCambiosRol(dbQ, sendAlerta);

    expect(sendAlerta).not.toHaveBeenCalled();
    // Sin esto el cambio quedaría "avisado" sin haber salido, y el primero que
    // se suscriba no se enteraría nunca.
    expect(registroCooldown(dbQ)).toBe(false);
  });

  it('15. logins_fallidos sin suscritos: no envía y NO registra cooldown', async () => {
    const dbQ = vi
      .fn()
      .mockResolvedValueOnce({ rows: [RAFAGA], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // nadie suscrito
      .mockResolvedValue({ rows: [], rowCount: 0 });
    const sendAlerta = vi.fn().mockResolvedValue(undefined);

    await detectarLoginsFallidos(dbQ, sendAlerta);

    expect(sendAlerta).not.toHaveBeenCalled();
    expect(registroCooldown(dbQ)).toBe(false);
  });
});

describe('auditAlerts — detectarExportacionesMasivas()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('6. Brecha documentada: retorna vacío sin errores cuando no hay acciones de export', async () => {
    // No hay acción 'export' en audit_log — esta función documenta la brecha
    // y retorna vacío sin lanzar errores ni llamar a la DB
    const result = await detectarExportacionesMasivas();

    // Debe retornar sin errores
    expect(result).toBeDefined();
    expect(result).toHaveProperty('brecha', true);
    // No debe llamar a la DB (la brecha es conocida, no hay qué buscar)
    expect(mockQuery).not.toHaveBeenCalled();
    // No debe enviar alertas
    expect(mockSendAlerta).not.toHaveBeenCalled();
  });
});
