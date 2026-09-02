import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
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
  escalaPorRango: string;
  rangoRawMin: string;
  rangoRawMax: string;
  rangoIngMin: string;
  rangoIngMax: string;
  conSigno: string;
  signoBits: string;
  bitIndex: string;
  palabraBits: string;
  bitInvertido: string;
  etiquetaOn: string;
  etiquetaOff: string;
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
    escalaPorRango: 'false',
    rangoRawMin: '4000',
    rangoRawMax: '20000',
    rangoIngMin: '0',
    rangoIngMax: '',
    conSigno: 'false',
    signoBits: '16',
    bitIndex: '0',
    palabraBits: '16',
    bitInvertido: 'false',
    etiquetaOn: '',
    etiquetaOff: '',
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

/** Un mapeo por bit sobre REG_H, como lo devuelve la API en `mappings`. */
function bitMapping(id: string, alias: string, bit: number) {
  return {
    id,
    alias,
    d1: 'REG_H',
    d2: null,
    tipo_dato: 'BOOLEAN',
    unidad: null,
    rol_dashboard: 'generico',
    transformacion: 'bit',
    parametros: { bit, palabra_bits: 16 },
    sitio_id: 's1',
  };
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

  describe('escala por rango (4-20 mA)', () => {
    it('lineal persiste los cuatro extremos y el factor/offset derivado', () => {
      component.variableForm.set(
        baseForm({
          transformacion: 'lineal',
          d2: '',
          escalaPorRango: 'true',
          rangoRawMin: '4000',
          rangoRawMax: '20000',
          rangoIngMin: '0',
          rangoIngMax: '20',
        }),
      );
      const params = buildParams();
      expect(params['modo_escala']).toBe('rango');
      expect(params['raw_min']).toBe(4000);
      expect(params['raw_max']).toBe(20000);
      expect(params['ing_min']).toBe(0);
      expect(params['ing_max']).toBe(20);
      expect(params['factor']).toBeCloseTo(0.00125, 10);
      expect(params['offset']).toBeCloseTo(-5, 10);
    });

    it('ieee754_32 con rango conserva word_swap y formato', () => {
      component.variableForm.set(
        baseForm({
          transformacion: 'ieee754_32',
          wordSwap: 'true',
          escalaPorRango: 'true',
          rangoRawMin: '4',
          rangoRawMax: '20',
          rangoIngMin: '0',
          rangoIngMax: '100',
        }),
      );
      const params = buildParams();
      expect(params['formato']).toBe('float32');
      expect(params['word_swap']).toBe(true);
      expect(params['modo_escala']).toBe('rango');
      expect(params['factor']).toBeCloseTo(6.25, 10);
      expect(params['offset']).toBeCloseTo(-25, 10);
    });

    it('rango incompleto cae a factor/offset manual y no persiste modo_escala', () => {
      component.variableForm.set(
        baseForm({
          transformacion: 'lineal',
          d2: '',
          escalaPorRango: 'true',
          rangoIngMax: '',
          factor: '3',
          offset: '7',
        }),
      );
      const params = buildParams();
      expect(params['modo_escala']).toBeUndefined();
      expect(params['factor']).toBe(3);
      expect(params['offset']).toBe(7);
    });

    it('rango bruto degenerado (min = max) no persiste escala por rango', () => {
      component.variableForm.set(
        baseForm({
          transformacion: 'lineal',
          d2: '',
          escalaPorRango: 'true',
          rangoRawMin: '4000',
          rangoRawMax: '4000',
          rangoIngMin: '0',
          rangoIngMax: '20',
        }),
      );
      expect(buildParams()['modo_escala']).toBeUndefined();
    });

    it('la escala por rango se ignora en transformaciones sin factor/offset', () => {
      component.variableForm.set(
        baseForm({
          transformacion: 'directo',
          d2: '',
          escalaPorRango: 'true',
          rangoIngMax: '20',
        }),
      );
      expect(component.useRangeScale()).toBe(false);
      expect(buildParams()).toEqual({});
    });

    it('la vista previa convierte el crudo a unidades de ingenieria', () => {
      component.siteVariables.set(variablesPayload([{ nombre_dato: 'REG_H', valor_dato: 12000 }]));
      component.variableForm.set(
        baseForm({
          transformacion: 'lineal',
          d2: '',
          unidad: 'bar',
          escalaPorRango: 'true',
          rangoIngMax: '20',
        }),
      );
      expect(component.previewResultText()).toBe('10 bar');
    });

    it('extrapola sin recortar cuando el crudo sale del rango', () => {
      component.siteVariables.set(variablesPayload([{ nombre_dato: 'REG_H', valor_dato: 3200 }]));
      component.variableForm.set(
        baseForm({
          transformacion: 'lineal',
          d2: '',
          unidad: 'bar',
          escalaPorRango: 'true',
          rangoIngMax: '20',
        }),
      );
      expect(component.previewResultText()).toBe('-1 bar');
    });

    it('desactivar el rango deja el factor/offset derivado listo para editar a mano', () => {
      component.variableForm.set(
        baseForm({
          transformacion: 'lineal',
          d2: '',
          escalaPorRango: 'true',
          rangoIngMax: '20',
        }),
      );
      component.toggleRangeScale(false);
      expect(component.variableForm().factor).toBe('0.00125');
      expect(component.variableForm().divisor).toBe('1');
      expect(component.variableForm().offset).toBe('-5');
    });

    it('prepareVariableMap reconstruye el rango guardado', () => {
      component.prepareVariableMap({
        nombre_dato: 'REG_H',
        valor_dato: 12000,
        timestamp_completo: '2026-01-01 00:00',
        mapping: {
          id: 'M1',
          alias: 'Presion',
          d1: 'REG_H',
          d2: null,
          tipo_dato: 'FLOAT',
          unidad: 'bar',
          rol_dashboard: 'generico',
          transformacion: 'lineal',
          parametros: {
            modo_escala: 'rango',
            raw_min: 4000,
            raw_max: 20000,
            ing_min: 0,
            ing_max: 20,
            factor: 0.00125,
            offset: -5,
          },
          sitio_id: 's1',
        },
      });
      const form = component.variableForm();
      expect(form.escalaPorRango).toBe('true');
      expect(form.rangoRawMax).toBe('20000');
      expect(form.rangoIngMax).toBe('20');
      expect(component.useRangeScale()).toBe(true);
    });
  });

  describe('señal digital (un bit de la palabra)', () => {
    /** 171 = 0b0000_0000_1010_1011 → bits 0,1,3,5,7 en 1. */
    function palabra(valor = 171) {
      component.siteVariables.set(variablesPayload([{ nombre_dato: 'REG_H', valor_dato: valor }]));
    }

    function formBit(overrides: Partial<VariableFormShape> = {}) {
      component.variableForm.set(
        baseForm({ transformacion: 'bit', d1: 'REG_H', d2: '', ...overrides }),
      );
    }

    it('persiste el bit y el ancho de la palabra', () => {
      formBit({ bitIndex: '3' });
      const params = buildParams();
      expect(params['bit']).toBe(3);
      expect(params['palabra_bits']).toBe(16);
    });

    it('no ensucia parametros con factor, offset ni etiquetas vacías', () => {
      formBit({ bitIndex: '0' });
      expect(buildParams()).toEqual({ bit: 0, palabra_bits: 16 });
    });

    it('persiste invertido y las etiquetas cuando se escriben', () => {
      formBit({
        bitIndex: '2',
        bitInvertido: 'true',
        etiquetaOn: 'Marcha',
        etiquetaOff: 'Detenido',
      });
      const params = buildParams();
      expect(params['invertido']).toBe(true);
      expect(params['etiqueta_on']).toBe('Marcha');
      expect(params['etiqueta_off']).toBe('Detenido');
    });

    it('la vista previa muestra la etiqueta y el 1/0', () => {
      palabra();
      formBit({ bitIndex: '0', etiquetaOn: 'Marcha', etiquetaOff: 'Detenido' });
      expect(component.previewResultText()).toBe('Marcha · 1');

      formBit({ bitIndex: '2', etiquetaOn: 'Marcha', etiquetaOff: 'Detenido' });
      expect(component.previewResultText()).toBe('Detenido · 0');
    });

    it('sin etiquetas la vista previa cae a Activo/Inactivo', () => {
      palabra();
      formBit({ bitIndex: '1' });
      expect(component.previewResultText()).toBe('Activo · 1');
    });

    it('invertido da vuelta la vista previa', () => {
      palabra();
      formBit({ bitIndex: '0', bitInvertido: 'true' });
      expect(component.previewResultText()).toBe('Inactivo · 0');
    });

    it('el grid va del bit más significativo al menos significativo', () => {
      palabra();
      formBit({ bitIndex: '0' });
      const cells = component.bitCells();
      expect(cells).toHaveLength(16);
      expect(cells[0]?.index).toBe(15);
      expect(cells[15]?.index).toBe(0);
    });

    it('el grid refleja el estado en vivo de cada bit', () => {
      palabra();
      formBit();
      const porIndice = new Map(component.bitCells().map((cell) => [cell.index, cell.estado]));
      expect(porIndice.get(0)).toBe('1');
      expect(porIndice.get(1)).toBe('1');
      expect(porIndice.get(2)).toBe('0');
      expect(porIndice.get(7)).toBe('1');
      expect(porIndice.get(15)).toBe('0');
    });

    it('sin lectura el grid queda neutro en vez de mostrar ceros falsos', () => {
      component.siteVariables.set(variablesPayload([]));
      formBit();
      expect(component.bitCells().every((cell) => cell.estado === '–')).toBe(true);
    });

    it('marca como elegida solo la celda del bit configurado', () => {
      palabra();
      formBit({ bitIndex: '5' });
      const elegidas = component.bitCells().filter((cell) => cell.selected);
      expect(elegidas.map((cell) => cell.index)).toEqual([5]);
    });

    it('clic en una celda cambia el bit configurado', () => {
      palabra();
      formBit({ bitIndex: '0' });
      component.selectBit(9);
      expect(component.variableForm().bitIndex).toBe('9');
      expect(buildParams()['bit']).toBe(9);
    });

    it('el resumen muestra la palabra en binario agrupado', () => {
      palabra();
      formBit({ bitIndex: '0' });
      expect(component.bitSummary()).toContain('0000 0000 1010 1011');
    });

    it('avisa cuando el crudo no cabe en el ancho declarado', () => {
      palabra(70000);
      formBit({ bitIndex: '0' });
      expect(component.bitSummary()).toContain('no es una palabra sin signo de 16 bits');
      // La vista previa no puede inventar un estado: repite el diagnóstico.
      expect(component.previewResultText()).toContain('no es una palabra sin signo');
    });

    it('con 32 bits esa misma palabra sí se puede leer', () => {
      palabra(70000);
      formBit({ bitIndex: '16', palabraBits: '32' });
      expect(component.bitCells()).toHaveLength(32);
      expect(component.previewResultText()).toBe('Activo · 1');
    });

    it('angostar la palabra recorta un bit que ya no existe', () => {
      formBit({ bitIndex: '20', palabraBits: '32' });
      component.updateWordBits('16');
      expect(component.variableForm().palabraBits).toBe('16');
      expect(component.variableForm().bitIndex).toBe('15');
    });

    it('elegir la transformación deja el tipo en BOOLEAN y sin unidad', () => {
      component.variableForm.set(baseForm({ transformacion: 'lineal', d2: '', unidad: 'bar' }));
      component.updateVariableTransform('bit');
      expect(component.variableForm().tipo_dato).toBe('BOOLEAN');
      expect(component.variableForm().unidad).toBe('');
    });

    it('salir de la transformación devuelve el tipo a FLOAT', () => {
      formBit();
      component.updateVariableTransform('bit');
      component.updateVariableTransform('lineal');
      expect(component.variableForm().tipo_dato).toBe('FLOAT');
    });

    it('elegir la transformación descarta el rol inferido del alias', () => {
      component.variableForm.set(
        baseForm({ transformacion: 'lineal', d2: '', rol_dashboard: 'nivel' }),
      );
      component.updateVariableTransform('bit');
      expect(component.variableForm().rol_dashboard).toBe('generico');
    });

    it('no ofrece ni el complemento a 2 ni la escala por rango', () => {
      formBit();
      expect(component.usesSignedOption()).toBe(false);
      expect(component.usesScaleTransform()).toBe(false);
    });

    it('lista los bits ya configurados sobre el mismo dato, ordenados', () => {
      component.siteVariables.update((current) => ({
        ...current,
        mappings: [
          bitMapping('RM3', 'Nivel alto', 4),
          bitMapping('RM1', 'Marcha bomba 1', 0),
          bitMapping('RM2', 'Falla térmico', 1),
          {
            ...bitMapping('RM9', 'Presión otra palabra', 0),
            d1: 'REG_OTRO',
          },
        ],
      }));
      formBit();

      expect(component.bitMappingsForCurrentKey().map((item) => item.bit)).toEqual([0, 1, 4]);
      expect(component.bitMappingsForCurrentKey().map((item) => item.mapping.alias)).toEqual([
        'Marcha bomba 1',
        'Falla térmico',
        'Nivel alto',
      ]);
      expect(component.bitCountFor('REG_H')).toBe(3);
      expect(component.bitCountFor('REG_OTRO')).toBe(1);
      expect(component.bitCountFor('REG_SIN_BITS')).toBe(0);
    });

    it('prepareVariableMap reconstruye el bit guardado', () => {
      component.prepareVariableMap({
        nombre_dato: 'REG_H',
        valor_dato: 171,
        timestamp_completo: '2026-01-01 00:00',
        mapping: {
          ...bitMapping('RM5', 'Falla térmico', 1),
          parametros: {
            bit: 1,
            palabra_bits: 16,
            invertido: true,
            etiqueta_on: 'OK',
            etiqueta_off: 'Falla',
          },
        },
      });

      const form = component.variableForm();
      expect(form.transformacion).toBe('bit');
      expect(form.bitIndex).toBe('1');
      expect(form.palabraBits).toBe('16');
      expect(form.bitInvertido).toBe('true');
      expect(form.etiquetaOn).toBe('OK');
      expect(form.etiquetaOff).toBe('Falla');
      expect(component.isBitTransform()).toBe(true);
    });
  });

  describe('cargador masivo de señales digitales', () => {
    /** Espía sobre el POST de creación; devuelve las llamadas hechas. */
    function espiarCreacion(fallarEnBits: number[] = []) {
      const api = (component as unknown as { api: Record<string, unknown> }).api;
      const spy = vi.fn((_siteId: string, payload: { parametros?: { bit?: number } }) =>
        fallarEnBits.includes(payload.parametros?.bit ?? -1)
          ? throwError(
              () => new HttpErrorResponse({ status: 409, error: { message: 'bit ya usado' } }),
            )
          : of({ ok: true, message: 'creada', data: {} }),
      );
      api['createSiteVariableMap'] = spy;
      // load() dispara dos GET que en el test nunca emiten; se neutralizan para
      // que el forkJoin no quede colgado de HttpClientTesting.
      api['getSiteTypeCatalog'] = () => of({ ok: false, data: {} });
      api['getSiteVariables'] = () => of({ ok: false, data: {} });
      return spy;
    }

    function abrirCon(valor = 7, mappings: unknown[] = []) {
      component.siteId = 's1';
      component.siteVariables.set({
        ...variablesPayload([{ nombre_dato: 'REG_H', valor_dato: valor }]),
        mappings: mappings as never,
      });
      component.variableForm.set(baseForm({ transformacion: 'bit', d1: 'REG_H', d2: '' }));
      component.openBitBulk();
    }

    it('no abre sin dato original y avisa', () => {
      component.variableForm.set(baseForm({ transformacion: 'bit', d1: '', d2: '' }));
      component.openBitBulk();

      expect(component.bitBulkOpen()).toBe(false);
      expect(component.status().type).toBe('error');
    });

    it('arma una fila por bit del ancho declarado', () => {
      abrirCon();

      expect(component.bitBulkOpen()).toBe(true);
      expect(component.bitBulkRows()).toHaveLength(16);
      expect(component.bitBulkRows().map((row) => row.bit)).toEqual([
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
      ]);
      expect(component.bitBulkD1()).toBe('REG_H');
    });

    it('cada fila muestra el estado en vivo de su bit', () => {
      // 7 = 0b111 → bits 0, 1 y 2 activos.
      abrirCon(7);

      expect(component.bitBulkEstado(0)).toBe('1');
      expect(component.bitBulkEstado(2)).toBe('1');
      expect(component.bitBulkEstado(3)).toBe('0');
      expect(component.bitBulkEstado(15)).toBe('0');
    });

    it('sin lectura válida las filas quedan neutras', () => {
      abrirCon(70000);
      expect(component.bitBulkEstado(0)).toBe('–');
    });

    it('los bits ya configurados quedan bloqueados y no se recrean', () => {
      abrirCon(7, [bitMapping('RM1', 'Bomba activa', 0)]);

      expect(component.bitBulkExistente(0)?.alias).toBe('Bomba activa');
      expect(component.bitBulkExistente(1)).toBeNull();
      // El alias se precarga para que la fila se vea, pero no cuenta como nueva.
      expect(component.bitBulkRows()[0]?.alias).toBe('Bomba activa');
      expect(component.bitBulkPendientes()).toBe(0);
    });

    it('solo cuenta como pendientes las filas con alias escrito', () => {
      abrirCon();
      expect(component.bitBulkPendientes()).toBe(0);

      component.updateBitBulkAlias(0, 'Bomba activa');
      component.updateBitBulkAlias(2, 'Falla térmico');
      component.updateBitBulkAlias(5, '   ');

      expect(component.bitBulkPendientes()).toBe(2);
      expect(component.bitBulkSummary()).toContain('2 señales');
    });

    it('crea una variable por fila con alias, con su bit y el ancho', () => {
      const spy = espiarCreacion();
      abrirCon();
      component.updateBitBulkAlias(0, 'Bomba activa');
      component.updateBitBulkAlias(3, '  Falla térmico  ');
      component.toggleBitBulkInvertido(3, true);

      component.saveBitBulk();

      expect(spy).toHaveBeenCalledTimes(2);
      const [, primera] = spy.mock.calls[0] as [string, Record<string, unknown>];
      expect(primera['alias']).toBe('Bomba activa');
      expect(primera['d1']).toBe('REG_H');
      expect(primera['transformacion']).toBe('bit');
      expect(primera['tipo_dato']).toBe('BOOLEAN');
      expect(primera['rol_dashboard']).toBe('generico');
      expect(primera['parametros']).toEqual({ bit: 0, palabra_bits: 16 });

      const [, segunda] = spy.mock.calls[1] as [string, Record<string, unknown>];
      expect(segunda['alias']).toBe('Falla térmico');
      expect(segunda['parametros']).toEqual({ bit: 3, palabra_bits: 16, invertido: true });
    });

    it('cierra el cargador y avisa cuando salieron todas', () => {
      espiarCreacion();
      abrirCon();
      component.updateBitBulkAlias(0, 'Bomba activa');

      component.saveBitBulk();

      expect(component.bitBulkOpen()).toBe(false);
      expect(component.status().type).toBe('success');
      expect(component.status().message).toContain('1 señal creada');
    });

    it('ante un fallo parcial deja el cargador abierto y nombra el bit', () => {
      espiarCreacion([3]);
      abrirCon();
      component.updateBitBulkAlias(0, 'Bomba activa');
      component.updateBitBulkAlias(3, 'Falla térmico');

      component.saveBitBulk();

      expect(component.bitBulkOpen()).toBe(true);
      expect(component.status().type).toBe('error');
      expect(component.status().message).toContain('1 de 2');
      expect(component.status().message).toContain('bit 3');
      // Lo escrito no se pierde: la fila que falló conserva su alias.
      expect(component.bitBulkRows()[3]?.alias).toBe('Falla térmico');
    });

    it('sin ningún alias no llama a la API', () => {
      const spy = espiarCreacion();
      abrirCon();

      component.saveBitBulk();

      expect(spy).not.toHaveBeenCalled();
      expect(component.status().type).toBe('error');
    });

    it('cerrar descarta las filas', () => {
      abrirCon();
      component.updateBitBulkAlias(0, 'Bomba activa');
      component.closeBitBulk();

      expect(component.bitBulkOpen()).toBe(false);
      expect(component.bitBulkRows()).toEqual([]);
    });
  });

  describe('valor con signo (complemento a 2)', () => {
    it('lineal persiste con_signo y el ancho elegido', () => {
      component.variableForm.set(baseForm({ transformacion: 'lineal', d2: '', conSigno: 'true' }));
      const params = buildParams();
      expect(params['con_signo']).toBe(true);
      expect(params['signo_bits']).toBe(16);
    });

    it('uint32_registros fuerza 32 bits, sin importar el selector', () => {
      component.variableForm.set(
        baseForm({ transformacion: 'uint32_registros', conSigno: 'true', signoBits: '16' }),
      );
      const params = buildParams();
      expect(params['con_signo']).toBe(true);
      expect(params['signo_bits']).toBe(32);
      expect(params['formato']).toBe('uint32');
    });

    it('ieee754_32 no ofrece la casilla ni persiste con_signo', () => {
      component.variableForm.set(baseForm({ transformacion: 'ieee754_32', conSigno: 'true' }));
      expect(component.usesSignedOption()).toBe(false);
      expect(component.useSigned()).toBe(false);
      expect(buildParams()['con_signo']).toBeUndefined();
    });

    it('la casilla apagada no ensucia parametros', () => {
      component.variableForm.set(baseForm({ transformacion: 'lineal', d2: '' }));
      expect(buildParams()['con_signo']).toBeUndefined();
      expect(buildParams()['signo_bits']).toBeUndefined();
    });

    it('la vista previa lee 65087 como -449', () => {
      component.siteVariables.set(variablesPayload([{ nombre_dato: 'REG_H', valor_dato: 65087 }]));
      component.variableForm.set(baseForm({ transformacion: 'lineal', d2: '', conSigno: 'true' }));
      expect(component.previewResultText()).toBe('-449');
    });

    it('la vista previa avisa cuando el crudo no cabe en el ancho', () => {
      component.siteVariables.set(variablesPayload([{ nombre_dato: 'REG_H', valor_dato: 549087 }]));
      component.variableForm.set(baseForm({ transformacion: 'lineal', d2: '', conSigno: 'true' }));
      expect(component.previewResultText()).toContain('no cabe en 16 bits');
    });

    it('32 bits corre el corte y 549087 queda positivo', () => {
      component.siteVariables.set(variablesPayload([{ nombre_dato: 'REG_H', valor_dato: 549087 }]));
      component.variableForm.set(
        baseForm({ transformacion: 'lineal', d2: '', conSigno: 'true', signoBits: '32' }),
      );
      expect(component.previewResultText()).toBe('549.087');
    });

    it('el signo se aplica antes de la escala por rango', () => {
      component.siteVariables.set(variablesPayload([{ nombre_dato: 'REG_H', valor_dato: 65087 }]));
      component.variableForm.set(
        baseForm({
          transformacion: 'lineal',
          d2: '',
          unidad: 'bar',
          conSigno: 'true',
          escalaPorRango: 'true',
          rangoIngMax: '20',
        }),
      );
      // -449 * 0.00125 - 5 = -5,56125
      expect(component.previewResultText()).toBe('-5,5613 bar');
      const params = buildParams();
      expect(params['con_signo']).toBe(true);
      expect(params['modo_escala']).toBe('rango');
    });

    it('cambiar a una transformacion sin registro crudo apaga la casilla', () => {
      component.variableForm.set(baseForm({ transformacion: 'lineal', d2: '', conSigno: 'true' }));
      component.updateVariableTransform('ieee754_32');
      expect(component.variableForm().conSigno).toBe('false');
    });

    it('prepareVariableMap reconstruye el signo guardado', () => {
      component.prepareVariableMap({
        nombre_dato: 'REG_H',
        valor_dato: 65087,
        timestamp_completo: '2026-01-01 00:00',
        mapping: {
          id: 'M2',
          alias: 'Temperatura',
          d1: 'REG_H',
          d2: null,
          tipo_dato: 'FLOAT',
          unidad: 'C',
          rol_dashboard: 'generico',
          transformacion: 'lineal',
          parametros: { con_signo: true, signo_bits: 16, factor: 0.1, offset: 0 },
          sitio_id: 's1',
        },
      });
      expect(component.variableForm().conSigno).toBe('true');
      expect(component.variableForm().signoBits).toBe('16');
      expect(component.useSigned()).toBe(true);
    });
  });
});
