import { describe, it, expect } from 'vitest';
import { canEditAlarm, alarmVisibilityFilter, ALARM_ADMIN_TIER } from '../alarmAccess';

describe('canEditAlarm', () => {
  it('permite a SuperAdmin, Admin y Gerente', () => {
    expect(canEditAlarm('SuperAdmin')).toBe(true);
    expect(canEditAlarm('Admin')).toBe(true);
    expect(canEditAlarm('Gerente')).toBe(true);
  });

  it('niega a Cliente y roles desconocidos/undefined', () => {
    expect(canEditAlarm('Cliente')).toBe(false);
    expect(canEditAlarm('Otro')).toBe(false);
    expect(canEditAlarm(undefined)).toBe(false);
    expect(canEditAlarm(null)).toBe(false);
  });

  it('ALARM_ADMIN_TIER son exactamente los 3 roles editores', () => {
    expect([...ALARM_ADMIN_TIER].sort()).toEqual(['Admin', 'Gerente', 'SuperAdmin']);
  });
});

describe('alarmVisibilityFilter', () => {
  it('admin-tier: sin filtro (ve todas)', () => {
    for (const tipo of ['SuperAdmin', 'Admin', 'Gerente']) {
      const f = alarmVisibilityFilter({ tipo, id: 'U1' }, 'a', 2);
      expect(f.clause).toBeNull();
      expect(f.params).toEqual([]);
    }
  });

  it('no admin: filtra por visible_to_all o viewer_user_ids con el id del usuario', () => {
    const f = alarmVisibilityFilter({ tipo: 'Cliente', id: 'U9' }, 'a', 3);
    expect(f.clause).toBe('(a.visible_to_all OR $3 = ANY(a.viewer_user_ids))');
    expect(f.params).toEqual(['U9']);
  });

  it('usa el alias y el índice de parámetro provistos', () => {
    const f = alarmVisibilityFilter({ tipo: 'Cliente', id: 'U1' }, 'cold_room_alarm_rule', 2);
    expect(f.clause).toBe(
      '(cold_room_alarm_rule.visible_to_all OR $2 = ANY(cold_room_alarm_rule.viewer_user_ids))',
    );
  });

  it('id ausente → string vacío (no rompe la query)', () => {
    const f = alarmVisibilityFilter({ tipo: 'Cliente' }, 'a', 1);
    expect(f.params).toEqual(['']);
  });

  it('user undefined → tratado como no-admin', () => {
    const f = alarmVisibilityFilter(undefined, 'a', 1);
    expect(f.clause).toBe('(a.visible_to_all OR $1 = ANY(a.viewer_user_ids))');
    expect(f.params).toEqual(['']);
  });
});
