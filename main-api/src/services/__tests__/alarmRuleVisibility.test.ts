/**
 * Visibilidad de las reglas de alarma de cámaras de frío.
 *
 * La migración 2026-06-21-alarm-visibility creó `visible_to_all` /
 * `viewer_user_ids` para AMBOS sistemas de alarmas y documenta la regla
 * ("Admin/Gerente/SuperAdmin ven todas; el filtro aplica solo a otros roles"),
 * pero en cámaras nunca se aplicó: el listado hacía SELECT * y devolvía los
 * campos al frontend sin usarlos.
 */
import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { alarmRuleVisibilityScope, ALARM_ADMIN_ROLES } = require('../alarmRuleVisibility.js') as {
  alarmRuleVisibilityScope: (
    user: { id?: string; tipo?: string } | null,
    startIndex: number,
  ) => { clause: string; params: unknown[] };
  ALARM_ADMIN_ROLES: string[];
};

describe('alarmRuleVisibilityScope', () => {
  it('no restringe a quienes administran alarmas de cámara', () => {
    for (const tipo of ALARM_ADMIN_ROLES) {
      const scope = alarmRuleVisibilityScope({ id: 'U1', tipo }, 2);
      expect(scope.clause, tipo).toBe('');
      expect(scope.params).toEqual([]);
    }
  });

  it('coincide con los roles que nombra la migración', () => {
    expect(ALARM_ADMIN_ROLES).toEqual(['SuperAdmin', 'Admin', 'Gerente']);
  });

  it('restringe a Cliente por visible_to_all o pertenencia a viewer_user_ids', () => {
    const scope = alarmRuleVisibilityScope({ id: 'C9', tipo: 'Cliente' }, 2);

    expect(scope.clause).toContain('visible_to_all = TRUE');
    expect(scope.clause).toContain('$2 = ANY(viewer_user_ids)');
    expect(scope.params).toEqual(['C9']);
  });

  it('un rol desconocido queda restringido, no exento', () => {
    expect(alarmRuleVisibilityScope({ id: 'X', tipo: 'Fantasma' }, 2).clause).not.toBe('');
  });

  it('sin usuario tampoco se exime', () => {
    expect(alarmRuleVisibilityScope(null, 2).clause).not.toBe('');
  });

  it('el id viaja como parámetro, nunca interpolado en el SQL', () => {
    const scope = alarmRuleVisibilityScope({ id: "'; DROP TABLE x;--", tipo: 'Cliente' }, 2);

    expect(scope.clause).not.toContain('DROP TABLE');
    expect(scope.params[0]).toBe("'; DROP TABLE x;--");
  });

  it('respeta el placeholder pedido, para componer despues de site_id', () => {
    expect(alarmRuleVisibilityScope({ id: 'C1', tipo: 'Cliente' }, 2).clause).toContain('$2');
    expect(alarmRuleVisibilityScope({ id: 'C1', tipo: 'Cliente' }, 5).clause).toContain('$5');
  });

  it('compone un SQL bien formado con el listado real', () => {
    const scope = alarmRuleVisibilityScope({ id: 'C1', tipo: 'Cliente' }, 2);
    const sql = `SELECT * FROM cold_room_alarm_rule WHERE site_id = $1${scope.clause} ORDER BY created_at DESC`;

    expect(sql).toBe(
      'SELECT * FROM cold_room_alarm_rule WHERE site_id = $1 AND ' +
        '(visible_to_all = TRUE OR $2 = ANY(viewer_user_ids)) ORDER BY created_at DESC',
    );
  });
});
