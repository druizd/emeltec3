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
      .mockResolvedValueOnce({ rows: [{ email: 'sa@emeltec.cl' }], rowCount: 1 }) // SELECT superadmins
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
      .mockResolvedValueOnce({ rows: [{ email: 'sa@emeltec.cl' }], rowCount: 1 }) // SELECT superadmins
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

  it('4. Busca action con patrón de patch de usuario que modifica tipo', async () => {
    const dbQ = vi.fn().mockResolvedValue({ rows: [] });

    await detectarCambiosRol(dbQ);

    const selectCall = dbQ.mock.calls.find(
      (call: unknown[]) =>
        String(call[0]).includes('audit_log') &&
        (String(call[0]).includes('user.') || String(call[0]).includes('patch')),
    );
    expect(selectCall).toBeDefined();
    const [sql] = selectCall! as [string];
    expect(sql).toContain('audit_log');
  });

  it('5. Si detecta cambio de rol, llama sendAlertaSeguridad con tipo cambio_rol', async () => {
    const cambiosDetectados = [
      {
        actor_id: 'ADM01',
        actor_email: 'admin@empresa.cl',
        target_id: 'USR01',
        ts: new Date().toISOString(),
      },
    ];
    const dbQ = vi
      .fn()
      .mockResolvedValueOnce({ rows: cambiosDetectados, rowCount: 1 }) // SELECT cambios
      .mockResolvedValueOnce({ rows: [{ email: 'superadmin@emeltec.cl' }], rowCount: 1 }) // SELECT superadmins
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // SELECT cooldown
      .mockResolvedValue({ rows: [], rowCount: 0 }); // UPSERT cooldown

    const sendAlerta = vi.fn().mockResolvedValue(undefined);

    await detectarCambiosRol(dbQ, sendAlerta);

    expect(sendAlerta).toHaveBeenCalled();
    expect(sendAlerta).toHaveBeenCalledWith(expect.any(String), 'cambio_rol', expect.any(Object));
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
