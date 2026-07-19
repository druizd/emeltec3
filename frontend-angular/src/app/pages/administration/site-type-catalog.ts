import type { SiteTypeCatalogResponse } from '../../services/administration.service';

/**
 * Catálogo por defecto de tipos de sitio con sus roles y transformaciones.
 * El backend puede devolver una versión actualizada via getSiteTypeCatalog();
 * este objeto es el fallback cuando la API no responde.
 */
export const DEFAULT_SITE_TYPE_CATALOG: SiteTypeCatalogResponse = {
  pozo: {
    id: 'pozo',
    label: 'Pozo',
    roles: [
      {
        id: 'nivel',
        label: 'Nivel',
        unitHint: 'm',
        description: 'Lectura del sensor usada para calcular el nivel freatico del pozo.',
      },
      { id: 'caudal', label: 'Caudal', unitHint: 'L/s', description: 'Flujo instantaneo.' },
      {
        id: 'totalizador',
        label: 'Totalizador',
        unitHint: 'm3',
        description: 'Volumen acumulado.',
      },
      { id: 'señal', label: 'Señal', unitHint: '%', description: 'Intensidad de señal.' },
      { id: 'generico', label: 'Generico', unitHint: '', description: 'Variable auxiliar.' },
    ],
    transforms: [
      {
        id: 'directo',
        label: 'Directo',
        description: 'Usa el valor entrante sin modificarlo.',
        enabled: true,
      },
      {
        id: 'lineal',
        label: 'Lineal',
        description: 'Aplica valor * factor + offset.',
        enabled: true,
      },
      {
        id: 'ieee754_32',
        label: 'IEEE754 32 bits',
        description: 'Une dos registros Modbus para obtener FLOAT32.',
        enabled: true,
        requiresD2: true,
      },
    ],
  },
  vertiente: {
    id: 'vertiente',
    label: 'Vertiente',
    roles: [
      { id: 'nivel', label: 'Nivel', unitHint: 'm', description: 'Nivel reportado.' },
      { id: 'caudal', label: 'Caudal', unitHint: 'L/s', description: 'Flujo instantaneo.' },
      {
        id: 'totalizador',
        label: 'Totalizador',
        unitHint: 'm3',
        description: 'Volumen acumulado.',
      },
      { id: 'señal', label: 'Señal', unitHint: '%', description: 'Intensidad de señal.' },
      { id: 'generico', label: 'Generico', unitHint: '', description: 'Variable auxiliar.' },
    ],
    transforms: [
      {
        id: 'directo',
        label: 'Directo',
        description: 'Usa el valor entrante sin modificarlo.',
        enabled: true,
      },
      {
        id: 'lineal',
        label: 'Lineal',
        description: 'Aplica valor * factor + offset.',
        enabled: true,
      },
      {
        id: 'ieee754_32',
        label: 'IEEE754 32 bits',
        description: 'Une dos registros Modbus para obtener FLOAT32.',
        enabled: true,
        requiresD2: true,
      },
    ],
  },
  canal: {
    id: 'canal',
    label: 'Canal',
    roles: [
      { id: 'nivel', label: 'Nivel', unitHint: 'm', description: 'Nivel reportado.' },
      { id: 'caudal', label: 'Caudal', unitHint: 'L/s', description: 'Flujo instantaneo.' },
      {
        id: 'totalizador',
        label: 'Totalizador',
        unitHint: 'm3',
        description: 'Volumen acumulado.',
      },
      { id: 'señal', label: 'Señal', unitHint: '%', description: 'Intensidad de señal.' },
      { id: 'generico', label: 'Generico', unitHint: '', description: 'Variable auxiliar.' },
    ],
    transforms: [
      {
        id: 'directo',
        label: 'Directo',
        description: 'Usa el valor entrante sin modificarlo.',
        enabled: true,
      },
      {
        id: 'lineal',
        label: 'Lineal',
        description: 'Aplica valor * factor + offset.',
        enabled: true,
      },
      {
        id: 'ieee754_32',
        label: 'IEEE754 32 bits',
        description: 'Une dos registros Modbus para obtener FLOAT32.',
        enabled: true,
        requiresD2: true,
      },
    ],
  },
  electrico: {
    id: 'electrico',
    label: 'Electrico',
    roles: [
      {
        id: 'energia',
        label: 'Energia',
        unitHint: 'kWh',
        description: 'Energia acumulada o consumida.',
      },
      { id: 'estado', label: 'Estado', unitHint: '', description: 'Estado operativo.' },
      {
        id: 'temperatura',
        label: 'Temperatura',
        unitHint: 'C',
        description: 'Temperatura asociada.',
      },
      { id: 'señal', label: 'Señal', unitHint: '%', description: 'Intensidad de señal.' },
      { id: 'generico', label: 'Generico', unitHint: '', description: 'Variable auxiliar.' },
    ],
    transforms: [
      {
        id: 'directo',
        label: 'Directo',
        description: 'Usa el valor entrante sin modificarlo.',
        enabled: true,
      },
      {
        id: 'lineal',
        label: 'Lineal',
        description: 'Aplica valor * factor + offset.',
        enabled: true,
      },
      {
        id: 'ieee754_32',
        label: 'IEEE754 32 bits',
        description: 'Une dos registros Modbus para obtener FLOAT32.',
        enabled: true,
        requiresD2: true,
      },
    ],
  },
  riles: {
    id: 'riles',
    label: 'Riles',
    roles: [
      { id: 'caudal', label: 'Caudal', unitHint: 'L/s', description: 'Flujo instantaneo.' },
      {
        id: 'totalizador',
        label: 'Totalizador',
        unitHint: 'm3',
        description: 'Volumen acumulado.',
      },
      { id: 'presion', label: 'Presion', unitHint: 'bar', description: 'Presion de proceso.' },
      { id: 'señal', label: 'Señal', unitHint: '%', description: 'Intensidad de señal.' },
      { id: 'generico', label: 'Generico', unitHint: '', description: 'Variable auxiliar.' },
    ],
    transforms: [
      {
        id: 'directo',
        label: 'Directo',
        description: 'Usa el valor entrante sin modificarlo.',
        enabled: true,
      },
      {
        id: 'lineal',
        label: 'Lineal',
        description: 'Aplica valor * factor + offset.',
        enabled: true,
      },
      {
        id: 'ieee754_32',
        label: 'IEEE754 32 bits',
        description: 'Une dos registros Modbus para obtener FLOAT32.',
        enabled: true,
        requiresD2: true,
      },
    ],
  },
  proceso: {
    id: 'proceso',
    label: 'Proceso',
    roles: [
      { id: 'estado', label: 'Estado', unitHint: '', description: 'Estado operativo.' },
      {
        id: 'temperatura',
        label: 'Temperatura',
        unitHint: 'C',
        description: 'Temperatura de proceso.',
      },
      { id: 'presion', label: 'Presion', unitHint: 'bar', description: 'Presion de proceso.' },
      { id: 'señal', label: 'Señal', unitHint: '%', description: 'Intensidad de señal.' },
      { id: 'generico', label: 'Generico', unitHint: '', description: 'Variable auxiliar.' },
    ],
    transforms: [
      {
        id: 'directo',
        label: 'Directo',
        description: 'Usa el valor entrante sin modificarlo.',
        enabled: true,
      },
      {
        id: 'lineal',
        label: 'Lineal',
        description: 'Aplica valor * factor + offset.',
        enabled: true,
      },
      {
        id: 'ieee754_32',
        label: 'IEEE754 32 bits',
        description: 'Une dos registros Modbus para obtener FLOAT32.',
        enabled: true,
        requiresD2: true,
      },
    ],
  },
  pasteurizador: {
    id: 'pasteurizador',
    label: 'Pasteurizador',
    roles: [
      {
        id: 'temperatura_pasteurizacion',
        label: 'Temperatura pasteurizacion',
        unitHint: 'C',
        description: 'Temperatura actual del proceso.',
      },
      {
        id: 'temperatura_entrada',
        label: 'Temperatura entrada',
        unitHint: 'C',
        description: 'Temperatura del producto antes de pasteurizar.',
      },
      {
        id: 'salida_producto_tina',
        label: 'Salida producto a tina',
        unitHint: 'L',
        description: 'Litros acumulados enviados a tina.',
      },
      {
        id: 'estado_valvula',
        label: 'Estado valvula',
        unitHint: '0/1',
        description: 'Estado abierto o cerrado de valvula.',
      },
      {
        id: 'cierres_valvula',
        label: 'Cierres valvula',
        unitHint: 'N',
        description: 'Cantidad de cierres de valvula.',
      },
      {
        id: 'errores_criticos',
        label: 'Errores criticos',
        unitHint: 'N',
        description: 'Fallas criticas detectadas durante el batch.',
      },
      {
        id: 'tiempo_batch',
        label: 'Tiempo batch',
        unitHint: 'min',
        description: 'Duracion del lote.',
      },
      {
        id: 'temperatura_promedio_batch',
        label: 'Temperatura promedio batch',
        unitHint: 'C',
        description: 'Promedio de temperatura del batch.',
      },
      {
        id: 'temperatura_ingreso_agua',
        label: 'Temperatura ingreso agua',
        unitHint: 'C',
        description: 'Temperatura del agua o caldera.',
      },
      {
        id: 'presion_vapor',
        label: 'Presion vapor',
        unitHint: 'bar',
        description: 'Presion del sistema de vapor.',
      },
      {
        id: 'temperatura_gases_combustion',
        label: 'Temperatura gases combustion',
        unitHint: 'C',
        description: 'Temperatura de gases de combustion.',
      },
      { id: 'señal', label: 'Señal', unitHint: '%', description: 'Intensidad de señal.' },
      { id: 'generico', label: 'Generico', unitHint: '', description: 'Variable auxiliar.' },
    ],
    transforms: [
      {
        id: 'directo',
        label: 'Directo',
        description: 'Usa el valor entrante sin modificarlo.',
        enabled: true,
      },
      {
        id: 'lineal',
        label: 'Lineal',
        description: 'Aplica valor * factor + offset.',
        enabled: true,
      },
      {
        id: 'ieee754_32',
        label: 'IEEE754 32 bits',
        description: 'Une dos registros Modbus para obtener FLOAT32.',
        enabled: true,
        requiresD2: true,
      },
    ],
  },
  generico: {
    id: 'generico',
    label: 'Generico',
    roles: [{ id: 'generico', label: 'Generico', unitHint: '', description: 'Variable auxiliar.' }],
    transforms: [
      {
        id: 'directo',
        label: 'Directo',
        description: 'Usa el valor entrante sin modificarlo.',
        enabled: true,
      },
      {
        id: 'lineal',
        label: 'Lineal',
        description: 'Aplica valor * factor + offset.',
        enabled: true,
      },
      {
        id: 'ieee754_32',
        label: 'IEEE754 32 bits',
        description: 'Une dos registros Modbus para obtener FLOAT32.',
        enabled: true,
        requiresD2: true,
      },
    ],
  },
};
