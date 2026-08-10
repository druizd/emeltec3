import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { SiteVariableSettingsPanelComponent } from './site-variable-settings-panel';
import type { SiteVariablesPayload } from '../../../services/administration.service';

/**
 * Cobertura de la lógica pura del panel de configuración de variables:
 *  - buildVariableParameters(): qué se persiste por transformación
 *  - previewResultText(): qué muestra la calculadora de vista previa
 *
 * Foco en ieee754_32 (que ahora aplica factor/offset igual que uint32) sin
 * tocar HTTP ni renderizar el template.
 */

/** Descompone un float32 en sus dos words de 16 bits (Big-Endian, ABCD). */
function float32ToWords(value: number): { high: number; low: number } {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setFloat32(0, value);
  return { high: view.getUint16(0), low: view.getUint16(2) };
}

interface VariableFormShape {
  mapId: string;
  alias: string;
  d1: string;
  d2: string;
  tipo_dato: string;
  unidad: string;
  rol_dashboard: string;
  transformacion: string;
  factor: string;
  divisor: string;
  offset: string;
  wordSwap: string;
  sandboxRaw: string;
}

function baseForm(overrides: Partial<VariableFormShape> = {}): VariableFormShape {
  return {
    mapId: '',
    alias: 'Nivel',
    d1: 'REG_H',
    d2: 'REG_L',
    tipo_dato: 'FLOAT',
    unidad: '',
    rol_dashboard: 'generico',
    transformacion: 'ieee754_32',
    factor: '1',
    divisor: '1',
    offset: '0',
    wordSwap: 'false',
    sandboxRaw: '',
    ...overrides,
  };
}

function variablesPayload(
  vars: { nombre_dato: string; valor_dato: number }[],
): SiteVariablesPayload {
  return {
    site: {
      id: 's1',
      descripcion: 'Sitio',
      empresa_id: '',
      sub_empresa_id: '',
      id_serial: 'SER1',
      ubicacion: null,
      tipo_sitio: 'generico',
      activo: true,
    },
    pozo_config: null,
    variables: vars.map((v) => ({
      nombre_dato: v.nombre_dato,
      valor_dato: v.valor_dato,
      timestamp_completo: '2026-01-01 00:00',
      mapping: null,
    })),
    mappings: [],
  } as unknown as SiteVariablesPayload;
}

describe('SiteVariableSettingsPanelComponent · lógica de transformación', () => {
  let component: SiteVariableSettingsPanelComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    component = TestBed.createComponent(SiteVariableSettingsPanelComponent).componentInstance;
  });

  // buildVariableParameters es privado; se accede por cast en tests.
  function buildParams(): Record<string, unknown> {
    return (
      component as unknown as { buildVariableParameters(): Record<string, unknown> }
    ).buildVariableParameters();
  }

  describe('buildVariableParameters()', () => {
    it('ieee754_32 persiste factor (con split por divisor) y offset', () => {
      component.variableForm.set(
        baseForm({ transformacion: 'ieee754_32', factor: '2', divisor: '100', offset: '5' }),
      );
      const params = buildParams();
      expect(params['formato']).toBe('float32');
      expect(params['word_swap']).toBe(false);
      expect(params['factor']).toBeCloseTo(0.02, 6); // 2 / 100
      expect(params['offset']).toBe(5);
    });

    it('ieee754_32 sin ajustes persiste factor=1 y offset=0 (retrocompatible)', () => {
      component.variableForm.set(baseForm({ transformacion: 'ieee754_32' }));
      const params = buildParams();
      expect(params['factor']).toBe(1);
      expect(params['offset']).toBe(0);
    });

    it('uint32_registros mantiene el mismo esquema factor/offset', () => {
      component.variableForm.set(
        baseForm({ transformacion: 'uint32_registros', factor: '1', divisor: '10', offset: '3' }),
      );
      const params = buildParams();
      expect(params['formato']).toBe('uint32');
      expect(params['factor']).toBeCloseTo(0.1, 6);
      expect(params['offset']).toBe(3);
    });
  });

  describe('previewResultText()', () => {
    it('ieee754_32 aplica el offset al float decodificado', () => {
      const { high, low } = float32ToWords(25.5);
      component.siteVariables.set(
        variablesPayload([
          { nombre_dato: 'REG_H', valor_dato: high },
          { nombre_dato: 'REG_L', valor_dato: low },
        ]),
      );
      component.variableForm.set(
        baseForm({ transformacion: 'ieee754_32', offset: '10', unidad: 'm' }),
      );
      // 25.5 + 10 = 35.5 → formato es-CL usa coma decimal
      expect(component.previewResultText()).toContain('35,5');
    });

    it('ieee754_32 sin offset muestra el valor decodificado tal cual', () => {
      const { high, low } = float32ToWords(12.25);
      component.siteVariables.set(
        variablesPayload([
          { nombre_dato: 'REG_H', valor_dato: high },
          { nombre_dato: 'REG_L', valor_dato: low },
        ]),
      );
      component.variableForm.set(baseForm({ transformacion: 'ieee754_32' }));
      expect(component.previewResultText()).toContain('12,25');
    });
  });
});
