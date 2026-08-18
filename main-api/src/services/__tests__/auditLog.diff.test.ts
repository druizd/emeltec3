/**
 * Cubre las tres capacidades que se agregaron a la bitácora:
 *   1. antes/después de los campos modificados, con redacción por allowlist;
 *   2. clasificación del desenlace (incluidos los intentos rechazados);
 *   3. distinción de activar/desactivar respecto de una edición normal.
 */
import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const audit = require('../auditLog.js') as {
  computeChanges: (
    before: Record<string, unknown> | null,
    body: Record<string, unknown>,
    targetType: string,
  ) => { changedFields: string[]; changes: Record<string, unknown> };
  snapshotAllowed: (
    row: Record<string, unknown> | null,
    targetType: string,
  ) => Record<string, unknown> | null;
  outcomeForStatus: (status: number) => string;
  sonDistintos: (antes: unknown, despues: unknown) => boolean;
  VALUE_ALLOWLIST: Record<string, string[]>;
  TABLE_BY_TARGET: Record<string, { table: string; pk: string }>;
};

describe('computeChanges', () => {
  it('registra antes/después de los campos auditables de una alerta', () => {
    const before = { umbral_bajo: '300', severidad: 'alta', nombre: 'Consumo fin de semana' };
    const body = { umbral_bajo: 60, severidad: 'alta', nombre: 'Consumo fin de semana' };

    const { changedFields, changes } = audit.computeChanges(before, body, 'alerta');

    // severidad y nombre llegaron iguales: no son cambios.
    expect(changedFields).toEqual(['umbral_bajo']);
    expect(changes.umbral_bajo).toEqual({ antes: '300', despues: 60 });
  });

  it('ignora los campos que el cliente reenvía sin modificar', () => {
    const before = { nombre: 'Regla', cooldown_minutos: 5, dias_activos: ['sabado', 'domingo'] };
    const body = { nombre: 'Regla', cooldown_minutos: 5, dias_activos: ['sabado', 'domingo'] };

    const { changedFields } = audit.computeChanges(before, body, 'alerta');

    expect(changedFields).toEqual([]);
  });

  it('detecta cambios en arrays', () => {
    const before = { dias_activos: ['sabado', 'domingo'] };
    const body = { dias_activos: ['lunes'] };

    const { changes } = audit.computeChanges(before, body, 'alerta');

    expect(changes.dias_activos).toEqual({ antes: ['sabado', 'domingo'], despues: ['lunes'] });
  });

  it('redacta el valor de los campos fuera de la allowlist', () => {
    // `email` y `password` no están en la allowlist de usuario: se registra
    // que cambiaron, nunca su contenido.
    const before = { tipo: 'Operador', email: 'viejo@emeltec.cl' };
    const body = { tipo: 'Admin', email: 'nuevo@emeltec.cl', password: 'secreto123' };

    const { changedFields, changes } = audit.computeChanges(before, body, 'usuario');

    expect(changedFields).toEqual(['tipo', 'email', 'password']);
    expect(changes.tipo).toEqual({ antes: 'Operador', despues: 'Admin' });
    expect(changes.email).toBe('[redactado]');
    expect(changes.password).toBe('[redactado]');
    expect(JSON.stringify(changes)).not.toContain('secreto123');
    expect(JSON.stringify(changes)).not.toContain('nuevo@emeltec.cl');
  });

  it('sin estado previo (create) registra todos los campos del body', () => {
    const body = { nombre: 'Nueva', umbral_bajo: 60 };

    const { changedFields, changes } = audit.computeChanges(null, body, 'alerta');

    expect(changedFields).toEqual(['nombre', 'umbral_bajo']);
    // Sin `before`, no hay "antes" que mostrar.
    expect(changes.nombre).toEqual({ antes: undefined, despues: 'Nueva' });
  });

  it('trata NUMERIC de postgres (string) y number del body como iguales', () => {
    expect(audit.sonDistintos('300', 300)).toBe(false);
    expect(audit.sonDistintos('300', 60)).toBe(true);
  });

  it('distingue null de valor presente', () => {
    expect(audit.sonDistintos(null, 0)).toBe(true);
    expect(audit.sonDistintos(null, null)).toBe(false);
  });
});

describe('snapshotAllowed', () => {
  it('conserva solo los campos auditables del recurso eliminado', () => {
    const row = {
      id: 3,
      nombre: 'Consumo fin de semana',
      severidad: 'alta',
      creado_por: 'SA001',
      viewer_user_ids: ['U1'],
    };

    const snap = audit.snapshotAllowed(row, 'alerta');

    expect(snap).toEqual({ nombre: 'Consumo fin de semana', severidad: 'alta' });
    expect(snap).not.toHaveProperty('creado_por');
  });

  it('nunca expone la clave del informante DGA', () => {
    const row = { rut: '11111111-1', referencia: 'CCU', clave_informante: 'super-secreta' };

    const snap = audit.snapshotAllowed(row, 'dga_informante');

    expect(snap).toEqual({ referencia: 'CCU' });
    expect(JSON.stringify(snap)).not.toContain('super-secreta');
  });

  it('devuelve null si el recurso no tiene campos auditables', () => {
    expect(audit.snapshotAllowed(null, 'alerta')).toBeNull();
    expect(audit.snapshotAllowed({ otro: 1 }, 'alerta')).toBeNull();
  });
});

describe('outcomeForStatus', () => {
  it('clasifica los desenlaces que importan para una auditoría', () => {
    expect(audit.outcomeForStatus(200)).toBe('ok');
    expect(audit.outcomeForStatus(201)).toBe('ok');
    expect(audit.outcomeForStatus(401)).toBe('unauthorized');
    expect(audit.outcomeForStatus(403)).toBe('denied');
    expect(audit.outcomeForStatus(404)).toBe('not_found');
    expect(audit.outcomeForStatus(409)).toBe('conflict');
    expect(audit.outcomeForStatus(422)).toBe('invalid');
    expect(audit.outcomeForStatus(500)).toBe('error');
  });
});

describe('configuración de allowlist', () => {
  it('no permite auditar el valor de datos personales ni secretos', () => {
    const prohibidos = /password|contrasena|clave|token|secret|otp|rut|email|telefono|direccion/i;
    for (const [targetType, campos] of Object.entries(audit.VALUE_ALLOWLIST)) {
      for (const campo of campos) {
        expect(
          prohibidos.test(campo),
          `${targetType}.${campo} no puede estar en la allowlist`,
        ).toBe(false);
      }
    }
  });

  it('todo recurso con tabla declarada tiene allowlist', () => {
    for (const targetType of Object.keys(audit.TABLE_BY_TARGET)) {
      expect(audit.VALUE_ALLOWLIST[targetType], `falta allowlist de ${targetType}`).toBeDefined();
    }
  });
});
