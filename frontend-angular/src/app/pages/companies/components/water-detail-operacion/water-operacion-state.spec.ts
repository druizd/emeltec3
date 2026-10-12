import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../../../services/auth.service';
import { CompanyService } from '../../../../services/company.service';
import { WaterOperacionStateService } from './water-operacion-state';

/**
 * El guardado automático de turnos y jornada solo puede dispararse para quien
 * puede editarlos (SuperAdmin / Admin, con el rol efectivo de "ver como"). Para
 * el resto el backend responde 403, así que ni siquiera debe intentarse el PUT.
 */
describe('WaterOperacionStateService: guardado automático según rol', () => {
  const canEdit = signal(true);
  const updateSiteOperacionConfig = vi.fn(() => of({ ok: true }));

  const configBackend = {
    ok: true,
    data: {
      sitio_id: 'S1',
      num_turnos: 3 as const,
      turnos: [
        { nombre: 'Turno 1', inicio: '07:00', fin: '14:59' },
        { nombre: 'Turno 2', inicio: '15:00', fin: '22:59' },
        { nombre: 'Turno 3', inicio: '23:00', fin: '06:59' },
      ],
      jornada_inicio: '07:00',
      jornada_fin: '07:00',
      updated_at: '2026-10-12T00:00:00Z',
    },
  };

  /** Hidrata, edita un turno y deja correr el debounce del guardado. */
  function editarYEsperar(): void {
    const state = TestBed.inject(WaterOperacionStateService);
    state.startCountersPolling('S1');
    TestBed.tick();
    state.updateTurnoConfig(0, 'fin', '13:59');
    TestBed.tick();
    vi.advanceTimersByTime(1000);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    updateSiteOperacionConfig.mockClear();
    canEdit.set(true);
    TestBed.configureTestingModule({
      providers: [
        WaterOperacionStateService,
        { provide: AuthService, useValue: { canEditSiteSettings: canEdit } },
        {
          provide: CompanyService,
          useValue: {
            getSiteOperacionConfig: () => of(configBackend),
            updateSiteOperacionConfig,
          },
        },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('SuperAdmin/Admin: un cambio de turno dispara el PUT', () => {
    editarYEsperar();
    expect(updateSiteOperacionConfig).toHaveBeenCalledTimes(1);
  });

  it('sin permiso de edición (Gerente, Cliente, Vendedor o "ver como" de uno de ellos): nunca hay PUT', () => {
    canEdit.set(false);
    editarYEsperar();
    expect(updateSiteOperacionConfig).not.toHaveBeenCalled();
  });

  it('expone canEditConfig con el valor efectivo del rol', () => {
    const state = TestBed.inject(WaterOperacionStateService);
    expect(state.canEditConfig()).toBe(true);
    canEdit.set(false);
    expect(state.canEditConfig()).toBe(false);
  });
});
