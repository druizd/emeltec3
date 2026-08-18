import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { BitacoraAuditLogComponent } from './bitacora-trazabilidad';
import type { AuditLogEntry } from '../../../../services/audit-log.service';

/**
 * Verifica que la bitácora RENDERICE lo que el middleware ampliado escribe en
 * `metadata`: antes/después por campo, valores redactados, intentos denegados,
 * borrados — y que los registros viejos (sin ese metadata) sigan mostrándose.
 */

function entry(over: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: 1,
    ts: '2026-08-17T16:12:28.209Z',
    actor_id: 'SA001',
    actor_email: 'druiz@emeltec.cl',
    actor_tipo: 'SuperAdmin',
    action: 'alerta.update',
    target_type: 'alerta',
    target_id: '3',
    status_code: 200,
    ip: '186.104.216.240',
    metadata: null,
    resolved_sitio_id: 'S106',
    ...over,
  };
}

describe('BitacoraAuditLogComponent · render del detalle', () => {
  let fixture: ComponentFixture<BitacoraAuditLogComponent>;
  let component: BitacoraAuditLogComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(BitacoraAuditLogComponent);
    component = fixture.componentInstance;
  });

  function render(entradas: AuditLogEntry[]): string {
    component.entradasAll.set(entradas);
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('muestra el antes → después de un campo auditable', () => {
    const texto = render([
      entry({
        metadata: {
          method: 'PUT',
          path: '/api/alertas/3',
          outcome: 'ok',
          changed_fields: ['umbral_bajo'],
          changes: { umbral_bajo: { antes: '300', despues: 60 } },
        },
      }),
    ]);

    expect(texto).toContain('umbral_bajo');
    expect(texto).toContain('300');
    expect(texto).toContain('60');
  });

  it('marca como oculto el campo redactado, sin filtrar su valor', () => {
    const texto = render([
      entry({
        action: 'usuario.update',
        target_type: 'usuario',
        metadata: {
          outcome: 'ok',
          changed_fields: ['tipo', 'email'],
          changes: {
            tipo: { antes: 'Operador', despues: 'Admin' },
            email: '[redactado]',
          },
        },
      }),
    ]);

    expect(texto).toContain('email');
    expect(texto).toContain('oculto');
    expect(texto).toContain('Admin');
    expect(texto).not.toContain('[redactado]');
  });

  it('etiqueta un intento denegado y lista los campos que se quiso tocar', () => {
    const texto = render([
      entry({
        status_code: 403,
        metadata: {
          outcome: 'denied',
          attempted_fields: ['umbral_bajo'],
        },
      }),
    ]);

    expect(texto).toContain('Denegado');
    expect(texto).toContain('umbral_bajo');
  });

  it('muestra el snapshot del recurso eliminado', () => {
    const texto = render([
      entry({
        action: 'alerta.delete',
        metadata: {
          outcome: 'ok',
          deleted: { nombre: 'Consumo fin de semana', severidad: 'alta' },
        },
      }),
    ]);

    expect(texto).toContain('nombre');
    expect(texto).toContain('Consumo fin de semana');
    expect(texto).toContain('severidad');
  });

  it('distingue activar de desactivar', () => {
    expect(render([entry({ action: 'alerta.enable' })])).toContain('Activó');
    expect(render([entry({ action: 'alerta.disable' })])).toContain('Desactivó');
  });

  it('cae al path crudo en registros previos al diff, sin romperse', () => {
    const texto = render([
      entry({
        metadata: { method: 'PUT', path: '/api/alertas/3', duration_ms: 12 },
      }),
    ]);

    expect(texto).toContain('PUT /api/alertas/3 #3');
    expect(texto).not.toContain('Denegado');
  });

  it('un registro sin metadata alguno no rompe el render', () => {
    const texto = render([entry({ metadata: null })]);
    expect(texto).toContain('druiz@emeltec.cl');
  });

  it('formatea booleanos y nulos de forma legible', () => {
    const texto = render([
      entry({
        action: 'alerta.disable',
        metadata: {
          outcome: 'ok',
          changes: { activa: { antes: true, despues: false } },
        },
      }),
    ]);

    expect(texto).toContain('sí');
    expect(texto).toContain('no');
  });
});

describe('BitacoraAuditLogComponent · exportación CSV', () => {
  let component: BitacoraAuditLogComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    component = TestBed.createComponent(BitacoraAuditLogComponent).componentInstance;
  });

  it('resume los cambios en una celda', () => {
    const e = entry({
      metadata: {
        outcome: 'ok',
        changes: {
          umbral_bajo: { antes: '300', despues: 60 },
          email: '[redactado]',
        },
      },
    });

    const cambios = component.cambios(e);

    expect(cambios).not.toBeNull();
    const resumen = (cambios ?? [])
      .map((c) => (c.oculto ? `${c.campo}=[oculto]` : `${c.campo}: ${c.antes} → ${c.despues}`))
      .join(' | ');
    expect(resumen).toBe('umbral_bajo: 300 → 60 | email=[oculto]');
  });

  it('clasifica el outcome de registros antiguos por su status', () => {
    expect(component.outcomeDe(entry({ status_code: 200, metadata: null }))).toBe('ok');
    expect(component.outcomeDe(entry({ status_code: 500, metadata: null }))).toBe('error');
  });
});
